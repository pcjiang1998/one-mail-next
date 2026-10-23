import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@renderer/lib/i18n'
import type { Account } from '@renderer/components/mail/types'
import { NotificationSettings } from './notification-settings'

const accounts: Account[] = [
  {
    id: '1',
    accountId: 1,
    name: 'Work',
    address: 'work@example.com',
    unread: 0,
    status: 'active',
    accent: '',
    desktopNotificationsEnabled: true
  },
  {
    id: '2',
    accountId: 2,
    name: 'Personal',
    address: 'personal@example.com',
    unread: 0,
    status: 'active',
    accent: '',
    desktopNotificationsEnabled: false
  }
]
const setNotifications = vi.fn()

describe('NotificationSettings', () => {
  beforeEach(() => {
    setNotifications.mockReset().mockResolvedValue([])
    vi.stubGlobal('api', { accounts: { setNotifications } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves an individual switch and all-account actions, then refreshes accounts', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <NotificationSettings accounts={accounts} onRefreshAccounts={refresh} />
      </I18nProvider>
    )
    expect(screen.getByRole('switch', { name: 'work@example.com' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'personal@example.com' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'personal@example.com' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(setNotifications).toHaveBeenLastCalledWith({ accountIds: [2], enabled: true })
    await user.click(screen.getByRole('button', { name: '全部关闭通知' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(setNotifications).toHaveBeenLastCalledWith({ accountIds: [1, 2], enabled: false })
    await user.click(screen.getByRole('button', { name: '全部开启通知' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3))
    expect(setNotifications).toHaveBeenLastCalledWith({ accountIds: [1, 2], enabled: true })
  })

  it('shows save errors and keeps the existing account state', async () => {
    setNotifications.mockRejectedValue(new Error('Database unavailable'))
    const user = userEvent.setup()
    const refresh = vi.fn(async () => undefined)
    render(
      <I18nProvider>
        <NotificationSettings accounts={accounts} onRefreshAccounts={refresh} />
      </I18nProvider>
    )
    await user.click(screen.getByRole('switch', { name: 'work@example.com' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('switch', { name: 'work@example.com' })).toBeChecked()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('disables bulk actions when no accounts exist', () => {
    render(
      <I18nProvider>
        <NotificationSettings accounts={[]} onRefreshAccounts={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: '全部开启通知' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '全部关闭通知' })).toBeDisabled()
  })
})
