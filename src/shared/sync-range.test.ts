import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_RANGES, getSyncRangeError, validateSyncRanges } from './sync-range'

describe('sync ranges', () => {
  it('accepts defaults, smallest ranges, and the documented upper bounds', () => {
    for (const ranges of [
      DEFAULT_SYNC_RANGES,
      { syncWindowDays: 2, syncBodyWindowDays: 1, cacheRetentionDays: 0 },
      { syncWindowDays: 90, syncBodyWindowDays: 30, cacheRetentionDays: 91 }
    ])
      expect(() => validateSyncRanges(ranges)).not.toThrow()
  })

  it.each([NaN, Infinity, -1, 1.5, '' as unknown as number])(
    'rejects invalid numeric values: %s',
    (value) => {
      expect(() =>
        validateSyncRanges({ ...DEFAULT_SYNC_RANGES, cacheRetentionDays: value })
      ).toThrow()
      expect(() => validateSyncRanges({ ...DEFAULT_SYNC_RANGES, syncWindowDays: value })).toThrow()
      expect(() =>
        validateSyncRanges({ ...DEFAULT_SYNC_RANGES, syncBodyWindowDays: value })
      ).toThrow()
    }
  )

  it('reports the direction for the edited field', () => {
    const equal = { syncWindowDays: 20, syncBodyWindowDays: 20, cacheRetentionDays: 0 }
    expect(getSyncRangeError(equal, 'syncWindowDays')).toBe('metadataOrder')
    expect(getSyncRangeError(equal, 'syncBodyWindowDays')).toBe('bodyOrder')
    const retained = { ...DEFAULT_SYNC_RANGES, cacheRetentionDays: 30 }
    expect(getSyncRangeError(retained, 'syncWindowDays')).toBe('metadataRetentionOrder')
    expect(getSyncRangeError(retained, 'cacheRetentionDays')).toBe('retentionOrder')
  })
})
