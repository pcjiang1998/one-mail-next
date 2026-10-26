import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowLeft,
  Bell,
  ListFilter,
  BadgeInfo,
  CalendarRange,
  Clock3,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileUp,
  FolderOpen,
  KeyRound,
  Languages,
  LoaderCircle,
  Mails,
  Network,
  Palette,
  Power,
  RefreshCcw,
  Save,
  ShieldCheck,
  Signature,
  Upload
} from 'lucide-react'
import * as React from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import {
  exportSqlBackup,
  checkForAppUpdates,
  downloadAppUpdate,
  installAppUpdate,
  loadBackupSyncSettings,
  openExternalUrl,
  revealDatabaseInFileManager,
  revealPathInFileManager,
  saveBackupSyncSettings,
  testBackupSyncSettings,
  uploadBackupSync
} from '@renderer/lib/api'
import {
  BackupImportDialog,
  type BackupImportDialogSource
} from '@renderer/components/backup/backup-import-dialog'
import { getBackupSyncSettingsKey } from '@renderer/components/backup/backup-sync-draft'
import { BackupSyncFields } from '@renderer/components/backup/backup-sync-fields'
import {
  NetworkSettings,
  SignatureSettings,
  SyncSettings
} from '@renderer/components/settings/settings-advanced-sections'
import { AccountManagementSettings } from '@renderer/components/settings/account-management-settings'
import { TranslationSettings } from '@renderer/components/settings/translation-settings'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { PrivacySettings } from './privacy-settings'
import { MailRulesSettings } from './mail-rules-settings'
import { NotificationSettings } from './notification-settings'
import { SyncRangeSettings } from './sync-range-settings'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@renderer/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import type {
  AppSettings,
  AppColorTheme,
  AppUpdateStatus,
  AccountUpdateInput,
  BackupImportResult,
  BackupImportSource,
  BackupSyncDownloadResult,
  BackupSyncSettings,
  SettingsUpdateInput,
  SystemInfo,
  UpdateCheckFrequency
} from '../../../../shared/types'
import { cn } from '@renderer/lib/utils'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { ONEMAIL_HOMEPAGE_URL } from '@renderer/lib/update-status'
import type { Account } from '@renderer/components/mail/types'
import { APP_COLOR_THEMES, APP_COLOR_THEME_SWATCHES, applyAppTheme } from '@renderer/lib/theme'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettings | null
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
  initialSection?: SettingsSection
  onOpenChange: (open: boolean) => void
  onSubmit: (input: SettingsUpdateInput) => Promise<void>
  onImported?: () => Promise<void> | void
  accounts: Account[]
  onUpdateAccount: (input: AccountUpdateInput) => Promise<void>
  onRefreshAccounts: () => Promise<void>
  onRemoveAccounts: (accountIds: number[]) => Promise<void>
  onReorderAccounts: (accountIds: number[]) => Promise<void>
}

export type SettingsSection =
  | 'accounts'
  | 'notifications'
  | 'general'
  | 'signatures'
  | 'network'
  | 'privacy'
  | 'rules'
  | 'sync'
  | 'sync-range'
  | 'translation'
  | 'backup'
  | 'about'
type BackupPending =
  | 'export'
  | 'import'
  | 'saveRemote'
  | 'testRemote'
  | 'uploadRemote'
  | 'downloadRemote'
  | null
type BackupMessage = {
  label: string
  path?: string
}

const AUTO_SAVE_DELAY_MS = 350

type SettingsFormValues = {
  syncIntervalMinutes: number
  openAtLogin: boolean
  defaultDesktopNotificationsEnabled: boolean
  locale: 'zh-CN' | 'en-US'
  theme: AppColorTheme
  updateCheckFrequency: UpdateCheckFrequency
}

const sections: Array<{
  value: SettingsSection
  labelKey: TranslationKey
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  {
    value: 'general',
    labelKey: 'settings.general',
    icon: RefreshCcw
  },
  {
    value: 'accounts',
    labelKey: 'settings.accounts',
    icon: Mails
  },
  {
    value: 'sync',
    labelKey: 'settings.sync',
    icon: Clock3
  },
  { value: 'sync-range', labelKey: 'settings.syncRange', icon: CalendarRange },
  { value: 'notifications', labelKey: 'settings.notifications', icon: Bell },
  {
    value: 'signatures',
    labelKey: 'settings.signatures',
    icon: Signature
  },
  {
    value: 'network',
    labelKey: 'settings.network',
    icon: Network
  },
  { value: 'privacy', labelKey: 'settings.privacy', icon: ShieldCheck },
  { value: 'rules', labelKey: 'settings.rules', icon: ListFilter },
  {
    value: 'translation',
    labelKey: 'settings.translation',
    icon: Languages
  },
  {
    value: 'backup',
    labelKey: 'settings.backup',
    icon: DatabaseBackup
  },
  {
    value: 'about',
    labelKey: 'settings.about',
    icon: BadgeInfo
  }
]

export function SettingsDialog({
  open,
  settings,
  systemInfo,
  updateStatus,
  initialSection = 'general',
  onOpenChange,
  onSubmit,
  onImported,
  accounts,
  onUpdateAccount,
  onRefreshAccounts,
  onRemoveAccounts,
  onReorderAccounts
}: SettingsDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const settingsSchema = React.useMemo(() => createSettingsSchema(t), [t])
  const [section, setSection] = React.useState<SettingsSection>('general')
  const [pending, setPending] = React.useState(false)
  const [backupPending, setBackupPending] = React.useState<BackupPending>(null)
  const [includeMail, setIncludeMail] = React.useState(true)
  const [backupImportDialogOpen, setBackupImportDialogOpen] = React.useState(false)
  const [backupImportDefaultSource, setBackupImportDefaultSource] =
    React.useState<BackupImportDialogSource>('sql')
  const [backupImportSyncSettings, setBackupImportSyncSettings] =
    React.useState<BackupSyncSettings | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [backupMessage, setBackupMessage] = React.useState<BackupMessage | null>(null)
  const [backupError, setBackupError] = React.useState<string | null>(null)
  const [backupSyncSettings, setBackupSyncSettings] = React.useState<BackupSyncSettings | null>(
    null
  )
  const lastSavedValuesRef = React.useRef<SettingsFormValues>(toFormValues(settings))
  const autoSaveTimerRef = React.useRef<number | null>(null)
  const queuedValuesRef = React.useRef<SettingsFormValues | null>(null)
  const savingRef = React.useRef(false)
  const wasOpenRef = React.useRef(false)
  const backupImportSourceRef = React.useRef<BackupImportDialogSource>('sql')
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: toFormValues(settings),
    mode: 'onChange'
  })
  const watchedValues = useWatch({ control: form.control })

  const saveSettingsValues = React.useCallback(
    async (values: SettingsFormValues): Promise<void> => {
      if (areSettingsEqual(values, lastSavedValuesRef.current)) return
      if (savingRef.current) {
        queuedValuesRef.current = values
        return
      }

      savingRef.current = true
      setPending(true)
      setError(null)

      let nextValues: SettingsFormValues | null = values
      while (nextValues) {
        const currentValues = nextValues
        queuedValuesRef.current = null

        try {
          await onSubmit({
            syncIntervalMinutes: currentValues.syncIntervalMinutes,
            openAtLogin: currentValues.openAtLogin,
            defaultDesktopNotificationsEnabled: currentValues.defaultDesktopNotificationsEnabled,
            locale: currentValues.locale,
            theme: currentValues.theme,
            updateCheckFrequency: currentValues.updateCheckFrequency
          })
          lastSavedValuesRef.current = currentValues
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : t('settings.updateError'))
          break
        }

        nextValues = queuedValuesRef.current
        if (nextValues && areSettingsEqual(nextValues, lastSavedValuesRef.current)) {
          nextValues = null
        }
      }

      savingRef.current = false
      queuedValuesRef.current = null
      setPending(false)
    },
    [onSubmit, t]
  )

  const flushPendingSettings = React.useCallback((): void => {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(form.getValues())
    if (parsedValues.success) {
      void saveSettingsValues(parsedValues.data)
    }
  }, [form, saveSettingsValues, settingsSchema])

  React.useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (!settings) return
    if (wasOpenRef.current) return

    const nextValues = toFormValues(settings)
    lastSavedValuesRef.current = nextValues
    form.reset(nextValues)
    setSection(initialSection)
    wasOpenRef.current = true
  }, [form, initialSection, open, settings])

  React.useEffect(() => {
    if (!open || section !== 'backup') return

    let cancelled = false
    void loadBackupSyncSettings()
      .then((nextSettings) => {
        if (!cancelled) setBackupSyncSettings(nextSettings)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setBackupError(
            loadError instanceof Error ? loadError.message : t('settings.backup.error')
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, section, t])

  React.useEffect(() => {
    if (!open || !settings) return

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }

    const parsedValues = settingsSchema.safeParse(watchedValues)
    if (!parsedValues.success) return
    if (areSettingsEqual(parsedValues.data, lastSavedValuesRef.current)) return

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void saveSettingsValues(parsedValues.data)
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [open, settings, saveSettingsValues, settingsSchema, watchedValues])

  React.useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [])

  function handleOpenChange(nextOpen: boolean): void {
    if ((pending || backupPending) && !nextOpen) return

    if (!nextOpen) {
      flushPendingSettings()
      setError(null)
      setBackupError(null)
      setBackupMessage(null)
      setSection('general')
    }
    onOpenChange(nextOpen)
  }

  async function handleExport(): Promise<void> {
    await runBackupAction('export', async () => {
      const path = await exportSqlBackup({ includeMail })
      setBackupMessage(
        path
          ? { label: t('settings.backup.exported'), path }
          : { label: t('settings.backup.exportCanceled') }
      )
    })
  }

  function handleImport(): void {
    openBackupImportDialog('sql')
  }

  async function handleSaveBackupSync(input: BackupSyncSettings): Promise<void> {
    await runBackupAction('saveRemote', async () => {
      const nextSettings = await saveBackupSyncSettings(input)
      setBackupSyncSettings(nextSettings)
      setBackupMessage({ label: t('settings.backup.remoteSaved') })
    })
  }

  async function handleTestBackupSync(input: BackupSyncSettings): Promise<void> {
    await runBackupAction('testRemote', async () => {
      const result = await testBackupSyncSettings(input)
      setBackupMessage({
        label: t('settings.backup.remoteTested'),
        path: result.remotePath
      })
    })
  }

  async function handleUploadBackupSync(): Promise<void> {
    await runBackupAction('uploadRemote', async () => {
      const result = await uploadBackupSync({ includeMail })
      setBackupMessage({
        label: t('settings.backup.remoteUploaded'),
        path: result.remotePath
      })
    })
  }

  function handleDownloadBackupSync(input: BackupSyncSettings): void {
    if (input.provider === 'none') return
    openBackupImportDialog(input.provider, input)
  }

  function openBackupImportDialog(
    source: BackupImportDialogSource,
    syncInput?: BackupSyncSettings
  ): void {
    if (backupPending) return
    backupImportSourceRef.current = source
    setBackupImportDefaultSource(source)
    setBackupImportSyncSettings(syncInput ?? null)
    setBackupError(null)
    setBackupMessage(null)
    setBackupImportDialogOpen(true)
  }

  function handleBackupImportBusyChange(busy: boolean): void {
    setBackupPending(
      busy ? (backupImportSourceRef.current === 'sql' ? 'import' : 'downloadRemote') : null
    )
  }

  async function handleBackupImported(
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ): Promise<void> {
    const remote = source !== 'local'
    setBackupMessage({
      label: formatImportResultMessage(result, remote, t),
      path: remote && 'remotePath' in result ? result.remotePath : result.filePath
    })
    await onImported?.()
  }

  async function runBackupAction(
    action: Exclude<BackupPending, null>,
    task: () => Promise<void>
  ): Promise<void> {
    setBackupPending(action)
    setBackupError(null)
    setBackupMessage(null)

    try {
      await task()
    } catch (backupActionError) {
      setBackupError(getBackupActionErrorMessage(backupActionError, t))
    } finally {
      setBackupPending(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none"
        >
          <header className="app-titlebar app-drag-region flex h-12 shrink-0 items-center gap-3 border-b bg-background">
            <Button
              variant="ghost"
              size="sm"
              className="app-no-drag"
              disabled={pending || Boolean(backupPending)}
              onClick={() => handleOpenChange(false)}
            >
              <ArrowLeft aria-hidden="true" />
              {t('settings.backToMailbox')}
            </Button>
            <DialogTitle className="text-sm">{t('settings.title')}</DialogTitle>
          </header>
          <div className="grid min-h-0 w-full flex-1 grid-cols-[180px_minmax(0,1fr)] overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav
              aria-label={t('settings.navigation')}
              className="min-h-0 overflow-y-auto border-r bg-muted/30 p-3"
            >
              <div className="flex flex-col gap-1">
                {sections.map((item) => {
                  const Icon = item.icon
                  const active = section === item.value

                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        'flex h-10 w-full flex-none items-center gap-2 rounded-md px-3 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
                        active
                          ? 'bg-background text-foreground shadow-xs'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                      )}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setSection(item.value)}
                    >
                      <Icon className="shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate font-medium">{t(item.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </nav>

            <div className="h-full min-h-0 overflow-auto">
              {section === 'accounts' ? (
                <AccountManagementSettings
                  accounts={accounts}
                  defaultComposeAccountId={settings?.defaultComposeAccountId ?? null}
                  onDefaultComposeAccountChange={(accountId) =>
                    onSubmit({ defaultComposeAccountId: accountId })
                  }
                  onRemoveAccounts={onRemoveAccounts}
                  onReorderAccounts={onReorderAccounts}
                />
              ) : section === 'general' ? (
                <GeneralSettingsForm form={form} error={error} systemInfo={systemInfo} />
              ) : section === 'signatures' ? (
                <SignatureSettings
                  settings={settings}
                  accounts={accounts}
                  onSubmit={onSubmit}
                  onUpdateAccount={onUpdateAccount}
                  onRefreshAccounts={onRefreshAccounts}
                />
              ) : section === 'network' ? (
                <NetworkSettings
                  settings={settings}
                  accounts={accounts}
                  onSubmit={onSubmit}
                  onUpdateAccount={onUpdateAccount}
                />
              ) : section === 'sync' ? (
                <SyncSettings
                  settings={settings}
                  accounts={accounts}
                  onSubmit={onSubmit}
                  onUpdateAccount={onUpdateAccount}
                />
              ) : section === 'sync-range' ? (
                settings ? (
                  <SyncRangeSettings settings={settings} onSubmit={onSubmit} />
                ) : (
                  <p>{t('common.loading')}</p>
                )
              ) : section === 'notifications' ? (
                <NotificationSettings accounts={accounts} onRefreshAccounts={onRefreshAccounts} />
              ) : section === 'privacy' ? (
                <PrivacySettings onUpdateSettings={onSubmit} />
              ) : section === 'rules' ? (
                <MailRulesSettings />
              ) : section === 'translation' ? (
                <TranslationSettings />
              ) : section === 'backup' ? (
                <BackupSettings
                  key={getBackupSyncSettingsKey(backupSyncSettings)}
                  pending={backupPending}
                  message={backupMessage}
                  error={backupError}
                  syncSettings={backupSyncSettings}
                  includeMail={includeMail}
                  onIncludeMailChange={setIncludeMail}
                  onExport={handleExport}
                  onImport={handleImport}
                  onSaveSync={handleSaveBackupSync}
                  onTestSync={handleTestBackupSync}
                  onUploadSync={handleUploadBackupSync}
                  onDownloadSync={handleDownloadBackupSync}
                />
              ) : (
                <AboutSettings
                  form={form}
                  error={error}
                  systemInfo={systemInfo}
                  updateStatus={updateStatus}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportDefaultSource}
        syncSettings={backupImportSyncSettings ?? backupSyncSettings ?? undefined}
        onOpenChange={(nextOpen) => {
          setBackupImportDialogOpen(nextOpen)
          if (!nextOpen) setBackupImportSyncSettings(null)
        }}
        onBusyChange={handleBackupImportBusyChange}
        onImported={handleBackupImported}
      />
    </>
  )
}

function GeneralSettingsForm({
  form,
  error,
  systemInfo
}: {
  form: ReturnType<typeof useForm<SettingsFormValues>>
  error: string | null
  systemInfo: SystemInfo | null
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Controller
          control={form.control}
          name="openAtLogin"
          render={({ field }) => (
            <SettingRow
              icon={Power}
              title={t('settings.openAtLogin.title')}
              description={t('settings.openAtLogin.description')}
              control={
                <Switch
                  id="open-at-login"
                  size="sm"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              }
            />
          )}
        />

        <Controller
          control={form.control}
          name="theme"
          render={({ field }) => (
            <SettingRow
              icon={Palette}
              title={t('settings.theme.title')}
              description={t('settings.theme.description')}
              control={
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    const theme = value as AppColorTheme
                    field.onChange(theme)
                    applyAppTheme(theme)
                  }}
                >
                  <SelectTrigger id="theme" size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {APP_COLOR_THEMES.map((theme) => (
                        <SelectItem key={theme} value={theme}>
                          <span className="flex items-center gap-2">
                            <span
                              className="size-3 shrink-0 rounded-sm border border-black/15 dark:border-white/20"
                              style={{ backgroundColor: APP_COLOR_THEME_SWATCHES[theme] }}
                              aria-hidden="true"
                            />
                            {t(`settings.theme.${theme}` as TranslationKey)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />
          )}
        />

        <Controller
          control={form.control}
          name="defaultDesktopNotificationsEnabled"
          render={({ field }) => (
            <SettingRow
              icon={Bell}
              title={t('settings.notifications.title')}
              description={t('settings.notifications.description')}
              control={
                <Switch
                  id="default-desktop-notifications"
                  aria-label={t('settings.notifications.title')}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              }
            />
          )}
        />

        <Controller
          control={form.control}
          name="locale"
          render={({ field }) => (
            <SettingRow
              icon={Languages}
              title={t('settings.locale.title')}
              description={t('settings.locale.description')}
              control={
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="locale"
                    size="sm"
                    className="w-36"
                    aria-invalid={Boolean(form.formState.errors.locale)}
                  >
                    <SelectValue placeholder={t('settings.locale.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="zh-CN">{t('settings.locale.zhCN')}</SelectItem>
                      <SelectItem value="en-US">{t('settings.locale.enUS')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
              error={form.formState.errors.locale?.message}
              invalid={Boolean(form.formState.errors.locale)}
            />
          )}
        />

        <SettingRow
          icon={FolderOpen}
          title={t('settings.database.title')}
          description={
            <span className="break-all">
              {systemInfo?.databasePath ?? t('settings.database.loading')}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!systemInfo?.databasePath}
              onClick={() => void revealDatabaseInFileManager()}
            >
              <FolderOpen data-icon="inline-start" />
              {t('settings.database.openFolder')}
            </Button>
          }
        />

        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </div>
  )
}

export function BackupSettings({
  pending,
  message,
  error,
  syncSettings,
  includeMail,
  onIncludeMailChange,
  onExport,
  onImport,
  onSaveSync,
  onTestSync,
  onUploadSync,
  onDownloadSync
}: {
  pending: BackupPending
  message: BackupMessage | null
  error: string | null
  syncSettings: BackupSyncSettings | null
  includeMail: boolean
  onIncludeMailChange: (includeMail: boolean) => void
  onExport: () => Promise<void>
  onImport: () => void
  onSaveSync: (input: BackupSyncSettings) => Promise<void>
  onTestSync: (input: BackupSyncSettings) => Promise<void>
  onUploadSync: () => Promise<void>
  onDownloadSync: (input: BackupSyncSettings) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<BackupSyncSettings>(
    () => syncSettings ?? { provider: 'none' }
  )
  const disabled = Boolean(pending)
  const remoteConfigured = Boolean(syncSettings && syncSettings.provider !== 'none')

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <Alert className="bg-muted/30 py-2 text-xs">
          <KeyRound />
          <AlertTitle>{t('settings.backup.securityTitle')}</AlertTitle>
          <AlertDescription className="text-xs">
            {t('settings.backup.securityDescription')}
          </AlertDescription>
        </Alert>

        <div className="rounded-md border p-3">
          <label
            className="flex items-center gap-2 text-sm font-medium"
            htmlFor="backup-include-mail"
          >
            <Checkbox
              id="backup-include-mail"
              checked={includeMail}
              disabled={disabled}
              onCheckedChange={(checked) => onIncludeMailChange(checked === true)}
            />
            {t('settings.backup.includeMail')}
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('settings.backup.scopeDescription')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('settings.backup.restoreDescription')}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('settings.backup.attachmentDescription')}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <BackupActionButton
            icon={Download}
            title={t('settings.backup.export')}
            loadingTitle={t('settings.backup.exporting')}
            description={t('settings.backup.exportDescription')}
            loading={pending === 'export'}
            disabled={disabled}
            onClick={onExport}
          />
          <BackupActionButton
            icon={FileUp}
            title={t('settings.backup.import')}
            loadingTitle={t('settings.backup.importing')}
            description={t('settings.backup.importDescription')}
            loading={pending === 'import'}
            disabled={disabled}
            onClick={onImport}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <div className="flex flex-col gap-1">
            <FieldLabel className="text-xs">{t('settings.backup.remoteTitle')}</FieldLabel>
            <FieldDescription className="text-xs leading-snug">
              {t('settings.backup.remoteDescription')}
            </FieldDescription>
          </div>

          <BackupSyncFields
            draft={draft}
            currentSettings={syncSettings}
            disabled={disabled}
            onChange={setDraft}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <BackupActionButton
              icon={Save}
              title={t('settings.backup.remoteSave')}
              loadingTitle={t('settings.backup.remoteSaving')}
              description={t('settings.backup.remoteSaveDescription')}
              loading={pending === 'saveRemote'}
              disabled={disabled}
              onClick={() => onSaveSync(draft)}
            />
            <BackupActionButton
              icon={RefreshCcw}
              title={t('settings.backup.remoteTest')}
              loadingTitle={t('settings.backup.remoteTesting')}
              description={t('settings.backup.remoteTestDescription')}
              loading={pending === 'testRemote'}
              disabled={disabled || draft.provider === 'none'}
              onClick={() => onTestSync(draft)}
            />
            <BackupActionButton
              icon={Upload}
              title={t('settings.backup.remoteUpload')}
              loadingTitle={t('settings.backup.remoteUploading')}
              description={t('settings.backup.remoteUploadDescription')}
              loading={pending === 'uploadRemote'}
              disabled={disabled || !remoteConfigured}
              onClick={onUploadSync}
            />
            <BackupActionButton
              icon={Download}
              title={t('settings.backup.remoteDownload')}
              loadingTitle={t('settings.backup.remoteDownloading')}
              description={t('settings.backup.remoteDownloadDescription')}
              loading={pending === 'downloadRemote'}
              disabled={disabled || draft.provider === 'none'}
              onClick={() => onDownloadSync(draft)}
            />
          </div>
        </div>

        {message ? <BackupMessageView message={message} /> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </div>
  )
}

function formatImportResultMessage(
  result: BackupImportResult,
  remote: boolean,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const values = {
    accounts: result.accountCount ?? 0,
    messages: result.messageCount ?? 0
  }

  return t(
    remote ? 'settings.backup.remoteDownloadedSummary' : 'settings.backup.importedSummary',
    values
  )
}

function getBackupActionErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  const message = error instanceof Error ? error.message : t('settings.backup.error')
  return message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
}

function AboutSettings({
  form,
  error,
  systemInfo,
  updateStatus
}: {
  form: ReturnType<typeof useForm<SettingsFormValues>>
  error: string | null
  systemInfo: SystemInfo | null
  updateStatus: AppUpdateStatus | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [updatePending, setUpdatePending] = React.useState<'check' | 'download' | 'install' | null>(
    null
  )
  const [updateError, setUpdateError] = React.useState<{
    key: TranslationKey
    status: AppUpdateStatus | null
  } | null>(null)
  const version = systemInfo?.appVersion ? `v${systemInfo.appVersion}` : t('common.loading')
  const downloading = updatePending === 'download' || updateStatus?.state === 'downloading'
  const canDownload =
    updateStatus?.state === 'available' ||
    updateStatus?.state === 'cancelled' ||
    (updateStatus?.state === 'error' && updateStatus.errorStage === 'download')
  const updateAction =
    updateStatus?.state === 'downloaded'
      ? 'install'
      : canDownload || downloading
        ? 'download'
        : 'check'
  const updateBusy =
    updatePending !== null ||
    updateStatus?.state === 'checking' ||
    updateStatus?.state === 'downloading' ||
    updateStatus?.state === 'installing'
  const checking = updatePending === 'check' || updateStatus?.state === 'checking'
  const progress = updateStatus?.progress
  const UpdateIcon = updateBusy ? LoaderCircle : updateAction === 'download' ? Download : RefreshCcw
  const updateButtonLabel =
    updateAction === 'install'
      ? t('settings.about.updateRestart')
      : updateAction === 'download'
        ? t(downloading ? 'settings.about.updateDownloading' : 'settings.about.updateDownload')
        : t(checking ? 'settings.about.updateChecking' : 'settings.about.updateCheck')

  async function handleUpdateAction(): Promise<void> {
    const errorKey: TranslationKey =
      updateAction === 'download'
        ? 'settings.about.updateDownloadFailed'
        : updateAction === 'install'
          ? 'settings.about.updateInstallFailed'
          : 'settings.about.updateFailed'
    const failure = { key: errorKey, status: updateStatus }
    setUpdatePending(updateAction)
    setUpdateError(null)
    try {
      if (updateAction === 'check') {
        const result = await checkForAppUpdates()
        if (result.status === 'error') setUpdateError(failure)
      } else {
        const succeeded = await (updateAction === 'download'
          ? downloadAppUpdate()
          : installAppUpdate())
        if (!succeeded) setUpdateError(failure)
      }
    } catch {
      setUpdateError(failure)
    } finally {
      setUpdatePending(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-3 p-3 sm:p-4">
      <FieldGroup className="gap-2.5">
        <SettingRow
          icon={BadgeInfo}
          title="OneMail Next"
          description={
            <span>
              {t('settings.about.versionPrefix')} <span>{version}</span>
              {t('settings.about.versionSuffix')}
            </span>
          }
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternalUrl(ONEMAIL_HOMEPAGE_URL)}
            >
              <ExternalLink data-icon="inline-start" />
              GitHub
            </Button>
          }
        />
        <Controller
          control={form.control}
          name="updateCheckFrequency"
          render={({ field }) => (
            <SettingRow
              icon={Clock3}
              title={t('settings.about.updateFrequencyTitle')}
              description={t('settings.about.updateFrequencyDescription')}
              control={
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="update-check-frequency" size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      {t('settings.about.updateFrequencyManual')}
                    </SelectItem>
                    <SelectItem value="daily">
                      {t('settings.about.updateFrequencyDaily')}
                    </SelectItem>
                    <SelectItem value="weekly">
                      {t('settings.about.updateFrequencyWeekly')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              }
            />
          )}
        />
        <SettingRow
          icon={RefreshCcw}
          title={t('settings.about.updateTitle')}
          description={
            <span role="status">
              {updateError && updateError.status === updateStatus
                ? t(updateError.key)
                : formatAboutUpdateStatus(updateStatus, t)}
            </span>
          }
          control={
            <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-60">
              <Button
                variant={updateAction === 'install' ? 'default' : 'outline'}
                size="sm"
                className="w-full"
                disabled={updateBusy}
                onClick={() => void handleUpdateAction()}
              >
                <UpdateIcon
                  data-icon="inline-start"
                  className={updateBusy ? 'animate-spin' : undefined}
                />
                {updateButtonLabel}
              </Button>
              {downloading ? (
                <>
                  <Progress
                    value={progress?.percent ?? 0}
                    aria-label={t('settings.about.updateDownloading')}
                    className="h-1.5"
                  />
                  <span className="text-xs leading-4 text-muted-foreground tabular-nums">
                    {progress && progress.totalBytes > 0
                      ? t('settings.about.updateProgress', {
                          percent: Math.round(progress.percent),
                          transferred: formatUpdateBytes(progress.transferredBytes),
                          total: formatUpdateBytes(progress.totalBytes),
                          speed: formatUpdateBytes(progress.bytesPerSecond)
                        })
                      : t('settings.about.updateProgressUnknown')}
                  </span>
                </>
              ) : null}
            </div>
          }
        />
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="border-t pt-3 text-xs leading-6 text-muted-foreground">
          <p>{t('settings.about.basedOn')}</p>
          <p>
            {t('settings.about.originalOwner')}{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={() => void openExternalUrl('https://github.com/zhihui-hu')}
            >
              zhihui-hu
            </button>
          </p>
          <p>
            {t('settings.about.modifier')}{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={() => void openExternalUrl('https://github.com/pcjiang1998')}
            >
              pcjiang1998
            </button>
          </p>
          <p>
            {t('settings.about.website')}{' '}
            <button
              type="button"
              className="break-all text-foreground underline underline-offset-2"
              onClick={() => void openExternalUrl(ONEMAIL_HOMEPAGE_URL)}
            >
              {ONEMAIL_HOMEPAGE_URL}
            </button>
          </p>
          <p>{t('settings.about.license')}</p>
        </div>
      </FieldGroup>
    </div>
  )
}

function formatAboutUpdateStatus(
  status: AppUpdateStatus | null,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  if (!status || status.state === 'idle') return t('settings.about.updateIdle')
  if (status.state === 'checking') return t('settings.about.updateChecking')
  if (status.state === 'available') {
    return status.latestVersion
      ? t('settings.about.updateAvailableVersion', { version: status.latestVersion })
      : t('settings.about.updateAvailable')
  }
  if (status.state === 'downloading') {
    return t('settings.about.updateDownloadingPercent', {
      percent: Math.round(status.progress?.percent ?? 0)
    })
  }
  if (status.state === 'downloaded') return t('settings.about.updateDownloaded')
  if (status.state === 'installing') return t('settings.about.updateInstalling')
  if (status.state === 'not_available') return t('settings.about.updateNotAvailable')
  if (status.state === 'unsupported') return t('settings.about.updateUnsupported')
  if (status.state === 'cancelled') return t('settings.about.updateCancelled')
  if (status.errorStage === 'download') return t('settings.about.updateDownloadFailed')
  if (status.errorStage === 'install') return t('settings.about.updateInstallFailed')
  return t('settings.about.updateFailed')
}

function formatUpdateBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['B', 'KB', 'MB', 'GB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(1)} ${units[unit]}`
}

function BackupMessageView({ message }: { message: BackupMessage }): React.JSX.Element {
  const isRemotePath =
    message.path?.startsWith('http://') === true || message.path?.startsWith('https://') === true

  if (!message.path) {
    return (
      <Alert className="py-2 text-xs">
        <ShieldCheck />
        <AlertTitle>{message.label}</AlertTitle>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-card p-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <ShieldCheck aria-hidden="true" />
        <span>{message.label}</span>
      </div>
      <Button
        className="h-auto justify-start break-all px-0 py-0 text-left whitespace-normal"
        variant="link"
        size="sm"
        onClick={() =>
          void (isRemotePath
            ? openExternalUrl(message.path!)
            : revealPathInFileManager(message.path!))
        }
      >
        <FolderOpen data-icon="inline-start" />
        {message.path}
      </Button>
    </div>
  )
}

function SettingRow({
  icon: Icon,
  title,
  description,
  control,
  error,
  invalid = false
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description: React.ReactNode
  control?: React.ReactNode
  error?: string
  invalid?: boolean
}): React.JSX.Element {
  return (
    <Field data-invalid={invalid || undefined}>
      <div className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 gap-2.5">
          <div className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">
            <Icon aria-hidden="true" />
          </div>
          <FieldContent>
            <FieldLabel className="text-xs">{title}</FieldLabel>
            <FieldDescription className="text-xs leading-snug">{description}</FieldDescription>
            <FieldError className="text-xs">{error}</FieldError>
          </FieldContent>
        </div>
        {control ? <div className="flex justify-start sm:justify-end">{control}</div> : null}
      </div>
    </Field>
  )
}

function BackupActionButton({
  icon: Icon,
  title,
  loadingTitle,
  description,
  loading,
  disabled,
  onClick
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  loadingTitle: string
  description: string
  loading: boolean
  disabled: boolean
  onClick: () => void | Promise<void>
}): React.JSX.Element {
  return (
    <Button
      className="h-auto justify-start px-3 py-2 text-left"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      {loading ? (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      ) : (
        <Icon data-icon="inline-start" />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate">{loading ? loadingTitle : title}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </span>
    </Button>
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createSettingsSchema(t: (key: TranslationKey) => string) {
  return z.object({
    syncIntervalMinutes: z.coerce
      .number<number>(t('settings.syncInterval.errorRequired'))
      .int(t('settings.syncInterval.errorInteger'))
      .min(0, t('settings.syncInterval.errorMin'))
      .max(1440, t('settings.syncInterval.errorMax')),
    openAtLogin: z.boolean(),
    defaultDesktopNotificationsEnabled: z.boolean(),
    locale: z.enum(['zh-CN', 'en-US']),
    theme: z.enum(APP_COLOR_THEMES),
    updateCheckFrequency: z.enum(['manual', 'daily', 'weekly'])
  })
}

function toFormValues(settings: AppSettings | null): SettingsFormValues {
  return {
    syncIntervalMinutes: settings?.syncIntervalMinutes ?? 15,
    openAtLogin: settings?.openAtLogin === true,
    defaultDesktopNotificationsEnabled: settings?.defaultDesktopNotificationsEnabled !== false,
    locale: settings?.locale === 'en-US' ? 'en-US' : 'zh-CN',
    theme: settings?.theme ?? 'light',
    updateCheckFrequency: settings?.updateCheckFrequency ?? 'daily'
  }
}

function areSettingsEqual(first: SettingsFormValues, second: SettingsFormValues): boolean {
  return (
    first.syncIntervalMinutes === second.syncIntervalMinutes &&
    first.openAtLogin === second.openAtLogin &&
    first.defaultDesktopNotificationsEnabled === second.defaultDesktopNotificationsEnabled &&
    first.locale === second.locale &&
    first.theme === second.theme &&
    first.updateCheckFrequency === second.updateCheckFrequency
  )
}
