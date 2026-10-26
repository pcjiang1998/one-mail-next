import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, AppUpdateStatus } from '../../../../shared/types'
import { I18nProvider } from '@renderer/lib/i18n'
import { checkForAppUpdates, downloadAppUpdate, installAppUpdate } from '@renderer/lib/api'
import { SettingsDialog } from './settings-dialog'

vi.mock('@renderer/lib/api', () => ({
  checkForAppUpdates: vi.fn(),
  downloadAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  onBackupImportProgress: vi.fn(() => () => undefined)
}))

const settings: AppSettings = {
  syncIntervalMinutes: 15,
  syncWindowDays: 90,
  syncBodyWindowDays: 7,
  cacheRetentionDays: 0,
  downloadAttachmentsSeparately: false,
  cleanupMetadata: false,
  openAtLogin: false,
  defaultDesktopNotificationsEnabled: true,
  externalImagesBlocked: true,
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

function status(
  state: AppUpdateStatus['state'],
  input: Partial<AppUpdateStatus> = {}
): AppUpdateStatus {
  return {
    state,
    currentVersion: '1.0.0',
    message: '',
    updatedAt: '2026-10-26T14:00:00.000Z',
    ...input
  }
}

function renderAbout(initialStatus: AppUpdateStatus): ReturnType<typeof render> & {
  setStatus: (next: AppUpdateStatus) => void
} {
  const onSubmit = vi.fn(async () => undefined)
  function view(updateStatus: AppUpdateStatus): React.JSX.Element {
    return (
      <I18nProvider>
        <SettingsDialog
          open
          initialSection="about"
          settings={settings}
          systemInfo={{
            platform: 'win32',
            appVersion: '1.0.0',
            databasePath: '',
            userDataPath: ''
          }}
          updateStatus={updateStatus}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          accounts={[]}
          onUpdateAccount={vi.fn()}
          onRefreshAccounts={vi.fn()}
          onRemoveAccounts={vi.fn()}
          onReorderAccounts={vi.fn()}
        />
      </I18nProvider>
    )
  }
  const result = render(view(initialStatus))
  return { ...result, setStatus: (next: AppUpdateStatus) => result.rerender(view(next)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkForAppUpdates).mockResolvedValue({
    status: 'available',
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    message: '发现新版本 v1.1.0。'
  })
  vi.mocked(downloadAppUpdate).mockResolvedValue(true)
  vi.mocked(installAppUpdate).mockResolvedValue(true)
})

describe('About update controls', () => {
  it('checks without downloading and only announces the new version in the status text', async () => {
    const user = userEvent.setup()
    const view = renderAbout(status('idle'))

    await user.click(screen.getByRole('button', { name: '检查更新' }))
    expect(checkForAppUpdates).toHaveBeenCalledTimes(1)
    expect(downloadAppUpdate).not.toHaveBeenCalled()

    view.setStatus(status('available', { latestVersion: '1.1.0' }))
    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 v1.1.0')
    expect(screen.getByRole('button', { name: '下载更新' })).toBeEnabled()
    expect(screen.getByText('v1.0.0').closest('button')).toBeNull()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('starts downloading on demand and displays progress until restart is available', async () => {
    const user = userEvent.setup()
    let finish!: (succeeded: boolean) => void
    vi.mocked(downloadAppUpdate).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        })
    )
    const view = renderAbout(status('available', { latestVersion: '1.1.0' }))

    await user.click(screen.getByRole('button', { name: '下载更新' }))
    expect(downloadAppUpdate).toHaveBeenCalledTimes(1)
    expect(checkForAppUpdates).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '正在下载更新' })).toBeDisabled()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('正在准备下载...')).toBeInTheDocument()

    view.setStatus(
      status('downloading', {
        latestVersion: '1.1.0',
        progress: {
          percent: 42,
          transferredBytes: 42 * 1024 * 1024,
          totalBytes: 100 * 1024 * 1024,
          bytesPerSecond: 2 * 1024 * 1024
        }
      })
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42% · 42.0 MB / 100.0 MB · 2.0 MB/s')).toBeInTheDocument()

    await act(async () => {
      finish(true)
    })
    view.setStatus(status('downloaded', { latestVersion: '1.1.0' }))
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重启更新' }))
    expect(installAppUpdate).toHaveBeenCalledTimes(1)
  })

  it('shows a plain check failure instead of treating a previously seen version as available', () => {
    renderAbout(
      status('error', {
        latestVersion: '1.1.0',
        errorStage: 'check',
        message: 'Cannot find latest.yml in the latest release artifacts'
      })
    )

    expect(screen.getByRole('status')).toHaveTextContent('检查更新失败')
    expect(screen.queryByText(/Cannot find latest/)).not.toBeInTheDocument()
    expect(screen.queryByText('发现新版本 v1.1.0')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '下载更新' })).not.toBeInTheDocument()
  })

  it('shows an IPC check failure in the same small status text without raw errors', async () => {
    const user = userEvent.setup()
    vi.mocked(checkForAppUpdates).mockRejectedValueOnce(new Error('Connection reset'))
    renderAbout(status('idle'))

    await user.click(screen.getByRole('button', { name: '检查更新' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('检查更新失败')
    })
    expect(screen.queryByText(/Connection reset/)).not.toBeInTheDocument()
    expect(downloadAppUpdate).not.toHaveBeenCalled()
  })

  it('allows retrying a failed download without rechecking', async () => {
    const user = userEvent.setup()
    const view = renderAbout(status('available', { latestVersion: '1.1.0' }))
    vi.mocked(downloadAppUpdate).mockResolvedValueOnce(false)

    await user.click(screen.getByRole('button', { name: '下载更新' }))
    view.setStatus(
      status('error', {
        errorStage: 'download',
        latestVersion: '1.1.0',
        message: 'Connection reset'
      })
    )
    expect(screen.getByRole('status')).toHaveTextContent('下载更新失败')
    await user.click(screen.getByRole('button', { name: '下载更新' }))
    expect(downloadAppUpdate).toHaveBeenCalledTimes(2)
    expect(checkForAppUpdates).not.toHaveBeenCalled()
  })

  it('replaces a local check failure when a later background check succeeds', async () => {
    const user = userEvent.setup()
    vi.mocked(checkForAppUpdates).mockRejectedValueOnce(new Error('Connection reset'))
    const view = renderAbout(status('idle'))

    await user.click(screen.getByRole('button', { name: '检查更新' }))
    expect(screen.getByRole('status')).toHaveTextContent('检查更新失败')

    view.setStatus(status('available', { latestVersion: '1.1.0' }))

    expect(screen.getByRole('status')).toHaveTextContent('发现新版本 v1.1.0')
    expect(screen.getByRole('status')).not.toHaveTextContent('检查更新失败')
    expect(screen.getByRole('button', { name: '下载更新' })).toBeEnabled()
  })
})
