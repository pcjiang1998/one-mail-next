import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { MailSendInput } from '../../shared/types'

const mocks = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sendMail: vi.fn(),
  selectFiles: vi.fn(),
  refreshWatchers: vi.fn(),
  processRules: vi.fn().mockResolvedValue({ completed: 0, skipped: 0, failed: [] })
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(() => mocks.dataDir),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  },
  dialog: { showOpenDialog: mocks.selectFiles, showSaveDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn(() => null) },
  ipcMain: {
    handle: vi.fn((channel, handler) => mocks.handlers.set(channel, handler))
  }
}))
vi.mock('../mail/imap-session', () => ({
  SimpleImapSession: { connect: vi.fn() }
}))
vi.mock('../mail/imap-auth', () => ({ authenticateImapSession: vi.fn() }))
vi.mock('../mail/pop3-session', () => ({
  Pop3Session: { connect: vi.fn() },
  testPop3Connection: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./network-proxy', () => ({
  connectMailSocket: vi.fn(),
  connectMailTunnel: vi.fn()
}))
vi.mock('../mail/sync-body-cache', () => ({ fillMissingMessageBodies: vi.fn() }))
vi.mock('./mailbox-watch', () => ({ refreshMailboxWatchers: mocks.refreshWatchers }))
vi.mock('./add-account-window', () => ({
  openAddAccountWindow: vi.fn(),
  closeAddAccountWindow: vi.fn()
}))
vi.mock('./imap-connection-test', () => ({
  testImapConnection: vi.fn().mockResolvedValue(true),
  testImapOAuthConnection: vi.fn()
}))
vi.mock('./mail-rule-engine.service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  processPendingMailRules: mocks.processRules
}))
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: mocks.sendMail }))
}))

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import type { SqliteRow } from '../db/connection'
import { assertDatabaseIdle } from '../db/activity'
import { upgradeSchema } from '../db/schema-upgrade'
import { createAccount, getAccount } from '../db/repositories/account.repository'
import {
  getMessage,
  listMessages,
  updateMessageReadState
} from '../db/repositories/message.repository'
import { getOutboxRecord } from '../db/repositories/outbox.repository'
import { saveMailRule } from '../db/repositories/mail-rule.repository'
import { createDatabaseSqlBackup, importDatabaseSqlBackupContent } from './database-backup'
import { loadMessageBodyFromImap } from '../mail/body-loader'
import { SimpleImapSession } from '../mail/imap-session'
import {
  moveMessageToTrash,
  permanentlyDeleteMessage,
  restoreMessage
} from '../mail/message-delete'
import { syncAccountMailbox } from '../mail/imap-sync'
import { syncPop3Account } from '../mail/pop3-sync'
import { Pop3Session } from '../mail/pop3-session'
import { connectMailSocket } from './network-proxy'
import { readAccountPassword, saveAccountPassword } from './credential-store'
import { sendPlainTextEmail, retryOutboxEmail } from '../mail/smtp-send'
import { registerAccountIpc } from '../ipc/accounts'
import { registerComposeIpc } from '../ipc/compose'
import { assertTrustedAppFrame } from '../ipc/database-handler'

let accountId: number
let inboxId: number
let trashId: number
let messageId: number
let event: IpcMainInvokeEvent
let session: Record<string, ReturnType<typeof vi.fn>>
const raw = 'Message-ID: <regression@example.test>\r\nContent-Type: text/plain\r\n\r\noriginal-body'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.dataDir = mkdtempSync(join(tmpdir(), 'onemail-review-regression-'))
  setDatabaseKey(`k${Math.floor(Date.now() / 1000) - 60}0123456789abcdef`)
  setDatabasePath(join(mocks.dataDir, 'onemail.sqlite'))
  initializeDatabase()
  const accountInput = {
    providerKey: 'custom',
    email: 'user@example.test',
    password: 'original-password',
    authType: 'password' as const,
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapSecurity: 'ssl_tls' as const,
    smtpHost: 'smtp.example.test',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls' as const
  }
  accountId = createAccount(accountInput).accountId
  saveAccountPassword(accountId, accountInput)
  const db = getDatabase()
  const insertFolder = db.prepare(
    `INSERT INTO onemail_mail_folders (account_id, path, name, role, uid_validity, sync_enabled)
     VALUES (:accountId, :path, :path, :role, '77', 1)`
  )
  inboxId = Number(insertFolder.run({ accountId, path: 'INBOX', role: 'inbox' }).lastInsertRowid)
  trashId = Number(insertFolder.run({ accountId, path: 'Trash', role: 'trash' }).lastInsertRowid)
  messageId = Number(
    db
      .prepare(
        `INSERT INTO onemail_mail_messages
     (account_id, folder_id, uid, rfc822_message_id, subject, raw_headers, received_at)
     VALUES (:accountId, :folderId, 42, '<regression@example.test>', 'original', :raw, :date)`
      )
      .run({ accountId, folderId: inboxId, raw, date: new Date().toISOString() }).lastInsertRowid
  )
  session = {
    selectMailbox: vi.fn().mockResolvedValue({ uidValidity: '77' }),
    fetchMessageHeaders: vi.fn().mockResolvedValue(raw),
    fetchRawMessage: vi.fn().mockResolvedValue(raw),
    capability: vi.fn().mockResolvedValue(new Set(['MOVE', 'UIDPLUS'])),
    uidMove: vi.fn().mockResolvedValue(901),
    searchByMessageId: vi.fn().mockResolvedValue([901]),
    setDeletedFlag: vi.fn().mockResolvedValue(undefined),
    uidExpunge: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue(undefined),
    identifyClient: vi.fn().mockResolvedValue(undefined),
    listMailboxes: vi.fn().mockResolvedValue([
      { path: 'INBOX', name: 'Inbox', role: 'inbox', selectable: true, attributes: [] },
      { path: 'Archive', name: 'Archive', role: 'archive', selectable: true, attributes: [] }
    ]),
    logout: vi.fn().mockResolvedValue(undefined)
  }
  vi.mocked(SimpleImapSession.connect).mockResolvedValue(session as unknown as SimpleImapSession)
  const frame = { url: pathToFileURL(resolve(__dirname, '../renderer/index.html')).href }
  event = { sender: { mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
})

afterEach(() => {
  expect(() => assertDatabaseIdle()).not.toThrow()
  closeDatabase()
  vi.restoreAllMocks()
})

function identity(): SqliteRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT folder_id, uid, user_hidden, user_deleted, remote_deleted, remote_missing,
            is_read, read_state_revision, state_revision
     FROM onemail_mail_messages WHERE message_id = :messageId`
    )
    .get({ messageId })
}

function sendInput(): MailSendInput {
  return { accountId, mode: 'new', to: [{ email: 'recipient@example.test' }], bodyText: 'fixture' }
}

function fakeImap(
  uids: number[],
  beforeFlags?: () => void | Promise<void>,
  options: { allUids?: number[]; beforeHeaders?: () => void | Promise<void> } = {}
): void {
  vi.mocked(connectMailSocket).mockImplementation(async () => {
    const socket = new EventEmitter() as EventEmitter & {
      write: (data: string, callback: () => void) => void
      destroy: () => void
    }
    socket.destroy = vi.fn()
    socket.write = (data, callback) => {
      const tag = data.split(' ')[0]
      let response = ''
      if (data.includes('CAPABILITY')) response = '* CAPABILITY IMAP4rev1\r\n'
      if (data.includes('STATUS')) {
        response = `* STATUS "INBOX" (MESSAGES ${uids.length} UNSEEN 0 UIDNEXT 2000 UIDVALIDITY 77)\r\n`
      }
      if (data.includes('SELECT')) response = '* OK [UIDVALIDITY 77]\r\n'
      if (data.includes('UID SEARCH')) response = `* SEARCH ${uids.join(' ')}\r\n`
      if (data.includes('UID SEARCH ALL')) {
        response = `* SEARCH ${(options.allUids ?? uids).join(' ')}\r\n`
      }
      const fetchUids = data
        .match(/UID FETCH (\S+)/)?.[1]
        ?.split(',')
        .map(Number)
      if (fetchUids) {
        response = fetchUids
          .map((uid, index) => {
            if (!data.includes('BODY.PEEK')) return `* ${index + 1} FETCH (UID ${uid} FLAGS ())\r\n`
            const header = `Message-ID: <new-${uid}@example.test>\r\nSubject: new\r\nDate: ${new Date().toUTCString()}\r\n\r\n`
            return `* ${index + 1} FETCH (UID ${uid} FLAGS () RFC822.SIZE 100 BODY[HEADER.FIELDS (MESSAGE-ID FROM TO CC REPLY-TO SUBJECT DATE REFERENCES IN-REPLY-TO)] {${Buffer.byteLength(header)}}\r\n${header})\r\n`
          })
          .join('')
      }
      callback()
      setTimeout(() => {
        void (async () => {
          if (fetchUids && !data.includes('BODY.PEEK') && beforeFlags) await beforeFlags()
          if (fetchUids && data.includes('BODY.PEEK')) await options.beforeHeaders?.()
          socket.emit('data', Buffer.from(`${response}${tag} OK done\r\n`))
        })()
      }, 0)
    }
    setTimeout(() => socket.emit('data', Buffer.from('* OK ready\r\n')), 0)
    return socket as unknown as Awaited<ReturnType<typeof connectMailSocket>>
  })
}

describe('review regression coverage', () => {
  it('R1 rejects restore while a body load is pending and releases the lease afterward', async () => {
    const backup = createDatabaseSqlBackup()
    let resolveRaw!: (value: string) => void
    const pending = loadMessageBodyFromImap(
      messageId,
      () =>
        new Promise((resolve) => {
          resolveRaw = resolve
        })
    )
    expect(() => importDatabaseSqlBackupContent(backup.sql, backup.fileName)).toThrow(
      '任务仍在执行'
    )
    resolveRaw(raw)
    await pending
    expect(importDatabaseSqlBackupContent(backup.sql, backup.fileName).imported).toBe(true)
    expect(getMessage(messageId)?.body).toBeUndefined()
  })

  it('R1 blocks restore until SMTP and its bookkeeping complete', async () => {
    const backup = createDatabaseSqlBackup()
    let finishSend!: (value: { messageId: string }) => void
    mocks.sendMail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSend = resolve
        })
    )
    const pending = sendPlainTextEmail(sendInput())
    await vi.waitFor(() => expect(mocks.sendMail).toHaveBeenCalledOnce())
    expect(() => importDatabaseSqlBackupContent(backup.sql, backup.fileName)).toThrow(
      '任务仍在执行'
    )
    finishSend({ messageId: 'sent' })
    await pending
    expect(importDatabaseSqlBackupContent(backup.sql, backup.fileName).imported).toBe(true)
  })

  it('R2 rejects unselected file paths for sending and saving drafts', async () => {
    registerComposeIpc()
    const input = {
      ...sendInput(),
      attachments: [{ filePath: join(process.cwd(), 'package.json') }]
    }
    await expect(mocks.handlers.get('compose/send')!(event, input)).rejects.toThrow('未经授权')
    await expect(mocks.handlers.get('compose/saveDraft')!(event, input)).rejects.toThrow('未经授权')
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it('R2 accepts native selections and persisted draft attachments after a window reload', async () => {
    registerComposeIpc()
    const filePath = join(process.cwd(), 'package.json')
    mocks.selectFiles.mockResolvedValueOnce({ canceled: false, filePaths: [filePath] })
    const attachments = await mocks.handlers.get('compose/selectAttachments')!(event)
    const draft = (await mocks.handlers.get('compose/saveDraft')!(event, {
      ...sendInput(),
      attachments
    })) as { outboxId: number }
    mocks.sendMail.mockResolvedValueOnce({ messageId: 'sent' })
    const nextFrame = event.senderFrame!
    const reloadedEvent = { sender: { mainFrame: nextFrame }, senderFrame: nextFrame }
    await mocks.handlers.get('compose/send')!(reloadedEvent, {
      ...sendInput(),
      outboxId: draft.outboxId,
      attachments
    })
    expect(mocks.sendMail.mock.calls[0][0].raw.replace(/\r\n/g, '')).toContain(
      readFileSync(filePath).toString('base64')
    )
  })

  it('R2 rejects external pages and subframes before dispatch', () => {
    const foreign = { url: 'https://external.example.test/' }
    expect(() =>
      assertTrustedAppFrame({
        sender: { mainFrame: foreign },
        senderFrame: foreign
      } as unknown as IpcMainInvokeEvent)
    ).toThrow('不允许')
    expect(() =>
      assertTrustedAppFrame({
        sender: event.sender,
        senderFrame: { url: event.senderFrame!.url }
      } as unknown as IpcMainInvokeEvent)
    ).toThrow('不允许')
  })

  it('R2 invalidates selected-file grants after database restore', async () => {
    registerComposeIpc()
    const backup = createDatabaseSqlBackup()
    mocks.selectFiles.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join(process.cwd(), 'package.json')]
    })
    const attachments = await mocks.handlers.get('compose/selectAttachments')!(event)
    importDatabaseSqlBackupContent(backup.sql, backup.fileName)
    await expect(
      mocks.handlers.get('compose/send')!(event, {
        ...sendInput(),
        attachments
      })
    ).rejects.toThrow('未经授权')
  })

  it('R3 stores the destination folder and UID when restoring Trash mail', async () => {
    getDatabase()
      .prepare(
        'UPDATE onemail_mail_messages SET folder_id = :trashId, user_hidden = 1, user_deleted = 1'
      )
      .run({ trashId })
    await restoreMessage(messageId)
    expect(identity()).toMatchObject({
      folder_id: inboxId,
      uid: 901,
      user_hidden: 0,
      user_deleted: 0
    })
  })

  it('R3 resolves the destination by verified Message-ID when COPYUID is absent', async () => {
    session.uidMove.mockResolvedValueOnce(undefined)
    await moveMessageToTrash(messageId)
    expect(identity()).toMatchObject({ folder_id: trashId, uid: 901, user_deleted: 1 })
    session.uidMove.mockResolvedValueOnce(902)
    await restoreMessage(messageId)
    expect(identity()).toMatchObject({ folder_id: inboxId, uid: 902, user_hidden: 0 })
  })

  it('R3 makes an ambiguous post-MOVE identity unavailable instead of claiming restoration', async () => {
    session.uidMove.mockResolvedValueOnce(undefined)
    session.searchByMessageId.mockResolvedValueOnce([901, 902])
    await expect(moveMessageToTrash(messageId)).rejects.toThrow('目标 UID 未能确认')
    expect(identity()?.remote_missing).toBe(1)
  })

  it('R3 does not issue another remote MOVE when a rule retries an already moved message', async () => {
    await moveMessageToTrash(messageId)
    await moveMessageToTrash(messageId)
    expect(session.uidMove).toHaveBeenCalledOnce()
  })

  it('R4 refresh marks remote absence and keeps the local copy', async () => {
    fakeImap([])
    await syncAccountMailbox(accountId, 'refresh')
    expect(identity()?.remote_missing).toBe(1)
    expect(listMessages().map((message) => message.messageId)).toContain(messageId)
  })

  it('R4 does not classify mail outside the date window as missing when SEARCH ALL still finds it', async () => {
    fakeImap([], undefined, { allUids: [42] })
    await syncAccountMailbox(accountId, 'refresh')
    expect(identity()?.remote_missing).toBe(0)
  })

  it('R5 old flags cannot overwrite a newer local read operation', async () => {
    fakeImap([42], () => {
      updateMessageReadState(messageId, true)
    })
    await syncAccountMailbox(accountId, 'refresh')
    expect(identity()).toMatchObject({ is_read: 1, read_state_revision: 1 })
  })

  it('R5 old flags cannot resurrect a permanently deleted local entry', async () => {
    fakeImap([42], async () => {
      await permanentlyDeleteMessage(messageId)
    })
    await syncAccountMailbox(accountId, 'refresh')
    expect(session.uidExpunge).toHaveBeenCalledWith(42)
    expect(identity()?.remote_deleted).toBe(1)
    expect(listMessages()).toEqual([])
  })

  it('R5 old headers cannot recreate the source entry after a local MOVE', async () => {
    getDatabase().exec('UPDATE onemail_mail_messages SET raw_headers = NULL')
    fakeImap([42], undefined, {
      beforeHeaders: async () => {
        await moveMessageToTrash(messageId)
      }
    })
    await syncAccountMailbox(accountId, 'refresh')
    expect(identity()).toMatchObject({ folder_id: trashId, uid: 901 })
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages').get()?.count
    ).toBe(1)
  })

  it('R6 blocks both retry and compose/send for unknown delivery outcomes', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('Final SMTP response lost'))
    await expect(sendPlainTextEmail(sendInput())).rejects.toThrow('投递结果未知')
    const outboxId = Number(
      getDatabase().prepare('SELECT outbox_id FROM onemail_outbox_messages').get()?.outbox_id
    )
    expect(getOutboxRecord(outboxId)?.deliveryUncertain).toBe(true)
    await expect(retryOutboxEmail(outboxId)).rejects.toThrow('不能直接重试')
    await expect(sendPlainTextEmail({ ...sendInput(), outboxId })).rejects.toThrow('不能重新发送')
    expect(mocks.sendMail).toHaveBeenCalledOnce()
  })

  it('R6 still permits retry after an explicit SMTP rejection', async () => {
    mocks.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Rejected'), { responseCode: 550 })
    )
    await expect(sendPlainTextEmail(sendInput())).rejects.toThrow('Rejected')
    const outboxId = Number(
      getDatabase().prepare('SELECT outbox_id FROM onemail_outbox_messages').get()?.outbox_id
    )
    expect(getOutboxRecord(outboxId)?.deliveryUncertain).toBe(false)
    mocks.sendMail.mockResolvedValueOnce({ messageId: 'sent' })
    await retryOutboxEmail(outboxId)
    expect(getOutboxRecord(outboxId)?.status).toBe('sent')
  })

  it('R6 preserves unknown delivery after restart and upgrades legacy failures conservatively', () => {
    const db = getDatabase()
    db.exec(`INSERT INTO onemail_outbox_messages
      (account_id, compose_kind, status, rfc822_message_id, from_email)
      VALUES (${accountId}, 'new', 'sending', '<interrupted>', 'user@example.test')`)
    upgradeSchema(db)
    expect(getOutboxRecord(1)).toMatchObject({ status: 'failed', deliveryUncertain: true })
    db.exec('ALTER TABLE onemail_outbox_messages DROP COLUMN delivery_uncertain')
    upgradeSchema(db)
    expect(getOutboxRecord(1)?.deliveryUncertain).toBe(true)
  })

  it('R7 performs remote folder discovery before any account changes', async () => {
    registerAccountIpc()
    session.listMailboxes.mockRejectedValueOnce(new Error('LIST failed'))
    const oldLabel = getAccount(accountId)!.accountLabel
    await expect(
      mocks.handlers.get('accounts/update')!(event, {
        accountId,
        accountLabel: 'not-committed',
        selectedFolderPaths: ['INBOX']
      })
    ).rejects.toThrow('LIST failed')
    expect(getAccount(accountId)?.accountLabel).toBe(oldLabel)
    expect(mocks.refreshWatchers).not.toHaveBeenCalled()
  })

  it('R7 rolls back account, password and IDLE updates if the local folder commit fails', async () => {
    registerAccountIpc()
    getDatabase().exec(`CREATE TRIGGER reject_archive BEFORE INSERT ON onemail_mail_folders
      WHEN NEW.path = 'Archive' BEGIN SELECT RAISE(ABORT, 'folder commit rejected'); END`)
    await expect(
      mocks.handlers.get('accounts/update')!(event, {
        accountId,
        imapHost: 'new.example.test',
        password: 'new-password',
        selectedFolderPaths: ['INBOX', 'Archive']
      })
    ).rejects.toThrow('folder commit rejected')
    expect(getAccount(accountId)).toMatchObject({
      imapHost: 'imap.example.test',
      idleSupported: undefined
    })
    expect(readAccountPassword(accountId)).toBe('original-password')
    expect(session.login).toHaveBeenCalledWith('user@example.test', 'new-password')
  })

  function prepareNewMail(): void {
    const db = getDatabase()
    db.exec('DELETE FROM onemail_mail_messages')
    db.prepare('UPDATE onemail_mail_accounts SET last_sync_at = :time').run({
      time: new Date(Date.now() - 86400000).toISOString()
    })
    db.prepare(
      `INSERT INTO onemail_folder_sync_states (account_id, folder_id, last_uid, uid_validity)
       VALUES (:accountId, :inboxId, 1, '77')`
    ).run({ accountId, inboxId })
    saveMailRule({
      name: 'new mail',
      enabled: true,
      sortOrder: 0,
      conditions: [{ field: 'subject', operator: 'contains', value: 'new' }],
      actions: [{ type: 'add_to_board' }]
    })
  }

  it('R8 commits rules for all 1001 new messages in the same sync transaction', async () => {
    prepareNewMail()
    fakeImap(Array.from({ length: 1001 }, (_, index) => index + 2))
    expect((await syncAccountMailbox(accountId, 'refresh')).insertedCount).toBe(1001)
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_rule_executions').get()?.count
    ).toBe(1001)
    await syncAccountMailbox(accountId, 'refresh')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_rule_executions').get()?.count
    ).toBe(1001)
  })

  it('R8 rolls back mail insertion when durable rule admission fails', async () => {
    prepareNewMail()
    getDatabase().exec(`CREATE TRIGGER reject_rule BEFORE INSERT ON onemail_rule_executions
      BEGIN SELECT RAISE(ABORT, 'rule admission rejected'); END`)
    fakeImap([2])
    await expect(syncAccountMailbox(accountId, 'refresh')).rejects.toThrow(
      'rule admission rejected'
    )
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages').get()?.count
    ).toBe(0)
  })

  it('R8 skips historical IMAP admission during initial sync', async () => {
    prepareNewMail()
    fakeImap([2])
    await syncAccountMailbox(accountId, 'initial')
    expect(
      getDatabase().prepare('SELECT COUNT(*) AS count FROM onemail_rule_executions').get()?.count
    ).toBe(0)
  })

  it.each([false, true])('R8 POP3 admission is atomic when admission failure=%s', async (fail) => {
    prepareNewMail()
    const db = getDatabase()
    db.exec("UPDATE onemail_mail_accounts SET receive_protocol = 'pop3'")
    const source = `Message-ID: <pop-new@example.test>\r\nSubject: new\r\nDate: ${new Date().toUTCString()}\r\n\r\nbody`
    vi.mocked(Pop3Session.connect).mockResolvedValue({
      login: vi.fn().mockResolvedValue(undefined),
      listUniqueIds: vi.fn().mockResolvedValue([{ number: 1, uidl: 'new-uidl' }]),
      listSizes: vi.fn().mockResolvedValue(new Map([[1, 100]])),
      retrieveHeaders: vi.fn().mockResolvedValue(source),
      retrieve: vi.fn().mockResolvedValue(source),
      quit: vi.fn().mockResolvedValue(undefined)
    } as unknown as Pop3Session)
    if (fail) {
      db.exec(`CREATE TRIGGER reject_pop_rule BEFORE INSERT ON onemail_rule_executions
        BEGIN SELECT RAISE(ABORT, 'POP3 admission rejected'); END`)
      await expect(syncPop3Account(accountId)).rejects.toThrow('POP3 admission rejected')
    } else {
      expect((await syncPop3Account(accountId)).insertedCount).toBe(1)
    }
    for (const table of [
      'onemail_mail_messages',
      'onemail_pop3_messages',
      'onemail_rule_executions'
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(fail ? 0 : 1)
    }
  })

  it.each(['VACUUM INTO', '/* hidden */ VACUUM main INTO', 'EXPLAIN VACUUM INTO'])(
    'S2 rejects %s before creating a file',
    (statement) => {
      const backup = createDatabaseSqlBackup()
      const output = join(mocks.dataDir, 'should-not-exist.sqlite')
      const sql = `${backup.sql}\n${statement} '${output.replace(/'/g, "''")}';`
      expect(() => importDatabaseSqlBackupContent(sql, backup.fileName)).toThrow('VACUUM')
      expect(existsSync(output)).toBe(false)
      expect(getAccount(accountId)?.email).toBe('user@example.test')
    }
  )
})
