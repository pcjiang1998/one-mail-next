import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MailRule } from '../../shared/types'
import type { MailRuleExecution, MailRuleMessage } from '../db/repositories/mail-rule.repository'

const repository = vi.hoisted(() => ({
  commitMailRuleLocalAction: vi.fn((_id: number, _progress: unknown, action: () => void) =>
    action()
  ),
  enqueueMailRuleExecutions: vi.fn(),
  failMailRuleExecution: vi.fn(),
  getMailRule: vi.fn(),
  getMailRuleMessage: vi.fn(),
  listPendingMailRuleExecutions: vi.fn(),
  updateMailRuleExecution: vi.fn()
}))
const taskService = vi.hoisted(() => ({ createBoardTask: vi.fn(() => ({ taskId: 1 })) }))
const readState = vi.hoisted(() => ({ syncMessageReadState: vi.fn(async () => undefined) }))

vi.mock('../db/repositories/mail-rule.repository', () => repository)
vi.mock('./task-reminder.service', () => taskService)
vi.mock('../mail/read-state-sync', () => readState)
vi.mock('../mail/body-loader', () => ({
  loadMessageBodyFromImap: vi.fn(),
  persistRawMessageBody: vi.fn()
}))

import { enqueueMailRulesForNewMessages, processPendingMailRules } from './mail-rule-engine.service'

const baseMessage: MailRuleMessage = {
  messageId: 7,
  accountId: 3,
  receiveProtocol: 'imap',
  folderRole: 'inbox',
  createdAt: '2026-10-22T00:00:00.000Z',
  unavailable: false,
  context: {
    recipients: ['me@example.com'],
    sender: 'sender@example.com',
    subject: 'hello',
    body: 'hello'
  }
}

function rule(ruleId: number, actions: MailRule['actions']): MailRule {
  return {
    ruleId,
    name: `rule-${ruleId}`,
    enabled: true,
    sortOrder: ruleId,
    conditions: [{ field: 'subject', operator: 'contains', value: 'hello' }],
    actions,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z'
  }
}

function execution(
  executionId: number,
  ruleId: number,
  progressPatch: Partial<NonNullable<MailRuleExecution['progress']>> = {}
): MailRuleExecution {
  return {
    executionId,
    ruleId,
    messageId: 7,
    status: 'matched',
    progress: {
      version: 1,
      rule: ruleSnapshot(ruleId, [{ type: 'add_to_board' }]),
      matched: true,
      nextActionIndex: 0,
      ...progressPatch
    }
  }
}

function ruleSnapshot(
  ruleId: number,
  actions: MailRule['actions']
): NonNullable<MailRuleExecution['progress']>['rule'] {
  const current = rule(ruleId, actions)
  return {
    ruleId: current.ruleId,
    name: current.name,
    accountId: current.accountId,
    enabled: current.enabled,
    sortOrder: current.sortOrder,
    conditions: current.conditions,
    actions: current.actions
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repository.commitMailRuleLocalAction.mockImplementation(
    (executionId: number, progress: unknown, action: () => void) => {
      action()
      repository.updateMailRuleExecution(executionId, progress, 'matched')
    }
  )
  repository.getMailRuleMessage.mockReturnValue(baseMessage)
  repository.getMailRule.mockImplementation((ruleId: number) =>
    rule(ruleId, [{ type: 'add_to_board' }])
  )
  repository.listPendingMailRuleExecutions.mockReturnValue([])
  repository.enqueueMailRuleExecutions.mockReturnValue(0)
})

describe('mail rule engine durability and ordering', () => {
  it('requires an explicit safe initial-sync decision and skips historical admission', () => {
    expect(enqueueMailRulesForNewMessages([7], { initialSync: true })).toBe(0)
    expect(repository.enqueueMailRuleExecutions).not.toHaveBeenCalled()

    repository.enqueueMailRuleExecutions.mockReturnValue(1)
    expect(enqueueMailRulesForNewMessages([7], { initialSync: false })).toBe(1)
    expect(repository.enqueueMailRuleExecutions).toHaveBeenCalledWith([7])
  })

  it('does not create a second board task when the action checkpoint already advanced', async () => {
    repository.listPendingMailRuleExecutions
      .mockReturnValueOnce([execution(12, 4, { nextActionIndex: 1 })])
      .mockReturnValue([])

    const result = await processPendingMailRules()

    expect(result).toMatchObject({ completed: 1, failed: [] })
    expect(taskService.createBoardTask).not.toHaveBeenCalled()
    expect(repository.updateMailRuleExecution).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ nextActionIndex: 1 }),
      'success'
    )
  })

  it('stops later rules for the same message after an earlier rule fails', async () => {
    const first = execution(20, 1, { rule: ruleSnapshot(1, [{ type: 'mark_read' }]) })
    const second = execution(21, 2)
    repository.listPendingMailRuleExecutions
      .mockReturnValueOnce([first, second])
      .mockReturnValue([])
    repository.getMailRule.mockImplementation((ruleId: number) =>
      rule(ruleId, ruleId === 1 ? [{ type: 'mark_read' }] : [{ type: 'add_to_board' }])
    )
    readState.syncMessageReadState.mockRejectedValueOnce(new Error('remote unavailable'))

    const result = await processPendingMailRules()

    expect(result.failed).toEqual([
      { executionId: 20, messageId: 7, ruleId: 1, error: 'remote unavailable' }
    ])
    expect(repository.failMailRuleExecution).toHaveBeenCalledWith(20, 'remote unavailable')
    expect(taskService.createBoardTask).not.toHaveBeenCalled()
    expect(repository.listPendingMailRuleExecutions).toHaveBeenCalledTimes(2)
  })

  it('executes actions in stored order and checkpoints each action', async () => {
    const item = execution(30, 5, {
      rule: ruleSnapshot(5, [{ type: 'mark_read' }, { type: 'add_to_board' }])
    })
    repository.listPendingMailRuleExecutions.mockReturnValueOnce([item]).mockReturnValue([])
    repository.getMailRule.mockReturnValue(
      rule(5, [{ type: 'mark_read' }, { type: 'add_to_board' }])
    )

    await processPendingMailRules()

    expect(readState.syncMessageReadState).toHaveBeenCalledWith(7, true)
    expect(taskService.createBoardTask).toHaveBeenCalledTimes(1)
    const firstCheckpoint = repository.updateMailRuleExecution.mock.invocationCallOrder[0]
    const boardCall = taskService.createBoardTask.mock.invocationCallOrder[0]
    expect(firstCheckpoint).toBeLessThan(boardCall)
    expect(repository.updateMailRuleExecution).toHaveBeenLastCalledWith(
      30,
      expect.objectContaining({ nextActionIndex: 2 }),
      'success'
    )
  })
})
