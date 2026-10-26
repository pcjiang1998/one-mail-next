import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    getAccount: vi.fn(),
    updateAccount: vi.fn(),
    updateAccountFolderSelection: vi.fn(),
    refreshMailboxWatchers: vi.fn()
  }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))
vi.mock('./database-handler', () => ({
  handleDatabaseIpc: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../db/connection', () => ({
  getDatabase: () => ({ exec: vi.fn() })
}))

vi.mock('../db/repositories/account.repository', () => ({
  createAccount: vi.fn(),
  disableAccount: vi.fn(),
  getAccount: mocks.getAccount,
  listAccounts: vi.fn(() => []),
  removeAccount: vi.fn(),
  removeAccounts: vi.fn(),
  reorderAccounts: vi.fn(),
  updateAccount: mocks.updateAccount,
  updateAccountIdleSupport: vi.fn()
}))
vi.mock('../services/imap-connection-test', () => ({
  testImapConnection: vi.fn(),
  testImapOAuthConnection: vi.fn()
}))
vi.mock('../mail/pop3-session', () => ({ testPop3Connection: vi.fn() }))
vi.mock('../services/mailbox-watch', () => ({
  refreshMailboxWatchers: mocks.refreshMailboxWatchers
}))
vi.mock('../services/credential-store', () => ({
  readAccountPassword: vi.fn(),
  saveAccountPassword: vi.fn()
}))
vi.mock('../services/microsoft-oauth', () => ({
  authorizeMicrosoftAccount: vi.fn(),
  saveMicrosoftAuthorization: vi.fn()
}))
vi.mock('../services/add-account-window', () => ({
  closeAddAccountWindow: vi.fn(),
  openAddAccountWindow: vi.fn()
}))
vi.mock('../services/account-mailboxes', () => ({
  discoverAccountMailFolders: vi.fn(),
  prepareAccountFolderSelection: mocks.updateAccountFolderSelection,
  commitAccountFolderSelection: vi.fn()
}))

import { registerAccountIpc } from './accounts'

describe('account update IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
    registerAccountIpc()
  })

  it('persists folder-only changes before returning the refreshed account', async () => {
    const current = createAccount('before')
    const updated = createAccount('updated')
    const refreshed = createAccount('refreshed')
    mocks.getAccount.mockReturnValueOnce(current).mockReturnValueOnce(refreshed)
    mocks.updateAccount.mockReturnValue(updated)
    mocks.updateAccountFolderSelection.mockResolvedValue([])

    const handler = mocks.handlers.get('accounts/update')
    expect(handler).toBeDefined()
    const result = await handler?.({}, { accountId: 1, selectedFolderPaths: ['INBOX', 'Sent'] })

    expect(mocks.updateAccount).toHaveBeenCalledWith({
      accountId: 1,
      selectedFolderPaths: ['INBOX', 'Sent']
    })
    expect(mocks.updateAccountFolderSelection).toHaveBeenCalledWith(
      current,
      ['INBOX', 'Sent'],
      undefined
    )
    expect(mocks.refreshMailboxWatchers).toHaveBeenCalledOnce()
    expect(result).toBe(refreshed)
  })

  it('allows clearing every optional folder selection', async () => {
    const account = createAccount('account')
    mocks.getAccount.mockReturnValue(account)
    mocks.updateAccount.mockReturnValue(account)
    mocks.updateAccountFolderSelection.mockResolvedValue([])

    const handler = mocks.handlers.get('accounts/update')
    await handler?.({}, { accountId: 1, selectedFolderPaths: [] })

    expect(mocks.updateAccountFolderSelection).toHaveBeenCalledWith(account, [], undefined)
  })
})

function createAccount(accountLabel: string): {
  accountId: number
  accountLabel: string
  email: string
  receiveProtocol: 'imap'
  authType: 'password'
} {
  return {
    accountId: 1,
    accountLabel,
    email: 'user@example.com',
    receiveProtocol: 'imap',
    authType: 'password'
  }
}
