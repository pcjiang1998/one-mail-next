import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updater: {
    autoDownload: true,
    checkForUpdates: vi.fn<
      () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null>
    >(async () => null),
    downloadUpdate: vi.fn(async () => [] as string[]),
    on: vi.fn(),
    quitAndInstall: vi.fn()
  },
  listeners: new Map<string, (value: unknown) => void>(),
  autoUpdaterError: undefined as Error | undefined
}))

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    isPackaged: true
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('electron-updater', () => ({
  default: {
    get autoUpdater() {
      if (mocks.autoUpdaterError) throw mocks.autoUpdaterError
      return mocks.updater
    }
  }
}))

const DAY_MS = 1000 * 60 * 60 * 24
const availableUpdate = { isUpdateAvailable: true, updateInfo: { version: '1.1.0' } }
let service: typeof import('./auto-update')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.updater.autoDownload = true
  mocks.updater.checkForUpdates.mockResolvedValue(null)
  mocks.updater.downloadUpdate.mockResolvedValue([])
  mocks.listeners.clear()
  mocks.updater.on.mockImplementation((event: string, listener: (value: unknown) => void) => {
    mocks.listeners.set(event, listener)
    return mocks.updater
  })
  mocks.autoUpdaterError = undefined
  service = await import('./auto-update')
})

afterEach(() => {
  service.stopAutoUpdateChecks()
  vi.useRealTimers()
})

function emit(event: string, value: unknown): void {
  mocks.listeners.get(event)!(value)
}

describe('automatic update scheduling', () => {
  it('does not perform background checks in manual mode', async () => {
    service.startAutoUpdateChecks('manual')
    await vi.advanceTimersByTimeAsync(DAY_MS * 8)

    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('keeps the app running when the auto-updater rejects the app version', async () => {
    mocks.autoUpdaterError = new Error('App version is not a valid semver version')

    expect(() => service.startAutoUpdateChecks('daily')).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.getAppUpdateStatus()).toMatchObject({ state: 'error', errorStage: 'check' })
  })

  it('checks immediately and then once per day in daily mode', async () => {
    service.startAutoUpdateChecks('daily')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DAY_MS)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('uses a seven-day interval in weekly mode', async () => {
    service.startAutoUpdateChecks('weekly')
    await vi.advanceTimersByTimeAsync(DAY_MS)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DAY_MS * 6)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('only checks in the background without downloading an available update', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)

    service.startAutoUpdateChecks('daily')
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.updater.autoDownload).toBe(false)
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(service.getAppUpdateStatus()).toMatchObject({
      state: 'available',
      latestVersion: '1.1.0'
    })
  })
})

describe('manual update checks and downloads', () => {
  it('announces a successfully checked version without starting a download', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)

    const result = await service.checkForAppUpdates()

    expect(result).toMatchObject({ status: 'available', latestVersion: '1.1.0' })
    expect(mocks.updater.autoDownload).toBe(false)
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(service.getAppUpdateStatus()).toMatchObject({
      state: 'available',
      message: '发现新版本 v1.1.0。'
    })
  })

  it('records that the installed version is already current', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.0' }
    })

    expect(await service.checkForAppUpdates()).toMatchObject({ status: 'not_available' })
    expect(service.getAppUpdateStatus().state).toBe('not_available')
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('keeps a failed updater check in the error state', async () => {
    mocks.updater.checkForUpdates.mockResolvedValueOnce(availableUpdate)
    await service.checkForAppUpdates()
    mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error('latest.yml returned 404'))

    expect(await service.checkForAppUpdates()).toMatchObject({
      status: 'error',
      message: 'latest.yml returned 404'
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getAppUpdateStatus()).toMatchObject({
      state: 'error',
      errorStage: 'check'
    })
    expect(await service.downloadAppUpdate()).toBe(false)
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('requires a successful check before accepting a download', async () => {
    expect(await service.downloadAppUpdate()).toBe(false)
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('starts an explicit download and publishes progress and completion', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)
    await service.checkForAppUpdates()
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
      expect(service.getAppUpdateStatus()).toMatchObject({
        state: 'downloading',
        progress: { percent: 0 }
      })
      emit('download-progress', {
        percent: 42,
        transferred: 42,
        total: 100,
        bytesPerSecond: 10
      })
      expect(service.getAppUpdateStatus()).toMatchObject({
        state: 'downloading',
        progress: {
          percent: 42,
          transferredBytes: 42,
          totalBytes: 100,
          bytesPerSecond: 10
        }
      })
      emit('update-downloaded', { version: '1.1.0' })
      return ['installer.exe']
    })

    expect(await service.downloadAppUpdate()).toBe(true)
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(service.getAppUpdateStatus()).toMatchObject({
      state: 'downloaded',
      progress: { percent: 100, transferredBytes: 100 }
    })
  })

  it('does not start duplicate downloads or recheck during a download', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)
    await service.checkForAppUpdates()
    let finish!: (paths: string[]) => void
    mocks.updater.downloadUpdate.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve
        })
    )

    const firstDownload = service.downloadAppUpdate()
    expect(await service.downloadAppUpdate()).toBe(true)
    await service.checkForAppUpdates()
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getAppUpdateStatus().state).toBe('downloading')
    emit('update-downloaded', { version: '1.1.0' })
    finish(['installer.exe'])
    await firstDownload
  })

  it('keeps a completed download available for installation across scheduled checks', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)
    await service.checkForAppUpdates()
    emit('update-downloaded', { version: '1.1.0' })

    service.startAutoUpdateChecks('daily')
    await vi.advanceTimersByTimeAsync(DAY_MS)
    await service.downloadAppUpdate()

    expect(service.getAppUpdateStatus().state).toBe('downloaded')
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
    expect(service.installDownloadedAppUpdate()).toBe(true)
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('reports download failures separately and allows a download retry', async () => {
    mocks.updater.checkForUpdates.mockResolvedValue(availableUpdate)
    await service.checkForAppUpdates()
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
      emit('error', new Error('Connection reset'))
      throw new Error('Connection reset')
    })

    expect(await service.downloadAppUpdate()).toBe(false)
    expect(service.getAppUpdateStatus()).toMatchObject({
      state: 'error',
      errorStage: 'download',
      latestVersion: '1.1.0'
    })
    mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
      emit('update-downloaded', { version: '1.1.0' })
      return ['installer.exe']
    })
    expect(await service.downloadAppUpdate()).toBe(true)
    expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(service.getAppUpdateStatus().state).toBe('downloaded')
  })
})
