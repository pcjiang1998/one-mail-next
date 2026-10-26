import { BrowserWindow } from 'electron'

import type { RemoteWriteback, WritebackOperationKind, WritebackStatus } from '../../shared/types'
import { getDatabase, type SqliteDatabaseSync } from '../db/connection'
import {
  createRemoteWriteback,
  dismissCompletedWritebacks,
  dismissRemoteWriteback,
  getRemoteMessageIdentity,
  getRemoteWriteback,
  getRemoteWritebackPayload,
  getWritebackStatus,
  hasNewerFlagWriteback,
  listRemoteWritebacks,
  recoverInterruptedRemoteWritebacks,
  updateRemoteWritebackStatus
} from '../db/repositories/remote-writeback.repository'
import {
  getMessage,
  getMessageReadStateTarget,
  markMessageRemoteMissing,
  updateMessageReadState
} from '../db/repositories/message.repository'
import {
  RemoteMessageMissingError,
  REMOTE_MESSAGE_MISSING_NOTICE
} from '../mail/remote-message-error'

export type QueueRemoteWritebackInput = {
  accountId: number
  messageId?: number
  operationKind: WritebackOperationKind
  messageSubject?: string
  messageSender?: string
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

const initializedDatabases = new WeakSet<SqliteDatabaseSync>()

// Called by IPC registration and lazily by every public entry point. A fresh database
// (including a restored backup) must never silently replay unfinished remote commands.
export function initializeRemoteWritebacks(): void {
  const database = getDatabase()
  if (initializedDatabases.has(database)) return
  recoverInterruptedRemoteWritebacks()
  initializedDatabases.add(database)
}

export function queueRemoteWriteback(input: QueueRemoteWritebackInput): RemoteWriteback {
  initializeRemoteWritebacks()
  const message = input.messageId ? getMessage(input.messageId) : null
  const identity = input.messageId ? getRemoteMessageIdentity(input.messageId) : null
  if (identity && identity.accountId !== input.accountId) {
    throw new Error('写回记录的账号与邮件不匹配。')
  }
  const record = createRemoteWriteback({
    ...input,
    messageSubject: input.messageSubject ?? message?.subject,
    messageSender: input.messageSender ?? message?.fromEmail,
    payload: { ...(identity ?? {}), ...(input.payload ?? {}) }
  })
  broadcastWritebackChanged()
  return record
}

export function markRemoteWritebackRunning(writebackId: number): RemoteWriteback | null {
  initializeRemoteWritebacks()
  const record = updateRemoteWritebackStatus(writebackId, 'running')
  broadcastWritebackChanged()
  return record
}

// Remote success must never be turned into a retryable operation by an audit/UI failure.
export function markRemoteWritebackSuccess(writebackId: number): RemoteWriteback | null {
  return finishRemoteWriteback(writebackId, 'success')
}

export function markRemoteWritebackFailed(
  writebackId: number,
  errorMessage: string
): RemoteWriteback | null {
  return finishRemoteWriteback(writebackId, 'failed', errorMessage)
}

export function cancelRemoteWriteback(writebackId: number, reason: string): RemoteWriteback | null {
  return finishRemoteWriteback(writebackId, 'cancelled', reason)
}

function finishRemoteWriteback(
  writebackId: number,
  status: 'success' | 'failed' | 'cancelled',
  errorMessage?: string
): RemoteWriteback | null {
  try {
    const record = updateRemoteWritebackStatus(writebackId, status, errorMessage)
    broadcastWritebackChanged()
    return record
  } catch (error) {
    console.error('保存远端写回结果失败；不会重新执行远端操作。', writebackId, error)
    return null
  }
}

export function listWritebackRecords(): RemoteWriteback[] {
  initializeRemoteWritebacks()
  return listRemoteWritebacks()
}

export function getWritebackStatusSnapshot(): WritebackStatus {
  initializeRemoteWritebacks()
  return getWritebackStatus()
}

export function clearWriteback(writebackId: number): boolean {
  initializeRemoteWritebacks()
  const cleared = dismissRemoteWriteback(writebackId)
  if (cleared) broadcastWritebackChanged()
  return cleared
}

export function clearCompletedWritebacks(): number {
  initializeRemoteWritebacks()
  const count = dismissCompletedWritebacks()
  if (count > 0) broadcastWritebackChanged()
  return count
}

export async function retryWriteback(writebackId: number): Promise<boolean> {
  initializeRemoteWritebacks()
  const record = getRemoteWriteback(writebackId)
  if (!record || record.status !== 'failed') return false

  // SMTP/APPEND/COPY/MOVE/deletion can have succeeded even when the response was lost.
  // They are deliberately not replayable from an audit record.
  if (!['mark_read', 'mark_unread', 'mark_answered'].includes(record.operationKind)) {
    throw new Error(
      '此操作可能已在远端执行，为避免重复发送、移动或删除，不能直接重试。请先同步核对。'
    )
  }
  if (hasNewerFlagWriteback(record)) {
    throw new Error('该邮件已有较新的状态操作，不能重试旧记录以免覆盖最新状态。')
  }
  const payload = getRemoteWritebackPayload(writebackId)
  if (!payload) throw new Error('写回记录缺少有效的远端定位信息，请先同步邮件。')
  const readStateRevision = record.messageId
    ? getMessageReadStateTarget(record.messageId)?.readStateRevision
    : undefined

  // Claim synchronously before the first await: duplicate clicks cannot run twice.
  if (!markRemoteWritebackRunning(writebackId)) return false
  try {
    const { executeFlagWritebackRetry } = await import('./remote-writeback-executor')
    await executeFlagWritebackRetry(record, payload)
    markRemoteWritebackSuccess(writebackId)
    return true
  } catch (error) {
    if (error instanceof RemoteMessageMissingError && record.messageId) {
      markMessageRemoteMissing(record.messageId)
      if (
        !hasNewerFlagWriteback(record) &&
        getMessageReadStateTarget(record.messageId)?.readStateRevision === readStateRevision &&
        (record.operationKind === 'mark_read' || record.operationKind === 'mark_unread')
      ) {
        updateMessageReadState(record.messageId, record.operationKind === 'mark_read')
      }
      cancelRemoteWriteback(writebackId, REMOTE_MESSAGE_MISSING_NOTICE)
      return false
    }
    markRemoteWritebackFailed(writebackId, error instanceof Error ? error.message : String(error))
    throw error
  }
}

export function broadcastWritebackChanged(): void {
  // A closing renderer (or broken audit query) must not affect an SMTP/IMAP result.
  try {
    const snapshot = getWritebackStatus()
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed()) window.webContents.send('writeback/changed', snapshot)
      } catch (error) {
        console.error('通知远端写回状态失败。', error)
      }
    }
  } catch (error) {
    console.error('读取远端写回状态失败。', error)
  }
}
