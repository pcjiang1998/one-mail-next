import { zodResolver } from '@hookform/resolvers/zod'
import { RefreshCw } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { discoverAccountFolders } from '@renderer/lib/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type {
  AccountMailFolder,
  AccountProxyMode,
  AccountSyncMode,
  AccountUpdateInput,
  AppSettings,
  SignatureMode,
  SmtpSecurity
} from '../../../../shared/types'
import { isValidCustomProxyUrl } from '../../../../shared/proxy-url'
import { AccountFormField } from './account-form-field'

type EditAccountValues = {
  accountLabel?: string
  password?: string
  smtpEnabled: boolean
  desktopNotificationsEnabled: boolean
  smtpHost?: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
  proxyMode: AccountProxyMode
  customProxyUrl?: string
  signatureMode: SignatureMode
  signatureId?: number
  syncMode: AccountSyncMode
  accountSyncIntervalMinutes: number
}

type EditAccountDialogProps = {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AccountUpdateInput) => Promise<void>
  settings: AppSettings | null
}

export function EditAccountDialog({
  account,
  open,
  onOpenChange,
  onSubmit,
  settings
}: EditAccountDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const isCustomAccount = isCustomProvider(account.providerKey)
  const editAccountSchema = React.useMemo(
    () => createEditAccountSchema(t, isCustomAccount),
    [isCustomAccount, t]
  )
  const [pending, setPending] = React.useState(false)
  const [folderPending, setFolderPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [folders, setFolders] = React.useState<AccountMailFolder[] | null>(null)
  const [selectedFolderPaths, setSelectedFolderPaths] = React.useState<Set<string>>(new Set())
  const isOAuthAccount = account.authType === 'oauth2'
  const form = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: getDefaultValues(account)
  })
  const smtpEnabled = useWatch({ control: form.control, name: 'smtpEnabled' })
  const proxyMode = useWatch({ control: form.control, name: 'proxyMode' })
  const signatureMode = useWatch({ control: form.control, name: 'signatureMode' })
  const signatureId = useWatch({ control: form.control, name: 'signatureId' })
  const syncMode = useWatch({ control: form.control, name: 'syncMode' })

  React.useEffect(() => {
    if (!open) return
    form.reset(getDefaultValues(account))
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setFolders(null)
      setSelectedFolderPaths(new Set())
      setError(null)
    })
    return () => {
      cancelled = true
    }
  }, [account, form, open])

  function handleOpenChange(nextOpen: boolean): void {
    if ((pending || folderPending) && !nextOpen) return
    if (!nextOpen) setError(null)
    onOpenChange(nextOpen)
  }

  async function handleDiscoverFolders(): Promise<void> {
    if (!account.accountId) return

    setFolderPending(true)
    setError(null)
    try {
      const discovered = await discoverAccountFolders(account.accountId)
      setFolders(discovered)
      setSelectedFolderPaths(
        new Set(discovered.filter((folder) => folder.selected).map((folder) => folder.path))
      )
    } catch (discoverError) {
      setError(
        discoverError instanceof Error ? discoverError.message : t('account.folders.discoverError')
      )
    } finally {
      setFolderPending(false)
    }
  }

  function handleFolderChecked(folder: AccountMailFolder, checked: boolean): void {
    if (isRequiredFolderRole(folder.role)) return

    setSelectedFolderPaths((current) => {
      const next = new Set(current)
      if (checked) next.add(folder.path)
      else next.delete(folder.path)
      return next
    })
  }

  async function handleSubmit(values: EditAccountValues): Promise<void> {
    if (!account.accountId) return

    setPending(true)
    setError(null)

    const password = optionalText(values.password)
    if (!isOAuthAccount && account.credentialState !== 'stored' && !password) {
      setError(t('account.edit.missingCredentialError'))
      setPending(false)
      return
    }

    try {
      await onSubmit({
        accountId: account.accountId,
        accountLabel: values.accountLabel?.trim() ?? '',
        password: isOAuthAccount ? undefined : password,
        smtpEnabled: isCustomAccount ? values.smtpEnabled : undefined,
        smtpHost: isCustomAccount && values.smtpEnabled ? values.smtpHost?.trim() : undefined,
        smtpPort: isCustomAccount && values.smtpEnabled ? values.smtpPort : undefined,
        smtpSecurity: isCustomAccount && values.smtpEnabled ? values.smtpSecurity : undefined,
        desktopNotificationsEnabled: values.desktopNotificationsEnabled,
        proxyMode: values.proxyMode,
        customProxyUrl: values.proxyMode === 'custom' ? optionalText(values.customProxyUrl) : '',
        signatureMode: values.signatureMode,
        signatureId: values.signatureMode === 'custom' ? values.signatureId : undefined,
        syncMode: values.syncMode,
        accountSyncIntervalMinutes: values.accountSyncIntervalMinutes,
        selectedFolderPaths: folders ? Array.from(selectedFolderPaths) : undefined
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('account.add.saveError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('account.edit.title')}
      description={
        isOAuthAccount
          ? t('account.edit.oauthDescription')
          : account.credentialState === 'stored'
            ? t('account.edit.storedDescription')
            : t('account.edit.missingCredentialDescription')
      }
      contentClassName="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[520px]"
      bodyClassName="min-h-0 overflow-auto pr-1"
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="edit-account-form"
            disabled={pending || folderPending || !account.accountId}
          >
            {pending
              ? isOAuthAccount
                ? t('common.saving')
                : t('common.testing')
              : t('account.edit.saveChanges')}
          </Button>
        </>
      }
    >
      <form
        id="edit-account-form"
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FieldGroup className="gap-2.5">
          <AccountFormField id="edit-account-email" label={t('account.form.email')}>
            <Input id="edit-account-email" type="email" value={account.address} disabled />
          </AccountFormField>
          <AccountFormField
            id="edit-account-label"
            label={t('account.form.label')}
            error={form.formState.errors.accountLabel?.message}
          >
            <Input
              id="edit-account-label"
              placeholder={t('account.form.labelPlaceholder')}
              aria-invalid={Boolean(form.formState.errors.accountLabel)}
              {...form.register('accountLabel')}
            />
          </AccountFormField>
          <AccountFormField
            id="edit-desktop-notifications"
            label={t('account.form.desktopNotifications')}
          >
            <Controller
              control={form.control}
              name="desktopNotificationsEnabled"
              render={({ field }) => (
                <Checkbox
                  id="edit-desktop-notifications"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />
          </AccountFormField>
          {isOAuthAccount ? null : (
            <AccountFormField
              id="edit-account-password"
              label={t('account.form.passwordOrAuthCode')}
              required={account.credentialState !== 'stored'}
              error={form.formState.errors.password?.message}
            >
              <Input
                id="edit-account-password"
                type="password"
                autoComplete="current-password"
                placeholder={
                  account.credentialState === 'stored'
                    ? t('account.edit.keepSavedCredential')
                    : t('account.edit.passwordPlaceholder')
                }
                required={account.credentialState !== 'stored'}
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register('password')}
              />
            </AccountFormField>
          )}
        </FieldGroup>

        <section className="grid gap-2.5 border-t pt-4 sm:grid-cols-2">
          <AccountFormField id="edit-receive-protocol" label={t('account.form.receiveProtocol')}>
            <Input
              id="edit-receive-protocol"
              value={(account.receiveProtocol ?? 'imap').toUpperCase()}
              disabled
            />
          </AccountFormField>
          <AccountFormField
            id="edit-receive-server"
            label={
              account.receiveProtocol === 'pop3'
                ? t('account.form.popSettings')
                : t('account.form.imapSettings')
            }
          >
            <Input id="edit-receive-server" value={formatReceiveServer(account)} disabled />
          </AccountFormField>
        </section>

        {isCustomAccount ? (
          <section className="flex flex-col gap-2.5 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="edit-smtp-enabled" className="text-sm font-medium">
                {t('account.form.smtpEnabled')}
              </label>
              <Controller
                control={form.control}
                name="smtpEnabled"
                render={({ field }) => (
                  <Switch
                    id="edit-smtp-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('account.form.smtpEnabled')}
                  />
                )}
              />
            </div>

            {smtpEnabled ? (
              <>
                <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_112px]">
                  <AccountFormField
                    id="edit-smtp-host"
                    label={t('account.form.smtpHost')}
                    required
                    error={form.formState.errors.smtpHost?.message}
                  >
                    <Input
                      id="edit-smtp-host"
                      placeholder="smtp.example.com"
                      required
                      aria-invalid={Boolean(form.formState.errors.smtpHost)}
                      {...form.register('smtpHost')}
                    />
                  </AccountFormField>
                  <AccountFormField
                    id="edit-smtp-port"
                    label={t('account.form.port')}
                    required
                    error={form.formState.errors.smtpPort?.message}
                  >
                    <Input
                      id="edit-smtp-port"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      aria-invalid={Boolean(form.formState.errors.smtpPort)}
                      {...form.register('smtpPort', { valueAsNumber: true })}
                    />
                  </AccountFormField>
                </div>
                <AccountFormField
                  id="edit-smtp-security"
                  label={t('account.form.security')}
                  required
                  error={form.formState.errors.smtpSecurity?.message}
                >
                  <Controller
                    control={form.control}
                    name="smtpSecurity"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} required>
                        <SelectTrigger id="edit-smtp-security" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="ssl_tls">SSL/TLS</SelectItem>
                            <SelectItem value="starttls">STARTTLS</SelectItem>
                            <SelectItem value="none">{t('account.form.securityNone')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </AccountFormField>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2.5 border-t pt-4">
          <AccountFormField
            id="edit-account-proxy"
            label={t('account.form.proxy')}
            error={form.formState.errors.customProxyUrl?.message}
          >
            <Controller
              control={form.control}
              name="proxyMode"
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {(['global', 'none', 'system', 'custom'] as const).map((mode) => (
                    <label
                      key={mode}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs"
                    >
                      <RadioGroupItem value={mode} />
                      {t(`account.form.proxy.${mode}`)}
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
            {proxyMode === 'custom' ? (
              <Input
                className="mt-2"
                placeholder="http://127.0.0.1:8080"
                {...form.register('customProxyUrl')}
              />
            ) : null}
          </AccountFormField>

          <AccountFormField id="edit-account-signature" label={t('account.form.signature')}>
            <Select
              value={toSignatureSelectValue(signatureMode, signatureId)}
              onValueChange={(value) => {
                if (value === 'global' || value === 'none') {
                  form.setValue('signatureMode', value)
                  form.setValue('signatureId', undefined)
                } else {
                  form.setValue('signatureMode', 'custom')
                  form.setValue('signatureId', Number(value.slice('signature:'.length)))
                }
              }}
            >
              <SelectTrigger id="edit-account-signature" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{t('settings.signature.useGlobal')}</SelectItem>
                <SelectItem value="none">{t('settings.signature.none')}</SelectItem>
                {(settings?.signatures ?? []).map((signature) => (
                  <SelectItem
                    key={signature.signatureId}
                    value={`signature:${signature.signatureId}`}
                  >
                    {signature.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AccountFormField>

          <AccountFormField id="edit-account-sync-mode" label={t('settings.sync.accountMode')}>
            <Select
              value={syncMode}
              onValueChange={(value) => form.setValue('syncMode', value as AccountSyncMode)}
            >
              <SelectTrigger id="edit-account-sync-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="global"
                  disabled={account.receiveProtocol === 'pop3' || account.idleSupported !== true}
                >
                  {t('settings.sync.mode.global')}
                </SelectItem>
                <SelectItem value="fallback">{t('settings.sync.mode.fallback')}</SelectItem>
                <SelectItem
                  value="idle"
                  disabled={account.receiveProtocol === 'pop3' || account.idleSupported !== true}
                >
                  {t('settings.sync.mode.idle')}
                </SelectItem>
                <SelectItem value="interval">{t('settings.sync.mode.interval')}</SelectItem>
                <SelectItem value="manual">{t('settings.sync.mode.manual')}</SelectItem>
              </SelectContent>
            </Select>
            {syncMode === 'interval' ? (
              <Input
                className="mt-2"
                type="number"
                min={1}
                max={1440}
                {...form.register('accountSyncIntervalMinutes', { valueAsNumber: true })}
              />
            ) : null}
          </AccountFormField>
        </section>

        {account.receiveProtocol === 'pop3' ? null : (
          <section className="flex flex-col gap-2.5 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{t('account.folders.title')}</h3>
                <p className="text-xs text-muted-foreground">{t('account.folders.description')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={folderPending || !account.accountId}
                onClick={() => void handleDiscoverFolders()}
              >
                <RefreshCw className={folderPending ? 'animate-spin' : undefined} />
                {folderPending ? t('account.folders.loading') : t('account.folders.refresh')}
              </Button>
            </div>

            {folders ? (
              <div className="max-h-52 overflow-y-auto border-y">
                {folders
                  .filter((folder) => folder.selectable)
                  .map((folder) => {
                    const checked =
                      isRequiredFolderRole(folder.role) || selectedFolderPaths.has(folder.path)
                    return (
                      <label
                        key={folder.path}
                        className="flex min-h-10 items-center gap-3 border-b px-1 py-2 last:border-b-0"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={isRequiredFolderRole(folder.role)}
                          onCheckedChange={(value) => handleFolderChecked(folder, value === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{folder.name}</span>
                          {folder.name === folder.path ? null : (
                            <span className="block truncate text-xs text-muted-foreground">
                              {folder.path}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
              </div>
            ) : null}
          </section>
        )}

        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </ResponsiveDialog>
  )
}

function isRequiredFolderRole(role: AccountMailFolder['role']): boolean {
  return role === 'inbox' || role === 'sent' || role === 'junk'
}

function createEditAccountSchema(
  t: (key: TranslationKey) => string,
  validateSmtp: boolean
): z.ZodType<EditAccountValues, EditAccountValues> {
  return z
    .object({
      accountLabel: z.string().trim().max(80, t('account.form.labelMax')).optional(),
      password: z.string().trim().optional(),
      smtpEnabled: z.boolean(),
      desktopNotificationsEnabled: z.boolean(),
      proxyMode: z.enum(['global', 'none', 'system', 'custom']),
      customProxyUrl: z.string().trim().optional(),
      signatureMode: z.enum(['global', 'none', 'custom']),
      signatureId: z.number().int().positive().optional(),
      syncMode: z.enum(['global', 'fallback', 'idle', 'interval', 'manual']),
      accountSyncIntervalMinutes: z.number().int().min(1).max(1440),
      smtpHost: z.string().trim().optional(),
      smtpPort: z
        .number(t('account.form.portRequired'))
        .int(t('account.form.portInteger'))
        .min(1, t('account.form.portMin'))
        .max(65535, t('account.form.portMax')),
      smtpSecurity: z.enum(['ssl_tls', 'starttls', 'none'])
    })
    .superRefine((values, context) => {
      if (validateSmtp && values.smtpEnabled && !values.smtpHost?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['smtpHost'],
          message: t('account.form.requiredSmtpHost')
        })
      }
      if (values.proxyMode === 'custom' && !isValidCustomProxyUrl(values.customProxyUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['customProxyUrl'],
          message: t('account.form.invalidProxyUrl')
        })
      }
      if (values.signatureMode === 'custom' && !values.signatureId) {
        context.addIssue({
          code: 'custom',
          path: ['signatureId'],
          message: t('account.form.requiredSignature')
        })
      }
    })
}

function getDefaultValues(account: Account): EditAccountValues {
  return {
    accountLabel: getInitialLabel(account),
    password: '',
    smtpEnabled: account.smtpEnabled ?? false,
    desktopNotificationsEnabled: account.desktopNotificationsEnabled ?? true,
    smtpHost: account.smtpHost ?? '',
    smtpPort: account.smtpPort ?? 465,
    smtpSecurity: account.smtpSecurity ?? 'ssl_tls',
    proxyMode: account.proxyMode ?? 'global',
    customProxyUrl: account.customProxyUrl ?? '',
    signatureMode: account.signatureMode ?? 'global',
    signatureId: account.signatureId,
    syncMode: account.syncMode ?? (account.receiveProtocol === 'pop3' ? 'fallback' : 'global'),
    accountSyncIntervalMinutes: account.accountSyncIntervalMinutes ?? 5
  }
}

function formatReceiveServer(account: Account): string {
  if (account.receiveProtocol === 'pop3') {
    return `${account.popHost ?? account.imapHost ?? ''}:${account.popPort ?? 995} (${account.popSecurity ?? 'ssl_tls'})`
  }
  return `${account.imapHost ?? ''}:${account.imapPort ?? 993} (${account.imapSecurity ?? 'ssl_tls'})`
}

function toSignatureSelectValue(mode: string, signatureId?: number): string {
  return mode === 'custom' && signatureId ? `signature:${signatureId}` : mode
}

function getInitialLabel(account: Account): string {
  const suffix = `(${account.address})`
  if (!account.name.endsWith(suffix)) return ''
  return account.name.slice(0, -suffix.length)
}

function isCustomProvider(providerKey?: string): boolean {
  const normalized = providerKey?.trim().toLowerCase() ?? ''
  return normalized.includes('custom') || normalized.includes('manual')
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
