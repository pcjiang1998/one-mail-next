import { handleDatabaseIpc } from './database-handler'
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
  handleDatabaseIpc('tasks/list', () => getBoardTasks())
  handleDatabaseIpc('tasks/createFromMessage', (_event, input: CreateBoardTaskInput) =>
    createBoardTask(input)
  )
  handleDatabaseIpc('tasks/updateStatus', (_event, input: BoardTaskStatusUpdate) =>
    updateBoardTaskStatuses(input)
  )
  handleDatabaseIpc('tasks/delete', (_event, taskIds: number[]) => deleteBoardTasks(taskIds))
  handleDatabaseIpc('tasks/update', (_event, input: BoardTaskUpdate) => updateBoardTask(input))
  // Mutation validation lives in the repository, so IPC and automatic rules use the same checks.
  ipcMain.on('tasks/refresh', () => broadcastTasksChanged())
}
