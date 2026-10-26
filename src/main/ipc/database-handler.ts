import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withDatabaseTask } from '../db/activity'

const RESTORE_CHANNELS = new Set([
  'settings/importSql',
  'settings/downloadBackupSync',
  'settings/importBackupFromRemote'
])

export const handleDatabaseIpc: typeof ipcMain.handle = (channel, listener) => {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedAppFrame(event)
    return RESTORE_CHANNELS.has(channel)
      ? listener(event, ...args)
      : withDatabaseTask(() => listener(event, ...args))
  })
}

export function assertTrustedAppFrame(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) throw new Error('不允许的 IPC 调用页面。')
  const url = new URL(frame.url)
  const developmentUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && developmentUrl && url.origin === new URL(developmentUrl).origin) return
  if (url.protocol === 'file:') {
    const actual = resolve(fileURLToPath(url))
    const expected = resolve(__dirname, '../renderer/index.html')
    if (
      process.platform === 'win32'
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected
    )
      return
  }
  throw new Error('不允许的 IPC 调用页面。')
}
