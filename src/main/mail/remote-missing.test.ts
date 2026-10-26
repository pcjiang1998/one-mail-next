import { mkdtempSync } from 'node:fs'
import { EventEmitter } from 'node:events'
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
vi.mock('./imap-session', () => ({
  SimpleImapSession: { connect: vi.fn() }
}))
vi.mock('./imap-auth', () => ({ authenticateImapSession: vi.fn() }))
vi.mock('../services/network-proxy', () => ({ connectMailSocket: vi.fn() }))

import { app } from 'electron'
import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import { upgradeSchema } from '../db/schema-upgrade'
import { createAccount } from '../db/repositories/account.repository'
import {
  getMessage,
  getMessageComposeSource,
  getMessageReadStateTarget,
  listMessages,
  markMessageRemoteMissing,
  updateMessageReadState
} from '../db/repositories/message.repository'
import {
  createRemoteWriteback,
  getRemoteWriteback,
  listRemoteWritebacks,
  updateRemoteWritebackStatus
} from '../db/repositories/remote-writeback.repository'
import { retryWriteback } from '../services/remote-writeback.service'
import { SimpleImapSession } from './imap-session'
import { syncMessageReadState, syncMessagesReadState } from './read-state-sync'
import { loadMessageBodyFromImap, persistRawMessageBody } from './body-loader'
import { loadAttachmentContent } from './attachment-downloader'
import { permanentlyDeleteMessage } from './message-delete'
import { createBulkForwardDraft } from './bulk-forward-draft'
import { syncAccountMailbox } from './imap-sync'
import { connectMailSocket } from '../services/network-proxy'

const rawMessage = 'Message-ID: <test@example.com>\r\nContent-Type: text/plain\r\n\r\nCached body'

describe('messages whose original remote UID is missing', () => {
  let accountId: number
  let folderId: number
  let messageId: number
  let session: {
    selectMailbox: ReturnType<typeof vi.fn>
    fetchRawMessage: ReturnType<typeof vi.fn>
    setSeenFlag: ReturnType<typeof vi.fn>
    logout: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-remote-missing-'))
    vi.mocked(app.getPath).mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
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
    const db = getDatabase()
    folderId = Number(
      db
        .prepare(
          `INSERT INTO onemail_mail_folders (account_id, path, name, role, uid_validity)
         VALUES (:accountId, 'INBOX', 'Inbox', 'inbox', '77')`
        )
        .run({ accountId }).lastInsertRowid
    )
    messageId = insertMessage(42)
    session = {
      selectMailbox: vi.fn().mockResolvedValue({ uidValidity: '77' }),
      fetchRawMessage: vi.fn().mockResolvedValue(''),
      setSeenFlag: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined)
    }
    vi.mocked(SimpleImapSession.connect)
      .mockReset()
      .mockResolvedValue(session as unknown as SimpleImapSession)
  })

  afterEach(() => closeDatabase())

  function insertMessage(uid: number): number {
    return Number(
      getDatabase()
        .prepare(
          `INSERT INTO onemail_mail_messages
         (account_id, folder_id, uid, subject, rfc822_message_id)
         VALUES (:accountId, :folderId, :uid, 'Test', '<test@example.com>')`
        )
        .run({ accountId, folderId, uid }).lastInsertRowid
    )
  }

  it('marks the local copy read, keeps it visible and terminates the writeback', async () => {
    expect(await syncMessageReadState(messageId, true)).toMatchObject({
      isRead: true,
      remoteMissing: true
    })
    expect(listMessages().map((message) => message.messageId)).toContain(messageId)
    expect(getMessage(messageId)).toMatchObject({ isRead: true, remoteMissing: true })
    expect(listRemoteWritebacks()).toEqual([
      expect.objectContaining({
        status: 'cancelled',
        errorMessage: expect.stringContaining('仅在本地保留')
      })
    ])
    expect(session.setSeenFlag).not.toHaveBeenCalled()
    await syncMessageReadState(messageId, false)
    await syncMessageReadState(messageId, true)
    expect(SimpleImapSession.connect).toHaveBeenCalledOnce()
    expect(listRemoteWritebacks()).toHaveLength(1)
  })

  it.each(['network', 'uidvalidity', 'identity'])(
    'does not classify a %s error as remote absence',
    async (failure) => {
      if (failure === 'network') session.fetchRawMessage.mockRejectedValue(new Error('timeout'))
      if (failure === 'uidvalidity') session.selectMailbox.mockResolvedValue({ uidValidity: '88' })
      if (failure === 'identity') {
        session.fetchRawMessage.mockResolvedValue('Message-ID: <other@example.com>\r\n\r\nbody')
      }
      await expect(syncMessageReadState(messageId, true)).rejects.toThrow()
      expect(getMessageReadStateTarget(messageId)).toMatchObject({
        isRead: false,
        remoteMissing: false
      })
      expect(listRemoteWritebacks()[0].status).toBe('failed')
    }
  )

  it('handles a batch of missing, present and failed messages independently', async () => {
    const presentId = insertMessage(43)
    const failedId = insertMessage(44)
    session.fetchRawMessage.mockImplementation(async (uid: number) => {
      if (uid === 42) return ''
      if (uid === 43) return rawMessage
      throw new Error('timeout')
    })
    const result = await syncMessagesReadState([messageId, presentId, failedId], true)
    expect(result.succeededMessageIds).toEqual([messageId, presentId])
    expect(result.failedItems).toEqual([{ messageId: failedId, accountId, error: 'timeout' }])
    expect(session.setSeenFlag).toHaveBeenCalledExactlyOnceWith(43, true)
    expect(getMessageReadStateTarget(messageId)?.remoteMissing).toBe(true)
    expect(getMessageReadStateTarget(failedId)?.remoteMissing).toBe(false)
  })

  it('reads cached content without opening a remote connection', async () => {
    persistRawMessageBody(messageId, rawMessage)
    markMessageRemoteMissing(messageId)
    expect(await loadMessageBodyFromImap(messageId)).toMatchObject({ bodyText: 'Cached body' })
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('parses locally cached raw MIME even when the remote message is missing', async () => {
    getDatabase()
      .prepare(
        'INSERT INTO onemail_message_bodies (message_id, raw_source) VALUES (:messageId, :rawSource)'
      )
      .run({ messageId, rawSource: rawMessage })
    markMessageRemoteMissing(messageId)
    expect(await loadMessageBodyFromImap(messageId)).toMatchObject({ bodyText: 'Cached body' })
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('reports an unavailable uncached body and does not reconnect on subsequent loads', async () => {
    await expect(loadMessageBodyFromImap(messageId)).rejects.toThrow('本地未缓存正文')
    expect(getMessage(messageId)).toMatchObject({
      remoteMissing: true,
      bodyStatus: 'error',
      bodyError: expect.stringContaining('本地未缓存正文')
    })
    await expect(loadMessageBodyFromImap(messageId)).rejects.toThrow('本地未缓存正文')
    expect(SimpleImapSession.connect).toHaveBeenCalledOnce()
  })

  it('allows cached attachments but stops remote downloads for uncached attachments', async () => {
    persistRawMessageBody(
      messageId,
      [
        'Message-ID: <test@example.com>',
        'Content-Type: multipart/mixed; boundary="parts"',
        '',
        '--parts',
        'Content-Type: text/plain',
        '',
        'Cached body',
        '--parts',
        'Content-Type: text/plain; name="report.txt"',
        'Content-Disposition: attachment; filename="report.txt"',
        '',
        'report',
        '--parts--'
      ].join('\r\n')
    )
    markMessageRemoteMissing(messageId)
    const attachmentId = getMessage(messageId)!.attachments[0].attachmentId
    expect((await loadAttachmentContent(attachmentId)).content.toString()).toBe('report')
    getDatabase()
      .prepare('UPDATE onemail_message_bodies SET raw_source = NULL WHERE message_id = :messageId')
      .run({ messageId })
    await expect(loadAttachmentContent(attachmentId)).rejects.toThrow('本地未缓存该附件')
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('ends a manual flag retry as cancelled when absence is confirmed', async () => {
    const writeback = createRemoteWriteback({
      accountId,
      messageId,
      operationKind: 'mark_read',
      payload: { folderId, folderPath: 'INBOX', uid: 42, uidValidity: '77' }
    })
    updateRemoteWritebackStatus(writeback.writebackId, 'running')
    updateRemoteWritebackStatus(writeback.writebackId, 'failed', 'timeout')
    await retryWriteback(writeback.writebackId)
    expect(getRemoteWriteback(writeback.writebackId)?.status).toBe('cancelled')
    expect(getMessageReadStateTarget(messageId)).toMatchObject({
      isRead: true,
      remoteMissing: true
    })
  })

  it('does not apply an older retry intent after a newer read operation succeeds', async () => {
    const writeback = createRemoteWriteback({
      accountId,
      messageId,
      operationKind: 'mark_unread',
      payload: { folderId, folderPath: 'INBOX', uid: 42, uidValidity: '77' }
    })
    updateRemoteWritebackStatus(writeback.writebackId, 'running')
    updateRemoteWritebackStatus(writeback.writebackId, 'failed', 'timeout')
    session.fetchRawMessage.mockImplementation(async () => {
      const newer = createRemoteWriteback({ accountId, messageId, operationKind: 'mark_read' })
      updateRemoteWritebackStatus(newer.writebackId, 'running')
      updateRemoteWritebackStatus(newer.writebackId, 'success')
      updateMessageReadState(messageId, true)
      return ''
    })
    await retryWriteback(writeback.writebackId)
    expect(getMessageReadStateTarget(messageId)?.isRead).toBe(true)
    expect(getRemoteWriteback(writeback.writebackId)?.status).toBe('cancelled')
  })

  it.each(['single', 'bulk'])(
    'preserves a newer %s local-only read operation without a new writeback record',
    async (mode) => {
      const writeback = createRemoteWriteback({
        accountId,
        messageId,
        operationKind: 'mark_unread',
        payload: { folderId, folderPath: 'INBOX', uid: 42, uidValidity: '77' }
      })
      updateRemoteWritebackStatus(writeback.writebackId, 'running')
      updateRemoteWritebackStatus(writeback.writebackId, 'failed', 'timeout')
      session.fetchRawMessage.mockImplementation(async () => {
        markMessageRemoteMissing(messageId)
        if (mode === 'single') await syncMessageReadState(messageId, true)
        else await syncMessagesReadState([messageId], true)
        expect(listRemoteWritebacks()).toHaveLength(1)
        return ''
      })
      await retryWriteback(writeback.writebackId)
      expect(getMessageReadStateTarget(messageId)).toMatchObject({
        isRead: true,
        remoteMissing: true,
        readStateRevision: 1
      })
      expect(getRemoteWriteback(writeback.writebackId)?.status).toBe('cancelled')
    }
  )

  it('lets the user delete a local-only copy without touching the server', async () => {
    markMessageRemoteMissing(messageId)
    expect(await permanentlyDeleteMessage(messageId)).toMatchObject({ localOnly: true })
    expect(listMessages()).toEqual([])
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('does not request an uncached original MIME again when forwarding a local copy', async () => {
    markMessageRemoteMissing(messageId)
    expect(getMessageComposeSource(messageId)?.remoteMissing).toBe(true)
    await expect(createBulkForwardDraft([messageId])).rejects.toThrow('本地未缓存原始邮件')
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('forwards cached original MIME without reconnecting', async () => {
    persistRawMessageBody(messageId, rawMessage)
    markMessageRemoteMissing(messageId)
    const draft = await createBulkForwardDraft([messageId])
    expect(draft.attachments).toEqual([
      expect.objectContaining({
        mimeType: 'message/rfc822',
        sizeBytes: Buffer.byteLength(rawMessage)
      })
    ])
    expect(SimpleImapSession.connect).not.toHaveBeenCalled()
  })

  it('excludes retained missing UIDs from the incremental sync cursor and includes their counts', async () => {
    const db = getDatabase()
    db.prepare('UPDATE onemail_mail_messages SET uid = 1000 WHERE message_id = :messageId').run({
      messageId
    })
    const presentId = insertMessage(1)
    db.prepare('UPDATE onemail_mail_messages SET is_read = 1 WHERE message_id = :messageId').run({
      messageId: presentId
    })
    const commands: string[] = []
    let uidNext = 2
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
        if (data.includes('CAPABILITY')) response = '* CAPABILITY IMAP4rev1\r\n'
        if (data.includes('STATUS')) {
          response = `* STATUS "INBOX" (MESSAGES 1 UNSEEN 0 UIDNEXT ${uidNext} UIDVALIDITY 88)\r\n`
        }
        if (data.includes('UID SEARCH ALL')) response = '* SEARCH 1\r\n'
        else if (data.includes('UID SEARCH')) response = '* SEARCH\r\n'
        if (data.includes('UID FETCH')) response = '* 1 FETCH (UID 1 FLAGS (\\Seen))\r\n'
        callback()
        setTimeout(() => socket.emit('data', Buffer.from(`${response}${tag} OK done\r\n`)), 0)
      }
      setTimeout(() => socket.emit('data', Buffer.from('* OK ready\r\n')), 0)
      return socket as unknown as Awaited<ReturnType<typeof connectMailSocket>>
    })
    await syncAccountMailbox(accountId, 'initial')
    expect(getMessage(messageId)?.remoteMissing).toBe(true)
    expect(listMessages()).toHaveLength(2)
    expect(
      db
        .prepare('SELECT last_uid FROM onemail_folder_sync_states WHERE folder_id = :folderId')
        .get({ folderId })
    ).toEqual({ last_uid: 1 })
    expect(
      db
        .prepare(
          'SELECT total_count, unread_count FROM onemail_mail_folders WHERE folder_id = :folderId'
        )
        .get({ folderId })
    ).toEqual({ total_count: 2, unread_count: 1 })
    uidNext = 3
    const fullScanCommandCount = commands.length
    await syncAccountMailbox(accountId, 'refresh')
    expect(commands.some((command) => command.includes('UID SEARCH UID 2:2'))).toBe(true)
    expect(
      commands
        .slice(fullScanCommandCount)
        .filter((command) => command.includes('UID FETCH'))
        .every((command) => !command.includes('1000'))
    ).toBe(true)
  })

  it('recovers copies hidden by legacy full scans without restoring deliberate deletions', () => {
    const deletedId = insertMessage(43)
    const db = getDatabase()
    db.prepare(
      `UPDATE onemail_mail_messages SET remote_deleted = 1,
       is_deleted = CASE WHEN message_id = :deletedId THEN 1 ELSE 0 END`
    ).run({ deletedId })
    const writeback = createRemoteWriteback({ accountId, messageId, operationKind: 'mark_read' })
    updateRemoteWritebackStatus(writeback.writebackId, 'running')
    updateRemoteWritebackStatus(writeback.writebackId, 'failed', 'missing UID')
    db.exec('ALTER TABLE onemail_mail_messages DROP COLUMN remote_missing')
    upgradeSchema(db)
    expect(listMessages().map((message) => message.messageId)).toEqual([messageId])
    expect(getMessage(messageId)?.remoteMissing).toBe(true)
    expect(getRemoteWriteback(writeback.writebackId)?.status).toBe('cancelled')
    upgradeSchema(db)
    expect(listMessages()).toHaveLength(1)
  })
})
