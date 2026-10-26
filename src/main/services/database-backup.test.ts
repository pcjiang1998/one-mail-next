import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
    getPath: vi.fn(() => tmpdir())
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  getDatabaseKey,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../db/connection'
import {
  createAccount,
  listAccounts,
  setAccountNotifications,
  updateAccount
} from '../db/repositories/account.repository'
import {
  getSettings,
  updateSettings,
  saveSignature,
  getTranslationSettingsForMain,
  updateTranslationSettings,
  updateBackupSyncSettings,
  getBackupSyncSettingsForMain
} from '../db/repositories/settings.repository'
import { createDatabaseSqlBackup, importDatabaseSqlBackupContent } from './database-backup'
import { readAccountPassword, saveAccountPassword } from './credential-store'

describe('database SQL backup', () => {
  afterEach(() => {
    closeDatabase()
  })

  it('restores a SQL backup into the current database and keeps encrypted credentials readable', () => {
    const sourceKey = createTestDatabaseKey(-30, '1111111111111111')
    const targetKey = createTestDatabaseKey(-20, '2222222222222222')

    configureDatabase('source', sourceKey)
    const sourceAccount = seedAccount('source@example.com', 'source-password')
    seedInboxMessage(sourceAccount.accountId, 'Please ATTACH the invoice')
    const backup = createDatabaseSqlBackup()

    expect(backup.key).toBe(sourceKey)
    expect(backup.sql).toContain('source@example.com')
    closeDatabase()

    configureDatabase('target', targetKey)
    seedAccount('target@example.com', 'target-password')
    expect(listAccounts().map((account) => account.email)).toEqual(['target@example.com'])

    const result = importDatabaseSqlBackupContent(backup.sql, 'renamed-backup.sql')

    expect(result.imported).toBe(true)
    expect(result.accountCount).toBe(1)
    expect(result.messageCount).toBe(1)
    expect(getDatabaseKey()).toBe(sourceKey)

    const restoredAccounts = listAccounts()
    expect(restoredAccounts.map((account) => account.email)).toEqual(['source@example.com'])
    expect(readAccountPassword(restoredAccounts[0].accountId)).toBe('source-password')
  })

  it('rejects an executable database attachment statement', () => {
    const sourceKey = createTestDatabaseKey(-30, '3333333333333333')
    configureDatabase('unsafe-source', sourceKey)
    seedAccount('source@example.com', 'source-password')
    const backup = createDatabaseSqlBackup()
    const unsafeSql = backup.sql.replace(
      'BEGIN TRANSACTION;',
      "BEGIN TRANSACTION;\nATTACH DATABASE 'external.sqlite' AS external;"
    )

    expect(() => importDatabaseSqlBackupContent(unsafeSql, backup.fileName)).toThrow(
      '备份 SQL 包含不允许的数据库附加语句。'
    )
  })

  it('migrates a legacy backup with an unlimited sync window without deleting cached mail', () => {
    configureDatabase('legacy-source', createTestDatabaseKey(-30, '7777777777777777'))
    const account = seedAccount('legacy@example.com', 'secret')
    seedInboxMessage(account.accountId, 'Legacy mail')
    getSettings()
    getDatabase().exec(`
      DELETE FROM onemail_app_settings WHERE setting_key IN
        ('mail_sync_ranges_version', 'sync_body_window_days', 'cache_retention_days', 'download_attachments_separately', 'cleanup_metadata');
      UPDATE onemail_app_settings SET setting_value = '0' WHERE setting_key = 'sync_window_days';
      INSERT INTO onemail_message_bodies (message_id, body_text) VALUES (1, 'Keep this cached body');
    `)
    const backup = createDatabaseSqlBackup()
    closeDatabase()
    configureDatabase('legacy-target', createTestDatabaseKey(-20, '8888888888888888'))
    importDatabaseSqlBackupContent(backup.sql, backup.fileName)
    expect(getSettings()).toMatchObject({
      syncWindowDays: 90,
      syncBodyWindowDays: 7,
      cacheRetentionDays: 0
    })
    expect(getDatabase().prepare('SELECT body_text FROM onemail_message_bodies').get()).toEqual({
      body_text: 'Keep this cached body'
    })
  })

  it.each([true, false])(
    'restores all settings and contacts with includeMail=%s',
    (includeMail) => {
      configureDatabase('settings-source', createTestDatabaseKey(-30, '4444444444444444'))
      const account = seedAccount('settings@example.com', 'secret')
      seedInboxMessage(account.accountId, 'Mail content to omit')
      const signature = saveSignature({ title: 'Work', content: '<p>Signature</p>' })
      updateAccount({
        accountId: account.accountId,
        desktopNotificationsEnabled: false,
        proxyMode: 'custom',
        customProxyUrl: 'http://127.0.0.1:7890',
        signatureMode: 'custom',
        signatureId: signature.signatureId,
        syncMode: 'interval',
        accountSyncIntervalMinutes: 30
      })
      updateSettings({
        defaultDesktopNotificationsEnabled: false,
        privacyDefaultMode: 'loose',
        globalProxyMode: 'custom',
        globalProxyUrl: 'http://127.0.0.1:7891',
        globalSignatureId: signature.signatureId,
        globalSyncMode: 'manual',
        globalSyncIntervalMinutes: 20,
        fallbackSyncMode: 'manual',
        syncWindowDays: 60,
        syncBodyWindowDays: 20,
        cacheRetentionDays: 120,
        downloadAttachmentsSeparately: true,
        cleanupMetadata: true,
        theme: 'dark'
      })
      const translation = getTranslationSettingsForMain()
      translation.activeProvider = 'deepl'
      translation.targetLanguage = 'ja'
      translation.providers.deepl.apiKey = 'translation-secret'
      updateTranslationSettings(translation)
      updateBackupSyncSettings({
        provider: 'webdav',
        remoteUrl: 'https://example.com/backup.sql',
        username: 'backup-user',
        password: 'backup-password',
        readKey: 'backup-key'
      })
      const db = getDatabase()
      db.exec(`
      UPDATE onemail_mail_folders SET sync_enabled = 1, sort_order = 3, uid_validity = '123',
        uid_next = 20, highest_modseq = '100', total_count = 1, unread_count = 1;
      INSERT INTO onemail_folder_sync_states (folder_id, account_id, last_uid)
        SELECT folder_id, account_id, 19 FROM onemail_mail_folders;
      INSERT INTO onemail_account_privacy_policies (account_id, mode) VALUES (${account.accountId}, 'strict');
      INSERT INTO onemail_privacy_trusted_senders (account_id, match_type, match_value)
        VALUES (${account.accountId}, 'domain', 'trusted.example.com');
      INSERT INTO onemail_contacts (display_name, note, is_starred) VALUES ('Alice', 'Contact note', 1);
      INSERT INTO onemail_contact_emails (contact_id, email, normalized_email, is_default)
        VALUES (1, 'alice@example.com', 'alice@example.com', 1);
      INSERT INTO onemail_mail_rules (name, account_id, conditions_json, actions_json)
        VALUES ('Archive', ${account.accountId}, '[]', '[]');
      INSERT INTO onemail_message_bodies (message_id, body_text) VALUES (1, 'Private body');
      INSERT INTO onemail_message_addresses (message_id, kind, email, normalized_email)
        VALUES (1, 'from', 'sender@example.com', 'sender@example.com');
      INSERT INTO onemail_message_attachments (message_id, filename, cached_content) VALUES (1, 'file.txt', X'00616263ff');
      INSERT INTO onemail_message_search (message_id, subject, body_text) VALUES (1, 'Mail content to omit', 'Private body');
      INSERT INTO onemail_pop3_messages (account_id, uidl, message_id) VALUES (${account.accountId}, 'uidl1', 1);
      INSERT INTO onemail_tasks (account_id, message_id, subject_snapshot) VALUES (${account.accountId}, 1, 'Mail content to omit');
      INSERT INTO onemail_task_reminders (task_id, fire_at) VALUES (1, '2030-01-01T00:00:00Z');
      INSERT INTO onemail_rule_executions (rule_id, message_id, status) VALUES (1, 1, 'success');
      INSERT INTO onemail_remote_writebacks (account_id, message_id, operation_kind, status, idempotency_key)
        VALUES (${account.accountId}, 1, 'mark_read', 'success', 'wb1');
      INSERT INTO onemail_outbox_messages (account_id, compose_kind, rfc822_message_id, from_email, subject)
        VALUES (${account.accountId}, 'new', 'draft1', 'settings@example.com', 'Draft content');
      INSERT INTO onemail_outbox_attachments (outbox_id, source_kind, filename, file_path)
        VALUES (1, 'local_file', 'file.txt', 'C:/draft-file.txt');
      INSERT INTO onemail_message_operations (message_id, account_id, operation_kind) VALUES (1, ${account.accountId}, 'reply');
      INSERT INTO onemail_sync_runs (account_id, folder_id, message_id, sync_kind) VALUES (${account.accountId}, 1, 1, 'message_body');
    `)
      const sourceSettings = getSettings()
      const sourceAccount = listAccounts()[0]
      const backup = createDatabaseSqlBackup({ includeMail })
      // Exporting a settings-only backup must not mutate the source database.
      expect(db.prepare('SELECT total_count FROM onemail_mail_folders').get()?.total_count).toBe(1)
      expect(db.prepare('SELECT COUNT(*) AS count FROM onemail_mail_messages').get()?.count).toBe(1)
      if (!includeMail) {
        expect(backup.sql).not.toContain('Mail content to omit')
        expect(backup.sql).not.toContain('Private body')
        expect(backup.sql).not.toContain('Draft content')
      }
      closeDatabase()
      configureDatabase('settings-target', createTestDatabaseKey(-20, '5555555555555555'))
      const result = importDatabaseSqlBackupContent(backup.sql, backup.fileName)
      expect(result.messageCount).toBe(includeMail ? 1 : 0)
      expect(getSettings()).toEqual(sourceSettings)
      expect(listAccounts()[0]).toMatchObject({
        desktopNotificationsEnabled: false,
        proxyMode: sourceAccount.proxyMode,
        customProxyUrl: sourceAccount.customProxyUrl,
        signatureId: signature.signatureId,
        signatureMode: 'custom',
        syncMode: 'interval',
        accountSyncIntervalMinutes: 30
      })
      expect(readAccountPassword(account.accountId)).toBe('secret')
      expect(getTranslationSettingsForMain()).toEqual(translation)
      expect(getBackupSyncSettingsForMain()).toMatchObject({
        password: 'backup-password',
        readKey: 'backup-key'
      })
      const restored = getDatabase()
      if (includeMail) {
        expect(
          restored
            .prepare(`SELECT hex(cached_content) AS content FROM onemail_message_attachments`)
            .get()
        ).toEqual({ content: '00616263FF' })
      }
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(restored.prepare('SELECT * FROM onemail_contacts').get()).toMatchObject({
        display_name: 'Alice',
        note: 'Contact note',
        is_starred: 1
      })
      expect(restored.prepare('SELECT * FROM onemail_contact_emails').get()).toMatchObject({
        email: 'alice@example.com',
        is_default: 1
      })
      expect(
        restored.prepare('SELECT * FROM onemail_account_privacy_policies').get()
      ).toMatchObject({ mode: 'strict' })
      expect(restored.prepare('SELECT * FROM onemail_privacy_trusted_senders').get()).toMatchObject(
        { match_value: 'trusted.example.com' }
      )
      expect(restored.prepare('SELECT * FROM onemail_mail_rules').get()).toMatchObject({
        name: 'Archive'
      })
      expect(restored.prepare('SELECT * FROM onemail_mail_folders').get()).toMatchObject({
        path: 'INBOX',
        sync_enabled: 1,
        sort_order: 3,
        total_count: includeMail ? 1 : 0,
        unread_count: includeMail ? 1 : 0,
        uid_next: includeMail ? 20 : null,
        highest_modseq: includeMail ? '100' : null
      })
      for (const table of [
        'message_addresses',
        'message_bodies',
        'message_attachments',
        'message_search',
        'outbox_messages',
        'outbox_attachments',
        'folder_sync_states',
        'pop3_messages',
        'sync_runs',
        'message_operations',
        'remote_writebacks',
        'rule_executions',
        'tasks',
        'task_reminders'
      ]) {
        expect(
          restored.prepare(`SELECT COUNT(*) AS count FROM onemail_${table}`).get()?.count,
          table
        ).toBe(includeMail ? 1 : 0)
      }
    },
    // Schema creation, encrypted settings and disk restore exceed 5s on Windows CI.
    15_000
  )

  it('updates notifications for selected accounts without changing defaults or other settings', () => {
    configureDatabase('notifications', createTestDatabaseKey(-30, '6666666666666666'))
    const first = seedAccount('first@example.com', 'secret')
    const second = seedAccount('second@example.com', 'secret')
    setAccountNotifications({ accountIds: [first.accountId], enabled: false })
    expect(listAccounts().map((account) => account.desktopNotificationsEnabled)).toEqual([
      false,
      true
    ])
    expect(getSettings().defaultDesktopNotificationsEnabled).toBe(true)
    expect(listAccounts()[0]).toMatchObject({ imapHost: first.imapHost, syncMode: first.syncMode })
    setAccountNotifications({ accountIds: [first.accountId, second.accountId], enabled: true })
    expect(listAccounts().every((account) => account.desktopNotificationsEnabled)).toBe(true)
    closeDatabase()
    initializeDatabase()
    expect(listAccounts().every((account) => account.desktopNotificationsEnabled)).toBe(true)
  })
})

function configureDatabase(label: string, key: string): void {
  const dir = mkdtempSync(join(tmpdir(), `onemail-backup-${label}-`))
  electronMock.app.getPath.mockReturnValue(dir)
  setDatabaseKey(key)
  const databasePath = join(dir, 'onemail.sqlite')
  setDatabasePath(databasePath)
  initializeDatabase(databasePath)
}

function seedAccount(email: string, password: string): ReturnType<typeof createAccount> {
  const account = createAccount({
    providerKey: 'test',
    email,
    password,
    authType: 'password',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  })

  saveAccountPassword(account.accountId, {
    providerKey: 'test',
    email,
    password,
    authType: 'password',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  })

  return account
}

function seedInboxMessage(accountId: number, subject: string): void {
  const db = getDatabase()
  const folderResult = db
    .prepare(
      `
      INSERT INTO onemail_mail_folders (account_id, path, name, role)
      VALUES (:accountId, 'INBOX', 'Inbox', 'inbox')
      `
    )
    .run({ accountId })
  const folderId = Number(folderResult.lastInsertRowid)

  db.prepare(
    `
    INSERT INTO onemail_mail_messages (
      account_id,
      folder_id,
      uid,
      rfc822_message_id,
      subject,
      from_email
    )
    VALUES (
      :accountId,
      :folderId,
      1,
      '<source@example.com>',
      :subject,
      'sender@example.com'
    )
    `
  ).run({ accountId, folderId, subject })
}

function createTestDatabaseKey(offsetSeconds: number, suffix: string): string {
  const timestamp = String(Math.floor(Date.now() / 1000) + offsetSeconds).padStart(10, '0')
  return `k${timestamp}${suffix}`
}
