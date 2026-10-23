import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Contact } from '../../../../shared/types'
import { I18nProvider } from '@renderer/lib/i18n'
import { AddressInput } from './address-input'

const contact: Contact = {
  contactId: 11,
  displayName: '张三',
  note: '',
  isStarred: false,
  emails: [
    { contactEmailId: 1, email: 'zhang.work@example.com', label: '工作', isDefault: true },
    { contactEmailId: 2, email: 'zhang.home@example.com', label: '家庭', isDefault: false }
  ],
  createdAt: '',
  updatedAt: ''
}

describe('AddressInput contact suggestions', () => {
  it('selects one suggested email instead of expanding every email on the contact', async () => {
    const list = vi.fn().mockResolvedValue([contact])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { contacts: { list } }
    })
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <label htmlFor="to">收件人</label>
        <AddressInput id="to" value={[]} onChange={onChange} placeholder="收件人" />
      </I18nProvider>
    )

    await user.type(screen.getByRole('textbox', { name: '收件人' }), 'zhang')
    const suggestions = await screen.findAllByRole('option')
    expect(suggestions).toHaveLength(2)
    await user.click(suggestions[1])

    expect(onChange).toHaveBeenCalledWith(['zhang.home@example.com'])
    expect(onChange).not.toHaveBeenCalledWith(['zhang.work@example.com', 'zhang.home@example.com'])
    await waitFor(() => expect(list).toHaveBeenCalled())
  })

  it('commits a manually entered mailbox as one address', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { contacts: { list: vi.fn().mockResolvedValue([]) } }
    })
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nProvider>
        <AddressInput id="cc" value={[]} onChange={onChange} />
      </I18nProvider>
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'one@example.com')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(['one@example.com'])
  })
})
