import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => tmpdir())
  }
}))

vi.mock('electron', () => electronMock)

import { closeDatabase, initializeDatabase, setDatabaseKey, setDatabasePath } from '../connection'
import {
  getContact,
  importContactsWithoutOverwrite,
  listContacts,
  saveContact
} from './contact.repository'

describe('contact repository', () => {
  beforeEach(() => {
    const testDir = mkdtempSync(join(tmpdir(), 'onemail-contact-test-'))
    electronMock.app.getPath.mockReturnValue(testDir)
    setDatabaseKey('k00000000000000000000000000')
    const databasePath = join(testDir, 'test.sqlite')
    setDatabasePath(databasePath)
    initializeDatabase(databasePath)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('saves multiple emails atomically and keeps exactly one default', () => {
    const saved = saveContact({
      displayName: '  张三  ',
      note: '朋友',
      isStarred: true,
      emails: [
        { email: 'zhang@example.com', label: '工作', isDefault: true },
        { email: 'zhang.home@example.com', label: '家庭', isDefault: false }
      ]
    })

    expect(saved.displayName).toBe('张三')
    expect(saved.isStarred).toBe(true)
    expect(saved.emails.map((email) => email.email)).toEqual([
      'zhang@example.com',
      'zhang.home@example.com'
    ])
    expect(saved.emails.filter((email) => email.isDefault)).toHaveLength(1)
    expect(listContacts('zhang.home')).toHaveLength(1)
    expect(listContacts('%')).toHaveLength(0)
  })

  it('rejects invalid input before changing an existing contact', () => {
    const saved = saveContact({
      displayName: '原联系人',
      emails: [{ email: 'original@example.com', isDefault: true }]
    })

    expect(() =>
      saveContact({
        contactId: saved.contactId,
        displayName: '不应保存',
        emails: [
          { email: 'new@example.com', isDefault: true },
          { email: 'new@example.com', isDefault: false }
        ]
      })
    ).toThrow('重复')

    expect(getContact(saved.contactId)).toMatchObject({
      displayName: '原联系人',
      emails: [{ email: 'original@example.com' }]
    })
  })

  it('imports a batch without overwriting conflicts and rolls back invalid batches', () => {
    const existing = saveContact({
      displayName: '已有联系人',
      note: '保留',
      emails: [{ email: 'existing@example.com', isDefault: true }]
    })

    const result = importContactsWithoutOverwrite([
      {
        displayName: '冲突联系人',
        note: '不应覆盖',
        emails: [{ email: 'EXISTING@example.com', isDefault: true }]
      },
      {
        displayName: '新联系人',
        emails: [{ email: 'new@example.com', isDefault: true }]
      }
    ])

    expect(result).toMatchObject({ imported: 1, skipped: 1 })
    expect(getContact(existing.contactId)).toMatchObject({
      displayName: '已有联系人',
      note: '保留'
    })
    expect(listContacts()).toHaveLength(2)

    expect(() =>
      importContactsWithoutOverwrite([
        { displayName: '不会写入', emails: [{ email: 'another@example.com', isDefault: true }] },
        { displayName: '非法', emails: [{ email: 'not-an-email', isDefault: true }] }
      ])
    ).toThrow('格式无效')
    expect(listContacts()).toHaveLength(2)
  })
})
