import { readFileSync, realpathSync, statSync } from 'node:fs'
import type { WebContents } from 'electron'
import { getDatabase, type SqliteDatabaseSync } from '../db/connection'
import { getOutboxRecord } from '../db/repositories/outbox.repository'
import type { MailSendInput } from '../../shared/types'
import type { ComposeAttachment } from '../mail/message-composer'

const selections = new WeakMap<
  WebContents,
  {
    database: SqliteDatabaseSync
    paths: Set<string>
  }
>()

export function authorizeSelectedFile(sender: WebContents, filePath: string): string {
  const path = realpathSync(filePath)
  const database = getDatabase()
  let selection = selections.get(sender)
  if (!selection || selection.database !== database) {
    selection = { database, paths: new Set() }
    selections.set(sender, selection)
  }
  selection.paths.add(path)
  return path
}

export function authorizeComposeAttachments(
  sender: WebContents,
  input: MailSendInput,
  readContent: boolean
): ComposeAttachment[] {
  const existing = input.outboxId ? getOutboxRecord(input.outboxId) : null
  if (existing && existing.accountId !== input.accountId) throw new Error('草稿与账号不匹配。')
  const selection = selections.get(sender)
  const selected = selection?.database === getDatabase() ? selection.paths : new Set<string>()
  let totalBytes = 0
  return (input.attachments ?? []).map((attachment) => {
    if (!attachment.filePath) return { ...attachment }
    const path = realpathSync(attachment.filePath)
    const persisted = existing?.attachments?.some((item) => item.filePath === path)
    if (!selected.has(path) && !persisted) {
      throw new Error('附件文件未经授权，请通过文件选择框重新选择。')
    }
    const stat = statSync(path)
    if (!stat.isFile()) throw new Error('附件不是普通文件。')
    totalBytes += stat.size
    if (totalBytes > 25 * 1024 * 1024) throw new Error('附件总大小超过 25MB，请减少附件后再发送。')
    return {
      ...attachment,
      filePath: path,
      sizeBytes: stat.size,
      content: readContent ? readFileSync(path) : undefined
    }
  })
}
