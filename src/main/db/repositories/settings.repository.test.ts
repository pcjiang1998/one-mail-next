import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    getPath: vi.fn(() => tmpdir()),
    setLoginItemSettings: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../connection'
import {
  getBackupSyncSettings,
  getTranslationSettings,
  getTranslationSettingsForMain,
  getSettings,
  deleteSignature,
  saveSignature,
  updateBackupSyncSettings,
  updateTranslationSettings,
  updateSettings
} from './settings.repository'
import { createAccount, removeAccount } from './account.repository'

describe('settings repository backup sync', () => {
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'onemail-settings-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
      testDir = ''
    }
  })

  it('initializes independent sync ranges without enabling cleanup', () => {
    expect(getSettings()).toMatchObject({
      syncWindowDays: 30,
      syncBodyWindowDays: 7,
      cacheRetentionDays: 0,
      cleanupMetadata: false,
      downloadAttachmentsSeparately: false
    })
  })

  it.each([
    [0, 90],
    [1, 8],
    [7, 8],
    [8, 8],
    [60, 60],
    [90, 90],
    [360, 90],
    [-5, 8]
  ])('migrates the legacy window %s to %s exactly once', (old, expected) => {
    getDatabase()
      .prepare(
        `INSERT INTO onemail_app_settings (setting_key, setting_value, value_type)
        VALUES ('sync_window_days', :value, 'number')`
      )
      .run({ value: String(old) })
    expect(getSettings()).toMatchObject({
      syncWindowDays: expected,
      syncBodyWindowDays: 7,
      cacheRetentionDays: 0
    })
    updateSettings({ syncWindowDays: 5, syncBodyWindowDays: 2 })
    expect(getSettings()).toMatchObject({ syncWindowDays: 5, syncBodyWindowDays: 2 })
  })

  it('validates the combined tuple before saving any field', () => {
    updateSettings({ syncWindowDays: 40, syncBodyWindowDays: 12, cacheRetentionDays: 50 })
    expect(() => updateSettings({ syncWindowDays: 60, syncBodyWindowDays: 20 })).toThrow()
    expect(getSettings()).toMatchObject({
      syncWindowDays: 40,
      syncBodyWindowDays: 12,
      cacheRetentionDays: 50
    })
    expect(() => updateSettings({ syncWindowDays: 91 })).toThrow('90')
    expect(() => updateSettings({ syncBodyWindowDays: 31 })).toThrow('30')
    expect(() => updateSettings({ syncBodyWindowDays: 0 })).toThrow()
  })

  it('stores encrypted backup sync settings using a schema-compatible value type', () => {
    const saved = updateBackupSyncSettings({
      provider: 'webdav',
      remoteUrl: 'https://dav.example.com/onemail-backup.sql',
      username: 'user',
      password: 'secret',
      readKey: 'read-key-123'
    })

    expect(saved).toEqual({
      provider: 'webdav',
      remoteUrl: 'https://dav.example.com/onemail-backup.sql',
      username: 'user',
      passwordConfigured: true,
      readKeyConfigured: true
    })
    expect(getBackupSyncSettings()).toEqual(saved)

    const row = getDatabase()
      .prepare<{
        value_type: string
      }>("SELECT value_type FROM onemail_app_settings WHERE setting_key = 'backup_sync_settings'")
      .get()
    expect(row?.value_type).toBe('json')
  })

  it('defaults remote deletion sync on and persists changes', () => {
    expect(getSettings()).toMatchObject({
      syncDeleteToRemote: true,
      theme: 'light',
      updateCheckFrequency: 'daily',
      globalProxyMode: 'none',
      globalSignatureId: null,
      globalSyncMode: 'idle',
      globalSyncIntervalMinutes: 5,
      fallbackSyncMode: 'interval',
      fallbackSyncIntervalMinutes: 5
    })

    expect(updateSettings({ syncDeleteToRemote: false }).syncDeleteToRemote).toBe(false)
    expect(getSettings().syncDeleteToRemote).toBe(false)
  })

  it('persists color theme and update check frequency', () => {
    expect(updateSettings({ theme: 'green-dark', updateCheckFrequency: 'weekly' })).toMatchObject({
      theme: 'green-dark',
      updateCheckFrequency: 'weekly'
    })
    expect(getSettings()).toMatchObject({
      theme: 'green-dark',
      updateCheckFrequency: 'weekly'
    })
    expect(() => updateSettings({ updateCheckFrequency: 'hourly' as 'daily' })).toThrow(
      '更新检查频率'
    )
  })

  it('encrypts translation secrets and preserves each provider configuration', () => {
    const defaults = getTranslationSettings()
    const saved = updateTranslationSettings({
      ...defaults,
      activeProvider: 'deepl',
      providers: {
        ...defaults.providers,
        deepl: {
          ...defaults.providers.deepl,
          apiKey: 'deepl-secret',
          endpoint: 'https://api-free.deepl.com/v2/translate'
        },
        openai: {
          ...defaults.providers.openai,
          apiKey: 'openai-secret',
          endpoint: 'https://translation.example.com/v1/chat/completions',
          model: 'translation-model',
          apiMode: 'chat-completions'
        },
        tencent: {
          ...defaults.providers.tencent,
          apiKey: 'secret-id#secret-key#ap-shanghai#0',
          termRepositoryIds: 'term-1,term-2'
        }
      }
    })

    expect(saved.providers.deepl).toMatchObject({ apiKeyConfigured: true })
    expect(saved.providers.deepl.apiKey).toBeUndefined()
    expect(saved.providers.openai).toMatchObject({
      apiKeyConfigured: true,
      endpoint: 'https://translation.example.com/v1/chat/completions',
      model: 'translation-model',
      apiMode: 'chat-completions'
    })
    expect(saved.providers.tencent).toMatchObject({
      apiKeyConfigured: true,
      termRepositoryIds: 'term-1,term-2'
    })
    expect(getTranslationSettingsForMain().providers.deepl.apiKey).toBe('deepl-secret')
    expect(getTranslationSettingsForMain().providers.openai.apiKey).toBe('openai-secret')
    expect(getTranslationSettingsForMain().providers.tencent.apiKey).toBe(
      'secret-id#secret-key#ap-shanghai#0'
    )

    const row = getDatabase()
      .prepare<{
        setting_value: string
      }>(
        "SELECT setting_value FROM onemail_app_settings WHERE setting_key = 'translation_settings'"
      )
      .get()
    expect(row?.setting_value).not.toContain('deepl-secret')
    expect(row?.setting_value).not.toContain('openai-secret')
    expect(row?.setting_value).not.toContain('secret-key')

    const switched = updateTranslationSettings({ ...saved, activeProvider: 'openai' })
    expect(switched.activeProvider).toBe('openai')
    expect(getTranslationSettingsForMain().providers.deepl.apiKey).toBe('deepl-secret')
    expect(getTranslationSettingsForMain().providers.openai.apiKey).toBe('openai-secret')
  })

  it('accepts an unlimited cache window and validates advanced settings', () => {
    expect(updateSettings({ cacheRetentionDays: 0 }).cacheRetentionDays).toBe(0)
    expect(() => updateSettings({ syncWindowDays: -1 })).toThrow('同步范围')
    expect(
      updateSettings({ globalProxyMode: 'custom', globalProxyUrl: 'http://127.0.0.1:8080' })
        .globalProxyUrl
    ).toBe('http://127.0.0.1:8080')
    expect(() =>
      updateSettings({ globalProxyMode: 'custom', globalProxyUrl: 'ftp://127.0.0.1:21' })
    ).toThrow('自定义代理')
    expect(() => updateSettings({ fallbackSyncIntervalMinutes: 0 })).toThrow('回退同步间隔')
  })

  it('migrates the default compose account and falls back after removal', () => {
    const first = createAccount({
      providerKey: 'first-test',
      email: 'first@example.com',
      authType: 'password',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls'
    })
    const second = createAccount({
      providerKey: 'second-test',
      email: 'second@example.com',
      authType: 'password',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls'
    })
    getDatabase()
      .prepare("DELETE FROM onemail_app_settings WHERE setting_key = 'default_compose_account_id'")
      .run()

    expect(getSettings().defaultComposeAccountId).toBe(first.accountId)
    expect(
      updateSettings({ defaultComposeAccountId: second.accountId }).defaultComposeAccountId
    ).toBe(second.accountId)

    removeAccount(second.accountId)
    expect(getSettings().defaultComposeAccountId).toBe(first.accountId)
  })

  it('creates, selects, and deletes mail signatures', () => {
    expect(() => saveSignature({ title: '<invalid>', content: 'nope' })).toThrow('< 或 >')

    const signature = saveSignature({ title: 'Work', content: 'Regards' })
    expect(updateSettings({ globalSignatureId: signature.signatureId }).globalSignatureId).toBe(
      signature.signatureId
    )
    expect(deleteSignature(signature.signatureId)).toBe(true)
    expect(getSettings().globalSignatureId).toBeNull()
  })
})
