import { describe, expect, it, vi } from 'vitest'

import type { RemoteMessageIdentity } from '../db/repositories/remote-writeback.repository'
import type { SimpleImapSession } from '../mail/imap-session'
import { requireUidExpunge, selectAndVerifyRemoteMessage } from './remote-writeback-imap'

function fakeSession(rawMessage: string): SimpleImapSession {
  return {
    selectMailbox: vi.fn(async () => undefined),
    fetchRawMessage: vi.fn(async () => rawMessage)
  } as unknown as SimpleImapSession
}

const identity: RemoteMessageIdentity = {
  accountId: 1,
  folderId: 2,
  folderPath: 'INBOX',
  uid: 42,
  rfc822MessageId: '<message-42@example.com>'
}

describe('remote writeback IMAP safety checks', () => {
  it('requires the exact Message-ID at the original UID', async () => {
    const client = fakeSession('Message-ID: <message-42@example.com>\r\nSubject: Hello\r\n\r\nbody')

    await expect(selectAndVerifyRemoteMessage(client, identity)).resolves.toBeUndefined()
  })

  it('stops before a flag operation when the UID now belongs to another message', async () => {
    const client = fakeSession('Message-ID: <different@example.com>\r\n\r\nbody')

    await expect(selectAndVerifyRemoteMessage(client, identity)).rejects.toThrow('身份已变化')
  })

  it('does not provide an unsafe unscoped EXPUNGE fallback', () => {
    const client = fakeSession('')
    expect(() => requireUidExpunge(client, new Set(['IMAP4rev1']))).toThrow('按 UID 安全永久删除')
  })
})
