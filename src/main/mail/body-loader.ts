import { getAccount } from '../db/repositories/account.repository'
import { getDatabase, type SqliteParams } from '../db/connection'
import type { MailMessageBody } from '../ipc/types'
import { normalizeMailBodyText } from '../../shared/mail-text'
import { SimpleImapSession } from './imap-session'
import { parseBodyStructure } from './imap-body-structure'
import { readMimeFilename } from './mime-parameter'
import { withMessageCacheAccess } from '../services/cache-activity'
import { Pop3Session } from './pop3-session'
import { readAccountPassword } from '../services/credential-store'
import { authenticateImapSession } from './imap-auth'
import {
  getMessageRawSource,
  loadMessageBody,
  markMessageRemoteMissing
} from '../db/repositories/message.repository'
import { getRemoteMessageIdentity } from '../db/repositories/remote-writeback.repository'
import { fetchVerifiedRemoteMessage } from '../services/remote-writeback-imap'
import { broadcastWritebackChanged } from '../services/remote-writeback.service'
import {
  RemoteMessageMissingError,
  REMOTE_MESSAGE_MISSING_BODY_ERROR
} from './remote-message-error'

type MessageLocator = {
  message_id: number
  account_id: number
  folder_path: string
  uid: number
  remote_missing: number
  download_attachments_separately: number
}

type ParsedMimePart = {
  headers: Map<string, string>
  body: string
  partId?: string
}

type ParsedMessageBody = {
  text?: string
  html?: string
  attachments: Array<{
    partId?: string
    contentId?: string
    filename: string
    mimeType?: string
    contentDisposition?: 'attachment' | 'inline'
    sizeBytes: number
  }>
}

export type ParsedMessageAttachment = ParsedMessageBody['attachments'][number] & {
  content: Buffer
}

const bodyLoads = new Map<number, Promise<MailMessageBody | null>>()

export function loadMessageBodyFromImap(
  messageId: number,
  fetchRaw?: () => Promise<string>
): Promise<MailMessageBody | null> {
  const existing = bodyLoads.get(messageId)
  if (existing) return existing
  const pending = withMessageCacheAccess(messageId, () =>
    loadMessageBodyFromServer(messageId, fetchRaw)
  ).finally(() => bodyLoads.delete(messageId))
  bodyLoads.set(messageId, pending)
  return pending
}

async function loadMessageBodyFromServer(
  messageId: number,
  fetchRaw?: () => Promise<string>
): Promise<MailMessageBody | null> {
  const cachedBody = loadMessageBody(messageId)
  if (cachedBody) return cachedBody
  const rawSource = getMessageRawSource(messageId)
  if (rawSource) return persistRawMessageBody(messageId, rawSource)

  const locator = getMessageLocator(messageId)
  if (!locator) return null
  if (locator.remote_missing) throw new Error(REMOTE_MESSAGE_MISSING_BODY_ERROR)

  const account = getAccount(locator.account_id)
  if (!account) {
    throw new Error(`Account not found: ${locator.account_id}`)
  }

  const db = getDatabase()
  db.prepare(
    `
    UPDATE onemail_mail_messages
    SET body_status = 'loading',
        body_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE message_id = :messageId
    `
  ).run({ messageId })

  let client: SimpleImapSession | undefined
  try {
    if (fetchRaw) return persistRawMessageBody(messageId, await fetchRaw())
    if (account.receiveProtocol === 'pop3') {
      return persistRawMessageBody(messageId, await retrievePop3Message(messageId))
    }
    client = await SimpleImapSession.connect(account, 'B')
    await authenticateImapSession(account, client)
    const identity = getRemoteMessageIdentity(messageId)
    if (!identity) {
      if (getMessageLocator(messageId)?.remote_missing) {
        throw new RemoteMessageMissingError()
      }
      throw new Error('邮件远端定位信息已失效，请先同步邮件。')
    }
    if (locator.download_attachments_separately) {
      await fetchVerifiedRemoteMessage(client, identity, true)
      const parts = parseBodyStructure(await client.fetchBodyStructure(identity.uid))
      const parsed: ParsedMessageBody = { attachments: [] }
      for (const part of parts) {
        if (part.filename) {
          parsed.attachments.push(part as ParsedMessageBody['attachments'][number])
          continue
        }
        if (part.mimeType !== 'text/plain' && part.mimeType !== 'text/html') continue
        const headers = await client.fetchBodySection(identity.uid, `${part.partId}.MIME`)
        const content = await client.fetchBodySection(identity.uid, part.partId)
        const decoded = decodePartBody({ headers: parseHeaders(headers), body: content })
        if (part.mimeType === 'text/plain')
          parsed.text = [parsed.text, decoded].filter(Boolean).join('\n')
        else parsed.html = [parsed.html, decoded].filter(Boolean).join('\n')
      }
      return persistMessageBody(messageId, parsed)
    }
    const rawMessage = await fetchVerifiedRemoteMessage(client, identity)
    const parsed = parseMimeMessage(rawMessage)
    const body = persistMessageBody(messageId, parsed, rawMessage)
    return body
  } catch (error) {
    const missing = error instanceof RemoteMessageMissingError
    if (missing) {
      markMessageRemoteMissing(messageId)
      broadcastWritebackChanged()
    }
    db.prepare(
      `
      UPDATE onemail_mail_messages
      SET body_status = 'error',
          body_error = :message,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE message_id = :messageId
      `
    ).run({
      messageId,
      message: missing
        ? REMOTE_MESSAGE_MISSING_BODY_ERROR
        : error instanceof Error
          ? error.message
          : '加载正文失败。'
    })
    if (missing) throw new Error(REMOTE_MESSAGE_MISSING_BODY_ERROR)
    throw error
  } finally {
    await client?.logout().catch(() => undefined)
  }
}

export async function retrievePop3Message(messageId: number): Promise<string> {
  const row = getDatabase()
    .prepare<{
      account_id: number
      uidl: string
    }>(`SELECT account_id, uidl FROM onemail_pop3_messages WHERE message_id = :messageId`)
    .get({ messageId })
  if (!row) throw new Error('POP3 邮件缺少 UIDL 定位信息。')
  const account = getAccount(row.account_id)
  const password = readAccountPassword(row.account_id)
  if (!account || !password) throw new Error('POP3 账号或凭据不存在。')
  const session = await Pop3Session.connect(account)
  try {
    await session.login(account.email, password)
    const remote = (await session.listUniqueIds()).find((item) => item.uidl === row.uidl)
    if (!remote) throw new RemoteMessageMissingError()
    return await session.retrieve(remote.number)
  } finally {
    await session.quit()
  }
}

function getMessageLocator(messageId: number): MessageLocator | null {
  const row = getDatabase()
    .prepare<MessageLocator>(
      `
      SELECT
        m.message_id,
        m.account_id,
        f.path AS folder_path,
        m.uid,
        m.remote_missing,
        m.download_attachments_separately
      FROM onemail_mail_messages m
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      WHERE m.message_id = :messageId
      `
    )
    .get({ messageId })

  return row ?? null
}

export function persistRawMessageBody(messageId: number, rawMessage: string): MailMessageBody {
  return persistMessageBody(messageId, parseMimeMessage(rawMessage), rawMessage)
}

function persistMessageBody(
  messageId: number,
  parsed: ParsedMessageBody,
  rawSource?: string
): MailMessageBody {
  const bodyText = normalizeMailBodyText(parsed.text)
  const bodyHtml = sanitizeCachedMailHtml(parsed.html)
  const db = getDatabase()
  db.exec('SAVEPOINT persist_message_body')
  try {
    const params: SqliteParams = {
      messageId,
      bodyText: bodyText ?? null,
      bodyHtml: bodyHtml ?? null,
      rawSource: rawSource ?? null,
      externalImagesBlocked: 1
    }

    db.prepare(
      `
    INSERT INTO onemail_message_bodies (
      message_id,
      body_text,
      body_html_sanitized,
      raw_source,
      external_images_blocked,
      sanitized_at
    )
    VALUES (
      :messageId,
      :bodyText,
      :bodyHtml,
      :rawSource,
      :externalImagesBlocked,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(message_id) DO UPDATE SET
      body_text = excluded.body_text,
      body_html_sanitized = excluded.body_html_sanitized,
      raw_source = COALESCE(excluded.raw_source, onemail_message_bodies.raw_source),
      external_images_blocked = excluded.external_images_blocked,
      sanitized_at = excluded.sanitized_at,
      loaded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `
    ).run(params)

    const existingAttachments = db
      .prepare<{
        attachment_id: number
        part_id: string | null
        filename: string
        mime_type: string | null
      }>(
        'SELECT attachment_id, part_id, filename, mime_type FROM onemail_message_attachments WHERE message_id = :messageId ORDER BY attachment_id'
      )
      .all({ messageId })
    const usedIds = new Set<number>()
    for (const attachment of parsed.attachments) {
      const existing = existingAttachments.find(
        (row) =>
          !usedIds.has(row.attachment_id) &&
          (row.part_id
            ? row.part_id === attachment.partId
            : row.filename === attachment.filename && row.mime_type === attachment.mimeType)
      )
      const attachmentParams = {
        messageId,
        partId: attachment.partId ?? null,
        contentId: attachment.contentId ?? null,
        filename: attachment.filename,
        mimeType: attachment.mimeType ?? null,
        contentDisposition: attachment.contentDisposition ?? 'attachment',
        sizeBytes: attachment.sizeBytes
      }
      if (existing) {
        usedIds.add(existing.attachment_id)
        db.prepare(
          `UPDATE onemail_message_attachments SET part_id = :partId, content_id = :contentId,
        filename = :filename, mime_type = :mimeType, content_disposition = :contentDisposition, size_bytes = :sizeBytes
        WHERE attachment_id = :attachmentId AND message_id = :messageId`
        ).run({ ...attachmentParams, attachmentId: existing.attachment_id })
      } else {
        db.prepare(
          `INSERT INTO onemail_message_attachments
        (message_id, part_id, content_id, filename, mime_type, content_disposition, size_bytes)
        VALUES (:messageId, :partId, :contentId, :filename, :mimeType, :contentDisposition, :sizeBytes)`
        ).run(attachmentParams)
      }
    }

    db.prepare(
      `
    UPDATE onemail_mail_messages
    SET has_attachments = :hasAttachments,
        body_status = 'ready',
        body_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE message_id = :messageId
    `
    ).run({
      messageId,
      hasAttachments: parsed.attachments.length > 0 ? 1 : 0
    })

    updateMessageSearchIndex(messageId, bodyText ?? htmlToSearchText(bodyHtml) ?? '')
    db.exec('RELEASE persist_message_body')

    return {
      messageId,
      bodyText,
      bodyHtmlSanitized: bodyHtml,
      externalImagesBlocked: true
    }
  } catch (error) {
    db.exec('ROLLBACK TO persist_message_body')
    db.exec('RELEASE persist_message_body')
    throw error
  }
}

function updateMessageSearchIndex(messageId: number, bodyText: string): void {
  const db = getDatabase()
  const row = db
    .prepare<{
      account_id: number
      folder_id: number
      subject: string | null
      from_name: string | null
      from_email: string | null
      snippet: string | null
    }>(
      `
      SELECT
        account_id,
        folder_id,
        subject,
        from_name,
        from_email,
        snippet
      FROM onemail_mail_messages
      WHERE message_id = :messageId
      `
    )
    .get({ messageId })

  if (!row) return

  db.prepare('DELETE FROM onemail_message_search WHERE message_id = :messageId').run({
    messageId
  })
  db.prepare(
    `
    INSERT INTO onemail_message_search (
      message_id,
      account_id,
      folder_id,
      subject,
      from_name,
      from_email,
      snippet,
      body_text
    )
    VALUES (
      :messageId,
      :accountId,
      :folderId,
      :subject,
      :fromName,
      :fromEmail,
      :snippet,
      :bodyText
    )
    `
  ).run({
    messageId,
    accountId: row.account_id,
    folderId: row.folder_id,
    subject: row.subject ?? '',
    fromName: row.from_name ?? '',
    fromEmail: row.from_email ?? '',
    snippet: row.snippet ?? '',
    bodyText
  })
}

function htmlToSearchText(value?: string): string | undefined {
  const text = value
    ?.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

  return text || undefined
}

function parseMimeMessage(rawMessage: string): ParsedMessageBody {
  const root = splitHeaderAndBody(rawMessage)
  const parts = flattenMimeParts(root.headers, root.body)
  const textPart = parts.find(
    (part) => !mapAttachmentPart(part) && getContentType(part.headers).mimeType === 'text/plain'
  )
  const htmlPart = parts.find(
    (part) => !mapAttachmentPart(part) && getContentType(part.headers).mimeType === 'text/html'
  )
  const attachments = parts
    .map((part) => mapAttachmentPart(part))
    .filter((attachment): attachment is ParsedMessageBody['attachments'][number] =>
      Boolean(attachment)
    )

  return {
    text: textPart ? decodePartBody(textPart) : undefined,
    html: htmlPart ? decodePartBody(htmlPart) : undefined,
    attachments
  }
}

export function parseMimeAttachments(rawMessage: string): ParsedMessageAttachment[] {
  const root = splitHeaderAndBody(rawMessage)
  return flattenMimeParts(root.headers, root.body)
    .map((part) => {
      const attachment = mapAttachmentPart(part)
      return attachment ? { ...attachment, content: decodePartBytes(part) } : null
    })
    .filter((attachment): attachment is ParsedMessageAttachment => Boolean(attachment))
}

function flattenMimeParts(
  headers: Map<string, string>,
  body: string,
  prefix = ''
): ParsedMimePart[] {
  const { mimeType, boundary } = getContentType(headers)
  if (
    !mimeType.startsWith('multipart/') ||
    !boundary ||
    (prefix && getContentDisposition(headers).value === 'attachment')
  ) {
    return [{ headers, body, partId: prefix || '1' }]
  }

  return splitMultipartBody(body, boundary).flatMap((part, index) => {
    const parsedPart = splitHeaderAndBody(part)
    return flattenMimeParts(
      parsedPart.headers,
      parsedPart.body,
      prefix ? `${prefix}.${index + 1}` : String(index + 1)
    )
  })
}

function splitHeaderAndBody(value: string): ParsedMimePart {
  const index = value.search(/\r?\n\r?\n/)
  if (index < 0) {
    return { headers: new Map(), body: value }
  }

  const separator = value.match(/\r?\n\r?\n/)
  const bodyStart = index + (separator?.[0].length ?? 0)
  return {
    headers: parseHeaders(value.slice(0, index)),
    body: value.slice(bodyStart)
  }
}

function parseHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>()
  let currentKey = ''

  for (const line of value.split(/\r?\n/)) {
    if (/^\s/.test(line) && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ''} ${line.trim()}`.trim())
      continue
    }

    const index = line.indexOf(':')
    if (index <= 0) continue
    currentKey = line.slice(0, index).trim().toLowerCase()
    headers.set(currentKey, line.slice(index + 1).trim())
  }

  return headers
}

function splitMultipartBody(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`
  const parts: string[] = []

  for (const segment of body.split(delimiter).slice(1)) {
    if (segment.startsWith('--')) break
    parts.push(segment.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
  }

  return parts
}

function mapAttachmentPart(part: ParsedMimePart): ParsedMessageBody['attachments'][number] | null {
  const contentType = getContentType(part.headers)
  const disposition = getContentDisposition(part.headers)
  const givenName = disposition.filename ?? contentType.name
  if (!givenName && disposition.value !== 'attachment' && contentType.mimeType.startsWith('text/'))
    return null
  const subtype = contentType.mimeType.split('/')[1]
  const filename =
    givenName ??
    `part-${part.partId ?? '1'}.${subtype === 'rfc822' ? 'eml' : contentType.mimeType.startsWith('multipart/') ? 'mime' : subtype}`

  return {
    partId: part.partId,
    contentId: part.headers.get('content-id'),
    filename,
    mimeType: contentType.mimeType,
    contentDisposition: disposition.value ?? 'attachment',
    sizeBytes: decodePartBytes(part).byteLength
  }
}

function decodePartBody(part: ParsedMimePart): string {
  return decodeBytes(decodePartBytes(part), getContentType(part.headers).charset)
}

export function decodeMimePart(headers: string, body: string): Buffer {
  return decodePartBytes({ headers: parseHeaders(headers), body })
}

function decodePartBytes(part: ParsedMimePart): Buffer {
  const encoding = part.headers.get('content-transfer-encoding')?.toLowerCase()

  if (encoding === 'base64') {
    return Buffer.from(part.body.replace(/\s+/g, ''), 'base64')
  }

  if (encoding === 'quoted-printable') {
    return Buffer.from(decodeQuotedPrintableBytes(part.body))
  }

  return Buffer.from(part.body, 'utf8')
}

function decodeQuotedPrintableBytes(value: string): Uint8Array {
  const normalized = value.replace(/=\r?\n/g, '')
  const bytes: number[] = []

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const hex = normalized.slice(index + 1, index + 3)
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2
      continue
    }

    bytes.push(char.charCodeAt(0) & 0xff)
  }

  return new Uint8Array(bytes)
}

function getContentType(headers: Map<string, string>): {
  mimeType: string
  charset: string
  boundary?: string
  name?: string
} {
  const value = headers.get('content-type') ?? 'text/plain'
  const params = parseHeaderParams(value)
  return {
    mimeType: value.split(';')[0]?.trim().toLowerCase() || 'text/plain',
    charset: params.get('charset') ?? 'utf-8',
    boundary: params.get('boundary'),
    name: readMimeFilename(params, 'name')
  }
}

function getContentDisposition(headers: Map<string, string>): {
  value?: 'attachment' | 'inline'
  filename?: string
} {
  const value = headers.get('content-disposition') ?? ''
  const params = parseHeaderParams(value)
  const disposition = value.split(';')[0]?.trim().toLowerCase()

  return {
    value:
      disposition === 'inline' ? 'inline' : disposition === 'attachment' ? 'attachment' : undefined,
    filename: readMimeFilename(params, 'filename')
  }
}

function parseHeaderParams(value: string): Map<string, string> {
  const params = new Map<string, string>()

  for (const segment of value.split(';').slice(1)) {
    const index = segment.indexOf('=')
    if (index <= 0) continue

    const key = segment.slice(0, index).trim().toLowerCase()
    const rawValue = segment
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, '')
    params.set(key, rawValue)
  }

  return params
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const normalized = charset.trim().replace(/^"|"$/g, '').toLowerCase()
  const labels =
    normalized === 'utf8' || normalized === 'utf-8'
      ? ['utf-8']
      : ['gb18030', 'gbk', 'gb2312', 'cp936'].includes(normalized)
        ? ['gb18030', 'gbk', 'utf-8']
        : [normalized, 'utf-8', 'windows-1252']

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes)
    } catch {
      continue
    }
  }

  return Buffer.from(bytes).toString('utf8')
}

/**
 * Cache preprocessing is deliberately policy-independent. Resource originals remain inert and
 * reversible; the reader's inert DOM parser/allowlist is the final security boundary (including
 * for old caches). Never persist a mode-specific rendering or discard blocked resource URLs.
 */
export function sanitizeCachedMailHtml(value?: string): string | undefined {
  if (!value) return undefined

  const sanitized = value
    .replace(
      /<(script|style|noscript|iframe|frame|frameset|object|embed|svg|math|template|audio|video|canvas)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
      ''
    )
    .replace(/<\/?(?:script|style|iframe|object|embed|base|meta|link)\b[^>]*>/gi, '')
    .replace(/<[a-z][\w:-]*(?:\s+(?:"[^"]*"|'[^']*'|[^'">])*)?\s*\/?>/gi, (tag) =>
      tag
        .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s(href)\s*=\s*("|')\s*javascript:[\s\S]*?\2/gi, '')
        .replace(
          /\s(src|srcset|poster|background|style)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi,
          (_match: string, attribute: string, equals: string, original: string) =>
            ` data-blocked-${attribute.toLowerCase()}${equals}${original}`
        )
    )
    .trim()

  return sanitized || undefined
}
