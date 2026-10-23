import { describe, expect, it } from 'vitest'

import { matchesTrustedSender, resolveMailPrivacyMode } from './mail-privacy'
import type { AccountPrivacyPolicy, PrivacyTrustedSender } from './types'

function trustedSender(
  accountId: number,
  matchType: 'email' | 'domain',
  matchValue: string,
  trustedSenderId = 1
): PrivacyTrustedSender {
  return { trustedSenderId, accountId, matchType, matchValue }
}

function policy(
  accountId: number,
  resolvedMode: AccountPrivacyPolicy['resolvedMode'],
  trustedSenders: PrivacyTrustedSender[] = []
): AccountPrivacyPolicy {
  return { accountId, mode: resolvedMode, resolvedMode, trustedSenders }
}

describe('mail privacy matching', () => {
  it('matches exact email and dot-boundary domains, without suffix lookalikes', () => {
    const entries = [
      trustedSender(7, 'email', 'friend@example.com'),
      trustedSender(7, 'domain', 'example.org', 2)
    ]

    expect(matchesTrustedSender(7, 'FRIEND@example.com', entries)).toBe(true)
    expect(matchesTrustedSender(7, 'stranger@example.com', entries)).toBe(false)
    expect(matchesTrustedSender(7, 'stranger@unrelated.test', entries)).toBe(false)
    expect(matchesTrustedSender(7, 'other@example.org', entries)).toBe(true)
    expect(matchesTrustedSender(7, 'other@sub.example.org', entries)).toBe(true)
    expect(matchesTrustedSender(7, 'friend@example.com.evil.test', entries)).toBe(false)
    expect(matchesTrustedSender(7, 'other@notexample.org', entries)).toBe(false)
  })

  it('isolates trusted entries by account', () => {
    const entries = [trustedSender(1, 'domain', 'example.com')]
    expect(matchesTrustedSender(2, 'sender@example.com', entries)).toBe(false)
    expect(resolveMailPrivacyMode(2, 'sender@example.com', policy(2, 'strict', entries))).toBe(
      'strict'
    )
  })

  it.each([
    ['unrestricted', 'unrestricted'],
    ['loose', 'loose'],
    ['strict', 'strict']
  ] as const)('preserves the resolved %s mode for an untrusted sender', (mode, expected) => {
    expect(resolveMailPrivacyMode(3, 'sender@example.net', policy(3, mode))).toBe(expected)
  })

  it('elevates a trusted sender to unrestricted for the current account', () => {
    const current = policy(3, 'strict', [trustedSender(3, 'domain', 'example.net')])
    expect(resolveMailPrivacyMode(3, 'sender@example.net', current)).toBe('unrestricted')
    expect(resolveMailPrivacyMode(4, 'sender@example.net', current)).toBe('strict')
  })
})
