export type AccountStatus =
  | 'active'
  | 'disabled'
  | 'syncing'
  | 'auth_error'
  | 'sync_error'
  | 'network_error'
export type AuthType = 'oauth2' | 'app_password' | 'password' | 'bridge' | 'manual'
export type ImapSecurity = 'ssl_tls' | 'starttls' | 'none'
export type SmtpSecurity = 'ssl_tls' | 'starttls' | 'none'
export type CredentialState = 'pending' | 'stored' | 'invalid' | 'expired' | 'revoked'
export type OAuthAuthorizationMode = 'internal_browser' | 'copy_link'
export type SyncMode = 'initial' | 'refresh'
export type RemoteDeletePolicy = 'inherit' | 'enabled' | 'disabled'
export type ReceiveProtocol = 'imap' | 'pop3'
export type ProxyMode = 'none' | 'system' | 'custom'
export type AccountProxyMode = 'global' | ProxyMode
export type SignatureMode = 'global' | 'none' | 'custom'
export type GlobalSyncMode = 'idle' | 'interval' | 'manual'
export type FallbackSyncMode = 'interval' | 'manual'
export type AccountSyncMode = 'global' | 'fallback' | 'idle' | 'interval' | 'manual'

export type MailAccount = {
  accountId: number
  providerKey: string
  email: string
  displayName?: string
  accountLabel?: string
  authType: AuthType
  receiveProtocol: ReceiveProtocol
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled: boolean
  popHost?: string
  popPort?: number
  popSecurity?: ImapSecurity
  idleSupported?: boolean
  proxyMode: AccountProxyMode
  customProxyUrl?: string
  signatureMode: SignatureMode
  signatureId?: number
  syncMode: AccountSyncMode
  accountSyncIntervalMinutes: number
  syncEnabled: boolean
  desktopNotificationsEnabled: boolean
  credentialState: CredentialState
  status: AccountStatus
  lastSyncAt?: string
  lastError?: string
  remoteDeletePolicy: RemoteDeletePolicy
  folders: AccountMailFolder[]
}

export type AccountCreateInput = {
  providerKey: string
  email?: string
  password?: string
  accountLabel?: string
  authType: AuthType
  receiveProtocol?: ReceiveProtocol
  oauthAuthorizationMode?: OAuthAuthorizationMode
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled?: boolean
  popHost?: string
  popPort?: number
  popSecurity?: ImapSecurity
  proxyMode?: AccountProxyMode
  customProxyUrl?: string
  signatureMode?: SignatureMode
  signatureId?: number
  syncMode?: AccountSyncMode
  accountSyncIntervalMinutes?: number
  remoteDeletePolicy?: RemoteDeletePolicy
  desktopNotificationsEnabled?: boolean
}

export type AccountCreatedEvent = {
  account: MailAccount
  requestedSync: boolean
}

export type AccountUpdateInput = Partial<Omit<AccountCreateInput, 'email' | 'password'>> & {
  accountId: number
  displayName?: string
  password?: string
  syncEnabled?: boolean
  selectedFolderPaths?: string[]
}

export type AccountOrderInput = {
  accountIds: number[]
}

export type AccountBulkRemoveResult = {
  removedAccountIds: number[]
}

export type MailFolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'all_mail'
  | 'important'
  | 'starred'
  | 'custom'

export type AccountMailFolder = {
  folderId?: number
  path: string
  name: string
  delimiter?: string
  role: MailFolderRole
  attributes: string[]
  selectable: boolean
  selected: boolean
  totalCount?: number
  unreadCount?: number
}

export type MessageFilterTag = 'unread' | 'starred' | 'today' | 'yesterday' | 'last7'

export type MessageListQuery = {
  accountId?: number
  folderId?: number
  folderRole?: MailFolderRole
  localDeletedOnly?: boolean
  filters?: MessageFilterTag[]
  keyword?: string
  search?: string
  cursor?: string
  limit?: number
  offset?: number
}

export type MailMessageSummary = {
  messageId: number
  accountId: number
  folderId: number
  folderRole?: string
  folderName?: string
  subject?: string
  fromName?: string
  fromEmail?: string
  to?: string
  cc?: string
  replyTo?: string
  messageRfc822Id?: string
  references?: string
  receivedAt?: string
  snippet?: string
  isRead: boolean
  isStarred: boolean
  isAnswered: boolean
  hasAttachments: boolean
  bodyStatus: 'none' | 'loading' | 'ready' | 'error'
  verificationCode?: string
}

export type AccountMailboxStats = {
  accountId: number
  totalCount: number
  unreadCount: number
}

export type MailMessageAttachment = {
  attachmentId: number
  filename: string
  mimeType?: string
  contentDisposition?: 'attachment' | 'inline'
  sizeBytes: number
}

export type AttachmentDownloadResult = {
  downloaded: boolean
  attachmentId: number
  filePath?: string
}

export type MailMessageBody = {
  messageId: number
  bodyText?: string
  bodyHtmlSanitized?: string
  externalImagesBlocked: boolean
}

export type MailMessageBodyLoadResult = {
  body: MailMessageBody | null
  error?: string
}

export type MailMessageDetail = MailMessageSummary & {
  body?: MailMessageBody
  attachments: MailMessageAttachment[]
}

export type MailAddressInput = {
  name?: string
  email: string
}

export type MailComposeMode = 'new' | 'reply' | 'reply_all' | 'forward'

export type MailAttachmentInput = {
  filePath?: string
  filename?: string
  mimeType?: string
  sizeBytes?: number
  sourceMessageId?: number
  sourceAttachmentId?: number
}

export type MailSendInput = {
  outboxId?: number
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc?: MailAddressInput[]
  bcc?: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  attachments?: MailAttachmentInput[]
  inReplyTo?: string
  referencesHeader?: string
}

export type MailSendResult = {
  outboxId: number
  accountId: number
  status: OutboxMessage['status']
  rfc822MessageId: string
  sentAt?: string
  warning?: string
  error?: string
}

export type ReplyDraftInput = {
  messageId: number
  mode: Extract<MailComposeMode, 'reply' | 'reply_all'>
}

export type ForwardDraftInput = {
  messageId: number
}

export type BulkForwardDraftInput = {
  messageIds: number[]
}

export type InlineImageSelection = {
  filename: string
  mimeType: string
  dataUrl: string
}

export type ForwardAttachmentCandidate = {
  attachmentId: number
  filename: string
  mimeType?: string
  sizeBytes: number
  selected: boolean
}

export type ComposeDraft = {
  accountId: number
  mode: MailComposeMode
  relatedMessageId?: number
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  forwardAttachments?: ForwardAttachmentCandidate[]
  attachments?: MailAttachmentInput[]
}

export type OutboxMessage = {
  outboxId: number
  accountId: number
  relatedMessageId?: number
  composeKind: MailComposeMode
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'deleted'
  rfc822MessageId: string
  from?: MailAddressInput
  subject?: string
  bodyText?: string
  bodyHtml?: string
  inReplyTo?: string
  referencesHeader?: string
  attachments?: MailAttachmentInput[]
  to: MailAddressInput[]
  cc: MailAddressInput[]
  bcc: MailAddressInput[]
  sentAt?: string
  deletedAt?: string
  lastError?: string
  lastWarning?: string
  createdAt: string
  updatedAt: string
}

export type OutboxListQuery = {
  statuses?: OutboxMessage['status'][]
  limit?: number
}

export type MessageDeleteMode = 'trash' | 'permanent' | 'local_hide'

export type MessageDeleteInput = {
  messageId: number
  mode?: MessageDeleteMode
  allowLocalHide?: boolean
}

export type MessageDeleteResult = {
  messageId: number
  accountId?: number
  mode: MessageDeleteMode
  deleted: boolean
  localOnly: boolean
  error?: string
}

export type MessageBulkDeleteInput = {
  messageIds: number[]
  mode?: MessageDeleteMode
  allowLocalHide?: boolean
}

export type MessageBulkDeleteFailure = {
  messageId: number
  accountId?: number
  error: string
}

export type MessageBulkDeleteResult = {
  mode: MessageDeleteMode
  succeededMessageIds: number[]
  failedItems: MessageBulkDeleteFailure[]
  deletedCount: number
  failedCount: number
  operationBatchId?: string
}

export type MessageRestoreResult = {
  messageId: number
  accountId?: number
  restored: boolean
  localOnly: boolean
  error?: string
}

export type MessageReadStateUpdate = {
  messageId: number
  accountId: number
  folderId: number
  isRead: boolean
}

export type MessageBulkReadStateFailure = {
  messageId: number
  accountId?: number
  error: string
}

export type MessageBulkReadStateInput = {
  messageIds: number[]
  isRead: boolean
}

export type MessageBulkReadStateResult = {
  isRead: boolean
  updates: MessageReadStateUpdate[]
  succeededMessageIds: number[]
  failedItems: MessageBulkReadStateFailure[]
  updatedCount: number
  failedCount: number
}

export type MessageMarkAllReadInput = {
  query?: MessageListQuery
}

export type SyncStatus = {
  running: boolean
  accountIds: number[]
  lastStartedAt?: string
}

export type AccountSyncRunResult = SyncStatus & {
  accountId: number
  scannedCount: number
  insertedCount: number
  updatedCount: number
}

export type MailboxChangedEvent = {
  accountId: number
  reason: 'idle' | 'poll' | 'manual'
  changedAt: string
}

export type NewMailNotificationMessage = {
  messageId: number
  accountId: number
  subject?: string
  fromName?: string
  fromEmail?: string
  receivedAt?: string
  snippet?: string
  verificationCode?: string
}

export type NewMailNotification = {
  notificationId: string
  accountId: number
  accountEmail?: string
  accountLabel?: string
  reason: MailboxChangedEvent['reason']
  messageCount: number
  messages: NewMailNotificationMessage[]
  notifiedAt: string
}

export type NotificationStatus = {
  desktopSupported: boolean
}

export type AppColorTheme =
  | 'light'
  | 'dark'
  | 'blue-light'
  | 'green-light'
  | 'rose-light'
  | 'blue-dark'
  | 'green-dark'
  | 'burgundy-dark'

export type UpdateCheckFrequency = 'manual' | 'daily' | 'weekly'

export type PrivacyMode = 'unrestricted' | 'loose' | 'strict'
export type AccountPrivacyMode = 'inherit' | PrivacyMode

export type AppSettings = {
  syncIntervalMinutes: number
  syncWindowDays: number
  openAtLogin: boolean
  defaultDesktopNotificationsEnabled: boolean
  externalImagesBlocked: boolean
  privacyDefaultMode?: PrivacyMode
  locale: string
  theme: AppColorTheme
  updateCheckFrequency: UpdateCheckFrequency
  defaultComposeAccountId: number | null
  syncDeleteToRemote: boolean
  globalProxyMode: ProxyMode
  globalProxyUrl?: string
  globalSignatureId: number | null
  globalSyncMode: GlobalSyncMode
  globalSyncIntervalMinutes: number
  fallbackSyncMode: FallbackSyncMode
  fallbackSyncIntervalMinutes: number
  signatures: MailSignature[]
}

export type MailtoComposeRequest = {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
}

export type DefaultMailClientStatus = {
  supported: boolean
  registered: boolean
  isDefault: boolean
  requiresSystemSelection: boolean
}

export type SettingsUpdateInput = Partial<AppSettings>

export type TranslationProvider =
  | 'aliyun'
  | 'baidu'
  | 'baidufield'
  | 'caiyun'
  | 'claude'
  | 'cnki'
  | 'deeplcustom'
  | 'gemini'
  | 'google'
  | 'huoshan'
  | 'huoshanweb'
  | 'microsoft'
  | 'deepl'
  | 'libretranslate'
  | 'deeplx'
  | 'niutrans'
  | 'openai'
  | 'tencent'
  | 'tencenttransmart'

export type TranslationLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'de' | 'fr' | 'es'

export type OpenAiApiMode = 'responses' | 'chat-completions'

export type TranslationProviderConfig = {
  endpoint?: string
  apiKey?: string
  apiKeyConfigured?: boolean
  model?: string
  apiMode?: OpenAiApiMode
  action?: string
  scene?: string
  dictionaryId?: string
  memoryId?: string
  termRepositoryIds?: string
  sentenceRepositoryIds?: string
}

export type TranslationSettings = {
  activeProvider: TranslationProvider
  targetLanguage: TranslationLanguage
  providers: Record<TranslationProvider, TranslationProviderConfig>
}

export type TranslationRequest = {
  text?: string
  segments?: string[]
  targetLanguage?: TranslationLanguage
}

export type TranslationResult = {
  provider: TranslationProvider
  targetLanguage: TranslationLanguage
  translatedText: string
  translatedSegments?: string[]
}

export type MailSignature = {
  signatureId: number
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export type MailSignatureInput = {
  signatureId?: number
  title: string
  content: string
}

export type CacheCleanupResult = {
  days: number
  deletedMessages: number
}

export type BackupSyncProvider = 'none' | 'webdav' | 's3'

export type BackupExportOptions = {
  includeMail: boolean
}

export type AccountNotificationsInput = {
  accountIds: number[]
  enabled: boolean
}

export type BackupSyncSettings =
  | {
      provider: 'none'
    }
  | {
      provider: 'webdav'
      remoteUrl: string
      username?: string
      password?: string
      passwordConfigured?: boolean
      readKey?: string
      readKeyConfigured?: boolean
    }
  | {
      provider: 's3'
      endpoint?: string
      region: string
      bucket: string
      key: string
      accessKeyId: string
      secretAccessKey?: string
      secretAccessKeyConfigured?: boolean
      readKey?: string
      readKeyConfigured?: boolean
    }

export type BackupSyncTransferResult = {
  provider: Exclude<BackupSyncProvider, 'none'>
  remotePath: string
  fileName?: string
  exportedAt?: number
  transferredAt: string
}

export type BackupSyncTestResult = {
  provider: Exclude<BackupSyncProvider, 'none'>
  remotePath: string
  testedAt: string
}

export type BackupImportSource = 'local' | Exclude<BackupSyncProvider, 'none'>

export type BackupImportStage =
  | 'selecting_file'
  | 'reading_file'
  | 'downloading_remote'
  | 'validating_backup'
  | 'restoring_database'
  | 'loading_stats'
  | 'completed'

export type BackupImportProgress = {
  operationId: string
  source: BackupImportSource
  stage: BackupImportStage
  percent: number
  filePath?: string
  remotePath?: string
  sourceName?: string
}

export type BackupSyncDownloadResult = BackupImportResult & {
  provider?: Exclude<BackupSyncProvider, 'none'>
  remotePath?: string
}

export type BackupImportResult = {
  imported: boolean
  filePath?: string
  importedAt?: string
  exportedAt?: number
  accountCount?: number
  messageCount?: number
}

export type SystemInfo = {
  platform: NodeJS.Platform
  appVersion: string
  databasePath: string
  userDataPath: string
}

export type AppTheme = 'light' | 'dark'

export type AppUpdateCheckResult = {
  status: 'unsupported' | 'available' | 'not_available' | 'error'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message: string
}

export type AppUpdateProgress = {
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond: number
}

export type AppUpdateStatus = {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'not_available'
    | 'unsupported'
    | 'cancelled'
    | 'error'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message: string
  progress?: AppUpdateProgress
  updatedAt: string
}

export type WritebackOperationKind =
  | 'mark_read'
  | 'mark_unread'
  | 'move_to_trash'
  | 'restore'
  | 'mark_answered'
  | 'append_sent'
  | 'permanent_delete'
  | 'smtp_send'
  | 'rule_action'

export type WritebackOperationStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

export type RemoteWriteback = {
  writebackId: number
  accountId: number
  accountEmail?: string
  messageId?: number
  operationKind: WritebackOperationKind
  status: WritebackOperationStatus
  messageSubject?: string
  messageSender?: string
  errorMessage?: string
  attemptCount: number
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

export type WritebackStatus = {
  queuedCount: number
  runningCount: number
  failedCount: number
  successCount: number
  items: RemoteWriteback[]
}

export type MailRuleField = 'recipient' | 'sender' | 'subject' | 'body' | 'has_attachment'
export type MailRuleOperator = 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with'
export type MailRuleConnector = 'and' | 'or'

export type MailRuleCondition = {
  field: MailRuleField
  operator: MailRuleOperator
  value: string
  connector?: MailRuleConnector
}

export type MailRuleAction =
  | { type: 'mark_read' }
  | { type: 'add_to_board'; note?: string; reminderMinutes?: number[] }
  | { type: 'move_to_trash' }

export type MailRule = {
  ruleId: number
  name: string
  accountId?: number
  enabled: boolean
  sortOrder: number
  conditions: MailRuleCondition[]
  actions: MailRuleAction[]
  createdAt: string
  updatedAt: string
}

export type MailRuleInput = Omit<MailRule, 'ruleId' | 'createdAt' | 'updatedAt'> & {
  ruleId?: number
}

export type PrivacyTrustedSender = {
  trustedSenderId: number
  accountId: number
  matchType: 'email' | 'domain'
  matchValue: string
}

export type AccountPrivacyPolicy = {
  accountId: number
  mode: AccountPrivacyMode
  resolvedMode: PrivacyMode
  trustedSenders: PrivacyTrustedSender[]
}

export type PrivacyPolicyUpdateInput = {
  accountId: number
  mode: AccountPrivacyMode
}

export type PrivacyTrustedSenderInput = {
  accountId: number
  matchType: 'email' | 'domain'
  matchValue: string
}

export type ContactEmail = {
  contactEmailId?: number
  email: string
  label?: string
  isDefault: boolean
}

export type Contact = {
  contactId: number
  displayName: string
  note: string
  isStarred: boolean
  emails: ContactEmail[]
  createdAt: string
  updatedAt: string
}

export type ContactInput = {
  contactId?: number
  displayName: string
  note?: string
  isStarred?: boolean
  emails: ContactEmail[]
}

export type BoardTaskStatus = 'todo' | 'in_progress' | 'completed' | 'cancelled'

export type TaskReminder = {
  reminderId?: number
  fireAt: string
  status: 'pending' | 'fired' | 'cancelled'
  firedAt?: string
}

export type BoardTask = {
  taskId: number
  accountId: number
  accountEmail?: string
  messageId?: number
  status: BoardTaskStatus
  note: string
  subjectSnapshot: string
  senderSnapshot: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  reminders: TaskReminder[]
}

export type CreateBoardTaskInput = {
  accountId: number
  messageId: number
  note?: string
  reminders?: Array<{ fireAt: string }>
}

export type BoardTaskStatusUpdate = {
  taskIds: number[]
  status: BoardTaskStatus
}

export type VCardImportResult = {
  imported: number
  merged: number
  skipped?: number
  canceled?: boolean
  contacts: Contact[]
}

export type OneMailApi = {
  accounts: {
    list: () => Promise<MailAccount[]>
    create: (input: AccountCreateInput) => Promise<MailAccount>
    onCreated: (callback: (event: AccountCreatedEvent) => void) => () => void
    openAddWindow: () => Promise<boolean>
    closeAddWindow: () => Promise<boolean>
    update: (input: AccountUpdateInput) => Promise<MailAccount>
    setNotifications: (input: AccountNotificationsInput) => Promise<MailAccount[]>
    discoverFolders: (accountId: number) => Promise<AccountMailFolder[]>
    reauthorize: (accountId: number) => Promise<MailAccount>
    disable: (accountId: number) => Promise<MailAccount>
    remove: (accountId: number) => Promise<boolean>
    removeMany: (input: AccountOrderInput) => Promise<AccountBulkRemoveResult>
    reorder: (input: AccountOrderInput) => Promise<MailAccount[]>
  }
  logos: {
    get: (domain: string) => Promise<string | null>
  }
  messages: {
    list: (query?: MessageListQuery) => Promise<MailMessageSummary[]>
    stats: () => Promise<AccountMailboxStats[]>
    get: (messageId: number) => Promise<MailMessageDetail | null>
    loadBody: (messageId: number) => Promise<MailMessageBodyLoadResult>
    setReadState: (messageId: number, isRead: boolean) => Promise<MessageReadStateUpdate>
    bulkSetReadState: (input: MessageBulkReadStateInput) => Promise<MessageBulkReadStateResult>
    markAllRead: (input?: MessageMarkAllReadInput) => Promise<MessageBulkReadStateResult>
    downloadAttachment: (attachmentId: number) => Promise<AttachmentDownloadResult>
    delete: (input: MessageDeleteInput) => Promise<MessageDeleteResult>
    bulkDelete: (input: MessageBulkDeleteInput) => Promise<MessageBulkDeleteResult>
    hideLocal: (messageId: number) => Promise<MessageDeleteResult>
    restore: (messageId: number) => Promise<MessageRestoreResult>
  }
  writeback: {
    list: () => Promise<RemoteWriteback[]>
    status: () => Promise<WritebackStatus>
    clear: (writebackId: number) => Promise<boolean>
    clearCompleted: () => Promise<number>
    retry: (writebackId: number) => Promise<boolean>
    onChanged: (callback: (status: WritebackStatus) => void) => () => void
  }
  compose: {
    createNewDraft: (accountId: number) => Promise<ComposeDraft>
    createReplyDraft: (input: ReplyDraftInput) => Promise<ComposeDraft>
    createForwardDraft: (input: ForwardDraftInput) => Promise<ComposeDraft>
    createBulkForwardDraft: (input: BulkForwardDraftInput) => Promise<ComposeDraft>
    send: (input: MailSendInput) => Promise<MailSendResult>
    selectAttachments: () => Promise<MailAttachmentInput[]>
    selectInlineImage: () => Promise<InlineImageSelection | null>
    listOutbox: (query?: OutboxListQuery) => Promise<OutboxMessage[]>
    saveDraft: (input: MailSendInput) => Promise<OutboxMessage>
    deleteDraft: (outboxId: number) => Promise<boolean>
    retry: (outboxId: number) => Promise<MailSendResult>
    deleteOutbox: (outboxId: number) => Promise<boolean>
    onSent: (callback: (result: MailSendResult) => void) => () => void
  }
  sync: {
    startAll: (mode?: SyncMode) => Promise<SyncStatus>
    startAccount: (accountId: number, mode?: SyncMode) => Promise<AccountSyncRunResult>
    status: () => Promise<SyncStatus>
    onMailboxChanged: (callback: (event: MailboxChangedEvent) => void) => () => void
  }
  notifications: {
    status: () => Promise<NotificationStatus>
    onNewMail: (callback: (notification: NewMailNotification) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: SettingsUpdateInput) => Promise<AppSettings>
    saveSignature: (input: MailSignatureInput) => Promise<MailSignature>
    deleteSignature: (signatureId: number) => Promise<boolean>
    cleanupCache: (days: number) => Promise<CacheCleanupResult>
    getBackupSync: () => Promise<BackupSyncSettings>
    updateBackupSync: (input: BackupSyncSettings) => Promise<BackupSyncSettings>
    testBackupSync: (input: BackupSyncSettings) => Promise<BackupSyncTestResult>
    uploadBackupSync: (options?: BackupExportOptions) => Promise<BackupSyncTransferResult>
    downloadBackupSync: (operationId?: string) => Promise<BackupSyncDownloadResult>
    importBackupFromRemote: (
      input: BackupSyncSettings,
      operationId?: string
    ) => Promise<BackupSyncDownloadResult>
    exportSql: (options?: BackupExportOptions) => Promise<string | null>
    importSql: (operationId?: string) => Promise<BackupImportResult>
    onBackupImportProgress: (callback: (progress: BackupImportProgress) => void) => () => void
  }
  translations: {
    getSettings: () => Promise<TranslationSettings>
    updateSettings: (input: TranslationSettings) => Promise<TranslationSettings>
    translate: (input: TranslationRequest) => Promise<TranslationResult>
  }
  privacy: {
    list: () => Promise<AccountPrivacyPolicy[]>
    update: (input: PrivacyPolicyUpdateInput) => Promise<AccountPrivacyPolicy>
    addTrustedSender: (input: PrivacyTrustedSenderInput) => Promise<PrivacyTrustedSender>
    removeTrustedSender: (trustedSenderId: number) => Promise<boolean>
    clearCache: (accountId?: number) => Promise<number>
  }
  contacts: {
    list: (search?: string) => Promise<Contact[]>
    save: (input: ContactInput) => Promise<Contact>
    delete: (contactId: number) => Promise<boolean>
    importVCard: () => Promise<VCardImportResult>
    exportVCard: (contactIds?: number[]) => Promise<string | null>
  }
  tasks: {
    list: () => Promise<BoardTask[]>
    createFromMessage: (input: CreateBoardTaskInput) => Promise<BoardTask>
    updateStatus: (input: BoardTaskStatusUpdate) => Promise<BoardTask[]>
    delete: (taskIds: number[]) => Promise<number>
    onChanged: (callback: (tasks: BoardTask[]) => void) => () => void
  }
  rules: {
    list: () => Promise<MailRule[]>
    save: (input: MailRuleInput) => Promise<MailRule>
    delete: (ruleId: number) => Promise<boolean>
    reorder: (ruleIds: number[]) => Promise<MailRule[]>
    setEnabled: (ruleId: number, enabled: boolean) => Promise<MailRule>
  }
  updates: {
    check: () => Promise<AppUpdateCheckResult>
    status: () => Promise<AppUpdateStatus>
    install: () => Promise<boolean>
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  }
  system: {
    info: () => Promise<SystemInfo>
    setTitleBarTheme: (theme: AppTheme) => Promise<boolean>
    revealDatabase: () => Promise<boolean>
    revealPath: (path: string) => Promise<boolean>
    openExternal: (url: string) => Promise<boolean>
    defaultMailClientStatus: () => Promise<DefaultMailClientStatus>
    configureDefaultMailClient: () => Promise<DefaultMailClientStatus>
    takePendingMailtoRequests: () => Promise<MailtoComposeRequest[]>
    onMailtoOpened: (callback: () => void) => () => void
  }
}
