import type { RemoteWriteback } from '../../shared/types'
import { getAccount } from '../db/repositories/account.repository'
import {
  getRemoteMessageIdentity,
  hasNewerFlagWriteback
} from '../db/repositories/remote-writeback.repository'
import { markMessageAnswered, updateMessageReadState } from '../db/repositories/message.repository'
import { authenticateImapSession } from '../mail/imap-auth'
import { SimpleImapSession } from '../mail/imap-session'
import { selectAndVerifyRemoteMessage } from './remote-writeback-imap'

export async function executeFlagWritebackRetry(
  record: RemoteWriteback,
  payload: Record<string, unknown>
): Promise<void> {
  if (!record.messageId) throw new Error('原邮件已不存在，无法安全重试。')
  const identity = getRemoteMessageIdentity(record.messageId)
  if (
    !identity ||
    identity.accountId !== record.accountId ||
    payload.folderPath !== identity.folderPath ||
    payload.uid !== identity.uid ||
    (payload.folderId !== undefined && payload.folderId !== identity.folderId) ||
    (payload.uidValidity !== undefined && payload.uidValidity !== identity.uidValidity) ||
    (payload.rfc822MessageId !== undefined && payload.rfc822MessageId !== identity.rfc822MessageId)
  ) {
    throw new Error('邮件的位置或 UIDVALIDITY 已变化，不能重试旧记录；请先同步核对。')
  }
  // Legacy records without an identity snapshot cannot safely bind an old intent
  // to a possibly recycled local/remote message identifier.
  if (!payload.rfc822MessageId && !payload.uidValidity) {
    throw new Error('旧写回记录缺少邮件身份快照，不能安全重试；请先同步后重新操作。')
  }
  const account = getAccount(record.accountId)
  if (!account || account.receiveProtocol === 'pop3') {
    throw new Error('原 IMAP 账号不存在或接收协议已改变，无法重试。')
  }
  let client: SimpleImapSession | undefined
  try {
    client = await SimpleImapSession.connect(account, 'W')
    await authenticateImapSession(account, client)
    await selectAndVerifyRemoteMessage(client, identity)
    if (hasNewerFlagWriteback(record)) {
      throw new Error('该邮件已有较新的状态操作，已停止重试旧记录。')
    }
    if (record.operationKind === 'mark_read' || record.operationKind === 'mark_unread') {
      const isRead = record.operationKind === 'mark_read'
      // Do not use the public read-state helper: its local-state no-op shortcut
      // could incorrectly call a retry successful without touching the server.
      await client.setSeenFlag(identity.uid, isRead)
      updateMessageReadState(record.messageId, isRead)
    } else if (record.operationKind === 'mark_answered') {
      await client.setAnsweredFlag(identity.uid, true)
      markMessageAnswered(record.messageId)
    } else {
      throw new Error('不支持安全重试此操作。')
    }
  } finally {
    await client?.logout().catch(() => undefined)
  }
}
