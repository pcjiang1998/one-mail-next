import { BrowserWindow, ipcMain } from 'electron'
import {
  createAccount,
  disableAccount,
  getAccount,
  listAccounts,
  removeAccount,
  removeAccounts,
  reorderAccounts,
  setAccountNotifications,
  updateAccount,
  updateAccountIdleSupport
} from '../db/repositories/account.repository'
import { testImapConnection, testImapOAuthConnection } from '../services/imap-connection-test'
import { testPop3Connection } from '../mail/pop3-session'
import { refreshMailboxWatchers } from '../services/mailbox-watch'
import type {
  AccountCreateInput,
  AccountNotificationsInput,
  AccountCreatedEvent,
  AccountOrderInput,
  AccountUpdateInput
} from './types'
import { saveAccountPassword, readAccountPassword } from '../services/credential-store'
import { authorizeMicrosoftAccount, saveMicrosoftAuthorization } from '../services/microsoft-oauth'
import { closeAddAccountWindow, openAddAccountWindow } from '../services/add-account-window'
import {
  discoverAccountMailFolders,
  updateAccountFolderSelection
} from '../services/account-mailboxes'

export function registerAccountIpc(): void {
  ipcMain.handle('accounts/list', () => listAccounts())
  ipcMain.handle('accounts/setNotifications', (_event, input: AccountNotificationsInput) =>
    setAccountNotifications(input)
  )
  ipcMain.handle('accounts/openAddWindow', () => {
    openAddAccountWindow()
    return true
  })
  ipcMain.handle('accounts/closeAddWindow', () => {
    closeAddAccountWindow()
    return true
  })
  ipcMain.handle('accounts/create', async (_event, input: AccountCreateInput) => {
    let nextInput = input
    let oauthToken: Awaited<ReturnType<typeof authorizeMicrosoftAccount>>['token'] | undefined
    let idleSupported: boolean | undefined

    if (input.authType === 'oauth2') {
      const authorization = await authorizeMicrosoftAccount({ mode: input.oauthAuthorizationMode })
      oauthToken = authorization.token
      nextInput = {
        ...input,
        email: authorization.email
      }
      idleSupported = await testImapOAuthConnection(nextInput, oauthToken.accessToken)
    } else if (input.receiveProtocol === 'pop3') {
      await testPop3Connection(input)
      idleSupported = false
    } else {
      idleSupported = await testImapConnection(input)
    }
    let account: ReturnType<typeof createAccount> | null = null

    try {
      account = createAccount(nextInput)
      if (nextInput.authType === 'oauth2') {
        if (!oauthToken) throw new Error('Microsoft OAuth 授权结果无效。')
        saveMicrosoftAuthorization(account.accountId, oauthToken)
      } else {
        saveAccountPassword(account.accountId, nextInput)
      }
      if (idleSupported !== undefined) updateAccountIdleSupport(account.accountId, idleSupported)
      const savedAccount = getAccount(account.accountId) ?? account
      refreshMailboxWatchers()
      broadcastAccountCreated(savedAccount)
      return savedAccount
    } catch (error) {
      if (account) {
        removeAccount(account.accountId)
      }
      throw error
    }
  })
  ipcMain.handle('accounts/discoverFolders', (_event, accountId: number) => {
    return discoverAccountMailFolders(accountId)
  })
  ipcMain.handle('accounts/update', async (_event, input: AccountUpdateInput) => {
    const current = getAccount(input.accountId)
    if (!current) {
      throw new Error(`Account not found: ${input.accountId}`)
    }

    if (input.receiveProtocol && input.receiveProtocol !== current.receiveProtocol) {
      throw new Error('已添加账号不允许切换 IMAP/POP3 协议，请删除后重新添加。')
    }

    if (!requiresConnectionTest(input)) {
      const account = updateAccount(input)
      if (input.selectedFolderPaths) {
        await updateAccountFolderSelection(account.accountId, input.selectedFolderPaths)
      }
      refreshMailboxWatchers()
      return getAccount(account.accountId) ?? account
    }

    if (current.authType === 'oauth2' || input.authType === 'oauth2') {
      const account = updateAccount(normalizeOAuthAccountUpdate(input, current))
      if (input.selectedFolderPaths) {
        await updateAccountFolderSelection(account.accountId, input.selectedFolderPaths)
      }
      refreshMailboxWatchers()
      return getAccount(account.accountId) ?? account
    }

    const password = input.password ?? readAccountPassword(input.accountId)
    const connectionInput: AccountCreateInput = {
      providerKey: input.providerKey ?? current.providerKey,
      email: current.email,
      password,
      accountLabel: input.accountLabel ?? current.accountLabel,
      authType: input.authType ?? current.authType,
      imapHost: input.imapHost ?? current.imapHost,
      imapPort: input.imapPort ?? current.imapPort,
      imapSecurity: input.imapSecurity ?? current.imapSecurity,
      smtpHost: input.smtpHost ?? current.smtpHost,
      smtpPort: input.smtpPort ?? current.smtpPort,
      smtpSecurity: input.smtpSecurity ?? current.smtpSecurity,
      smtpAuthType: input.smtpAuthType ?? current.smtpAuthType,
      smtpEnabled: input.smtpEnabled ?? current.smtpEnabled,
      receiveProtocol: current.receiveProtocol,
      popHost: input.popHost ?? current.popHost,
      popPort: input.popPort ?? current.popPort,
      popSecurity: input.popSecurity ?? current.popSecurity,
      proxyMode: input.proxyMode ?? current.proxyMode,
      customProxyUrl: input.customProxyUrl ?? current.customProxyUrl
    }
    const idleSupported =
      current.receiveProtocol === 'pop3'
        ? await testPop3Connection(connectionInput).then(() => false)
        : await testImapConnection(connectionInput)

    const account = updateAccount(input)
    updateAccountIdleSupport(account.accountId, idleSupported)
    if (input.password) {
      saveAccountPassword(account.accountId, connectionInput)
    }
    if (input.selectedFolderPaths) {
      await updateAccountFolderSelection(account.accountId, input.selectedFolderPaths)
    }
    refreshMailboxWatchers()
    return getAccount(account.accountId) ?? account
  })
  ipcMain.handle('accounts/reauthorize', async (_event, accountId: number) => {
    const current = getAccount(accountId)
    if (!current) {
      throw new Error(`Account not found: ${accountId}`)
    }
    if (current.authType !== 'oauth2') {
      throw new Error('只有 Microsoft OAuth 账号需要重新授权。')
    }

    const authorization = await authorizeMicrosoftAccount({ loginHint: current.email })
    if (authorization.email.toLowerCase() !== current.email.toLowerCase()) {
      throw new Error(`请使用 ${current.email} 完成授权。`)
    }

    saveMicrosoftAuthorization(current.accountId, authorization.token)
    const account = getAccount(current.accountId) ?? current
    refreshMailboxWatchers()
    return account
  })
  ipcMain.handle('accounts/disable', (_event, accountId: number) => {
    const account = disableAccount(accountId)
    refreshMailboxWatchers()
    return account
  })
  ipcMain.handle('accounts/remove', (_event, accountId: number) => {
    const removed = removeAccount(accountId)
    refreshMailboxWatchers()
    return removed
  })
  ipcMain.handle('accounts/removeMany', (_event, input: AccountOrderInput) => {
    if (!input || !Array.isArray(input.accountIds)) throw new Error('邮箱 ID 列表无效。')
    const removedAccountIds = removeAccounts(input.accountIds)
    refreshMailboxWatchers()
    return { removedAccountIds }
  })
  ipcMain.handle('accounts/reorder', (_event, input: AccountOrderInput) => {
    if (!input || !Array.isArray(input.accountIds)) throw new Error('邮箱 ID 列表无效。')
    const accounts = reorderAccounts(input.accountIds)
    refreshMailboxWatchers()
    return accounts
  })
}

function requiresConnectionTest(input: AccountUpdateInput): boolean {
  return [
    'password',
    'authType',
    'providerKey',
    'imapHost',
    'imapPort',
    'imapSecurity',
    'popHost',
    'popPort',
    'popSecurity',
    'proxyMode',
    'customProxyUrl'
  ].some((key) => Object.prototype.hasOwnProperty.call(input, key))
}

function normalizeOAuthAccountUpdate(
  input: AccountUpdateInput,
  current: NonNullable<ReturnType<typeof getAccount>>
): AccountUpdateInput {
  if (
    input.password ||
    (input.authType && input.authType !== current.authType) ||
    (input.providerKey && input.providerKey !== current.providerKey) ||
    (input.imapHost && input.imapHost !== current.imapHost) ||
    (input.imapPort && input.imapPort !== current.imapPort) ||
    (input.imapSecurity && input.imapSecurity !== current.imapSecurity)
  ) {
    throw new Error('OAuth 账号只支持修改别名和同步开关；如需重新授权，请删除后重新添加。')
  }

  return {
    accountId: input.accountId,
    accountLabel: input.accountLabel,
    displayName: input.displayName,
    syncEnabled: input.syncEnabled,
    desktopNotificationsEnabled: input.desktopNotificationsEnabled,
    remoteDeletePolicy: input.remoteDeletePolicy,
    proxyMode: input.proxyMode,
    customProxyUrl: input.customProxyUrl,
    signatureMode: input.signatureMode,
    signatureId: input.signatureId,
    syncMode: input.syncMode,
    accountSyncIntervalMinutes: input.accountSyncIntervalMinutes,
    selectedFolderPaths: input.selectedFolderPaths
  }
}

function broadcastAccountCreated(account: AccountCreatedEvent['account']): void {
  const payload: AccountCreatedEvent = {
    account,
    requestedSync: true
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('accounts/created', payload)
    }
  }
}
