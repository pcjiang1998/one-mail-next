import { handleDatabaseIpc } from './database-handler'

import {
  addTrustedSender,
  clearPrivacyCache,
  listAccountPrivacyPolicies,
  removeTrustedSender,
  updateAccountPrivacyPolicy
} from '../db/repositories/privacy.repository'
import type { PrivacyPolicyUpdateInput, PrivacyTrustedSenderInput } from './types'

export function registerPrivacyIpc(): void {
  handleDatabaseIpc('privacy/list', () => listAccountPrivacyPolicies())
  handleDatabaseIpc('privacy/update', (_event, input: PrivacyPolicyUpdateInput) =>
    updateAccountPrivacyPolicy(input)
  )
  handleDatabaseIpc('privacy/addTrustedSender', (_event, input: PrivacyTrustedSenderInput) =>
    addTrustedSender(input)
  )
  handleDatabaseIpc('privacy/removeTrustedSender', (_event, trustedSenderId: number) =>
    removeTrustedSender(trustedSenderId)
  )
  handleDatabaseIpc('privacy/clearCache', (_event, accountId?: number) =>
    clearPrivacyCache(accountId)
  )
}
