import type { AccountPrivacyPolicy, AppSettings, PrivacyMode, PrivacyTrustedSender } from './types'

/** Same-window notification; the reader also reloads policies on focus and message changes. */
export const MAIL_PRIVACY_CHANGED_EVENT = 'onemail:privacy-changed'

export function getDefaultPrivacyMode(
  settings: Pick<AppSettings, 'privacyDefaultMode' | 'externalImagesBlocked'>
): PrivacyMode {
  return settings.privacyDefaultMode === 'unrestricted' ||
    settings.privacyDefaultMode === 'loose' ||
    settings.privacyDefaultMode === 'strict'
    ? settings.privacyDefaultMode
    : settings.externalImagesBlocked
      ? 'strict'
      : 'unrestricted'
}

export function normalizeTrustedValue(matchType: 'email' | 'domain', value: string): string {
  if (typeof value !== 'string') return ''
  const normalized = value.trim().toLowerCase()
  if (matchType === 'domain') return normalizeDomain(normalized.replace(/^@/, ''))
  if (matchType !== 'email') return ''
  const parts = normalized.split('@')
  if (parts.length !== 2 || !/^[^\s<>(),;:"\\[\]@]+$/.test(parts[0])) return ''
  const domain = normalizeDomain(parts[1])
  return domain ? `${parts[0]}@${domain}` : ''
}

function normalizeDomain(value: string): string {
  if (value.length > 253 || !value.includes('.')) return ''
  return value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ? value
    : ''
}

/** Match the mailbox exactly and domains only on a dot boundary; never trust suffix lookalikes. */
export function matchesTrustedSender(
  accountId: number,
  senderEmail: string | undefined,
  trustedSenders: readonly PrivacyTrustedSender[]
): boolean {
  const email = normalizeTrustedValue('email', senderEmail ?? '')
  if (!email) return false
  const domain = email.slice(email.lastIndexOf('@') + 1)
  return trustedSenders.some((entry) => {
    if (entry.accountId !== accountId) return false
    const value = normalizeTrustedValue(entry.matchType, entry.matchValue)
    return (
      Boolean(value) &&
      ((entry.matchType === 'email' && email === value) ||
        (entry.matchType === 'domain' && (domain === value || domain.endsWith(`.${value}`))))
    )
  })
}

export function resolveMailPrivacyMode(
  accountId: number,
  senderEmail: string | undefined,
  policy?: AccountPrivacyPolicy
): PrivacyMode {
  if (!policy || policy.accountId !== accountId) return 'strict'
  if (matchesTrustedSender(accountId, senderEmail, policy.trustedSenders)) return 'unrestricted'
  return policy.resolvedMode === 'unrestricted' || policy.resolvedMode === 'loose'
    ? policy.resolvedMode
    : 'strict'
}

export type MailImageHints = {
  width?: number
  height?: number
  hidden?: boolean
}

/**
 * Deliberately heuristic, not a tracking guarantee: ordinary-looking images can also track opens.
 * Explicit pixels/hidden images and common tracking hosts/endpoints are recognizable signals.
 */
export function isLikelyMailTracker(url: string, hints: MailImageHints = {}): boolean {
  if (hints.hidden || hints.width === 0 || hints.height === 0) return true
  if (
    hints.width !== undefined &&
    hints.height !== undefined &&
    hints.width <= 2 &&
    hints.height <= 2
  )
    return true

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const hostname = parsed.hostname.toLowerCase()
  if (
    /(^|\.)(?:google-analytics\.com|doubleclick\.net|mailtrack\.io|readnotify\.com|mixpanel\.com)$/.test(
      hostname
    )
  ) {
    return true
  }
  if (/^(?:track|tracking|tracker|pixel|pixels|beacon|open|opens)\./.test(hostname)) return true
  let path = parsed.pathname
  try {
    path = decodeURIComponent(path)
  } catch {
    /* Keep malformed paths conservative. */
  }
  if (
    /(?:^|[/_.-])(?:track(?:er|ing)?|pixel|beacon|open(?:ed)?|readreceipt)(?:[/_.-]|$)/i.test(path)
  )
    return true
  if (/\/o\/e\//i.test(path)) return true // Common email-open endpoint.
  let recognizedQuerySignal = false
  parsed.searchParams.forEach((value, key) => {
    if (
      /^(?:event|action|type)$/i.test(key) &&
      /^(?:open|opened|email_open|mail_open|read|beacon|pixel)$/i.test(value)
    ) {
      recognizedQuerySignal = true
    }
  })
  return recognizedQuerySignal
}
