import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }))
vi.mock('../db/repositories/settings.repository', () => ({
  getSettings: vi.fn(() => ({ cacheRetentionDays: 60 }))
}))
vi.mock('../db/repositories/account.repository', () => ({ listAccounts: vi.fn(() => []) }))
vi.mock('../db/repositories/cache.repository', () => ({
  cleanupMessageCache: vi.fn(() => ({
    days: 60,
    deletedMessages: 0,
    clearedBodies: 0,
    clearedAttachments: 0
  }))
}))

import { getSettings } from '../db/repositories/settings.repository'
import { cleanupMessageCache } from '../db/repositories/cache.repository'
import { startCacheMaintenance, stopCacheMaintenance } from './cache-maintenance'

describe('cache maintenance schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    stopCacheMaintenance()
    vi.useRealTimers()
  })

  it('checks at startup and every 24 hours without duplicating timers', () => {
    startCacheMaintenance()
    expect(cleanupMessageCache).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1)
    expect(cleanupMessageCache).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(cleanupMessageCache).toHaveBeenCalledTimes(2)
    startCacheMaintenance()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(cleanupMessageCache).toHaveBeenCalledTimes(4)
  })

  it('does not clean while retention is zero', () => {
    vi.mocked(getSettings).mockReturnValue({ cacheRetentionDays: 0 } as ReturnType<
      typeof getSettings
    >)
    startCacheMaintenance()
    vi.advanceTimersByTime(48 * 60 * 60 * 1000)
    expect(cleanupMessageCache).not.toHaveBeenCalled()
  })
})
