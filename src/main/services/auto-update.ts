import { spawnSync } from 'node:child_process'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater, { type AppUpdater, type ProgressInfo } from 'electron-updater'
import { isBoringSslBadDecryptError } from '../runtime-errors'
import type {
  AppUpdateCheckResult,
  AppUpdateStatus,
  UpdateCheckFrequency
} from '../../shared/types'

const UPDATE_CHECK_INTERVAL_MS: Record<Exclude<UpdateCheckFrequency, 'manual'>, number> = {
  daily: 1000 * 60 * 60 * 24,
  weekly: 1000 * 60 * 60 * 24 * 7
}
const PACKAGED_APP_UPDATE_UNSUPPORTED_MESSAGE =
  '当前运行环境暂不支持自动检查更新，请使用已打包的正式版本。'
const MAC_CODE_SIGN_UPDATE_UNSUPPORTED_MESSAGE =
  '当前 macOS 应用未使用 Developer ID Application 正式签名，无法通过自动更新的代码签名校验。请先下载安装正式签名版本后再检查更新。'

let updateCheckTimer: NodeJS.Timeout | undefined
let autoUpdaterErrorHandlerInstalled = false
let macAutoUpdateSigningSupported: boolean | undefined
let lastUpdateStatus: AppUpdateStatus | null = null

function getAutoUpdater(): AppUpdater | null {
  try {
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = false
    return autoUpdater
  } catch (error) {
    logUpdateError(error)
    return null
  }
}

export function startAutoUpdateChecks(frequency: UpdateCheckFrequency): void {
  stopAutoUpdateChecks()
  if (frequency === 'manual') return

  const checkForUpdates = (): void => {
    void checkForAppUpdates()
  }

  checkForUpdates()
  updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS[frequency])
}

export function stopAutoUpdateChecks(): void {
  if (!updateCheckTimer) {
    return
  }

  clearInterval(updateCheckTimer)
  updateCheckTimer = undefined
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion()
  const currentStatus = getAppUpdateStatus()
  if (
    currentStatus.state === 'downloading' ||
    currentStatus.state === 'downloaded' ||
    currentStatus.state === 'installing'
  ) {
    return {
      status: 'available',
      currentVersion,
      latestVersion: currentStatus.latestVersion,
      message: currentStatus.message
    }
  }

  const unsupportedMessage = getUpdateUnsupportedMessage()

  if (unsupportedMessage) {
    const status = updateStatus('unsupported', {
      message: unsupportedMessage
    })
    return {
      status: 'unsupported',
      currentVersion,
      message: status.message
    }
  }

  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) {
    const status = getAppUpdateStatus()
    return {
      status: 'error',
      currentVersion,
      message: status.message
    }
  }
  installAutoUpdaterErrorHandler(autoUpdater)

  updateStatus('checking', { message: '正在检查更新。' })
  try {
    const result = await autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo.version

    if (!result?.isUpdateAvailable || !latestVersion || latestVersion === currentVersion) {
      const status = updateStatus('not_available', {
        latestVersion,
        message: '当前已是最新版本。'
      })
      return {
        status: 'not_available',
        currentVersion,
        latestVersion,
        message: status.message
      }
    }

    const status = updateStatus('available', {
      latestVersion,
      message: `发现新版本 v${latestVersion}。`
    })
    return {
      status: 'available',
      currentVersion,
      latestVersion,
      message: status.message
    }
  } catch (error) {
    logUpdateError(error)
    return {
      status: 'error',
      currentVersion,
      message: getUpdateErrorMessage(error)
    }
  }
}

export async function downloadAppUpdate(): Promise<boolean> {
  const status = getAppUpdateStatus()
  if (status.state === 'downloading' || status.state === 'downloaded') return true
  if (
    status.state !== 'available' &&
    status.state !== 'cancelled' &&
    !(status.state === 'error' && status.errorStage === 'download')
  ) {
    return false
  }

  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) return false
  installAutoUpdaterErrorHandler(autoUpdater)

  updateStatus('downloading', {
    latestVersion: status.latestVersion,
    message: `正在下载 v${status.latestVersion}。`,
    progress: { percent: 0, transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0 }
  })
  try {
    await autoUpdater.downloadUpdate()
    return true
  } catch (error) {
    logUpdateError(error, 'download')
    return false
  }
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return lastUpdateStatus ?? createUpdateStatus('idle', { message: '尚未检查更新。' })
}

export function installDownloadedAppUpdate(): boolean {
  const status = getAppUpdateStatus()
  if (status.state !== 'downloaded') {
    return false
  }

  updateStatus('installing', {
    latestVersion: status.latestVersion,
    message: '正在重启并安装更新。',
    progress: status.progress
  })

  const autoUpdater = getAutoUpdater()
  if (!autoUpdater) return false
  autoUpdater.quitAndInstall()
  return true
}

function getUpdateUnsupportedMessage(): string | null {
  if (!app.isPackaged || is.dev) {
    return PACKAGED_APP_UPDATE_UNSUPPORTED_MESSAGE
  }

  if (process.platform === 'darwin' && !isMacAppSignedForAutoUpdate()) {
    return MAC_CODE_SIGN_UPDATE_UNSUPPORTED_MESSAGE
  }

  return null
}

function isMacAppSignedForAutoUpdate(): boolean {
  if (macAutoUpdateSigningSupported !== undefined) {
    return macAutoUpdateSigningSupported
  }

  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], {
    encoding: 'utf8'
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim()
  const signature = output.match(/^Signature=(.+)$/m)?.[1]?.trim()
  const authorities =
    output.match(/^Authority=(.+)$/gm)?.map((line) => line.replace(/^Authority=/, '').trim()) ?? []

  macAutoUpdateSigningSupported =
    result.status === 0 &&
    Boolean(teamIdentifier) &&
    teamIdentifier !== 'not set' &&
    signature !== 'adhoc' &&
    authorities.some((authority) => authority.startsWith('Developer ID Application:'))

  if (!macAutoUpdateSigningSupported) {
    console.warn('Skipped macOS auto update check because the app is not Developer ID signed.', {
      signature,
      teamIdentifier,
      authorities,
      codeSigningError: result.error?.message
    })
  }

  return macAutoUpdateSigningSupported
}

function installAutoUpdaterErrorHandler(autoUpdater: AppUpdater): void {
  if (autoUpdaterErrorHandlerInstalled) return
  autoUpdaterErrorHandlerInstalled = true

  autoUpdater.on('error', (error) => {
    const status = getAppUpdateStatus()
    const stage =
      status.state === 'downloading'
        ? 'download'
        : status.state === 'installing'
          ? 'install'
          : status.errorStage
    logUpdateError(error, stage)
  })
  autoUpdater.on('checking-for-update', () => {
    updateStatus('checking', { message: '正在检查更新。' })
  })
  autoUpdater.on('update-available', (info) => {
    updateStatus('available', {
      latestVersion: info.version,
      message: `发现新版本 v${info.version}。`
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    const latestVersion = lastUpdateStatus?.latestVersion
    updateStatus('downloading', {
      latestVersion,
      message: latestVersion ? `正在下载 v${latestVersion}。` : '正在下载更新。',
      progress: toAppUpdateProgress(progress)
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateStatus('downloaded', {
      latestVersion: info.version,
      message: `新版本 v${info.version} 已下载，重启应用后安装。`,
      progress: toDownloadedProgress()
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    updateStatus('not_available', {
      latestVersion: info.version,
      message: '当前已是最新版本。'
    })
  })
  autoUpdater.on('update-cancelled', (info) => {
    updateStatus('cancelled', {
      latestVersion: info.version,
      message: '更新下载已取消。'
    })
  })
}

function logUpdateError(error: unknown, errorStage: AppUpdateStatus['errorStage'] = 'check'): void {
  updateStatus('error', {
    message: getUpdateErrorMessage(error),
    errorStage
  })
  if (isBoringSslBadDecryptError(error)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT while checking for updates.')
    return
  }

  console.error('Failed to check for updates', error)
}

function getUpdateErrorMessage(error: unknown): string {
  if (isCodeSignatureValidationError(error)) {
    return '下载的更新包未通过 macOS 代码签名校验。请手动下载安装正式签名版本，后续再使用自动更新。'
  }

  return error instanceof Error ? error.message : '检查更新失败。'
}

function isCodeSignatureValidationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Code signature') && message.includes('did not pass validation')
}

function updateStatus(
  state: AppUpdateStatus['state'],
  input: Partial<Omit<AppUpdateStatus, 'state' | 'currentVersion' | 'updatedAt'>>
): AppUpdateStatus {
  const status = createUpdateStatus(state, input)
  lastUpdateStatus = status
  broadcastUpdateStatus(status)
  return status
}

function createUpdateStatus(
  state: AppUpdateStatus['state'],
  input: Partial<Omit<AppUpdateStatus, 'state' | 'currentVersion' | 'updatedAt'>>
): AppUpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    latestVersion: input.latestVersion ?? lastUpdateStatus?.latestVersion,
    releaseUrl: input.releaseUrl ?? lastUpdateStatus?.releaseUrl,
    message: input.message ?? lastUpdateStatus?.message ?? '',
    progress: input.progress,
    errorStage: input.errorStage,
    updatedAt: new Date().toISOString()
  }
}

function broadcastUpdateStatus(status: AppUpdateStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updates/status', status)
    }
  }
}

function toAppUpdateProgress(progress: ProgressInfo): AppUpdateStatus['progress'] {
  return {
    percent: clampPercent(progress.percent),
    transferredBytes: progress.transferred,
    totalBytes: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  }
}

function toDownloadedProgress(): AppUpdateStatus['progress'] {
  const progress = lastUpdateStatus?.progress
  if (!progress) return undefined

  return {
    ...progress,
    percent: 100,
    transferredBytes: progress.totalBytes || progress.transferredBytes
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}
