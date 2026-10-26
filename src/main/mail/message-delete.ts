import { getAccount } from '../db/repositories/account.repository'
import {
  getRemoteMessageIdentity,
  type RemoteMessageIdentity
} from '../db/repositories/remote-writeback.repository'
import { requireUidExpunge, selectAndVerifyRemoteMessage } from '../services/remote-writeback-imap'
import {
  getMessageDeleteTarget,
  markMessageDeleteError,
  markMessageMovedToTrash,
  markMessageMoved,
  markMessageRemoteMissing,
  markMessageRemoteDeleted,
  restoreMessageLocally,
  markMessageUserHidden,
  type MessageDeleteTarget
} from '../db/repositories/message.repository'
import { authenticateImapSession } from './imap-auth'
import { SimpleImapSession } from './imap-session'
import { detectSpecialFolderRole, findFolderByRole } from './special-folders'
import {
  markRemoteWritebackFailed,
  markRemoteWritebackRunning,
  markRemoteWritebackSuccess,
  queueRemoteWriteback
} from '../services/remote-writeback.service'

export type MessageDeleteResult = {
  messageId: number
  accountId: number
  folderId: number
  action: 'trash' | 'permanent_delete' | 'local_hide' | 'restore'
  localOnly?: boolean
}

export type BulkDeleteOptions = {
  localOnly?: boolean
  permanent?: boolean
}

export type BulkDeleteFailure = {
  messageId: number
  error: string
}

export type BulkDeleteResult = {
  succeededMessageIds: number[]
  failedItems: BulkDeleteFailure[]
  deletedCount: number
  failedCount: number
}

export async function permanentlyDeleteMessage(messageId: number): Promise<MessageDeleteResult> {
  const target = requireDeleteTarget(messageId)

  const account = getAccount(target.accountId)
  if (!account) throw new Error(`Account not found: ${target.accountId}`)

  if (account.receiveProtocol === 'pop3' || target.remoteMissing) {
    markMessageRemoteDeleted(messageId)
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      action: 'permanent_delete',
      localOnly: true
    }
  }

  const identity = getRemoteMessageIdentity(messageId)
  if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
  assertTargetIdentity(target, identity)

  const writeback = queueRemoteWriteback({
    accountId: target.accountId,
    messageId,
    operationKind: 'permanent_delete',
    payload: { permanent: true, folderPath: target.folderPath, uid: target.uid }
  })
  if (!markRemoteWritebackRunning(writeback.writebackId)) throw new Error('无法启动远端写回。')

  let client: SimpleImapSession | undefined
  let remoteSucceeded = false
  try {
    client = await SimpleImapSession.connect(account, 'P')
    await authenticateImapSession(account, client)
    const expungeUid = requireUidExpunge(client, await client.capability())
    const location = await resolvePermanentDeleteLocation(client, target)
    await selectAndVerifyRemoteMessage(client, {
      ...identity,
      accountId: target.accountId,
      folderId: target.folderId,
      folderPath: location.folderPath,
      uid: location.uid,
      uidValidity:
        location.folderPath === target.folderPath
          ? getRemoteMessageIdentity(messageId)?.uidValidity
          : undefined,
      rfc822MessageId: target.rfc822MessageId
    })
    await client.setDeletedFlag(location.uid, true)
    await expungeUid(location.uid)
    remoteSucceeded = true
    markRemoteWritebackSuccess(writeback.writebackId)
    markMessageRemoteDeleted(messageId)

    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      action: 'permanent_delete'
    }
  } catch (error) {
    const message = getErrorMessage(error)
    markMessageDeleteError(messageId, message)
    if (!remoteSucceeded) markRemoteWritebackFailed(writeback.writebackId, message)
    throw error
  } finally {
    await client?.logout().catch(() => undefined)
  }
}

export async function deleteMessageToTrash(messageId: number): Promise<MessageDeleteResult> {
  const target = requireDeleteTarget(messageId)

  if (requiresPermanentRemoteDelete(target)) {
    return permanentlyDeleteMessage(messageId)
  }

  return hideMessageLocally(messageId)
}

async function resolvePermanentDeleteLocation(
  client: SimpleImapSession,
  target: MessageDeleteTarget
): Promise<{ folderPath: string; uid: number }> {
  if (!target.userDeleted || isTrashTarget(target)) {
    return { folderPath: target.folderPath, uid: target.uid }
  }

  const trash = findFolderByRole(target.accountId, 'trash')
  if (!trash || !target.rfc822MessageId) {
    throw new Error('无法定位远端已删除邮件，请先同步该邮箱后重试。')
  }

  await client.selectMailbox(trash.path)
  const uids = await client.searchByMessageId(target.rfc822MessageId)
  if (uids.length === 0) throw new Error('远端已删除邮件不存在，请同步该邮箱后重试。')
  if (uids.length !== 1)
    throw new Error('远端存在多封相同 Message-ID 的邮件，已停止永久删除以避免误删。')
  return { folderPath: trash.path, uid: uids[0] }
}

export function hideMessageLocally(messageId: number): MessageDeleteResult {
  const target = requireDeleteTarget(messageId)
  markMessageUserHidden(messageId)

  return {
    messageId,
    accountId: target.accountId,
    folderId: target.folderId,
    action: 'local_hide'
  }
}

export async function restoreMessage(messageId: number): Promise<MessageDeleteResult> {
  const target = requireRestoreTarget(messageId)

  if (target.remoteMissing || (target.userHidden && !target.userDeleted)) {
    restoreMessageLocally(messageId)
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      action: 'restore',
      localOnly: true
    }
  }

  if (!isTrashTarget(target)) {
    restoreMessageLocally(messageId)
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      action: 'restore',
      localOnly: true
    }
  }

  const inbox = findFolderByRole(target.accountId, 'inbox')
  if (!inbox) throw new Error('未找到该账号的收件箱，无法恢复邮件。')

  const account = getAccount(target.accountId)
  if (!account) throw new Error(`Account not found: ${target.accountId}`)

  if (account.receiveProtocol === 'pop3') {
    restoreMessageLocally(messageId)
    return {
      messageId,
      accountId: target.accountId,
      folderId: target.folderId,
      action: 'restore',
      localOnly: true
    }
  }

  const identity = getRemoteMessageIdentity(messageId)
  if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
  assertTargetIdentity(target, identity)

  const writeback = queueRemoteWriteback({
    accountId: target.accountId,
    messageId,
    operationKind: 'restore',
    payload: { folderPath: target.folderPath, uid: target.uid, targetFolder: inbox.path }
  })
  if (!markRemoteWritebackRunning(writeback.writebackId)) throw new Error('无法启动远端写回。')

  let client: SimpleImapSession | undefined
  let remoteSucceeded = false
  try {
    client = await SimpleImapSession.connect(account, 'R')
    await authenticateImapSession(account, client)
    const capabilities = await client.capability().catch(() => new Set<string>())
    await selectAndVerifyRemoteMessage(client, {
      ...identity,
      accountId: target.accountId,
      folderId: target.folderId,
      folderPath: target.folderPath,
      uid: target.uid,
      rfc822MessageId: target.rfc822MessageId
    })

    if (!capabilities.has('MOVE')) {
      throw new Error('当前连接不支持安全的 UID MOVE，未执行恢复操作。')
    }
    const movedUid = await client.uidMove(target.uid, inbox.path)

    remoteSucceeded = true
    markRemoteWritebackSuccess(writeback.writebackId)
    const destinationUid = await resolveMovedUid(client, target, inbox.path, movedUid)
    markMessageMoved(messageId, inbox.folderId, destinationUid, false)
    return {
      messageId,
      accountId: target.accountId,
      folderId: inbox.folderId,
      action: 'restore',
      localOnly: false
    }
  } catch (error) {
    const message = getErrorMessage(error)
    markMessageDeleteError(messageId, message)
    if (!remoteSucceeded) markRemoteWritebackFailed(writeback.writebackId, message)
    throw error
  } finally {
    await client?.logout().catch(() => undefined)
  }
}

export async function bulkDelete(
  messageIds: number[],
  options: BulkDeleteOptions = {}
): Promise<BulkDeleteResult> {
  const succeededMessageIds: number[] = []
  const failedItems: BulkDeleteFailure[] = []

  for (const messageId of uniqueMessageIds(messageIds)) {
    try {
      if (options.localOnly) hideMessageLocally(messageId)
      else if (options.permanent) await permanentlyDeleteMessage(messageId)
      else await deleteMessageToTrash(messageId)
      succeededMessageIds.push(messageId)
    } catch (error) {
      failedItems.push({ messageId, error: getErrorMessage(error) })
    }
  }

  return toBulkResult(succeededMessageIds, failedItems)
}

function requireDeleteTarget(messageId: number): MessageDeleteTarget {
  const target = getMessageDeleteTarget(messageId)
  if (!target) throw new Error('邮件不存在。')
  if (target.remoteDeleted) throw new Error('邮件已从远端删除。')
  return target
}

function requireRestoreTarget(messageId: number): MessageDeleteTarget {
  const target = getMessageDeleteTarget(messageId)
  if (!target) throw new Error('邮件不存在。')
  if (target.remoteDeleted) throw new Error('邮件已从远端删除，无法恢复。')
  return target
}

function isTrashTarget(target: MessageDeleteTarget): boolean {
  return target.folderRole === 'trash' || detectSpecialFolderRole(target.folderPath) === 'trash'
}

function assertTargetIdentity(target: MessageDeleteTarget, identity: RemoteMessageIdentity): void {
  if (
    identity.accountId !== target.accountId ||
    identity.folderId !== target.folderId ||
    identity.folderPath !== target.folderPath ||
    identity.uid !== target.uid
  ) {
    throw new Error('邮件的位置或 UIDVALIDITY 已变化，已停止写回；请先同步邮件。')
  }
}

/** Rule actions may call this explicitly; ordinary user delete keeps its existing local-hide semantics. */
export async function moveMessageToTrash(messageId: number): Promise<MessageDeleteResult> {
  const target = requireDeleteTarget(messageId)
  if (target.remoteMissing) return hideMessageLocally(messageId)
  const trash = findFolderByRole(target.accountId, 'trash')
  if (!trash) throw new Error('未找到该账号的已删除邮件文件夹。')
  if (isTrashTarget(target)) {
    markMessageMovedToTrash(messageId, trash.folderId, target.uid)
    return { messageId, accountId: target.accountId, folderId: trash.folderId, action: 'trash' }
  }
  const account = getAccount(target.accountId)
  if (!account) throw new Error(`Account not found: ${target.accountId}`)
  if (account.receiveProtocol === 'pop3') return hideMessageLocally(messageId)

  const identity = getRemoteMessageIdentity(messageId)
  if (!identity) throw new Error('邮件远端定位信息已失效，请先同步邮件。')
  assertTargetIdentity(target, identity)

  const writeback = queueRemoteWriteback({
    accountId: target.accountId,
    messageId,
    operationKind: 'move_to_trash',
    payload: { folderPath: target.folderPath, uid: target.uid, targetFolder: trash.path }
  })
  if (!markRemoteWritebackRunning(writeback.writebackId)) throw new Error('无法启动远端写回。')
  let client: SimpleImapSession | undefined
  let remoteSucceeded = false
  try {
    client = await SimpleImapSession.connect(account, 'M')
    await authenticateImapSession(account, client)
    await selectAndVerifyRemoteMessage(client, {
      ...identity,
      accountId: target.accountId,
      folderId: target.folderId,
      folderPath: target.folderPath,
      uid: target.uid,
      rfc822MessageId: target.rfc822MessageId
    })
    const capabilities = await client.capability().catch(() => new Set<string>())
    if (!capabilities.has('MOVE')) {
      throw new Error('当前连接不支持安全的 UID MOVE，未执行移入已删除文件夹。')
    }
    await client.selectMailbox(target.folderPath)
    const movedUid = await client.uidMove(target.uid, trash.path)
    remoteSucceeded = true
    markRemoteWritebackSuccess(writeback.writebackId)
    const destinationUid = await resolveMovedUid(client, target, trash.path, movedUid)
    markMessageMovedToTrash(messageId, trash.folderId, destinationUid)
    return { messageId, accountId: target.accountId, folderId: trash.folderId, action: 'trash' }
  } catch (error) {
    const message = getErrorMessage(error)
    markMessageDeleteError(messageId, message)
    if (!remoteSucceeded) markRemoteWritebackFailed(writeback.writebackId, message)
    throw error
  } finally {
    await client?.logout().catch(() => undefined)
  }
}

async function resolveMovedUid(
  client: SimpleImapSession,
  target: MessageDeleteTarget,
  folderPath: string,
  destinationUid: number | undefined
): Promise<number> {
  if (destinationUid !== undefined) return destinationUid
  try {
    if (!target.rfc822MessageId) throw new Error('移动后缺少可验证的 Message-ID。')
    await client.selectMailbox(folderPath)
    const uids = await client.searchByMessageId(target.rfc822MessageId)
    if (uids.length !== 1) throw new Error('无法唯一定位移动后的邮件。')
    await selectAndVerifyRemoteMessage(client, {
      accountId: target.accountId,
      folderId: target.folderId,
      folderPath,
      uid: uids[0],
      rfc822MessageId: target.rfc822MessageId
    })
    return uids[0]
  } catch (error) {
    markMessageRemoteMissing(target.messageId)
    throw new Error(
      `远端移动已完成，但目标 UID 未能确认，请同步邮箱后核对。${getErrorMessage(error)}`
    )
  }
}

function requiresPermanentRemoteDelete(target: MessageDeleteTarget): boolean {
  if (target.userHidden) return true
  const role = detectSpecialFolderRole(target.folderPath) ?? target.folderRole
  return role === 'sent' || role === 'drafts' || role === 'junk'
}

function uniqueMessageIds(messageIds: number[]): number[] {
  return Array.from(
    new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))
  )
}

function toBulkResult(
  succeededMessageIds: number[],
  failedItems: BulkDeleteFailure[]
): BulkDeleteResult {
  return {
    succeededMessageIds,
    failedItems,
    deletedCount: succeededMessageIds.length,
    failedCount: failedItems.length
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '删除邮件失败。'
}
