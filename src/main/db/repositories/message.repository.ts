import { getDatabase, toBoolean, toNumber, toOptionalString, type SqliteRow } from '../connection'
import type {
  AccountMailboxStats,
  MailMessageBody,
  MailMessageAttachment,
  MailMessageDetail,
  MailMessageSummary,
  MessageReadStateUpdate,
  NewMailNotificationMessage,
  MessageListQuery
} from '../../ipc/types'
import { extractVerificationCode } from '../../../shared/verification-code'
import { REMOTE_MESSAGE_MISSING_NOTICE } from '../../mail/remote-message-error'

type MessageRow = SqliteRow & {
  message_id: number
  account_id: number
  folder_id: number
  folder_role?: string | null
  folder_name?: string | null
  rfc822_message_id?: string | null
  references_header?: string | null
  subject: string | null
  from_name: string | null
  from_email: string | null
  received_at: string | null
  snippet: string | null
  is_read: number
  is_starred: number
  is_answered?: number
  has_attachments: number
  body_status: MailMessageSummary['bodyStatus']
  body_error?: string | null
  remote_missing?: number
  body_text?: string | null
  body_html_sanitized?: string | null
  external_images_blocked?: number
}

type AttachmentRow = SqliteRow & {
  attachment_id: number
  filename: string
  mime_type: string | null
  content_disposition: MailMessageAttachment['contentDisposition'] | null
  size_bytes: number
  cached: number
}

type AddressRow = SqliteRow & {
  kind: 'from' | 'sender' | 'to' | 'cc' | 'bcc' | 'reply_to'
  name: string | null
  email: string
}

type ComposeSourceRow = MessageRow & {
  rfc822_message_id: string | null
  in_reply_to: string | null
  references_header: string | null
  sent_at: string | null
  raw_headers: string | null
  folder_path: string
  folder_role: string
  uid: number
}

export type MessageComposeAddress = {
  name?: string
  email: string
}

export type MessageComposeSource = {
  messageId: number
  accountId: number
  folderId: number
  folderPath: string
  folderRole: string
  uid: number
  remoteMissing: boolean
  subject?: string
  fromName?: string
  fromEmail?: string
  sentAt?: string
  receivedAt?: string
  rfc822MessageId?: string
  inReplyTo?: string
  referencesHeader?: string
  rawHeaders?: string
  bodyText?: string
  bodyHtmlSanitized?: string
  addresses: Record<AddressRow['kind'], MessageComposeAddress[]>
  attachments: MailMessageAttachment[]
}

type AccountMailboxStatsRow = SqliteRow & {
  account_id: number
  total_count: number
  unread_count: number
}

type MessageListQueryParts = {
  where: string[]
  params: Record<string, string | number>
}

export type MessageReadStateTarget = {
  messageId: number
  accountId: number
  folderId: number
  folderPath: string
  uid: number
  isRead: boolean
  readStateRevision: number
  remoteMissing: boolean
}

export type MessageDeleteTarget = {
  messageId: number
  accountId: number
  folderId: number
  folderPath: string
  folderRole: string
  uid: number
  rfc822MessageId?: string
  remoteDeleted: boolean
  remoteMissing: boolean
  userHidden: boolean
  userDeleted: boolean
}

export function listMessages(query?: MessageListQuery): MailMessageSummary[] {
  const { where, params } = buildMessageListQueryParts(query)
  const paginatedParams: Record<string, string | number> = {
    ...params,
    limit: Math.min(Math.max(query?.limit ?? 50, 1), 200),
    offset: Math.max(query?.offset ?? 0, 0)
  }

  const rows = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.role AS folder_role,
        f.name AS folder_name,
        m.rfc822_message_id,
        m.references_header,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.is_answered,
        m.has_attachments,
        m.body_status,
        m.body_error,
        m.remote_missing,
        b.body_text,
        b.body_html_sanitized
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(m.received_at, m.internal_date, m.created_at) DESC, m.message_id DESC
      LIMIT :limit OFFSET :offset
      `
    )
    .all(paginatedParams)

  return rows.map(mapMessageSummaryRow)
}

export function listUnreadMessageIds(query?: MessageListQuery): number[] {
  const { where, params } = buildMessageListQueryParts(query)
  if (!where.includes('m.is_read = 0')) {
    where.push('m.is_read = 0')
  }

  const rows = getDatabase()
    .prepare<{ message_id: number }>(
      `
      SELECT m.message_id
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(m.received_at, m.internal_date, m.created_at) DESC, m.message_id DESC
      `
    )
    .all(params)

  return rows.map((row) => toNumber(row.message_id))
}

function buildMessageListQueryParts(query?: MessageListQuery): MessageListQueryParts {
  const where: string[] = [
    'm.remote_deleted = 0',
    query?.localDeletedOnly ? 'm.user_hidden = 1' : 'm.user_hidden = 0'
  ]
  const params: Record<string, string | number> = {}

  if (query?.accountId !== undefined) {
    where.push('m.account_id = :accountId')
    params.accountId = query.accountId
  }

  if (query?.folderId !== undefined) {
    where.push('m.folder_id = :folderId')
    params.folderId = query.folderId
  }

  if (query?.folderRole !== undefined) {
    where.push('f.role = :folderRole')
    params.folderRole = query.folderRole
  }

  const filters = new Set(query?.filters ?? [])
  if (filters.has('unread')) where.push('m.is_read = 0')
  if (filters.has('starred')) where.push('m.is_starred = 1')
  if (filters.has('today')) {
    where.push(
      "date(COALESCE(m.received_at, m.internal_date), 'localtime') = date('now', 'localtime')"
    )
  }
  if (filters.has('yesterday')) {
    where.push(
      "date(COALESCE(m.received_at, m.internal_date), 'localtime') = date('now', 'localtime', '-1 day')"
    )
  }
  if (filters.has('last7')) {
    where.push(
      "date(COALESCE(m.received_at, m.internal_date), 'localtime') >= date('now', 'localtime', '-6 days')"
    )
    where.push(
      "date(COALESCE(m.received_at, m.internal_date), 'localtime') <= date('now', 'localtime')"
    )
  }

  const keyword = normalizeSearchKeyword(query?.keyword ?? query?.search)
  if (keyword) {
    const searchClauses = [
      "m.subject LIKE :likeKeyword ESCAPE '\\'",
      "m.from_name LIKE :likeKeyword ESCAPE '\\'",
      "m.from_email LIKE :likeKeyword ESCAPE '\\'",
      "m.snippet LIKE :likeKeyword ESCAPE '\\'",
      "b.body_text LIKE :likeKeyword ESCAPE '\\'"
    ]
    const ftsKeyword = toFtsQuery(keyword)

    if (ftsKeyword) {
      searchClauses.unshift(
        `m.message_id IN (
          SELECT message_id
          FROM onemail_message_search
          WHERE onemail_message_search MATCH :ftsKeyword
        )`
      )
      params.ftsKeyword = ftsKeyword
    }

    where.push(`(${searchClauses.join(' OR ')})`)
    params.likeKeyword = `%${escapeLikeKeyword(keyword)}%`
  }

  return { where, params }
}

function normalizeSearchKeyword(value?: string): string | undefined {
  const keyword = value?.replace(/\s+/g, ' ').trim()
  return keyword || undefined
}

function escapeLikeKeyword(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function toFtsQuery(value: string): string {
  return (
    value
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((term) => term.replace(/"/g, '""'))
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(' AND ') ?? ''
  )
}

export function listAccountMailboxStats(): AccountMailboxStats[] {
  const rows = getDatabase()
    .prepare<AccountMailboxStatsRow>(
      `
      SELECT
        account_id,
        SUM(total_count) AS total_count,
        SUM(unread_count) AS unread_count
      FROM (
        SELECT
          f.account_id,
          f.total_count,
          f.unread_count
        FROM onemail_mail_folders f
        WHERE f.sync_enabled = 1
          AND f.role = 'inbox'
          AND (f.total_count > 0 OR f.unread_count > 0)
        UNION ALL
        SELECT
          m.account_id,
          COUNT(*) AS total_count,
          SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END) AS unread_count
        FROM onemail_mail_messages m
        JOIN onemail_mail_folders mf ON mf.folder_id = m.folder_id
        WHERE m.remote_deleted = 0
          AND m.user_hidden = 0
          AND mf.role = 'inbox'
          AND NOT EXISTS (
            SELECT 1
            FROM onemail_mail_folders f
            WHERE f.account_id = m.account_id
              AND f.sync_enabled = 1
              AND f.role = 'inbox'
              AND (f.total_count > 0 OR f.unread_count > 0)
          )
        GROUP BY m.account_id
      )
      GROUP BY account_id
      `
    )
    .all()

  return rows.map((row) => ({
    accountId: toNumber(row.account_id),
    totalCount: toNumber(row.total_count),
    unreadCount: toNumber(row.unread_count)
  }))
}

export function listRecentNotificationMessages(
  accountId: number,
  limit: number
): NewMailNotificationMessage[] {
  const rows = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.role AS folder_role,
        f.name AS folder_name,
        m.rfc822_message_id,
        m.references_header,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.is_answered,
        m.has_attachments,
        m.body_status,
        m.body_error,
        m.remote_missing,
        b.body_text,
        b.body_html_sanitized
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.account_id = :accountId
        AND m.remote_deleted = 0
        AND m.user_hidden = 0
        AND m.sync_backfill = 0
        AND f.role = 'inbox'
      ORDER BY m.message_id DESC
      LIMIT :limit
      `
    )
    .all({ accountId, limit: Math.min(Math.max(limit, 1), 10) })

  return rows.map((row) => ({
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    subject: toOptionalString(row.subject),
    fromName: toOptionalString(row.from_name),
    fromEmail: toOptionalString(row.from_email),
    receivedAt: toOptionalString(row.received_at),
    snippet: toOptionalString(row.snippet),
    verificationCode: extractVerificationCode(
      row.subject,
      row.snippet,
      row.body_text,
      row.body_html_sanitized
    )
  }))
}

export function getMessage(messageId: number): MailMessageDetail | null {
  const db = getDatabase()
  const row = db
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.role AS folder_role,
        f.name AS folder_name,
        m.rfc822_message_id,
        m.references_header,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.is_answered,
        m.has_attachments,
        m.body_status,
        m.body_error,
        m.remote_missing,
        b.body_text,
        b.body_html_sanitized,
        b.external_images_blocked
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    ...mapMessageSummaryRow(row),
    body: mapBodyRow(row),
    attachments: listAttachments(messageId, db)
  }
}

export function loadMessageBody(messageId: number): MailMessageBody | null {
  const row = getDatabase()
    .prepare<MessageRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        m.subject,
        m.from_name,
        m.from_email,
        m.received_at,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized,
        b.external_images_blocked
      FROM onemail_mail_messages m
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  return row ? (mapBodyRow(row) ?? null) : null
}

export function getMessageReadStateTarget(messageId: number): MessageReadStateTarget | null {
  const row = getDatabase()
    .prepare<
      SqliteRow & {
        message_id: number
        account_id: number
        folder_id: number
        folder_path: string
        uid: number
        is_read: number
        read_state_revision: number
        remote_missing: number
      }
    >(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.path AS folder_path,
        m.uid,
        m.is_read,
        m.read_state_revision,
        m.remote_missing
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE m.message_id = :messageId
        AND m.remote_deleted = 0
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    folderPath: row.folder_path,
    uid: toNumber(row.uid),
    isRead: toBoolean(row.is_read),
    readStateRevision: toNumber(row.read_state_revision),
    remoteMissing: toBoolean(row.remote_missing)
  }
}

export function getMessageComposeSource(messageId: number): MessageComposeSource | null {
  const db = getDatabase()
  const row = db
    .prepare<ComposeSourceRow>(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.path AS folder_path,
        f.role AS folder_role,
        m.uid,
        m.remote_missing,
        m.rfc822_message_id,
        m.in_reply_to,
        m.references_header,
        m.subject,
        m.from_name,
        m.from_email,
        m.sent_at,
        m.received_at,
        m.raw_headers,
        m.snippet,
        m.is_read,
        m.is_starred,
        m.has_attachments,
        m.body_status,
        b.body_text,
        b.body_html_sanitized
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE m.message_id = :messageId
        AND m.remote_deleted = 0
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    folderPath: row.folder_path,
    folderRole: row.folder_role,
    uid: toNumber(row.uid),
    remoteMissing: toBoolean(row.remote_missing),
    subject: toOptionalString(row.subject),
    fromName: toOptionalString(row.from_name),
    fromEmail: toOptionalString(row.from_email),
    sentAt: toOptionalString(row.sent_at),
    receivedAt: toOptionalString(row.received_at),
    rfc822MessageId: toOptionalString(row.rfc822_message_id),
    inReplyTo: toOptionalString(row.in_reply_to),
    referencesHeader: toOptionalString(row.references_header),
    rawHeaders: toOptionalString(row.raw_headers),
    bodyText: toOptionalString(row.body_text),
    bodyHtmlSanitized: toOptionalString(row.body_html_sanitized),
    addresses: listMessageAddresses(messageId, db),
    attachments: listAttachments(messageId, db)
  }
}

export function getMessageRawSource(messageId: number): string | undefined {
  const row = getDatabase()
    .prepare<{ raw_source: string | null }>(
      `
      SELECT raw_source
      FROM onemail_message_bodies
      WHERE message_id = :messageId
      `
    )
    .get({ messageId })
  return toOptionalString(row?.raw_source)
}

export function markMessageAnswered(messageId: number, isAnswered = true): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_messages
      SET is_answered = :isAnswered,
          state_revision = state_revision + 1,
          flags_json = :flagsJson,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    )
    .run({
      messageId,
      isAnswered: isAnswered ? 1 : 0,
      flagsJson: updateFlagsJson(messageId, 'Answered', isAnswered)
    })
}

export function getMessageDeleteTarget(messageId: number): MessageDeleteTarget | null {
  const row = getDatabase()
    .prepare<
      SqliteRow & {
        message_id: number
        account_id: number
        folder_id: number
        folder_path: string
        folder_role: string
        uid: number
        rfc822_message_id: string | null
        remote_deleted: number
        remote_missing: number
        user_hidden: number
        user_deleted: number
      }
    >(
      `
      SELECT
        m.message_id,
        m.account_id,
        m.folder_id,
        f.path AS folder_path,
        f.role AS folder_role,
        m.uid,
        m.rfc822_message_id,
        m.remote_deleted,
        m.remote_missing,
        m.user_hidden,
        m.user_deleted
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  if (!row) return null

  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    folderPath: row.folder_path,
    folderRole: row.folder_role,
    uid: toNumber(row.uid),
    rfc822MessageId: toOptionalString(row.rfc822_message_id),
    remoteDeleted: toBoolean(row.remote_deleted),
    remoteMissing: toBoolean(row.remote_missing),
    userHidden: toBoolean(row.user_hidden),
    userDeleted: toBoolean(row.user_deleted)
  }
}

export function updateMessageReadState(messageId: number, isRead: boolean): MessageReadStateUpdate {
  const db = getDatabase()
  const target = getMessageReadStateTarget(messageId)
  if (!target) {
    throw new Error('邮件不存在或已从远端删除。')
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET is_read = :isRead,
          read_state_revision = read_state_revision + 1,
          state_revision = state_revision + 1,
          flags_json = :flagsJson,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    ).run({
      messageId,
      isRead: isRead ? 1 : 0,
      flagsJson: updateFlagsJsonForReadState(isRead, messageId)
    })

    refreshFolderUnreadCount(target.folderId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return {
    messageId,
    accountId: target.accountId,
    folderId: target.folderId,
    isRead,
    remoteMissing: target.remoteMissing
  }
}

export function markMessageRemoteMissing(messageId: number): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE onemail_mail_messages
     SET remote_missing = 1,
         state_revision = state_revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE message_id = :messageId`
  ).run({ messageId })
  db.prepare(
    `UPDATE onemail_remote_writebacks
     SET status = 'cancelled', error_message = :notice,
         finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE message_id = :messageId
       AND status IN ('queued', 'failed')
       AND operation_kind IN ('mark_read', 'mark_unread', 'mark_answered')`
  ).run({ messageId, notice: REMOTE_MESSAGE_MISSING_NOTICE })
}

export function markMessageUserDeleted(messageId: number): void {
  updateMessageDeleteState(messageId, {
    remote_deleted: 1,
    is_deleted: 1,
    user_deleted: 1,
    delete_error: null,
    deleted_at: nowSql(),
    last_operation_at: nowSql()
  })
}

export function markMessageUserHidden(messageId: number): void {
  updateMessageDeleteState(messageId, {
    user_hidden: 1,
    delete_error: null,
    deleted_at: nowSql(),
    last_operation_at: nowSql()
  })
}

export function markMessageMovedToTrash(
  messageId: number,
  trashFolderId: number,
  destinationUid: number
): void {
  markMessageMoved(messageId, trashFolderId, destinationUid, true)
}

export function markMessageMoved(
  messageId: number,
  destinationFolderId: number,
  destinationUid: number,
  hidden: boolean
): void {
  const db = getDatabase()
  const target = getMessageDeleteTarget(messageId)
  if (!target) throw new Error('邮件不存在。')

  db.exec('BEGIN IMMEDIATE')
  try {
    if (destinationUid) {
      db.prepare(
        `
        DELETE FROM onemail_mail_messages
        WHERE account_id = :accountId
          AND folder_id = :folderId
          AND uid = :uid
          AND message_id <> :messageId
        `
      ).run({
        accountId: target.accountId,
        folderId: destinationFolderId,
        uid: destinationUid,
        messageId
      })
    }

    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET folder_id = :destinationFolderId,
          uid = :destinationUid,
          user_hidden = :hidden,
          user_deleted = :hidden,
          remote_missing = 0,
          state_revision = state_revision + 1,
          delete_error = NULL,
          deleted_at = CASE WHEN :hidden = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
          last_operation_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    ).run({ messageId, destinationFolderId, destinationUid, hidden: hidden ? 1 : 0 })
    db.prepare(
      'UPDATE onemail_message_search SET folder_id = :folderId WHERE message_id = :messageId'
    ).run({ folderId: destinationFolderId, messageId })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  refreshFolderUnreadCount(target.folderId)
  if (destinationFolderId !== target.folderId) refreshFolderUnreadCount(destinationFolderId)
}

export function restoreMessageLocally(messageId: number): void {
  updateMessageDeleteState(messageId, {
    user_hidden: 0,
    user_deleted: 0,
    delete_error: null,
    deleted_at: null,
    last_operation_at: nowSql()
  })
}

export function markMessageRemoteDeleted(messageId: number): void {
  updateMessageDeleteState(messageId, {
    remote_deleted: 1,
    is_deleted: 1,
    delete_error: null,
    deleted_at: nowSql(),
    last_operation_at: nowSql()
  })
}

export function markMessageDeleteError(messageId: number, errorMessage: string): void {
  updateMessageDeleteState(messageId, {
    delete_error: errorMessage.slice(0, 500),
    last_operation_at: nowSql()
  })
}

function mapMessageSummaryRow(row: MessageRow): MailMessageSummary {
  const addresses = listMessageAddresses(toNumber(row.message_id))
  return {
    messageId: toNumber(row.message_id),
    accountId: toNumber(row.account_id),
    folderId: toNumber(row.folder_id),
    folderRole: toOptionalString(row.folder_role),
    folderName: toOptionalString(row.folder_name),
    remoteMissing: toBoolean(row.remote_missing),
    bodyError: toOptionalString(row.body_error),
    subject: toOptionalString(row.subject),
    fromName: toOptionalString(row.from_name),
    fromEmail: toOptionalString(row.from_email),
    to: formatAddressList(addresses.to),
    cc: formatAddressList(addresses.cc),
    replyTo: formatAddressList(addresses.reply_to),
    messageRfc822Id: toOptionalString(row.rfc822_message_id),
    references: toOptionalString(row.references_header),
    receivedAt: toOptionalString(row.received_at),
    snippet: toOptionalString(row.snippet),
    isRead: toBoolean(row.is_read),
    isStarred: toBoolean(row.is_starred),
    isAnswered: toBoolean(row.is_answered),
    hasAttachments: toBoolean(row.has_attachments),
    bodyStatus: row.body_status,
    verificationCode: extractVerificationCode(
      row.subject,
      row.snippet,
      row.body_text,
      row.body_html_sanitized
    )
  }
}

function updateFlagsJsonForReadState(nextIsRead: boolean, messageId: number): string {
  return updateFlagsJson(messageId, 'Seen', nextIsRead)
}

function parseFlagsJson(value?: string): Set<string> {
  if (!value) return new Set()

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    )
  } catch {
    return new Set()
  }
}

function deleteFlag(flags: Set<string>, flagName: string): void {
  for (const flag of flags) {
    if (flag.toLowerCase() === flagName.toLowerCase()) {
      flags.delete(flag)
    }
  }
}

function updateFlagsJson(messageId: number, flagName: string, enabled: boolean): string {
  const current = getDatabase()
    .prepare<{
      flags_json: string
    }>('SELECT flags_json FROM onemail_mail_messages WHERE message_id = :messageId')
    .get({ messageId })
  const flags = parseFlagsJson(current?.flags_json)
  deleteFlag(flags, flagName)

  if (enabled) {
    flags.add(flagName)
  }

  return JSON.stringify(Array.from(flags))
}

function updateMessageDeleteState(
  messageId: number,
  values: Record<string, string | number | null>
): void {
  const existingColumns = getMessageColumns()
  const assignments: string[] = []
  const params: Record<string, string | number | null> = { messageId }

  for (const [column, value] of Object.entries(values)) {
    if (!existingColumns.has(column)) continue

    if (value === nowSql()) {
      assignments.push(`${column} = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      continue
    }

    const paramName = column.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
    assignments.push(`${column} = :${paramName}`)
    params[paramName] = value
  }

  if (assignments.length === 0) return

  const target = getMessageDeleteTarget(messageId)
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_messages
      SET ${assignments.join(', ')},
          state_revision = state_revision + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    )
    .run(params)

  if (target) refreshFolderUnreadCount(target.folderId)
}

function getMessageColumns(): Set<string> {
  const rows = getDatabase()
    .prepare<{ name: string }>('PRAGMA table_info(onemail_mail_messages)')
    .all()

  return new Set(rows.map((row) => row.name))
}

function nowSql(): '__NOW__' {
  return '__NOW__'
}

function refreshFolderUnreadCount(folderId: number): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_mail_folders
      SET unread_count = (
            SELECT COUNT(*)
            FROM onemail_mail_messages
            WHERE folder_id = :folderId
              AND remote_deleted = 0
              AND user_hidden = 0
              AND is_read = 0
          ),
          total_count = (
            SELECT COUNT(*)
            FROM onemail_mail_messages
            WHERE folder_id = :folderId
              AND remote_deleted = 0
              AND user_hidden = 0
          ),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE folder_id = :folderId
      `
    )
    .run({ folderId })
}

function listAttachments(messageId: number, db = getDatabase()): MailMessageAttachment[] {
  const rows = db
    .prepare<AttachmentRow>(
      `
      SELECT
        attachment_id,
        filename,
        mime_type,
        content_disposition,
        size_bytes,
        (cached_content IS NOT NULL OR EXISTS (
          SELECT 1 FROM onemail_message_bodies b
          WHERE b.message_id = onemail_message_attachments.message_id AND b.raw_source IS NOT NULL
        )) AS cached
      FROM onemail_message_attachments
      WHERE message_id = :messageId
      ORDER BY attachment_id ASC
      `
    )
    .all({ messageId })

  return rows.map((row) => ({
    attachmentId: toNumber(row.attachment_id),
    filename: row.filename,
    mimeType: toOptionalString(row.mime_type),
    contentDisposition: row.content_disposition ?? undefined,
    sizeBytes: toNumber(row.size_bytes),
    cached: toBoolean(row.cached)
  }))
}

function listMessageAddresses(
  messageId: number,
  db = getDatabase()
): Record<AddressRow['kind'], MessageComposeAddress[]> {
  const rows = db
    .prepare<AddressRow>(
      `
      SELECT kind, name, email
      FROM onemail_message_addresses
      WHERE message_id = :messageId
      ORDER BY sort_order ASC, address_id ASC
      `
    )
    .all({ messageId })

  const addresses: Record<AddressRow['kind'], MessageComposeAddress[]> = {
    from: [],
    sender: [],
    to: [],
    cc: [],
    bcc: [],
    reply_to: []
  }

  for (const row of rows) {
    addresses[row.kind].push({
      name: toOptionalString(row.name),
      email: row.email
    })
  }

  return addresses
}

function formatAddressList(addresses: MessageComposeAddress[]): string | undefined {
  if (addresses.length === 0) return undefined

  return addresses
    .map((address) => (address.name ? `${address.name} <${address.email}>` : address.email))
    .join(', ')
}

function mapBodyRow(row: MessageRow): MailMessageBody | undefined {
  if (
    !row.body_text &&
    !row.body_html_sanitized &&
    !(row.body_status === 'ready' && row.external_images_blocked != null)
  )
    return undefined

  return {
    messageId: toNumber(row.message_id),
    bodyText: toOptionalString(row.body_text),
    bodyHtmlSanitized: toOptionalString(row.body_html_sanitized),
    externalImagesBlocked:
      row.external_images_blocked === undefined ? true : toBoolean(row.external_images_blocked)
  }
}
