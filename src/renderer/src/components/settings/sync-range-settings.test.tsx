import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { cleanupMailCache } from '@renderer/lib/api'
import { I18nProvider } from '@renderer/lib/i18n'
import { SyncRangeSettings } from './sync-range-settings'

vi.mock('@renderer/lib/api', () => ({
  cleanupMailCache: vi.fn(async () => ({
    days: 60,
    deletedMessages: 0,
    clearedBodies: 1,
    clearedAttachments: 1
  })),
  deleteMailSignature: vi.fn(),
  saveMailSignature: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('SyncRangeSettings', () => {
  it('uses the same padded, centered layout as the adjacent mail sync page', () => {
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={vi.fn(async () => undefined)} />
      </I18nProvider>
    )
    const title = screen.getByRole('heading', { name: '邮件同步范围' })
    expect(title.closest('section')).toHaveClass('mx-auto', 'w-full', 'max-w-2xl', 'p-4', 'gap-5')
    expect(title).toHaveClass('text-sm')
  })

  it('does not clean using stale settings after a failed save, and toggles retry the visible draft', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={onSubmit} />
      </I18nProvider>
    )
    const retention = screen.getByRole('spinbutton', { name: '本地缓存保留天数' })
    fireEvent.change(retention, { target: { value: '60' } })
    fireEvent.blur(retention)
    await waitFor(() => expect(screen.getByRole('button', { name: '清理' })).toBeEnabled())
    onSubmit.mockRejectedValueOnce(new Error('Not saved'))
    fireEvent.change(retention, { target: { value: '45' } })
    fireEvent.blur(retention)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not saved'))
    expect(screen.getByRole('button', { name: '清理' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: '附件单独下载' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cacheRetentionDays: 45,
          downloadAttachmentsSeparately: true
        })
      )
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '清理' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '清理' }))
    await waitFor(() =>
      expect(cleanupMailCache).toHaveBeenLastCalledWith({
        cacheRetentionDays: 45,
        cleanupMetadata: false
      })
    )
  })

  it('locks settings while cleanup is running', async () => {
    let complete!: (result: Awaited<ReturnType<typeof cleanupMailCache>>) => void
    vi.mocked(cleanupMailCache).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={vi.fn(async () => undefined)} />
      </I18nProvider>
    )
    const retention = screen.getByRole('spinbutton', { name: '本地缓存保留天数' })
    fireEvent.change(retention, { target: { value: '60' } })
    fireEvent.blur(retention)
    await waitFor(() => expect(screen.getByRole('button', { name: '清理' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '清理' }))
    expect(retention).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    complete({ days: 60, deletedMessages: 0, clearedBodies: 0, clearedAttachments: 0 })
    await waitFor(() => expect(retention).toBeEnabled())
  })
  it('keeps the most recently validated value even if persistence fails', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('Save failed')
    })
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={onSubmit} />
      </I18nProvider>
    )
    const input = screen.getByRole('spinbutton', { name: '邮件元信息范围（天）' })
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Save failed'))
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(20)
  })
  it('restores the most recent legal value, not the initial value or another field', async () => {
    const onSubmit = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={onSubmit} />
      </I18nProvider>
    )
    const metadata = screen.getByRole('spinbutton', { name: '邮件元信息范围（天）' })
    const body = screen.getByRole('spinbutton', { name: '邮件全文拉取范围（天）' })
    fireEvent.change(metadata, { target: { value: '20' } })
    fireEvent.blur(metadata)
    await waitFor(() => expect(metadata).not.toBeDisabled())
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ syncWindowDays: 20, syncBodyWindowDays: 7, cacheRetentionDays: 0 })
    )
    fireEvent.change(metadata, { target: { value: '5' } })
    fireEvent.blur(metadata)
    expect(metadata).toHaveValue(20)
    expect(body).toHaveValue(7)
    expect(screen.getByRole('alert')).toHaveTextContent('元信息范围必须大于')
    fireEvent.change(body, { target: { value: '21' } })
    fireEvent.blur(body)
    expect(body).toHaveValue(7)
    expect(screen.getByRole('alert')).toHaveTextContent('全文范围必须小于')
  })

  it.each(['', '2.5', '2.0', '-1'])('rejects invalid draft %s without persisting it', (value) => {
    const onSubmit = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={onSubmit} />
      </I18nProvider>
    )
    const input = screen.getByRole('spinbutton', { name: '本地缓存保留天数' })
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    expect(input).toHaveValue(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables cleanup for zero retention and enables it only after valid settings are saved', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <SyncRangeSettings settings={null} onSubmit={onSubmit} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: '清理' })).toBeDisabled()
    const input = screen.getByRole('spinbutton', { name: '本地缓存保留天数' })
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByRole('button', { name: '清理' })).toBeEnabled())
    await user.click(screen.getByRole('switch', { name: '附件单独下载' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ downloadAttachmentsSeparately: true })
      )
    )
    expect(screen.getByText(/POP3 等/)).toBeInTheDocument()
  })
})
