import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/api', () => ({
  cleanupMailCache: vi.fn(),
  deleteMailSignature: vi.fn(),
  saveMailSignature: vi.fn()
}))

import { I18nProvider } from '@renderer/lib/i18n'
import { saveMailSignature } from '@renderer/lib/api'
import type { AppSettings } from '../../../../shared/types'
import { SignatureSettings } from './settings-advanced-sections'

const settings: AppSettings = {
  syncIntervalMinutes: 15,
  syncWindowDays: 90,
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

describe('SignatureSettings', () => {
  beforeEach(() => {
    vi.mocked(saveMailSignature).mockResolvedValue({
      signatureId: 1,
      title: 'Work',
      content: 'Regards',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z'
    })
  })

  it('refreshes parent settings after saving a signature', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)

    render(
      <I18nProvider>
        <SignatureSettings
          settings={settings}
          accounts={[]}
          onSubmit={onSubmit}
          onUpdateAccount={vi.fn(async () => undefined)}
          onRefreshAccounts={vi.fn(async () => undefined)}
        />
      </I18nProvider>
    )

    await user.type(screen.getByRole('textbox', { name: '签名标题' }), 'Work')
    await user.type(screen.getByRole('textbox', { name: '签名内容' }), 'Regards')
    await user.click(screen.getByRole('button', { name: '保存签名' }))

    await waitFor(() => {
      expect(saveMailSignature).toHaveBeenCalledWith({
        signatureId: undefined,
        title: 'Work',
        content: 'Regards'
      })
      expect(onSubmit).toHaveBeenCalledWith({})
    })
  })
})
