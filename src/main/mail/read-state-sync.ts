import type {
  MessageBulkReadStateResult,
  MessageListQuery,
  MessageReadStateUpdate
} from '../ipc/types'
import { getAccount } from '../db/repositories/account.repository'
import {
  getRemoteMessageIdentity,
  type RemoteMessageIdentity
} from '../db/repositories/remote-writeback.repository'
import {
  getMessageReadStateTarget,
  listUnreadMessageIds,
  type MessageReadStateTarget,
  updateMessageReadState
} from '../db/repositories/message.repository'
import { authenticateImapSession } from './imap-auth'
import { SimpleImapSession } from './imap-session'
import { selectAndVerifyRemoteMessage } from '../services/remote-writeback-imap'
import {
  markRemoteWritebackFailed,
  markRemoteWritebackRunning,
  markRemoteWritebackSuccess,
  queueRemoteWriteback
} from '../services/remote-writeback.service'

export async function syncMessageReadState(
  messageId: number,
  isRead: boolean
): Promise<MessageReadStateUpdate> {
  const target = getMessageReadStateTarget(messageId)
  if (!target) {
    throw new Error('邮件不存在或已从远端删除。')
  }

  if (target.isRead === isRead) {
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      isRead
    }
  }

  const account = getAccount(target.accountId)
  if (!account) {
    throw new Error(`Account not found: ${target.accountId}`)
  }

  if (account.receiveProtocol === 'pop3') {
    return updateMessageReadState(messageId, isRead)
  }

  const writeback = queueRemoteWriteback({
    accountId: target.accountId,
    messageId,
    operationKind: isRead ? 'mark_read' : 'mark_unread',
    payload: { isRead, folderPath: target.folderPath, uid: target.uid }
  })
  if (!markRemoteWritebackRunning(writeback.writebackId)) {
    throw new Error('无法启动远端写回。')
  }

  let client: SimpleImapSession | undefined
  try {
    client = await SimpleImapSession.connect(account, 'R')
    await authenticateImapSession(account, client)
    const identity = getRemoteMessageIdentity(messageId)
    if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
    assertTargetIdentity(target, identity)
    await selectAndVerifyRemoteMessage(client, identity)
    await client.setSeenFlag(identity.uid, isRead)
    markRemoteWritebackSuccess(writeback.writebackId)
  } catch (error) {
    markRemoteWritebackFailed(
      writeback.writebackId,
      error instanceof Error ? error.message : '同步已读状态失败。'
    )
    throw error
  } finally {
    await client?.logout().catch(() => undefined)
  }

  return updateMessageReadState(messageId, isRead)
}

export async function syncMessagesReadState(
  messageIds: number[],
  isRead: boolean
): Promise<MessageBulkReadStateResult> {
  const succeededMessageIds: number[] = []
  const updates: MessageReadStateUpdate[] = []
  const failedItems: MessageBulkReadStateResult['failedItems'] = []
  const targets = uniqueMessageIds(messageIds).map((messageId) => ({
    messageId,
    target: getMessageReadStateTarget(messageId)
  }))
  const groups = groupReadStateTargets(
    targets.filter(hasReadStateTarget).map((item) => item.target)
  )

  for (const { messageId, target } of targets) {
    if (!target) {
      failedItems.push({ messageId, error: '邮件不存在或已从远端删除。' })
    }
  }

  for (const group of groups) {
    const account = getAccount(group.accountId)
    if (!account) {
      for (const target of group.targets) {
        failedItems.push({
          messageId: target.messageId,
          accountId: target.accountId,
          error: `Account not found: ${target.accountId}`
        })
      }
      continue
    }

    if (account.receiveProtocol === 'pop3') {
      for (const target of group.targets) {
        updates.push(updateMessageReadState(target.messageId, isRead))
        succeededMessageIds.push(target.messageId)
      }
      continue
    }

    const pending: Array<{ target: MessageReadStateTarget; writebackId: number }> = []
    for (const target of group.targets) {
      if (target.isRead === isRead) {
        updates.push({
          messageId: target.messageId,
          accountId: target.accountId,
          folderId: target.folderId,
          isRead
        })
        succeededMessageIds.push(target.messageId)
        continue
      }
      try {
        const writeback = queueRemoteWriteback({
          accountId: target.accountId,
          messageId: target.messageId,
          operationKind: isRead ? 'mark_read' : 'mark_unread',
          payload: { isRead, folderPath: target.folderPath, uid: target.uid }
        })
        if (!markRemoteWritebackRunning(writeback.writebackId)) {
          throw new Error('无法启动远端写回。')
        }
        pending.push({ target, writebackId: writeback.writebackId })
      } catch (error) {
        failedItems.push({
          messageId: target.messageId,
          accountId: target.accountId,
          error: getReadStateErrorMessage(error)
        })
      }
    }
    if (pending.length === 0) continue

    let client: SimpleImapSession | undefined
    try {
      client = await SimpleImapSession.connect(account, 'R')
      await authenticateImapSession(account, client)
      await client.selectMailbox(group.folderPath)
    } catch (error) {
      const message = getReadStateErrorMessage(error)
      for (const { target, writebackId } of pending) {
        markRemoteWritebackFailed(writebackId, message)
        failedItems.push({
          messageId: target.messageId,
          accountId: target.accountId,
          error: message
        })
      }
      await client?.logout().catch(() => undefined)
      continue
    }

    try {
      for (const { target, writebackId } of pending) {
        try {
          const identity = getRemoteMessageIdentity(target.messageId)
          if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
          assertTargetIdentity(target, identity)
          await selectAndVerifyRemoteMessage(client, identity)
          await client.setSeenFlag(identity.uid, isRead)
        } catch (error) {
          const message = getReadStateErrorMessage(error)
          markRemoteWritebackFailed(writebackId, message)
          failedItems.push({
            messageId: target.messageId,
            accountId: target.accountId,
            error: message
          })
          continue
        }
        markRemoteWritebackSuccess(writebackId)
        try {
          updates.push(updateMessageReadState(target.messageId, isRead))
          succeededMessageIds.push(target.messageId)
        } catch (error) {
          // Remote STORE succeeded; a local database failure is not a remote failure.
          failedItems.push({
            messageId: target.messageId,
            accountId: target.accountId,
            error: `远端写回成功，但本地状态更新失败：${getReadStateErrorMessage(error)}`
          })
        }
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
  }

  return {
    isRead,
    updates,
    succeededMessageIds,
    failedItems,
    updatedCount: succeededMessageIds.length,
    failedCount: failedItems.length
  }
}

export async function markUnreadMessagesRead(
  query?: MessageListQuery
): Promise<MessageBulkReadStateResult> {
  const messageIds = listUnreadMessageIds(query)
  return syncMessagesReadState(messageIds, true)
}

function assertTargetIdentity(
  target: MessageReadStateTarget,
  identity: RemoteMessageIdentity
): void {
  if (
    identity.accountId !== target.accountId ||
    identity.folderId !== target.folderId ||
    identity.folderPath !== target.folderPath ||
    identity.uid !== target.uid
  ) {
    throw new Error('邮件的位置或 UIDVALIDITY 已变化，已停止写回；请先同步邮件。')
  }
}

function groupReadStateTargets(targets: MessageReadStateTarget[]): Array<{
  accountId: number
  folderId: number
  folderPath: string
  targets: MessageReadStateTarget[]
}> {
  const groups = new Map<
    string,
    {
      accountId: number
      folderId: number
      folderPath: string
      targets: MessageReadStateTarget[]
    }
  >()

  for (const target of targets) {
    const key = `${target.accountId}:${target.folderId}`
    const group = groups.get(key) ?? {
      accountId: target.accountId,
      folderId: target.folderId,
      folderPath: target.folderPath,
      targets: []
    }
    group.targets.push(target)
    groups.set(key, group)
  }

  return Array.from(groups.values())
}

function hasReadStateTarget(item: {
  messageId: number
  target: MessageReadStateTarget | null
}): item is { messageId: number; target: MessageReadStateTarget } {
  return item.target !== null
}

function uniqueMessageIds(messageIds: number[]): number[] {
  return Array.from(
    new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))
  )
}

function getReadStateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '同步已读状态失败。'
}
