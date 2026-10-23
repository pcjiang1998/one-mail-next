import { isLikelyMailTracker, type MailImageHints } from '../../../../shared/mail-privacy'
import type { PrivacyMode } from '../../../../shared/types'

export type PreparedMailHtml = {
  html: string
  blockedResourceCount: number
  /** Ordinary images which can be loaded with the per-message action. */
  blockedImageResourceCount: number
  blockedTrackerResourceCount: number
  removedUnsafeElementCount: number
}

export type PrepareMailHtmlOptions = {
  mode?: PrivacyMode
  /** Only overrides strict image blocking, never tracker blocking. */
  allowRemoteImages?: boolean
  /** Compatibility for old callers; new callers must pass mode. */
  allowExternalImages?: boolean
}

type ResourcePolicy = { mode: PrivacyMode; allowRemoteImages: boolean }
type Counters = Omit<PreparedMailHtml, 'html'>
const resourceAttributes = ['src', 'srcset', 'poster', 'background'] as const
const allowedTags = new Set(
  'a abbr address article b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark ol p picture pre q rp rt ruby s samp section small source span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr'.split(
    ' '
  )
)
const removedSubtrees = new Set(
  'script noscript style iframe frame frameset object embed applet base meta link form input button textarea select option svg math template audio video canvas'.split(
    ' '
  )
)
const allowedAttributes = new Set(
  'alt title width height align valign bgcolor color face size border cellpadding cellspacing colspan rowspan dir lang start reversed'.split(
    ' '
  )
)
const allowedStyleProperties = new Set(
  'color background background-color background-image background-position background-size background-repeat background-origin background-clip border border-color border-width border-style border-top border-right border-bottom border-left border-top-color border-right-color border-bottom-color border-left-color border-radius border-collapse border-spacing box-sizing box-shadow display visibility opacity font font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent text-overflow white-space word-break overflow-wrap vertical-align width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left list-style-type list-style-position list-style-image table-layout direction unicode-bidi'.split(
    ' '
  )
)
const imageStyleProperties = new Set(['background', 'background-image', 'list-style-image'])
const allowedCssFunctions = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'calc',
  'min',
  'max',
  'clamp',
  'linear-gradient',
  'radial-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient'
])
const blockedResourceOnlyContainerSelector =
  'a,span,p,div,center,section,article,td,th,tr,tbody,thead,tfoot,table'

export function prepareMailHtml(html: string, options: PrepareMailHtmlOptions): PreparedMailHtml {
  const policy: ResourcePolicy = {
    mode: options.mode ?? (options.allowExternalImages ? 'unrestricted' : 'strict'),
    allowRemoteImages: options.allowRemoteImages ?? false
  }
  // Template contents are inert: parsing must not itself fetch images before policy is applied.
  // Unlike parsing directly into the live document, neither styles nor resources are activated.
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  const counters: Counters = {
    blockedResourceCount: 0,
    blockedImageResourceCount: 0,
    blockedTrackerResourceCount: 0,
    removedUnsafeElementCount: 0
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (!root.contains(element)) continue
    const tag = element.localName.toLowerCase()
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || removedSubtrees.has(tag)) {
      counters.removedUnsafeElementCount += 1
      element.remove()
    } else if (!allowedTags.has(tag)) {
      counters.removedUnsafeElementCount += 1
      element.replaceWith(...Array.from(element.childNodes))
    }
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    sanitizeAttributes(element, policy, counters)
  }
  markBlockedResourceOnlyContainers(root)
  return { html: template.innerHTML, ...counters }
}

function sanitizeAttributes(element: Element, policy: ResourcePolicy, counters: Counters): void {
  const hints = getImageHints(element)
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase()
    if (
      allowedAttributes.has(name) ||
      name === 'style' ||
      name === 'data-blocked-style' ||
      resourceAttributes.some(
        (resource) => name === resource || name === `data-blocked-${resource}`
      ) ||
      (name === 'href' && element.localName === 'a')
    )
      continue
    // Includes event handlers, ping, srcdoc, namespaced hrefs, custom elements' attributes,
    // and sender-supplied marker/class/id attributes which could affect the surrounding app.
    element.removeAttribute(attribute.name)
  }
  for (const attribute of resourceAttributes) {
    sanitizeResourceAttribute(element, attribute, policy, hints, counters)
  }
  sanitizeStyleAttribute(element, policy, hints, counters)
  const href = element.getAttribute('href')
  if (href) {
    if (!isSafeHref(href)) element.removeAttribute('href')
    else {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer nofollow')
      element.setAttribute('referrerpolicy', 'no-referrer')
    }
  }
  if (element.localName === 'img') {
    element.setAttribute('loading', 'lazy')
    element.setAttribute('decoding', 'async')
    element.setAttribute('referrerpolicy', 'no-referrer')
  }
}

function sanitizeResourceAttribute(
  element: Element,
  attribute: (typeof resourceAttributes)[number],
  policy: ResourcePolicy,
  hints: MailImageHints,
  counters: Counters
): void {
  const blockedAttribute = `data-blocked-${attribute}`
  const original = element.getAttribute(blockedAttribute) ?? element.getAttribute(attribute)
  element.removeAttribute(attribute)
  if (!original) return
  // Preserve the full original, including filtered srcset candidates, in every mode. A cache or
  // translation can be reprocessed under another policy without losing the blocked URLs.
  element.setAttribute(blockedAttribute, original)
  if (!isImageResource(element, attribute)) {
    counters.blockedResourceCount += 1
    return
  }
  if (attribute === 'srcset') {
    const candidates = parseSrcset(original)
    if (!candidates) {
      counters.blockedResourceCount += 1
      return
    }
    const allowed = candidates.filter(({ url }) => resourceAllowed(url, policy, hints, counters))
    if (allowed.length > 0) {
      element.setAttribute(
        attribute,
        allowed
          .map(({ url, descriptor }) => `${url}${descriptor ? ` ${descriptor}` : ''}`)
          .join(', ')
      )
    }
    if (allowed.length < candidates.length)
      element.setAttribute('data-mail-blocked-resource', 'true')
    return
  }
  const url = normalizeResourceUrl(original)
  if (resourceAllowed(url, policy, hints, counters)) element.setAttribute(attribute, url!)
  else element.setAttribute('data-mail-blocked-resource', 'true')
}

function resourceAllowed(
  url: string | null,
  policy: ResourcePolicy,
  hints: MailImageHints,
  counters: Counters
): boolean {
  if (!url) {
    counters.blockedResourceCount += 1
    return false
  }
  if (!/^https?:/i.test(url)) return true // Local CID/raster data images do not contact a server.
  if (policy.mode === 'unrestricted') return true
  if (isLikelyMailTracker(url, hints)) {
    counters.blockedResourceCount += 1
    counters.blockedTrackerResourceCount += 1
    return false
  }
  if (policy.mode === 'loose' || policy.allowRemoteImages) return true
  counters.blockedResourceCount += 1
  counters.blockedImageResourceCount += 1
  return false
}

function isImageResource(
  element: Element,
  attribute: (typeof resourceAttributes)[number]
): boolean {
  if (attribute === 'background') return true
  if (element.localName === 'img') return attribute === 'src' || attribute === 'srcset'
  return (
    element.localName === 'source' &&
    attribute === 'srcset' &&
    element.parentElement?.localName === 'picture'
  )
}

function normalizeResourceUrl(value: string): string | null {
  let url = value.trim()
  if (!url || /[\x00-\x20\x7f\\]/.test(url)) return null
  if (/^data:image\/(?:avif|bmp|gif|jpeg|jpg|png|webp);base64,[a-z0-9+/]+=*$/i.test(url)) return url
  if (/^cid:[^<>"']+$/i.test(url)) return url
  if (url.startsWith('//')) url = `https:${url}`
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]|$)/i.test(url)) url = `https://${url}`
  try {
    const parsed = new URL(url)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      return null
    return parsed.href
  } catch {
    return null // Never resolve a relative resource against the application's origin/filesystem.
  }
}

function parseSrcset(value: string): Array<{ url: string; descriptor: string }> | null {
  // Deliberately accept only unambiguous HTTP/CID candidates. Comma-containing data URLs are
  // supported through img.src, not srcset; ambiguous lists fail closed rather than leak a URL.
  if (/data:/i.test(value)) return null
  const result: Array<{ url: string; descriptor: string }> = []
  for (const candidate of value.split(',')) {
    const parts = candidate.trim().split(/\s+/)
    if (!parts[0] || parts.length > 2) return null
    const descriptor = parts[1] ?? ''
    if (descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)) return null
    const url = normalizeResourceUrl(parts[0])
    if (!url) return null
    result.push({ url, descriptor })
  }
  return result.length ? result : null
}

function getImageHints(element: Element): MailImageHints {
  const scratch = element.ownerDocument.createElement('span')
  scratch.setAttribute(
    'style',
    element.getAttribute('data-blocked-style') ?? element.getAttribute('style') ?? ''
  )
  const dimension = (name: 'width' | 'height'): number | undefined => {
    const value = scratch.style.getPropertyValue(name) || element.getAttribute(name) || ''
    return /^\d+(?:\.\d+)?(?:px)?$/i.test(value.trim()) ? Number.parseFloat(value) : undefined
  }
  return {
    width: dimension('width'),
    height: dimension('height'),
    hidden:
      scratch.style.display === 'none' ||
      scratch.style.visibility === 'hidden' ||
      (scratch.style.opacity !== '' && Number(scratch.style.opacity) === 0)
  }
}

function sanitizeStyleAttribute(
  element: Element,
  policy: ResourcePolicy,
  hints: MailImageHints,
  counters: Counters
): void {
  const original = element.getAttribute('data-blocked-style') ?? element.getAttribute('style')
  element.removeAttribute('style')
  if (!original) return
  element.setAttribute('data-blocked-style', original)
  // Escaped CSS identifiers, comments, at-rules and custom properties make URL detection
  // ambiguous. Do not activate such declarations, even in unrestricted mode.
  if (/[\\@]|\/\*|\*\/|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:/i.test(original))
    return
  const scratch = element.ownerDocument.createElement('span')
  scratch.setAttribute('style', original)
  const declarations: string[] = []
  for (let index = 0; index < scratch.style.length; index += 1) {
    const property = scratch.style.item(index).toLowerCase()
    const value = scratch.style.getPropertyValue(property).trim()
    if (!allowedStyleProperties.has(property) || !value) continue
    if (
      (property.startsWith('margin') || ['text-indent', 'letter-spacing'].includes(property)) &&
      /(^|[\s(])-\d/.test(value)
    )
      continue
    if (property === 'line-height' && /^0(?:\.0+)?(?:px|em|rem|%)?$/.test(value)) continue
    const urls: Array<{ match: string; url: string | null }> = []
    const remainder = value.replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s'"()]*))\s*\)/gi,
      (match: string, double: string, single: string, bare: string) => {
        urls.push({ match, url: normalizeResourceUrl(double ?? single ?? bare) })
        return ''
      }
    )
    if (urls.length && !imageStyleProperties.has(property)) continue
    if (/url\s*\(/i.test(remainder)) continue
    if (
      Array.from(remainder.matchAll(/([a-z-]+)\s*\(/gi)).some(
        (match) => !allowedCssFunctions.has(match[1].toLowerCase())
      )
    )
      continue
    const decisions = urls.map((entry) => ({
      entry,
      allowed: resourceAllowed(entry.url, policy, hints, counters)
    }))
    let sanitized = value
    for (const { entry, allowed } of decisions) {
      // CSS quoting must remain unambiguous after URL normalization. A blocked layer becomes
      // `none`, so an ordinary layer in the same declaration can still load after the action.
      const replacement =
        allowed && entry.url && !/["'()]/.test(entry.url) ? `url("${entry.url}")` : 'none'
      sanitized = sanitized.replace(entry.match, replacement)
    }
    if (decisions.some(({ allowed }) => !allowed)) {
      element.setAttribute('data-mail-blocked-resource', 'true')
    }
    if (decisions.some(({ allowed }) => allowed)) declarations.push(`${property}: ${sanitized}`)
  }
  if (declarations.length) element.setAttribute('style', declarations.join('; '))
}

function isSafeHref(value: string): boolean {
  const trimmed = value.trim()
  if (/[\x00-\x20\x7f\\]/.test(trimmed)) return false
  return trimmed.startsWith('#') || /^(?:https?:\/\/|mailto:|tel:)/i.test(trimmed)
}

function markBlockedResourceOnlyContainers(root: DocumentFragment): void {
  for (const element of Array.from(
    root.querySelectorAll(blockedResourceOnlyContainerSelector)
  ).reverse()) {
    let blocked = false
    let content = false
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent?.trim()) content = true
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const item = child as Element
        const placeholder =
          item.hasAttribute('data-mail-blocked-resource') &&
          !item.hasAttribute('src') &&
          !item.hasAttribute('srcset') &&
          !item.hasAttribute('background') &&
          !/url\(/i.test(item.getAttribute('style') ?? '') &&
          !item.textContent?.trim()
        if (placeholder || item.hasAttribute('data-mail-blocked-only')) blocked = true
        else if (
          item.textContent?.trim() ||
          item.children.length ||
          item.hasAttribute('src') ||
          item.hasAttribute('srcset')
        )
          content = true
      }
    }
    if (blocked && !content) element.setAttribute('data-mail-blocked-only', 'true')
  }
}
