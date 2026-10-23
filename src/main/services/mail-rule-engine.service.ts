import type { MailRuleAction } from '../../shared/types'
import {
  commitMailRuleLocalAction,
  enqueueMailRuleExecutions,
  failMailRuleExecution,
  getMailRule,
  getMailRuleMessage,
  listPendingMailRuleExecutions,
  updateMailRuleExecution,
  type MailRuleExecution,
  type MailRuleExecutionProgress,
  type MailRuleMessage
} from '../db/repositories/mail-rule.repository'
import { matchMailRule } from './mail-rule-matcher'
import { validateMailRuleInput } from './mail-rule-validation'

export type MailRuleRunResult = {
  completed: number
  skipped: number
  failed: Array<{ executionId: number; messageId: number; ruleId: number; error: string }>
}

let running: Promise<MailRuleRunResult> | undefined

export type MailRuleAdmissionOptions = {
  /** true for initial sync, UIDVALIDITY reset, and any historical/backfill scan */
  initialSync: boolean
}

/**
 * Sync integration contract:
 * - Call synchronously INSIDE the transaction that inserts these new inbox IDs.
 * - initialSync MUST be true for first sync, UIDVALIDITY reset and historical backfill.
 * - After COMMIT, call processPendingMailRules() without failing mail sync on action errors.
 * - Also call processPendingMailRules() at startup/periodic sync to recover pending work.
 * No scanning of historical messages, no network or actions in this admission function.
 */
export function enqueueMailRulesForNewMessages(
  messageIds: number[],
  options: MailRuleAdmissionOptions
): number {
  if (!options || typeof options.initialSync !== 'boolean') {
    throw new Error('新邮件规则必须显式指定是否首次同步。')
  }
  if (
    !Array.isArray(messageIds) ||
    messageIds.length > 1000 ||
    messageIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error('新邮件规则 ID 列表无效或超过 1000 条。')
  }
  if (options.initialSync || messageIds.length === 0) return 0
  return enqueueMailRuleExecutions(messageIds)
}

/** One serialized runner per main process; durable checkpoints survive process restarts. */
export function processPendingMailRules(): Promise<MailRuleRunResult> {
  if (running) return running
  running = drainPendingRules().finally(() => {
    running = undefined
  })
  return running
}

async function drainPendingRules(): Promise<MailRuleRunResult> {
  const result: MailRuleRunResult = { completed: 0, skipped: 0, failed: [] }
  const attempted = new Set<number>()
  const blockedMessages = new Set<number>()
  // New mail can be admitted while an IMAP action is awaiting a network response.
  for (;;) {
    const batch = listPendingMailRuleExecutions().filter(
      (execution) =>
        !attempted.has(execution.executionId) && !blockedMessages.has(execution.messageId)
    )
    if (batch.length === 0) break
    for (const execution of batch) {
      if (blockedMessages.has(execution.messageId)) continue
      attempted.add(execution.executionId)
      try {
        const outcome = await executeRule(execution)
        result[outcome] += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : '邮件规则执行失败。'
        failMailRuleExecution(execution.executionId, message)
        result.failed.push({
          executionId: execution.executionId,
          messageId: execution.messageId,
          ruleId: execution.ruleId,
          error: message
        })
        // Do not let a later trash action overtake a failed read/task/body operation.
        // Other messages continue, and the next drain retries this message in order.
        blockedMessages.add(execution.messageId)
      }
    }
  }
  return result
}

async function executeRule(execution: MailRuleExecution): Promise<'completed' | 'skipped'> {
  const initialProgress = execution.progress
  if (!initialProgress) throw new Error('规则执行进度损坏，已停止执行以避免重复动作。')
  let progress: MailRuleExecutionProgress = initialProgress
  const rule = validateMailRuleInput(progress.rule)
  if (
    rule.ruleId !== execution.ruleId ||
    progress.nextActionIndex > rule.actions.length ||
    (progress.matched !== true && progress.nextActionIndex !== 0)
  ) {
    throw new Error('规则执行进度不一致，已停止执行。')
  }
  const currentRule = getMailRule(execution.ruleId)
  if (!currentRule) return 'skipped' // Deleted rules cascade-delete their execution records.
  if (!currentRule.enabled) {
    updateMailRuleExecution(execution.executionId, progress, 'success')
    return 'skipped'
  }
  let message = getMailRuleMessage(execution.messageId)
  if (!message || message.unavailable) {
    updateMailRuleExecution(execution.executionId, progress, 'success')
    return 'skipped'
  }
  if (rule.accountId !== undefined && rule.accountId !== message.accountId) {
    throw new Error('规则执行的邮箱账号不匹配。')
  }

  if (progress.matched === null) {
    let match = matchMailRule(rule.conditions, message.context)
    if (match === 'needs_body') {
      message = await loadRuleMessageBody(message)
      match = matchMailRule(rule.conditions, message.context)
      if (match === 'needs_body') throw new Error('邮件正文或附件信息仍不可用，稍后重试。')
    }
    progress = { ...progress, matched: match === 'match' }
    updateMailRuleExecution(
      execution.executionId,
      progress,
      match === 'match' ? 'matched' : 'success'
    )
  }
  if (!progress.matched) return 'skipped'

  for (let index = progress.nextActionIndex; index < rule.actions.length; index += 1) {
    const current = getMailRule(execution.ruleId)
    if (!current) return 'skipped'
    if (!current.enabled) {
      updateMailRuleExecution(execution.executionId, progress, 'success')
      return 'skipped'
    }
    const action = rule.actions[index]
    const nextProgress: MailRuleExecutionProgress = {
      ...progress,
      nextActionIndex: index + 1
    }
    if (action.type === 'add_to_board') {
      const { createBoardTask } = await import('./task-reminder.service')
      // Synchronous task service + SAVEPOINT: a crash commits BOTH task and checkpoint,
      // or neither. Task implementations must use savepoints, not a nested BEGIN.
      commitMailRuleLocalAction(execution.executionId, nextProgress, () => {
        createBoardTask({
          accountId: message.accountId,
          messageId: execution.messageId,
          note: action.note,
          reminders: action.reminderMinutes?.map((minutes) => ({
            fireAt: new Date(Date.now() + minutes * 60_000).toISOString()
          }))
        })
      })
    } else {
      await runRemoteAction(action, execution.messageId)
      // Remote operations are idempotent (read=true, move-only trash). A crash in
      // this small window may retry them, but must never permanently delete mail.
      updateMailRuleExecution(execution.executionId, nextProgress, 'matched')
    }
    progress = nextProgress
  }
  updateMailRuleExecution(execution.executionId, progress, 'success')
  return 'completed'
}

async function loadRuleMessageBody(message: MailRuleMessage): Promise<MailRuleMessage> {
  const loader = await import('../mail/body-loader')
  if (message.receiveProtocol === 'pop3') {
    const { getMessageRawSource } = await import('../db/repositories/message.repository')
    const raw = getMessageRawSource(message.messageId)
    if (!raw) throw new Error('POP3 邮件正文未缓存，无法判断正文或附件；未执行规则动作。')
    loader.persistRawMessageBody(message.messageId, raw)
  } else {
    // Fetch MIME only, never use a renderer/webview or load external images/URLs.
    const body = await loader.loadMessageBodyFromImap(message.messageId)
    if (!body) throw new Error('无法加载规则所需的邮件正文。')
  }
  const loaded = getMailRuleMessage(message.messageId)
  if (!loaded || loaded.unavailable) throw new Error('加载规则正文后邮件已不可用。')
  return loaded
}

async function runRemoteAction(
  action: Exclude<MailRuleAction, { type: 'add_to_board' }>,
  messageId: number
): Promise<void> {
  if (action.type === 'mark_read') {
    const { syncMessageReadState } = await import('../mail/read-state-sync')
    await syncMessageReadState(messageId, true)
    return
  }
  // Deliberately no fallback to deleteMessageToTrash: it can permanently delete.
  const module = (await import('../mail/message-delete')) as {
    moveMessageToTrash?: (id: number) => Promise<unknown>
  }
  if (typeof module.moveMessageToTrash !== 'function') {
    throw new Error('安全的移入已删除服务尚不可用；未删除邮件。')
  }
  await module.moveMessageToTrash(messageId)
}
