import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/repositories/settings.repository', () => ({
  getBackupSyncSettingsForMain: vi.fn(),
  resolveBackupSyncSettingsForMain: vi.fn()
}))
vi.mock('./database-backup', () => ({
  createDatabaseSqlBackup: vi.fn(),
  importDatabaseSqlBackupContent: vi.fn()
}))

import { getBackupSyncSettingsForMain } from '../db/repositories/settings.repository'
import { createDatabaseSqlBackup } from './database-backup'
import { protectRemoteBackup, unprotectRemoteBackup, uploadBackupSync } from './backup-sync'

afterEach(() => vi.unstubAllGlobals())

describe('remote backup data protection', () => {
  it('round-trips encrypted backups with the matching read key', () => {
    const sql = 'CREATE TABLE example (id INTEGER);'
    const protectedValue = protectRemoteBackup(sql, 'read-key-123')

    expect(protectedValue).toMatch(/^ONEMAIL-REMOTE-BACKUP-V2\n/)
    expect(protectedValue).not.toContain(sql)
    expect(unprotectRemoteBackup(protectedValue, 'read-key-123')).toBe(sql)
  })

  it('rejects wrong keys and legacy plaintext backups', () => {
    const protectedValue = protectRemoteBackup('SELECT 1;', 'read-key-123')

    expect(() => unprotectRemoteBackup(protectedValue, 'wrong-key')).toThrow('读取密钥错误')
    expect(() => unprotectRemoteBackup('SELECT 1;', 'read-key-123')).toThrow('不兼容旧版明文')
  })

  it.each(['webdav', 's3'] as const)(
    'forwards settings-only selection to %s uploads',
    async (provider) => {
      vi.mocked(getBackupSyncSettingsForMain).mockReturnValue(
        provider === 'webdav'
          ? { provider, remoteUrl: 'https://example.com/backup.sql', readKey: 'read-key' }
          : {
              provider,
              endpoint: 'https://s3.example.com',
              region: 'us-east-1',
              bucket: 'mail',
              key: 'backup.sql',
              accessKeyId: 'access',
              secretAccessKey: 'secret',
              readKey: 'read-key'
            }
      )
      vi.mocked(createDatabaseSqlBackup).mockReturnValue({
        key: 'test-key',
        exportedAt: 1,
        fileName: 'test.sql',
        sql: '-- settings-only backup'
      })
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)
      await uploadBackupSync({ includeMail: false })
      expect(createDatabaseSqlBackup).toHaveBeenLastCalledWith({ includeMail: false })
      const request = fetchMock.mock.calls[0][1] as RequestInit
      expect(request.method).toBe('PUT')
      expect(unprotectRemoteBackup(request.body as string, 'read-key')).toBe(
        '-- settings-only backup'
      )
    }
  )
})
