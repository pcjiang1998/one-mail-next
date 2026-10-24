import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import type { Account } from './types'
import type { OutboxMessage } from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { DeleteDraftDialog } from './delete-draft-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

type DraftListProps = {
  accounts: Account[]
  messages: OutboxMessage[]
  totalCount: number
  offset: number
  pageSize: number
  accountId: string
  keyword: string
  loading: boolean
  pending: boolean
  error: string | null
  onChangeAccount: (accountId: string) => void
  onChangeKeyword: (keyword: string) => void
  onChangePage: (offset: number) => void
  onRefresh: () => void
  onCompose: () => void
  onOpenDraft: (message: OutboxMessage) => void
  onDelete: (message: OutboxMessage) => Promise<boolean>
  onDeleteMany: (outboxIds: number[]) => Promise<boolean>
}

export function DraftList({
  accounts,
  messages,
  totalCount,
  offset,
  pageSize,
  accountId,
  keyword,
  loading,
  pending,
  error,
  onChangeAccount,
  onChangeKeyword,
  onChangePage,
  onRefresh,
  onCompose,
  onOpenDraft,
  onDelete,
  onDeleteMany
}: DraftListProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const [deleteCandidates, setDeleteCandidates] = React.useState<OutboxMessage[]>([])
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => new Set())
  const selectedMessages = messages.filter((message) => selectedIds.has(message.outboxId))
  const allSelected = messages.length > 0 && selectedMessages.length === messages.length
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  async function confirmDelete(): Promise<void> {
    if (deleteCandidates.length === 0) return
    const deleted =
      deleteCandidates.length === 1
        ? await onDelete(deleteCandidates[0])
        : await onDeleteMany(deleteCandidates.map((message) => message.outboxId))
    if (deleted) {
      setDeleteCandidates([])
      setSelectedIds(new Set())
    }
  }

  return (
    <section
      aria-label={t('mail.outbox.draftsTitle')}
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <TooltipProvider>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <FilePenLine className="size-4 text-muted-foreground" />
            {t('mail.outbox.draftsTitle')}
          </h1>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.refresh')}
                  disabled={loading || pending}
                  onClick={onRefresh}
                >
                  <RefreshCw className={loading ? 'animate-spin' : ''} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.refresh')}</TooltipContent>
            </Tooltip>
            <Button size="sm" disabled={pending || accounts.length === 0} onClick={onCompose}>
              <Pencil data-icon="inline-start" />
              {t('account.list.compose')}
            </Button>
          </div>
        </header>
        <div className="flex shrink-0 flex-wrap gap-2 border-b px-4 py-2">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
            <Input
              className="h-8 pl-8"
              aria-label={t('mail.drafts.search')}
              placeholder={t('mail.drafts.search')}
              value={keyword}
              onChange={(event) => {
                setSelectedIds(new Set())
                onChangeKeyword(event.target.value)
              }}
            />
          </div>
          <select
            className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-xs sm:max-w-64"
            aria-label={t('mail.drafts.account')}
            value={accountId}
            onChange={(event) => {
              setSelectedIds(new Set())
              onChangeAccount(event.target.value)
            }}
          >
            <option value="all">{t('account.all.name')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.accountId}>
                {account.address}
              </option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox
              aria-label={t('mail.drafts.selectPage')}
              checked={allSelected ? true : selectedMessages.length > 0 ? 'indeterminate' : false}
              disabled={loading || pending || Boolean(error) || messages.length === 0}
              onCheckedChange={(checked) =>
                setSelectedIds(
                  checked === true
                    ? new Set(messages.map((message) => message.outboxId))
                    : new Set()
                )
              }
            />
            {t('mail.drafts.selectPage')}
          </label>
          <span className="text-muted-foreground">
            {t('mail.drafts.selected', { count: selectedMessages.length })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || pending || Boolean(error) || selectedMessages.length === 0}
            onClick={() => setDeleteCandidates(selectedMessages)}
          >
            <Trash2 data-icon="inline-start" />
            {t('mail.drafts.deleteSelected')}
          </Button>
        </div>
        {error ? (
          <p
            role="alert"
            className="shrink-0 break-words border-b px-4 py-3 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        <div aria-busy={loading} className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div role="status" className="p-8 text-center text-xs text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : messages.length === 0 && !error ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-xs text-muted-foreground">
              <FilePenLine className="size-8" />
              {keyword || accountId !== 'all' ? t('mail.drafts.noMatches') : t('mail.drafts.empty')}
            </div>
          ) : !error ? (
            <ul className="divide-y">
              {messages.map((message) => {
                const account = accounts.find((item) => item.accountId === message.accountId)!
                const recipients = [...message.to, ...message.cc, ...message.bcc].join(', ')
                return (
                  <li
                    key={message.outboxId}
                    className="group flex items-center gap-1 px-3 hover:bg-muted/50"
                  >
                    <Checkbox
                      className="mx-1"
                      aria-label={t('mail.drafts.select', {
                        subject: message.subject || t('mail.outbox.noSubject')
                      })}
                      checked={selectedIds.has(message.outboxId)}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(message.outboxId)
                          else next.delete(message.outboxId)
                          return next
                        })
                      }
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => onOpenDraft(message)}
                      className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                    >
                      <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {message.subject || t('mail.outbox.noSubject')}
                        </span>
                        {message.attachments.length > 0 ? (
                          <Paperclip
                            aria-label={t('common.attachment')}
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        ) : null}
                      </span>
                      <span className="w-full truncate text-xs text-muted-foreground">
                        {t('mail.drafts.to')}: {recipients || t('mail.outbox.noRecipients')}
                      </span>
                      <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate" title={account.address}>
                          {t('mail.drafts.from')}: {account.address}
                        </span>
                        <time className="shrink-0" dateTime={message.updatedAt}>
                          {dateFormat.format(new Date(message.updatedAt))}
                        </time>
                      </span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={t('mail.drafts.delete', {
                            subject: message.subject || t('mail.outbox.noSubject')
                          })}
                          disabled={pending}
                          onClick={() => setDeleteCandidates([message])}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('common.delete')}</TooltipContent>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            {t('mail.drafts.range', {
              start: totalCount === 0 ? 0 : offset + 1,
              end: Math.min(offset + pageSize, totalCount),
              total: totalCount
            })}
          </span>
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('mail.drafts.previous')}
                  disabled={loading || pending || offset === 0}
                  onClick={() => {
                    setSelectedIds(new Set())
                    onChangePage(offset - pageSize)
                  }}
                >
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('mail.drafts.previous')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('mail.drafts.next')}
                  disabled={loading || pending || offset + pageSize >= totalCount}
                  onClick={() => {
                    setSelectedIds(new Set())
                    onChangePage(offset + pageSize)
                  }}
                >
                  <ChevronRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('mail.drafts.next')}</TooltipContent>
            </Tooltip>
          </div>
        </footer>
      </TooltipProvider>
      <DeleteDraftDialog
        open={deleteCandidates.length > 0}
        pending={pending}
        subject={deleteCandidates.length === 1 ? deleteCandidates[0].subject : undefined}
        count={deleteCandidates.length}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidates([])
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </section>
  )
}
