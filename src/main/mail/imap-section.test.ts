import { describe, expect, it, vi } from 'vitest'
vi.mock('../services/network-proxy', () => ({ connectMailSocket: vi.fn() }))
import { extractBodySectionLiteral } from './imap-session'

describe('IMAP attachment cache admission', () => {
  it('accepts a real zero-byte attachment, not a missing part', () => {
    expect(
      extractBodySectionLiteral('* 1 FETCH (UID 1 BODY[2] {0}\r\n)\r\nD0001 OK\r\n', '2')
    ).toBe('')
    expect(() =>
      extractBodySectionLiteral('* 1 FETCH (UID 1 BODY[2] NIL)\r\nD0001 OK\r\n', '2')
    ).toThrow('未返回')
  })
  it('does not cache a different section or a truncated payload', () => {
    expect(() => extractBodySectionLiteral('* 1 FETCH (BODY[3] {3}\r\nabc)\r\n', '2')).toThrow(
      '未返回'
    )
    expect(() => extractBodySectionLiteral('* 1 FETCH (BODY[2] {100}\r\nabc)\r\n', '2')).toThrow(
      '不完整'
    )
    expect(() =>
      extractBodySectionLiteral('* 1 FETCH (BODY[2] {6}\r\nabc)\r\nD0001 OK\r\n', '2')
    ).toThrow('不完整')
  })
})
