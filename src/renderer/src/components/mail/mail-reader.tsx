import {
  Download,
  FileText,
  Forward,
  Image,
  Languages,
  Loader2,
  Paperclip,
  Reply,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import * as React from 'react'

import { formatAbsoluteTime, formatRelativeTime } from '@renderer/components/mail/date-format'
import { EllipsisTooltip } from '@renderer/components/mail/ellipsis-tooltip'
import {
  ATTACHMENT_METADATA_PENDING_SIZE,
  getDisplayAttachmentName,
  getDisplayAttachmentSize,
  getDisplayAttachmentType,
  getDisplayBodyParagraphs,
  getDisplaySender,
  getDisplaySubject
} from '@renderer/components/mail/mail-display'
import { prepareMailHtml, type PreparedMailHtml } from '@renderer/components/mail/mail-html'
import {
  applyHtmlTranslationTemplate,
  createHtmlTranslationTemplate,
  getMessageTranslationText
} from '@renderer/components/mail/mail-translation-text'
import type { Attachment, Message } from '@renderer/components/mail/types'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@renderer/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { translateMail } from '@renderer/lib/api'
import { MAIL_PRIVACY_CHANGED_EVENT, resolveMailPrivacyMode } from '../../../../shared/mail-privacy'
import type { AccountPrivacyPolicy } from '../../../../shared/types'

const REMOTE_IMAGES_HELP_URL = 'https://huzhihui.com/blog/click-load-images-ip-leak-email-tracking'
const MAIL_HTML_PREPARE_DELAY_MS = 40

type PreparedMailHtmlState = {
  messageId: string
  sourceHtml: string
  policyKey: string
  result: PreparedMailHtml
}

type ReaderTranslationState = {
  messageId: string
  open: boolean
  pending: boolean
  translatedText?: string
  translatedHtml?: string
  error?: string
}

type MailReaderProps = {
  message: Message
  recipientAddress: string
  loading?: boolean
  loadingBody?: boolean
  externalImagesBlocked?: boolean
  downloadingAttachmentIds?: Set<number>
  actionPending?: boolean
  deleting?: boolean
  onLoadBody: () => void | Promise<Message | undefined>
  onDownloadAttachment?: (attachment: Attachment) => void
  onReply?: () => void
  onForward?: () => void
  onDelete?: () => void
}

export function MailReader(props: MailReaderProps): React.JSX.Element {
  // A per-message grant (and asynchronous work) must never survive an account/message switch,
  // including switching A → B → A without clicking anything in B.
  return <MailReaderContent key={`${props.message.accountId}:${props.message.id}`} {...props} />
}

function MailReaderContent({
  message,
  recipientAddress,
  loading = false,
  loadingBody = false,
  externalImagesBlocked = true,
  downloadingAttachmentIds,
  actionPending = false,
  deleting = false,
  onLoadBody,
  onDownloadAttachment,
  onReply,
  onForward,
  onDelete
}: MailReaderProps): React.JSX.Element {
  const { locale, t } = useI18n()
  const canShowHtml = Boolean(message.html)
  const hasLoadedBody = message.bodyLoaded || canShowHtml
  const canLoadBody = !hasLoadedBody && !loadingBody
  const [externalContentAllowed, setExternalContentAllowed] = React.useState(false)
  const hasPrivacyApi = typeof window.api?.privacy?.list === 'function'
  const [privacyState, setPrivacyState] = React.useState<{
    policy?: AccountPrivacyPolicy
    pending: boolean
    error?: string
  }>({ pending: hasPrivacyApi })
  const mode = hasPrivacyApi
    ? resolveMailPrivacyMode(message.accountId, message.fromAddress, privacyState.policy)
    : externalImagesBlocked
      ? 'strict'
      : 'unrestricted'
  const policyKey = `${mode}:${externalContentAllowed}`
  const htmlSource = message.html ?? ''

  React.useEffect(() => {
    if (!hasPrivacyApi) return
    let cancelled = false
    let generation = 0
    const load = async (): Promise<void> => {
      const request = ++generation
      setPrivacyState({ pending: true }) // Fail closed while a new policy is being read.
      setExternalContentAllowed(false)
      try {
        const policies = await window.api.privacy.list()
        const policy = policies.find((item) => item.accountId === message.accountId)
        if (!policy) throw new Error('未找到当前邮箱的隐私策略。')
        if (!cancelled && request === generation) setPrivacyState({ policy, pending: false })
      } catch (error) {
        if (!cancelled && request === generation) {
          setPrivacyState({
            pending: false,
            error: error instanceof Error ? error.message : '读取隐私策略失败。'
          })
        }
      }
    }
    void load()
    const refresh = (): void => {
      void load()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener(MAIL_PRIVACY_CHANGED_EVENT, refresh)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
      window.removeEventListener(MAIL_PRIVACY_CHANGED_EVENT, refresh)
    }
  }, [hasPrivacyApi, message.accountId, externalImagesBlocked])
  const [preparedHtmlState, setPreparedHtmlState] = React.useState<PreparedMailHtmlState | null>(
    null
  )
  const preparedHtml =
    canShowHtml &&
    preparedHtmlState?.messageId === message.id &&
    preparedHtmlState.sourceHtml === htmlSource &&
    preparedHtmlState.policyKey === policyKey
      ? preparedHtmlState.result
      : null
  const blockedCount = preparedHtml?.blockedResourceCount ?? 0
  const trackerCount = preparedHtml?.blockedTrackerResourceCount ?? 0
  const autoRemoteContentAllowed = !privacyState.pending && mode !== 'strict'
  const contentIsAllowed = autoRemoteContentAllowed || externalContentAllowed
  const canLoadFullContent =
    canShowHtml &&
    mode === 'strict' &&
    !privacyState.pending &&
    !privacyState.error &&
    !externalContentAllowed &&
    (preparedHtml?.blockedImageResourceCount ?? 0) > 0
  const allowExternalContent = React.useCallback(() => {
    setExternalContentAllowed(true)
  }, [])
  const hasRealAttachments = message.attachments.some(
    (attachment) => attachment.size !== ATTACHMENT_METADATA_PENDING_SIZE
  )
  const displayRecipientAddress = message.to ?? recipientAddress
  const displaySubject = getDisplaySubject(message, t)
  const displaySender = getDisplaySender(message, t)
  const [translationState, setTranslationState] = React.useState<ReaderTranslationState>({
    messageId: message.id,
    open: false,
    pending: false
  })
  const activeTranslation =
    translationState.messageId === message.id
      ? translationState
      : { messageId: message.id, open: false, pending: false }

  React.useEffect(() => {
    if (!canShowHtml) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      const result = prepareMailHtml(htmlSource, {
        mode,
        allowRemoteImages: externalContentAllowed
      })
      if (!cancelled) {
        setPreparedHtmlState({
          messageId: message.id,
          sourceHtml: htmlSource,
          policyKey,
          result
        })
      }
    }, MAIL_HTML_PREPARE_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [canShowHtml, externalContentAllowed, htmlSource, message.id, mode, policyKey])

  async function handleTranslate(): Promise<void> {
    setTranslationState({ messageId: message.id, open: true, pending: true })
    try {
      let sourceMessage = message
      if (!message.bodyLoaded && !message.html) {
        const loadedMessage = await onLoadBody()
        if (!loadedMessage) throw new Error(t('mail.reader.translationLoadError'))
        sourceMessage = loadedMessage
      }
      if (sourceMessage.html?.trim()) {
        const sourceHtml =
          sourceMessage.id === message.id && preparedHtml
            ? preparedHtml.html
            : prepareMailHtml(sourceMessage.html, {
                mode,
                allowRemoteImages: externalContentAllowed
              }).html
        const template = createHtmlTranslationTemplate(sourceHtml)
        if (template.segments.length === 0) throw new Error(t('mail.reader.translationEmpty'))
        const result = await translateMail({ segments: template.segments })
        if (!result.translatedSegments) throw new Error(t('mail.reader.translationError'))
        setTranslationState({
          messageId: message.id,
          open: true,
          pending: false,
          translatedText: result.translatedText,
          translatedHtml: applyHtmlTranslationTemplate(template, result.translatedSegments)
        })
        return
      }

      const text = getMessageTranslationText(sourceMessage)
      if (!text) throw new Error(t('mail.reader.translationEmpty'))
      const result = await translateMail({ text })
      setTranslationState({
        messageId: message.id,
        open: true,
        pending: false,
        translatedText: result.translatedText
      })
    } catch (translationError) {
      setTranslationState({
        messageId: message.id,
        open: true,
        pending: false,
        error:
          translationError instanceof Error
            ? translationError.message
            : t('mail.reader.translationError')
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {privacyState.error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive"
        >
          隐私策略异常：{privacyState.error}（已阻止远程内容）
        </div>
      ) : null}
      {canShowHtml ? (
        <header className="app-drag-region flex h-10 shrink-0 items-center gap-3 border-b bg-card/60 px-4 text-xs">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {contentIsAllowed
                ? trackerCount > 0
                  ? `已加载图片，已拦截 ${trackerCount} 个疑似跟踪器（启发式检测）`
                  : t('mail.reader.safeFull')
                : canLoadFullContent
                  ? t('mail.reader.safeBlocked', { count: blockedCount })
                  : trackerCount > 0
                    ? `已拦截 ${trackerCount} 个疑似跟踪器（启发式检测）`
                    : t('mail.reader.safePreview')}
            </span>
          </div>
          <div className="app-no-drag flex shrink-0 items-center gap-2">
            {loadingBody ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                {t('mail.reader.loadingBody')}
              </Button>
            ) : canLoadFullContent ? (
              <>
                <RemoteImagesHelpLink />
                <Button size="sm" variant="outline" onClick={allowExternalContent}>
                  <Image data-icon="inline-start" />
                  {t('mail.reader.loadFullContent')}
                </Button>
              </>
            ) : !hasLoadedBody && message.bodyStatus === 'error' ? (
              <Button size="sm" variant="outline" onClick={onLoadBody}>
                {loadingBody ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FileText data-icon="inline-start" />
                )}
                {t('mail.reader.retryLoadBody')}
              </Button>
            ) : null}
          </div>
        </header>
      ) : null}

      <article className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="shrink-0 border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold leading-snug tracking-normal">
                {displaySubject}
              </h2>
              <TooltipProvider>
                <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  <MetaLine
                    label={t('mail.reader.from')}
                    value={formatAddress(displaySender, message.fromAddress)}
                  />
                  <MetaLine label={t('mail.reader.to')} value={displayRecipientAddress} />
                  {message.cc ? <MetaLine label={t('mail.reader.cc')} value={message.cc} /> : null}
                </div>
              </TooltipProvider>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div
                className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                title={formatAbsoluteTime(message.receivedAt)}
              >
                {formatRelativeTime(message.receivedAt, locale)}
              </div>
              <TooltipProvider>
                <div className="flex items-center gap-1">
                  <MailActionButton
                    label={t('mail.reader.reply')}
                    disabled={actionPending}
                    onClick={onReply}
                  >
                    {actionPending ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Reply aria-hidden="true" />
                    )}
                  </MailActionButton>
                  <MailActionButton
                    label={t('mail.reader.forward')}
                    disabled={actionPending}
                    onClick={onForward}
                  >
                    {actionPending ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Forward aria-hidden="true" />
                    )}
                  </MailActionButton>
                  <MailActionButton
                    label={t('common.delete')}
                    disabled={deleting}
                    onClick={onDelete}
                  >
                    {deleting ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 aria-hidden="true" />
                    )}
                  </MailActionButton>
                </div>
              </TooltipProvider>
            </div>
          </div>
        </section>

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto px-5 pt-4 pb-16">
            {loading && !message.detailLoaded ? (
              <section className="text-xs text-muted-foreground">
                {t('mail.reader.loadingDetails')}
              </section>
            ) : activeTranslation.open ? (
              <TranslatedMessageBody
                message={message}
                canShowHtml={canShowHtml}
                canLoadBody={canLoadBody}
                loadingBody={loadingBody}
                preparedHtml={preparedHtml}
                translation={activeTranslation}
                t={t}
                onLoadBody={onLoadBody}
                onClose={() =>
                  setTranslationState({ messageId: message.id, open: false, pending: false })
                }
              />
            ) : (
              <MessageBody
                message={message}
                canShowHtml={canShowHtml}
                canLoadBody={canLoadBody}
                loadingBody={loadingBody}
                preparedHtml={preparedHtml}
                t={t}
                onLoadBody={onLoadBody}
              />
            )}
          </div>

          <div className="pointer-events-none absolute right-5 bottom-4 z-10 flex justify-end">
            <Button
              className="pointer-events-auto shadow-md"
              size="sm"
              disabled={activeTranslation.pending || loadingBody}
              onClick={() => void handleTranslate()}
            >
              {activeTranslation.pending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Languages data-icon="inline-start" />
              )}
              {activeTranslation.open
                ? t('mail.reader.translateAgain')
                : t('mail.reader.translate')}
            </Button>
          </div>
        </div>

        {hasRealAttachments ? (
          <AttachmentList
            attachments={message.attachments}
            downloadingAttachmentIds={downloadingAttachmentIds}
            t={t}
            onDownloadAttachment={onDownloadAttachment}
          />
        ) : null}
      </article>
    </div>
  )
}

function MailActionButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function RemoteImagesHelpLink(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={REMOTE_IMAGES_HELP_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('mail.reader.remoteHelp')}
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-72 whitespace-normal leading-5">
          {t('mail.reader.remoteHelpTooltip')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function MessageBody({
  message,
  canShowHtml,
  canLoadBody,
  loadingBody,
  preparedHtml,
  t,
  onLoadBody
}: {
  message: Message
  canShowHtml: boolean
  canLoadBody: boolean
  loadingBody: boolean
  preparedHtml: PreparedMailHtml | null
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  onLoadBody: () => void | Promise<Message | undefined>
}): React.JSX.Element {
  if (!canShowHtml && loadingBody) {
    return <MessageBodySkeleton />
  }

  if (canShowHtml && !preparedHtml) {
    return <MessageBodySkeleton />
  }

  if (!canShowHtml && !message.bodyLoaded) {
    return (
      <section
        role="button"
        tabIndex={0}
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border bg-card p-5 text-center text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          if (canLoadBody) onLoadBody()
        }}
        onKeyDown={(event) => {
          if (!canLoadBody || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          onLoadBody()
        }}
      >
        <FileText aria-hidden="true" />
        <span>
          {message.bodyStatus === 'error'
            ? t('mail.reader.bodyErrorRetry')
            : t('mail.reader.bodyClickLoad')}
        </span>
      </section>
    )
  }

  return (
    <section className="prose-mail flex min-w-0 flex-col select-text text-sm text-foreground">
      {canShowHtml ? (
        <div
          className="mail-html min-h-40 select-text bg-background"
          dangerouslySetInnerHTML={{ __html: preparedHtml?.html ?? '' }}
        />
      ) : (
        <div className="mail-text min-h-40 w-full max-w-full select-text">
          {getDisplayBodyParagraphs(message, t).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      )}
    </section>
  )
}

function TranslatedMessageBody({
  message,
  canShowHtml,
  canLoadBody,
  loadingBody,
  preparedHtml,
  translation,
  t,
  onLoadBody,
  onClose
}: {
  message: Message
  canShowHtml: boolean
  canLoadBody: boolean
  loadingBody: boolean
  preparedHtml: PreparedMailHtml | null
  translation: ReaderTranslationState
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  onLoadBody: () => void | Promise<Message | undefined>
  onClose: () => void
}): React.JSX.Element {
  return (
    <section className="grid min-h-64 overflow-hidden border-y md:grid-cols-2 md:divide-x">
      <div className="min-w-0 border-b md:border-b-0">
        <div className="flex h-9 items-center border-b bg-muted/40 px-3 text-xs font-medium">
          {t('mail.reader.original')}
        </div>
        <div className="min-h-48 overflow-auto p-3">
          <MessageBody
            message={message}
            canShowHtml={canShowHtml}
            canLoadBody={canLoadBody}
            loadingBody={loadingBody}
            preparedHtml={preparedHtml}
            t={t}
            onLoadBody={onLoadBody}
          />
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex h-9 items-center justify-between gap-2 border-b bg-muted/40 px-3 text-xs font-medium">
          <span>{t('mail.reader.translation')}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="min-h-48 overflow-auto p-3">
          {translation.pending ? (
            <MessageBodySkeleton />
          ) : translation.error ? (
            <div className="flex min-h-40 items-center justify-center text-center text-xs text-destructive">
              {translation.error}
            </div>
          ) : translation.translatedHtml ? (
            <div
              className="mail-html min-h-40 select-text bg-background"
              dangerouslySetInnerHTML={{ __html: translation.translatedHtml }}
            />
          ) : (
            <div className="mail-text min-h-40 whitespace-pre-wrap text-sm leading-6 select-text">
              {translation.translatedText}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function MessageBodySkeleton(): React.JSX.Element {
  return (
    <section className="flex min-h-40 flex-col gap-4 rounded-md border bg-card p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-44 max-w-full" />
          <Skeleton className="h-3 w-28 max-w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[86%]" />
        <Skeleton className="h-3 w-[74%]" />
      </div>
      <div className="flex flex-col gap-2.5 pt-2">
        <Skeleton className="h-3 w-[96%]" />
        <Skeleton className="h-3 w-[88%]" />
        <Skeleton className="h-3 w-[64%]" />
      </div>
    </section>
  )
}

function AttachmentList({
  attachments,
  downloadingAttachmentIds,
  t,
  onDownloadAttachment
}: {
  attachments: Message['attachments']
  downloadingAttachmentIds?: Set<number>
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  onDownloadAttachment?: (attachment: Attachment) => void
}): React.JSX.Element {
  return (
    <section className="shrink-0 border-t bg-background px-5 py-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
        <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
        {t('mail.reader.attachments')}
      </div>
      <div className="overflow-hidden rounded-md border bg-card">
        <Table className="text-[12px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 min-w-56 text-[12px]">
                {t('mail.reader.attachmentFileName')}
              </TableHead>
              <TableHead className="h-8 w-24 text-right text-[12px]">
                {t('mail.reader.attachmentAction')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attachments.map((attachment) => {
              const isDownloading =
                attachment.id !== undefined && downloadingAttachmentIds?.has(attachment.id)
              const canDownload = Boolean(attachment.id && onDownloadAttachment && !isDownloading)
              const attachmentName = getDisplayAttachmentName(attachment, t)
              const attachmentSize = getDisplayAttachmentSize(attachment, t)
              const attachmentType = getDisplayAttachmentType(attachment, t)

              return (
                <TableRow
                  key={attachment.id ?? attachment.name}
                  className={canDownload ? 'cursor-pointer' : undefined}
                  onClick={() => {
                    if (canDownload) onDownloadAttachment?.(attachment)
                  }}
                >
                  <TableCell className="max-w-0 py-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium leading-4">{attachmentName}</span>
                      <span className="truncate leading-4 text-muted-foreground">
                        {attachmentSize} · {attachmentType}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="w-24 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canDownload}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (canDownload) onDownloadAttachment?.(attachment)
                      }}
                    >
                      {isDownloading ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : (
                        <Download data-icon="inline-start" />
                      )}
                      {t('common.download')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function MetaLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-baseline ">
      <span>{label}:</span>
      <EllipsisTooltip alwaysShow className="min-w-0 truncate text-foreground" tooltip={value}>
        {value}
      </EllipsisTooltip>
    </div>
  )
}

function formatAddress(name: string, email?: string): string {
  return email ? `${name} <${email}>` : name
}
