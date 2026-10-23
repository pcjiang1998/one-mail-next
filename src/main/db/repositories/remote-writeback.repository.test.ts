import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: { getPath: vi.fn(() => tmpdir()) }
}))

vi.mock('electron', () => electronMock)

import {
  closeDatabase,
  getDatabase,
  initializeDatabase,
  setDatabaseKey,
  setDatabasePath
} from '../connection'
import {
  createRemoteWriteback,
  dismissRemoteWriteback,
  getRemoteWriteback,
  recoverInterruptedRemoteWritebacks,
  updateRemoteWritebackStatus
} from './remote-writeback.repository'

describe('remote writeback repository lifecycle', () => {
  let accountId: number

  beforeEach(() => {
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-writeback-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)

    const db = getDatabase()
    db.prepare(
      `INSERT INTO onemail_provider_presets (provider_key, display_name, domains_json, auth_type)
       VALUES ('test', 'Test Mail', '["example.com"]', 'password')`
    ).run()
    accountId = Number(
      db
        .prepare(
          `INSERT INTO onemail_mail_accounts (
           provider_key, email, normalized_email, account_label, auth_type,
           imap_host, imap_port, imap_security
         ) VALUES ('test', 'user@example.com', 'user@example.com', 'User', 'password',
                   'imap.example.com', 993, 'ssl_tls')`
        )
        .run().lastInsertRowid
    )
  })

  afterEach(() => closeDatabase())

  it('keeps active records and only permits dismissing terminal records', () => {
    const record = createRemoteWriteback({
      accountId,
      operationKind: 'mark_read',
      payload: { folderPath: 'INBOX', uid: 42 }
    })

    expect(record.status).toBe('queued')
    expect(dismissRemoteWriteback(record.writebackId)).toBe(false)
    expect(updateRemoteWritebackStatus(record.writebackId, 'running')?.status).toBe('running')
    expect(dismissRemoteWriteback(record.writebackId)).toBe(false)
    expect(updateRemoteWritebackStatus(record.writebackId, 'failed', '连接失败')?.status).toBe(
      'failed'
    )
    expect(dismissRemoteWriteback(record.writebackId)).toBe(true)
    expect(getRemoteWriteback(record.writebackId)).not.toBeNull()
  })

  it('marks interrupted running work as failed without auto-retrying it', () => {
    const queued = createRemoteWriteback({ accountId, operationKind: 'mark_read' })
    const running = createRemoteWriteback({ accountId, operationKind: 'mark_unread' })
    updateRemoteWritebackStatus(running.writebackId, 'running')

    expect(recoverInterruptedRemoteWritebacks()).toBe(1)
    expect(getRemoteWriteback(queued.writebackId)?.status).toBe('queued')
    const recovered = getRemoteWriteback(running.writebackId)
    expect(recovered?.status).toBe('failed')
    expect(recovered?.errorMessage).toContain('未自动重试')
  })
})
