import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { Contact } from '../../../shared/types'
import { ContactsPage } from './contacts-page'

const contact: Contact = {
  contactId: 21,
  displayName: '张三',
  note: '原备注',
  isStarred: false,
  emails: [{ contactEmailId: 1, email: 'old@example.com', label: '', isDefault: true }],
  groups: [
    { groupId: 1, name: '工作' },
    { groupId: 2, name: '朋友' }
  ],
  createdAt: '',
  updatedAt: ''
}

function renderPage(contacts = [contact]): {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
} {
  const list = vi.fn().mockResolvedValue(contacts)
  const save = vi.fn().mockResolvedValue(contact)
  const deleteMany = vi.fn().mockResolvedValue(2)
  const api = {
    contacts: {
      list,
      listGroups: vi.fn().mockResolvedValue(contact.groups),
      saveGroup: vi.fn(),
      deleteGroup: vi.fn(),
      save,
      delete: vi.fn().mockResolvedValue(true),
      deleteMany,
      importVCard: vi.fn(),
      exportVCard: vi.fn()
    }
  }
  Object.defineProperty(window, 'api', { configurable: true, value: api })
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
  const router = createMemoryRouter([{ path: '/contacts', element: <ContactsPage /> }], {
    initialEntries: ['/contacts']
  })
  render(<RouterProvider router={router} />)
  return { list, save, deleteMany }
}

describe('ContactsPage editor', () => {
  const others: Contact[] = [22, 23].map((contactId) => ({
    ...contact,
    contactId,
    displayName: `Other ${contactId}`,
    groups: []
  }))

  it('deletes selected contacts without opening them or discarding another dirty editor', async () => {
    const { deleteMany } = renderPage([contact, ...others])
    const user = userEvent.setup()
    const name = await screen.findByDisplayValue('张三')
    await user.clear(name)
    await user.type(name, '未保存')
    for (const other of others)
      await user.click(screen.getByRole('checkbox', { name: `选择联系人：${other.displayName}` }))
    expect(name).toHaveValue('未保存')
    expect(screen.getByRole('checkbox', { name: '全选筛选结果' })).toBePartiallyChecked()
    await user.click(screen.getByRole('button', { name: '删除所选联系人' }))
    const dialog = screen.getByRole('dialog', { name: '删除所选的 2 个联系人？' })
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(deleteMany).toHaveBeenCalledWith([22, 23])
    expect(screen.queryByRole('checkbox', { name: /Other/ })).not.toBeInTheDocument()
    expect(name).toHaveValue('未保存')
  })

  it('selects filtered contacts, clears on filter changes, and retains failed deletion', async () => {
    const { deleteMany } = renderPage([contact, ...others])
    deleteMany.mockRejectedValue(new Error('删除失败测试'))
    const user = userEvent.setup()
    await screen.findByDisplayValue('张三')
    await user.click(screen.getByRole('checkbox', { name: '全选筛选结果' }))
    await user.selectOptions(screen.getByLabelText('按联系人分组筛选'), 'ungrouped')
    expect(screen.getByRole('checkbox', { name: '全选筛选结果' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: '全选筛选结果' }))
    await user.click(screen.getByRole('button', { name: '删除所选联系人' }))
    await user.click(
      within(screen.getByRole('dialog', { name: /删除所选/ })).getByRole('button', {
        name: '确认删除'
      })
    )
    expect(deleteMany).toHaveBeenCalledWith([22, 23])
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败测试')
    await user.click(
      within(screen.getByRole('dialog', { name: /删除所选/ })).getByRole('button', { name: '取消' })
    )
    expect(screen.getByRole('checkbox', { name: '全选筛选结果' })).toBeChecked()
    await user.type(screen.getByLabelText('搜索联系人'), 'Other')
    expect(screen.getByRole('checkbox', { name: '全选筛选结果' })).not.toBeChecked()
  })

  it('warns about and resets the deleted dirty editor after batch deletion', async () => {
    renderPage([contact, ...others])
    const user = userEvent.setup()
    const name = await screen.findByDisplayValue('张三')
    await user.type(name, '未保存')
    await user.click(screen.getByRole('checkbox', { name: '全选筛选结果' }))
    await user.click(screen.getByRole('button', { name: '删除所选联系人' }))
    expect(screen.getByText('当前联系人的未保存修改也将被丢弃。')).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog', { name: /删除所选/ })).getByRole('button', {
        name: '确认删除'
      })
    )
    expect(name).toHaveValue('')
    expect(screen.getByText('还没有联系人，可以新建或导入。')).toBeInTheDocument()
  })

  it('keeps the email input focused while typing and supports removing an email row', async () => {
    renderPage()
    const user = userEvent.setup()
    const email = await screen.findByDisplayValue('old@example.com')

    await user.clear(email)
    await user.type(email, 'new@example.com')
    expect(document.activeElement).toBe(email)

    await user.click(screen.getByRole('button', { name: '添加邮箱' }))
    expect(screen.getByLabelText('邮箱地址 2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '删除邮箱 2' }))
    expect(screen.queryByLabelText('邮箱地址 2')).toBeNull()
  })

  it('does not replace an unsaved editor draft when searching the list', async () => {
    renderPage()
    const user = userEvent.setup()
    const name = await screen.findByPlaceholderText('例如：张三')
    await user.clear(name)
    await user.type(name, '未保存的姓名')

    await user.type(screen.getByRole('textbox', { name: '搜索联系人' }), '没有这个人')
    expect((name as HTMLInputElement).value).toBe('未保存的姓名')
    expect(screen.getByText('没有匹配的联系人。')).toBeTruthy()
  })

  it('filters by group and text together without discarding unsaved edits', async () => {
    renderPage([
      contact,
      {
        ...contact,
        contactId: 22,
        displayName: '李四',
        groups: [],
        emails: [{ email: 'li@example.com', isDefault: true }]
      }
    ])
    const user = userEvent.setup()
    const name = await screen.findByDisplayValue('张三')
    await user.clear(name)
    await user.type(name, '未保存')
    const list = within(screen.getByRole('region', { name: '联系人列表' }))
    await user.selectOptions(screen.getByLabelText('按联系人分组筛选'), '1')
    expect(list.getByRole('button', { name: /张三/ })).toBeInTheDocument()
    expect(list.queryByRole('button', { name: /李四/ })).toBeNull()
    await user.type(screen.getByLabelText('搜索联系人'), 'old')
    expect(list.getByRole('button', { name: /张三/ })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('按联系人分组筛选'), 'ungrouped')
    expect(list.queryByRole('button', { name: /张三/ })).toBeNull()
    expect(name).toHaveValue('未保存')
  })

  it('saves multiple group memberships as part of the contact edit', async () => {
    const { save } = renderPage()
    const user = userEvent.setup()
    await screen.findByDisplayValue('张三')
    await user.click(screen.getByRole('checkbox', { name: '朋友' }))
    await user.click(screen.getByRole('button', { name: '保存联系人' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ groupIds: [1] }))
  })

  it('reserves the system controls area and exposes a draggable title bar', async () => {
    renderPage()
    await screen.findByDisplayValue('张三')
    expect(screen.getByRole('banner')).toHaveClass('app-titlebar', 'app-drag-region')
  })
})
