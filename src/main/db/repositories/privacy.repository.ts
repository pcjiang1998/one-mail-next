import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../connection'
import { getSettings } from './settings.repository'
import {
  getDefaultPrivacyMode,
  matchesTrustedSender,
  normalizeTrustedValue
} from '../../../shared/mail-privacy'
import type {
  AccountPrivacyPolicy,
  AccountPrivacyMode,
  PrivacyTrustedSender,
  PrivacyTrustedSenderInput,
  PrivacyPolicyUpdateInput,
  PrivacyMode
} from '../../../shared/types'

type TrustedRow = SqliteRow & {
  trusted_sender_id: number
  account_id: number
  match_type: 'email' | 'domain'
  match_value: string
}

export function listAccountPrivacyPolicies(): AccountPrivacyPolicy[] {
  const db = getDatabase()
  const globalMode = getDefaultPrivacyMode(getSettings())
  const accounts = db
    .prepare<{
      account_id: number
    }>('SELECT account_id FROM onemail_mail_accounts ORDER BY sort_order, account_id')
    .all()

  return accounts.map((account) => getAccountPrivacyPolicy(account.account_id, globalMode))
}

export function getAccountPrivacyPolicy(
  accountId: number,
  fallbackMode?: PrivacyMode
): AccountPrivacyPolicy {
  assertAccountExists(accountId)
  const globalMode = fallbackMode ?? getDefaultPrivacyMode(getSettings())
  const row = getDatabase()
    .prepare<{
      mode: AccountPrivacyMode
    }>('SELECT mode FROM onemail_account_privacy_policies WHERE account_id = :accountId')
    .get({ accountId })
  const mode = row?.mode ?? 'inherit'
  return {
    accountId,
    mode,
    resolvedMode: mode === 'inherit' ? globalMode : mode,
    trustedSenders: listTrustedSenders(accountId)
  }
}

export function updateAccountPrivacyPolicy(input: PrivacyPolicyUpdateInput): AccountPrivacyPolicy {
  if (!input || !['inherit', 'unrestricted', 'loose', 'strict'].includes(input.mode)) {
    throw new Error('不支持的隐私策略。')
  }
  assertAccountExists(input.accountId)
  getDatabase()
    .prepare(
      `INSERT INTO onemail_account_privacy_policies (account_id, mode, updated_at)
       VALUES (:accountId, :mode, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(account_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`
    )
    .run({ accountId: input.accountId, mode: input.mode })
  return getAccountPrivacyPolicy(input.accountId)
}

export function listTrustedSenders(accountId: number): PrivacyTrustedSender[] {
  return getDatabase()
    .prepare<TrustedRow>(
      `SELECT trusted_sender_id, account_id, match_type, match_value
       FROM onemail_privacy_trusted_senders
       WHERE account_id = :accountId
       ORDER BY match_type, match_value COLLATE NOCASE`
    )
    .all({ accountId })
    .map((row) => ({
      trustedSenderId: toNumber(row.trusted_sender_id),
      accountId: toNumber(row.account_id),
      matchType: row.match_type,
      matchValue: row.match_value
    }))
}

export function addTrustedSender(input: PrivacyTrustedSenderInput): PrivacyTrustedSender {
  if (!input || !['email', 'domain'].includes(input.matchType)) {
    throw new Error('请输入有效的邮箱或邮箱域名。')
  }
  assertAccountExists(input.accountId)
  const value = normalizeTrustedValue(input.matchType, input.matchValue)
  if (!value) throw new Error('请输入有效的邮箱或邮箱域名。')

  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO onemail_privacy_trusted_senders (account_id, match_type, match_value)
       VALUES (:accountId, :matchType, :matchValue)`
    )
    .run({ accountId: input.accountId, matchType: input.matchType, matchValue: value })

  const row = getDatabase()
    .prepare<TrustedRow>(
      `SELECT trusted_sender_id, account_id, match_type, match_value
       FROM onemail_privacy_trusted_senders
       WHERE account_id = :accountId AND match_type = :matchType AND match_value = :matchValue`
    )
    .get({ accountId: input.accountId, matchType: input.matchType, matchValue: value })
  if (!row) throw new Error(`添加可信发件人失败（${result.changes}）。`)

  return {
    trustedSenderId: toNumber(row.trusted_sender_id),
    accountId: toNumber(row.account_id),
    matchType: row.match_type,
    matchValue: row.match_value
  }
}

export function removeTrustedSender(trustedSenderId: number): boolean {
  if (!Number.isSafeInteger(trustedSenderId) || trustedSenderId <= 0) {
    throw new Error('无效的可信发件人。')
  }
  const result = getDatabase()
    .prepare(
      'DELETE FROM onemail_privacy_trusted_senders WHERE trusted_sender_id = :trustedSenderId'
    )
    .run({ trustedSenderId })
  return result.changes > 0
}

export function clearPrivacyCache(accountId?: number): number {
  if (accountId !== undefined) assertAccountExists(accountId)
  const db = getDatabase()
  const where = accountId !== undefined ? 'WHERE m.account_id = :accountId' : ''
  const params = accountId !== undefined ? { accountId } : undefined
  const messages = `SELECT m.message_id FROM onemail_mail_messages m ${where}`
  db.exec('SAVEPOINT privacy_clear_cache')
  try {
    const result = db
      .prepare(`DELETE FROM onemail_message_bodies WHERE message_id IN (${messages})`)
      .run(params)
    db.prepare(
      `UPDATE onemail_mail_messages SET body_status = 'none', body_error = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE message_id IN (${messages})`
    ).run(params)
    // Keep the header search entry, but do not return stale full-body search hits.
    db.prepare(
      `UPDATE onemail_message_search SET body_text = '' WHERE message_id IN (${messages})`
    ).run(params)
    db.exec('RELEASE SAVEPOINT privacy_clear_cache')
    return result.changes
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT privacy_clear_cache')
    db.exec('RELEASE SAVEPOINT privacy_clear_cache')
    throw error
  }
}

function assertAccountExists(accountId: number): void {
  if (
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    !getDatabase()
      .prepare('SELECT account_id FROM onemail_mail_accounts WHERE account_id = :accountId')
      .get({ accountId })
  ) {
    throw new Error('邮箱不存在。')
  }
}

export function isTrustedSender(
  accountId: number,
  senderEmail: string | undefined,
  policy?: AccountPrivacyPolicy
): boolean {
  if (policy && policy.accountId !== accountId) return false
  return matchesTrustedSender(
    accountId,
    senderEmail,
    policy?.trustedSenders ?? listTrustedSenders(accountId)
  )
}

export function toPrivacyMode(value: unknown): PrivacyMode {
  return value === 'unrestricted' || value === 'loose' || value === 'strict' ? value : 'strict'
}

export function readOptionalPrivacyMode(value: unknown): PrivacyMode | undefined {
  const normalized = toOptionalString(value)
  return normalized ? toPrivacyMode(normalized) : undefined
}
