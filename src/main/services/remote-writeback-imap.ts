import type { RemoteMessageIdentity } from '../db/repositories/remote-writeback.repository'
import type { SimpleImapSession } from '../mail/imap-session'

// SELECT currently returns void on older sessions. When UIDVALIDITY is available,
// check it; otherwise verify the exact Message-ID at the original UID, never merely
// trust a potentially reused UID or IMAP HEADER's substring search semantics.
export async function selectAndVerifyRemoteMessage(
  client: SimpleImapSession,
  identity: RemoteMessageIdentity
): Promise<void> {
  const selected: unknown = await client.selectMailbox(identity.folderPath)
  const remoteUidValidity =
    selected && typeof selected === 'object' && 'uidValidity' in selected
      ? String(selected.uidValidity ?? '')
      : undefined
  if (identity.uidValidity && remoteUidValidity && identity.uidValidity !== remoteUidValidity) {
    throw new Error('远端文件夹 UIDVALIDITY 已变化，已停止写回；请先重新同步邮件。')
  }
  const hasVerifiedUidValidity = Boolean(
    identity.uidValidity && remoteUidValidity === identity.uidValidity
  )
  const messageId = identity.rfc822MessageId?.trim()
  if (!hasVerifiedUidValidity && !messageId) {
    throw new Error('缺少可验证的远端邮件身份，已停止写回；请先同步邮件。')
  }
  const raw = await client.fetchRawMessage(identity.uid)
  if (!raw) throw new Error('原 UID 对应的远端邮件已不存在，请先同步邮件。')
  if (messageId) {
    const headers = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ')
    const identifiers = [...headers.matchAll(/^Message-ID:\s*(.*?)\s*$/gim)]
    const remoteMessageId = identifiers[0]?.[1]?.trim()
    if (identifiers.length !== 1 || remoteMessageId !== messageId) {
      throw new Error('远端 UID 对应的邮件身份已变化，已停止写回，避免操作其他邮件。')
    }
  }
}

export function requireUidExpunge(
  client: SimpleImapSession,
  capabilities: Set<string>
): (uid: number) => Promise<void> {
  // No unscoped EXPUNGE fallback: it could delete unrelated messages flagged by
  // another client. Older transports must fail before setting any Deleted flag.
  const safeClient = client as SimpleImapSession & { uidExpunge?: (uid: number) => Promise<void> }
  if (!capabilities.has('UIDPLUS') || typeof safeClient.uidExpunge !== 'function') {
    throw new Error('当前连接不支持按 UID 安全永久删除；未执行删除，请使用邮箱服务商客户端处理。')
  }
  return (uid) => safeClient.uidExpunge!(uid)
}
