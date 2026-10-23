import { getDatabase, toBoolean, toNumber, type SqliteRow } from '../connection'
import type {
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRuleInput
} from '../../../shared/types'
import {
  MAIL_RULE_LIMITS,
  validateMailRuleId,
  validateMailRuleInput,
  validateMailRuleOrder
} from '../../services/mail-rule-validation'
import { mailRuleBodyText, type MailRuleMatchContext } from '../../services/mail-rule-matcher'

type RuleRow = SqliteRow & {
  rule_id: number
  name: string
  account_id: number | null
  enabled: number
  sort_order: number
  conditions_json: string
  actions_json: string
  created_at: string
  updated_at: string
}

export type MailRuleExecutionProgress = {
  version: 1
  /** Snapshot admission-time conditions/actions, never reinterpret an edited rule on retry. */
  rule: MailRuleInput & { ruleId: number }
  matched: boolean | null
  nextActionIndex: number
}

export type MailRuleExecution = {
  executionId: number
  ruleId: number
  messageId: number
  status: 'matched' | 'success' | 'failed'
  progress: MailRuleExecutionProgress | null
}

export type MailRuleMessage = {
  messageId: number
  accountId: number
  receiveProtocol: string
  folderRole: string
  createdAt: string
  unavailable: boolean
  context: MailRuleMatchContext
}

export function listMailRules(): MailRule[] {
  return getDatabase()
    .prepare<RuleRow>(
      `SELECT rule_id, name, account_id, enabled, sort_order, conditions_json, actions_json, created_at, updated_at
     FROM onemail_mail_rules ORDER BY sort_order, rule_id`
    )
    .all()
    .map(mapRule)
}

export function getMailRule(ruleId: number): MailRule | null {
  const row = getDatabase()
    .prepare<RuleRow>(
      `SELECT rule_id, name, account_id, enabled, sort_order, conditions_json, actions_json, created_at, updated_at
     FROM onemail_mail_rules WHERE rule_id = :ruleId`
    )
    .get({ ruleId })
  return row ? mapRule(row) : null
}

export function saveMailRule(value: unknown): MailRule {
  const input = validateMailRuleInput(value)
  const db = getDatabase()
  if (
    input.accountId !== undefined &&
    !db
      .prepare('SELECT account_id FROM onemail_mail_accounts WHERE account_id = :accountId')
      .get({ accountId: input.accountId })
  )
    throw new Error('规则指定的邮箱账号不存在。')
  const params = {
    name: input.name,
    accountId: input.accountId ?? null,
    enabled: input.enabled ? 1 : 0,
    conditionsJson: JSON.stringify(input.conditions),
    actionsJson: JSON.stringify(input.actions)
  }
  let ruleId = input.ruleId
  if (ruleId !== undefined) {
    // Only reorderMailRules changes ordering. A stale editor must not undo a drag reorder.
    const result = db
      .prepare(
        `UPDATE onemail_mail_rules
       SET name = :name, account_id = :accountId, enabled = :enabled,
           conditions_json = :conditionsJson, actions_json = :actionsJson,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE rule_id = :ruleId`
      )
      .run({ ...params, ruleId })
    if (result.changes === 0) throw new Error('邮件规则不存在。')
  } else {
    const rules = listMailRules()
    if (rules.length >= MAIL_RULE_LIMITS.rules)
      throw new Error(`最多创建 ${MAIL_RULE_LIMITS.rules} 条邮件规则。`)
    const sortOrder = rules.reduce((max, rule) => Math.max(max, rule.sortOrder), -1) + 1
    const result = db
      .prepare(
        `INSERT INTO onemail_mail_rules (name, account_id, enabled, sort_order, conditions_json, actions_json)
       VALUES (:name, :accountId, :enabled, :sortOrder, :conditionsJson, :actionsJson)`
      )
      .run({ ...params, sortOrder })
    ruleId = Number(result.lastInsertRowid)
  }
  const saved = getMailRule(ruleId)
  if (!saved) throw new Error('保存邮件规则失败。')
  return saved
}

export function deleteMailRule(value: unknown): boolean {
  const ruleId = validateMailRuleId(value)
  return (
    getDatabase().prepare('DELETE FROM onemail_mail_rules WHERE rule_id = :ruleId').run({ ruleId })
      .changes > 0
  )
}

export function reorderMailRules(value: unknown): MailRule[] {
  const ruleIds = validateMailRuleOrder(value)
  return withRuleSavepoint(() => {
    const current = listMailRules()
    const existingIds = new Set(current.map((rule) => rule.ruleId))
    if (ruleIds.length !== current.length || ruleIds.some((id) => !existingIds.has(id))) {
      throw new Error('规则已变更，请刷新后提交所有规则 ID 的完整排列。')
    }
    const update = getDatabase().prepare(
      `UPDATE onemail_mail_rules SET sort_order = :sortOrder,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rule_id = :ruleId`
    )
    ruleIds.forEach((ruleId, sortOrder) => update.run({ ruleId, sortOrder }))
    return listMailRules()
  })
}

export function setMailRuleEnabled(value: unknown, enabled: unknown): MailRule {
  const ruleId = validateMailRuleId(value)
  if (typeof enabled !== 'boolean') throw new Error('规则启用状态必须是布尔值。')
  const result = getDatabase()
    .prepare(
      `UPDATE onemail_mail_rules SET enabled = :enabled,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rule_id = :ruleId`
    )
    .run({ ruleId, enabled: enabled ? 1 : 0 })
  if (result.changes === 0) throw new Error('邮件规则不存在。')
  const rule = getMailRule(ruleId)
  if (!rule) throw new Error('读取邮件规则失败。')
  return rule
}

/** Called ONLY for newly inserted incoming IDs, inside the sync insertion transaction. */
export function enqueueMailRuleExecutions(messageIds: number[]): number {
  return withRuleSavepoint(() => {
    const rules = listMailRules().filter((rule) => rule.enabled)
    if (rules.length === 0) return 0
    const insert = getDatabase().prepare(
      `INSERT INTO onemail_rule_executions (rule_id, message_id, status, progress_json)
       VALUES (:ruleId, :messageId, 'matched', :progressJson)
       ON CONFLICT(rule_id, message_id) DO NOTHING`
    )
    let queued = 0
    for (const messageId of new Set(messageIds)) {
      const message = getMailRuleMessage(messageId)
      // Never run on sent/drafts/trash/backfilled folders, even if a caller passes them.
      if (!message || message.unavailable || message.folderRole !== 'inbox') continue
      for (const rule of rules) {
        if (rule.accountId !== undefined && rule.accountId !== message.accountId) continue
        if (Date.parse(rule.createdAt) > Date.parse(message.createdAt)) continue
        const progress: MailRuleExecutionProgress = {
          version: 1,
          rule: {
            ruleId: rule.ruleId,
            name: rule.name,
            accountId: rule.accountId,
            enabled: rule.enabled,
            sortOrder: rule.sortOrder,
            conditions: rule.conditions,
            actions: rule.actions
          },
          matched: null,
          nextActionIndex: 0
        }
        queued += insert.run({
          ruleId: rule.ruleId,
          messageId,
          progressJson: JSON.stringify(progress)
        }).changes
      }
    }
    return queued
  })
}

export function listPendingMailRuleExecutions(): MailRuleExecution[] {
  return getDatabase()
    .prepare<
      SqliteRow & {
        execution_id: number
        rule_id: number
        message_id: number
        status: MailRuleExecution['status']
        progress_json: string
      }
    >(
      `SELECT execution_id, rule_id, message_id, status, progress_json
     FROM onemail_rule_executions
     WHERE status IN ('matched', 'failed') AND progress_json != '{}'
     ORDER BY message_id, execution_id`
    )
    .all()
    .map((row) => ({
      executionId: toNumber(row.execution_id),
      ruleId: toNumber(row.rule_id),
      messageId: toNumber(row.message_id),
      status: row.status,
      progress: parseProgress(row.progress_json)
    }))
    .sort((left, right) => {
      const messageOrder = left.messageId - right.messageId
      if (messageOrder !== 0) return messageOrder
      const leftOrder = left.progress?.rule.sortOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.progress?.rule.sortOrder ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.executionId - right.executionId
    })
}

export function updateMailRuleExecution(
  executionId: number,
  progress: MailRuleExecutionProgress,
  status: MailRuleExecution['status'],
  error?: string
): void {
  const result = getDatabase()
    .prepare(
      `UPDATE onemail_rule_executions
     SET progress_json = :progressJson, status = :status, error_message = :error,
         executed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE execution_id = :executionId`
    )
    .run({
      executionId,
      progressJson: JSON.stringify(progress),
      status,
      error: error?.slice(0, 2000) ?? null
    })
  if (result.changes === 0) throw new Error('规则执行已取消或邮件已删除。')
}

export function failMailRuleExecution(executionId: number, error: string): void {
  getDatabase()
    .prepare(
      `UPDATE onemail_rule_executions SET status = 'failed', error_message = :error,
     executed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE execution_id = :executionId`
    )
    .run({ executionId, error: error.slice(0, 2000) })
}

/**
 * Local task INSERT(s) and action checkpoint must commit together. No await is
 * allowed here. SAVEPOINT also composes with the enclosing sync/task transaction.
 */
export function commitMailRuleLocalAction(
  executionId: number,
  progress: MailRuleExecutionProgress,
  action: () => void
): void {
  withRuleSavepoint(() => {
    action()
    updateMailRuleExecution(executionId, progress, 'matched')
  })
}

export function getMailRuleMessage(messageId: number): MailRuleMessage | null {
  const db = getDatabase()
  const row = db
    .prepare<
      SqliteRow & {
        message_id: number
        account_id: number
        email: string
        receive_protocol: string
        role: string
        created_at: string
        remote_deleted: number
        user_hidden: number
        from_email: string | null
        subject: string | null
        has_attachments: number
        body_status: string
        body_message_id: number | null
        body_text: string | null
        body_html_sanitized: string | null
        raw_source: string | null
      }
    >(
      `SELECT m.message_id, m.account_id, a.email, a.receive_protocol, f.role, m.created_at,
            m.remote_deleted, m.user_hidden, m.from_email, m.subject, m.has_attachments,
            m.body_status, b.message_id AS body_message_id, b.body_text, b.body_html_sanitized,
            b.raw_source
     FROM onemail_mail_messages m
     JOIN onemail_mail_accounts a ON a.account_id = m.account_id
     JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
     LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
     WHERE m.message_id = :messageId`
    )
    .get({ messageId })
  if (!row) return null
  const storedRecipients = db
    .prepare<{ email: string }>(
      `SELECT email FROM onemail_message_addresses
     WHERE message_id = :messageId AND kind IN ('to', 'cc', 'bcc') ORDER BY address_id`
    )
    .all({ messageId })
    .map((address) => address.email)
  const rawRecipients = extractRawRecipients(row.raw_source)
  const recipients = [...new Set([...storedRecipients, ...rawRecipients])]
  const bodyReady = row.body_status === 'ready' && row.body_message_id !== null
  return {
    messageId,
    accountId: toNumber(row.account_id),
    receiveProtocol: row.receive_protocol,
    folderRole: row.role,
    createdAt: row.created_at,
    unavailable: toBoolean(row.remote_deleted) || toBoolean(row.user_hidden),
    context: {
      // Receiving account is also a recipient (including Bcc/forwarded delivery).
      recipients: [...new Set([row.email, ...recipients])],
      recipientsKnown: storedRecipients.length > 0 || Boolean(row.raw_source),
      sender: row.from_email ?? '',
      subject: row.subject ?? '',
      body: bodyReady ? mailRuleBodyText(row.body_text, row.body_html_sanitized) : undefined,
      hasAttachment: bodyReady
        ? toBoolean(row.has_attachments)
        : toBoolean(row.has_attachments)
          ? true
          : undefined
    }
  }
}

function extractRawRecipients(rawSource: string | null): string[] {
  if (!rawSource) return []
  const headers = new Map<string, string>()
  let current = ''
  const headerEnd = rawSource.search(/\r?\n\r?\n/)
  const headerSource = headerEnd < 0 ? rawSource : rawSource.slice(0, headerEnd)
  for (const line of headerSource.split(/\r?\n/)) {
    if (/^\s/.test(line) && current) {
      headers.set(current, `${headers.get(current) ?? ''} ${line.trim()}`.trim())
      continue
    }
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    current = line.slice(0, separator).trim().toLowerCase()
    headers.set(current, line.slice(separator + 1).trim())
  }
  const recipients: string[] = []
  for (const key of ['to', 'cc', 'bcc']) {
    const value = headers.get(key) ?? ''
    for (const match of value.matchAll(
      /[A-Z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*/gi
    )) {
      recipients.push(match[0])
    }
  }
  return recipients
}

function withRuleSavepoint<T>(callback: () => T): T {
  const db = getDatabase()
  db.exec('SAVEPOINT mail_rule_operation')
  try {
    const result = callback()
    db.exec('RELEASE SAVEPOINT mail_rule_operation')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT mail_rule_operation')
    db.exec('RELEASE SAVEPOINT mail_rule_operation')
    throw error
  }
}

function mapRule(row: RuleRow): MailRule {
  return {
    ruleId: toNumber(row.rule_id),
    name: row.name,
    accountId: row.account_id === null ? undefined : toNumber(row.account_id),
    enabled: toBoolean(row.enabled),
    sortOrder: toNumber(row.sort_order),
    conditions: normalizeConditions(parseArray<MailRuleCondition>(row.conditions_json)),
    actions: parseArray<MailRuleAction>(row.actions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseArray<T>(value: string): T[] {
  try {
    const result: unknown = JSON.parse(value)
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

function normalizeConditions(conditions: MailRuleCondition[]): MailRuleCondition[] {
  return conditions.map((condition, index) => ({
    ...condition,
    connector: index === conditions.length - 1 ? undefined : (condition.connector ?? 'and')
  }))
}

function parseProgress(value: string): MailRuleExecutionProgress | null {
  try {
    const result = JSON.parse(value) as MailRuleExecutionProgress
    if (
      !result ||
      result.version !== 1 ||
      !result.rule ||
      ![null, true, false].includes(result.matched) ||
      !Number.isInteger(result.nextActionIndex) ||
      result.nextActionIndex < 0
    )
      return null
    return result
  } catch {
    return null
  }
}
