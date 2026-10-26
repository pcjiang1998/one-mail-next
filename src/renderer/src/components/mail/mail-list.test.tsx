import { fireEvent, render, screen, within } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const contextMenuTriggerSpy = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/ui/context-menu', async () => {
  const { cloneElement, createElement, Fragment } = await import('react')
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode =>
    createElement(Fragment, null, children)

  return {
    ContextMenu: passthrough,
    ContextMenuTrigger: ({ children }: { children: ReactNode }) => {
      const child = children as ReactElement<{
        onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
      }>
      return cloneElement(child, {
        onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
          child.props.onContextMenu?.(event)
          contextMenuTriggerSpy(event)
        }
      })
    },
    ContextMenuContent: passthrough,
    ContextMenuSeparator: () => createElement('hr'),
    ContextMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children?: ReactNode
      disabled?: boolean
      onSelect?: () => void
    }) => createElement('button', { disabled, onClick: onSelect }, children)
  }
})

import { I18nProvider } from '@renderer/lib/i18n'
import { MailList } from './mail-list'
import type { Account, Message } from './types'

const account: Account = {
  id: '1',
  accountId: 1,
  name: 'Test account',
  address: 'user@example.com',
  unread: 2,
  status: 'active',
  accent: 'bg-primary'
}

function createMessage(id: string): Message {
  return {
    id,
    messageId: Number(id),
    accountId: 1,
    folderId: 1,
    from: `Sender ${id}`,
    subject: `Subject ${id}`,
    preview: '',
    body: [],
    bodyStatus: 'none',
    bodyLoaded: false,
    detailLoaded: false,
    time: '12:00',
    dateLabel: 'Today',
    unread: true,
    starred: false,
    attachments: []
  }
}

afterEach(() => {
  vi.useRealTimers()
  contextMenuTriggerSpy.mockClear()
})

describe('MailList range selection', () => {
  it('keeps the selection toolbar below the scroll area as selections change', () => {
    const props = {
      account,
      messages: [createMessage('1')],
      selectedMessageId: '',
      filters: [],
      searchKeyword: '',
      onSelectMessage: vi.fn(),
      onChangeFilters: vi.fn(),
      onChangeSearchKeyword: vi.fn(),
      onLoadMore: vi.fn(),
      onSelectAllVisible: vi.fn(),
      onClearSelection: vi.fn(),
      onMarkSelectedRead: vi.fn(),
      onDeleteSelected: vi.fn()
    }
    const view = render(
      <I18nProvider initialLocale="en-US">
        <MailList {...props} />
      </I18nProvider>
    )
    const toolbar = screen.getByRole('toolbar')
    const scrollArea = toolbar.previousElementSibling
    const row = screen.getByText('Subject 1').closest('[role="button"]')
    expect(scrollArea).toContainElement(row as HTMLElement)
    expect(toolbar).toHaveClass('h-12', 'shrink-0')
    expect(within(toolbar).getByRole('button', { name: 'Mark read' })).toBeDisabled()
    for (const selectedMessageIds of [new Set(['1']), new Set<string>()]) {
      view.rerender(
        <I18nProvider initialLocale="en-US">
          <MailList {...props} selectedMessageIds={selectedMessageIds} />
        </I18nProvider>
      )
      expect(screen.getByRole('toolbar')).toBe(toolbar)
      expect(toolbar.previousElementSibling).toBe(scrollArea)
      expect(screen.getByText('Subject 1').closest('[role="button"]')).toBe(row)
      expect(
        within(toolbar).getByRole('button', { name: 'Delete permanently' }).hasAttribute('disabled')
      ).toBe(selectedMessageIds.size === 0)
    }
  })

  it('does not toggle the range endpoint again when the pointer is released', () => {
    vi.useFakeTimers()
    const onToggleMessageSelection = vi.fn()

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={[createMessage('1'), createMessage('2')]}
          selectedMessageId="1"
          filters={[]}
          searchKeyword=""
          selectedMessageIds={new Set(['1'])}
          onSelectMessage={() => undefined}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onToggleMessageSelection={onToggleMessageSelection}
        />
      </I18nProvider>
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Select Subject 2' })
    fireEvent.pointerDown(checkbox, { shiftKey: true })
    fireEvent.pointerUp(checkbox, { shiftKey: true })
    fireEvent.click(checkbox, { shiftKey: true })

    expect(onToggleMessageSelection).toHaveBeenCalledTimes(1)
    expect(onToggleMessageSelection).toHaveBeenLastCalledWith('2', true)

    vi.runAllTimers()
    fireEvent.click(checkbox)
    expect(onToggleMessageSelection).toHaveBeenCalledTimes(2)
    expect(onToggleMessageSelection).toHaveBeenLastCalledWith('2', false)
  })

  it('toggles a message without opening it when Ctrl-clicking the summary', () => {
    const onToggleMessageSelection = vi.fn()
    const onSelectMessage = vi.fn()

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={[createMessage('1'), createMessage('2')]}
          selectedMessageId="1"
          filters={[]}
          searchKeyword=""
          onSelectMessage={onSelectMessage}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onToggleMessageSelection={onToggleMessageSelection}
        />
      </I18nProvider>
    )

    const row = screen.getByText('Subject 2').closest('[role="button"]')
    expect(row).not.toBeNull()
    fireEvent.click(row!, { ctrlKey: true })

    expect(onToggleMessageSelection).toHaveBeenCalledWith('2', false)
    expect(onSelectMessage).not.toHaveBeenCalled()
  })

  it('clears multi-selection before opening a message on a plain click', () => {
    const onClearSelection = vi.fn()
    const onSelectMessage = vi.fn()

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={[createMessage('1'), createMessage('2')]}
          selectedMessageId="1"
          filters={[]}
          searchKeyword=""
          selectedMessageIds={new Set(['1', '2'])}
          onSelectMessage={onSelectMessage}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onClearSelection={onClearSelection}
        />
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Subject 2').closest('[role="button"]')!)

    expect(onClearSelection).toHaveBeenCalledOnce()
    expect(onSelectMessage).toHaveBeenCalledWith('2')
    expect(onClearSelection.mock.invocationCallOrder[0]).toBeLessThan(
      onSelectMessage.mock.invocationCallOrder[0]
    )
  })
})

describe('MailList context menu', () => {
  it('forwards the context-menu trigger event to the message summary DOM node', () => {
    const onPrepareContextSelection = vi.fn()

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={[createMessage('1')]}
          selectedMessageId=""
          filters={[]}
          searchKeyword=""
          onSelectMessage={() => undefined}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onPrepareContextSelection={onPrepareContextSelection}
        />
      </I18nProvider>
    )

    fireEvent.contextMenu(screen.getByText('Subject 1').closest('[role="button"]')!)

    expect(contextMenuTriggerSpy).toHaveBeenCalledOnce()
    expect(onPrepareContextSelection).toHaveBeenCalledWith('1')
  })

  it('offers reply actions for one message', () => {
    const onReplyMessage = vi.fn()
    const message = createMessage('1')

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={[message]}
          selectedMessageId="1"
          filters={[]}
          searchKeyword=""
          onSelectMessage={() => undefined}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onReplyMessage={onReplyMessage}
        />
      </I18nProvider>
    )

    fireEvent.click(screen.getByText('Reply all'))

    expect(onReplyMessage).toHaveBeenCalledWith(message, true)
  })

  it('offers individual and EML attachment forwarding for multiple messages', () => {
    const onForwardMessages = vi.fn()
    const messages = [createMessage('1'), createMessage('2')]

    render(
      <I18nProvider initialLocale="en-US">
        <MailList
          account={account}
          messages={messages}
          selectedMessageId="1"
          filters={[]}
          searchKeyword=""
          selectedMessageIds={new Set(['1', '2'])}
          onSelectMessage={() => undefined}
          onChangeFilters={() => undefined}
          onChangeSearchKeyword={() => undefined}
          onLoadMore={() => undefined}
          onForwardMessages={onForwardMessages}
        />
      </I18nProvider>
    )

    expect(screen.getAllByText('Forward individually')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Forward as original mail')[0])

    expect(onForwardMessages).toHaveBeenCalledWith(messages, true)
  })
})
