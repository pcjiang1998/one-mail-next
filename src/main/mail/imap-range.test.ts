import { EventEmitter } from 'node:events'
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
vi.mock('../services/network-proxy', () => ({ connectMailSocket: vi.fn() }))
vi.mock('./imap-auth', () => ({ authenticateImapSession: vi.fn() }))
vi.mock('./body-loader', () => ({ loadMessageBodyFromImap: vi.fn() }))

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
import { syncAccountMailbox } from './imap-sync'
import { connectMailSocket } from '../services/network-proxy'
import { loadMessageBodyFromImap } from './body-loader'

describe('IMAP date and cache ranges', () => {
  let directory: string
  let accountId: number
  let commands: string[]
  let uidValidity: string
  let selectedValidity: string | undefined
  let statusUnavailable: boolean
  const ages = [50, 20, 2, 1]
  beforeEach(() => {
    vi.clearAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'onemail-imap-ranges-'))
    vi.mocked(app.getPath).mockReturnValue(directory)
    setDatabaseKey('k00000000000000000000000000')
    const path = join(directory, 'test.sqlite')
    setDatabasePath(path)
    initializeDatabase(path)
    accountId = createAccount({
      providerKey: 'test',
      email: 'user@test.com',
      authType: 'manual',
      imapHost: 'imap.test.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls',
      smtpEnabled: false
    }).accountId
    commands = []
    uidValidity = '77'
    selectedValidity = undefined
    statusUnavailable = false
    vi.mocked(loadMessageBodyFromImap).mockImplementation(async (messageId) => {
      const db = getDatabase()
      db.prepare(
        `INSERT INTO onemail_message_bodies (message_id, body_text) VALUES (:messageId, 'Cached body')`
      ).run({ messageId })
      db.prepare(
        `UPDATE onemail_mail_messages SET body_status = 'ready' WHERE message_id = :messageId`
      ).run({ messageId })
      return { messageId, bodyText: 'Cached body', externalImagesBlocked: true }
    })
    vi.mocked(connectMailSocket).mockImplementation(async () => {
      const socket = new EventEmitter() as EventEmitter & {
        write: (data: string, callback: () => void) => void
        destroy: () => void
      }
      socket.destroy = vi.fn()
      socket.write = (data, callback) => {
        commands.push(data.trim())
        const tag = data.split(' ')[0]
        let response = ''
        if (data.includes('STATUS') && statusUnavailable) {
          callback()
          setTimeout(() => socket.emit('data', Buffer.from(`${tag} NO unavailable\r\n`)), 0)
          return
        }
        if (data.includes('CAPABILITY')) response = '* CAPABILITY IMAP4rev1 IDLE\r\n'
        if (data.includes('STATUS'))
          response = `* STATUS "INBOX" (MESSAGES 4 UNSEEN 2 UIDNEXT 5 UIDVALIDITY ${uidValidity})\r\n`
        if (data.includes('SELECT') && selectedValidity)
          response = `* OK [UIDVALIDITY ${selectedValidity}] selected\r\n`
        if (data.includes('UID SEARCH')) response = '* SEARCH 1 2 3 4\r\n'
        const fetch = /UID FETCH ([\d,]+)/.exec(data)
        if (fetch) {
          response = fetch[1]
            .split(',')
            .map(Number)
            .map((uid) => {
              const date = new Date(Date.now() - ages[uid - 1] * 86400000)
              const flags = uid % 2 ? '\\Seen' : ''
              if (!data.includes('BODY.PEEK'))
                return `* ${uid} FETCH (UID ${uid} FLAGS (${flags}))\r\n`
              const header = `Message-ID: <${uid}@test>\r\nDate: ${date.toUTCString()}\r\nSubject: Message ${uid}\r\nFrom: Sender <sender@test.com>\r\nTo: Receiver <to@test.com>\r\n\r\n`
              return `* ${uid} FETCH (UID ${uid} FLAGS (${flags}) INTERNALDATE "${date.toISOString()}" RFC822.SIZE 100 BODY[HEADER.FIELDS (MESSAGE-ID FROM TO SUBJECT DATE)] {${Buffer.byteLength(header)}}\r\n${header})\r\n`
            })
            .join('')
        }
        callback()
        setTimeout(() => socket.emit('data', Buffer.from(`${response}${tag} OK done\r\n`)), 0)
      }
      setTimeout(() => socket.emit('data', Buffer.from('* OK ready\r\n')), 0)
      return socket as unknown as Awaited<ReturnType<typeof connectMailSocket>>
    })
  })
  afterEach(() => {
    closeDatabase()
    rmSync(directory, { recursive: true, force: true })
  })

  it('filters metadata by exact date, fills read and unread bodies, and preserves recipients', async () => {
    await syncAccountMailbox(accountId, 'initial')
    const db = getDatabase()
    expect(
      db.prepare('SELECT uid, body_status, is_read FROM onemail_mail_messages ORDER BY uid').all()
    ).toEqual([
      { uid: 2, body_status: 'none', is_read: 0 },
      { uid: 3, body_status: 'ready', is_read: 1 },
      { uid: 4, body_status: 'ready', is_read: 0 }
    ])
    expect(loadMessageBodyFromImap).toHaveBeenCalledTimes(2)
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM onemail_message_addresses WHERE kind = 'to' AND email = 'to@test.com'`
        )
        .get()
    ).toEqual({ count: 3 })
    expect(commands.some((command) => /STORE|MOVE|COPY|EXPUNGE|DELETE/.test(command))).toBe(false)
  })

  it.each(['initial', 'refresh'] as const)(
    'stops a %s scan before overwriting cached identities after UIDVALIDITY changes',
    async (mode) => {
      await syncAccountMailbox(accountId, 'initial')
      const db = getDatabase()
      const before = db.prepare('SELECT * FROM onemail_mail_messages ORDER BY message_id').all()
      const folderBefore = db.prepare('SELECT * FROM onemail_mail_folders').all()
      uidValidity = '88'
      await expect(syncAccountMailbox(accountId, mode)).rejects.toThrow('UIDVALIDITY')
      expect(db.prepare('SELECT * FROM onemail_mail_messages ORDER BY message_id').all()).toEqual(
        before
      )
      expect(db.prepare('SELECT uid_validity FROM onemail_mail_folders').get()?.uid_validity).toBe(
        folderBefore[0].uid_validity
      )
      expect(loadMessageBodyFromImap).toHaveBeenCalledTimes(2)
    }
  )

  it('rejects a change between STATUS and SELECT without committing the newer identity', async () => {
    await syncAccountMailbox(accountId, 'initial')
    selectedValidity = '88'
    await expect(syncAccountMailbox(accountId, 'refresh')).rejects.toThrow('UIDVALIDITY')
    expect(getDatabase().prepare('SELECT uid_validity FROM onemail_mail_folders').get()).toEqual({
      uid_validity: '77'
    })
  })

  it('persists the SELECT identity when STATUS is unavailable and rejects later UID reuse', async () => {
    statusUnavailable = true
    selectedValidity = '77'
    await syncAccountMailbox(accountId, 'initial')
    const db = getDatabase()
    expect(db.prepare('SELECT uid_validity FROM onemail_mail_folders').get()).toEqual({
      uid_validity: '77'
    })
    expect(db.prepare('SELECT uid_validity FROM onemail_folder_sync_states').get()).toEqual({
      uid_validity: '77'
    })
    selectedValidity = '88'
    await expect(syncAccountMailbox(accountId, 'refresh')).rejects.toThrow('UIDVALIDITY')
    expect(db.prepare('SELECT uid_validity FROM onemail_mail_folders').get()).toEqual({
      uid_validity: '77'
    })
  })

  it('does not accept new cached identities without any confirmed UIDVALIDITY', async () => {
    statusUnavailable = true
    await expect(syncAccountMailbox(accountId, 'initial')).rejects.toThrow('UIDVALIDITY')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages').get()
    ).toEqual({ count: 0 })
  })

  it('backfills old UIDs after range expansion without marking out-of-range mail missing or refetching ready bodies', async () => {
    await syncAccountMailbox(accountId, 'initial')
    updateSettings({
      syncWindowDays: 60,
      syncBodyWindowDays: 25,
      downloadAttachmentsSeparately: true
    })
    const result = await syncAccountMailbox(accountId, 'refresh')
    expect(result.insertedCount).toBe(1)
    expect(result.newMailCount).toBe(0)
    expect(loadMessageBodyFromImap).toHaveBeenCalledTimes(3)
    const db = getDatabase()
    expect(
      db
        .prepare(
          'SELECT uid, download_attachments_separately FROM onemail_mail_messages ORDER BY uid'
        )
        .all()
    ).toEqual([
      { uid: 1, download_attachments_separately: 1 },
      { uid: 2, download_attachments_separately: 0 },
      { uid: 3, download_attachments_separately: 0 },
      { uid: 4, download_attachments_separately: 0 }
    ])
    updateSettings({ syncWindowDays: 10, syncBodyWindowDays: 7 })
    await syncAccountMailbox(accountId, 'refresh')
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages WHERE remote_missing = 0')
        .get()
    ).toEqual({ count: 4 })
    expect(commands.some((command) => /STORE|MOVE|COPY|EXPUNGE|DELETE/.test(command))).toBe(false)
  })

  it('repairs legacy incomplete headers without replacing a cached body or its search index', async () => {
    await syncAccountMailbox(accountId, 'initial')
    const db = getDatabase()
    db.exec(`UPDATE onemail_mail_messages SET raw_headers = NULL WHERE uid = 3;
      UPDATE onemail_message_search SET body_text = 'Preserved search text'
      WHERE message_id = (SELECT message_id FROM onemail_mail_messages WHERE uid = 3);
      DELETE FROM onemail_message_addresses
      WHERE message_id = (SELECT message_id FROM onemail_mail_messages WHERE uid = 3)`)
    await syncAccountMailbox(accountId, 'refresh')
    expect(loadMessageBodyFromImap).toHaveBeenCalledTimes(2)
    expect(
      db
        .prepare(
          `SELECT body_text FROM onemail_message_search
      WHERE message_id = (SELECT message_id FROM onemail_mail_messages WHERE uid = 3)`
        )
        .get()
    ).toEqual({ body_text: 'Preserved search text' })
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM onemail_message_addresses WHERE kind = 'to'`).get()
    ).toEqual({ count: 3 })
  })
})
