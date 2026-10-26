import { handleDatabaseIpc } from './database-handler'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { getAccount } from '../db/repositories/account.repository'
import {
  createOutboxRecord,
  deleteOutboxRecord,
  deleteDraftRecords,
  clearOutboxRecords,
  getOutboxRecord,
  listOutboxRecords,
  listDraftRecords,
  updateOutboxRecord,
  type OutboxRecord
} from '../db/repositories/outbox.repository'
import { createForwardDraft } from '../mail/forward-draft'
import { createBulkForwardDraft } from '../mail/bulk-forward-draft'
import { createMessageId } from '../mail/message-composer'
import { createReplyDraft } from '../mail/reply-draft'
import { resolveAccountSignature } from '../db/repositories/settings.repository'
import { retryOutboxEmail, sendPlainTextEmail } from '../mail/smtp-send'
import { authorizeComposeAttachments, authorizeSelectedFile } from '../services/compose-file-access'
import type { DraftListQuery, DraftListResult } from '../../shared/types'
import type {
  ComposeDraft,
  BulkForwardDraftInput,
  ForwardDraftInput,
  MailAttachmentInput,
  MailSendInput,
  MailSendResult,
  OutboxListQuery,
  OutboxMessage,
  InlineImageSelection,
  ReplyDraftInput
} from './types'

export function registerComposeIpc(): void {
  handleDatabaseIpc(
    'compose/createNewDraft',
    (_event, accountId: number) =>
      ({
        accountId,
        mode: 'new',
        to: [],
        cc: [],
        bcc: [],
        subject: '',
        bodyText: applySignature('', resolveAccountSignature(accountId))
      }) satisfies ComposeDraft
  )
  handleDatabaseIpc('compose/createReplyDraft', async (_event, input: ReplyDraftInput) => {
    const draft = await createReplyDraft(input.messageId, input.mode)
    return {
      accountId: draft.accountId,
      mode: draft.composeKind,
      relatedMessageId: draft.relatedMessageId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyText: applySignature(draft.bodyText, resolveAccountSignature(draft.accountId)),
      bodyHtml: undefined,
      inReplyTo: draft.inReplyTo,
      referencesHeader: draft.references
    } satisfies ComposeDraft
  })

  handleDatabaseIpc('compose/createForwardDraft', async (_event, input: ForwardDraftInput) => {
    const draft = await createForwardDraft(input.messageId)
    return {
      accountId: draft.accountId,
      mode: draft.composeKind,
      relatedMessageId: draft.relatedMessageId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      bodyText: applySignature(draft.bodyText, resolveAccountSignature(draft.accountId)),
      bodyHtml: undefined,
      forwardAttachments: draft.attachmentCandidates.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        selected: attachment.selected
      }))
    } satisfies ComposeDraft
  })

  handleDatabaseIpc(
    'compose/createBulkForwardDraft',
    async (_event, input: BulkForwardDraftInput) => {
      const draft = await createBulkForwardDraft(input.messageIds)
      return {
        ...draft,
        bodyText: applySignature(draft.bodyText, resolveAccountSignature(draft.accountId))
      }
    }
  )

  handleDatabaseIpc(
    'compose/send',
    async (event, input: MailSendInput): Promise<MailSendResult> => {
      const attachments = authorizeComposeAttachments(event.sender, input, true)
      const result = await sendPlainTextEmail({
        outboxId: input.outboxId,
        accountId: input.accountId,
        composeKind: input.mode,
        relatedMessageId: input.relatedMessageId,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        inReplyTo: input.inReplyTo,
        references: input.referencesHeader,
        attachments
      })
      const sentAt = result.date.toISOString()

      const payload: MailSendResult = {
        outboxId: result.outboxId ?? 0,
        accountId: input.accountId,
        status: 'sent',
        rfc822MessageId: result.messageId,
        sentAt,
        warning: result.warning
      }
      broadcastSent(payload)
      return payload
    }
  )

  handleDatabaseIpc('compose/selectAttachments', async (event): Promise<MailAttachmentInput[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []

    return result.filePaths.map((selectedPath) => {
      const filePath = authorizeSelectedFile(event.sender, selectedPath)
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        throw new Error(`附件不是普通文件：${filePath}`)
      }

      return {
        filePath,
        filename: basename(filePath),
        sizeBytes: stat.size
      } satisfies MailAttachmentInput
    })
  })

  handleDatabaseIpc(
    'compose/selectInlineImage',
    async (event): Promise<InlineImageSelection | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) return null
      const content = readFileSync(filePath)
      if (content.byteLength > 8 * 1024 * 1024) throw new Error('内联图片不能超过 8 MB。')
      const mimeType = getImageMimeType(extname(filePath))
      return {
        filename: basename(filePath),
        mimeType,
        dataUrl: `data:${mimeType};base64,${content.toString('base64')}`
      }
    }
  )

  handleDatabaseIpc('compose/listOutbox', (_event, query?: OutboxListQuery): OutboxMessage[] =>
    listOutboxRecords({
      statuses: query?.statuses,
      limit: query?.limit
    }).map(toOutboxMessage)
  )

  handleDatabaseIpc('compose/listDrafts', (_event, query?: DraftListQuery): DraftListResult => {
    const result = listDraftRecords(query)
    return { ...result, messages: result.messages.map(toOutboxMessage) }
  })

  handleDatabaseIpc('compose/saveDraft', (event, input: MailSendInput): OutboxMessage => {
    const account = getAccount(input.accountId)
    if (!account) throw new Error(`Account not found: ${input.accountId}`)

    const draftInput = {
      accountId: input.accountId,
      relatedMessageId: input.relatedMessageId,
      composeKind: input.mode,
      status: 'draft' as const,
      rfc822MessageId: createMessageId(account.email),
      inReplyTo: input.inReplyTo,
      referencesHeader: input.referencesHeader,
      from: {
        name: account.displayName ?? account.accountLabel,
        email: account.email
      },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      attachments: authorizeComposeAttachments(event.sender, input, false)
    }
    const record = input.outboxId
      ? updateOutboxRecord(input.outboxId, draftInput)
      : createOutboxRecord(draftInput)

    return toOutboxMessage(record)
  })
  handleDatabaseIpc('compose/deleteDraft', (_event, outboxId: number) => {
    const record = requireOutboxRecord(outboxId)
    if (record.status !== 'draft') throw new Error('只能删除草稿记录。')
    return deleteOutboxRecord(outboxId)
  })
  handleDatabaseIpc('compose/retry', async (_event, outboxId: number): Promise<MailSendResult> => {
    const result = await retryOutboxEmail(outboxId)
    const record = requireOutboxRecord(outboxId)
    const payload: MailSendResult = {
      outboxId,
      accountId: record.accountId,
      status: 'sent',
      rfc822MessageId: result.messageId,
      sentAt: result.date.toISOString(),
      warning: result.warning
    }
    broadcastSent(payload)
    return payload
  })
  handleDatabaseIpc('compose/deleteDrafts', (_event, outboxIds: number[]) =>
    deleteDraftRecords(outboxIds)
  )
  handleDatabaseIpc('compose/clearOutbox', (_event, status: 'sent' | 'failed') =>
    clearOutboxRecords(status)
  )
  handleDatabaseIpc('compose/deleteOutbox', (_event, outboxId: number) => {
    const record = requireOutboxRecord(outboxId)
    if (record.status === 'sending') throw new Error('发送中的记录不能直接删除。')
    return deleteOutboxRecord(outboxId)
  })
}

function applySignature(bodyText: string | undefined, signature: string | undefined): string {
  const body = bodyText ?? ''
  const content = signature?.trim()
  if (!content) return body
  const signatureBlock = `-- \n${content}`
  const separatorMatch = /\n(?=(?:On .+ wrote:|---------- Forwarded message ----------))/i.exec(
    body
  )
  if (!separatorMatch || separatorMatch.index < 0) {
    return body.trim() ? `${body.trimEnd()}\n\n${signatureBlock}` : signatureBlock
  }
  const before = body.slice(0, separatorMatch.index).trimEnd()
  const after = body.slice(separatorMatch.index).replace(/^\s*/, '')
  return `${before}${before ? '\n\n' : ''}${signatureBlock}\n\n${after}`
}

function getImageMimeType(extension: string): string {
  const normalized = extension.toLowerCase()
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.gif') return 'image/gif'
  if (normalized === '.webp') return 'image/webp'
  return 'image/png'
}

function broadcastSent(result: MailSendResult): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('compose/sent', result)
    }
  }
}

function requireOutboxRecord(outboxId: number): OutboxRecord {
  const record = getOutboxRecord(outboxId)
  if (!record) throw new Error('发送记录不存在。')
  return record
}

function toOutboxMessage(record: OutboxRecord): OutboxMessage {
  return {
    outboxId: record.outboxId,
    accountId: record.accountId,
    relatedMessageId: record.relatedMessageId,
    composeKind: record.composeKind,
    status: record.status,
    rfc822MessageId: record.rfc822MessageId,
    from: record.from,
    subject: record.subject,
    bodyText: record.bodyText,
    bodyHtml: record.bodyHtml,
    inReplyTo: record.inReplyTo,
    referencesHeader: record.referencesHeader,
    attachments: record.attachments?.map((attachment) => ({
      filePath: attachment.filePath,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sourceMessageId: attachment.sourceMessageId,
      sourceAttachmentId: attachment.sourceAttachmentId
    })),
    to: record.to,
    cc: record.cc ?? [],
    bcc: record.bcc ?? [],
    sentAt: record.sentAt,
    deletedAt: record.deletedAt,
    lastError: record.lastError,
    lastWarning: record.lastWarning,
    deliveryUncertain: record.deliveryUncertain,
    createdAt: record.createdAt ?? '',
    updatedAt: record.updatedAt ?? ''
  }
}
