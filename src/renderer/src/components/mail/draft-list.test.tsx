import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@renderer/lib/i18n'
import type { OutboxMessage } from '@renderer/lib/api'
import type { Account } from './types'
import { DraftList } from './draft-list'

const accounts: Account[] = [1, 2].map((id) => ({
  id: String(id),
  accountId: id,
  name: `Account ${id}`,
  address: `sender${id}@example.com`,
  unread: 0,
  status: '',
  accent: ''
}))
const draft: OutboxMessage = {
  outboxId: 7,
  accountId: 2,
  kind: 'reply',
  relatedMessageId: 99,
  status: 'draft',
  subject: 'Review report',
  to: ['reader@example.com'],
  cc: ['team@example.com'],
  bcc: [],
  bodyText: 'Saved content',
  attachments: [],
  inReplyTo: '<original@example.com>',
  updatedAt: '2026-10-24T08:00:00Z'
}

function setup(
  overrides: Partial<React.ComponentProps<typeof DraftList>> = {}
): React.ComponentProps<typeof DraftList> {
  const props = {
    accounts,
    messages: [draft],
    totalCount: 1,
    offset: 0,
    pageSize: 50,
    accountId: 'all',
    keyword: '',
    loading: false,
    pending: false,
    error: null,
    onChangeAccount: vi.fn(),
    onChangeKeyword: vi.fn(),
    onChangePage: vi.fn(),
    onRefresh: vi.fn(),
    onCompose: vi.fn(),
    onOpenDraft: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(true),
    onDeleteMany: vi.fn().mockResolvedValue(true),
    ...overrides
  }
  render(
    <I18nProvider>
      <DraftList {...props} />
    </I18nProvider>
  )
  return props
}

describe('DraftList', () => {
  it('selects only this page without opening drafts and confirms batch deletion', async () => {
    const user = userEvent.setup()
    const props = setup({
      messages: [draft, { ...draft, outboxId: 8, subject: 'Second' }],
      totalCount: 105
    })
    await user.click(screen.getByRole('checkbox', { name: /Review report/ }))
    expect(props.onOpenDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '全选本页' })).toBePartiallyChecked()
    await user.click(screen.getByRole('checkbox', { name: '全选本页' }))
    await user.click(screen.getByRole('button', { name: '删除所选草稿' }))
    expect(props.onDeleteMany).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
    expect(props.onDeleteMany).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '删除所选草稿' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(props.onDeleteMany).toHaveBeenCalledWith([7, 8])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '全选本页' })).not.toBeChecked()
  })

  it('retains the batch selection and confirmation when deletion fails', async () => {
    const user = userEvent.setup()
    setup({
      messages: [draft, { ...draft, outboxId: 8 }],
      onDeleteMany: vi.fn().mockResolvedValue(false)
    })
    await user.click(screen.getByRole('checkbox', { name: '全选本页' }))
    await user.click(screen.getByRole('button', { name: '删除所选草稿' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('checkbox', { name: '全选本页' })).toBeChecked()
  })

  it('clears selection on page, account or search changes', async () => {
    const user = userEvent.setup()
    setup({ totalCount: 105 })
    const select = screen.getByRole('checkbox', { name: '全选本页' })
    await user.click(select)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(select).not.toBeChecked()
    await user.click(select)
    await user.selectOptions(screen.getByRole('combobox', { name: '发件账号' }), '2')
    expect(select).not.toBeChecked()
    await user.click(select)
    await user.type(screen.getByRole('textbox', { name: '搜索主题或收件人' }), 'a')
    expect(select).not.toBeChecked()
  })

  it('opens the whole draft row by click or keyboard with its original sender and reply context', async () => {
    const user = userEvent.setup()
    const props = setup()
    const row = screen.getByRole('button', { name: /Review report.*sender2@example.com/ })
    await user.click(screen.getByText(/reader@example.com/))
    expect(props.onOpenDraft).toHaveBeenLastCalledWith(draft)
    row.focus()
    await user.keyboard('{Enter}')
    expect(props.onOpenDraft).toHaveBeenCalledTimes(2)
  })

  it('keeps deletion separate from opening and requires confirmation', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: '删除草稿：Review report' }))
    expect(props.onOpenDraft).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(props.onDelete).toHaveBeenCalledWith(draft)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the confirmation open when deletion fails', async () => {
    const user = userEvent.setup()
    setup({ onDelete: vi.fn().mockResolvedValue(false) })
    await user.click(screen.getByRole('button', { name: '删除草稿：Review report' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('provides account filtering, searching, pagination, refresh and compose actions', async () => {
    const user = userEvent.setup()
    const props = setup({ totalCount: 105 })
    await user.selectOptions(screen.getByRole('combobox', { name: '发件账号' }), '2')
    expect(props.onChangeAccount).toHaveBeenCalledWith('2')
    await user.type(screen.getByRole('textbox', { name: '搜索主题或收件人' }), 'a')
    expect(props.onChangeKeyword).toHaveBeenCalledWith('a')
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(props.onChangePage).toHaveBeenCalledWith(50)
    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(props.onRefresh).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: '写信' }))
    expect(props.onCompose).toHaveBeenCalledOnce()
  })

  it('displays an empty filtered result', () => {
    setup({ messages: [], keyword: 'missing', totalCount: 0 })
    expect(screen.getByText('没有符合条件的草稿')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('does not show stale rows while loading', () => {
    setup({ loading: true })
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    expect(screen.queryByText('Review report')).not.toBeInTheDocument()
  })

  it('shows query errors with a retry action', async () => {
    const user = userEvent.setup()
    const props = setup({ error: '读取失败' })
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败')
    expect(screen.queryByText('Review report')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '刷新' }))
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
})
