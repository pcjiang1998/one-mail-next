import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AddressHoverCard } from './address-hover-card'

describe('AddressHoverCard', () => {
  it('allows adding one recipient from a list with a quoted comma in the name', async () => {
    const add = vi.fn().mockResolvedValue({ contactId: 1 })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { contacts: { addFromAddress: add } }
    })
    const user = userEvent.setup()
    render(<AddressHoverCard value={'"Doe, Jane" <jane@example.com>, 李四 <li@example.com>'} />)
    await user.click(screen.getByRole('button'))
    const actions = await screen.findAllByRole('button', { name: '添加到联系人' })
    await user.click(actions[0])
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        displayName: 'Doe, Jane',
        email: 'jane@example.com'
      })
    )
    expect(screen.getByRole('button', { name: '已在联系人中' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '添加到联系人' })).toHaveLength(1)
  })
})
