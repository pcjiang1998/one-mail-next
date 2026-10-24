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
  createOutboxRecord,
  deleteOutboxRecord,
  deleteDraftRecords,
  clearOutboxRecords,
  getOutboxRecord,
  listDraftRecords,
  updateOutboxRecord
} from './outbox.repository'

describe('outbox repository attachments', () => {
  beforeEach(() => {
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-outbox-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('deletes selected drafts atomically and refuses changed or missing records', () => {
    const { accountId } = seedMessageWithAttachment()
    const records = (['draft', 'draft', 'queued'] as const).map((status, index) =>
      createOutboxRecord({
        accountId,
        composeKind: 'new',
        status,
        rfc822MessageId: `<bulk-${index}@example.com>`,
        from: { email: 'sender@example.com' },
        to: []
      })
    )
    expect(() => deleteDraftRecords([records[0].outboxId, records[2].outboxId])).toThrow()
    expect(() => deleteDraftRecords([records[0].outboxId, 99999])).toThrow()
    expect(getOutboxRecord(records[0].outboxId)?.status).toBe('draft')
    expect(
      deleteDraftRecords([records[0].outboxId, records[0].outboxId, records[1].outboxId])
    ).toBe(2)
    expect(listDraftRecords().totalCount).toBe(0)
    expect(getOutboxRecord(records[2].outboxId)?.status).toBe('queued')
  })

  it.each(['sent', 'failed'] as const)(
    'clears all %s records beyond the list limit and preserves mail and other statuses',
    (target) => {
      const { accountId, messageId } = seedMessageWithAttachment()
      const create = (
        status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled',
        index: number
      ): ReturnType<typeof createOutboxRecord> =>
        createOutboxRecord({
          accountId,
          relatedMessageId: messageId,
          composeKind: 'new',
          status,
          rfc822MessageId: `<clear-${index}@example.com>`,
          from: { email: 'sender@example.com' },
          to: []
        })
      for (let i = 0; i < 105; i++) create(target, i)
      const others = (['draft', 'queued', 'sending', 'sent', 'failed', 'cancelled'] as const)
        .filter((status) => status !== target)
        .map((status, index) => create(status, index + 105))
      expect(() => clearOutboxRecords('queued' as 'sent')).toThrow()
      expect(clearOutboxRecords(target)).toBe(105)
      expect(clearOutboxRecords(target)).toBe(0)
      for (const other of others) expect(getOutboxRecord(other.outboxId)?.status).toBe(other.status)
      expect(
        getDatabase()
          .prepare('SELECT message_id FROM onemail_mail_messages WHERE message_id = :messageId')
          .get({ messageId })
      ).toBeDefined()
    }
  )

  it('paginates all local drafts without mixing in the sending queue', () => {
    const { accountId } = seedMessageWithAttachment()
    for (let index = 0; index < 105; index++) {
      createOutboxRecord({
        accountId,
        composeKind: 'new',
        status: 'draft',
        rfc822MessageId: `<draft-${index}@example.com>`,
        from: { email: 'sender@example.com' },
        to: [],
        subject: `Draft ${index}`
      })
    }
    createOutboxRecord({
      accountId,
      composeKind: 'new',
      status: 'queued',
      rfc822MessageId: '<queue@example.com>',
      from: { email: 'sender@example.com' },
      to: []
    })
    const first = listDraftRecords({ limit: 50 })
    const second = listDraftRecords({ limit: 50, offset: 50 })
    const third = listDraftRecords({ limit: 50, offset: 100 })
    expect(first).toMatchObject({ totalCount: 105, draftCount: 105, offset: 0 })
    expect([first.messages.length, second.messages.length, third.messages.length]).toEqual([
      50, 50, 5
    ])
    const ids = [...first.messages, ...second.messages, ...third.messages].map(
      (message) => message.outboxId
    )
    expect(new Set(ids).size).toBe(105)
    expect(first.messages[0].subject).toBe('Draft 104')
    for (const message of third.messages) deleteOutboxRecord(message.outboxId)
    expect(listDraftRecords({ limit: 50, offset: 100 })).toMatchObject({
      totalCount: 100,
      draftCount: 100,
      offset: 50
    })
  })

  it('filters by sending account and searches subject, recipient name, cc and bcc before pagination', () => {
    const { accountId } = seedMessageWithAttachment()
    const otherId = Number(
      getDatabase()
        .prepare(
          `
      INSERT INTO onemail_mail_accounts (provider_key, email, normalized_email, account_label, auth_type, imap_host, imap_port, imap_security)
      VALUES ('test', 'other@example.com', 'other@example.com', 'Other', 'password', 'imap.example.com', 993, 'ssl_tls')
    `
        )
        .run().lastInsertRowid
    )
    const first = createOutboxRecord({
      accountId,
      composeKind: 'reply',
      status: 'draft',
      rfc822MessageId: '<first@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ name: '项目联系人', email: 'recipient@example.com' }],
      cc: [{ email: 'TEAM@example.com' }],
      bcc: [{ email: 'private@example.com' }],
      subject: '100% complete'
    })
    createOutboxRecord({
      accountId: otherId,
      composeKind: 'new',
      status: 'draft',
      rfc822MessageId: '<other@example.com>',
      from: { email: 'other@example.com' },
      to: [],
      subject: 'Other draft'
    })
    expect(listDraftRecords().messages).toHaveLength(2)
    expect(listDraftRecords({ accountId })).toMatchObject({ totalCount: 1, draftCount: 2 })
    for (const keyword of ['项目联系人', 'recipient', 'team@', 'PRIVATE@', '100%', '%']) {
      expect(listDraftRecords({ keyword }).messages.map((message) => message.outboxId)).toEqual([
        first.outboxId
      ])
    }
    expect(listDraftRecords({ accountId: otherId, keyword: '100%' }).totalCount).toBe(0)
    expect(listDraftRecords({ keyword: 'missing' }).messages).toEqual([])
  })

  it('persists forwarded attachment source ids without requiring a local file path', () => {
    const { accountId, messageId, attachmentId } = seedMessageWithAttachment()

    const outbox = createOutboxRecord({
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      subject: 'Fwd: report',
      bodyText: 'Forwarding this.',
      attachments: [
        {
          sourceMessageId: messageId,
          sourceAttachmentId: attachmentId,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048
        }
      ]
    })

    expect(outbox.attachments).toEqual([
      {
        sourceMessageId: messageId,
        sourceAttachmentId: attachmentId,
        filePath: undefined,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('replaces forwarded attachments when updating an outbox draft', () => {
    const { accountId, messageId, attachmentId } = seedMessageWithAttachment()
    const outbox = createOutboxRecord({
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      attachments: [
        {
          sourceMessageId: messageId,
          sourceAttachmentId: attachmentId,
          filename: 'report.pdf',
          sizeBytes: 2048
        }
      ]
    })

    const updated = updateOutboxRecord(outbox.outboxId, {
      accountId,
      relatedMessageId: messageId,
      composeKind: 'forward',
      status: 'draft',
      rfc822MessageId: '<draft@example.com>',
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      attachments: []
    })

    expect(updated.attachments).toEqual([])
  })
})

function seedMessageWithAttachment(): {
  accountId: number
  folderId: number
  messageId: number
  attachmentId: number
} {
  const db = getDatabase()

  db.prepare(
    `
    INSERT INTO onemail_provider_presets (
      provider_key,
      display_name,
      domains_json,
      auth_type
    )
    VALUES ('test', 'Test Mail', '["example.com"]', 'password')
    `
  ).run()

  const accountResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_accounts (
        provider_key,
        email,
        normalized_email,
        account_label,
        auth_type,
        imap_host,
        imap_port,
        imap_security
      )
      VALUES (
        'test',
        'sender@example.com',
        'sender@example.com',
        'Sender',
        'password',
        'imap.example.com',
        993,
        'ssl_tls'
      )
      `
    )
    .run()
  const accountId = Number(accountResult.lastInsertRowid)

  const folderResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_folders (
        account_id,
        path,
        name,
        role
      )
      VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')
      `
    )
    .run({ accountId })
  const folderId = Number(folderResult.lastInsertRowid)

  const messageResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_messages (
        account_id,
        folder_id,
        uid,
        rfc822_message_id,
        subject,
        from_email,
        has_attachments
      )
      VALUES (
        :accountId,
        :folderId,
        1,
        '<source@example.com>',
        'Report',
        'author@example.com',
        1
      )
      `
    )
    .run({ accountId, folderId })
  const messageId = Number(messageResult.lastInsertRowid)

  const attachmentResult = db
    .prepare(
      `
      INSERT INTO onemail_message_attachments (
        message_id,
        filename,
        mime_type,
        content_disposition,
        size_bytes
      )
      VALUES (:messageId, 'report.pdf', 'application/pdf', 'attachment', 2048)
      `
    )
    .run({ messageId })

  return {
    accountId,
    folderId,
    messageId,
    attachmentId: Number(attachmentResult.lastInsertRowid)
  }
}
