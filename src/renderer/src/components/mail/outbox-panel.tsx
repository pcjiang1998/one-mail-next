import * as React from 'react'
import { MailWarning, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import type { OutboxMessage } from '@renderer/lib/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'

type OutboxPanelProps = {
  pending?: boolean
  loading?: boolean
  error?: string | null
  outboxMessages: OutboxMessage[]
  onRefresh: () => void
  onRetry: (message: OutboxMessage) => void
  onDelete: (message: OutboxMessage) => Promise<void>
  onClear: (status: 'sent' | 'failed') => Promise<boolean>
}

export function OutboxPanel({
  pending = false,
  loading = false,
  error,
  outboxMessages,
  onRefresh,
  onRetry,
  onDelete,
  onClear
}: OutboxPanelProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const refresh = React.useEffectEvent(onRefresh)
  const [clearStatus, setClearStatus] = React.useState<'sent' | 'failed' | null>(null)
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  React.useEffect(() => {
    refresh()
  }, [])

  return (
    <section aria-label={t('mail.outbox.title')} className="flex h-full min-h-0 min-w-0 flex-col">
      <TooltipProvider>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <MailWarning className="size-4 shrink-0 text-muted-foreground" />
            {t('mail.outbox.title')}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || loading}
              onClick={() => setClearStatus('sent')}
            >
              <Trash2 data-icon="inline-start" />
              {t('mail.outbox.clearSent')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending || loading}
              onClick={() => setClearStatus('failed')}
            >
              <Trash2 data-icon="inline-start" />
              {t('mail.outbox.clearFailed')}
            </Button>
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
          </div>
        </header>
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
          ) : error ? null : outboxMessages.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
              <MailWarning className="size-8" />
              {t('mail.outbox.empty')}
            </div>
          ) : (
            <ul className="divide-y">
              {outboxMessages.map((message) => (
                <li key={message.outboxId} className="flex min-w-0 flex-col gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-medium">
                      {message.subject || t('mail.outbox.noSubject')}
                    </span>
                    <Badge
                      className="shrink-0"
                      variant={message.status === 'failed' ? 'destructive' : 'outline'}
                    >
                      {getStatusLabel(message.status, t)}
                    </Badge>
                  </div>
                  <div className="break-words text-xs text-muted-foreground">
                    {message.to.length > 0 ? message.to.join(', ') : t('mail.outbox.noRecipients')}
                  </div>
                  {message.lastError ? (
                    <p className="break-words text-xs text-destructive">{message.lastError}</p>
                  ) : null}
                  {message.lastWarning ? (
                    <p className="break-words text-xs text-muted-foreground">
                      {message.lastWarning}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <time className="text-xs text-muted-foreground" dateTime={message.updatedAt}>
                      {dateFormat.format(new Date(message.updatedAt))}
                    </time>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {message.status === 'failed' ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon-sm"
                              aria-label={t('common.retry')}
                              disabled={pending}
                              onClick={() => onRetry(message)}
                            >
                              <RotateCcw />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('common.retry')}</TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={t('common.delete')}
                            disabled={pending || message.status === 'sending'}
                            onClick={() => {
                              void onDelete(message)
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('common.delete')}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </TooltipProvider>
      <AlertDialog
        open={clearStatus !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setClearStatus(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                clearStatus === 'sent'
                  ? 'mail.outbox.clearSentTitle'
                  : 'mail.outbox.clearFailedTitle'
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('mail.outbox.clearDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={async (event) => {
                event.preventDefault()
                if (clearStatus && (await onClear(clearStatus))) setClearStatus(null)
              }}
            >
              {pending ? t('common.deleting') : t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function getStatusLabel(
  status: OutboxMessage['status'],
  t: (key: TranslationKey) => string
): string {
  if (status === 'queued') return t('mail.outbox.statusQueued')
  if (status === 'failed') return t('mail.outbox.statusFailed')
  if (status === 'sending') return t('mail.outbox.statusSending')
  return status
}
