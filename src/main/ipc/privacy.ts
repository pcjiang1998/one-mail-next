import { ipcMain } from 'electron'

import {
  addTrustedSender,
  clearPrivacyCache,
  listAccountPrivacyPolicies,
  removeTrustedSender,
  updateAccountPrivacyPolicy
} from '../db/repositories/privacy.repository'
import type { PrivacyPolicyUpdateInput, PrivacyTrustedSenderInput } from './types'

export function registerPrivacyIpc(): void {
  ipcMain.handle('privacy/list', () => listAccountPrivacyPolicies())
  ipcMain.handle('privacy/update', (_event, input: PrivacyPolicyUpdateInput) =>
    updateAccountPrivacyPolicy(input)
  )
  ipcMain.handle('privacy/addTrustedSender', (_event, input: PrivacyTrustedSenderInput) =>
    addTrustedSender(input)
  )
  ipcMain.handle('privacy/removeTrustedSender', (_event, trustedSenderId: number) =>
    removeTrustedSender(trustedSenderId)
  )
  ipcMain.handle('privacy/clearCache', (_event, accountId?: number) => clearPrivacyCache(accountId))
}
