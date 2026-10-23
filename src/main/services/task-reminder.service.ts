import { BrowserWindow, Notification, powerMonitor } from 'electron'

import type { BoardTask } from '../../shared/types'
import {
  createTaskFromMessage,
  deleteTasks,
  getTask,
  listDueReminders,
  listTasks,
  markReminderFired,
  updateTaskStatuses
} from '../db/repositories/task.repository'
import type { BoardTaskStatusUpdate, CreateBoardTaskInput } from '../ipc/types'

const CHECK_INTERVAL_MS = 30_000
const NOTIFICATION_TIMEOUT_MS = 60_000

type NotificationAttempt = {
  taskId: number
  notification: Notification
  timeout?: NodeJS.Timeout
  shownAt?: string
  persisted: boolean
}

let reminderTimer: NodeJS.Timeout | undefined
let running = false
let checking = false
let generation = 0
let openWindowHandler: ((route: string) => BrowserWindow | null) | null = null
const notifications = new Map<number, NotificationAttempt>()
const retryAfter = new Map<number, number>()
const navigationCleanups = new Set<() => void>()

/** The main process supplies its real main-window factory; no unhandled preload event is needed. */
export function setTaskReminderOpenWindowHandler(
  handler: ((route: string) => BrowserWindow | null) | null
): void {
  openWindowHandler = handler
}

export function startTaskReminderService(): void {
  if (running) return
  running = true
  generation += 1
  powerMonitor.on('resume', checkTaskReminders)
  reminderTimer = setInterval(checkTaskReminders, CHECK_INTERVAL_MS)
  checkTaskReminders()
}

export function stopTaskReminderService(): void {
  running = false
  generation += 1
  if (reminderTimer) clearInterval(reminderTimer)
  reminderTimer = undefined
  powerMonitor.removeListener('resume', checkTaskReminders)
  for (const reminderId of notifications.keys()) releaseNotification(reminderId)
  retryAfter.clear()
  for (const cleanup of navigationCleanups) cleanup()
  navigationCleanups.clear()
}

export function getBoardTasks(): BoardTask[] {
  return listTasks()
}

// Keep this signature shared with mail-rule.service: automated rules are the only non-menu creator.
export function createBoardTask(input: CreateBoardTaskInput): BoardTask {
  const task = createTaskFromMessage(input)
  broadcastTasksChanged()
  return task
}

export function updateBoardTaskStatuses(input: BoardTaskStatusUpdate): BoardTask[] {
  if (!input || typeof input !== 'object') throw new Error('任务状态参数无效。')
  const tasks = updateTaskStatuses(input.taskIds, input.status)
  if (input.status === 'completed' || input.status === 'cancelled') {
    closeTaskNotifications(input.taskIds)
  }
  broadcastTasksChanged(tasks)
  return tasks
}

export function deleteBoardTasks(taskIds: number[]): number {
  const count = deleteTasks(taskIds)
  closeTaskNotifications(taskIds)
  broadcastTasksChanged()
  return count
}

export function broadcastTasksChanged(tasks?: BoardTask[]): void {
  // A closing renderer must not turn a successful, committed mutation into an apparent failure.
  try {
    const snapshot = tasks ?? listTasks()
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send('tasks/changed', snapshot)
        }
      } catch (error) {
        reportError('无法向窗口更新看板', error)
      }
    }
  } catch (error) {
    reportError('无法广播看板更新', error)
  }
}

function checkTaskReminders(): void {
  if (!running || checking) return
  checking = true
  try {
    // If the database was temporarily unavailable after a successful display, retry only the
    // acknowledgement, not the OS notification. This avoids duplicate alerts in this process.
    for (const [reminderId, attempt] of notifications) {
      if (attempt.shownAt && !attempt.persisted) persistShownReminder(reminderId, attempt)
    }
    const due = listDueReminders()
    const dueIds = new Set(due.map((item) => item.reminder.reminderId))
    for (const [reminderId, attempt] of notifications) {
      if (!attempt.shownAt && !dueIds.has(reminderId)) releaseNotification(reminderId)
    }
    for (const reminderId of retryAfter.keys()) {
      if (!dueIds.has(reminderId)) retryAfter.delete(reminderId)
    }
    // Unsupported desktops keep their reminders pending, so a later supported session can retry.
    if (!Notification.isSupported()) return
    for (const item of due) {
      if (!running) break
      const reminderId = item.reminder.reminderId
      if (
        reminderId === undefined ||
        notifications.has(reminderId) ||
        (retryAfter.get(reminderId) ?? 0) > Date.now()
      )
        continue
      showReminder(item, reminderId)
    }
  } catch (error) {
    // Startup, timer and resume handlers must never create an unhandled rejection or crash quit.
    reportError('检查看板提醒失败，将在下次检查时重试', error)
  } finally {
    checking = false
  }
}

function showReminder(task: BoardTask, reminderId: number): void {
  try {
    const notification = new Notification({
      title: task.subjectSnapshot || 'OneMail 看板提醒',
      body: task.note || `来自 ${task.senderSnapshot || '邮件'} 的待办事项需要处理。`
    })
    const attempt: NotificationAttempt = { taskId: task.taskId, notification, persisted: false }
    notifications.set(reminderId, attempt)
    const isCurrent = (): boolean => running && notifications.get(reminderId) === attempt

    notification.once('show', () => {
      if (!isCurrent()) return
      if (attempt.timeout) clearTimeout(attempt.timeout)
      attempt.timeout = undefined
      attempt.shownAt = new Date().toISOString()
      persistShownReminder(reminderId, attempt)
    })
    notification.on('click', () => {
      if (isCurrent()) openTask(task.taskId)
    })
    notification.once('failed', (_event, error: string) => {
      if (!isCurrent()) return
      failNotification(reminderId, error || '系统拒绝显示通知。')
    })
    notification.once('close', () => {
      if (!isCurrent()) return
      // Keep an uncommitted display acknowledgement in memory, even after the toast closes.
      if (attempt.shownAt && !attempt.persisted) return
      releaseNotification(reminderId, false)
    })
    attempt.timeout = setTimeout(() => {
      if (isCurrent() && !attempt.shownAt) {
        failNotification(reminderId, '系统未确认通知已显示；提醒仍保留为待通知。')
      }
    }, NOTIFICATION_TIMEOUT_MS)
    notification.show()
  } catch (error) {
    failNotification(reminderId, error)
  }
}

function persistShownReminder(reminderId: number, attempt: NotificationAttempt): void {
  if (!running || !attempt.shownAt) return
  try {
    const updated = markReminderFired(reminderId, attempt.shownAt)
    attempt.persisted = true
    retryAfter.delete(reminderId)
    if (!updated) releaseNotification(reminderId)
    else broadcastTasksChanged()
  } catch (error) {
    reportError('系统通知已显示，但提醒记录暂未保存；稍后重试保存', error)
  }
}

function failNotification(reminderId: number, error: unknown): void {
  releaseNotification(reminderId)
  if (running) retryAfter.set(reminderId, Date.now() + NOTIFICATION_TIMEOUT_MS)
  reportError('看板提醒未送达，将重试', error)
}

function releaseNotification(reminderId: number, close = true): void {
  const attempt = notifications.get(reminderId)
  if (!attempt) return
  notifications.delete(reminderId)
  if (attempt.timeout) clearTimeout(attempt.timeout)
  attempt.notification.removeAllListeners()
  if (close) {
    try {
      attempt.notification.close()
    } catch (error) {
      reportError('关闭看板通知失败', error)
    }
  }
}

function closeTaskNotifications(taskIds: number[]): void {
  const ids = new Set(taskIds)
  for (const [reminderId, attempt] of notifications) {
    if (ids.has(attempt.taskId)) {
      releaseNotification(reminderId)
      retryAfter.delete(reminderId)
    }
  }
}

function openTask(taskId: number): void {
  try {
    const task = getTask(taskId)
    const route =
      task?.accountId && task.messageId ? `/${task.accountId}/${task.messageId}` : '/board'
    const window = openWindowHandler?.(route)
    if (!window || window.isDestroyed()) {
      reportError('无法打开提醒目标', '主窗口打开回调未注册或窗口已关闭。')
      return
    }
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    navigateWindow(window, route, generation)
  } catch (error) {
    reportError('打开提醒对应邮件失败', error)
  }
}

function navigateWindow(window: BrowserWindow, route: string, expectedGeneration: number): void {
  if (!running || generation !== expectedGeneration || window.isDestroyed()) return
  const contents = window.webContents
  if (contents.isDestroyed()) return
  if (contents.isLoading()) {
    const cleanup = (): void => {
      contents.removeListener('did-finish-load', onLoaded)
      contents.removeListener('destroyed', cleanup)
      navigationCleanups.delete(cleanup)
    }
    const onLoaded = (): void => {
      cleanup()
      try {
        navigateWindow(window, route, expectedGeneration)
      } catch (error) {
        reportError('打开看板提醒路由失败', error)
      }
    }
    navigationCleanups.add(cleanup)
    contents.once('did-finish-load', onLoaded)
    contents.once('destroyed', cleanup)
    return
  }
  // Both the existing window and a newly created window use the app's hash router.
  void contents
    .executeJavaScript(`window.location.hash = ${JSON.stringify(route)}`)
    .catch((error) => reportError('打开看板提醒路由失败', error))
}

function reportError(message: string, error: unknown): void {
  console.error(`[task-reminder] ${message}`, error)
}
