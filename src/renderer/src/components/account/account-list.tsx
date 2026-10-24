import * as React from 'react'
import {
  AlertTriangle,
  ArchiveX,
  Contact,
  KanbanSquare,
  ChevronRight,
  Edit3,
  MailWarning,
  FilePenLine,
  Folder,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2
} from 'lucide-react'

import type { Account } from '@renderer/components/mail/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { getProviderLogoMetadata } from '../../../../shared/provider-metadata'
import {
  getFolderSelectionKey,
  getLocalDeletedSelectionKey,
  parseMailboxSelection
} from '@renderer/lib/api'
import oneMailIcon from '../../assets/onemail-icon.png'
import outlookIcon from '../../assets/outlook-icon.ico'
import { getAccountWarning } from './account-warning'

type AccountListProps = {
  accounts: Account[]
  selectedAccountId: string
  syncingAccountIds: Set<string>
  actionsDisabled: boolean
  composePending: boolean
  onSelectAccount: (accountId: string) => void
  onCompose: () => void
  onOpenOutbox: () => void
  onOpenDrafts: () => void
  draftsSelected?: boolean
  outboxSelected?: boolean
  draftCount?: number
  onRefreshAccount: (account: Account) => void
  onEditAccount: (account: Account) => void
  onDeleteAccount: (account: Account) => void
  onResolveAccountWarning: (account: Account) => void
  onOpenContacts?: () => void
  onOpenBoard?: () => void
}

export function AccountList({
  accounts,
  selectedAccountId,
  syncingAccountIds,
  actionsDisabled,
  composePending,
  onSelectAccount,
  onCompose,
  onOpenOutbox,
  onOpenDrafts,
  draftsSelected = false,
  outboxSelected = false,
  draftCount,
  onRefreshAccount,
  onEditAccount,
  onDeleteAccount,
  onResolveAccountWarning,
  onOpenContacts,
  onOpenBoard
}: AccountListProps): React.JSX.Element {
  const { t } = useI18n()
  const [collapsedAccounts, setCollapsedAccounts] = React.useState<Set<string>>(() => new Set())
  const allAccount = accounts.find((account) => account.id === 'all')
  const mailboxAccountId = parseMailboxSelection(selectedAccountId).accountId
  const realAccounts = accounts.filter((account) => account.id !== 'all')

  function toggleAccount(accountId: string): void {
    setCollapsedAccounts((current) => {
      const next = new Set(current)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }

  return (
    <aside className="flex h-full min-w-0 flex-col bg-card/60 text-xs text-foreground">
      <div className="shrink-0 border-b px-2 py-2">
        <TooltipProvider>
          <div className="flex items-center gap-1.5">
            <Button
              className="min-w-0 flex-1"
              size="sm"
              aria-label={t('account.list.compose')}
              disabled={actionsDisabled || composePending}
              onClick={onCompose}
            >
              <Pencil data-icon="inline-start" />
              {t('account.list.compose')}
            </Button>
          </div>
        </TooltipProvider>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
        <TooltipProvider>
          <div className="flex flex-col gap-0.5">
            <div className="mb-1 grid gap-0.5 border-b pb-1">
              <button
                type="button"
                className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onOpenContacts}
              >
                <Contact className="size-3.5" />
                联系人
              </button>
              <button
                type="button"
                className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onOpenBoard}
              >
                <KanbanSquare className="size-3.5" />
                看板
              </button>
            </div>
            <FolderRow
              label={t('account.folders.localDrafts')}
              count={draftCount}
              selected={draftsSelected}
              icon={<FilePenLine />}
              onClick={onOpenDrafts}
            />
            <FolderRow
              label={t('account.list.outbox')}
              selected={outboxSelected}
              icon={<MailWarning />}
              onClick={onOpenOutbox}
            />
            {allAccount ? (
              <AccountRow
                account={allAccount}
                selected={!draftsSelected && !outboxSelected && selectedAccountId === allAccount.id}
                syncing={syncingAccountIds.has(allAccount.id)}
                onClick={() => onSelectAccount(allAccount.id)}
                onRefresh={() => onRefreshAccount(allAccount)}
                onEdit={() => undefined}
                onDelete={() => undefined}
                onResolveWarning={() => onResolveAccountWarning(allAccount)}
              />
            ) : null}
            {realAccounts.length > 0 ? (
              realAccounts.map((account) => {
                const collapsed = collapsedAccounts.has(account.id)
                return (
                  <section key={account.id}>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={
                          collapsed ? t('account.folders.expand') : t('account.folders.collapse')
                        }
                        onClick={() => toggleAccount(account.id)}
                      >
                        <ChevronRight
                          className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <AccountRow
                          account={account}
                          selected={
                            !draftsSelected &&
                            !outboxSelected &&
                            mailboxAccountId === account.accountId &&
                            selectedAccountId === account.id
                          }
                          syncing={syncingAccountIds.has(account.id)}
                          onClick={() => {
                            onSelectAccount(account.id)
                            if (collapsed) toggleAccount(account.id)
                          }}
                          onRefresh={() => onRefreshAccount(account)}
                          onEdit={() => onEditAccount(account)}
                          onDelete={() => onDeleteAccount(account)}
                          onResolveWarning={() => onResolveAccountWarning(account)}
                        />
                      </div>
                    </div>
                    {!collapsed && account.accountId ? (
                      <AccountFolderRows
                        account={account}
                        selectedAccountId={
                          draftsSelected || outboxSelected ? '' : selectedAccountId
                        }
                        onSelectAccount={onSelectAccount}
                      />
                    ) : null}
                  </section>
                )
              })
            ) : (
              <EmptyAccounts />
            )}
          </div>
        </TooltipProvider>
      </div>
    </aside>
  )
}

function AccountFolderRows({
  account,
  selectedAccountId,
  onSelectAccount
}: {
  account: Account
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const folders = (account.folders ?? []).filter((folder) => folder.role !== 'drafts')
  const inbox = folders.find((folder) => folder.role === 'inbox')
  const sent = folders.find((folder) => folder.role === 'sent')
  const junk = folders.find((folder) => folder.role === 'junk')
  const additionalFolders = folders.filter(
    (folder) => folder.role !== 'inbox' && folder.role !== 'sent' && folder.role !== 'junk'
  )

  function renderRemoteFolder(folder: (typeof folders)[number]): React.ReactNode {
    if (!account.accountId || !folder.folderId) return null
    const key = getFolderSelectionKey(account.accountId, folder.folderId)
    return (
      <FolderRow
        key={key}
        label={getFolderLabel(folder.role, folder.name, t)}
        count={folder.unreadCount}
        selected={selectedAccountId === key}
        icon={getFolderIcon(folder.role)}
        onClick={() => onSelectAccount(key)}
      />
    )
  }

  return (
    <div className="ml-7 flex flex-col gap-0.5 border-l pl-1.5">
      {inbox ? renderRemoteFolder(inbox) : null}
      {sent ? renderRemoteFolder(sent) : null}
      {junk ? renderRemoteFolder(junk) : null}
      {account.accountId ? (
        <FolderRow
          label={t('account.folders.localDeleted')}
          selected={selectedAccountId === getLocalDeletedSelectionKey(account.accountId)}
          icon={<ArchiveX />}
          onClick={() => onSelectAccount(getLocalDeletedSelectionKey(account.accountId!))}
        />
      ) : null}
      {additionalFolders.map(renderRemoteFolder)}
    </div>
  )
}

function FolderRow({
  label,
  count,
  selected,
  icon,
  onClick
}: {
  label: string
  count?: number
  selected: boolean
  icon: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5',
        selected && 'bg-secondary text-secondary-foreground'
      )}
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">{count}</span>
      ) : null}
    </button>
  )
}

function getFolderIcon(role: string): React.ReactNode {
  if (role === 'inbox') return <Inbox />
  if (role === 'sent') return <Send />
  if (role === 'junk') return <ShieldAlert />
  if (role === 'trash') return <Trash2 />
  return <Folder />
}

function getFolderLabel(
  role: string,
  fallback: string,
  t: (key: TranslationKey) => string
): string {
  if (role === 'inbox') return t('account.folders.inbox')
  if (role === 'sent') return t('account.folders.sent')
  if (role === 'junk') return t('account.folders.junk')
  if (role === 'trash') return t('account.folders.remoteTrash')
  return fallback
}

function AccountRow({
  account,
  selected,
  syncing,
  onClick,
  onRefresh,
  onEdit,
  onDelete,
  onResolveWarning
}: {
  account: Account
  selected: boolean
  syncing: boolean
  onClick: () => void
  onRefresh: () => void
  onEdit: () => void
  onDelete: () => void
  onResolveWarning: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const canModify = Boolean(account.accountId)
  const warning = getAccountWarning(account, t)
  const handleSelect = warning ? onResolveWarning : onClick
  const rowContent = (
    <div
      className={cn(
        'group grid h-7 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 rounded-md px-1.5 transition-colors hover:bg-muted focus-within:ring-2 focus-within:ring-ring',
        selected && 'bg-secondary text-secondary-foreground'
      )}
    >
      <button
        type="button"
        onClick={handleSelect}
        className={cn(
          'grid min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-0.5 text-left outline-none',
          warning && 'text-warning-foreground'
        )}
      >
        <ProviderLogo account={account} selected={selected} warning={Boolean(warning)} />
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate font-medium">{getAccountDisplayName(account, t)}</span>
          {warning ? (
            <AlertTriangle
              className="size-3.5 shrink-0 text-warning-foreground"
              aria-hidden="true"
              strokeWidth={2}
            />
          ) : null}
        </span>
      </button>
      <span className="flex min-w-5 items-center justify-end gap-1">
        {warning ? null : (
          <Badge
            variant="secondary"
            className={cn(
              'h-4 min-w-4 rounded-full px-1 text-[10px] group-hover:hidden',
              syncing && 'hidden'
            )}
          >
            {account.unread}
          </Badge>
        )}
        <button
          type="button"
          aria-label={t('account.list.refreshAccount')}
          className={cn(
            'hidden size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex [&_svg]:size-3',
            syncing && 'inline-flex'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRefresh()
          }}
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden="true" strokeWidth={2} />
        </button>
      </span>
    </div>
  )

  return (
    <ContextMenu>
      {warning ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{warning.tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      )}
      <ContextMenuContent className="w-36">
        <ContextMenuGroup>
          <ContextMenuItem onSelect={warning ? onResolveWarning : onRefresh}>
            {warning ? <AlertTriangle strokeWidth={2} /> : <RefreshCw strokeWidth={2} />}
            {warning ? t('account.list.resolveWarning') : t('common.refresh')}
          </ContextMenuItem>
          {warning ? (
            <ContextMenuItem onSelect={onRefresh}>
              <RefreshCw strokeWidth={2} />
              {t('account.list.resync')}
            </ContextMenuItem>
          ) : null}
          {canModify ? (
            <>
              <ContextMenuItem onSelect={onEdit}>
                <Edit3 strokeWidth={2} />
                {t('common.edit')}
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 strokeWidth={2} />
                {t('common.delete')}
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ProviderLogo({
  account,
  selected,
  warning
}: {
  account: Account
  selected: boolean
  warning?: boolean
}): React.JSX.Element {
  const isUnifiedInbox = account.id === 'all'
  const logo = getProviderLogoMetadata(account.providerKey, account.address)
  const bundledLogo = logo.domain === 'outlook.com' ? outlookIcon : null
  const [loadedLogo, setLoadedLogo] = React.useState<{ domain: string; src: string | null } | null>(
    null
  )
  const src = bundledLogo ?? (loadedLogo?.domain === logo.domain ? loadedLogo.src : null)

  React.useEffect(() => {
    if (isUnifiedInbox || bundledLogo) return undefined

    let cancelled = false

    void window.api.logos.get(logo.domain).then((nextSrc) => {
      if (!cancelled) setLoadedLogo({ domain: logo.domain, src: nextSrc })
    })

    return () => {
      cancelled = true
    }
  }, [logo.domain, isUnifiedInbox, bundledLogo])

  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background text-muted-foreground [&_img]:size-4 [&_img]:object-contain [&_svg]:size-4',
        isUnifiedInbox && 'bg-transparent [&_img]:size-5 [&_img]:rounded-md [&_img]:object-cover',
        warning && 'text-warning-foreground',
        selected && 'text-foreground'
      )}
    >
      {isUnifiedInbox ? (
        <img src={oneMailIcon} alt="" />
      ) : src ? (
        <img src={src} alt="" />
      ) : (
        <span className="text-[10px] font-semibold leading-none" aria-hidden="true">
          {logo.fallback}
        </span>
      )}
    </span>
  )
}

function getAccountDisplayName(account: Account, t: (key: TranslationKey) => string): string {
  if (account.id === 'all') return t('account.all.name')
  return account.name || account.address || t('account.empty.name')
}

function EmptyAccounts(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-muted-foreground">
      <div className="font-medium text-foreground">{t('account.list.emptyTitle')}</div>
      <div className="max-w-44">{t('account.list.emptyDescription')}</div>
      <Button variant="outline" size="sm" disabled>
        <Plus data-icon="inline-start" />
        {t('account.list.useTopButton')}
      </Button>
    </div>
  )
}
