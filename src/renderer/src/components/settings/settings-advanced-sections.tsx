import { LoaderCircle, Plus, Save, Trash2 } from 'lucide-react'
import * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import type { Account } from '@renderer/components/mail/types'
import { cleanupMailCache, deleteMailSignature, saveMailSignature } from '@renderer/lib/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type {
  AccountProxyMode,
  AccountSyncMode,
  AccountUpdateInput,
  AppSettings,
  CacheCleanupInput,
  FallbackSyncMode,
  GlobalSyncMode,
  MailSignature,
  ProxyMode,
  SettingsUpdateInput,
  SignatureMode
} from '../../../../shared/types'
import { isValidCustomProxyUrl } from '../../../../shared/proxy-url'

const PROXY_MODES: ProxyMode[] = ['none', 'system', 'custom']
const ACCOUNT_PROXY_MODES: AccountProxyMode[] = ['global', 'none', 'system', 'custom']

type SubmitSettings = (input: SettingsUpdateInput) => Promise<void>
type UpdateAccount = (input: AccountUpdateInput) => Promise<void>

export function CacheCleanupControl({
  disabled,
  settings,
  onPendingChange
}: {
  disabled: boolean
  settings: CacheCleanupInput
  onPendingChange: (pending: boolean) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const cleaning = React.useRef(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function handleCleanup(): Promise<void> {
    if (disabled || cleaning.current) return
    cleaning.current = true
    setPending(true)
    onPendingChange(true)
    setMessage(null)
    setError(null)
    try {
      const result = await cleanupMailCache(settings)
      setMessage(
        t('settings.cache.cleanupResult', {
          count: result.deletedMessages,
          bodies: result.clearedBodies,
          attachments: result.clearedAttachments
        })
      )
    } catch (cleanupError) {
      setError(
        cleanupError instanceof Error ? cleanupError.message : t('settings.cache.cleanupError')
      )
    } finally {
      cleaning.current = false
      setPending(false)
      onPendingChange(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div>
        <h3 className="text-sm font-medium">{t('settings.cache.cleanupTitle')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('settings.cache.cleanupDescription')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || disabled}
          onClick={() => void handleCleanup()}
        >
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Trash2 data-icon="inline-start" />
          )}
          {pending ? t('settings.cache.cleaning') : t('settings.cache.cleanup')}
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

export function SignatureSettings({
  settings,
  accounts,
  onSubmit,
  onUpdateAccount,
  onRefreshAccounts
}: {
  settings: AppSettings | null
  accounts: Account[]
  onSubmit: SubmitSettings
  onUpdateAccount: UpdateAccount
  onRefreshAccounts: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [signatures, setSignatures] = React.useState<MailSignature[]>(settings?.signatures ?? [])
  const [globalSignatureId, setGlobalSignatureId] = React.useState<number | null>(
    settings?.globalSignatureId ?? null
  )
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [title, setTitle] = React.useState('')
  const [content, setContent] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [pendingAccountId, setPendingAccountId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  function selectSignature(value: string): void {
    if (value === 'new') {
      setSelectedId(null)
      setTitle('')
      setContent('')
      setError(null)
      return
    }
    const signature = signatures.find((item) => item.signatureId === Number(value))
    if (!signature) return
    setSelectedId(signature.signatureId)
    setTitle(signature.title)
    setContent(signature.content)
    setError(null)
  }

  async function handleGlobalChange(value: string): Promise<void> {
    const nextId = value === 'none' ? null : Number(value)
    const previous = globalSignatureId
    setGlobalSignatureId(nextId)
    setError(null)
    try {
      await onSubmit({ globalSignatureId: nextId })
    } catch (updateError) {
      setGlobalSignatureId(previous)
      setError(updateError instanceof Error ? updateError.message : t('settings.updateError'))
    }
  }

  async function handleSave(): Promise<void> {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError(t('settings.signature.titleRequired'))
      return
    }
    if (/[<>]/.test(trimmedTitle)) {
      setError(t('settings.signature.titleInvalid'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const saved = await saveMailSignature({
        signatureId: selectedId ?? undefined,
        title: trimmedTitle,
        content
      })
      await onSubmit({})
      setSignatures((current) =>
        [...current.filter((item) => item.signatureId !== saved.signatureId), saved].sort((a, b) =>
          a.title.localeCompare(b.title)
        )
      )
      setSelectedId(saved.signatureId)
      setTitle(saved.title)
      setContent(saved.content)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.signature.saveError'))
    } finally {
      setPending(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedId) return
    setPending(true)
    setError(null)
    try {
      await deleteMailSignature(selectedId)
      setSignatures((current) => current.filter((item) => item.signatureId !== selectedId))
      if (globalSignatureId === selectedId) {
        setGlobalSignatureId(null)
        await onSubmit({ globalSignatureId: null })
      } else {
        await onSubmit({})
      }
      setSelectedId(null)
      setTitle('')
      setContent('')
      await onRefreshAccounts()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t('settings.signature.deleteError')
      )
    } finally {
      setPending(false)
    }
  }

  async function handleAccountSignature(accountId: number, value: string): Promise<void> {
    const [mode, id] = value.split(':') as [SignatureMode, string | undefined]
    setPendingAccountId(accountId)
    setError(null)
    try {
      await onUpdateAccount({
        accountId,
        signatureMode: mode,
        signatureId: mode === 'custom' ? Number(id) : undefined
      })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('settings.updateError'))
    } finally {
      setPendingAccountId(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4">
      <SettingsSectionHeader
        title={t('settings.signature.globalTitle')}
        description={t('settings.signature.globalDescription')}
      />
      <Select
        value={globalSignatureId ? String(globalSignatureId) : 'none'}
        onValueChange={(value) => void handleGlobalChange(value)}
      >
        <SelectTrigger className="w-full max-w-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('settings.signature.none')}</SelectItem>
          {signatures.map((signature) => (
            <SelectItem key={signature.signatureId} value={String(signature.signatureId)}>
              {signature.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t('settings.signature.listTitle')}</h3>
          <Button size="sm" variant="outline" onClick={() => selectSignature('new')}>
            <Plus data-icon="inline-start" />
            {t('settings.signature.new')}
          </Button>
        </div>
        <Select value={selectedId ? String(selectedId) : 'new'} onValueChange={selectSignature}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('settings.signature.select')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">{t('settings.signature.new')}</SelectItem>
            {signatures.map((signature) => (
              <SelectItem key={signature.signatureId} value={String(signature.signatureId)}>
                {signature.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={title}
          maxLength={80}
          placeholder={t('settings.signature.title')}
          aria-label={t('settings.signature.title')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          className="min-h-28 resize-y"
          value={content}
          placeholder={t('settings.signature.content')}
          aria-label={t('settings.signature.content')}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending} onClick={() => void handleSave()}>
            {pending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {t('settings.signature.save')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending || !selectedId}
            onClick={() => void handleDelete()}
          >
            <Trash2 data-icon="inline-start" />
            {t('settings.signature.delete')}
          </Button>
        </div>
      </div>

      <div className="border-t pt-4">
        <SettingsSectionHeader
          title={t('settings.signature.accountsTitle')}
          description={t('settings.signature.accountsDescription')}
        />
        <div className="mt-3 divide-y border-y">
          {accounts.map((account) =>
            account.accountId ? (
              <div key={account.accountId} className="flex min-h-12 items-center gap-3 py-2">
                <AccountName account={account} />
                <Select
                  value={toSignatureValue(account.signatureMode, account.signatureId)}
                  disabled={pendingAccountId === account.accountId}
                  onValueChange={(value) => void handleAccountSignature(account.accountId!, value)}
                >
                  <SelectTrigger className="w-48 max-w-[52%]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">{t('settings.signature.useGlobal')}</SelectItem>
                    <SelectItem value="none">{t('settings.signature.none')}</SelectItem>
                    {signatures.map((signature) => (
                      <SelectItem
                        key={signature.signatureId}
                        value={`custom:${signature.signatureId}`}
                      >
                        {signature.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null
          )}
        </div>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

export function NetworkSettings({
  settings,
  accounts,
  onSubmit,
  onUpdateAccount
}: {
  settings: AppSettings | null
  accounts: Account[]
  onSubmit: SubmitSettings
  onUpdateAccount: UpdateAccount
}): React.JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = React.useState<ProxyMode>(settings?.globalProxyMode ?? 'none')
  const [url, setUrl] = React.useState(settings?.globalProxyUrl ?? '')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function saveGlobal(nextMode: ProxyMode, nextUrl = url): Promise<void> {
    if (nextMode === 'custom' && !isValidCustomProxyUrl(nextUrl)) {
      setError(t('account.form.invalidProxyUrl'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        globalProxyMode: nextMode,
        globalProxyUrl: nextMode === 'custom' ? nextUrl.trim() : ''
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.network.saveError'))
    } finally {
      setPending(false)
    }
  }

  function handleModeChange(value: string): void {
    const nextMode = value as ProxyMode
    setMode(nextMode)
    if (nextMode !== 'custom') void saveGlobal(nextMode, '')
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4">
      <SettingsSectionHeader
        title={t('settings.network.globalTitle')}
        description={t('settings.network.globalDescription')}
      />
      <ProxyRadioGroup
        mode={mode}
        includeGlobal={false}
        disabled={pending}
        onChange={handleModeChange}
      />
      {mode === 'custom' ? (
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-56 flex-1"
            value={url}
            placeholder={t('settings.network.proxyUrlPlaceholder')}
            aria-label={t('settings.network.proxyUrl')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button size="sm" disabled={pending} onClick={() => void saveGlobal('custom')}>
            <Save data-icon="inline-start" />
            {t('common.save')}
          </Button>
        </div>
      ) : null}

      <div className="border-t pt-4">
        <SettingsSectionHeader
          title={t('settings.network.accountsTitle')}
          description={t('settings.network.accountsDescription')}
        />
        <div className="mt-3 divide-y border-y">
          {accounts.map((account) =>
            account.accountId ? (
              <AccountProxyRow
                key={account.accountId}
                account={account}
                onUpdateAccount={onUpdateAccount}
              />
            ) : null
          )}
        </div>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function AccountProxyRow({
  account,
  onUpdateAccount
}: {
  account: Account
  onUpdateAccount: UpdateAccount
}): React.JSX.Element {
  const { t } = useI18n()
  const [mode, setMode] = React.useState<AccountProxyMode>(account.proxyMode ?? 'global')
  const [url, setUrl] = React.useState(account.customProxyUrl ?? '')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(nextMode: AccountProxyMode, nextUrl = url): Promise<void> {
    if (!account.accountId) return
    if (nextMode === 'custom' && !isValidCustomProxyUrl(nextUrl)) {
      setError(t('account.form.invalidProxyUrl'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onUpdateAccount({
        accountId: account.accountId,
        proxyMode: nextMode,
        customProxyUrl: nextMode === 'custom' ? nextUrl.trim() : ''
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.network.saveError'))
    } finally {
      setPending(false)
    }
  }

  function handleModeChange(value: string): void {
    const nextMode = value as AccountProxyMode
    setMode(nextMode)
    if (nextMode !== 'custom') void save(nextMode, '')
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      <AccountName account={account} />
      <ProxyRadioGroup mode={mode} includeGlobal disabled={pending} onChange={handleModeChange} />
      {mode === 'custom' ? (
        <div className="flex flex-wrap gap-2">
          <Input
            className="min-w-56 flex-1"
            value={url}
            placeholder={t('settings.network.proxyUrlPlaceholder')}
            aria-label={t('settings.network.proxyUrl')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button size="sm" disabled={pending} onClick={() => void save('custom')}>
            <Save data-icon="inline-start" />
            {t('common.save')}
          </Button>
        </div>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function ProxyRadioGroup({
  mode,
  includeGlobal,
  disabled,
  onChange
}: {
  mode: AccountProxyMode
  includeGlobal: boolean
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const modes = includeGlobal ? ACCOUNT_PROXY_MODES : PROXY_MODES
  return (
    <RadioGroup
      className="grid gap-2 sm:grid-cols-2"
      value={mode}
      disabled={disabled}
      onValueChange={onChange}
    >
      {modes.map((item) => (
        <label key={item} className="flex min-h-9 items-center gap-2 text-sm">
          <RadioGroupItem value={item} />
          {t(`account.form.proxy.${item}` as TranslationKey)}
        </label>
      ))}
    </RadioGroup>
  )
}

export function SyncSettings({
  settings,
  accounts,
  onSubmit,
  onUpdateAccount
}: {
  settings: AppSettings | null
  accounts: Account[]
  onSubmit: SubmitSettings
  onUpdateAccount: UpdateAccount
}): React.JSX.Element {
  const { t } = useI18n()
  const [globalMode, setGlobalMode] = React.useState<GlobalSyncMode>(
    settings?.globalSyncMode ?? 'idle'
  )
  const [globalInterval, setGlobalInterval] = React.useState(
    settings?.globalSyncIntervalMinutes ?? 5
  )
  const [fallbackMode, setFallbackMode] = React.useState<FallbackSyncMode>(
    settings?.fallbackSyncMode ?? 'interval'
  )
  const [fallbackInterval, setFallbackInterval] = React.useState(
    settings?.fallbackSyncIntervalMinutes ?? 5
  )
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function saveGlobal(mode: GlobalSyncMode, interval = globalInterval): Promise<void> {
    if (mode === 'interval' && !isValidInterval(interval)) {
      setError(t('settings.sync.intervalRange'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({ globalSyncMode: mode, globalSyncIntervalMinutes: interval })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.sync.saveError'))
    } finally {
      setPending(false)
    }
  }

  async function saveFallback(mode: FallbackSyncMode, interval = fallbackInterval): Promise<void> {
    if (mode === 'interval' && !isValidInterval(interval)) {
      setError(t('settings.sync.intervalRange'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({ fallbackSyncMode: mode, fallbackSyncIntervalMinutes: interval })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.sync.saveError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4">
      <SettingsSectionHeader
        title={t('settings.sync.globalTitle')}
        description={t('settings.sync.globalDescription')}
      />
      <SyncModeControl
        value={globalMode}
        modes={['idle', 'interval', 'manual']}
        disabled={pending}
        onChange={(value) => {
          const mode = value as GlobalSyncMode
          setGlobalMode(mode)
          void saveGlobal(mode)
        }}
      />
      {globalMode === 'interval' ? (
        <IntervalControl
          value={globalInterval}
          pending={pending}
          onChange={setGlobalInterval}
          onSave={() => void saveGlobal('interval')}
        />
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-4">
        <SettingsSectionHeader
          title={t('settings.sync.fallbackTitle')}
          description={t('settings.sync.fallbackDescription')}
        />
        <SyncModeControl
          value={fallbackMode}
          modes={['interval', 'manual']}
          disabled={pending}
          onChange={(value) => {
            const mode = value as FallbackSyncMode
            setFallbackMode(mode)
            void saveFallback(mode)
          }}
        />
        {fallbackMode === 'interval' ? (
          <IntervalControl
            value={fallbackInterval}
            pending={pending}
            onChange={setFallbackInterval}
            onSave={() => void saveFallback('interval')}
          />
        ) : null}
      </div>

      <div className="border-t pt-4">
        <SettingsSectionHeader
          title={t('settings.sync.accountsTitle')}
          description={t('settings.sync.accountsDescription')}
        />
        <div className="mt-3 divide-y border-y">
          {accounts.map((account) =>
            account.accountId ? (
              <AccountSyncRow
                key={account.accountId}
                account={account}
                onUpdateAccount={onUpdateAccount}
              />
            ) : null
          )}
        </div>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function AccountSyncRow({
  account,
  onUpdateAccount
}: {
  account: Account
  onUpdateAccount: UpdateAccount
}): React.JSX.Element {
  const { t } = useI18n()
  const idleEligible = account.receiveProtocol === 'imap' && account.idleSupported === true
  const initialMode = normalizeAccountSyncMode(account.syncMode, idleEligible)
  const [mode, setMode] = React.useState<AccountSyncMode>(initialMode)
  const [interval, setInterval] = React.useState(account.accountSyncIntervalMinutes ?? 5)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(nextMode: AccountSyncMode, nextInterval = interval): Promise<void> {
    if (!account.accountId) return
    if (nextMode === 'interval' && !isValidInterval(nextInterval)) {
      setError(t('settings.sync.intervalRange'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await onUpdateAccount({
        accountId: account.accountId,
        syncMode: nextMode,
        accountSyncIntervalMinutes: nextInterval
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('settings.sync.saveError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <AccountName account={account} />
        <Select
          value={mode}
          disabled={pending}
          onValueChange={(value) => {
            const nextMode = value as AccountSyncMode
            setMode(nextMode)
            if (nextMode !== 'interval') void save(nextMode)
          }}
        >
          <SelectTrigger className="w-48 max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global" disabled={!idleEligible}>
              {t('settings.sync.mode.global')}
            </SelectItem>
            <SelectItem value="fallback">{t('settings.sync.mode.fallback')}</SelectItem>
            <SelectItem value="idle" disabled={!idleEligible}>
              {t('settings.sync.mode.idle')}
            </SelectItem>
            <SelectItem value="interval">{t('settings.sync.mode.interval')}</SelectItem>
            <SelectItem value="manual">{t('settings.sync.mode.manual')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!idleEligible ? (
        <p className="text-xs text-muted-foreground">
          {account.receiveProtocol === 'pop3'
            ? t('settings.sync.popFallback')
            : t('settings.sync.idleUnavailable')}
        </p>
      ) : null}
      {mode === 'interval' ? (
        <IntervalControl
          value={interval}
          pending={pending}
          onChange={setInterval}
          onSave={() => void save('interval')}
        />
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function SyncModeControl({
  value,
  modes,
  disabled,
  onChange
}: {
  value: string
  modes: Array<GlobalSyncMode | FallbackSyncMode>
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <RadioGroup
      className="grid gap-2 sm:grid-cols-3"
      value={value}
      disabled={disabled}
      onValueChange={onChange}
    >
      {modes.map((mode) => (
        <label key={mode} className="flex min-h-9 items-center gap-2 text-sm">
          <RadioGroupItem value={mode} />
          {t(`settings.sync.mode.${mode}` as TranslationKey)}
        </label>
      ))}
    </RadioGroup>
  )
}

function IntervalControl({
  value,
  pending,
  onChange,
  onSave
}: {
  value: number
  pending: boolean
  onChange: (value: number) => void
  onSave: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-36"
        type="number"
        min={1}
        max={1440}
        value={value}
        aria-label={t('settings.sync.intervalMinutes')}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={onSave}>
        <Save data-icon="inline-start" />
        {t('common.save')}
      </Button>
    </div>
  )
}

function SettingsSectionHeader({
  title,
  description
}: {
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function AccountName({ account }: { account: Account }): React.JSX.Element {
  return (
    <span className="min-w-0 flex-1 truncate text-sm" title={account.address}>
      {account.name || account.address}
    </span>
  )
}

function toSignatureValue(mode?: SignatureMode, signatureId?: number): string {
  return mode === 'custom' && signatureId ? `custom:${signatureId}` : (mode ?? 'global')
}

function normalizeAccountSyncMode(
  mode: AccountSyncMode | undefined,
  idleEligible: boolean
): AccountSyncMode {
  const value = mode ?? (idleEligible ? 'global' : 'fallback')
  return !idleEligible && (value === 'global' || value === 'idle') ? 'fallback' : value
}

function isValidInterval(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 1440
}
