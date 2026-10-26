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
import { parseMimeAttachments, type ParsedMessageAttachment } from './body-loader'
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
}

export async function downloadAttachment(attachmentId: number): Promise<AttachmentDownloadResult> {
  const locator = getAttachmentDownloadLocator(attachmentId)
  if (!locator) throw new Error(`Attachment not found: ${attachmentId}`)

  const saveResult = await dialog.showSaveDialog({
    title: '下载附件',
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

  return loadAttachmentContentByLocator(locator)
}

async function loadAttachmentContentByLocator(
  locator: AttachmentDownloadRow
): Promise<ParsedMessageAttachment> {
  const account = getAccount(locator.account_id)
  if (!account) throw new Error(`Account not found: ${locator.account_id}`)

  if (locator.raw_source) {
    const attachment = findMatchingAttachment(parseMimeAttachments(locator.raw_source), locator)
    if (!attachment) throw new Error('未找到可下载的附件内容。')
    return attachment
  }
  if (locator.remote_missing) {
    throw new Error('远端原位置已不存在，且本地未缓存该附件，无法下载。')
  }

  const client = await SimpleImapSession.connect(account, 'D')
  try {
    await authenticateImapSession(account, client)
    const identity = getRemoteMessageIdentity(locator.message_id)
    if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
    const rawMessage = await fetchVerifiedRemoteMessage(client, identity)
    const attachment = findMatchingAttachment(parseMimeAttachments(rawMessage), locator)
    if (!attachment) throw new Error('未找到可下载的附件内容。')

    return attachment
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
        a.size_bytes
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
  const filename = toOptionalString(locator.filename)
  const mimeType = toOptionalString(locator.mime_type)
  const sizeBytes = toNumber(locator.size_bytes)

  return (
    attachments.find(
      (attachment) =>
        attachment.filename === filename &&
        attachment.mimeType === mimeType &&
        attachment.sizeBytes === sizeBytes
    ) ??
    attachments.find(
      (attachment) => attachment.filename === filename && attachment.sizeBytes === sizeBytes
    ) ??
    attachments.find((attachment) => attachment.filename === filename)
  )
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
