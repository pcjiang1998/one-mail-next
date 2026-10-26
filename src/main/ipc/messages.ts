import { handleDatabaseIpc } from './database-handler'
import {
  getMessage,
  listAccountMailboxStats,
  listMessages,
  loadMessageBody
} from '../db/repositories/message.repository'
import { downloadAttachment, touchMessageAccess } from '../mail/attachment-downloader'
import { loadMessageBodyFromImap } from '../mail/body-loader'
import {
  markUnreadMessagesRead,
  syncMessageReadState,
  syncMessagesReadState
} from '../mail/read-state-sync'
import type { MessageBulkReadStateInput, MessageListQuery, MessageMarkAllReadInput } from './types'

export function registerMessageIpc(): void {
  handleDatabaseIpc('messages/access', (_event, messageId: number) => touchMessageAccess(messageId))
  handleDatabaseIpc('messages/list', (_event, query?: MessageListQuery) => listMessages(query))
  handleDatabaseIpc('messages/stats', () => listAccountMailboxStats())
  handleDatabaseIpc('messages/get', (_event, messageId: number) => getMessage(messageId))
  handleDatabaseIpc('messages/loadBody', async (_event, messageId: number) => {
    const cachedBody = loadMessageBody(messageId)
    if (cachedBody) return { body: cachedBody }

    try {
      return { body: await loadMessageBodyFromImap(messageId) }
    } catch (error) {
      return {
        body: null,
        error: error instanceof Error ? error.message : '加载邮件正文失败。',
        remoteMissing: getMessage(messageId)?.remoteMissing
      }
    }
  })
  handleDatabaseIpc('messages/setReadState', (_event, messageId: number, isRead: boolean) =>
    syncMessageReadState(messageId, isRead)
  )
  handleDatabaseIpc('messages/bulkSetReadState', (_event, input: MessageBulkReadStateInput) =>
    syncMessagesReadState(input.messageIds, input.isRead)
  )
  handleDatabaseIpc('messages/markAllRead', (_event, input?: MessageMarkAllReadInput) =>
    markUnreadMessagesRead(input?.query)
  )
  handleDatabaseIpc('messages/downloadAttachment', (_event, attachmentId: number) =>
    downloadAttachment(attachmentId)
  )
}
