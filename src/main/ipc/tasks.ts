import { ipcMain } from 'electron'

import type { BoardTaskStatusUpdate, CreateBoardTaskInput } from './types'
import type { BoardTaskUpdate } from '../../shared/types'
import {
  broadcastTasksChanged,
  createBoardTask,
  deleteBoardTasks,
  getBoardTasks,
  updateBoardTask,
  updateBoardTaskStatuses
} from '../services/task-reminder.service'

export function registerTasksIpc(): void {
  ipcMain.handle('tasks/list', () => getBoardTasks())
  ipcMain.handle('tasks/createFromMessage', (_event, input: CreateBoardTaskInput) =>
    createBoardTask(input)
  )
  ipcMain.handle('tasks/updateStatus', (_event, input: BoardTaskStatusUpdate) =>
    updateBoardTaskStatuses(input)
  )
  ipcMain.handle('tasks/delete', (_event, taskIds: number[]) => deleteBoardTasks(taskIds))
  ipcMain.handle('tasks/update', (_event, input: BoardTaskUpdate) => updateBoardTask(input))
  // Mutation validation lives in the repository, so IPC and automatic rules use the same checks.
  ipcMain.on('tasks/refresh', () => broadcastTasksChanged())
}
