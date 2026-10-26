import { ipcMain, type WebContents } from 'electron'
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
import { refreshMailboxWatchers } from '../services/mailbox-watch'
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
  ipcMain.handle('settings/get', () => getSettings())
  ipcMain.handle('settings/update', (_event, input: SettingsUpdateInput) => {
    const previousFrequency = getSettings().updateCheckFrequency
    const settings = updateSettings(input)
    refreshMailboxWatchers()
    if (settings.updateCheckFrequency !== previousFrequency) {
      startAutoUpdateChecks(settings.updateCheckFrequency)
    }
    return settings
  })
  ipcMain.handle('settings/saveSignature', (_event, input: MailSignatureInput) =>
    saveSignature(input)
  )
  ipcMain.handle('settings/deleteSignature', (_event, signatureId: number) =>
    deleteSignature(signatureId)
  )
  ipcMain.handle('settings/cleanupCache', (_event, input: unknown) => {
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
  ipcMain.handle('settings/getBackupSync', () => getBackupSyncSettings())
  ipcMain.handle('settings/updateBackupSync', (_event, input: BackupSyncSettings) =>
    updateBackupSyncSettings(input)
  )
  ipcMain.handle('settings/testBackupSync', (_event, input: BackupSyncSettings) =>
    testBackupSync(input)
  )
  ipcMain.handle('settings/uploadBackupSync', (_event, options?: BackupExportOptions) =>
    uploadBackupSync(options)
  )
  ipcMain.handle('settings/downloadBackupSync', async (event, operationId?: string) => {
    const result = await downloadBackupSync(
      createBackupImportProgressReporter(event.sender, operationId)
    )
    if (result.imported) applyRestoredSettings()
    return result
  })
  ipcMain.handle(
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
  ipcMain.handle('settings/exportSql', (_event, options?: BackupExportOptions) =>
    exportDatabaseSqlBackup(options)
  )
  ipcMain.handle('settings/importSql', async (event, operationId?: string) => {
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
  refreshMailboxWatchers()
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
