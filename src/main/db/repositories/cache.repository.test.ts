import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    getPath: vi.fn(() => tmpdir()),
    setLoginItemSettings: vi.fn()
  }
}))

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../connection'
import { createAccount } from './account.repository'
import { cleanupMessageCache } from './cache.repository'
import { updateSettings } from './settings.repository'
import { withMessageCacheAccess, withAccountCacheAccess } from '../../services/cache-activity'

describe('mail cache cleanup', () => {
  let testDir = ''
  let accountId: number
  let folderId: number
  const now = Date.parse('2026-10-26T12:00:00.000Z')

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onemail-cache-test-'))
    const databasePath = join(testDir, 'test.sqlite')
    setDatabaseKey('k00000000000000000000000000')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
    accountId = createAccount({
      providerKey: 'test',
      email: 'user@example.com',
      authType: 'manual',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls',
      smtpEnabled: false
    }).accountId
    folderId = Number(
      getDatabase()
        .prepare(
          `INSERT INTO onemail_mail_folders
      (account_id, path, name, role) VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')`
        )
        .run({ accountId }).lastInsertRowid
    )
    updateSettings({ cacheRetentionDays: 60 })
  })

  afterEach(() => {
    closeDatabase()
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  function seed(uid: number, date = '2020-01-01T00:00:00.000Z', accessed?: string): number {
    const db = getDatabase()
    const messageId = Number(
      db
        .prepare(
          `INSERT INTO onemail_mail_messages
         (account_id, folder_id, uid, received_at, subject, body_status, last_user_accessed_at)
       VALUES (:accountId, :folderId, :uid, :date, 'Subject', 'ready', :accessed)`
        )
        .run({ accountId, folderId, uid, date, accessed: accessed ?? null }).lastInsertRowid
    )
    db.prepare(
      `INSERT INTO onemail_message_bodies (message_id, body_text, raw_source)
      VALUES (:messageId, 'Secret body', 'Secret MIME')`
    ).run({ messageId })
    db.prepare(
      `INSERT INTO onemail_message_attachments (message_id, filename, cached_content)
      VALUES (:messageId, 'file.txt', :content)`
    ).run({ messageId, content: Buffer.from('Secret attachment') })
    db.prepare(
      `INSERT INTO onemail_message_search (message_id, subject, body_text)
      VALUES (:messageId, 'Subject', 'Secret body')`
    ).run({ messageId })
    return messageId
  }

  it('clears content and raw MIME without deleting metadata, identities or exported files', () => {
    const old = seed(1)
    seed(2, new Date(now).toISOString())
    const externalFile = join(testDir, 'saved-attachment.txt')
    writeFileSync(externalFile, 'User-edited attachment')
    const db = getDatabase()
    expect(cleanupMessageCache(now)).toEqual({
      days: 60,
      deletedMessages: 0,
      clearedBodies: 1,
      clearedAttachments: 1
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages').get()).toEqual({
      count: 2
    })
    expect(
      db
        .prepare('SELECT body_status FROM onemail_mail_messages WHERE message_id = :old')
        .get({ old })
    ).toEqual({ body_status: 'none' })
    expect(
      db
        .prepare('SELECT cached_content FROM onemail_message_attachments WHERE message_id = :old')
        .get({ old })
    ).toEqual({ cached_content: null })
    expect(
      db
        .prepare('SELECT body_text, subject FROM onemail_message_search WHERE message_id = :old')
        .get({ old })
    ).toEqual({ body_text: '', subject: 'Subject' })
    expect(readFileSync(externalFile, 'utf8')).toBe('User-edited attachment')
    expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_remote_writebacks').get()).toEqual({
      count: 0
    })
  })

  it.each([false, true])(
    'protects board-linked, recently accessed and boundary messages with metadata cleanup=%s',
    (cleanupMetadata) => {
      updateSettings({ cleanupMetadata })
      const old = seed(1)
      seed(2, '2020-01-01T00:00:00.000Z', '2026-10-25T00:00:00.000Z')
      seed(3, new Date(now - 60 * 86400000).toISOString())
      seed(4, new Date(now + 86400000).toISOString(), '2020-01-01T00:00:00.000Z')
      for (const [index, status] of ['todo', 'completed', 'cancelled'].entries()) {
        const messageId = seed(index + 5)
        getDatabase()
          .prepare(
            `INSERT INTO onemail_tasks (account_id, message_id, status)
        VALUES (:accountId, :messageId, :status)`
          )
          .run({ accountId, messageId, status })
      }
      expect(cleanupMessageCache(now)).toEqual({
        days: 60,
        clearedBodies: 1,
        clearedAttachments: 1,
        deletedMessages: cleanupMetadata ? 1 : 0
      })
      expect(
        getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_message_bodies').get()
      ).toEqual({ count: 6 })
      if (cleanupMetadata)
        expect(
          getDatabase()
            .prepare('SELECT 1 FROM onemail_mail_messages WHERE message_id = :old')
            .get({ old })
        ).toBeUndefined()
    }
  )

  it('allows cleanup after the board link is removed', () => {
    const messageId = seed(1)
    const db = getDatabase()
    db.prepare(
      'INSERT INTO onemail_tasks (account_id, message_id) VALUES (:accountId, :messageId)'
    ).run({ accountId, messageId })
    expect(cleanupMessageCache(now).clearedBodies).toBe(0)
    db.exec('DELETE FROM onemail_tasks')
    expect(cleanupMessageCache(now).clearedBodies).toBe(1)
  })

  it('skips in-flight reads and syncs until their work finishes', async () => {
    const messageId = seed(1)
    await withMessageCacheAccess(messageId, async () => {
      expect(cleanupMessageCache(now).clearedBodies).toBe(0)
    })
    await withAccountCacheAccess(accountId, async () => {
      expect(cleanupMessageCache(now).clearedBodies).toBe(0)
    })
    expect(cleanupMessageCache(now).clearedBodies).toBe(1)
  })

  it('rejects manual cleanup while retention is zero', () => {
    seed(1)
    updateSettings({ cacheRetentionDays: 0 })
    expect(() => cleanupMessageCache(now)).toThrow('为 0')
  })

  it('rejects manual cleanup when another window changed the displayed settings', () => {
    seed(1)
    expect(() =>
      cleanupMessageCache(now, { cacheRetentionDays: 90, cleanupMetadata: false })
    ).toThrow('已发生变化')
    expect(() =>
      cleanupMessageCache(now, { cacheRetentionDays: 60, cleanupMetadata: true })
    ).toThrow('已发生变化')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_message_bodies').get()
    ).toEqual({ count: 1 })
  })

  it.each([false, true])(
    'preserves attachments needed by unsent drafts with metadata cleanup=%s',
    (cleanupMetadata) => {
      updateSettings({ cleanupMetadata })
      const messageId = seed(1)
      const db = getDatabase()
      const outboxId = Number(
        db
          .prepare(
            `INSERT INTO onemail_outbox_messages
      (account_id, compose_kind, rfc822_message_id, from_email, status)
      VALUES (:accountId, 'forward', 'draft@example.com', 'user@example.com', 'draft')`
          )
          .run({ accountId }).lastInsertRowid
      )
      db.prepare(
        `INSERT INTO onemail_outbox_attachments
      (outbox_id, source_kind, source_attachment_id, filename)
      SELECT :outboxId, 'forwarded_attachment', attachment_id, filename
      FROM onemail_message_attachments WHERE message_id = :messageId`
      ).run({ outboxId, messageId })
      expect(cleanupMessageCache(now).clearedBodies).toBe(0)
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM onemail_message_attachments WHERE cached_content IS NOT NULL'
          )
          .get()
      ).toEqual({ count: 1 })
      db.prepare(
        `UPDATE onemail_outbox_messages SET status = 'sent' WHERE outbox_id = :outboxId`
      ).run({ outboxId })
      expect(cleanupMessageCache(now).clearedBodies).toBe(1)
    }
  )

  it.each(['queued', 'running', 'failed'])(
    'does not destroy the identity of a %s writeback',
    (status) => {
      updateSettings({ cleanupMetadata: true })
      const messageId = seed(1)
      const db = getDatabase()
      db.prepare(
        `INSERT INTO onemail_remote_writebacks
      (account_id, message_id, operation_kind, status, idempotency_key)
      VALUES (:accountId, :messageId, 'mark_read', :status, 'cache-audit')`
      ).run({ accountId, messageId, status })
      expect(cleanupMessageCache(now).deletedMessages).toBe(0)
      expect(db.prepare('SELECT message_id, status FROM onemail_remote_writebacks').get()).toEqual({
        message_id: messageId,
        status
      })
      db.exec(`UPDATE onemail_remote_writebacks SET status = 'success'`)
      expect(cleanupMessageCache(now).deletedMessages).toBe(1)
    }
  )

  it.each(['matched', 'failed'])(
    'preserves content for a %s rule execution until it completes',
    (status) => {
      updateSettings({ cleanupMetadata: true })
      const messageId = seed(1)
      const db = getDatabase()
      const ruleId = Number(
        db.prepare("INSERT INTO onemail_mail_rules (name) VALUES ('Cache audit')").run()
          .lastInsertRowid
      )
      db.prepare(
        `INSERT INTO onemail_rule_executions (rule_id, message_id, status)
      VALUES (:ruleId, :messageId, :status)`
      ).run({ ruleId, messageId, status })
      expect(cleanupMessageCache(now).deletedMessages).toBe(0)
      expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_message_bodies').get()).toEqual({
        count: 1
      })
      db.exec("UPDATE onemail_rule_executions SET status = 'success'")
      expect(cleanupMessageCache(now).deletedMessages).toBe(1)
    }
  )

  it.each(['pending', 'running', 'failed'])(
    'preserves a %s message operation until it completes',
    (status) => {
      updateSettings({ cleanupMetadata: true })
      const messageId = seed(1)
      const db = getDatabase()
      db.prepare(
        `INSERT INTO onemail_message_operations (account_id, message_id, operation_kind, status)
      VALUES (:accountId, :messageId, 'forward', :status)`
      ).run({ accountId, messageId, status })
      expect(cleanupMessageCache(now).deletedMessages).toBe(0)
      expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_message_bodies').get()).toEqual({
        count: 1
      })
      db.exec("UPDATE onemail_message_operations SET status = 'success'")
      expect(cleanupMessageCache(now).deletedMessages).toBe(1)
    }
  )
})
