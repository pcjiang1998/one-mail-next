import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImapMailbox } from '../mail/imap-mailboxes'

const mocks = vi.hoisted(() => ({
  authenticateImapSession: vi.fn(),
  connect: vi.fn(),
  listMailboxes: vi.fn(),
  logout: vi.fn()
}))

const electronMock = vi.hoisted(() => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    getPath: vi.fn(() => tmpdir())
  }
}))

vi.mock('electron', () => electronMock)
vi.mock('../mail/imap-auth', () => ({
  authenticateImapSession: mocks.authenticateImapSession
}))
vi.mock('../mail/imap-session', () => ({
  SimpleImapSession: {
    connect: mocks.connect
  }
}))

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import { createAccount } from '../db/repositories/account.repository'
import { updateAccountFolderSelection } from './account-mailboxes'

describe('account mailbox selection persistence', () => {
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onemail-mailboxes-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)

    vi.clearAllMocks()
    mocks.connect.mockResolvedValue({
      listMailboxes: mocks.listMailboxes,
      logout: mocks.logout
    })
    mocks.logout.mockResolvedValue(undefined)
  })

  afterEach(() => {
    closeDatabase()
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  it('updates existing folders and inserts new folders for only the target account', async () => {
    const first = createTestAccount('first@example.com')
    const second = createTestAccount('second@example.com')
    insertFolder(first.accountId, 'INBOX', 1)
    insertFolder(first.accountId, 'Projects', 1, 'custom')
    insertFolder(second.accountId, 'INBOX', 0)
    insertFolder(second.accountId, 'Projects', 1, 'custom')
    mocks.listMailboxes.mockResolvedValue([
      createMailbox('INBOX', 'inbox'),
      createMailbox('Sent', 'sent'),
      createMailbox('Junk', 'junk'),
      createMailbox('Archive', 'archive'),
      createMailbox('Projects', 'custom')
    ])

    const folders = await updateAccountFolderSelection(second.accountId, ['Archive'])

    expect(folders.map((folder) => [folder.path, folder.selected])).toEqual([
      ['INBOX', true],
      ['Sent', true],
      ['Archive', true],
      ['Junk', true],
      ['Projects', false]
    ])
    expect(
      getDatabase()
        .prepare<{ account_id: number; path: string; sync_enabled: number }>(
          `SELECT account_id, path, sync_enabled
           FROM onemail_mail_folders
           ORDER BY account_id, path`
        )
        .all()
    ).toEqual([
      { account_id: first.accountId, path: 'INBOX', sync_enabled: 1 },
      { account_id: first.accountId, path: 'Projects', sync_enabled: 1 },
      { account_id: second.accountId, path: 'Archive', sync_enabled: 1 },
      { account_id: second.accountId, path: 'INBOX', sync_enabled: 1 },
      { account_id: second.accountId, path: 'Junk', sync_enabled: 1 },
      { account_id: second.accountId, path: 'Sent', sync_enabled: 1 }
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

function insertFolder(
  accountId: number,
  path: string,
  syncEnabled: number,
  role: ImapMailbox['role'] = 'inbox'
): void {
  getDatabase()
    .prepare(
      `INSERT INTO onemail_mail_folders (
         account_id, path, name, role, attributes_json, is_selectable, sync_enabled
       ) VALUES (
         :accountId, :path, :path, :role, '[]', 1, :syncEnabled
       )`
    )
    .run({ accountId, path, role, syncEnabled })
}

function createMailbox(path: string, role: ImapMailbox['role']): ImapMailbox {
  return {
    path,
    name: path,
    delimiter: '/',
    role,
    attributes: [],
    selectable: true
  }
}
