import * as React from 'react'
import type { Account } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/lib/i18n'

export function NotificationSettings({
  accounts,
  onRefreshAccounts
}: {
  accounts: Account[]
  onRefreshAccounts: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const persistedAccounts = accounts.filter((account) => account.accountId !== undefined)

  async function save(accountIds: number[], enabled: boolean): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await window.api.accounts.setNotifications({ accountIds, enabled })
      await onRefreshAccounts()
    } catch (error) {
      setError(error instanceof Error ? error.message : t('settings.notifications.error'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3 sm:p-4" aria-busy={pending}>
      <div>
        <h2 className="text-sm font-semibold">{t('settings.notifications')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('settings.notifications.accountsDescription')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || persistedAccounts.length === 0}
          onClick={() =>
            void save(
              persistedAccounts.map((account) => account.accountId!),
              true
            )
          }
        >
          {t('settings.notifications.enableAll')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || persistedAccounts.length === 0}
          onClick={() =>
            void save(
              persistedAccounts.map((account) => account.accountId!),
              false
            )
          }
        >
          {t('settings.notifications.disableAll')}
        </Button>
      </div>
      <div className="divide-y rounded-md border">
        {persistedAccounts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('settings.notifications.empty')}</p>
        ) : (
          persistedAccounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-4 p-3">
              <label
                htmlFor={`notification-${account.accountId}`}
                className="min-w-0 cursor-pointer"
              >
                <span className="block truncate text-sm font-medium">{account.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {account.address}
                </span>
              </label>
              <Switch
                id={`notification-${account.accountId}`}
                aria-label={account.address}
                checked={account.desktopNotificationsEnabled !== false}
                disabled={pending}
                onCheckedChange={(enabled) => void save([account.accountId!], enabled)}
              />
            </div>
          ))
        )}
      </div>
      {pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('settings.notifications.saving')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
