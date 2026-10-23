import type { AppSettings, SystemInfo, WritebackStatus } from '../../../../shared/types'
import {
  ChevronDown,
  CloudDownload,
  FileUp,
  Inbox,
  Link,
  Mail,
  Plus,
  Settings,
  Upload
} from 'lucide-react'

import type { BackupImportDialogSource } from '@renderer/components/backup/backup-import-dialog'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@renderer/components/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

import type { SyncNotice } from './use-sync-feedback'
import { formatSyncNotice } from './use-sync-feedback'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { WritebackStatusPanel } from '@renderer/components/mail/writeback-status-panel'

export function NoAccountsBody({
  importingSql,
  actionsDisabled = false,
  onAddAccount,
  onImportBackup
}: {
  importingSql: boolean
  actionsDisabled?: boolean
  onAddAccount: () => void
  onImportBackup: (source: BackupImportDialogSource) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <Empty className="min-h-0 flex-1 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('mailbox.noAccounts.title')}</EmptyTitle>
        <EmptyDescription>{t('mailbox.noAccounts.description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAddAccount} disabled={actionsDisabled}>
          <Plus data-icon="inline-start" />
          {t('common.addAccount')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={actionsDisabled}>
              <Upload data-icon="inline-start" />
              {importingSql ? t('mailbox.importing') : t('settings.backup.importMenu')}
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48 min-w-48 rounded-md p-1">
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('sql')}
              >
                <FileUp />
                <span className="truncate">{t('settings.backup.importSqlMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('webdav')}
              >
                <Link />
                <span className="truncate">{t('settings.backup.importWebDavMenu')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="h-8 cursor-pointer gap-2 whitespace-nowrap px-2 text-sm"
                onSelect={() => onImportBackup('s3')}
              >
                <CloudDownload />
                <span className="truncate">{t('settings.backup.importS3Menu')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </EmptyContent>
    </Empty>
  )
}

export function TitleBar({
  platform,
  onAddAccount,
  onOpenSettings
}: {
  platform?: SystemInfo['platform'] | null
  onAddAccount: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const placeActionsOnLeft = Boolean(platform && platform !== 'darwin')

  return (
    <header
      className={cn(
        'app-titlebar app-drag-region flex h-10 shrink-0 items-center border-b bg-background',
        placeActionsOnLeft ? 'justify-start' : 'justify-end'
      )}
    >
      <TooltipProvider>
        <div className="app-no-drag flex items-center gap-1">
          {placeActionsOnLeft ? (
            <>
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
            </>
          ) : (
            <>
              <AddAccountButton label={t('common.addAccount')} onClick={onAddAccount} />
              <SettingsButton label={t('common.settings')} onClick={onOpenSettings} />
            </>
          )}
        </div>
      </TooltipProvider>
    </header>
  )
}

function AddAccountButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} onClick={onClick}>
          <Plus aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function SettingsButton({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} onClick={onClick}>
          <Settings aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function StatusBar({
  settings,
  accountCount,
  messageCount,
  unreadCount,
  syncNotice,
  writebackStatus,
  onClearWriteback,
  onClearCompletedWritebacks,
  onRetryWriteback
}: {
  settings: AppSettings | null
  accountCount: number
  messageCount: number
  unreadCount: number
  syncNotice: SyncNotice
  writebackStatus: WritebackStatus
  onClearWriteback: (writebackId: number) => void
  onClearCompletedWritebacks: () => void
  onRetryWriteback: (writebackId: number) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const syncText = formatSyncNotice(syncNotice, t)

  return (
    <footer className="app-drag-region flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-muted/40 px-3 text-xs text-muted-foreground">
      <div className="app-no-drag min-w-0">
        {unreadCount > 0 ? (
          <span
            className="flex items-center gap-1.5 font-medium text-foreground"
            title={t('status.unread', { count: unreadCount })}
          >
            <Mail
              className="size-3.5 shrink-0 fill-amber-400/25 text-amber-500"
              aria-hidden="true"
            />
            <span>{unreadCount}</span>
          </span>
        ) : null}
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-2">
        {syncText ? (
          <span className="max-w-80 truncate text-foreground" title={syncText}>
            {syncText}
          </span>
        ) : null}
        <WritebackStatusPanel
          status={writebackStatus}
          onClear={(writebackId) => onClearWriteback(writebackId)}
          onClearCompleted={onClearCompletedWritebacks}
          onRetry={(writebackId) => onRetryWriteback(writebackId)}
        />
        <span>{t('status.accounts', { count: accountCount })}</span>
        <span>{t('status.messages', { count: messageCount })}</span>
        <span>{t('status.cacheDays', { days: settings?.syncWindowDays ?? 90 })}</span>
      </div>
    </footer>
  )
}
