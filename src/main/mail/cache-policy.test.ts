import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false }))
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('./imap-session', () => ({ SimpleImapSession: { connect: vi.fn() } }))
vi.mock('./imap-auth', () => ({ authenticateImapSession: vi.fn() }))
vi.mock('./pop3-session', () => ({ Pop3Session: { connect: vi.fn() } }))
vi.mock('../services/credential-store', () => ({ readAccountPassword: vi.fn(() => 'secret') }))

import { app } from 'electron'
import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import { createAccount } from '../db/repositories/account.repository'
import { updateSettings } from '../db/repositories/settings.repository'
import { getMessage } from '../db/repositories/message.repository'
import { SimpleImapSession } from './imap-session'
import { Pop3Session } from './pop3-session'
import { loadMessageBodyFromImap, persistRawMessageBody } from './body-loader'
import { loadAttachmentContent } from './attachment-downloader'
import { fillMissingMessageBodies } from './sync-body-cache'
import { syncPop3Account } from './pop3-sync'

const structure =
  '* 1 FETCH (BODYSTRUCTURE (("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 5 1 NIL NIL)("APPLICATION" "OCTET-STREAM" ("NAME" "a.bin") NIL NIL "BASE64" 4 NIL ("ATTACHMENT" ("FILENAME" "a.bin"))) "MIXED"))'
const raw = [
  'Message-ID: <cache@test>',
  'Content-Type: multipart/mixed; boundary=boundary',
  '',
  '--boundary',
  'Content-Type: text/plain',
  '',
  'Hello',
  '--boundary',
  'Content-Type: application/octet-stream; name=a.bin',
  'Content-Disposition: attachment; filename=a.bin',
  'Content-Transfer-Encoding: base64',
  '',
  'YWJj',
  '--boundary--',
  ''
].join('\r\n')

describe('mail content cache policy', () => {
  let directory: string
  let accountId: number
  let folderId: number
  let messageId: number
  let imap: {
    selectMailbox: ReturnType<typeof vi.fn>
    fetchMessageHeaders: ReturnType<typeof vi.fn>
    fetchRawMessage: ReturnType<typeof vi.fn>
    fetchBodyStructure: ReturnType<typeof vi.fn>
    fetchBodySection: ReturnType<typeof vi.fn>
    logout: ReturnType<typeof vi.fn>
  }
  let pop: {
    login: ReturnType<typeof vi.fn>
    listUniqueIds: ReturnType<typeof vi.fn>
    listSizes: ReturnType<typeof vi.fn>
    retrieveHeaders: ReturnType<typeof vi.fn>
    retrieve: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'onemail-content-policy-'))
    vi.mocked(app.getPath).mockReturnValue(directory)
    setDatabaseKey('k00000000000000000000000000')
    const path = join(directory, 'test.sqlite')
    setDatabasePath(path)
    initializeDatabase(path)
    accountId = createAccount({
      providerKey: 'test',
      email: 'test@test.com',
      authType: 'manual',
      imapHost: 'imap.test.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls',
      smtpEnabled: false
    }).accountId
    const db = getDatabase()
    folderId = Number(
      db
        .prepare(
          `INSERT INTO onemail_mail_folders
      (account_id, path, name, role, uid_validity, sync_enabled)
      VALUES (:accountId, 'INBOX', 'Inbox', 'inbox', '77', 1)`
        )
        .run({ accountId }).lastInsertRowid
    )
    messageId = Number(
      db
        .prepare(
          `INSERT INTO onemail_mail_messages
      (account_id, folder_id, uid, rfc822_message_id, received_at, download_attachments_separately)
      VALUES (:accountId, :folderId, 1, '<cache@test>', :date, 1)`
        )
        .run({ accountId, folderId, date: new Date().toISOString() }).lastInsertRowid
    )
    imap = {
      selectMailbox: vi.fn(async () => ({ uidValidity: '77' })),
      fetchMessageHeaders: vi.fn(async () => 'Message-ID: <cache@test>\r\n\r\n'),
      fetchRawMessage: vi.fn(async () => raw),
      fetchBodyStructure: vi.fn(async () => structure),
      fetchBodySection: vi.fn(async (_uid: number, section: string) => {
        if (section === '1.MIME') return 'Content-Type: text/plain; charset=utf-8\r\n'
        if (section === '1') return 'Hello'
        if (section === '2.MIME') return 'Content-Transfer-Encoding: base64\r\n'
        if (section === '2') return 'YWJj'
        throw new Error(`Unexpected section ${section}`)
      }),
      logout: vi.fn(async () => undefined)
    }
    pop = {
      login: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
      listUniqueIds: vi.fn(async () => [{ number: 1, uidl: 'pop-one' }]),
      listSizes: vi.fn(async () => new Map([[1, 500]])),
      retrieveHeaders: vi.fn(
        async () => `Date: ${new Date().toUTCString()}\r\nSubject: Test\r\n\r\n`
      ),
      retrieve: vi.fn(async () => `Date: ${new Date().toUTCString()}\r\n${raw}`)
    }
    vi.mocked(SimpleImapSession.connect).mockResolvedValue(imap as unknown as SimpleImapSession)
    vi.mocked(Pop3Session.connect).mockResolvedValue(pop as unknown as Pop3Session)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(directory, { recursive: true, force: true })
  })

  it('fetches only text sections, then caches an explicitly requested attachment', async () => {
    await loadMessageBodyFromImap(messageId)
    expect(imap.fetchRawMessage).not.toHaveBeenCalled()
    expect(imap.fetchBodySection.mock.calls.map((call) => call[1])).toEqual(['1.MIME', '1'])
    const attachment = getMessage(messageId)!.attachments[0]
    expect(attachment.cached).toBe(false)
    expect((await loadAttachmentContent(attachment.attachmentId)).content.toString()).toBe('abc')
    expect(getMessage(messageId)!.attachments[0].cached).toBe(true)
    const callCount = imap.fetchBodySection.mock.calls.length
    await loadAttachmentContent(attachment.attachmentId)
    expect(imap.fetchBodySection).toHaveBeenCalledTimes(callCount)
    expect(
      getDatabase().prepare('SELECT last_user_accessed_at FROM onemail_mail_messages').get()
    ).toEqual({ last_user_accessed_at: null })
  })

  it('does not refetch a ready body or fill attachments after changing the global option', async () => {
    await loadMessageBodyFromImap(messageId)
    updateSettings({ downloadAttachmentsSeparately: false })
    await fillMissingMessageBodies(accountId)
    await loadMessageBodyFromImap(messageId)
    expect(imap.fetchBodyStructure).toHaveBeenCalledTimes(1)
    expect(imap.fetchRawMessage).not.toHaveBeenCalled()
    expect(getMessage(messageId)!.attachments[0].cached).toBe(false)
  })

  it('uses the original full-download policy for old metadata after enabling separation', async () => {
    getDatabase()
      .prepare('UPDATE onemail_mail_messages SET download_attachments_separately = 0')
      .run()
    updateSettings({ downloadAttachmentsSeparately: true })
    await loadMessageBodyFromImap(messageId)
    expect(imap.fetchRawMessage).toHaveBeenCalledTimes(1)
    expect(getMessage(messageId)!.attachments[0].cached).toBe(true)
  })

  it('preserves attachment identity and content when persisting the same message again', async () => {
    persistRawMessageBody(messageId, raw)
    const first = getMessage(messageId)!.attachments[0]
    persistRawMessageBody(messageId, raw)
    expect(getMessage(messageId)!.attachments).toEqual([first])
    expect((await loadAttachmentContent(first.attachmentId)).content.toString()).toBe('abc')
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('does not return the first same-name attachment when reading a legacy cached message', async () => {
    const duplicateRaw = raw.replace(
      '--boundary--',
      [
        '--boundary',
        'Content-Type: application/octet-stream; name=a.bin',
        'Content-Disposition: attachment; filename=a.bin',
        'Content-Transfer-Encoding: base64',
        '',
        'eHl6',
        '--boundary--'
      ].join('\r\n')
    )
    persistRawMessageBody(messageId, duplicateRaw)
    const attachments = getMessage(messageId)!.attachments
    expect(attachments).toHaveLength(2)
    getDatabase().prepare('UPDATE onemail_message_attachments SET part_id = NULL').run()
    expect((await loadAttachmentContent(attachments[1].attachmentId)).content.toString()).toBe(
      'xyz'
    )
    expect((await loadAttachmentContent(attachments[0].attachmentId)).content.toString()).toBe(
      'abc'
    )
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('shares one body fetch between simultaneous requests', async () => {
    await Promise.all([loadMessageBodyFromImap(messageId), loadMessageBodyFromImap(messageId)])
    expect(imap.fetchBodyStructure).toHaveBeenCalledTimes(1)
  })

  it('recovers a cleaned POP3 body using its UIDL instead of IMAP', async () => {
    const db = getDatabase()
    db.prepare(`UPDATE onemail_mail_accounts SET receive_protocol = 'pop3'`).run()
    db.prepare(
      'INSERT INTO onemail_pop3_messages (account_id, uidl, message_id) VALUES (:accountId, :uidl, :messageId)'
    ).run({ accountId, uidl: 'pop-one', messageId })
    await loadMessageBodyFromImap(messageId)
    db.prepare('DELETE FROM onemail_message_bodies WHERE message_id = :messageId').run({
      messageId
    })
    db.prepare(
      `UPDATE onemail_mail_messages SET body_status = 'none' WHERE message_id = :messageId`
    ).run({ messageId })
    await loadMessageBodyFromImap(messageId)
    expect(pop.retrieve).toHaveBeenCalledTimes(2)
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
    expect(getMessage(messageId)!.attachments[0].cached).toBe(true)
  })

  it('does not redownload a cached attachment-only message with an empty body', async () => {
    imap.fetchBodyStructure.mockResolvedValue(
      '* 1 FETCH (BODYSTRUCTURE ("APPLICATION" "PDF" ("NAME" "a.pdf") NIL NIL "BASE64" 4 NIL ("ATTACHMENT" ("FILENAME" "a.pdf"))))'
    )
    await loadMessageBodyFromImap(messageId)
    await loadMessageBodyFromImap(messageId)
    expect(imap.fetchBodyStructure).toHaveBeenCalledTimes(1)
  })

  it('reuses POP3 full MIME even when independent attachment downloads are enabled', async () => {
    getDatabase().prepare(`UPDATE onemail_mail_accounts SET receive_protocol = 'pop3'`).run()
    getDatabase()
      .prepare(
        'INSERT INTO onemail_pop3_messages (account_id, uidl, message_id) VALUES (:accountId, :uidl, :messageId)'
      )
      .run({ accountId, uidl: 'pop-one', messageId })
    await loadMessageBodyFromImap(messageId)
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
    expect(getMessage(messageId)!.attachments[0].cached).toBe(true)
    await loadAttachmentContent(getMessage(messageId)!.attachments[0].attachmentId)
    expect(pop.retrieve).toHaveBeenCalledTimes(1)
  })

  it('uses POP3 headers outside the body range and fills a missing body after expanding it', async () => {
    const db = getDatabase()
    db.exec(
      `DELETE FROM onemail_mail_messages; UPDATE onemail_mail_accounts SET receive_protocol = 'pop3'`
    )
    const date = new Date(Date.now() - 10 * 86400000).toUTCString()
    pop.retrieveHeaders.mockResolvedValue(`Date: ${date}\r\nSubject: Ten days ago\r\n\r\n`)
    pop.retrieve.mockResolvedValue(`Date: ${date}\r\n${raw}`)
    updateSettings({ downloadAttachmentsSeparately: true })
    expect((await syncPop3Account(accountId)).insertedCount).toBe(1)
    expect(pop.retrieve).not.toHaveBeenCalled()
    updateSettings({ syncBodyWindowDays: 14, downloadAttachmentsSeparately: false })
    await syncPop3Account(accountId)
    await syncPop3Account(accountId)
    expect(pop.retrieve).toHaveBeenCalledTimes(1)
    const saved = db
      .prepare<{
        message_id: number
        download_attachments_separately: number
      }>('SELECT message_id, download_attachments_separately FROM onemail_mail_messages')
      .get()!
    expect(saved.download_attachments_separately).toBe(1)
    expect(getMessage(saved.message_id)!.attachments[0].cached).toBe(true)
  })

  it('retains unavoidable POP3 downloads outside metadata range and reuses them after expansion', async () => {
    getDatabase().exec(
      `DELETE FROM onemail_mail_messages; UPDATE onemail_mail_accounts SET receive_protocol = 'pop3'`
    )
    const date = new Date(Date.now() - 50 * 86400000).toUTCString()
    pop.retrieveHeaders.mockResolvedValue(undefined)
    pop.retrieve.mockResolvedValue(`Date: ${date}\r\n${raw}`)
    expect((await syncPop3Account(accountId)).insertedCount).toBe(0)
    expect(pop.retrieve).toHaveBeenCalledTimes(1)
    updateSettings({ syncWindowDays: 60 })
    const result = await syncPop3Account(accountId)
    expect(result.insertedCount).toBe(1)
    expect(result.newMailCount).toBe(0)
    expect(pop.retrieve).toHaveBeenCalledTimes(1)
    const saved = getDatabase()
      .prepare<{ message_id: number }>('SELECT message_id FROM onemail_mail_messages')
      .get()!
    expect(getMessage(saved.message_id)!.attachments[0].cached).toBe(true)
  })
})
