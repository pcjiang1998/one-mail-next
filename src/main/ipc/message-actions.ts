import { handleDatabaseIpc } from './database-handler'
import {
  bulkDelete,
  deleteMessageToTrash,
  hideMessageLocally,
  permanentlyDeleteMessage,
  restoreMessage
} from '../mail/message-delete'
import type {
  MessageBulkDeleteInput,
  MessageBulkDeleteResult,
  MessageDeleteInput,
  MessageDeleteMode,
  MessageDeleteResult,
  MessageRestoreResult
} from './types'

export function registerMessageActionIpc(): void {
  handleDatabaseIpc('messages/delete', async (_event, input: MessageDeleteInput) => {
    return deleteOneMessage(input)
  })
  handleDatabaseIpc('messages/bulkDelete', async (_event, input: MessageBulkDeleteInput) => {
    const mode = normalizeDeleteMode(input.mode)
    const result = await bulkDelete(input.messageIds, {
      localOnly: mode === 'local_hide',
      permanent: mode === 'permanent'
    })

    return {
      mode,
      succeededMessageIds: result.succeededMessageIds,
      failedItems: result.failedItems,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount
    } satisfies MessageBulkDeleteResult
  })
  handleDatabaseIpc('messages/hideLocal', (_event, messageId: number) => {
    const result = hideMessageLocally(messageId)
    return toDeleteResult(result.messageId, result.accountId, 'local_hide', true, true)
  })
  handleDatabaseIpc('messages/restore', async (_event, messageId: number) => {
    const result = await restoreMessage(messageId)
    return {
      messageId: result.messageId,
      accountId: result.accountId,
      restored: true,
      localOnly: Boolean(result.localOnly)
    } satisfies MessageRestoreResult
  })
}

async function deleteOneMessage(input: MessageDeleteInput): Promise<MessageDeleteResult> {
  const mode = normalizeDeleteMode(input.mode)

  if (mode === 'local_hide') {
    const result = hideMessageLocally(input.messageId)
    return toDeleteResult(result.messageId, result.accountId, mode, true, true)
  }

  const result =
    mode === 'permanent'
      ? await permanentlyDeleteMessage(input.messageId)
      : await deleteMessageToTrash(input.messageId)

  const actualMode =
    result.action === 'local_hide'
      ? 'local_hide'
      : result.action === 'permanent_delete'
        ? 'permanent'
        : 'trash'
  return toDeleteResult(
    result.messageId,
    result.accountId,
    actualMode,
    true,
    Boolean(result.localOnly)
  )
}

function normalizeDeleteMode(mode?: MessageDeleteMode): MessageDeleteMode {
  if (mode === 'local_hide' || mode === 'permanent') return mode
  return 'trash'
}

function toDeleteResult(
  messageId: number,
  accountId: number | undefined,
  mode: MessageDeleteMode,
  deleted: boolean,
  localOnly: boolean
): MessageDeleteResult {
  return {
    messageId,
    accountId,
    mode,
    deleted,
    localOnly
  }
}
