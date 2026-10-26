import { randomUUID } from 'node:crypto'

import { getDatabase, toNumber, toOptionalString, type SqliteRow } from '../connection'
import type {
  RemoteWriteback,
  WritebackOperationKind,
  WritebackOperationStatus,
  WritebackStatus
} from '../../../shared/types'

type WritebackRow = SqliteRow & {
  writeback_id: number
  account_id: number
  account_email: string | null
  message_id: number | null
  operation_kind: WritebackOperationKind
  status: WritebackOperationStatus
  message_subject_snapshot: string | null
  message_sender_snapshot: string | null
  error_message: string | null
  payload_json: string
  attempt_count: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type CreateWritebackInput = {
  accountId: number
  messageId?: number
  operationKind: WritebackOperationKind
  messageSubject?: string
  messageSender?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

export function createRemoteWriteback(input: CreateWritebackInput): RemoteWriteback {
  const db = getDatabase()
  const idempotencyKey = input.idempotencyKey ?? randomUUID()
  const existing = db
    .prepare<WritebackRow>(
      `SELECT w.*, a.email AS account_email
       FROM onemail_remote_writebacks w
       LEFT JOIN onemail_mail_accounts a ON a.account_id = w.account_id
       WHERE w.idempotency_key = :idempotencyKey`
    )
    .get({ idempotencyKey })

  if (existing) return mapRow(existing)

  const result = db
    .prepare(
      `INSERT INTO onemail_remote_writebacks (
         account_id, message_id, operation_kind, message_subject_snapshot,
         message_sender_snapshot, payload_json, idempotency_key
       ) VALUES (
         :accountId, :messageId, :operationKind, :messageSubject,
         :messageSender, :payloadJson, :idempotencyKey
       )`
    )
    .run({
      accountId: input.accountId,
      messageId: input.messageId ?? null,
      operationKind: input.operationKind,
      messageSubject: input.messageSubject ?? null,
      messageSender: input.messageSender ?? null,
      payloadJson: JSON.stringify(input.payload ?? {}),
      idempotencyKey
    })

  const created = getRemoteWriteback(Number(result.lastInsertRowid))
  if (!created) throw new Error('创建远端写回记录失败。')
  return created
}

export function getRemoteWriteback(writebackId: number): RemoteWriteback | null {
  const row = getDatabase()
    .prepare<WritebackRow>(
      `SELECT w.*, a.email AS account_email
       FROM onemail_remote_writebacks w
       LEFT JOIN onemail_mail_accounts a ON a.account_id = w.account_id
       WHERE w.writeback_id = :writebackId`
    )
    .get({ writebackId })
  return row ? mapRow(row) : null
}

// Payloads stay in the main process: never expose raw MIME or remote identifiers over IPC.
export function getRemoteWritebackPayload(writebackId: number): Record<string, unknown> | null {
  const row = getDatabase()
    .prepare<
      SqliteRow & { payload_json: string }
    >('SELECT payload_json FROM onemail_remote_writebacks WHERE writeback_id = :writebackId')
    .get({ writebackId })
  if (!row) return null
  try {
    const payload: unknown = JSON.parse(row.payload_json)
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export type RemoteMessageIdentity = {
  accountId: number
  folderId: number
  folderPath: string
  uid: number
  uidValidity?: string
  rfc822MessageId?: string
}

export function getRemoteMessageIdentity(messageId: number): RemoteMessageIdentity | null {
  const row = getDatabase()
    .prepare<SqliteRow>(
      `SELECT m.account_id, m.folder_id, m.uid, m.rfc822_message_id,
              f.path AS folder_path, f.uid_validity
       FROM onemail_mail_messages m
       JOIN onemail_mail_folders f ON f.folder_id = m.folder_id
       WHERE m.message_id = :messageId AND m.remote_deleted = 0 AND m.remote_missing = 0`
    )
    .get({ messageId })
  return row
    ? {
        accountId: toNumber(row.account_id),
        folderId: toNumber(row.folder_id),
        folderPath: String(row.folder_path),
        uid: toNumber(row.uid),
        uidValidity: toOptionalString(row.uid_validity),
        rfc822MessageId: toOptionalString(row.rfc822_message_id)
      }
    : null
}

export function recoverInterruptedRemoteWritebacks(): number {
  return getDatabase()
    .prepare(
      `UPDATE onemail_remote_writebacks
       SET status = 'failed',
           error_message = '应用上次退出时操作未完成，远端结果可能不确定；未自动重试。请先同步核对，避免重复发送或删除。',
           finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE status = 'running'`
    )
    .run().changes
}

export function hasNewerFlagWriteback(record: RemoteWriteback): boolean {
  if (!record.messageId) return false
  const kinds =
    record.operationKind === 'mark_answered' ? "'mark_answered'" : "'mark_read', 'mark_unread'"
  return Boolean(
    getDatabase()
      .prepare<SqliteRow>(
        `SELECT writeback_id FROM onemail_remote_writebacks
       WHERE message_id = :messageId AND account_id = :accountId
         AND writeback_id > :writebackId AND operation_kind IN (${kinds})
       LIMIT 1`
      )
      .get({
        messageId: record.messageId,
        accountId: record.accountId,
        writebackId: record.writebackId
      })
  )
}

export function listRemoteWritebacks(): RemoteWriteback[] {
  return getDatabase()
    .prepare<WritebackRow>(
      `SELECT w.*, a.email AS account_email
       FROM onemail_remote_writebacks w
       LEFT JOIN onemail_mail_accounts a ON a.account_id = w.account_id
       WHERE w.dismissed_at IS NULL
       ORDER BY CASE w.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
                w.created_at DESC`
    )
    .all()
    .map(mapRow)
}

export function getWritebackStatus(): WritebackStatus {
  const items = listRemoteWritebacks()
  return {
    queuedCount: items.filter((item) => item.status === 'queued').length,
    runningCount: items.filter((item) => item.status === 'running').length,
    failedCount: items.filter((item) => item.status === 'failed').length,
    successCount: items.filter((item) => item.status === 'success').length,
    items
  }
}

export function updateRemoteWritebackStatus(
  writebackId: number,
  status: WritebackOperationStatus,
  errorMessage?: string
): RemoteWriteback | null {
  const result = getDatabase()
    .prepare(
      `UPDATE onemail_remote_writebacks
       SET status = :status,
           error_message = :errorMessage,
           attempt_count = CASE WHEN :status = 'running' THEN attempt_count + 1 ELSE attempt_count END,
           started_at = CASE WHEN :status = 'running' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE started_at END,
           finished_at = CASE WHEN :status IN ('success', 'failed', 'cancelled') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,
           dismissed_at = CASE WHEN :status = 'running' THEN NULL ELSE dismissed_at END
       WHERE writeback_id = :writebackId
         AND ((:status = 'running' AND status IN ('queued', 'failed'))
           OR (:status IN ('success', 'failed', 'cancelled') AND status = 'running'))`
    )
    .run({ writebackId, status, errorMessage: errorMessage?.slice(0, 2000) ?? null })
  return result.changes > 0 ? getRemoteWriteback(writebackId) : null
}

export function dismissRemoteWriteback(writebackId: number): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE onemail_remote_writebacks
       SET dismissed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE writeback_id = :writebackId
         AND status IN ('success', 'failed', 'cancelled')`
    )
    .run({ writebackId })
  return result.changes > 0
}

export function dismissCompletedWritebacks(): number {
  const result = getDatabase()
    .prepare(
      `UPDATE onemail_remote_writebacks
       SET dismissed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE status IN ('success', 'failed', 'cancelled')
         AND dismissed_at IS NULL`
    )
    .run()
  return result.changes
}

function mapRow(row: WritebackRow): RemoteWriteback {
  return {
    writebackId: toNumber(row.writeback_id),
    accountId: toNumber(row.account_id),
    accountEmail: toOptionalString(row.account_email),
    messageId: row.message_id === null ? undefined : toNumber(row.message_id),
    operationKind: row.operation_kind,
    status: row.status,
    messageSubject: toOptionalString(row.message_subject_snapshot),
    messageSender: toOptionalString(row.message_sender_snapshot),
    errorMessage: toOptionalString(row.error_message),
    attemptCount: toNumber(row.attempt_count),
    createdAt: row.created_at,
    startedAt: toOptionalString(row.started_at),
    finishedAt: toOptionalString(row.finished_at)
  }
}
