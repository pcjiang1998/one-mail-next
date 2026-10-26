import { handleDatabaseIpc } from './database-handler'
import { ipcMain } from 'electron'

import {
  broadcastWritebackChanged,
  clearCompletedWritebacks,
  clearWriteback,
  getWritebackStatusSnapshot,
  initializeRemoteWritebacks,
  listWritebackRecords,
  retryWriteback
} from '../services/remote-writeback.service'

export function registerWritebackIpc(): void {
  initializeRemoteWritebacks()
  handleDatabaseIpc('writeback/list', () => listWritebackRecords())
  handleDatabaseIpc('writeback/status', () => getWritebackStatusSnapshot())
  handleDatabaseIpc('writeback/clear', (_event, writebackId: unknown) =>
    clearWriteback(requireWritebackId(writebackId))
  )
  handleDatabaseIpc('writeback/clearCompleted', () => clearCompletedWritebacks())
  handleDatabaseIpc('writeback/retry', (_event, writebackId: unknown) =>
    retryWriteback(requireWritebackId(writebackId))
  )
  ipcMain.on('writeback/refresh', () => broadcastWritebackChanged())
}

function requireWritebackId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('写回记录编号无效。')
  }
  return value
}
