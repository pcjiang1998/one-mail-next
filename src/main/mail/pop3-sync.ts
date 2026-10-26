import { createHash } from 'node:crypto'
import { getAccount } from '../db/repositories/account.repository'
import { getSettings } from '../db/repositories/settings.repository'
import { getDatabase, type SqliteParams } from '../db/connection'
import { readAccountPassword } from '../services/credential-store'
import { normalizeMailDisplayText } from '../../shared/mail-text'
import { loadMessageBodyFromImap, persistRawMessageBody } from './body-loader'
import { Pop3Session } from './pop3-session'
import { syncCutoff } from '../../shared/sync-range'
import { withAccountCacheAccess } from '../services/cache-activity'
import { enqueueMailRulesForNewMessages } from '../services/mail-rule-engine.service'

export type Pop3SyncStats = {
  scannedCount: number
  insertedCount: number
  updatedCount: number
  newMailCount: number
}

type ParsedHeader = {
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  messageId?: string
  to: ParsedAddress[]
  cc: ParsedAddress[]
  replyTo: ParsedAddress[]
}

type ParsedAddress = { name?: string; email: string }

export function syncPop3Account(accountId: number, initialSync = false): Promise<Pop3SyncStats> {
  return withAccountCacheAccess(accountId, () => syncPop3AccountCore(accountId, initialSync))
}

async function syncPop3AccountCore(
  accountId: number,
  initialSync: boolean
): Promise<Pop3SyncStats> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)
  if (account.receiveProtocol !== 'pop3') throw new Error('账号不是 POP3 协议。')
  const password = readAccountPassword(accountId)
  if (!password) throw new Error('POP3 账号缺少密码或授权码。')

  const session = await Pop3Session.connect(account)
  let scannedCount = 0
  let insertedCount = 0
  let updatedCount = 0
  let newMailCount = 0
  try {
    await session.login(account.email, password)
    const remoteMessages = await session.listUniqueIds()
    const sizes = await session.listSizes()
    scannedCount = remoteMessages.length
    const known = getKnownUidlMap(accountId)
    const folderId = ensurePopInbox(accountId)
    const settings = getSettings()
    const metadataCutoff = syncCutoff(settings.syncWindowDays)
    const bodyCutoff = syncCutoff(settings.syncBodyWindowDays)

    for (const remote of remoteMessages.slice().reverse()) {
      const previous = known.get(remote.uidl)
      if (previous?.message_id) {
        if (previous.mail_date && previous.mail_date >= bodyCutoff && !previous.body_ready) {
          await loadMessageBodyFromImap(previous.message_id, () => session.retrieve(remote.number))
          updatedCount++
        }
        continue
      }
      if (previous?.mail_date && previous.mail_date < metadataCutoff) continue
      let rawMessage = previous?.raw_source ?? undefined
      let headerSource = rawMessage ?? (await session.retrieveHeaders(remote.number))
      if (headerSource === undefined) {
        rawMessage = await session.retrieve(remote.number)
        headerSource = rawMessage
      }
      const header = parseRawHeader(headerSource)
      if (!header.receivedAt) throw new Error('POP3 邮件缺少有效日期，无法确定同步范围。')
      if (header.receivedAt < metadataCutoff) {
        markUidlSeen(accountId, remote.uidl, undefined, header.receivedAt, rawMessage)
        continue
      }
      if (!rawMessage && header.receivedAt >= bodyCutoff)
        rawMessage = await session.retrieve(remote.number)
      const sizeBytes = sizes.get(remote.number)
      if (sizeBytes === undefined) throw new Error('POP3 LIST 响应缺少邮件大小。')
      const isBackfill =
        Boolean(previous) || !account.lastSyncAt || header.receivedAt < account.lastSyncAt

      const uid = resolveStableUid(accountId, folderId, remote.uidl)
      const db = getDatabase()
      db.exec('BEGIN IMMEDIATE')
      try {
        const messageId = persistPopMessage(
          accountId,
          folderId,
          uid,
          remote.uidl,
          headerSource,
          header,
          sizeBytes,
          settings.downloadAttachmentsSeparately,
          isBackfill
        )
        if (rawMessage) persistRawMessageBody(messageId, rawMessage)
        persistAddresses(messageId, header)
        markUidlSeen(accountId, remote.uidl, messageId, header.receivedAt)
        db.prepare(
          `INSERT INTO onemail_message_search (message_id, account_id, folder_id, subject, from_name, from_email, snippet, body_text)
          SELECT message_id, account_id, folder_id, COALESCE(subject, ''), COALESCE(from_name, ''), COALESCE(from_email, ''), COALESCE(snippet, ''), ''
          FROM onemail_mail_messages WHERE message_id = :messageId
          AND NOT EXISTS (SELECT 1 FROM onemail_message_search WHERE message_id = :messageId)`
        ).run({ messageId })
        enqueueMailRulesForNewMessages(isBackfill ? [] : [messageId], { initialSync })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      insertedCount += 1
      if (!isBackfill) newMailCount++
    }
    updatePopFolderCounts(folderId)
    markAccountSynced(accountId)
    return { scannedCount, insertedCount, updatedCount, newMailCount }
  } finally {
    await session.quit()
  }
}

type KnownPopMessage = {
  uidl: string
  message_id: number | null
  mail_date: string | null
  raw_source: string | null
  body_ready: number
}

function getKnownUidlMap(accountId: number): Map<string, KnownPopMessage> {
  return new Map(
    getDatabase()
      .prepare<KnownPopMessage>(
        `SELECT p.uidl, p.message_id, COALESCE(m.received_at, m.internal_date, p.mail_date) AS mail_date,
          p.raw_source, (b.message_id IS NOT NULL AND m.body_status = 'ready') AS body_ready
         FROM onemail_pop3_messages p
         LEFT JOIN onemail_mail_messages m ON m.message_id = p.message_id
         LEFT JOIN onemail_message_bodies b ON b.message_id = p.message_id
         WHERE p.account_id = :accountId`
      )
      .all({ accountId })
      .map((row) => [row.uidl, row])
  )
}

function ensurePopInbox(accountId: number): number {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO onemail_mail_folders (
       account_id, path, name, role, attributes_json, is_selectable, is_subscribed,
       sync_enabled, sort_order
     ) VALUES (:accountId, 'INBOX', 'Inbox', 'inbox', '[]', 1, 1, 1, 0)
     ON CONFLICT(account_id, path) DO UPDATE SET
       role = 'inbox', sync_enabled = 1, is_selectable = 1`
  ).run({ accountId })
  const row = db
    .prepare<{ folder_id: number }>(
      `SELECT folder_id FROM onemail_mail_folders
       WHERE account_id = :accountId AND path = 'INBOX'`
    )
    .get({ accountId })
  if (!row) throw new Error('无法创建 POP3 收件箱。')
  return Number(row.folder_id)
}

function persistPopMessage(
  accountId: number,
  folderId: number,
  uid: number,
  uidl: string,
  rawMessage: string,
  header: ParsedHeader,
  sizeBytes: number,
  downloadAttachmentsSeparately: boolean,
  isBackfill: boolean
): number {
  const messageKey = header.messageId ?? `pop3:${uidl}`
  const params: SqliteParams = {
    accountId,
    folderId,
    uid,
    rfc822MessageId: messageKey,
    subject: header.subject ?? null,
    fromName: header.fromName ?? null,
    fromEmail: header.fromEmail ?? null,
    receivedAt: header.receivedAt ?? null,
    internalDate: header.receivedAt ?? new Date().toISOString(),
    snippet: header.subject ?? '',
    sizeBytes,
    rawHeaders: rawMessage.split(/\r?\n\r?\n/, 1)[0],
    downloadAttachmentsSeparately: downloadAttachmentsSeparately ? 1 : 0,
    syncBackfill: isBackfill ? 1 : 0
  }
  const db = getDatabase()
  db.prepare(
    `INSERT INTO onemail_mail_messages (
       account_id, folder_id, uid, rfc822_message_id, subject, from_name, from_email,
       received_at, internal_date, snippet, size_bytes, is_read, flags_json,
       raw_headers, body_status, download_attachments_separately, sync_backfill
     ) VALUES (
       :accountId, :folderId, :uid, :rfc822MessageId, :subject, :fromName, :fromEmail,
       :receivedAt, :internalDate, :snippet, :sizeBytes, 0, '[]', :rawHeaders, 'none', :downloadAttachmentsSeparately, :syncBackfill
     )`
  ).run(params)
  const row = db
    .prepare<{ message_id: number }>(
      `SELECT message_id FROM onemail_mail_messages
       WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid`
    )
    .get({ accountId, folderId, uid })
  if (!row) throw new Error('保存 POP3 邮件失败。')
  return Number(row.message_id)
}

function persistAddresses(messageId: number, header: ParsedHeader): void {
  const db = getDatabase()
  db.prepare('DELETE FROM onemail_message_addresses WHERE message_id = :messageId').run({
    messageId
  })
  const insert = db.prepare(
    `INSERT INTO onemail_message_addresses
       (message_id, kind, name, email, normalized_email, sort_order)
     VALUES (:messageId, :kind, :name, :email, :normalizedEmail, :sortOrder)`
  )
  const groups: Array<[string, ParsedAddress[]]> = [
    ['from', header.fromEmail ? [{ name: header.fromName, email: header.fromEmail }] : []],
    ['to', header.to],
    ['cc', header.cc],
    ['reply_to', header.replyTo]
  ]
  for (const [kind, addresses] of groups) {
    addresses.forEach((address, sortOrder) =>
      insert.run({
        messageId,
        kind,
        name: address.name ?? null,
        email: address.email,
        normalizedEmail: address.email.toLowerCase(),
        sortOrder
      })
    )
  }
}

function markUidlSeen(
  accountId: number,
  uidl: string,
  messageId?: number,
  mailDate?: string,
  rawSource?: string
): void {
  getDatabase()
    .prepare(
      `INSERT INTO onemail_pop3_messages (account_id, uidl, message_id, mail_date, raw_source)
       VALUES (:accountId, :uidl, :messageId, :mailDate, :rawSource)
       ON CONFLICT(account_id, uidl) DO UPDATE SET
         message_id = COALESCE(excluded.message_id, onemail_pop3_messages.message_id),
         mail_date = excluded.mail_date,
         raw_source = excluded.raw_source,
         seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .run({
      accountId,
      uidl,
      messageId: messageId ?? null,
      mailDate: mailDate ?? null,
      rawSource: rawSource ?? null
    })
}

function resolveStableUid(accountId: number, folderId: number, uidl: string): number {
  let uid = Math.max(1, createHash('sha256').update(uidl).digest().readUInt32BE(0) & 0x7fffffff)
  const db = getDatabase()
  while (
    db
      .prepare(
        'SELECT 1 FROM onemail_mail_messages WHERE account_id = :accountId AND folder_id = :folderId AND uid = :uid'
      )
      .get({ accountId, folderId, uid })
  ) {
    uid = uid >= 0x7ffffffe ? 1 : uid + 1
  }
  return uid
}

function parseRawHeader(rawMessage: string): ParsedHeader {
  const headerText = rawMessage.split(/\r?\n\r?\n/, 1)[0]
  const headers = new Map<string, string>()
  let currentKey = ''
  for (const line of headerText.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`)
      continue
    }
    const index = line.indexOf(':')
    if (index <= 0) continue
    currentKey = line.slice(0, index).trim().toLowerCase()
    headers.set(currentKey, line.slice(index + 1).trim())
  }
  const from = parseAddresses(headers.get('from'))[0]
  const date = headers.get('date')
  const parsedDate = date ? new Date(date) : undefined
  return {
    subject: normalizeMailDisplayText(headers.get('subject')),
    fromName: from?.name,
    fromEmail: from?.email,
    receivedAt:
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
    messageId: headers.get('message-id'),
    to: parseAddresses(headers.get('to')),
    cc: parseAddresses(headers.get('cc')),
    replyTo: parseAddresses(headers.get('reply-to'))
  }
}

function parseAddresses(value?: string): ParsedAddress[] {
  const decoded = normalizeMailDisplayText(value)
  if (!decoded) return []
  return decoded
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((item) => {
      const match = /^(.*?)<([^>]+)>$/.exec(item.trim())
      const email = (match?.[2] ?? item).trim()
      const name = match?.[1]?.trim().replace(/^"|"$/g, '')
      return email ? { name: name || undefined, email } : undefined
    })
    .filter((item): item is { name: string | undefined; email: string } => Boolean(item))
}

function updatePopFolderCounts(folderId: number): void {
  getDatabase()
    .prepare(
      `UPDATE onemail_mail_folders
       SET total_count = (SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id = :folderId AND remote_deleted = 0),
           unread_count = (SELECT COUNT(*) FROM onemail_mail_messages WHERE folder_id = :folderId AND remote_deleted = 0 AND is_read = 0),
           last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE folder_id = :folderId`
    )
    .run({ folderId })
}

function markAccountSynced(accountId: number): void {
  getDatabase()
    .prepare(
      `UPDATE onemail_mail_accounts
       SET status = 'active', last_sync_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE account_id = :accountId`
    )
    .run({ accountId })
}
