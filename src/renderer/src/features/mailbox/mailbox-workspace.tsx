import * as React from 'react'
import { useNavigate, useParams } from 'react-router'
import { AccountList } from '@renderer/components/account/account-list'
import { AccountWarningDialog } from '@renderer/components/account/account-warning-dialog'
import { EditAccountDialog } from '@renderer/components/account/edit-account-dialog'
import { OutlookImapHelpDialog } from '@renderer/components/account/outlook-imap-help-dialog'
import { RemoveAccountDialog } from '@renderer/components/account/remove-account-dialog'
import { DeleteMessageDialog } from '@renderer/components/mail/delete-message-dialog'
import { AddTaskDialog } from '@renderer/components/mail/add-task-dialog'
import { MailComposer } from '@renderer/components/mail/mail-composer'
import { MailList } from '@renderer/components/mail/mail-list'
import { MailReader } from '@renderer/components/mail/mail-reader'
import { OutboxPanel } from '@renderer/components/mail/outbox-panel'
import { DraftList } from '@renderer/components/mail/draft-list'
import {
  BackupImportDialog,
  type BackupImportDialogSource
} from '@renderer/components/backup/backup-import-dialog'
import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'
import { SettingsDialog, type SettingsSection } from '@renderer/components/settings/settings-dialog'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResizablePrimitive
} from '@renderer/components/ui/resizable'
import type {
  AccountUpdateInput,
  AppSettings,
  AppUpdateStatus,
  BackupImportSource,
  BackupImportResult,
  BackupSyncDownloadResult,
  SettingsUpdateInput,
  SystemInfo
} from '../../../../shared/types'
import {
  deleteDraftMessage,
  deleteDraftMessages,
  clearOutboxMessages,
  deleteOutboxMessage,
  getAppUpdateStatus,
  loadAccounts,
  loadInitialData,
  loadMessageDetail,
  loadMessages,
  loadOutboxMessages,
  MESSAGE_LIST_PAGE_SIZE,
  onAccountCreated,
  onAppUpdateStatus,
  onMailboxChanged,
  openAddAccountWindow,
  reauthorizeAccount,
  removeAccount,
  removeAccounts,
  retryOutboxMessage,
  reorderAccounts,
  parseMailboxSelection,
  saveSettings,
  syncAllAccounts,
  syncAccount,
  toMessageQuery,
  updateAccount
} from '@renderer/lib/api'
import { normalizeLocale, useI18n } from '@renderer/lib/i18n'
import { applyAppTheme } from '@renderer/lib/theme'
import type { OutboxMessage } from '@renderer/lib/api'
import { toast } from 'sonner'
import { NoAccountsBody, StatusBar, TitleBar } from './mailbox-chrome'
import {
  createOutlookHelpAccount,
  getErrorMessage,
  getFallbackAccount,
  getNextSelectedAccountId,
  shouldEditCredential,
  shouldShowOutlookImapHelp
} from './mailbox-utils'
import { useMailboxMessages } from './use-mailbox-messages'
import { useMailComposer } from './use-mail-composer'
import { useMessageActions } from './use-message-actions'
import { useMessageSelection } from './use-message-selection'
import { useSyncFeedback } from './use-sync-feedback'
import { useWritebackStatus } from './use-writeback-status'
import { DRAFT_PAGE_SIZE, useLocalDrafts } from './use-local-drafts'

export type DialogKind = 'edit' | 'delete' | 'settings' | null

function normalizeRouteId(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  return decodeURIComponent(text)
}

function formatImportResultMessage(
  result: BackupImportResult | BackupSyncDownloadResult,
  source: BackupImportSource,
  t: ReturnType<typeof useI18n>['t']
): string {
  return t(
    source === 'local'
      ? 'settings.backup.importedSummary'
      : 'settings.backup.remoteDownloadedSummary',
    {
      accounts: result.accountCount ?? 0,
      messages: result.messageCount ?? 0
    }
  )
}

export function MailboxWorkspace({
  initialSettingsSection
}: {
  initialSettingsSection?: SettingsSection
}): React.JSX.Element {
  const navigate = useNavigate()
  const routeParams = useParams<{ accountId?: string; messageId?: string }>()
  const { setLocale, t } = useI18n()
  const internalRouteRef = React.useRef<string | null>(null)
  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [settings, setSettings] = React.useState<AppSettings | null>(null)
  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null)
  const [updateStatus, setUpdateStatus] = React.useState<AppUpdateStatus | null>(null)
  const [selectedAccountId, setSelectedAccountId] = React.useState('all')
  const [filters, setFilters] = React.useState<MailFilterTag[]>([])
  const [searchKeyword, setSearchKeyword] = React.useState('')
  const [dialogKind, setDialogKind] = React.useState<DialogKind>(
    initialSettingsSection ? 'settings' : null
  )
  const [backupImportDialogOpen, setBackupImportDialogOpen] = React.useState(false)
  const [backupImportSource, setBackupImportSource] =
    React.useState<BackupImportDialogSource>('sql')
  const [backupImportBusy, setBackupImportBusy] = React.useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = React.useState<SettingsSection>(
    initialSettingsSection ?? 'general'
  )
  const [dialogAccountId, setDialogAccountId] = React.useState<string | null>(null)
  const [warningAccountId, setWarningAccountId] = React.useState<string | null>(null)
  const [workspaceView, setWorkspaceView] = React.useState<'mail' | 'drafts' | 'outbox'>('mail')
  const draftsOpen = workspaceView === 'drafts'
  const outboxOpen = workspaceView === 'outbox'
  const [outboxMessages, setOutboxMessages] = React.useState<OutboxMessage[]>([])
  const [outboxPending, setOutboxPending] = React.useState(false)
  const [outboxLoading, setOutboxLoading] = React.useState(true)
  const [outboxError, setOutboxError] = React.useState<string | null>(null)
  const outboxRequestRef = React.useRef(0)
  const [taskMessage, setTaskMessage] = React.useState<Message | null>(null)
  const [outlookImapHelpAccount, setOutlookImapHelpAccount] = React.useState<Account | null>(null)
  const { syncingAccountIds, syncNotice, startSyncing, finishSyncing, setNotice, clearSyncing } =
    useSyncFeedback()
  const {
    status: writebackStatus,
    clear: clearWriteback,
    clearCompleted: clearCompletedWritebacks,
    retry: retryWriteback
  } = useWritebackStatus()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const selectedMailbox = parseMailboxSelection(selectedAccountId)
  const refreshAccounts = React.useCallback(async () => {
    const nextAccounts = await loadAccounts()
    setAccounts(nextAccounts)
  }, [])
  const {
    messages,
    selectedMessage,
    selectedMessageId,
    messagePage,
    loadingMessageId,
    loadingBodyMessageId,
    downloadingAttachmentIds,
    markingRead,
    replaceMessages,
    clearMessages,
    removeMessages,
    refreshMessages,
    selectMessage,
    markMessagesRead,
    markCurrentQueryRead,
    loadMoreMessages,
    loadMessageBody,
    downloadMessageAttachment
  } = useMailboxMessages({
    selectedAccountId,
    filters,
    searchKeyword,
    loading,
    setAccounts,
    setError
  })
  const selectionScopeKey = React.useMemo(
    () => `${selectedAccountId}:${filters.join(',')}:${searchKeyword}`,
    [filters, searchKeyword, selectedAccountId]
  )
  const {
    selectedMessageIds,
    selectedMessages,
    allVisibleSelected,
    someVisibleSelected,
    clearSelection,
    selectAllVisible,
    toggleMessageSelection,
    selectMessageForContext
  } = useMessageSelection({ messages, resetKey: selectionScopeKey })
  const {
    deleteRequest,
    deletingMessageIds,
    deleting,
    requestDeleteMessages,
    cancelDelete,
    confirmDelete
  } = useMessageActions({
    removeMessages,
    clearSelection,
    setError,
    localDeletedOnly: selectedMailbox.localDeletedOnly === true,
    onDeleted: refreshAccounts
  })
  const mainLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-main-layout',
    panelIds: ['accounts', 'messages', 'reader']
  })
  const draftsLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-drafts-layout',
    panelIds: ['accounts', 'drafts']
  })
  const outboxLayout = ResizablePrimitive.useDefaultLayout({
    id: 'onemail-outbox-layout',
    panelIds: ['accounts', 'outbox']
  })
  const activeLayout = draftsOpen ? draftsLayout : outboxOpen ? outboxLayout : mainLayout

  const dialogAccount =
    accounts.find((account) => account.id === dialogAccountId) ??
    accounts.find((account) => account.id === selectedAccountId)
  const warningAccount =
    accounts.find((account) => account.id === warningAccountId) ??
    (warningAccountId ? null : undefined)
  const realAccounts = accounts.filter((account) => Boolean(account.accountId))
  const hasAccounts = realAccounts.length > 0
  const drafts = useLocalDrafts(realAccounts.map((account) => account.id).join(','), !loading)
  const refreshDrafts = drafts.refresh
  const selectedAccount =
    accounts.find((account) => account.accountId === selectedMailbox.accountId) ??
    accounts.find((account) => account.id === selectedAccountId) ??
    accounts[0] ??
    getFallbackAccount()
  const selectedMailboxUnread = selectedMailbox.folderId
    ? (selectedAccount.folders?.find((folder) => folder.folderId === selectedMailbox.folderId)
        ?.unreadCount ?? messages.filter((message) => message.unread).length)
    : selectedMailbox.localDeletedOnly
      ? messages.filter((message) => message.unread).length
      : selectedAccount.unread
  const selectedMessageAccount = selectedMessage
    ? accounts.find((account) => account.accountId === selectedMessage.accountId)
    : undefined
  const showNoAccounts = !loading && !hasAccounts
  const {
    composerOpen,
    composerDraft,
    composerPending,
    openComposer,
    openForwardMessages,
    openOutboxDraft,
    closeComposer,
    sendComposerDraft,
    saveComposerDraft,
    discardComposerDraft
  } = useMailComposer({
    accounts,
    selectedAccount,
    defaultComposeAccountId: settings?.defaultComposeAccountId ?? null,
    setError
  })
  const routeAccountId = normalizeRouteId(routeParams.accountId)
  const routeMessageId = normalizeRouteId(routeParams.messageId)

  const refreshOutbox = React.useCallback(async (): Promise<void> => {
    const requestId = ++outboxRequestRef.current
    setOutboxLoading(true)
    setOutboxError(null)
    try {
      const messages = await loadOutboxMessages()
      if (requestId === outboxRequestRef.current) setOutboxMessages(messages)
    } catch (refreshError) {
      if (requestId === outboxRequestRef.current) {
        setOutboxError(getErrorMessage(refreshError, t('mailbox.loadOutboxError')))
      }
    } finally {
      if (requestId === outboxRequestRef.current) setOutboxLoading(false)
    }
  }, [t])

  const handleRefreshOutbox = React.useCallback((): void => {
    void refreshOutbox()
  }, [refreshOutbox])

  const refreshVisibleMailbox = React.useCallback(
    async (changedAccountId: number): Promise<void> => {
      const currentAccountId = selectedAccountId
      const mailboxAccountId = parseMailboxSelection(currentAccountId).accountId
      const shouldRefreshMessages =
        currentAccountId === 'all' || mailboxAccountId === changedAccountId

      const refreshedAccounts = loadAccounts()
      const refreshedMessages = shouldRefreshMessages
        ? loadMessages(
            toMessageQuery(
              currentAccountId,
              filters,
              { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 },
              searchKeyword
            )
          )
        : Promise.resolve<Message[] | null>(null)
      const [nextAccounts, nextMessages] = await Promise.all([refreshedAccounts, refreshedMessages])

      setAccounts(nextAccounts)

      if (nextMessages) {
        replaceMessages(nextMessages)
      }
    },
    [filters, replaceMessages, searchKeyword, selectedAccountId]
  )

  const reloadInitialData = React.useCallback(async () => {
    const data = await loadInitialData()
    setAccounts(data.accounts)
    setSettings(data.settings)
    setLocale(normalizeLocale(data.settings.locale))
    applyAppTheme(data.settings.theme)
    setSystemInfo(data.systemInfo)
    setSelectedAccountId(data.selectedAccountId)
    setFilters([])
    setSearchKeyword('')
    clearSelection()
    replaceMessages(data.messages, { selectFirst: true })
    refreshDrafts()
  }, [clearSelection, refreshDrafts, replaceMessages, setLocale])

  React.useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        setLoading(true)
        setError(null)
        const data = await loadInitialData()
        if (cancelled) return
        setAccounts(data.accounts)
        setSettings(data.settings)
        setLocale(normalizeLocale(data.settings.locale))
        applyAppTheme(data.settings.theme)
        setSystemInfo(data.systemInfo)
        setSelectedAccountId(data.selectedAccountId)
        replaceMessages(data.messages, { selectFirst: true })
      } catch (loadError) {
        if (!cancelled) {
          setError(getErrorMessage(loadError, t('mailbox.loadDataError')))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [replaceMessages, setLocale, t])

  React.useEffect(() => {
    return onMailboxChanged((event) => {
      void refreshVisibleMailbox(event.accountId).catch((refreshError) => {
        setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
      })
    })
  }, [refreshVisibleMailbox, t])

  React.useEffect(() => {
    let cancelled = false

    void getAppUpdateStatus()
      .then((status) => {
        if (!cancelled) setUpdateStatus(status)
      })
      .catch(() => undefined)

    const off = onAppUpdateStatus((status) => {
      setUpdateStatus(status)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  const openRouteTarget = React.useCallback(
    async (accountId: string, messageId?: string): Promise<void> => {
      setWorkspaceView('mail')
      setError(null)
      setSelectedAccountId(accountId)
      setFilters([])
      setSearchKeyword('')

      const nextMessages = await loadMessages(
        toMessageQuery(accountId, [], { limit: MESSAGE_LIST_PAGE_SIZE, offset: 0 }, '')
      )
      const numericMessageId = messageId ? Number(messageId) : undefined
      const targetMessage =
        numericMessageId !== undefined && Number.isFinite(numericMessageId)
          ? (nextMessages.find((message) => message.messageId === numericMessageId) ??
            (await loadMessageDetail(numericMessageId)))
          : nextMessages[0]
      const visibleMessages =
        targetMessage && !nextMessages.some((message) => message.id === targetMessage.id)
          ? [targetMessage, ...nextMessages]
          : nextMessages

      replaceMessages(visibleMessages)
      if (targetMessage) {
        window.setTimeout(() => selectMessage(targetMessage.id), 0)
      }
    },
    [replaceMessages, selectMessage]
  )

  React.useEffect(() => {
    if (loading || !routeAccountId || !routeMessageId) return
    const currentRoute = toMailboxRoute(routeAccountId, routeMessageId)
    if (internalRouteRef.current === currentRoute) {
      internalRouteRef.current = null
      return
    }
    void openRouteTarget(routeAccountId, routeMessageId).catch((openError) => {
      setError(getErrorMessage(openError, t('mailbox.openRouteError')))
    })
  }, [loading, openRouteTarget, routeAccountId, routeMessageId, t])

  React.useEffect(() => {
    if (initialSettingsSection || (routeAccountId && routeMessageId)) return
    internalRouteRef.current = '/'
    navigate('/', { replace: true })
  }, [initialSettingsSection, navigate, routeAccountId, routeMessageId])

  const syncCreatedAccountInBackground = React.useCallback(
    (accountId: number, accountEmail: string, startedAt: Date): void => {
      const accountKey = String(accountId)
      startSyncing(accountKey, {
        label: accountEmail,
        startedAt,
        message: t('mailbox.accountSavedSyncing', { email: accountEmail })
      })

      void syncAccount(accountId, 'initial')
        .then(async (syncResult) => {
          await refreshAccounts()
          await refreshMessages(String(accountId), filters, searchKeyword)
          finishSyncing(accountKey, 'success', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.initialSyncComplete', {
              email: accountEmail,
              inserted: syncResult.insertedCount,
              scanned: syncResult.scannedCount
            })
          })
        })
        .catch((syncError) => {
          const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
          const account = accounts.find((item) => item.accountId === accountId)
          if (shouldShowOutlookImapHelp(message, account)) {
            setOutlookImapHelpAccount(account ?? createOutlookHelpAccount(accountId, accountEmail))
          }
          setError(message)
          finishSyncing(accountKey, 'error', {
            label: accountEmail,
            startedAt,
            message: t('mailbox.backgroundSyncFailed', { email: accountEmail, message })
          })
        })
    },
    [
      accounts,
      filters,
      finishSyncing,
      refreshAccounts,
      refreshMessages,
      searchKeyword,
      startSyncing,
      t
    ]
  )

  React.useEffect(() => {
    return onAccountCreated((event) => {
      const startedAt = new Date()
      const nextSelectedAccountId = String(event.account.accountId)

      setError(null)
      void loadAccounts()
        .then(async (nextAccounts) => {
          setAccounts(nextAccounts)
          setSelectedAccountId(nextSelectedAccountId)
          await refreshMessages(nextSelectedAccountId, filters, searchKeyword, {
            selectFirst: true
          })
        })
        .catch((refreshError) => {
          setError(getErrorMessage(refreshError, t('mailbox.refreshAccountError')))
        })

      if (event.requestedSync) {
        syncCreatedAccountInBackground(event.account.accountId, event.account.email, startedAt)
      } else {
        setNotice({
          state: 'success',
          label: event.account.email,
          startedAt,
          finishedAt: new Date(),
          message: t('mailbox.accountSaved', { email: event.account.email })
        })
      }
    })
  }, [filters, refreshMessages, searchKeyword, setNotice, syncCreatedAccountInBackground, t])

  function handleOpenAddAccountWindow(): void {
    void openAddAccountWindow().catch((openError) => {
      setError(getErrorMessage(openError, t('mailbox.openAddAccountWindowError')))
    })
  }

  async function handleUpdateAccount(input: AccountUpdateInput): Promise<void> {
    setError(null)
    const account = await updateAccount(input)
    if (input.password || input.selectedFolderPaths) {
      const startedAt = new Date()
      startSyncing(String(account.accountId), {
        label: account.email,
        startedAt,
        message: t('mailbox.syncingAccount', { account: account.email })
      })
      try {
        await syncAccount(account.accountId, input.selectedFolderPaths ? 'initial' : 'refresh')
        finishSyncing(String(account.accountId), 'success', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncComplete', { account: account.email })
        })
      } catch (syncError) {
        const message = getErrorMessage(syncError, t('mailbox.syncAccountError'))
        finishSyncing(String(account.accountId), 'error', {
          label: account.email,
          startedAt,
          message: t('mailbox.accountSyncFailed', { account: account.email, message })
        })
        throw syncError
      }
    }
    await refreshAccounts()
    await refreshMessages(String(account.accountId), filters, searchKeyword)
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleRemoveAccount(account: Account): Promise<void> {
    if (!account.accountId) return
    setError(null)
    await removeAccount(account.accountId)
    if (drafts.query.accountId === String(account.accountId))
      drafts.changeQuery({ accountId: 'all' })
    setSettings(await saveSettings({}))
    const nextAccounts = await loadAccounts()
    const nextSelectedAccountId = getNextSelectedAccountId(
      nextAccounts,
      account.id,
      selectedAccountId
    )
    setAccounts(nextAccounts)
    if (
      selectedAccountId === account.id ||
      !nextAccounts.some((item) => item.id === selectedAccountId)
    ) {
      setSelectedAccountId(nextSelectedAccountId)
      if (nextSelectedAccountId) {
        await refreshMessages(nextSelectedAccountId, filters, searchKeyword)
      } else {
        clearMessages()
      }
    }
    setDialogKind(null)
    setDialogAccountId(null)
  }

  async function handleRemoveManagedAccounts(accountIds: number[]): Promise<void> {
    await removeAccounts(accountIds)
    if (accountIds.includes(Number(drafts.query.accountId)))
      drafts.changeQuery({ accountId: 'all' })
    await reloadInitialData()
  }

  async function handleReorderManagedAccounts(accountIds: number[]): Promise<void> {
    await reorderAccounts(accountIds)
    await refreshAccounts()
  }

  async function handleReauthorizeAccount(account: Account): Promise<void> {
    if (!account.accountId) return

    const startedAt = new Date()
    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: t('mailbox.reauthorizing', { account: account.name })
    })
    setError(null)

    try {
      const authorizedAccount = await reauthorizeAccount(account.accountId)
      await refreshAccounts()
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorized', { account: account.name })
      })
      await handleRefreshAccount({
        ...account,
        status: authorizedAccount.status,
        credentialState: authorizedAccount.credentialState,
        lastError: authorizedAccount.lastError
      })
    } catch (reauthorizeError) {
      const message = getErrorMessage(reauthorizeError, t('mailbox.reauthorizeError'))
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message: t('mailbox.reauthorizeFailed', { account: account.name, message })
      })
      throw reauthorizeError
    }
  }

  async function handleRefreshAccount(account: Account): Promise<void> {
    const startedAt = new Date()
    const syncMessage =
      account.id === 'all'
        ? t('mailbox.syncingAll')
        : t('mailbox.syncingAccount', { account: account.name })

    startSyncing(account.id, {
      label: account.name,
      startedAt,
      message: syncMessage
    })
    setError(null)

    try {
      if (account.accountId) {
        await syncAccount(account.accountId)
      } else if (account.id === 'all') {
        await syncAllAccounts()
      } else {
        return
      }
      await refreshAccounts()
      await refreshMessages(selectedAccountId, filters, searchKeyword)
      finishSyncing(account.id, 'success', {
        label: account.name,
        startedAt,
        message:
          account.id === 'all'
            ? t('mailbox.allSyncComplete')
            : t('mailbox.accountSyncComplete', { account: account.name })
      })
    } catch (refreshError) {
      const message = getErrorMessage(refreshError, t('mailbox.refreshAccountError'))
      if (shouldShowOutlookImapHelp(message, account)) {
        setOutlookImapHelpAccount(account)
      }
      if (shouldEditCredential(message)) {
        setDialogAccountId(account.id)
        setDialogKind('edit')
      }
      setError(message)
      finishSyncing(account.id, 'error', {
        label: account.name,
        startedAt,
        message:
          account.id === 'all'
            ? t('mailbox.allSyncFailed', { message })
            : t('mailbox.accountSyncFailed', { account: account.name, message })
      })
    } finally {
      clearSyncing(account.id)
    }
  }

  async function handleUpdateSettings(input: SettingsUpdateInput): Promise<void> {
    const nextSettings = await saveSettings(input)
    setSettings(nextSettings)
    setLocale(normalizeLocale(nextSettings.locale))
    applyAppTheme(nextSettings.theme)
  }

  function handleImportBackup(source: BackupImportDialogSource): void {
    if (backupImportBusy) return
    setError(null)
    setBackupImportSource(source)
    setBackupImportDialogOpen(true)
  }

  async function handleBackupImported(
    result: BackupImportResult | BackupSyncDownloadResult,
    source: BackupImportSource
  ): Promise<void> {
    await reloadInitialData()
    toast.success(formatImportResultMessage(result, source, t))
  }

  async function handleSaveComposerDraft(
    input: Parameters<typeof saveComposerDraft>[0]
  ): Promise<void> {
    await saveComposerDraft(input)
    drafts.refresh()
  }

  async function handleDiscardComposerDraft(draftId: number): Promise<void> {
    setError(null)
    try {
      await deleteDraftMessage(draftId)
      discardComposerDraft()
      drafts.refresh()
      toast.success(t('mailbox.draftDiscarded'))
    } catch (discardError) {
      const messageText = getErrorMessage(discardError, t('mailbox.discardDraftError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function handleRetryOutbox(message: OutboxMessage): Promise<void> {
    setOutboxPending(true)
    setError(null)
    try {
      const result = await retryOutboxMessage(message.outboxId)
      toast.success(
        result.warning
          ? t('mail.composer.sentWithWarning', { warning: result.warning })
          : t('mail.composer.sent')
      )
      await refreshOutbox()
    } catch (retryError) {
      const messageText = getErrorMessage(retryError, t('mailbox.retrySendError'))
      setError(messageText)
      toast.error(messageText)
      await refreshOutbox()
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleDeleteOutbox(message: OutboxMessage): Promise<boolean> {
    setOutboxPending(true)
    setError(null)
    try {
      if (message.status === 'draft') {
        await deleteDraftMessage(message.outboxId)
        drafts.refresh()
        toast.success(t('mailbox.draftDeleted'))
      } else {
        await deleteOutboxMessage(message.outboxId)
        toast.success(t('mailbox.outboxDeleted'))
        await refreshOutbox()
      }
      return true
    } catch (deleteError) {
      const messageText = getErrorMessage(deleteError, t('mailbox.deleteOutboxError'))
      setError(messageText)
      toast.error(messageText)
      return false
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleDeleteDrafts(outboxIds: number[]): Promise<boolean> {
    setOutboxPending(true)
    try {
      const count = await deleteDraftMessages(outboxIds)
      drafts.refresh()
      toast.success(t('mailbox.draftsDeleted', { count }))
      return true
    } catch (deleteError) {
      toast.error(getErrorMessage(deleteError, t('mailbox.deleteOutboxError')))
      return false
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleClearOutbox(status: 'sent' | 'failed'): Promise<boolean> {
    setOutboxPending(true)
    try {
      const count = await clearOutboxMessages(status)
      await refreshOutbox()
      toast.success(t('mailbox.outboxCleared', { count }))
      return true
    } catch (clearError) {
      toast.error(getErrorMessage(clearError, t('mailbox.clearOutboxError')))
      return false
    } finally {
      setOutboxPending(false)
    }
  }

  async function handleMarkSelectedRead(): Promise<void> {
    if (markingRead || selectedMessages.length === 0) return

    const pendingToastId = toast.loading(t('mailbox.markReadPending'))
    try {
      const result = await markMessagesRead(selectedMessages)
      clearSelection()
      await refreshReadStateViews()
      toast.dismiss(pendingToastId)
      showMarkReadResult(result.updatedCount, result.failedCount)
    } catch (markReadError) {
      toast.dismiss(pendingToastId)
      const messageText = getErrorMessage(markReadError, t('mailbox.readStateError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function handleSendComposerDraft(
    input: Parameters<typeof sendComposerDraft>[0]
  ): Promise<void> {
    try {
      await sendComposerDraft(input)
    } finally {
      drafts.refresh()
    }
    await refreshMessages(selectedAccountId, filters, searchKeyword)
    void syncAccount(input.accountId)
      .then(async () => {
        await refreshAccounts()
        await refreshMessages(selectedAccountId, filters, searchKeyword)
      })
      .catch(() => undefined)
  }

  async function handleUpdateAccountSettings(input: AccountUpdateInput): Promise<void> {
    await updateAccount(input)
    await refreshAccounts()
  }

  async function handleMarkMessagesRead(targetMessages: Message[]): Promise<void> {
    if (markingRead || targetMessages.length === 0) return

    const pendingToastId = toast.loading(t('mailbox.markReadPending'))
    try {
      const result = await markMessagesRead(targetMessages)
      clearSelection()
      await refreshReadStateViews()
      toast.dismiss(pendingToastId)
      showMarkReadResult(result.updatedCount, result.failedCount)
    } catch (markReadError) {
      toast.dismiss(pendingToastId)
      const messageText = getErrorMessage(markReadError, t('mailbox.readStateError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function handleMarkAllRead(): Promise<void> {
    if (markingRead || selectedMailboxUnread === 0) return

    const pendingToastId = toast.loading(t('mailbox.markReadPending'))
    try {
      const result = await markCurrentQueryRead(
        toMessageQuery(selectedAccountId, filters, undefined, searchKeyword)
      )
      await refreshReadStateViews()
      toast.dismiss(pendingToastId)
      showMarkReadResult(result.updatedCount, result.failedCount)
    } catch (markReadError) {
      toast.dismiss(pendingToastId)
      const messageText = getErrorMessage(markReadError, t('mailbox.readStateError'))
      setError(messageText)
      toast.error(messageText)
    }
  }

  async function refreshReadStateViews(): Promise<void> {
    await Promise.all([
      refreshAccounts(),
      filters.includes('unread')
        ? refreshMessages(selectedAccountId, filters, searchKeyword)
        : Promise.resolve()
    ])
  }

  function showMarkReadResult(updatedCount: number, failedCount: number): void {
    if (updatedCount > 0) {
      toast.success(t('mailbox.markReadSuccess', { count: updatedCount }))
    } else if (failedCount === 0) {
      toast.info(t('mailbox.markReadNoop'))
    }

    if (failedCount > 0) {
      toast.error(t('mailbox.markReadPartialFailed', { count: failedCount }))
    }
  }

  function handleSelectAccount(accountId: string): void {
    if (!accountId) return
    setWorkspaceView('mail')
    clearSelection()
    navigateToMailboxRoute()
    setSelectedAccountId(accountId)
    void refreshMessages(accountId, filters, searchKeyword, { selectFirst: true }).catch(
      (refreshError) => {
        setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
      }
    )
  }

  function handleSelectMessage(messageId: string): void {
    selectMessage(messageId)
    navigateToMailboxRoute(selectedAccountId, messageId)
  }

  function navigateToMailboxRoute(accountId?: string, messageId?: string): void {
    const route = toMailboxRoute(accountId, messageId)
    internalRouteRef.current = route
    navigate(route, { replace: false })
  }

  function handleChangeFilters(nextFilters: MailFilterTag[]): void {
    clearSelection()
    setFilters(nextFilters)
    void refreshMessages(selectedAccountId, nextFilters, searchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, t('mailbox.refreshMailError')))
    })
  }

  function handleChangeSearchKeyword(nextSearchKeyword: string): void {
    clearSelection()
    setSearchKeyword(nextSearchKeyword)
    void refreshMessages(selectedAccountId, filters, nextSearchKeyword).catch((refreshError) => {
      setError(getErrorMessage(refreshError, t('mailbox.searchMailError')))
    })
  }

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="relative shrink-0">
        <TitleBar
          platform={systemInfo?.platform}
          onAddAccount={handleOpenAddAccountWindow}
          onOpenSettings={() => {
            setSettingsInitialSection('general')
            setDialogKind('settings')
          }}
        />
      </div>

      {showNoAccounts ? (
        <NoAccountsBody
          importingSql={backupImportBusy}
          actionsDisabled={backupImportBusy}
          onAddAccount={handleOpenAddAccountWindow}
          onImportBackup={handleImportBackup}
        />
      ) : (
        <ResizablePanelGroup
          id={
            draftsOpen
              ? 'onemail-drafts-layout'
              : outboxOpen
                ? 'onemail-outbox-layout'
                : 'onemail-main-layout'
          }
          orientation="horizontal"
          defaultLayout={activeLayout.defaultLayout}
          onLayoutChanged={activeLayout.onLayoutChanged}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ResizablePanel
            id="accounts"
            defaultSize="292px"
            minSize="220px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <AccountList
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              syncingAccountIds={syncingAccountIds}
              actionsDisabled={!hasAccounts}
              composePending={composerPending}
              draftsSelected={draftsOpen}
              outboxSelected={outboxOpen}
              draftCount={drafts.result?.draftCount}
              onSelectAccount={handleSelectAccount}
              onCompose={() => {
                void openComposer('new')
              }}
              onOpenOutbox={() => {
                clearSelection()
                navigateToMailboxRoute()
                setWorkspaceView('outbox')
              }}
              onOpenDrafts={() => {
                clearSelection()
                navigateToMailboxRoute()
                setWorkspaceView('drafts')
                drafts.refresh()
              }}
              onRefreshAccount={(account) => {
                void handleRefreshAccount(account)
              }}
              onEditAccount={(account) => {
                setDialogAccountId(account.id)
                setDialogKind('edit')
              }}
              onDeleteAccount={(account) => {
                setDialogAccountId(account.id)
                setDialogKind('delete')
              }}
              onResolveAccountWarning={(account) => {
                setWarningAccountId(account.id)
              }}
              onOpenContacts={() => navigate('/contacts')}
              onOpenBoard={() => navigate('/board')}
            />
          </ResizablePanel>

          <ResizableHandle />

          {draftsOpen ? (
            <ResizablePanel id="drafts" minSize="280px">
              <DraftList
                accounts={realAccounts}
                messages={drafts.result?.messages ?? []}
                totalCount={drafts.result?.totalCount ?? 0}
                offset={drafts.result?.offset ?? 0}
                pageSize={DRAFT_PAGE_SIZE}
                accountId={drafts.query.accountId}
                keyword={drafts.query.keyword}
                loading={drafts.loading}
                pending={outboxPending || composerPending}
                error={drafts.error}
                onChangeAccount={(accountId) => drafts.changeQuery({ accountId })}
                onChangeKeyword={(keyword) => drafts.changeQuery({ keyword })}
                onChangePage={(offset) => drafts.changeQuery({ offset })}
                onRefresh={drafts.refresh}
                onCompose={() => {
                  void openComposer('new')
                }}
                onOpenDraft={openOutboxDraft}
                onDelete={handleDeleteOutbox}
                onDeleteMany={handleDeleteDrafts}
              />
            </ResizablePanel>
          ) : outboxOpen ? (
            <ResizablePanel id="outbox" minSize="280px">
              <OutboxPanel
                onClear={handleClearOutbox}
                pending={outboxPending}
                loading={outboxLoading}
                error={outboxError}
                outboxMessages={outboxMessages}
                onRefresh={handleRefreshOutbox}
                onRetry={(message) => {
                  void handleRetryOutbox(message)
                }}
                onDelete={async (message) => {
                  await handleDeleteOutbox(message)
                }}
              />
            </ResizablePanel>
          ) : (
            <>
              <ResizablePanel
                id="messages"
                defaultSize="420px"
                minSize="320px"
                groupResizeBehavior="preserve-pixel-size"
              >
                <MailList
                  account={selectedAccount}
                  messages={messages}
                  selectedMessageId={selectedMessageId}
                  filters={filters}
                  searchKeyword={searchKeyword}
                  loading={loading}
                  loadingMore={messagePage.loadingMore}
                  hasMore={messagePage.hasMore}
                  error={error}
                  onSelectMessage={handleSelectMessage}
                  onChangeFilters={handleChangeFilters}
                  onChangeSearchKeyword={handleChangeSearchKeyword}
                  onLoadMore={loadMoreMessages}
                  onMarkAllRead={() => {
                    void handleMarkAllRead()
                  }}
                  markAllUnreadCount={selectedMailboxUnread}
                  selectedMessageIds={selectedMessageIds}
                  allVisibleSelected={allVisibleSelected}
                  someVisibleSelected={someVisibleSelected}
                  selectionDisabled={deleting || markingRead}
                  onToggleMessageSelection={toggleMessageSelection}
                  onPrepareContextSelection={selectMessageForContext}
                  onSelectAllVisible={selectAllVisible}
                  onClearSelection={clearSelection}
                  onMarkSelectedRead={() => {
                    void handleMarkSelectedRead()
                  }}
                  onDeleteSelected={() => requestDeleteMessages(selectedMessages)}
                  onMarkMessagesRead={(targetMessages) => {
                    void handleMarkMessagesRead(targetMessages)
                  }}
                  onReplyMessage={(message, replyAll) => {
                    void openComposer(replyAll ? 'reply_all' : 'reply', message)
                  }}
                  onForwardMessages={(targetMessages, asAttachments) => {
                    void openForwardMessages(targetMessages, asAttachments)
                  }}
                  onDeleteMessages={requestDeleteMessages}
                  onAddToBoard={(message) => setTaskMessage(message)}
                />
              </ResizablePanel>

              <ResizableHandle />

              <ResizablePanel id="reader" minSize="420px">
                <article className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                  {selectedMessage ? (
                    <MailReader
                      message={selectedMessage}
                      recipientAddress={selectedMessageAccount?.address ?? selectedAccount.address}
                      loading={
                        !selectedMessage.detailLoaded || loadingMessageId === selectedMessage.id
                      }
                      loadingBody={loadingBodyMessageId === selectedMessage.id}
                      externalImagesBlocked={settings?.externalImagesBlocked ?? true}
                      downloadingAttachmentIds={downloadingAttachmentIds}
                      actionPending={composerPending}
                      deleting={deletingMessageIds.has(selectedMessage.id)}
                      onLoadBody={() => loadMessageBody(selectedMessage)}
                      onDownloadAttachment={(attachment) => {
                        if (attachment.id !== undefined) {
                          downloadMessageAttachment(selectedMessage, attachment.id)
                        }
                      }}
                      onReply={() => {
                        void openComposer('reply', selectedMessage)
                      }}
                      onForward={() => {
                        void openComposer('forward', selectedMessage)
                      }}
                      onDelete={() => requestDeleteMessages([selectedMessage])}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-8 text-xs text-muted-foreground">
                      {t('mailbox.selectPreview')}
                    </div>
                  )}
                </article>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}

      <StatusBar
        settings={settings}
        accountCount={realAccounts.length}
        messageCount={
          draftsOpen
            ? (drafts.result?.totalCount ?? 0)
            : outboxOpen
              ? outboxMessages.length
              : (selectedAccount.messageCount ?? messages.length)
        }
        unreadCount={realAccounts.reduce((sum, account) => sum + account.unread, 0)}
        syncNotice={syncNotice}
        writebackStatus={writebackStatus}
        onClearWriteback={(writebackId) => void clearWriteback(writebackId)}
        onClearCompletedWritebacks={() => void clearCompletedWritebacks()}
        onRetryWriteback={(writebackId) => void retryWriteback(writebackId)}
      />

      <AddTaskDialog
        message={taskMessage}
        open={Boolean(taskMessage)}
        onOpenChange={(open) => {
          if (!open) setTaskMessage(null)
        }}
        onCreated={() => undefined}
      />

      <EditAccountDialog
        account={dialogAccount ?? selectedAccount}
        settings={settings}
        open={dialogKind === 'edit'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'edit' : null)
          if (!open) setDialogAccountId(null)
        }}
        onSubmit={handleUpdateAccount}
      />
      <RemoveAccountDialog
        account={dialogAccount ?? selectedAccount}
        open={dialogKind === 'delete'}
        onOpenChange={(open) => {
          setDialogKind(open ? 'delete' : null)
          if (!open) setDialogAccountId(null)
        }}
        onConfirm={handleRemoveAccount}
      />
      {warningAccount ? (
        <AccountWarningDialog
          account={warningAccount}
          open={Boolean(warningAccountId)}
          syncing={syncingAccountIds.has(warningAccount.id)}
          onOpenChange={(open) => {
            if (!open) setWarningAccountId(null)
          }}
          onEdit={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('edit')
          }}
          onRetry={(account) => {
            void handleRefreshAccount(account)
          }}
          onDelete={(account) => {
            setDialogAccountId(account.id)
            setDialogKind('delete')
          }}
          onReauthorize={handleReauthorizeAccount}
        />
      ) : null}
      <SettingsDialog
        open={dialogKind === 'settings'}
        settings={settings}
        systemInfo={systemInfo}
        updateStatus={updateStatus}
        initialSection={settingsInitialSection}
        onOpenChange={(open) => {
          setDialogKind(open ? 'settings' : null)
          if (!open && initialSettingsSection) navigate('/', { replace: true })
        }}
        onSubmit={handleUpdateSettings}
        accounts={realAccounts}
        onUpdateAccount={handleUpdateAccountSettings}
        onRefreshAccounts={refreshAccounts}
        onRemoveAccounts={handleRemoveManagedAccounts}
        onReorderAccounts={handleReorderManagedAccounts}
        onImported={reloadInitialData}
      />
      <BackupImportDialog
        open={backupImportDialogOpen}
        defaultSource={backupImportSource}
        onOpenChange={setBackupImportDialogOpen}
        onBusyChange={setBackupImportBusy}
        onImported={handleBackupImported}
      />
      <OutlookImapHelpDialog
        accountLabel={outlookImapHelpAccount?.name}
        open={Boolean(outlookImapHelpAccount)}
        onOpenChange={(open) => {
          if (!open) setOutlookImapHelpAccount(null)
        }}
      />
      <MailComposer
        open={composerOpen}
        accounts={realAccounts}
        draft={composerDraft}
        pending={composerPending}
        onOpenChange={(open) => {
          if (!open) closeComposer()
        }}
        onSend={handleSendComposerDraft}
        onSaveDraft={handleSaveComposerDraft}
        onDiscardDraft={handleDiscardComposerDraft}
      />
      <DeleteMessageDialog
        open={Boolean(deleteRequest)}
        messages={deleteRequest?.messages ?? []}
        pending={deleting}
        onOpenChange={(open) => {
          if (!open) cancelDelete()
        }}
        onConfirm={() => {
          void confirmDelete()
        }}
      />
    </main>
  )
}

function toMailboxRoute(accountId?: string, messageId?: string): string {
  if (!accountId) return '/'
  if (accountId === 'all' && !messageId) return '/'
  return messageId
    ? `/${encodeURIComponent(accountId)}/${encodeURIComponent(messageId)}`
    : `/${encodeURIComponent(accountId)}`
}
