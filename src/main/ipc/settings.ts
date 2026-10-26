import { handleDatabaseIpc } from './database-handler'
import { type WebContents } from 'electron'
import {
  deleteSignature,
  getBackupSyncSettings,
  getSettings,
  saveSignature,
  updateBackupSyncSettings,
  updateSettings
} from '../db/repositories/settings.repository'
import { cleanLocalMailCache } from '../services/cache-maintenance'
import {
  downloadBackupSync,
  downloadBackupSyncFromSettings,
  testBackupSync,
  uploadBackupSync
} from '../services/backup-sync'
import {
  exportDatabaseSqlBackup,
  importDatabaseSqlBackup,
  type BackupImportProgressReporter
} from '../services/database-backup'
import { refreshMailboxWatchers, restartMailboxWatchers } from '../services/mailbox-watch'
import { startAutoUpdateChecks } from '../services/auto-update'
import { getDatabase } from '../db/connection'
import { setOpenAtLogin } from '../services/login-item'
import type {
  BackupImportProgress,
  BackupExportOptions,
  BackupSyncSettings,
  MailSignatureInput,
  SettingsUpdateInput
} from './types'

export function registerSettingsIpc(): void {
  handleDatabaseIpc('settings/get', () => getSettings())
  handleDatabaseIpc('settings/update', (_event, input: SettingsUpdateInput) => {
    const previousFrequency = getSettings().updateCheckFrequency
    const settings = updateSettings(input)
    refreshMailboxWatchers()
    if (settings.updateCheckFrequency !== previousFrequency) {
      startAutoUpdateChecks(settings.updateCheckFrequency)
    }
    return settings
  })
  handleDatabaseIpc('settings/saveSignature', (_event, input: MailSignatureInput) =>
    saveSignature(input)
  )
  handleDatabaseIpc('settings/deleteSignature', (_event, signatureId: number) =>
    deleteSignature(signatureId)
  )
  handleDatabaseIpc('settings/cleanupCache', (_event, input: unknown) => {
    if (
      !input ||
      typeof input !== 'object' ||
      !('cacheRetentionDays' in input) ||
      typeof input.cacheRetentionDays !== 'number' ||
      !('cleanupMetadata' in input) ||
      typeof input.cleanupMetadata !== 'boolean'
    ) {
      throw new Error('缓存清理请求缺少已确认的保留天数和元信息清理选项。')
    }
    return cleanLocalMailCache({
      cacheRetentionDays: input.cacheRetentionDays,
      cleanupMetadata: input.cleanupMetadata
    })
  })
  handleDatabaseIpc('settings/getBackupSync', () => getBackupSyncSettings())
  handleDatabaseIpc('settings/updateBackupSync', (_event, input: BackupSyncSettings) =>
    updateBackupSyncSettings(input)
  )
  handleDatabaseIpc('settings/testBackupSync', (_event, input: BackupSyncSettings) =>
    testBackupSync(input)
  )
  handleDatabaseIpc('settings/uploadBackupSync', (_event, options?: BackupExportOptions) =>
    uploadBackupSync(options)
  )
  handleDatabaseIpc('settings/downloadBackupSync', async (event, operationId?: string) => {
    const result = await downloadBackupSync(
      createBackupImportProgressReporter(event.sender, operationId)
    )
    if (result.imported) applyRestoredSettings()
    return result
  })
  handleDatabaseIpc(
    'settings/importBackupFromRemote',
    async (event, input: BackupSyncSettings, operationId?: string) => {
      const result = await downloadBackupSyncFromSettings(
        input,
        createBackupImportProgressReporter(event.sender, operationId)
      )
      if (result.imported) applyRestoredSettings()
      return result
    }
  )
  handleDatabaseIpc('settings/exportSql', (_event, options?: BackupExportOptions) =>
    exportDatabaseSqlBackup(options)
  )
  handleDatabaseIpc('settings/importSql', async (event, operationId?: string) => {
    const result = await importDatabaseSqlBackup(
      createBackupImportProgressReporter(event.sender, operationId)
    )
    if (result.imported) applyRestoredSettings()
    return result
  })
}

function applyRestoredSettings(): void {
  const loginSetting = getDatabase()
    .prepare<{
      setting_value: string
    }>("SELECT setting_value FROM onemail_app_settings WHERE setting_key = 'open_at_login'")
    .get()
  if (loginSetting) setOpenAtLogin(loginSetting.setting_value === '1')
  startAutoUpdateChecks(getSettings().updateCheckFrequency)
  restartMailboxWatchers()
}

function createBackupImportProgressReporter(
  webContents: WebContents,
  operationId?: string
): BackupImportProgressReporter | undefined {
  if (!operationId) return undefined

  return (progress): void => {
    webContents.send('settings/backupImportProgress', {
      operationId,
      ...progress
    } satisfies BackupImportProgress)
  }
}
