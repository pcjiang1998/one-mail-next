import { BrowserWindow } from 'electron'
import { cleanupMessageCache } from '../db/repositories/cache.repository'
import { getSettings } from '../db/repositories/settings.repository'
import { listAccounts } from '../db/repositories/account.repository'
import { DAY_MS } from '../../shared/sync-range'
import type { CacheCleanupInput, CacheCleanupResult } from '../ipc/types'

let timer: ReturnType<typeof setInterval> | undefined

export function cleanLocalMailCache(expected?: CacheCleanupInput): CacheCleanupResult {
  const result = cleanupMessageCache(Date.now(), expected)
  for (const account of listAccounts()) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed())
        window.webContents.send('sync/mailboxChanged', {
          accountId: account.accountId,
          reason: 'manual',
          changedAt: new Date().toISOString()
        })
    }
  }
  return result
}

function checkCache(): void {
  try {
    if (getSettings().cacheRetentionDays > 0) cleanLocalMailCache()
  } catch (error) {
    console.error('自动清理邮件缓存失败。', error)
  }
}

export function startCacheMaintenance(): void {
  stopCacheMaintenance()
  checkCache()
  timer = setInterval(checkCache, DAY_MS)
  timer.unref()
}

export function stopCacheMaintenance(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
