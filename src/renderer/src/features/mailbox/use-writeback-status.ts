import * as React from 'react'

import type { WritebackStatus } from '../../../../shared/types'

const emptyStatus: WritebackStatus = {
  queuedCount: 0,
  runningCount: 0,
  failedCount: 0,
  successCount: 0,
  items: []
}

export function useWritebackStatus(): {
  status: WritebackStatus
  clear: (writebackId: number) => Promise<void>
  clearCompleted: () => Promise<void>
  retry: (writebackId: number) => Promise<void>
} {
  const [status, setStatus] = React.useState<WritebackStatus>(emptyStatus)

  React.useEffect(() => {
    let cancelled = false
    void window.api.writeback.status().then((next) => {
      if (!cancelled) setStatus(next)
    })
    const off = window.api.writeback.onChanged((next) => setStatus(next))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const clear = React.useCallback(async (writebackId: number) => {
    await window.api.writeback.clear(writebackId)
    setStatus(await window.api.writeback.status())
  }, [])
  const clearCompleted = React.useCallback(async () => {
    await window.api.writeback.clearCompleted()
    setStatus(await window.api.writeback.status())
  }, [])
  const retry = React.useCallback(async (writebackId: number) => {
    try {
      await window.api.writeback.retry(writebackId)
    } catch {
      // The main process persists the refusal/failure on the record; refresh so
      // the panel shows the reason without causing an unhandled renderer error.
    } finally {
      setStatus(await window.api.writeback.status())
    }
  }, [])

  return { status, clear, clearCompleted, retry }
}
