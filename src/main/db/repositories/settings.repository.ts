import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getDatabase, getDatabaseKey } from '../connection'
import { getOpenAtLogin, setOpenAtLogin } from '../../services/login-item'
import { parseCustomProxyUrl } from '../../../shared/proxy-url'
import { DEFAULT_SYNC_RANGES, validateSyncRanges } from '../../../shared/sync-range'
import type {
  AppSettings,
  BackupSyncSettings,
  MailSignature,
  MailSignatureInput,
  SettingsUpdateInput,
  TranslationProvider,
  TranslationSettings
} from '../../ipc/types'

const defaultSettings: AppSettings = {
  syncIntervalMinutes: 15,
  ...DEFAULT_SYNC_RANGES,
  downloadAttachmentsSeparately: false,
  cleanupMetadata: false,
  openAtLogin: false,
  defaultDesktopNotificationsEnabled: true,
  externalImagesBlocked: true,
  privacyDefaultMode: 'strict',
  locale: 'zh-CN',
  theme: 'light',
  updateCheckFrequency: 'daily',
  defaultComposeAccountId: null,
  syncDeleteToRemote: true,
  globalProxyMode: 'none',
  globalSignatureId: null,
  globalSyncMode: 'idle',
  globalSyncIntervalMinutes: 5,
  fallbackSyncMode: 'interval',
  fallbackSyncIntervalMinutes: 5,
  signatures: []
}

const translationProviders: TranslationProvider[] = [
  'aliyun',
  'baidu',
  'baidufield',
  'caiyun',
  'claude',
  'cnki',
  'deeplcustom',
  'gemini',
  'google',
  'huoshan',
  'huoshanweb',
  'microsoft',
  'deepl',
  'libretranslate',
  'deeplx',
  'niutrans',
  'openai',
  'tencent',
  'tencenttransmart'
]

const defaultTranslationSettings: TranslationSettings = {
  activeProvider: 'google',
  targetLanguage: 'zh-CN',
  providers: {
    aliyun: {
      endpoint: 'https://mt.aliyuncs.com',
      action: 'TranslateGeneral',
      scene: 'general'
    },
    baidu: { endpoint: 'https://api.fanyi.baidu.com/api/trans/vip/translate' },
    baidufield: { endpoint: 'https://api.fanyi.baidu.com/api/trans/vip/fieldtranslate' },
    caiyun: { endpoint: 'https://api.interpreter.caiyunai.com/v1/translator' },
    claude: {
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-7-sonnet-20250219'
    },
    cnki: { endpoint: 'https://dict.cnki.net/fyzs-front-api' },
    deeplcustom: { endpoint: 'http://localhost:1188/translate' },
    gemini: {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      model: 'gemini-2.5-flash-lite'
    },
    google: { endpoint: 'https://translate.googleapis.com' },
    huoshan: { endpoint: 'https://translate.volcengineapi.com' },
    huoshanweb: { endpoint: 'https://translate.volcengine.com/crx/translate/v1' },
    microsoft: { endpoint: 'https://api.cognitive.microsofttranslator.com' },
    deepl: { endpoint: 'https://api-free.deepl.com/v2/translate' },
    libretranslate: { endpoint: 'http://localhost:5000/translate' },
    deeplx: { endpoint: 'https://www2.deepl.com/jsonrpc' },
    niutrans: { endpoint: 'https://niutrans.com/niuInterface' },
    openai: {
      endpoint: 'https://api.openai.com/v1/responses',
      model: 'gpt-4o-mini',
      apiMode: 'responses'
    },
    tencent: { endpoint: 'https://tmt.tencentcloudapi.com' },
    tencenttransmart: { endpoint: 'https://transmart.qq.com/api/imt' }
  }
}

const settingsDefinition = {
  syncIntervalMinutes: { key: 'sync_interval_minutes', type: 'number' },
  syncWindowDays: { key: 'sync_window_days', type: 'number' },
  syncBodyWindowDays: { key: 'sync_body_window_days', type: 'number' },
  cacheRetentionDays: { key: 'cache_retention_days', type: 'number' },
  downloadAttachmentsSeparately: { key: 'download_attachments_separately', type: 'boolean' },
  cleanupMetadata: { key: 'cleanup_metadata', type: 'boolean' },
  openAtLogin: { key: 'open_at_login', type: 'boolean' },
  defaultDesktopNotificationsEnabled: {
    key: 'default_desktop_notifications_enabled',
    type: 'boolean'
  },
  externalImagesBlocked: { key: 'external_images_blocked', type: 'boolean' },
  privacyDefaultMode: { key: 'privacy_default_mode', type: 'string' },
  locale: { key: 'locale', type: 'string' },
  theme: { key: 'theme', type: 'string' },
  updateCheckFrequency: { key: 'update_check_frequency', type: 'string' },
  defaultComposeAccountId: { key: 'default_compose_account_id', type: 'number' },
  syncDeleteToRemote: { key: 'sync_delete_to_remote', type: 'boolean' },
  globalProxyMode: { key: 'global_proxy_mode', type: 'string' },
  globalProxyUrl: { key: 'global_proxy_url', type: 'string' },
  globalSignatureId: { key: 'global_signature_id', type: 'number' },
  globalSyncMode: { key: 'global_sync_mode', type: 'string' },
  globalSyncIntervalMinutes: { key: 'global_sync_interval_minutes', type: 'number' },
  fallbackSyncMode: { key: 'fallback_sync_mode', type: 'string' },
  fallbackSyncIntervalMinutes: { key: 'fallback_sync_interval_minutes', type: 'number' },
  lastAttachmentDownloadDir: { key: 'last_attachment_download_dir', type: 'string' },
  backupSyncSettings: { key: 'backup_sync_settings', type: 'json' },
  translationSettings: { key: 'translation_settings', type: 'json' }
} as const

type EncryptedSettingsPayload = {
  version: 1
  alg: 'aes-256-gcm'
  iv: string
  authTag: string
  ciphertext: string
}

type SettingRow = {
  setting_key: string
  setting_value: string
  value_type: string
}

export function getSettings(): AppSettings {
  ensureDefaultSettings()

  const rows = getDatabase()
    .prepare<SettingRow>(
      `
      SELECT setting_key, setting_value, value_type
      FROM onemail_app_settings
      `
    )
    .all()

  const byKey = new Map(rows.map((row) => [row.setting_key, row]))

  return {
    syncIntervalMinutes: readNumber(byKey.get(settingsDefinition.syncIntervalMinutes.key), 15),
    syncWindowDays: readNumber(byKey.get(settingsDefinition.syncWindowDays.key), 30),
    syncBodyWindowDays: readNumber(byKey.get(settingsDefinition.syncBodyWindowDays.key), 7),
    cacheRetentionDays: readNumber(byKey.get(settingsDefinition.cacheRetentionDays.key), 0),
    downloadAttachmentsSeparately: readBoolean(
      byKey.get(settingsDefinition.downloadAttachmentsSeparately.key),
      false
    ),
    cleanupMetadata: readBoolean(byKey.get(settingsDefinition.cleanupMetadata.key), false),
    openAtLogin: getOpenAtLogin(),
    defaultDesktopNotificationsEnabled: readBoolean(
      byKey.get(settingsDefinition.defaultDesktopNotificationsEnabled.key),
      true
    ),
    externalImagesBlocked: readBoolean(
      byKey.get(settingsDefinition.externalImagesBlocked.key),
      true
    ),
    privacyDefaultMode: readEnum(
      byKey.get(settingsDefinition.privacyDefaultMode.key),
      ['unrestricted', 'loose', 'strict'],
      defaultSettings.privacyDefaultMode ?? 'strict'
    ) as AppSettings['privacyDefaultMode'],
    locale: byKey.get(settingsDefinition.locale.key)?.setting_value ?? defaultSettings.locale,
    theme: readEnum(
      byKey.get(settingsDefinition.theme.key),
      [
        'light',
        'dark',
        'blue-light',
        'green-light',
        'rose-light',
        'blue-dark',
        'green-dark',
        'burgundy-dark'
      ],
      defaultSettings.theme
    ),
    updateCheckFrequency: readEnum(
      byKey.get(settingsDefinition.updateCheckFrequency.key),
      ['manual', 'daily', 'weekly'],
      defaultSettings.updateCheckFrequency
    ),
    defaultComposeAccountId: readDefaultComposeAccountId(
      byKey.get(settingsDefinition.defaultComposeAccountId.key)
    ),
    syncDeleteToRemote: readBoolean(
      byKey.get(settingsDefinition.syncDeleteToRemote.key),
      defaultSettings.syncDeleteToRemote
    ),
    globalProxyMode: readEnum(
      byKey.get(settingsDefinition.globalProxyMode.key),
      ['none', 'system', 'custom'],
      defaultSettings.globalProxyMode
    ),
    globalProxyUrl: optionalTrim(byKey.get(settingsDefinition.globalProxyUrl.key)?.setting_value),
    globalSignatureId: readNullableNumber(byKey.get(settingsDefinition.globalSignatureId.key)),
    globalSyncMode: readEnum(
      byKey.get(settingsDefinition.globalSyncMode.key),
      ['idle', 'interval', 'manual'],
      defaultSettings.globalSyncMode
    ),
    globalSyncIntervalMinutes: readNumber(
      byKey.get(settingsDefinition.globalSyncIntervalMinutes.key),
      defaultSettings.globalSyncIntervalMinutes
    ),
    fallbackSyncMode: readEnum(
      byKey.get(settingsDefinition.fallbackSyncMode.key),
      ['interval', 'manual'],
      defaultSettings.fallbackSyncMode
    ),
    fallbackSyncIntervalMinutes: readNumber(
      byKey.get(settingsDefinition.fallbackSyncIntervalMinutes.key),
      defaultSettings.fallbackSyncIntervalMinutes
    ),
    signatures: listSignatures()
  }
}

export function updateSettings(input: SettingsUpdateInput): AppSettings {
  const current = getSettings()
  const next: AppSettings = { ...current, ...input }
  validateSettings(next)

  if (input.openAtLogin !== undefined) {
    setOpenAtLogin(next.openAtLogin)
  }

  const db = getDatabase()
  db.exec('SAVEPOINT update_app_settings')
  try {
    writeSetting(
      settingsDefinition.syncIntervalMinutes.key,
      String(next.syncIntervalMinutes),
      settingsDefinition.syncIntervalMinutes.type
    )
    writeSetting(
      settingsDefinition.syncWindowDays.key,
      String(next.syncWindowDays),
      settingsDefinition.syncWindowDays.type
    )
    writeSetting(
      settingsDefinition.syncBodyWindowDays.key,
      String(next.syncBodyWindowDays),
      'number'
    )
    writeSetting(
      settingsDefinition.cacheRetentionDays.key,
      String(next.cacheRetentionDays),
      'number'
    )
    writeSetting(
      settingsDefinition.downloadAttachmentsSeparately.key,
      next.downloadAttachmentsSeparately ? '1' : '0',
      'boolean'
    )
    writeSetting(
      settingsDefinition.cleanupMetadata.key,
      next.cleanupMetadata ? '1' : '0',
      'boolean'
    )
    writeSetting(
      settingsDefinition.defaultDesktopNotificationsEnabled.key,
      next.defaultDesktopNotificationsEnabled ? '1' : '0',
      settingsDefinition.defaultDesktopNotificationsEnabled.type
    )
    writeSetting(
      settingsDefinition.openAtLogin.key,
      next.openAtLogin ? '1' : '0',
      settingsDefinition.openAtLogin.type
    )
    writeSetting(
      settingsDefinition.externalImagesBlocked.key,
      next.externalImagesBlocked ? '1' : '0',
      settingsDefinition.externalImagesBlocked.type
    )
    writeSetting(
      settingsDefinition.privacyDefaultMode.key,
      next.privacyDefaultMode ?? 'strict',
      settingsDefinition.privacyDefaultMode.type
    )
    writeSetting(settingsDefinition.locale.key, next.locale, settingsDefinition.locale.type)
    writeSetting(settingsDefinition.theme.key, next.theme, settingsDefinition.theme.type)
    writeSetting(
      settingsDefinition.updateCheckFrequency.key,
      next.updateCheckFrequency,
      settingsDefinition.updateCheckFrequency.type
    )
    writeSetting(
      settingsDefinition.defaultComposeAccountId.key,
      next.defaultComposeAccountId === null ? '' : String(next.defaultComposeAccountId),
      settingsDefinition.defaultComposeAccountId.type
    )
    writeSetting(
      settingsDefinition.syncDeleteToRemote.key,
      next.syncDeleteToRemote ? '1' : '0',
      settingsDefinition.syncDeleteToRemote.type
    )
    writeSetting(
      settingsDefinition.globalProxyMode.key,
      next.globalProxyMode,
      settingsDefinition.globalProxyMode.type
    )
    writeSetting(
      settingsDefinition.globalProxyUrl.key,
      optionalTrim(next.globalProxyUrl) ?? '',
      settingsDefinition.globalProxyUrl.type
    )
    writeSetting(
      settingsDefinition.globalSignatureId.key,
      next.globalSignatureId === null ? '' : String(next.globalSignatureId),
      settingsDefinition.globalSignatureId.type
    )
    writeSetting(
      settingsDefinition.globalSyncMode.key,
      next.globalSyncMode,
      settingsDefinition.globalSyncMode.type
    )
    writeSetting(
      settingsDefinition.globalSyncIntervalMinutes.key,
      String(next.globalSyncIntervalMinutes),
      settingsDefinition.globalSyncIntervalMinutes.type
    )
    writeSetting(
      settingsDefinition.fallbackSyncMode.key,
      next.fallbackSyncMode,
      settingsDefinition.fallbackSyncMode.type
    )
    writeSetting(
      settingsDefinition.fallbackSyncIntervalMinutes.key,
      String(next.fallbackSyncIntervalMinutes),
      settingsDefinition.fallbackSyncIntervalMinutes.type
    )

    db.exec('RELEASE update_app_settings')
  } catch (error) {
    db.exec('ROLLBACK TO update_app_settings')
    db.exec('RELEASE update_app_settings')
    throw error
  }
  return getSettings()
}

export function getBackupSyncSettings(): BackupSyncSettings {
  return redactBackupSyncSettings(readBackupSyncSettings())
}

export function getBackupSyncSettingsForMain(): BackupSyncSettings {
  return readBackupSyncSettings()
}

export function updateBackupSyncSettings(input: BackupSyncSettings): BackupSyncSettings {
  const nextSettings = normalizeBackupSyncSettings(input, readBackupSyncSettings())

  writeSetting(
    settingsDefinition.backupSyncSettings.key,
    encryptSensitiveSettings(nextSettings),
    settingsDefinition.backupSyncSettings.type
  )

  return redactBackupSyncSettings(nextSettings)
}

export function resolveBackupSyncSettingsForMain(input: BackupSyncSettings): BackupSyncSettings {
  return normalizeBackupSyncSettings(input, readBackupSyncSettings())
}

export function getTranslationSettings(): TranslationSettings {
  return redactTranslationSettings(readTranslationSettings())
}

export function getTranslationSettingsForMain(): TranslationSettings {
  return readTranslationSettings()
}

export function updateTranslationSettings(input: TranslationSettings): TranslationSettings {
  const nextSettings = normalizeTranslationSettings(input, readTranslationSettings())
  writeSetting(
    settingsDefinition.translationSettings.key,
    encryptSensitiveSettings(nextSettings),
    settingsDefinition.translationSettings.type
  )
  return redactTranslationSettings(nextSettings)
}

export function listSignatures(): MailSignature[] {
  return getDatabase()
    .prepare<{
      signature_id: number
      title: string
      content: string
      created_at: string
      updated_at: string
    }>(
      `SELECT signature_id, title, content, created_at, updated_at
       FROM onemail_mail_signatures
       ORDER BY title COLLATE NOCASE, signature_id`
    )
    .all()
    .map((row) => ({
      signatureId: Number(row.signature_id),
      title: row.title,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
}

export function saveSignature(input: MailSignatureInput): MailSignature {
  const title = input.title.trim()
  if (!title) throw new Error('请输入签名标题。')
  if (/[<>]/.test(title)) throw new Error('签名标题不能包含 < 或 >。')
  if (title.length > 80) throw new Error('签名标题不能超过 80 个字符。')

  const db = getDatabase()
  let signatureId = input.signatureId
  if (signatureId) {
    const result = db
      .prepare(
        `UPDATE onemail_mail_signatures
         SET title = :title, content = :content,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE signature_id = :signatureId`
      )
      .run({ signatureId, title, content: input.content })
    if (result.changes === 0) throw new Error('签名不存在。')
  } else {
    const result = db
      .prepare(
        `INSERT INTO onemail_mail_signatures (title, content)
         VALUES (:title, :content)`
      )
      .run({ title, content: input.content })
    signatureId = Number(result.lastInsertRowid)
  }

  const signature = listSignatures().find((item) => item.signatureId === signatureId)
  if (!signature) throw new Error('保存签名失败。')
  return signature
}

export function deleteSignature(signatureId: number): boolean {
  const db = getDatabase()
  db.prepare(
    `UPDATE onemail_mail_accounts
     SET signature_mode = CASE WHEN signature_id = :signatureId THEN 'global' ELSE signature_mode END,
         signature_id = CASE WHEN signature_id = :signatureId THEN NULL ELSE signature_id END
     WHERE signature_id = :signatureId`
  ).run({ signatureId })
  const result = db
    .prepare('DELETE FROM onemail_mail_signatures WHERE signature_id = :signatureId')
    .run({ signatureId })
  const settings = getSettings()
  if (settings.globalSignatureId === signatureId) {
    writeSetting(
      settingsDefinition.globalSignatureId.key,
      '',
      settingsDefinition.globalSignatureId.type
    )
  }
  return result.changes > 0
}

export function resolveAccountSignature(accountId: number): string | undefined {
  const settings = getSettings()
  const row = getDatabase()
    .prepare<{ signature_mode: string; signature_id: number | null }>(
      `SELECT signature_mode, signature_id
       FROM onemail_mail_accounts WHERE account_id = :accountId`
    )
    .get({ accountId })
  if (!row || row.signature_mode === 'none') return undefined
  const signatureId =
    row.signature_mode === 'custom' ? Number(row.signature_id || 0) : settings.globalSignatureId
  if (!signatureId) return undefined
  return settings.signatures.find((item) => item.signatureId === signatureId)?.content
}

export function getLastAttachmentDownloadDir(): string | undefined {
  const row = readSetting(settingsDefinition.lastAttachmentDownloadDir.key)
  const directory = row?.setting_value.trim()
  return directory ? directory : undefined
}

export function setLastAttachmentDownloadDir(directory: string): void {
  const value = directory.trim()
  if (!value) return

  writeSetting(
    settingsDefinition.lastAttachmentDownloadDir.key,
    value,
    settingsDefinition.lastAttachmentDownloadDir.type
  )
}

function ensureDefaultSettings(): void {
  migrateSyncRanges()
  updateMissingSetting(
    settingsDefinition.syncIntervalMinutes.key,
    String(defaultSettings.syncIntervalMinutes),
    settingsDefinition.syncIntervalMinutes.type
  )
  updateMissingSetting(
    settingsDefinition.syncWindowDays.key,
    String(defaultSettings.syncWindowDays),
    settingsDefinition.syncWindowDays.type
  )
  updateMissingSetting(
    settingsDefinition.externalImagesBlocked.key,
    defaultSettings.externalImagesBlocked ? '1' : '0',
    settingsDefinition.externalImagesBlocked.type
  )
  updateMissingSetting(
    settingsDefinition.privacyDefaultMode.key,
    defaultSettings.privacyDefaultMode ?? 'strict',
    settingsDefinition.privacyDefaultMode.type
  )
  updateMissingSetting(
    settingsDefinition.defaultDesktopNotificationsEnabled.key,
    '1',
    settingsDefinition.defaultDesktopNotificationsEnabled.type
  )
  updateMissingSetting(
    settingsDefinition.openAtLogin.key,
    defaultSettings.openAtLogin ? '1' : '0',
    settingsDefinition.openAtLogin.type
  )
  updateMissingSetting(
    settingsDefinition.locale.key,
    defaultSettings.locale,
    settingsDefinition.locale.type
  )
  updateMissingSetting(
    settingsDefinition.theme.key,
    defaultSettings.theme,
    settingsDefinition.theme.type
  )
  updateMissingSetting(
    settingsDefinition.updateCheckFrequency.key,
    defaultSettings.updateCheckFrequency,
    settingsDefinition.updateCheckFrequency.type
  )
  updateMissingSetting(
    settingsDefinition.defaultComposeAccountId.key,
    String(getFirstAccountId() ?? ''),
    settingsDefinition.defaultComposeAccountId.type
  )
  updateMissingSetting(
    settingsDefinition.syncDeleteToRemote.key,
    defaultSettings.syncDeleteToRemote ? '1' : '0',
    settingsDefinition.syncDeleteToRemote.type
  )
  updateMissingSetting(
    settingsDefinition.globalProxyMode.key,
    defaultSettings.globalProxyMode,
    settingsDefinition.globalProxyMode.type
  )
  updateMissingSetting(
    settingsDefinition.globalSyncMode.key,
    defaultSettings.globalSyncMode,
    settingsDefinition.globalSyncMode.type
  )
  updateMissingSetting(
    settingsDefinition.globalSyncIntervalMinutes.key,
    String(defaultSettings.globalSyncIntervalMinutes),
    settingsDefinition.globalSyncIntervalMinutes.type
  )
  updateMissingSetting(
    settingsDefinition.fallbackSyncMode.key,
    defaultSettings.fallbackSyncMode,
    settingsDefinition.fallbackSyncMode.type
  )
  updateMissingSetting(
    settingsDefinition.fallbackSyncIntervalMinutes.key,
    String(defaultSettings.fallbackSyncIntervalMinutes),
    settingsDefinition.fallbackSyncIntervalMinutes.type
  )
}

function migrateSyncRanges(): void {
  if (readSetting('mail_sync_ranges_version')) return
  const previous = readSetting(settingsDefinition.syncWindowDays.key)
  let days = DEFAULT_SYNC_RANGES.syncWindowDays
  if (previous) {
    const value = Number(previous.setting_value)
    if (!previous.setting_value.trim() || !Number.isSafeInteger(value)) {
      throw new Error('旧邮件同步范围不是有效整数，无法迁移。')
    }
    days = value === 0 ? 90 : Math.min(90, Math.max(8, value))
  }
  const db = getDatabase()
  db.exec('SAVEPOINT migrate_sync_ranges')
  try {
    writeSetting(settingsDefinition.syncWindowDays.key, String(days), 'number')
    writeSetting(settingsDefinition.syncBodyWindowDays.key, '7', 'number')
    writeSetting(settingsDefinition.cacheRetentionDays.key, '0', 'number')
    writeSetting(settingsDefinition.downloadAttachmentsSeparately.key, '0', 'boolean')
    writeSetting(settingsDefinition.cleanupMetadata.key, '0', 'boolean')
    writeSetting('mail_sync_ranges_version', '1', 'number')
    db.exec('RELEASE migrate_sync_ranges')
  } catch (error) {
    db.exec('ROLLBACK TO migrate_sync_ranges')
    db.exec('RELEASE migrate_sync_ranges')
    throw error
  }
}

function updateMissingSetting(key: string, value: string, valueType: string): void {
  getDatabase()
    .prepare(
      `
      INSERT OR IGNORE INTO onemail_app_settings (setting_key, setting_value, value_type)
      VALUES (:key, :value, :valueType)
      `
    )
    .run({ key, value, valueType })
}

function readSetting(key: string): SettingRow | undefined {
  return getDatabase()
    .prepare<SettingRow>(
      `
      SELECT setting_key, setting_value, value_type
      FROM onemail_app_settings
      WHERE setting_key = :key
      `
    )
    .get({ key })
}

function writeSetting(key: string, value: string, valueType: string): void {
  getDatabase()
    .prepare(
      `
      INSERT INTO onemail_app_settings (setting_key, setting_value, value_type, updated_at)
      VALUES (:key, :value, :valueType, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        value_type = excluded.value_type,
        updated_at = excluded.updated_at
      `
    )
    .run({ key, value, valueType })
}

function readBackupSyncSettings(): BackupSyncSettings {
  const row = readSetting(settingsDefinition.backupSyncSettings.key)
  if (!row?.setting_value) return { provider: 'none' }

  try {
    const settings = JSON.parse(decryptSensitiveSettings(row.setting_value)) as BackupSyncSettings
    return normalizeStoredBackupSyncSettings(settings)
  } catch {
    return { provider: 'none' }
  }
}

function normalizeStoredBackupSyncSettings(settings: BackupSyncSettings): BackupSyncSettings {
  if (settings.provider === 'webdav') {
    return {
      provider: 'webdav',
      remoteUrl: settings.remoteUrl,
      username: settings.username,
      password: settings.password,
      readKey: settings.readKey
    }
  }

  if (settings.provider === 's3') {
    return {
      provider: 's3',
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      key: settings.key,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      readKey: settings.readKey
    }
  }

  return { provider: 'none' }
}

function normalizeBackupSyncSettings(
  input: BackupSyncSettings,
  current: BackupSyncSettings
): BackupSyncSettings {
  if (input.provider === 'webdav') {
    const remoteUrl = input.remoteUrl.trim()
    validateHttpUrl(remoteUrl, 'WebDAV URL')

    return {
      provider: 'webdav',
      remoteUrl,
      username: optionalTrim(input.username),
      password: normalizeSecret(
        input.password,
        current.provider === 'webdav' ? current.password : undefined
      ),
      readKey: requireReadKey(
        normalizeSecret(input.readKey, current.provider === 'webdav' ? current.readKey : undefined)
      )
    }
  }

  if (input.provider === 's3') {
    const endpoint = optionalTrim(input.endpoint)?.replace(/\/+$/, '')
    if (endpoint) validateHttpUrl(endpoint, 'S3 Endpoint')

    const secretAccessKey = normalizeSecret(
      input.secretAccessKey,
      current.provider === 's3' ? current.secretAccessKey : undefined
    )

    if (!secretAccessKey) {
      throw new Error('请输入 S3 Secret Access Key。')
    }

    return {
      provider: 's3',
      endpoint,
      region: optionalTrim(input.region) ?? 'us-east-1',
      bucket: requireTrimmed(input.bucket, '请输入 S3 Bucket。'),
      key: requireTrimmed(input.key, '请输入 S3 对象路径。'),
      accessKeyId: requireTrimmed(input.accessKeyId, '请输入 S3 Access Key ID。'),
      secretAccessKey,
      readKey: requireReadKey(
        normalizeSecret(input.readKey, current.provider === 's3' ? current.readKey : undefined)
      )
    }
  }

  return { provider: 'none' }
}

function redactBackupSyncSettings(settings: BackupSyncSettings): BackupSyncSettings {
  if (settings.provider === 'webdav') {
    return {
      provider: 'webdav',
      remoteUrl: settings.remoteUrl,
      username: settings.username,
      passwordConfigured: Boolean(settings.password),
      readKeyConfigured: Boolean(settings.readKey)
    }
  }

  if (settings.provider === 's3') {
    return {
      provider: 's3',
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      key: settings.key,
      accessKeyId: settings.accessKeyId,
      secretAccessKeyConfigured: Boolean(settings.secretAccessKey),
      readKeyConfigured: Boolean(settings.readKey)
    }
  }

  return { provider: 'none' }
}

function readTranslationSettings(): TranslationSettings {
  const row = readSetting(settingsDefinition.translationSettings.key)
  if (!row?.setting_value) return cloneDefaultTranslationSettings()

  try {
    const settings = JSON.parse(decryptSensitiveSettings(row.setting_value)) as TranslationSettings
    return normalizeTranslationSettings(settings, cloneDefaultTranslationSettings())
  } catch {
    return cloneDefaultTranslationSettings()
  }
}

function normalizeTranslationSettings(
  input: TranslationSettings,
  current: TranslationSettings
): TranslationSettings {
  const activeProvider =
    input && translationProviders.includes(input.activeProvider)
      ? input.activeProvider
      : current.activeProvider
  const targetLanguage = isTranslationLanguage(input?.targetLanguage)
    ? input.targetLanguage
    : current.targetLanguage
  const providers = {} as TranslationSettings['providers']

  for (const provider of translationProviders) {
    const defaults = defaultTranslationSettings.providers[provider]
    const currentConfig = current.providers?.[provider] ?? defaults
    const inputConfig = input?.providers?.[provider] ?? currentConfig
    const endpoint =
      optionalTrim(inputConfig.endpoint) ?? currentConfig.endpoint ?? defaults.endpoint
    if (endpoint) validateHttpUrl(endpoint, `${provider} Endpoint`)

    providers[provider] = {
      endpoint,
      apiKey:
        optionalTrim(inputConfig.apiKey) ??
        (inputConfig.apiKeyConfigured === false ? undefined : currentConfig.apiKey),
      model: optionalTrim(inputConfig.model) ?? optionalTrim(currentConfig.model) ?? defaults.model,
      apiMode: isOpenAiApiMode(inputConfig.apiMode)
        ? inputConfig.apiMode
        : provider === 'openai' && endpoint?.includes('/chat/completions')
          ? 'chat-completions'
          : isOpenAiApiMode(currentConfig.apiMode)
            ? currentConfig.apiMode
            : defaults.apiMode,
      action:
        optionalTrim(inputConfig.action) ?? optionalTrim(currentConfig.action) ?? defaults.action,
      scene: optionalTrim(inputConfig.scene) ?? optionalTrim(currentConfig.scene) ?? defaults.scene,
      dictionaryId:
        optionalTrim(inputConfig.dictionaryId) ?? optionalTrim(currentConfig.dictionaryId),
      memoryId: optionalTrim(inputConfig.memoryId) ?? optionalTrim(currentConfig.memoryId),
      termRepositoryIds:
        optionalTrim(inputConfig.termRepositoryIds) ??
        optionalTrim(currentConfig.termRepositoryIds),
      sentenceRepositoryIds:
        optionalTrim(inputConfig.sentenceRepositoryIds) ??
        optionalTrim(currentConfig.sentenceRepositoryIds)
    }
  }

  return { activeProvider, targetLanguage, providers }
}

function redactTranslationSettings(settings: TranslationSettings): TranslationSettings {
  const providers = {} as TranslationSettings['providers']
  for (const provider of translationProviders) {
    const config = settings.providers[provider]
    providers[provider] = {
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      model: config.model,
      apiMode: config.apiMode,
      action: config.action,
      scene: config.scene,
      dictionaryId: config.dictionaryId,
      memoryId: config.memoryId,
      termRepositoryIds: config.termRepositoryIds,
      sentenceRepositoryIds: config.sentenceRepositoryIds
    }
  }
  return { ...settings, providers }
}

function cloneDefaultTranslationSettings(): TranslationSettings {
  return {
    ...defaultTranslationSettings,
    providers: Object.fromEntries(
      translationProviders.map((provider) => [
        provider,
        { ...defaultTranslationSettings.providers[provider] }
      ])
    ) as TranslationSettings['providers']
  }
}

function isTranslationLanguage(value: unknown): value is TranslationSettings['targetLanguage'] {
  return ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'de', 'fr', 'es'].includes(String(value))
}

function isOpenAiApiMode(
  value: unknown
): value is NonNullable<TranslationSettings['providers']['openai']['apiMode']> {
  return value === 'responses' || value === 'chat-completions'
}

function optionalTrim(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function requireTrimmed(value: string | undefined, message: string): string {
  const trimmed = optionalTrim(value)
  if (!trimmed) throw new Error(message)
  return trimmed
}

function normalizeSecret(
  nextValue: string | undefined,
  currentValue: string | undefined
): string | undefined {
  const nextSecret = optionalTrim(nextValue)
  return nextSecret ?? currentValue
}

function requireReadKey(value: string | undefined): string {
  if (!value || value.length < 8) throw new Error('数据读取密钥至少需要 8 个字符。')
  return value
}

function validateHttpUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} 格式无效。`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label} 只支持 http 或 https。`)
  }
}

function validateSettings(settings: AppSettings): void {
  validateIntegerRange(settings.syncIntervalMinutes, 0, 1440, '同步间隔')
  validateSyncRanges(settings)
  if (
    typeof settings.downloadAttachmentsSeparately !== 'boolean' ||
    typeof settings.cleanupMetadata !== 'boolean'
  ) {
    throw new Error('附件下载与缓存清理选项必须是布尔值。')
  }
  validateIntegerRange(settings.globalSyncIntervalMinutes, 1, 1440, '全局同步间隔')
  validateIntegerRange(settings.fallbackSyncIntervalMinutes, 1, 1440, '回退同步间隔')

  if (!['zh-CN', 'en-US'].includes(settings.locale)) throw new Error('不支持的界面语言。')
  if (
    ![
      'light',
      'dark',
      'blue-light',
      'green-light',
      'rose-light',
      'blue-dark',
      'green-dark',
      'burgundy-dark'
    ].includes(settings.theme)
  ) {
    throw new Error('不支持的主题设置。')
  }
  if (!['manual', 'daily', 'weekly'].includes(settings.updateCheckFrequency)) {
    throw new Error('不支持的更新检查频率。')
  }
  if (
    settings.defaultComposeAccountId !== null &&
    !getDatabase()
      .prepare('SELECT 1 FROM onemail_mail_accounts WHERE account_id = :accountId')
      .get({ accountId: settings.defaultComposeAccountId })
  ) {
    throw new Error('选择的默认发件邮箱不存在。')
  }
  if (!['none', 'system', 'custom'].includes(settings.globalProxyMode)) {
    throw new Error('不支持的全局代理模式。')
  }
  if (!['idle', 'interval', 'manual'].includes(settings.globalSyncMode)) {
    throw new Error('不支持的全局同步模式。')
  }
  if (!['interval', 'manual'].includes(settings.fallbackSyncMode)) {
    throw new Error('不支持的回退同步模式。')
  }

  if (settings.globalProxyMode === 'custom') {
    validateCustomProxyUrl(settings.globalProxyUrl)
  }
  if (
    settings.globalSignatureId !== null &&
    !getDatabase()
      .prepare('SELECT 1 FROM onemail_mail_signatures WHERE signature_id = :signatureId')
      .get({ signatureId: settings.globalSignatureId })
  ) {
    throw new Error('选择的全局签名不存在。')
  }
}

function readDefaultComposeAccountId(row: SettingRow | undefined): number | null {
  const storedAccountId = readNullableNumber(row)
  if (
    storedAccountId !== null &&
    getDatabase()
      .prepare('SELECT 1 FROM onemail_mail_accounts WHERE account_id = :accountId')
      .get({ accountId: storedAccountId })
  ) {
    return storedAccountId
  }

  const fallbackAccountId = getFirstAccountId()
  const fallbackValue = fallbackAccountId === null ? '' : String(fallbackAccountId)
  if (!row || row.setting_value !== fallbackValue) {
    writeSetting(
      settingsDefinition.defaultComposeAccountId.key,
      fallbackValue,
      settingsDefinition.defaultComposeAccountId.type
    )
  }
  return fallbackAccountId
}

function getFirstAccountId(): number | null {
  const row = getDatabase()
    .prepare<{
      account_id: number
    }>(
      'SELECT account_id FROM onemail_mail_accounts ORDER BY sort_order ASC, account_id ASC LIMIT 1'
    )
    .get()
  const accountId = Number(row?.account_id)
  return Number.isInteger(accountId) && accountId > 0 ? accountId : null
}

function validateIntegerRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数。`)
  }
}

function validateCustomProxyUrl(value?: string): void {
  const proxyUrl = value?.trim()
  if (!proxyUrl) throw new Error('请输入自定义代理地址。')
  if (!parseCustomProxyUrl(proxyUrl)) {
    throw new Error('自定义代理必须是有效的 HTTP、HTTPS、SOCKS4、SOCKS4a、SOCKS5 或 SOCKS5h 地址。')
  }
}

function encryptSensitiveSettings(settings: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getSettingsEncryptionKey(), iv)
  const plaintext = JSON.stringify(settings)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const payload: EncryptedSettingsPayload = {
    version: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decryptSensitiveSettings(value: string): string {
  const payload = JSON.parse(
    Buffer.from(value, 'base64').toString('utf8')
  ) as EncryptedSettingsPayload
  if (payload.version !== 1 || payload.alg !== 'aes-256-gcm') {
    throw new Error('敏感设置加密格式不支持。')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getSettingsEncryptionKey(),
    Buffer.from(payload.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function getSettingsEncryptionKey(): Buffer {
  return createHash('sha256').update(getDatabaseKey()).digest()
}

function readNumber(row: SettingRow | undefined, fallback: number): number {
  if (!row) return fallback
  const value = Number(row.setting_value)
  return Number.isFinite(value) ? value : fallback
}

function readBoolean(row: SettingRow | undefined, fallback: boolean): boolean {
  if (!row) return fallback
  return row.setting_value === '1' || row.setting_value === 'true'
}

function readNullableNumber(row: SettingRow | undefined): number | null {
  if (!row?.setting_value.trim()) return null
  const value = Number(row.setting_value)
  return Number.isInteger(value) && value > 0 ? value : null
}

function readEnum<T extends string>(
  row: SettingRow | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const value = row?.setting_value as T | undefined
  return value && allowed.includes(value) ? value : fallback
}
