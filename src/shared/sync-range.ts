export const DAY_MS = 24 * 60 * 60 * 1000

export type SyncRanges = {
  syncWindowDays: number
  syncBodyWindowDays: number
  cacheRetentionDays: number
}

export type SyncRangeField = keyof SyncRanges
export type SyncRangeError =
  | 'integer'
  | 'metadataMax'
  | 'bodyMax'
  | 'metadataOrder'
  | 'bodyOrder'
  | 'retentionOrder'
  | 'metadataRetentionOrder'

export const DEFAULT_SYNC_RANGES: SyncRanges = {
  syncWindowDays: 30,
  syncBodyWindowDays: 7,
  cacheRetentionDays: 0
}

export function getSyncRangeError(
  values: SyncRanges,
  field: SyncRangeField
): SyncRangeError | undefined {
  const value = values[field]
  if (!Number.isSafeInteger(value) || value < (field === 'cacheRetentionDays' ? 0 : 1)) {
    return 'integer'
  }
  if (field === 'syncWindowDays') {
    if (value > 90) return 'metadataMax'
    if (value <= values.syncBodyWindowDays) return 'metadataOrder'
    if (values.cacheRetentionDays > 0 && value >= values.cacheRetentionDays)
      return 'metadataRetentionOrder'
  }
  if (field === 'syncBodyWindowDays') {
    if (value > 30) return 'bodyMax'
    if (value >= values.syncWindowDays) return 'bodyOrder'
  }
  if (field === 'cacheRetentionDays' && value > 0 && value <= values.syncWindowDays) {
    return 'retentionOrder'
  }
  return undefined
}

export function validateSyncRanges(values: SyncRanges): void {
  const messages: Record<SyncRangeError, string> = {
    integer: '同步范围必须是正整数，本地缓存保留天数必须是非负整数。',
    metadataMax: '邮件元信息范围不能超过 90 天。',
    bodyMax: '邮件全文范围不能超过 30 天。',
    metadataOrder: '邮件元信息范围必须大于邮件全文范围。',
    bodyOrder: '邮件全文范围必须小于邮件元信息范围。',
    metadataRetentionOrder: '邮件元信息范围必须小于本地缓存保留天数。',
    retentionOrder: '本地缓存保留天数必须大于邮件元信息范围，或设为 0。'
  }
  for (const field of Object.keys(DEFAULT_SYNC_RANGES) as SyncRangeField[]) {
    const error = getSyncRangeError(values, field)
    if (error) throw new Error(messages[error])
  }
}

export function syncCutoff(days: number, now = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString()
}
