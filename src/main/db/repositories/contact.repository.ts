import { domainToASCII } from 'node:url'

import { getDatabase, toBoolean, toNumber, type SqliteRow } from '../connection'
import type { Contact, ContactEmail, ContactInput } from '../../../shared/types'

export const MAX_CONTACT_EMAILS = 50
export const MAX_IMPORT_CONTACTS = 1000

export function listContacts(search?: string): Contact[] {
  if (search !== undefined && (typeof search !== 'string' || search.length > 1000)) {
    throw new Error('搜索内容无效或过长。')
  }
  const normalizedSearch = search?.trim() ?? ''
  // Treat SQL wildcards as literal characters when searching addresses and notes.
  const likeSearch = `%${normalizedSearch.replace(/[\\%_]/g, '\\$&')}%`
  const rows = getDatabase()
    .prepare<ContactRow>(
      `SELECT c.contact_id, c.display_name, c.note, c.is_starred, c.created_at, c.updated_at
       FROM onemail_contacts c
       WHERE (:search = '' OR c.display_name LIKE :likeSearch ESCAPE '\\'
          OR c.note LIKE :likeSearch ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM onemail_contact_emails ce
            WHERE ce.contact_id = c.contact_id AND ce.email LIKE :likeSearch ESCAPE '\\'
          ))
       ORDER BY c.is_starred DESC, c.display_name COLLATE NOCASE, c.contact_id`
    )
    .all({ search: normalizedSearch, likeSearch })

  return rows.map(mapContactRow)
}

export function getContact(contactId: number): Contact | null {
  validateContactId(contactId)
  const row = getDatabase()
    .prepare<ContactRow>(
      `SELECT contact_id, display_name, note, is_starred, created_at, updated_at
       FROM onemail_contacts WHERE contact_id = :contactId`
    )
    .get({ contactId })
  return row ? mapContactRow(row) : null
}

export function saveContact(input: ContactInput): Contact {
  const normalized = normalizeContactInput(input)
  return inContactTransaction(() => writeContact(normalized))
}

/** Validate the entire batch first; never change a contact already in the address book. */
export function importContactsWithoutOverwrite(inputs: ContactInput[]): {
  imported: number
  skipped: number
  contacts: Contact[]
} {
  if (!Array.isArray(inputs) || inputs.length > MAX_IMPORT_CONTACTS) {
    throw new Error(`一次最多导入 ${MAX_IMPORT_CONTACTS} 个联系人。`)
  }
  const normalized = inputs.map((input) => {
    const contact = normalizeContactInput(input)
    if (contact.contactId !== undefined) throw new Error('导入不能更新已有联系人。')
    return contact
  })

  return inContactTransaction(() => {
    const usedEmails = new Set(
      getDatabase()
        .prepare<{ normalized_email: string }>(
          'SELECT normalized_email FROM onemail_contact_emails'
        )
        .all()
        .map((row) => row.normalized_email)
    )
    let imported = 0
    let skipped = 0
    for (const contact of normalized) {
      if (contact.emails.some((email) => usedEmails.has(normalizeEmail(email.email)))) {
        skipped += 1
        continue
      }
      writeContact(contact)
      contact.emails.forEach((email) => usedEmails.add(normalizeEmail(email.email)))
      imported += 1
    }
    return { imported, skipped, contacts: listContacts() }
  })
}

export function deleteContact(contactId: number): boolean {
  validateContactId(contactId)
  const result = getDatabase()
    .prepare('DELETE FROM onemail_contacts WHERE contact_id = :contactId')
    .run({ contactId })
  return result.changes > 0
}

export function findContactByEmail(email: string): Contact | null {
  if (typeof email !== 'string') throw new Error('邮箱地址无效。')
  const row = getDatabase()
    .prepare<{ contact_id: number }>(
      `SELECT contact_id FROM onemail_contact_emails
       WHERE normalized_email = :normalizedEmail ORDER BY contact_id LIMIT 1`
    )
    .get({ normalizedEmail: normalizeEmail(email) })
  return row ? getContact(toNumber(row.contact_id)) : null
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateContactId(contactId: unknown): asserts contactId is number {
  if (typeof contactId !== 'number' || !Number.isSafeInteger(contactId) || contactId <= 0) {
    throw new Error('联系人 ID 无效。')
  }
}

type NormalizedContactInput = ContactInput & { note: string; isStarred: boolean }

/** IPC and imported files are untrusted, even when the caller has TypeScript types. */
export function normalizeContactInput(input: unknown): NormalizedContactInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('联系人数据无效。')
  }
  const value = input as Record<string, unknown>
  if (value.contactId !== undefined) validateContactId(value.contactId)
  const displayName = readText(value.displayName, '姓名', 256).trim()
  const note = readText(value.note ?? '', '备注', 32768, true).replace(/\r\n?/g, '\n')
  if (value.isStarred !== undefined && typeof value.isStarred !== 'boolean') {
    throw new Error('星标状态无效。')
  }
  if (!Array.isArray(value.emails) || value.emails.length === 0) {
    throw new Error('联系人至少需要一个邮箱地址。')
  }
  if (value.emails.length > MAX_CONTACT_EMAILS) {
    throw new Error(`每个联系人最多保存 ${MAX_CONTACT_EMAILS} 个邮箱地址。`)
  }

  const seen = new Set<string>()
  const emails = value.emails.map<ContactEmail>((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个邮箱数据无效。`)
    }
    const email = readText(item.email, `第 ${index + 1} 个邮箱`, 254).trim()
    if (!isValidEmail(email)) throw new Error(`第 ${index + 1} 个邮箱地址格式无效。`)
    const normalized = normalizeEmail(email)
    if (seen.has(normalized)) throw new Error(`第 ${index + 1} 个邮箱地址重复。`)
    seen.add(normalized)
    if (item.isDefault !== undefined && typeof item.isDefault !== 'boolean') {
      throw new Error(`第 ${index + 1} 个邮箱的默认状态无效。`)
    }
    return {
      email,
      label: readText(item.label ?? '', '邮箱标签', 100).trim(),
      isDefault: item.isDefault === true
    }
  })
  if (emails.filter((email) => email.isDefault).length > 1) {
    throw new Error('只能选择一个默认邮箱地址。')
  }
  if (!emails.some((email) => email.isDefault)) emails[0].isDefault = true

  return {
    contactId: value.contactId as number | undefined,
    displayName,
    note,
    isStarred: value.isStarred === true,
    emails
  }
}

function readText(value: unknown, label: string, limit: number, multiline = false): string {
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label}必须是文本，且不能超过 ${limit} 个字符。`)
  }
  // Notes may contain tabs/newlines; fields used in vCard headers may not.
  const controlCharacters = multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/
  if (controlCharacters.test(value)) throw new Error(`${label}包含无效的控制字符。`)
  return value
}

function isValidEmail(email: string): boolean {
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, host] = parts
  if (
    !local ||
    local.length > 64 ||
    !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return false
  }
  // A bare mailbox only, not display-name syntax or a list of recipients.
  if (!host || /[\s/@:<>\\[\],;"()]/.test(host)) return false
  const domain = domainToASCII(host)
  return (
    domain.length <= 253 &&
    domain.includes('.') &&
    domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  )
}

function inContactTransaction<T>(operation: () => T): T {
  const db = getDatabase()
  // SAVEPOINT also composes with a caller's transaction. No asynchronous work inside.
  db.exec('SAVEPOINT onemail_contacts_write')
  try {
    const result = operation()
    db.exec('RELEASE SAVEPOINT onemail_contacts_write')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO SAVEPOINT onemail_contacts_write')
    db.exec('RELEASE SAVEPOINT onemail_contacts_write')
    throw error
  }
}

function writeContact(input: NormalizedContactInput): Contact {
  const db = getDatabase()
  let contactId = input.contactId
  const params = {
    displayName: input.displayName,
    note: input.note,
    isStarred: input.isStarred ? 1 : 0
  }
  if (contactId !== undefined) {
    const result = db
      .prepare(
        `UPDATE onemail_contacts
         SET display_name = :displayName, note = :note, is_starred = :isStarred,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE contact_id = :contactId`
      )
      .run({ ...params, contactId })
    if (result.changes === 0) throw new Error('联系人不存在，可能已被删除。')
    db.prepare('DELETE FROM onemail_contact_emails WHERE contact_id = :contactId').run({
      contactId
    })
  } else {
    const result = db
      .prepare(
        `INSERT INTO onemail_contacts (display_name, note, is_starred)
         VALUES (:displayName, :note, :isStarred)`
      )
      .run(params)
    contactId = Number(result.lastInsertRowid)
  }

  const insertEmail = db.prepare(
    `INSERT INTO onemail_contact_emails (contact_id, email, normalized_email, label, is_default)
     VALUES (:contactId, :email, :normalizedEmail, :label, :isDefault)`
  )
  for (const email of input.emails) {
    insertEmail.run({
      contactId,
      email: email.email,
      normalizedEmail: normalizeEmail(email.email),
      label: email.label ?? '',
      isDefault: email.isDefault ? 1 : 0
    })
  }
  // Read back before committing, so a read failure cannot report an uncommitted save as success.
  const contact = getContact(contactId)
  if (!contact) throw new Error('保存联系人失败。')
  return contact
}

type ContactRow = SqliteRow & {
  contact_id: number
  display_name: string
  note: string
  is_starred: number
  created_at: string
  updated_at: string
}

type ContactEmailRow = SqliteRow & {
  contact_email_id: number
  email: string
  label: string
  is_default: number
}

function mapContactRow(row: ContactRow): Contact {
  const emails = getDatabase()
    .prepare<ContactEmailRow>(
      `SELECT contact_email_id, email, label, is_default
       FROM onemail_contact_emails
       WHERE contact_id = :contactId
       ORDER BY is_default DESC, contact_email_id`
    )
    .all({ contactId: row.contact_id })
    .map<ContactEmail>((email) => ({
      contactEmailId: toNumber(email.contact_email_id),
      email: email.email,
      label: email.label,
      isDefault: toBoolean(email.is_default)
    }))

  return {
    contactId: toNumber(row.contact_id),
    displayName: row.display_name,
    note: row.note,
    isStarred: toBoolean(row.is_starred),
    emails,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
