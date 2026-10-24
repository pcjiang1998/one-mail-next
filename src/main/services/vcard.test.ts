import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: vi.fn(() => undefined) },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

import type { Contact } from '../../shared/types'
import { parseVCard, toVCard } from './vcard'

const contact: Contact = {
  contactId: 7,
  displayName: '张三，项目负责人',
  note: `第一行，备注；第二行\\字\n${'中文'.repeat(40)}`,
  isStarred: true,
  groups: [],
  emails: [
    { contactEmailId: 1, email: 'zhang@example.com', label: '工作', isDefault: true },
    { contactEmailId: 2, email: 'zhang.home@example.com', label: '家庭', isDefault: false }
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

describe('vCard service', () => {
  it.each(['3.0', '4.0'] as const)(
    'round-trips Chinese text, notes, labels, star and default in %s',
    (version) => {
      const card = toVCard(contact, version)
      const [parsed] = parseVCard(card)

      expect(card).toContain('BEGIN:VCARD')
      expect(card).toContain(`VERSION:${version}`)
      expect(card).toContain('\r\n ')
      if (version === '3.0') expect(card).toContain('TYPE=PREF')
      else expect(card).toContain('PREF=1')
      expect(parsed).toMatchObject({
        displayName: contact.displayName,
        note: contact.note,
        isStarred: true
      })
      expect(parsed.emails).toEqual([
        { email: 'zhang@example.com', label: '工作', isDefault: true },
        { email: 'zhang.home@example.com', label: '家庭', isDefault: false }
      ])
    }
  )

  it('accepts standard vCard 3 and 4 preference syntax and ignores unknown fields', () => {
    const cards = parseVCard(
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:李\\, 小姐',
        'EMAIL;TYPE=HOME,PREF:li@example.com',
        'X-UNKNOWN:ignored',
        'END:VCARD',
        'BEGIN:VCARD',
        'VERSION:4.0',
        'FN:王先生',
        'EMAIL;type=work;pref=1:wang@example.com',
        'END:VCARD'
      ].join('\r\n')
    )

    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ displayName: '李, 小姐' })
    expect(cards[0].emails[0]).toMatchObject({
      email: 'li@example.com',
      label: 'home',
      isDefault: true
    })
    expect(cards[1].emails[0]).toMatchObject({
      email: 'wang@example.com',
      label: 'work',
      isDefault: true
    })
  })

  it('rejects malformed cards and oversized content before importing', () => {
    expect(() => parseVCard('BEGIN:VCARD\r\nVERSION:2.1\r\nEND:VCARD')).toThrow(
      '3.0 或 VERSION:4.0'
    )
    expect(() =>
      parseVCard(
        `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:X\r\nEMAIL:x@example.com\r\nNOTE:${'x'.repeat(5 * 1024 * 1024)}\r\nEND:VCARD`
      )
    ).toThrow('5 MiB')
  })
})
