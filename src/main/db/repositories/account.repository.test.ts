import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
    getPath: vi.fn(() => tmpdir())
  }
}))

vi.mock('electron', () => electronMock)

import { closeDatabase, initializeDatabase, setDatabaseKey, setDatabasePath } from '../connection'
import { createAccount, listAccounts, removeAccounts, reorderAccounts } from './account.repository'
import { updateSettings } from './settings.repository'

describe('account repository management', () => {
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onemail-accounts-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  it('uses global defaults for new IMAP accounts', () => {
    const account = createTestAccount('first@example.com')

    expect(account.proxyMode).toBe('global')
    expect(account.signatureMode).toBe('global')
    expect(account.syncMode).toBe('global')
    expect(account.accountSyncIntervalMinutes).toBe(5)
    expect(account.remoteDeletePolicy).toBe('inherit')
    expect(account.desktopNotificationsEnabled).toBe(true)
    updateSettings({ defaultDesktopNotificationsEnabled: false })
    const next = createTestAccount('next@example.com')
    expect(next.desktopNotificationsEnabled).toBe(false)
    expect(listAccounts()[0].desktopNotificationsEnabled).toBe(true)
  })

  it('persists reordering, removes multiple accounts, and appends new accounts', () => {
    const first = createTestAccount('first@example.com')
    const second = createTestAccount('second@example.com')
    const third = createTestAccount('third@example.com')

    reorderAccounts([third.accountId, first.accountId, second.accountId])
    expect(listAccounts().map((account) => account.accountId)).toEqual([
      third.accountId,
      first.accountId,
      second.accountId
    ])

    expect(removeAccounts([third.accountId, first.accountId])).toEqual([
      third.accountId,
      first.accountId
    ])
    const fourth = createTestAccount('fourth@example.com')
    expect(listAccounts().map((account) => account.accountId)).toEqual([
      second.accountId,
      fourth.accountId
    ])
  })

  it('rejects incomplete and duplicate account orders', () => {
    const first = createTestAccount('first@example.com')
    const second = createTestAccount('second@example.com')

    expect(() => reorderAccounts([first.accountId])).toThrow('当前全部邮箱')
    expect(() => reorderAccounts([first.accountId, first.accountId])).toThrow('重复')
    expect(listAccounts().map((account) => account.accountId)).toEqual([
      first.accountId,
      second.accountId
    ])
  })
})

function createTestAccount(email: string): ReturnType<typeof createAccount> {
  return createAccount({
    providerKey: 'manual',
    email,
    authType: 'password',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpEnabled: false
  })
}
