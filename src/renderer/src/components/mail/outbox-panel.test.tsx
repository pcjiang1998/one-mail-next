import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@renderer/lib/i18n'
import { OutboxPanel } from './outbox-panel'
import type { OutboxMessage } from '@renderer/lib/api'

describe('OutboxPanel refresh', () => {
  it('labels unknown delivery and does not offer ordinary retry', () => {
    const message = { ...createMessages()[2], deliveryUncertain: true }
    render(
      <I18nProvider>
        <OutboxPanel
          outboxMessages={[message]}
          onRefresh={vi.fn()}
          onRetry={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />
      </I18nProvider>
    )
    expect(screen.getByText('投递结果未知')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })
  it.each([
    ['清除已发送', 'sent'],
    ['清除失败', 'failed']
  ] as const)(
    'confirms %s even with no visible records and retains failed confirmations',
    async (label, status) => {
      const user = userEvent.setup()
      const onClear = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      render(
        <I18nProvider>
          <OutboxPanel
            outboxMessages={[]}
            onRefresh={vi.fn()}
            onRetry={vi.fn()}
            onDelete={vi.fn()}
            onClear={onClear}
          />
        </I18nProvider>
      )
      await user.click(screen.getByRole('button', { name: label }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' })
      )
      expect(onClear).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: label }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' })
      )
      expect(onClear).toHaveBeenCalledWith(status)
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' })
      )
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    }
  )

  it('does not refresh in a loop when the parent passes an inline callback', async () => {
    const refresh = vi.fn()
    function Harness({ open }: { open: boolean }): React.JSX.Element {
      const [revision, setRevision] = React.useState(0)
      return (
        <I18nProvider>
          <output data-testid="revision">{revision}</output>
          {open ? (
            <OutboxPanel
              outboxMessages={[]}
              onRefresh={() => {
                refresh()
                if (revision < 4)
                  void Promise.resolve().then(() => setRevision((value) => value + 1))
              }}
              onRetry={vi.fn()}
              onDelete={vi.fn()}
              onClear={vi.fn()}
            />
          ) : null}
        </I18nProvider>
      )
    }
    const view = render(<Harness open />)
    await waitFor(() => expect(screen.getByTestId('revision')).toHaveTextContent('1'))
    expect(refresh).toHaveBeenCalledTimes(1)
    view.rerender(<Harness open />)
    expect(refresh).toHaveBeenCalledTimes(1)
    view.rerender(<Harness open={false} />)
    view.rerender(<Harness open />)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  })

  it('renders inline statuses, retry and delete without a drawer or dialog', async () => {
    const user = userEvent.setup()
    const messages = createMessages()
    const onRetry = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <I18nProvider>
        <OutboxPanel
          outboxMessages={messages}
          onRefresh={vi.fn()}
          onRetry={onRetry}
          onDelete={onDelete}
          onClear={vi.fn()}
        />
      </I18nProvider>
    )
    expect(screen.getByRole('region', { name: '发送队列' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('SMTP rejected')).toBeInTheDocument()
    expect(screen.getByText('Connection warning')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    await user.click(within(rows[0]).getByRole('button', { name: '删除' }))
    expect(onDelete).toHaveBeenCalledWith(messages[0])
    expect(within(rows[1]).getByRole('button', { name: '删除' })).toBeDisabled()
    expect(within(rows[1]).queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
    await user.click(within(rows[2]).getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledWith(messages[2])
  })

  it('shows loading and errors with manual refresh, without stale interactive rows', async () => {
    const onRefresh = vi.fn()
    const props = {
      outboxMessages: createMessages(),
      onRefresh,
      onRetry: vi.fn(),
      onDelete: vi.fn(),
      onClear: vi.fn()
    }
    const view = render(
      <I18nProvider>
        <OutboxPanel {...props} loading />
      </I18nProvider>
    )
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新' })).toBeDisabled()
    view.rerender(
      <I18nProvider>
        <OutboxPanel {...props} error="读取失败" />
      </I18nProvider>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('读取失败')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '刷新' }))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('disables mutation controls while an operation is pending', () => {
    render(
      <I18nProvider>
        <OutboxPanel
          pending
          outboxMessages={createMessages()}
          onRefresh={vi.fn()}
          onRetry={vi.fn()}
          onDelete={vi.fn()}
          onClear={vi.fn()}
        />
      </I18nProvider>
    )
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})

function createMessages(): OutboxMessage[] {
  return (['queued', 'sending', 'failed'] as const).map((status, index) => ({
    outboxId: index + 1,
    accountId: 1,
    kind: 'new',
    status,
    subject: `Message ${status}`,
    to: ['recipient@example.com'],
    cc: [],
    bcc: [],
    bodyText: '',
    attachments: [],
    updatedAt: '2026-10-24T08:00:00Z',
    lastError: status === 'failed' ? 'SMTP rejected' : undefined,
    lastWarning: status === 'queued' ? 'Connection warning' : undefined
  }))
}
