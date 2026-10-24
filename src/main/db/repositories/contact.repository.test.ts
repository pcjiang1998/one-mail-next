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
  addContactFromAddress,
  deleteContactGroup,
  deleteContacts,
  getContact,
  importContactsWithoutOverwrite,
  listContacts,
  listContactGroups,
  saveContact,
  saveContactGroup
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

  it('deletes contacts atomically, deduplicates IDs and preserves unrelated contacts and groups', () => {
    const group = saveContactGroup({ name: 'Shared' })
    const contacts = [1, 2, 3].map((id) =>
      saveContact({
        displayName: `Contact ${id}`,
        emails: [{ email: `contact${id}@example.com`, isDefault: true }],
        groupIds: [group.groupId]
      })
    )
    const ids = contacts.map((contact) => contact.contactId)
    expect(() => deleteContacts([ids[0], 99999])).toThrow()
    expect(getContact(ids[0])).toEqual(contacts[0])
    expect(deleteContacts([ids[0], ids[0], ids[1]])).toBe(2)
    expect(listContacts().map((contact) => contact.contactId)).toEqual([ids[2]])
    expect(listContactGroups()).toEqual([group])
    expect(listContacts('contact1@example.com')).toEqual([])
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

  it('supports multiple groups, combined search and group filtering, renaming and deleting groups', () => {
    const work = saveContactGroup({ name: ' 工作 ' })
    const friends = saveContactGroup({ name: '朋友' })
    const saved = saveContact({
      displayName: '张三',
      emails: [{ email: 'zhang@example.com', isDefault: true }],
      groupIds: [work.groupId, friends.groupId, work.groupId]
    })
    expect(saved.groups).toHaveLength(2)
    expect(listContacts('zhang', work.groupId)).toHaveLength(1)
    expect(listContacts('missing', work.groupId)).toHaveLength(0)
    expect(saveContactGroup({ groupId: work.groupId, name: '项目组' }).name).toBe('项目组')
    expect(getContact(saved.contactId)?.groups).toContainEqual({ ...work, name: '项目组' })
    expect(deleteContactGroup(friends.groupId)).toBe(true)
    expect(getContact(saved.contactId)?.groups).toEqual([{ ...work, name: '项目组' }])
    expect(listContactGroups()).toHaveLength(1)
    expect(saveContact({ ...saved, groupIds: [] }).groups).toEqual([])
    expect(listContacts(undefined, work.groupId)).toEqual([])
  })

  it('rolls back the entire contact edit if a selected group no longer exists', () => {
    const group = saveContactGroup({ name: '工作' })
    const saved = saveContact({
      displayName: '原姓名',
      emails: [{ email: 'old@example.com', isDefault: true }],
      groupIds: [group.groupId]
    })
    expect(() =>
      saveContact({
        ...saved,
        displayName: '不应保存',
        emails: [{ email: 'new@example.com', isDefault: true }],
        groupIds: [group.groupId + 1]
      })
    ).toThrow()
    expect(getContact(saved.contactId)).toEqual(saved)
    expect(() => saveContactGroup({ name: '工作' })).toThrow('同名')
  })

  it('quick-adds an address once without overwriting an existing contact', () => {
    const first = addContactFromAddress({ displayName: '原姓名', email: 'person@example.com' })
    const second = addContactFromAddress({ displayName: '另一个姓名', email: 'PERSON@example.com' })
    expect(second.contactId).toBe(first.contactId)
    expect(second.displayName).toBe('原姓名')
    expect(listContacts()).toHaveLength(1)
  })
})
