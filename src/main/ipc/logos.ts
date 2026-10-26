import { handleDatabaseIpc } from './database-handler'

const LOGO_CACHE = new Map<string, string | null>()
const LOGO_TIMEOUT_MS = 5000

export function registerLogoIpc(): void {
  handleDatabaseIpc('logos/get', async (_event, domain: string) => getLogoDataUrl(domain))
}

export async function getLogoDataUrl(domain: string): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return null

  if (LOGO_CACHE.has(normalizedDomain)) {
    return LOGO_CACHE.get(normalizedDomain) ?? null
  }

  try {
    const logo = await fetchLogo(normalizedDomain)
    LOGO_CACHE.set(normalizedDomain, logo)
    return logo
  } catch {
    LOGO_CACHE.set(normalizedDomain, null)
    return null
  }
}

async function fetchLogo(domain: string): Promise<string | null> {
  const urls = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
    `https://${domain}/favicon.ico`
  ]

  for (const url of urls) {
    const logo = await fetchLogoUrl(url).catch(() => null)
    if (logo) return logo
  }

  return null
}

async function fetchLogoUrl(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null

    const contentType = response.headers.get('content-type') ?? 'image/png'
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length < 100) return null

    return `data:${contentType};base64,${buffer.toString('base64')}`
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeDomain(domain: string): string {
  const text = domain.trim().toLowerCase()
  if (!text) return ''

  return text.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}
