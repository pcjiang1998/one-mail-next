import { app, dialog } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getAccount } from '../db/repositories/account.repository'
import {
  getLastAttachmentDownloadDir,
  setLastAttachmentDownloadDir
} from '../db/repositories/settings.repository'
import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../db/connection'
import type { AttachmentDownloadResult } from '../ipc/types'
import { SimpleImapSession } from './imap-session'
import {
  decodeMimePart,
  parseMimeAttachments,
  persistRawMessageBody,
  retrievePop3Message,
  type ParsedMessageAttachment
} from './body-loader'
import { withMessageCacheAccess } from '../services/cache-activity'
import { authenticateImapSession } from './imap-auth'
import { getRemoteMessageIdentity } from '../db/repositories/remote-writeback.repository'
import { markMessageRemoteMissing } from '../db/repositories/message.repository'
import { fetchVerifiedRemoteMessage } from '../services/remote-writeback-imap'
import { broadcastWritebackChanged } from '../services/remote-writeback.service'
import { RemoteMessageMissingError } from './remote-message-error'

type AttachmentDownloadRow = SqliteRow & {
  attachment_id: number
  message_id: number
  account_id: number
  folder_path: string
  uid: number
  filename: string
  mime_type: string | null
  size_bytes: number
  raw_source: string | null
  remote_missing: number
  part_id: string | null
  cached_content: Uint8Array | null
}

export async function downloadAttachment(attachmentId: number): Promise<AttachmentDownloadResult> {
  const locator = getAttachmentDownloadLocator(attachmentId)
  if (!locator) throw new Error(`Attachment not found: ${attachmentId}`)
  touchMessageAccess(locator.message_id)

  return withMessageCacheAccess(locator.message_id, async () => {
    const saveResult = await dialog.showSaveDialog({
      title: '保存附件',
      defaultPath: join(getDefaultAttachmentDownloadDir(), sanitizeFileName(locator.filename)),
      filters: [{ name: '附件', extensions: [getFileExtension(locator.filename) ?? '*'] }]
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { downloaded: false, attachmentId }
    }

    const attachment = await loadAttachmentContentByLocator(locator)
    writeFileSync(saveResult.filePath, attachment.content)
    setLastAttachmentDownloadDir(dirname(saveResult.filePath))

    return {
      downloaded: true,
      attachmentId,
      filePath: saveResult.filePath
    }
  })
}

function getDefaultAttachmentDownloadDir(): string {
  const lastDirectory = getLastAttachmentDownloadDir()
  if (lastDirectory && existsSync(lastDirectory)) return lastDirectory

  return app.getPath('downloads')
}

export async function loadAttachmentContent(
  attachmentId: number
): Promise<ParsedMessageAttachment> {
  const locator = getAttachmentDownloadLocator(attachmentId)
  if (!locator) throw new Error(`Attachment not found: ${attachmentId}`)

  return withMessageCacheAccess(locator.message_id, () => loadAttachmentContentByLocator(locator))
}

export function touchMessageAccess(messageId: number): void {
  getDatabase()
    .prepare(
      `UPDATE onemail_mail_messages
    SET last_user_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE message_id = :messageId`
    )
    .run({ messageId })
}

async function loadAttachmentContentByLocator(
  locator: AttachmentDownloadRow
): Promise<ParsedMessageAttachment> {
  if (locator.cached_content !== null) {
    return {
      filename: locator.filename,
      mimeType: locator.mime_type ?? undefined,
      sizeBytes: locator.cached_content.byteLength,
      content: Buffer.from(locator.cached_content)
    }
  }
  const account = getAccount(locator.account_id)
  if (!account) throw new Error(`Account not found: ${locator.account_id}`)

  if (locator.raw_source) {
    if (!locator.part_id) {
      return cacheRawAttachment(locator, locator.raw_source)
    }
    const attachment = findMatchingAttachment(parseMimeAttachments(locator.raw_source), locator)
    if (!attachment) throw new Error('未找到可下载的附件内容。')
    return attachment
  }
  if (locator.remote_missing) {
    throw new Error('远端原位置已不存在，且本地未缓存该附件，无法下载。')
  }
  if (account.receiveProtocol === 'pop3') {
    const raw = await retrievePop3Message(locator.message_id)
    return cacheRawAttachment(locator, raw)
  }

  const client = await SimpleImapSession.connect(account, 'D')
  try {
    await authenticateImapSession(account, client)
    const identity = getRemoteMessageIdentity(locator.message_id)
    if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
    if (locator.part_id) {
      await fetchVerifiedRemoteMessage(client, identity, true)
      const mimeHeaders = await client.fetchBodySection(identity.uid, `${locator.part_id}.MIME`)
      const encoded = await client.fetchBodySection(identity.uid, locator.part_id)
      const content = decodeMimePart(mimeHeaders, encoded)
      getDatabase()
        .prepare(
          `UPDATE onemail_message_attachments
        SET cached_content = :content, size_bytes = :sizeBytes WHERE attachment_id = :attachmentId`
        )
        .run({ attachmentId: locator.attachment_id, content, sizeBytes: content.byteLength })
      return {
        filename: locator.filename,
        mimeType: locator.mime_type ?? undefined,
        sizeBytes: content.byteLength,
        content
      }
    }
    const rawMessage = await fetchVerifiedRemoteMessage(client, identity)
    return cacheRawAttachment(locator, rawMessage)
  } catch (error) {
    if (error instanceof RemoteMessageMissingError) {
      markMessageRemoteMissing(locator.message_id)
      broadcastWritebackChanged()
      throw new Error('远端原位置已不存在，且本地未缓存该附件，无法下载。')
    }
    throw error
  } finally {
    await client.logout().catch(() => undefined)
  }
}

function cacheRawAttachment(locator: AttachmentDownloadRow, raw: string): ParsedMessageAttachment {
  persistRawMessageBody(locator.message_id, raw)
  const refreshed = getAttachmentDownloadLocator(locator.attachment_id)
  if (!refreshed?.part_id) throw new Error('旧附件缺少可确认的 MIME 部件标识，未保存文件。')
  const attachment = findMatchingAttachment(parseMimeAttachments(raw), refreshed)
  if (!attachment) throw new Error('未找到可下载的附件内容。')
  return attachment
}

function getAttachmentDownloadLocator(attachmentId: number): AttachmentDownloadRow | null {
  const row = getDatabase()
    .prepare<AttachmentDownloadRow>(
      `
      SELECT
        a.attachment_id,
        a.message_id,
        m.account_id,
        f.path AS folder_path,
        m.uid,
        m.remote_missing,
        a.filename,
        a.mime_type,
        a.size_bytes,
        a.part_id,
        a.cached_content
        , b.raw_source
      FROM onemail_message_attachments a
      JOIN onemail_mail_messages m ON m.message_id = a.message_id
      JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
      LEFT JOIN onemail_message_bodies b ON b.message_id = m.message_id
      WHERE a.attachment_id = :attachmentId
      `
    )
    .get({ attachmentId })

  return row ?? null
}

function findMatchingAttachment(
  attachments: ParsedMessageAttachment[],
  locator: AttachmentDownloadRow
): ParsedMessageAttachment | undefined {
  if (locator.part_id) {
    return attachments.find((attachment) => attachment.partId === locator.part_id)
  }
  const filename = toOptionalString(locator.filename)
  const mimeType = toOptionalString(locator.mime_type)
  const sizeBytes = toNumber(locator.size_bytes)

  const matches = attachments.filter(
    (attachment) =>
      attachment.filename === filename &&
      attachment.mimeType === mimeType &&
      attachment.sizeBytes === sizeBytes
  )
  if (matches.length > 1) throw new Error('存在多个同名附件，无法确认要保存的附件。')
  return matches[0]
}

function sanitizeFileName(value: string): string {
  const fileName = basename(value)
    .split('')
    .map((char) => (isUnsafeFileNameChar(char) ? '_' : char))
    .join('')
    .trim()
  return fileName || 'attachment'
}

function isUnsafeFileNameChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char)
}

function getFileExtension(value: string): string | undefined {
  const fileName = basename(value)
  const extension = fileName.includes('.') ? fileName.split('.').at(-1) : undefined
  return extension && /^[a-z0-9]+$/i.test(extension) ? extension : undefined
}
