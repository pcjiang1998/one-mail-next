import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@renderer/lib/i18n'
import { BackupSettings } from './settings-dialog'

describe('BackupSettings', () => {
  it('lets local and remote backups use the same mail selection', async () => {
    const user = userEvent.setup()
    const exportBackup = vi.fn()
    const uploadBackup = vi.fn()
    function Harness(): React.JSX.Element {
      const [includeMail, setIncludeMail] = React.useState(true)
      return (
        <I18nProvider>
          <BackupSettings
            pending={null}
            message={null}
            error={null}
            syncSettings={{ provider: 'webdav', remoteUrl: 'https://example.com/backup.sql' }}
            includeMail={includeMail}
            onIncludeMailChange={setIncludeMail}
            onExport={async () => {
              exportBackup({ includeMail })
            }}
            onUploadSync={async () => {
              uploadBackup({ includeMail })
            }}
            onImport={vi.fn()}
            onSaveSync={vi.fn()}
            onTestSync={vi.fn()}
            onDownloadSync={vi.fn()}
          />
        </I18nProvider>
      )
    }
    render(<Harness />)
    const checkbox = screen.getByRole('checkbox', { name: '是否备份邮件' })
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: /导出 SQL/ }))
    expect(exportBackup).toHaveBeenCalledWith({ includeMail: false })
    await user.click(screen.getByRole('button', { name: /^上传/ }))
    expect(uploadBackup).toHaveBeenCalledWith({ includeMail: false })
  })
})
