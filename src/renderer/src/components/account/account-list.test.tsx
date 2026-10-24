import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@renderer/lib/i18n'
import type { Account } from '@renderer/components/mail/types'
import { AccountList } from './account-list'
import outlookIcon from '../../assets/outlook-icon.ico'

describe('AccountList provider logos', () => {
  function renderAccount(providerKey: string): ReturnType<typeof render> {
    return render(
      <I18nProvider>
        <AccountList
          accounts={[
            {
              id: '1',
              accountId: 1,
              name: 'Mailbox',
              providerKey,
              address: 'test@outlook.com',
              unread: 0,
              status: '',
              accent: ''
            }
          ]}
          selectedAccountId="1"
          syncingAccountIds={new Set()}
          actionsDisabled={false}
          composePending={false}
          onOpenDrafts={vi.fn()}
          onOpenOutbox={vi.fn()}
          onSelectAccount={vi.fn()}
          onCompose={vi.fn()}
          onRefreshAccount={vi.fn()}
          onEditAccount={vi.fn()}
          onDeleteAccount={vi.fn()}
          onResolveAccountWarning={vi.fn()}
        />
      </I18nProvider>
    )
  }

  it.each(['outlook', 'hotmail', 'microsoft'])(
    'uses the bundled Outlook logo for %s without fetching a favicon',
    (providerKey) => {
      const get = vi.fn().mockRejectedValue(new Error('Network unavailable'))
      Object.defineProperty(window, 'api', { configurable: true, value: { logos: { get } } })
      renderAccount(providerKey)
      const image = within(screen.getByRole('button', { name: 'Mailbox' })).getByRole(
        'presentation'
      )
      expect(image).toHaveAttribute('src', outlookIcon)
      expect(get).not.toHaveBeenCalled()
    }
  )

  it('preserves the existing favicon loading for other providers', async () => {
    const src = 'data:image/png;base64,dGVzdA=='
    const get = vi.fn().mockResolvedValue(src)
    Object.defineProperty(window, 'api', { configurable: true, value: { logos: { get } } })
    renderAccount('gmail')
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Mailbox' })).getByRole('presentation')
      ).toHaveAttribute('src', src)
    )
    expect(get).toHaveBeenCalledWith('gmail.com')
  })
})

describe('AccountList unified drafts', () => {
  it('has one selected drafts entry with a total count, independent of account folders', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { logos: { get: vi.fn().mockResolvedValue(null) } }
    })
    const accounts: Account[] = [1, 2].map((id) => ({
      id: String(id),
      accountId: id,
      name: `Account ${id}`,
      address: `sender${id}@example.com`,
      unread: 0,
      status: '',
      accent: ''
    }))
    accounts.unshift({ id: 'all', name: '', address: '', unread: 0, status: '', accent: '' })
    const onOpenDrafts = vi.fn()
    const onSelectAccount = vi.fn()
    const onOpenOutbox = vi.fn()
    const view = render(
      <I18nProvider>
        <AccountList
          accounts={accounts}
          selectedAccountId="1"
          syncingAccountIds={new Set()}
          actionsDisabled={false}
          composePending={false}
          draftsSelected
          draftCount={105}
          onOpenDrafts={onOpenDrafts}
          onSelectAccount={onSelectAccount}
          onCompose={vi.fn()}
          onOpenOutbox={onOpenOutbox}
          onRefreshAccount={vi.fn()}
          onEditAccount={vi.fn()}
          onDeleteAccount={vi.fn()}
          onResolveAccountWarning={vi.fn()}
        />
      </I18nProvider>
    )
    const entry = screen.getByRole('button', { name: /本地草稿箱\s*105/ })
    expect(screen.getAllByText('本地草稿箱')).toHaveLength(1)
    expect(entry).toHaveAttribute('aria-current', 'page')
    const navigation = screen.getAllByRole('button')
    const queueEntry = screen.getByRole('button', { name: '发送队列' })
    const allEntry = screen.getByRole('button', { name: '全部账号' })
    expect(navigation.indexOf(entry)).toBeLessThan(navigation.indexOf(queueEntry))
    expect(navigation.indexOf(queueEntry)).toBeLessThan(navigation.indexOf(allEntry))
    expect(navigation.indexOf(allEntry)).toBeLessThan(
      navigation.indexOf(screen.getByRole('button', { name: 'Account 1' }))
    )
    const user = userEvent.setup()
    await user.click(entry)
    expect(onOpenDrafts).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Account 2' }))
    expect(onSelectAccount).toHaveBeenCalledWith('2')
    await user.click(screen.getByRole('button', { name: '发送队列' }))
    expect(onOpenOutbox).toHaveBeenCalledOnce()
    view.rerender(
      <I18nProvider>
        <AccountList
          accounts={accounts}
          selectedAccountId="1"
          syncingAccountIds={new Set()}
          actionsDisabled={false}
          composePending={false}
          outboxSelected
          onOpenDrafts={onOpenDrafts}
          onOpenOutbox={onOpenOutbox}
          onSelectAccount={onSelectAccount}
          onCompose={vi.fn()}
          onRefreshAccount={vi.fn()}
          onEditAccount={vi.fn()}
          onDeleteAccount={vi.fn()}
          onResolveAccountWarning={vi.fn()}
        />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: '发送队列' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '本地草稿箱' })).not.toHaveAttribute('aria-current')
  })
})
