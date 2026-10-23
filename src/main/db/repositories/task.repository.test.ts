import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => tmpdir())
  }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../connection'
import {
  createTaskFromMessage,
  getTask,
  markReminderFired,
  updateTaskStatuses
} from './task.repository'

describe('task repository', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-task-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
    vi.useRealTimers()
  })

  it('validates every reminder before inserting the task, leaving no partial rows', () => {
    const source = seedMessage()
    const validTime = futureTime(60 * 60 * 1000)

    expect(() =>
      createTaskFromMessage({
        accountId: source.accountId,
        messageId: source.messageId,
        note: 'do not lose this note',
        reminders: [{ fireAt: validTime }, { fireAt: '2026-02-30T10:00:00.000Z' }]
      })
    ).toThrow('第 2 条提醒的日期无效')

    const db = getDatabase()
    expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_tasks').get()).toMatchObject({
      count: 0
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_task_reminders').get()).toMatchObject({
      count: 0
    })
  })

  it('rejects a past reminder instead of silently dropping it', () => {
    const source = seedMessage()

    expect(() =>
      createTaskFromMessage({
        accountId: source.accountId,
        messageId: source.messageId,
        reminders: [{ fireAt: '2025-12-31T23:59:59.000Z' }]
      })
    ).toThrow('必须晚于当前时间')

    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_tasks').get()
    ).toMatchObject({ count: 0 })
  })

  it('persists all valid reminders and explicitly cancels pending reminders on completion', () => {
    const source = seedMessage()
    const task = createTaskFromMessage({
      accountId: source.accountId,
      messageId: source.messageId,
      reminders: [
        { fireAt: futureTime(60 * 60 * 1000) },
        { fireAt: futureTime(2 * 60 * 60 * 1000) }
      ]
    })
    expect(task.reminders).toHaveLength(2)
    expect(task.reminders.every((reminder) => reminder.status === 'pending')).toBe(true)

    const firedReminderId = task.reminders[0]?.reminderId
    expect(firedReminderId).toBeDefined()
    expect(markReminderFired(firedReminderId as number)).toBe(true)
    updateTaskStatuses([task.taskId], 'completed')

    const completed = getTask(task.taskId)
    expect(completed?.status).toBe('completed')
    expect(completed?.reminders.map((reminder) => reminder.status)).toEqual(['fired', 'cancelled'])
  })

  it('does not resurrect cancelled reminders when a completed task is reopened', () => {
    const source = seedMessage()
    const task = createTaskFromMessage({
      accountId: source.accountId,
      messageId: source.messageId,
      reminders: [{ fireAt: futureTime(60 * 60 * 1000) }]
    })

    updateTaskStatuses([task.taskId], 'cancelled')
    updateTaskStatuses([task.taskId], 'todo')

    expect(getTask(task.taskId)?.reminders[0]?.status).toBe('cancelled')
  })
})

function futureTime(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString()
}

function seedMessage(): { accountId: number; messageId: number } {
  const db = getDatabase()
  db.prepare(
    `
    INSERT INTO onemail_provider_presets (provider_key, display_name, domains_json, auth_type)
    VALUES ('task-test', 'Task Test', '[]', 'password')
  `
  ).run()
  const account = db
    .prepare(
      `
    INSERT INTO onemail_mail_accounts (
      provider_key, email, normalized_email, account_label, auth_type,
      imap_host, imap_port, imap_security
    ) VALUES ('task-test', 'task@example.com', 'task@example.com', 'Task test',
              'password', 'imap.example.com', 993, 'ssl_tls')
  `
    )
    .run()
  const accountId = Number(account.lastInsertRowid)
  const folder = db
    .prepare(
      `
    INSERT INTO onemail_mail_folders (account_id, path, name, role)
    VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')
  `
    )
    .run({ accountId })
  const folderId = Number(folder.lastInsertRowid)
  const message = db
    .prepare(
      `
    INSERT INTO onemail_mail_messages (
      account_id, folder_id, uid, rfc822_message_id, subject, from_name, from_email
    ) VALUES (:accountId, :folderId, 1, '<task@example.com>', 'Task subject', 'Sender', 'sender@example.com')
  `
    )
    .run({ accountId, folderId })
  return { accountId, messageId: Number(message.lastInsertRowid) }
}
