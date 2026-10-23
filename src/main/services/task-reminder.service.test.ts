import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const repositoryMock = vi.hoisted(() => ({
  createTaskFromMessage: vi.fn(),
  deleteTasks: vi.fn(),
  getTask: vi.fn(),
  listDueReminders: vi.fn(),
  listTasks: vi.fn(() => []),
  markReminderFired: vi.fn(() => true),
  updateTaskStatuses: vi.fn()
}))

const electronMock = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')

  class FakeNotification extends EventEmitter {
    static supported = true
    static instances: FakeNotification[] = []
    static autoShow = true
    readonly options: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      super()
      this.options = options
      FakeNotification.instances.push(this)
    }

    static isSupported(): boolean {
      return FakeNotification.supported
    }

    show(): void {
      if (FakeNotification.autoShow) this.emit('show')
    }

    close(): void {
      this.emit('close')
    }
  }

  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [])
    },
    Notification: FakeNotification,
    powerMonitor: new EventEmitter()
  }
})

vi.mock('../db/repositories/task.repository', () => repositoryMock)
vi.mock('electron', () => electronMock)

import type { BoardTask, TaskReminder } from '../../shared/types'
import {
  setTaskReminderOpenWindowHandler,
  startTaskReminderService,
  stopTaskReminderService
} from './task-reminder.service'

describe('task reminder service', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    repositoryMock.createTaskFromMessage.mockReset()
    repositoryMock.deleteTasks.mockReset()
    repositoryMock.getTask.mockReset()
    repositoryMock.listDueReminders.mockReset()
    repositoryMock.listTasks.mockReturnValue([])
    repositoryMock.markReminderFired.mockReset()
    repositoryMock.markReminderFired.mockReturnValue(true)
    repositoryMock.updateTaskStatuses.mockReset()
    electronMock.Notification.supported = true
    electronMock.Notification.autoShow = true
    electronMock.Notification.instances.length = 0
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([])
    setTaskReminderOpenWindowHandler(null)
  })

  afterEach(() => {
    stopTaskReminderService()
    setTaskReminderOpenWindowHandler(null)
    vi.useRealTimers()
  })

  it('keeps a due reminder pending when desktop notifications are unsupported', () => {
    electronMock.Notification.supported = false
    repositoryMock.listDueReminders.mockReturnValue([dueReminder()])

    startTaskReminderService()

    expect(electronMock.Notification.instances).toHaveLength(0)
    expect(repositoryMock.markReminderFired).not.toHaveBeenCalled()
  })

  it('marks a reminder only after the notification show event and does not duplicate it after restart', () => {
    let pending = true
    repositoryMock.listDueReminders.mockImplementation(() => (pending ? [dueReminder()] : []))
    repositoryMock.markReminderFired.mockImplementation(() => {
      pending = false
      return true
    })

    startTaskReminderService()
    expect(electronMock.Notification.instances).toHaveLength(1)
    expect(repositoryMock.markReminderFired).toHaveBeenCalledWith(41, expect.any(String))

    stopTaskReminderService()
    startTaskReminderService()
    expect(electronMock.Notification.instances).toHaveLength(1)
  })

  it('stops interval and resume checks when the application exits', () => {
    repositoryMock.listDueReminders.mockReturnValue([])

    startTaskReminderService()
    expect(repositoryMock.listDueReminders).toHaveBeenCalledTimes(1)

    stopTaskReminderService()
    vi.advanceTimersByTime(120_000)
    electronMock.powerMonitor.emit('resume')

    expect(repositoryMock.listDueReminders).toHaveBeenCalledTimes(1)
  })

  it('routes a notification click through the main-process window handler', () => {
    const task = dueReminder()
    repositoryMock.listDueReminders.mockReturnValue([task])
    repositoryMock.getTask.mockReturnValue(task)
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      isVisible: vi.fn(() => true),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        isDestroyed: vi.fn(() => false),
        isLoading: vi.fn(() => false),
        executeJavaScript: vi.fn(() => Promise.resolve())
      }
    }
    const openWindow = vi.fn(() => window as unknown as BrowserWindow)
    setTaskReminderOpenWindowHandler(openWindow)

    startTaskReminderService()
    electronMock.Notification.instances[0]?.emit('click')

    expect(openWindow).toHaveBeenCalledWith('/7/99')
    expect(window.focus).toHaveBeenCalled()
  })
})

function dueReminder(): BoardTask & { reminder: TaskReminder } {
  return {
    taskId: 12,
    accountId: 7,
    messageId: 99,
    accountEmail: 'account@example.com',
    status: 'todo',
    note: 'follow up',
    subjectSnapshot: 'Subject',
    senderSnapshot: 'Sender',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    reminders: [{ reminderId: 41, fireAt: '2025-12-31T23:00:00.000Z', status: 'pending' }],
    reminder: { reminderId: 41, fireAt: '2025-12-31T23:00:00.000Z', status: 'pending' }
  }
}
