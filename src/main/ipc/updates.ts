import { handleDatabaseIpc } from './database-handler'
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getAppUpdateStatus,
  installDownloadedAppUpdate
} from '../services/auto-update'
import type { AppUpdateCheckResult, AppUpdateStatus } from './types'

export function registerUpdateIpc(): void {
  handleDatabaseIpc('updates/check', async (): Promise<AppUpdateCheckResult> => {
    return checkForAppUpdates()
  })
  handleDatabaseIpc('updates/download', (): Promise<boolean> => {
    return downloadAppUpdate()
  })
  handleDatabaseIpc('updates/status', (): AppUpdateStatus => {
    return getAppUpdateStatus()
  })
  handleDatabaseIpc('updates/install', (): boolean => {
    return installDownloadedAppUpdate()
  })
}
