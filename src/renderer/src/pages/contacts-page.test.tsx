import { render, screen } from '@testing-library/react'
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
  createdAt: '',
  updatedAt: ''
}

function renderPage(): { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn().mockResolvedValue([contact])
  const api = {
    contacts: {
      list,
      save: vi.fn(),
      delete: vi.fn(),
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
  return { list }
}

describe('ContactsPage editor', () => {
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
})
