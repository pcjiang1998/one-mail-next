import { ipcMain } from 'electron'
import {
  getMessage,
  listAccountMailboxStats,
  listMessages,
  loadMessageBody
} from '../db/repositories/message.repository'
import { downloadAttachment } from '../mail/attachment-downloader'
import { loadMessageBodyFromImap } from '../mail/body-loader'
import {
  markUnreadMessagesRead,
  syncMessageReadState,
  syncMessagesReadState
} from '../mail/read-state-sync'
import type { MessageBulkReadStateInput, MessageListQuery, MessageMarkAllReadInput } from './types'

export function registerMessageIpc(): void {
  ipcMain.handle('messages/list', (_event, query?: MessageListQuery) => listMessages(query))
  ipcMain.handle('messages/stats', () => listAccountMailboxStats())
  ipcMain.handle('messages/get', (_event, messageId: number) => getMessage(messageId))
  ipcMain.handle('messages/loadBody', async (_event, messageId: number) => {
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
  ipcMain.handle('messages/setReadState', (_event, messageId: number, isRead: boolean) =>
    syncMessageReadState(messageId, isRead)
  )
  ipcMain.handle('messages/bulkSetReadState', (_event, input: MessageBulkReadStateInput) =>
    syncMessagesReadState(input.messageIds, input.isRead)
  )
  ipcMain.handle('messages/markAllRead', (_event, input?: MessageMarkAllReadInput) =>
    markUnreadMessagesRead(input?.query)
  )
  ipcMain.handle('messages/downloadAttachment', (_event, attachmentId: number) =>
    downloadAttachment(attachmentId)
  )
}
