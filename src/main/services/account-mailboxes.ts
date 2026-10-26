import type { AccountMailFolder } from '../../shared/types'
import { getDatabase, toBoolean, type SqliteRow } from '../db/connection'
import { getAccount } from '../db/repositories/account.repository'
import { authenticateImapSession } from '../mail/imap-auth'
import { SimpleImapSession } from '../mail/imap-session'
import type { ImapMailbox } from '../mail/imap-mailboxes'

type StoredFolderRow = SqliteRow & {
  folder_id: number
  path: string
  sync_enabled: number
}

export type PreparedFolderSelection = {
  accountId: number
  mailboxes: ImapMailbox[]
  requestedKeys: Set<string>
}

export async function discoverAccountMailFolders(accountId: number): Promise<AccountMailFolder[]> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)
  if (account.receiveProtocol === 'pop3') return account.folders
  const mailboxes = await listRemoteMailboxes(accountId)
  return applyStoredSelection(accountId, mailboxes)
}

export async function updateAccountFolderSelection(
  accountId: number,
  selectedFolderPaths: string[]
): Promise<AccountMailFolder[]> {
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)
  if (account.receiveProtocol === 'pop3') return account.folders
  return commitAccountFolderSelection(
    await prepareAccountFolderSelection(account, selectedFolderPaths)
  )
}

export async function prepareAccountFolderSelection(
  account: NonNullable<ReturnType<typeof getAccount>>,
  selectedFolderPaths: string[],
  password?: string
): Promise<PreparedFolderSelection> {
  const mailboxes = await listRemoteMailboxes(account.accountId, account, password)
  const selectable = mailboxes.filter((mailbox) => mailbox.selectable)
  const pathsByKey = new Map(
    selectable.map((mailbox) => [normalizePath(mailbox.path), mailbox.path])
  )
  const requestedKeys = new Set(selectedFolderPaths.map(normalizePath).filter(Boolean))
  const inbox = selectable.find((mailbox) => mailbox.role === 'inbox')

  if (!inbox) throw new Error('IMAP 服务器未返回可选择的 INBOX。')
  requestedKeys.add(normalizePath(inbox.path))
  for (const mailbox of selectable) {
    if (isRequiredFolderRole(mailbox.role)) requestedKeys.add(normalizePath(mailbox.path))
  }

  for (const key of requestedKeys) {
    if (!pathsByKey.has(key)) throw new Error(`文件夹已不存在或不可选择：${key}`)
  }

  return { accountId: account.accountId, mailboxes, requestedKeys }
}

export function commitAccountFolderSelection(
  selection: PreparedFolderSelection
): AccountMailFolder[] {
  persistFolderSelection(selection.accountId, selection.mailboxes, selection.requestedKeys)
  return applyStoredSelection(selection.accountId, selection.mailboxes)
}

export function getSelectedFolderPathKeys(accountId: number): Set<string> {
  const rows = getDatabase()
    .prepare<{ path: string }>(
      `
      SELECT path
      FROM onemail_mail_folders
      WHERE account_id = :accountId AND sync_enabled = 1
      `
    )
    .all({ accountId })

  return new Set(rows.map((row) => normalizePath(row.path)))
}

async function listRemoteMailboxes(
  accountId: number,
  candidate?: NonNullable<ReturnType<typeof getAccount>>,
  password?: string
): Promise<ImapMailbox[]> {
  const account = candidate ?? getAccount(accountId)
  if (!account) throw new Error(`Account not found: ${accountId}`)

  const session = await SimpleImapSession.connect(account, 'F')
  try {
    if (password !== undefined && account.authType !== 'oauth2') {
      const normalizedPassword =
        account.authType === 'app_password' ? password.trim().replace(/\s+/g, '') : password.trim()
      await session.login(account.email, normalizedPassword)
      await session.identifyClient()
    } else {
      await authenticateImapSession(account, session)
    }
    return (await session.listMailboxes()).sort(compareMailboxes)
  } finally {
    await session.logout().catch(() => undefined)
  }
}

function applyStoredSelection(accountId: number, mailboxes: ImapMailbox[]): AccountMailFolder[] {
  const storedRows = getDatabase()
    .prepare<StoredFolderRow>(
      `
      SELECT folder_id, path, sync_enabled
      FROM onemail_mail_folders
      WHERE account_id = :accountId
      `
    )
    .all({ accountId })
  const selectedKeys = new Set(
    storedRows.filter((row) => toBoolean(row.sync_enabled)).map((row) => normalizePath(row.path))
  )
  const hasSelection = selectedKeys.size > 0

  return mailboxes.map((mailbox) => ({
    ...mailbox,
    selected:
      mailbox.selectable &&
      (isRequiredFolderRole(mailbox.role) ||
        (hasSelection && selectedKeys.has(normalizePath(mailbox.path))) ||
        (!hasSelection && isRequiredFolderRole(mailbox.role)))
  }))
}

function persistFolderSelection(
  accountId: number,
  mailboxes: ImapMailbox[],
  selectedKeys: Set<string>
): void {
  const db = getDatabase()
  const existingRows = db
    .prepare<StoredFolderRow>(
      `SELECT folder_id, path, sync_enabled FROM onemail_mail_folders WHERE account_id = :accountId`
    )
    .all({ accountId })
  const existingByKey = new Map(existingRows.map((row) => [normalizePath(row.path), row]))
  const remoteKeys = new Set(mailboxes.map((mailbox) => normalizePath(mailbox.path)))
  const deleteFolder = db.prepare(
    'DELETE FROM onemail_mail_folders WHERE folder_id = :folderId AND account_id = :accountId'
  )

  db.exec('SAVEPOINT account_folder_selection')
  try {
    for (const row of existingRows) {
      if (!remoteKeys.has(normalizePath(row.path))) {
        deleteFolder.run({ folderId: row.folder_id, accountId })
      }
    }

    for (const [index, mailbox] of mailboxes.entries()) {
      const key = normalizePath(mailbox.path)
      const selected = mailbox.selectable && selectedKeys.has(key)
      const existing = existingByKey.get(key)

      if (!selected) {
        if (existing && !isRequiredFolderRole(mailbox.role)) {
          deleteFolder.run({ folderId: existing.folder_id, accountId })
        }
        continue
      }

      const values = {
        accountId,
        path: mailbox.path,
        name: mailbox.name,
        delimiter: mailbox.delimiter ?? null,
        role: mailbox.role,
        attributesJson: JSON.stringify(mailbox.attributes),
        selectable: mailbox.selectable ? 1 : 0,
        syncEnabled: selected ? 1 : 0,
        sortOrder: folderSortOrder(mailbox.role, index)
      }

      if (existing) {
        db.prepare(
          `
          UPDATE onemail_mail_folders
          SET path = :path,
              name = :name,
              delimiter = :delimiter,
              role = :role,
              attributes_json = :attributesJson,
              is_selectable = :selectable,
              sync_enabled = :syncEnabled,
              total_count = CASE WHEN :syncEnabled = 0 THEN 0 ELSE total_count END,
              unread_count = CASE WHEN :syncEnabled = 0 THEN 0 ELSE unread_count END,
              sort_order = :sortOrder,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE folder_id = :folderId AND account_id = :accountId
          `
        ).run({ ...values, folderId: existing.folder_id })
        continue
      }

      db.prepare(
        `
        INSERT INTO onemail_mail_folders (
          account_id, path, name, delimiter, role, attributes_json,
          is_selectable, sync_enabled, sort_order
        )
        VALUES (
          :accountId, :path, :name, :delimiter, :role, :attributesJson,
          :selectable, :syncEnabled, :sortOrder
        )
        `
      ).run(values)
    }

    db.exec('RELEASE account_folder_selection')
  } catch (error) {
    db.exec('ROLLBACK TO account_folder_selection')
    db.exec('RELEASE account_folder_selection')
    throw error
  }
}

function compareMailboxes(left: ImapMailbox, right: ImapMailbox): number {
  const order = folderSortOrder(left.role, 0) - folderSortOrder(right.role, 0)
  return order || left.name.localeCompare(right.name)
}

function folderSortOrder(role: ImapMailbox['role'], index: number): number {
  const roleOrder: Partial<Record<ImapMailbox['role'], number>> = {
    inbox: 10,
    starred: 20,
    important: 30,
    sent: 40,
    drafts: 50,
    archive: 60,
    all_mail: 70,
    junk: 80,
    trash: 90
  }
  return roleOrder[role] ?? 100 + index
}

function normalizePath(path: string): string {
  return path.trim().toLocaleLowerCase('en-US')
}

export function isRequiredFolderRole(role: ImapMailbox['role']): boolean {
  return role === 'inbox' || role === 'sent' || role === 'junk'
}
