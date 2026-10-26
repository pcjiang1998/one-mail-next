import { getDatabase, toNumber, toOptionalString } from '../connection'
import { withDatabaseTask } from '../activity'
import type { SyncStatus } from '../../ipc/types'
import { syncAccountMailbox, type AccountMailboxSyncMode } from '../../mail/imap-sync'
import { isImapAuthErrorMessage, isImapNetworkErrorMessage } from '../../mail/imap-errors'
import { getAccount } from './account.repository'
import { syncPop3Account } from '../../mail/pop3-sync'
import { processPendingMailRules } from '../../services/mail-rule.service'

type SyncRunRow = {
  account_id: number | null
  started_at: string
}

export type AccountSyncResult = {
  accountId: number
  scannedCount: number
  insertedCount: number
  updatedCount: number
  newMailCount: number
}

const activeAccountSyncs = new Map<number, Promise<AccountSyncResult>>()

export function syncAccountNow(
  accountId: number,
  mode: AccountMailboxSyncMode = 'refresh',
  startedAt = new Date().toISOString()
): Promise<AccountSyncResult> {
  const existingSync = activeAccountSyncs.get(accountId)
  if (existingSync) return existingSync

  const syncPromise = withDatabaseTask(() => syncSingleAccount(accountId, mode, startedAt)).finally(
    () => {
      if (activeAccountSyncs.get(accountId) === syncPromise) {
        activeAccountSyncs.delete(accountId)
      }
    }
  )
  activeAccountSyncs.set(accountId, syncPromise)

  return syncPromise
}

export function getSyncStatus(): SyncStatus {
  markStaleRunningSyncsFailed()
  const rows = getDatabase()
    .prepare<SyncRunRow>(
      `
      SELECT account_id, started_at
      FROM onemail_sync_runs
      WHERE status = 'running'
      ORDER BY started_at DESC
      `
    )
    .all()

  const accountIds = rows
    .map((row) => (row.account_id === null ? undefined : toNumber(row.account_id)))
    .filter((accountId): accountId is number => accountId !== undefined)

  return {
    running: rows.length > 0,
    accountIds,
    lastStartedAt: toOptionalString(rows[0]?.started_at)
  }
}

function markStaleRunningSyncsFailed(): void {
  getDatabase()
    .prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'failed',
          error_count = CASE WHEN error_count = 0 THEN 1 ELSE error_count END,
          error_message = COALESCE(error_message, '同步被新的同步任务重置。'),
          finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE status = 'running'
        AND datetime(started_at) < datetime('now', '-5 minutes')
      `
    )
    .run()
}

async function syncSingleAccount(
  accountId: number,
  mode: AccountMailboxSyncMode,
  startedAt: string
): Promise<AccountSyncResult> {
  const db = getDatabase()
  const result = db
    .prepare(
      `
      INSERT INTO onemail_sync_runs (account_id, sync_kind, status, started_at)
      VALUES (:accountId, 'message_headers', 'running', :startedAt)
      `
    )
    .run({ accountId, startedAt })
  const syncRunId = Number(result.lastInsertRowid)

  db.prepare(
    `
    UPDATE onemail_mail_accounts
    SET status = 'syncing', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE account_id = :accountId
    `
  ).run({ accountId })

  try {
    const account = getAccount(accountId)
    if (!account) throw new Error(`Account not found: ${accountId}`)
    const stats =
      account.receiveProtocol === 'pop3'
        ? await syncPop3Account(accountId, mode === 'initial')
        : await syncAccountMailbox(accountId, mode)

    // Historical post-sync admission contract (now applied inside protocol transactions):
    // The protocol-specific sync has committed its message writes at this point. Use the
    // insertion timestamp as a conservative admission boundary so rules never scan history or
    // re-run on ordinary header updates. Initial sync is explicitly skipped by the rule engine.
    // Range backfills have their own marker and cannot enter the new-message rule queue.
    // Admission now commits inside each protocol's insertion transaction.
    try {
      void processPendingMailRules().catch((error) =>
        console.error('处理新邮件规则失败；邮件同步结果仍保留。', error)
      )
    } catch (ruleError) {
      console.error('登记新邮件规则失败；邮件同步结果仍保留。', ruleError)
    }

    db.prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'success',
          scanned_count = :scannedCount,
          inserted_count = :insertedCount,
          updated_count = :updatedCount,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE sync_run_id = :syncRunId
      `
    ).run({
      syncRunId,
      scannedCount: stats.scannedCount,
      insertedCount: stats.insertedCount,
      updatedCount: stats.updatedCount
    })
    return { accountId, ...stats }
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步账号失败。'
    const accountStatus = isImapAuthErrorMessage(message)
      ? 'auth_error'
      : isImapNetworkErrorMessage(message)
        ? 'network_error'
        : 'sync_error'
    const credentialState = accountStatus === 'auth_error' ? 'invalid' : undefined
    db.prepare(
      `
      UPDATE onemail_sync_runs
      SET status = 'failed',
          error_count = 1,
          error_message = :message,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE sync_run_id = :syncRunId
      `
    ).run({ syncRunId, message })
    db.prepare(
      `
      UPDATE onemail_mail_accounts
      SET status = :accountStatus,
          credential_state = COALESCE(:credentialState, credential_state),
          last_error = :message,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = :accountId
    `
    ).run({ accountId, accountStatus, credentialState: credentialState ?? null, message })
    throw error
  }
}
