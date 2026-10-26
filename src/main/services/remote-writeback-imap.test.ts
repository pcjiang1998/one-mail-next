import { describe, expect, it, vi } from 'vitest'

import type { RemoteMessageIdentity } from '../db/repositories/remote-writeback.repository'
import type { SimpleImapSession } from '../mail/imap-session'
import { requireUidExpunge, selectAndVerifyRemoteMessage } from './remote-writeback-imap'
import { RemoteMessageMissingError } from '../mail/remote-message-error'

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
  it('distinguishes a confirmed missing UID from a changed UIDVALIDITY', async () => {
    await expect(selectAndVerifyRemoteMessage(fakeSession(''), identity)).rejects.toBeInstanceOf(
      RemoteMessageMissingError
    )
    const client = fakeSession('')
    vi.mocked(client.selectMailbox).mockResolvedValue({ uidValidity: 'new' })
    await expect(
      selectAndVerifyRemoteMessage(client, { ...identity, uidValidity: 'old' })
    ).rejects.toThrow('UIDVALIDITY')
    expect(client.fetchRawMessage).not.toHaveBeenCalled()
  })

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
