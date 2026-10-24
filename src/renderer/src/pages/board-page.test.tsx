import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { BoardTask } from '../../../shared/types'
import { BoardPage } from './board-page'

function task(taskId: number): BoardTask {
  return {
    taskId,
    accountId: 1,
    messageId: taskId,
    accountEmail: 'me@example.com',
    status: 'todo',
    note: '原备注',
    subjectSnapshot: `任务 ${taskId}`,
    senderSnapshot: '发件人',
    createdAt: '',
    updatedAt: '',
    reminders: [{ reminderId: taskId, fireAt: '2099-01-01T08:00:00.000Z', status: 'pending' }]
  }
}

function renderPage(): {
  updateStatus: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
} {
  const tasks = [task(1), task(2), task(3)]
  const updateStatus = vi
    .fn()
    .mockImplementation(({ taskIds, status }) =>
      Promise.resolve(
        tasks.map((item) => (taskIds.includes(item.taskId) ? { ...item, status } : item))
      )
    )
  const update = vi.fn().mockResolvedValue(tasks[0])
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      tasks: {
        list: vi.fn().mockResolvedValue(tasks),
        onChanged: vi.fn(() => vi.fn()),
        updateStatus,
        update,
        delete: vi.fn()
      },
      notifications: { status: vi.fn().mockResolvedValue({ desktopSupported: true }) }
    }
  })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
  const router = createMemoryRouter([{ path: '/board', element: <BoardPage /> }], {
    initialEntries: ['/board']
  })
  render(<RouterProvider router={router} />)
  return { updateStatus, update }
}

function dataTransfer(): {
  setData: ReturnType<typeof vi.fn>
  effectAllowed: string
  dropEffect: string
} {
  return { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
}

describe('BoardPage', () => {
  it('moves every selected task when dragging a selected card into another column', async () => {
    const { updateStatus } = renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: '选择 任务 1' }))
    await user.click(screen.getByRole('checkbox', { name: '选择 任务 2' }))
    const card = screen.getByRole('button', { name: '打开邮件：任务 1' }).closest('article')!
    const transfer = dataTransfer()
    fireEvent.dragStart(card, { dataTransfer: transfer })
    const column = screen.getByRole('region', { name: '正在进行' })
    fireEvent.dragOver(column, { dataTransfer: transfer })
    fireEvent.drop(column, { dataTransfer: transfer })
    await waitFor(() =>
      expect(updateStatus).toHaveBeenCalledWith({
        taskIds: [1, 2],
        status: 'in_progress'
      })
    )
  })

  it('drags only the unselected card and ignores drops from outside the board', async () => {
    const { updateStatus } = renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: '选择 任务 1' }))
    const transfer = dataTransfer()
    const column = screen.getByRole('region', { name: '已完成 / 已取消' })
    fireEvent.drop(column, { dataTransfer: transfer })
    expect(updateStatus).not.toHaveBeenCalled()
    const card = screen.getByRole('button', { name: '打开邮件：任务 3' }).closest('article')!
    fireEvent.dragStart(card, { dataTransfer: transfer })
    fireEvent.drop(column, { dataTransfer: transfer })
    await waitFor(() =>
      expect(updateStatus).toHaveBeenCalledWith({
        taskIds: [3],
        status: 'completed'
      })
    )
  })

  it('edits task information and a reminder through the context menu', async () => {
    const { update } = renderPage()
    const user = userEvent.setup()
    const open = await screen.findByRole('button', { name: '打开邮件：任务 1' })
    fireEvent.contextMenu(open.closest('article')!, { button: 2, clientX: 100, clientY: 100 })
    await user.click(await screen.findByRole('menuitem', { name: '编辑事项和通知时间' }))
    const title = await screen.findByLabelText('任务标题')
    await user.clear(title)
    await user.type(title, '修改后的标题')
    const note = screen.getByLabelText('邮件备注')
    await user.clear(note)
    await user.type(note, '修改后的备注')
    fireEvent.change(screen.getByLabelText('第 1 条提醒的指定时间'), {
      target: { value: '2099-01-02T12:00' }
    })
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        taskId: 1,
        subjectSnapshot: '修改后的标题',
        note: '修改后的备注',
        reminders: [{ reminderId: 1, fireAt: new Date(2099, 0, 2, 12, 0).toISOString() }]
      })
    )
  })

  it('uses a draggable title bar with reserved system controls space', async () => {
    renderPage()
    await screen.findByRole('checkbox', { name: '选择 任务 1' })
    expect(screen.getByRole('banner')).toHaveClass('app-titlebar', 'app-drag-region')
  })
})
