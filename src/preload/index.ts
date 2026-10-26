import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppTheme } from '../shared/types'

// Custom APIs for renderer
const api = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts/list'),
    create: (input) => ipcRenderer.invoke('accounts/create', input),
    onCreated: (callback): (() => void) => {
      const listener = (_event, event): void => callback(event)
      ipcRenderer.on('accounts/created', listener)
      return () => ipcRenderer.off('accounts/created', listener)
    },
    openAddWindow: () => ipcRenderer.invoke('accounts/openAddWindow'),
    closeAddWindow: () => ipcRenderer.invoke('accounts/closeAddWindow'),
    update: (input) => ipcRenderer.invoke('accounts/update', input),
    setNotifications: (input) => ipcRenderer.invoke('accounts/setNotifications', input),
    discoverFolders: (accountId) => ipcRenderer.invoke('accounts/discoverFolders', accountId),
    reauthorize: (accountId) => ipcRenderer.invoke('accounts/reauthorize', accountId),
    disable: (accountId) => ipcRenderer.invoke('accounts/disable', accountId),
    remove: (accountId) => ipcRenderer.invoke('accounts/remove', accountId),
    removeMany: (input) => ipcRenderer.invoke('accounts/removeMany', input),
    reorder: (input) => ipcRenderer.invoke('accounts/reorder', input)
  },
  logos: {
    get: (domain) => ipcRenderer.invoke('logos/get', domain)
  },
  messages: {
    access: (messageId) => ipcRenderer.invoke('messages/access', messageId),
    list: (query) => ipcRenderer.invoke('messages/list', query),
    stats: () => ipcRenderer.invoke('messages/stats'),
    get: (messageId) => ipcRenderer.invoke('messages/get', messageId),
    loadBody: (messageId) => ipcRenderer.invoke('messages/loadBody', messageId),
    setReadState: (messageId, isRead) =>
      ipcRenderer.invoke('messages/setReadState', messageId, isRead),
    bulkSetReadState: (input) => ipcRenderer.invoke('messages/bulkSetReadState', input),
    markAllRead: (input) => ipcRenderer.invoke('messages/markAllRead', input),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke('messages/downloadAttachment', attachmentId),
    delete: (input) => ipcRenderer.invoke('messages/delete', input),
    bulkDelete: (input) => ipcRenderer.invoke('messages/bulkDelete', input),
    hideLocal: (messageId) => ipcRenderer.invoke('messages/hideLocal', messageId),
    restore: (messageId) => ipcRenderer.invoke('messages/restore', messageId)
  },
  writeback: {
    list: () => ipcRenderer.invoke('writeback/list'),
    status: () => ipcRenderer.invoke('writeback/status'),
    clear: (writebackId) => ipcRenderer.invoke('writeback/clear', writebackId),
    clearCompleted: () => ipcRenderer.invoke('writeback/clearCompleted'),
    retry: (writebackId) => ipcRenderer.invoke('writeback/retry', writebackId),
    onChanged: (callback): (() => void) => {
      const listener = (_event, status): void => callback(status)
      ipcRenderer.on('writeback/changed', listener)
      return () => ipcRenderer.off('writeback/changed', listener)
    }
  },
  contacts: {
    list: (search, groupId) => ipcRenderer.invoke('contacts/list', search, groupId),
    save: (input) => ipcRenderer.invoke('contacts/save', input),
    addFromAddress: (input) => ipcRenderer.invoke('contacts/addFromAddress', input),
    listGroups: () => ipcRenderer.invoke('contacts/listGroups'),
    saveGroup: (input) => ipcRenderer.invoke('contacts/saveGroup', input),
    deleteGroup: (groupId) => ipcRenderer.invoke('contacts/deleteGroup', groupId),
    delete: (contactId) => ipcRenderer.invoke('contacts/delete', contactId),
    deleteMany: (contactIds) => ipcRenderer.invoke('contacts/deleteMany', contactIds),
    importVCard: () => ipcRenderer.invoke('contacts/importVCard'),
    exportVCard: (contactIds) => ipcRenderer.invoke('contacts/exportVCard', contactIds)
  },
  tasks: {
    list: () => ipcRenderer.invoke('tasks/list'),
    createFromMessage: (input) => ipcRenderer.invoke('tasks/createFromMessage', input),
    updateStatus: (input) => ipcRenderer.invoke('tasks/updateStatus', input),
    update: (input) => ipcRenderer.invoke('tasks/update', input),
    delete: (taskIds) => ipcRenderer.invoke('tasks/delete', taskIds),
    onChanged: (callback): (() => void) => {
      const listener = (_event, tasks): void => callback(tasks)
      ipcRenderer.on('tasks/changed', listener)
      return () => ipcRenderer.off('tasks/changed', listener)
    }
  },
  compose: {
    createNewDraft: (accountId) => ipcRenderer.invoke('compose/createNewDraft', accountId),
    createReplyDraft: (input) => ipcRenderer.invoke('compose/createReplyDraft', input),
    createForwardDraft: (input) => ipcRenderer.invoke('compose/createForwardDraft', input),
    createBulkForwardDraft: (input) => ipcRenderer.invoke('compose/createBulkForwardDraft', input),
    send: (input) => ipcRenderer.invoke('compose/send', input),
    selectAttachments: () => ipcRenderer.invoke('compose/selectAttachments'),
    selectInlineImage: () => ipcRenderer.invoke('compose/selectInlineImage'),
    listOutbox: (query) => ipcRenderer.invoke('compose/listOutbox', query),
    listDrafts: (query) => ipcRenderer.invoke('compose/listDrafts', query),
    saveDraft: (input) => ipcRenderer.invoke('compose/saveDraft', input),
    deleteDraft: (outboxId) => ipcRenderer.invoke('compose/deleteDraft', outboxId),
    deleteDrafts: (outboxIds) => ipcRenderer.invoke('compose/deleteDrafts', outboxIds),
    clearOutbox: (status) => ipcRenderer.invoke('compose/clearOutbox', status),
    retry: (outboxId) => ipcRenderer.invoke('compose/retry', outboxId),
    deleteOutbox: (outboxId) => ipcRenderer.invoke('compose/deleteOutbox', outboxId),
    onSent: (callback): (() => void) => {
      const listener = (_event, result): void => callback(result)
      ipcRenderer.on('compose/sent', listener)
      return () => ipcRenderer.off('compose/sent', listener)
    }
  },
  sync: {
    startAll: (mode) => ipcRenderer.invoke('sync/startAll', mode),
    startAccount: (accountId, mode) => ipcRenderer.invoke('sync/startAccount', accountId, mode),
    status: () => ipcRenderer.invoke('sync/status'),
    onMailboxChanged: (callback): (() => void) => {
      const listener = (_event, event): void => callback(event)
      ipcRenderer.on('sync/mailboxChanged', listener)
      return () => ipcRenderer.off('sync/mailboxChanged', listener)
    }
  },
  notifications: {
    status: () => ipcRenderer.invoke('notifications/status'),
    onNewMail: (callback): (() => void) => {
      const listener = (_event, notification): void => callback(notification)
      ipcRenderer.on('notifications/newMail', listener)
      return () => ipcRenderer.off('notifications/newMail', listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings/get'),
    update: (input) => ipcRenderer.invoke('settings/update', input),
    saveSignature: (input) => ipcRenderer.invoke('settings/saveSignature', input),
    deleteSignature: (signatureId) => ipcRenderer.invoke('settings/deleteSignature', signatureId),
    cleanupCache: (input) => ipcRenderer.invoke('settings/cleanupCache', input),
    getBackupSync: () => ipcRenderer.invoke('settings/getBackupSync'),
    updateBackupSync: (input) => ipcRenderer.invoke('settings/updateBackupSync', input),
    testBackupSync: (input) => ipcRenderer.invoke('settings/testBackupSync', input),
    uploadBackupSync: (options) => ipcRenderer.invoke('settings/uploadBackupSync', options),
    downloadBackupSync: (operationId) =>
      ipcRenderer.invoke('settings/downloadBackupSync', operationId),
    importBackupFromRemote: (input, operationId) =>
      ipcRenderer.invoke('settings/importBackupFromRemote', input, operationId),
    exportSql: (options) => ipcRenderer.invoke('settings/exportSql', options),
    importSql: (operationId) => ipcRenderer.invoke('settings/importSql', operationId),
    onBackupImportProgress: (callback): (() => void) => {
      const listener = (_event, progress): void => callback(progress)
      ipcRenderer.on('settings/backupImportProgress', listener)
      return () => ipcRenderer.off('settings/backupImportProgress', listener)
    }
  },
  translations: {
    getSettings: () => ipcRenderer.invoke('translations/getSettings'),
    updateSettings: (input) => ipcRenderer.invoke('translations/updateSettings', input),
    translate: (input) => ipcRenderer.invoke('translations/translate', input)
  },
  privacy: {
    list: () => ipcRenderer.invoke('privacy/list'),
    update: (input) => ipcRenderer.invoke('privacy/update', input),
    addTrustedSender: (input) => ipcRenderer.invoke('privacy/addTrustedSender', input),
    removeTrustedSender: (trustedSenderId) =>
      ipcRenderer.invoke('privacy/removeTrustedSender', trustedSenderId),
    clearCache: (accountId) => ipcRenderer.invoke('privacy/clearCache', accountId)
  },
  rules: {
    list: () => ipcRenderer.invoke('rules/list'),
    save: (input) => ipcRenderer.invoke('rules/save', input),
    delete: (ruleId) => ipcRenderer.invoke('rules/delete', ruleId),
    reorder: (ruleIds) => ipcRenderer.invoke('rules/reorder', ruleIds),
    setEnabled: (ruleId, enabled) => ipcRenderer.invoke('rules/setEnabled', ruleId, enabled)
  },
  updates: {
    check: () => ipcRenderer.invoke('updates/check'),
    download: () => ipcRenderer.invoke('updates/download'),
    status: () => ipcRenderer.invoke('updates/status'),
    install: () => ipcRenderer.invoke('updates/install'),
    onStatus: (callback): (() => void) => {
      const listener = (_event, status): void => callback(status)
      ipcRenderer.on('updates/status', listener)
      return () => ipcRenderer.off('updates/status', listener)
    }
  },
  system: {
    info: () => ipcRenderer.invoke('system/info'),
    setTitleBarTheme: (theme: AppTheme) => ipcRenderer.invoke('system/setTitleBarTheme', theme),
    revealDatabase: () => ipcRenderer.invoke('system/revealDatabase'),
    revealPath: (path) => ipcRenderer.invoke('system/revealPath', path),
    openExternal: (url) => ipcRenderer.invoke('system/openExternal', url),
    defaultMailClientStatus: () => ipcRenderer.invoke('system/defaultMailClientStatus'),
    configureDefaultMailClient: () => ipcRenderer.invoke('system/configureDefaultMailClient'),
    takePendingMailtoRequests: () => ipcRenderer.invoke('system/takePendingMailtoRequests'),
    onMailtoOpened: (callback): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('system/mailtoOpened', listener)
      return () => ipcRenderer.off('system/mailtoOpened', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
