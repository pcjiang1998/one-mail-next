import { dialog, BrowserWindow } from 'electron'
import { open, writeFile } from 'node:fs/promises'

import type { Contact, ContactInput, VCardImportResult } from '../../shared/types'
import {
  importContactsWithoutOverwrite,
  listContacts,
  MAX_CONTACT_EMAILS,
  MAX_IMPORT_CONTACTS,
  normalizeContactInput,
  validateContactId
} from '../db/repositories/contact.repository'

export const MAX_VCARD_BYTES = 5 * 1024 * 1024

// Additive IPC fields; keep the existing shared contract compatible (merged is always zero).
export type VCardImportReport = VCardImportResult & { skipped: number; canceled: boolean }

export async function importVCardFromDisk(): Promise<VCardImportReport> {
  const options = {
    title: '导入联系人（已有邮箱冲突将跳过，不会覆盖）',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }]
  }
  const window = BrowserWindow.getFocusedWindow()
  const selected = await (window
    ? dialog.showOpenDialog(window, options)
    : dialog.showOpenDialog(options))
  if (selected.canceled || selected.filePaths.length === 0) {
    return { imported: 0, merged: 0, skipped: 0, canceled: true, contacts: listContacts() }
  }

  const content = await readBoundedVCard(selected.filePaths[0])
  const result = importContactsWithoutOverwrite(parseVCard(content))
  return { ...result, merged: 0, canceled: false }
}

export async function exportVCardToDisk(contactIds?: number[]): Promise<string | null> {
  if (contactIds !== undefined) {
    if (!Array.isArray(contactIds)) throw new Error('导出联系人列表无效。')
    contactIds.forEach(validateContactId)
  }
  const selectedIds = contactIds ? new Set(contactIds) : undefined
  const contacts = listContacts().filter(
    (contact) => !selectedIds || selectedIds.has(contact.contactId)
  )
  if (contacts.length === 0) throw new Error('没有可导出的联系人。')
  const content = contacts.map((contact) => toVCard(contact)).join('')
  const options = {
    title: '导出联系人',
    defaultPath: 'onemail-contacts.vcf',
    filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }]
  }
  const window = BrowserWindow.getFocusedWindow()
  const selected = await (window
    ? dialog.showSaveDialog(window, options)
    : dialog.showSaveDialog(options))
  if (selected.canceled || !selected.filePath) return null
  await writeFile(selected.filePath, content, 'utf8')
  return selected.filePath
}

async function readBoundedVCard(filePath: string): Promise<string> {
  const file = await open(filePath, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('请选择 vCard 文件。')
    if (info.size > MAX_VCARD_BYTES) throw new Error('vCard 文件不能超过 5 MiB。')
    // Bound the read as well as stat: the file could grow between stat and read.
    const buffer = Buffer.alloc(MAX_VCARD_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_VCARD_BYTES) throw new Error('vCard 文件不能超过 5 MiB。')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total))
    } catch {
      throw new Error('vCard 文件必须使用 UTF-8 编码。')
    }
  } finally {
    await file.close()
  }
}

type ParsedCard = {
  input: ContactInput
  version: string
  structuredName: string
  preferences: number[]
  groups: string[]
  labels: Map<string, string>
}

/** Only supported fields are retained; malformed supported fields reject the entire import. */
export function parseVCard(content: string): ContactInput[] {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_VCARD_BYTES) {
    throw new Error('vCard 文件不能超过 5 MiB。')
  }
  const cards: ContactInput[] = []
  let current: ParsedCard | null = null
  let cardNumber = 0

  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  for (const line of unfoldLines(source)) {
    if (!line.trim()) continue
    const structuralLine = line.trim().toUpperCase()
    if (structuralLine === 'BEGIN:VCARD') {
      if (current) throw new Error(`第 ${cardNumber} 张名片缺少 END:VCARD。`)
      cardNumber += 1
      if (cardNumber > MAX_IMPORT_CONTACTS) {
        throw new Error(`一次最多导入 ${MAX_IMPORT_CONTACTS} 个联系人。`)
      }
      current = {
        input: { displayName: '', note: '', isStarred: false, emails: [] },
        version: '',
        structuredName: '',
        preferences: [],
        groups: [],
        labels: new Map()
      }
      continue
    }
    if (structuralLine === 'END:VCARD') {
      if (!current) throw new Error('vCard 文件存在多余的 END:VCARD。')
      try {
        if (!['3.0', '4.0'].includes(current.version)) {
          throw new Error('仅支持 VERSION:3.0 或 VERSION:4.0。')
        }
        const input = current.input
        if (!input.displayName) input.displayName = current.structuredName
        const bestPreference = Math.min(...current.preferences)
        const defaultIndex = Math.max(0, current.preferences.indexOf(bestPreference))
        input.emails.forEach((email, index) => {
          email.isDefault = index === defaultIndex
          const label = current?.labels.get(current.groups[index])
          if (label !== undefined) email.label = label
        })
        cards.push(normalizeContactInput(input))
      } catch (error) {
        throw new Error(
          `第 ${cardNumber} 张名片：${error instanceof Error ? error.message : '数据无效。'}`
        )
      }
      current = null
      continue
    }
    if (!current) throw new Error('vCard 文件包含名片以外的内容。')

    try {
      const { property, group, parameters, rawValue } = parseContentLine(line)
      const value = unescapeVCard(rawValue)
      if (['FN', 'N', 'NOTE', 'EMAIL'].includes(property)) {
        if (parameters.has('ENCODING'))
          throw new Error('不支持编码属性，请使用 UTF-8 vCard 3.0/4.0。')
        const charset = parameters.get('CHARSET')?.[0]?.toUpperCase()
        if (charset && charset !== 'UTF-8') throw new Error('仅支持 UTF-8 字符集。')
      }
      if (property === 'VERSION') {
        if (current.version) throw new Error('VERSION 属性重复。')
        current.version = value
      } else if (property === 'FN') {
        current.input.displayName = value
      } else if (property === 'N') {
        const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitEscaped(
          rawValue,
          ';'
        ).map(unescapeVCard)
        current.structuredName = [prefix, given, additional, family, suffix]
          .filter(Boolean)
          .join(' ')
      } else if (property === 'NOTE') {
        current.input.note = value
      } else if (property === 'X-ONEMAIL-STARRED') {
        if (!/^(0|1|true|false)$/i.test(value)) throw new Error('星标属性无效。')
        current.input.isStarred = /^(1|true)$/i.test(value)
      } else if ((property === 'X-ONEMAIL-LABEL' || property === 'X-ABLABEL') && group) {
        current.labels.set(group, value)
      } else if (property === 'EMAIL') {
        if (current.input.emails.length >= MAX_CONTACT_EMAILS) {
          throw new Error(`每个联系人最多保存 ${MAX_CONTACT_EMAILS} 个邮箱地址。`)
        }
        const types = (parameters.get('TYPE') ?? []).map((type) => type.toLowerCase())
        const pref = parameters.get('PREF')?.[0]
        if (pref !== undefined && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(pref)) {
          throw new Error('邮箱 PREF 必须是 1 到 100 的整数。')
        }
        current.input.emails.push({
          email: value,
          label: types.filter((type) => type !== 'pref' && type !== 'internet').join(','),
          isDefault: false
        })
        current.preferences.push(pref ? Number(pref) : types.includes('pref') ? 1 : Infinity)
        current.groups.push(group)
      }
    } catch (error) {
      throw new Error(
        `第 ${cardNumber} 张名片：${error instanceof Error ? error.message : '数据无效。'}`
      )
    }
  }

  if (current) throw new Error(`第 ${cardNumber} 张名片缺少 END:VCARD，尚未导入任何联系人。`)
  if (cards.length === 0) throw new Error('文件中没有可导入的联系人。')
  return cards
}

function parseContentLine(line: string): {
  property: string
  group: string
  parameters: Map<string, string[]>
  rawValue: string
} {
  let quoted = false
  let separator = -1
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted
    if (line[index] === ':' && !quoted) {
      separator = index
      break
    }
  }
  if (separator < 1) throw new Error('属性行格式无效。')
  const [rawName, ...rawParameters] = splitOutsideQuotes(line.slice(0, separator), ';')
  const name = rawName.split('.')
  const property = name.pop()!.toUpperCase()
  const group = name.join('.').toLowerCase()
  const parameters = new Map<string, string[]>()
  for (const parameter of rawParameters) {
    const equals = parameter.indexOf('=')
    if (equals < 1) continue
    const key = parameter.slice(0, equals).toUpperCase()
    const values = splitOutsideQuotes(parameter.slice(equals + 1), ',').flatMap((value) =>
      value.replace(/^"(.*)"$/, '$1').split(',')
    )
    parameters.set(key, [...(parameters.get(key) ?? []), ...values])
  }
  return { property, group, parameters, rawValue: line.slice(separator + 1) }
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted
    if (value[index] === separator && !quoted) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') index += 1
    else if (value[index] === separator) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function unfoldLines(content: string): string[] {
  const physical = content.replace(/\r\n?/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of physical) {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += line.slice(1)
    else lines.push(line)
  }
  return lines
}

function unescapeVCard(value: string): string {
  // One pass matters: a literal \\n must not become a newline after unescaping \\.
  return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) =>
    escaped.toLowerCase() === 'n' ? '\n' : escaped
  )
}

function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldLine(line: string): string {
  const parts: string[] = []
  let part = ''
  let bytes = 0
  // Fold at UTF-8 octets, never inside a Chinese character or surrogate pair.
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > 75) {
      parts.push(part)
      part = ' '
      bytes = 1
    }
    part += character
    bytes += size
  }
  parts.push(part)
  return parts.join('\r\n')
}

export function toVCard(contact: Contact, version: '3.0' | '4.0' = '3.0'): string {
  const normalized = normalizeContactInput(contact)
  const name = escapeVCard(normalized.displayName)
  const lines = ['BEGIN:VCARD', `VERSION:${version}`, `FN:${name}`, `N:;${name};;;`]
  normalized.emails.forEach((email, index) => {
    const group = `item${index + 1}`
    const types = /^(home|work)$/i.test(email.label ?? '') ? [email.label!.toUpperCase()] : []
    if (version === '3.0' && email.isDefault) types.push('PREF')
    const type = types.length ? `;TYPE=${types.join(',')}` : ''
    const pref = version === '4.0' && email.isDefault ? ';PREF=1' : ''
    lines.push(`${group}.EMAIL${type}${pref}:${escapeVCard(email.email)}`)
    // Text properties, not untrusted parameters: labels cannot inject vCard headers.
    if (email.label) lines.push(`${group}.X-ONEMAIL-LABEL:${escapeVCard(email.label)}`)
  })
  if (normalized.note) lines.push(`NOTE:${escapeVCard(normalized.note)}`)
  lines.push(`X-ONEMAIL-STARRED:${normalized.isStarred ? '1' : '0'}`, 'END:VCARD')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}
