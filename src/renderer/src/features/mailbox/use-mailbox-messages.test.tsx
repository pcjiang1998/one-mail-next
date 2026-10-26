import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/lib/api', () => ({
  downloadAttachment: vi.fn(),
  bulkSetMessageReadState: vi.fn(),
  loadMessageBody: vi.fn(),
  loadMessageDetail: vi.fn(),
  loadMessages: vi.fn(),
  markAllMessagesRead: vi.fn(),
  setMessageReadState: vi.fn(),
  toMessageQuery: vi.fn(),
  MESSAGE_LIST_PAGE_SIZE: 100
}))

import { loadMessageBody, setMessageReadState } from '@renderer/lib/api'
import { I18nProvider } from '@renderer/lib/i18n'
import type { Message } from '@renderer/components/mail/types'
import { useMailboxMessages } from './use-mailbox-messages'

describe('mail body and read-state concurrency', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['Ordinary mail', 'Your verification code'])(
    'preserves local read state when a stale body response arrives for %s',
    async (subject) => {
      const message: Message = {
        id: '1',
        messageId: 1,
        accountId: 1,
        folderId: 1,
        from: 'sender@example.com',
        subject,
        preview: '',
        body: [],
        bodyStatus: 'none',
        bodyLoaded: false,
        detailLoaded: true,
        time: '',
        dateLabel: '',
        unread: true,
        starred: false,
        attachments: []
      }
      let completeBody!: (detail: Message) => void
      vi.mocked(loadMessageBody).mockReturnValue(
        new Promise((resolve) => {
          completeBody = resolve
        })
      )
      vi.mocked(setMessageReadState).mockResolvedValue({
        messageId: 1,
        accountId: 1,
        folderId: 1,
        isRead: true,
        remoteMissing: true
      })
      const { result } = renderHook(
        () =>
          useMailboxMessages({
            selectedAccountId: '1',
            filters: [],
            searchKeyword: '',
            loading: false,
            setAccounts: vi.fn(),
            setError: vi.fn()
          }),
        { wrapper: I18nProvider }
      )
      act(() => result.current.replaceMessages([message], { selectFirst: true }))
      await waitFor(() => expect(result.current.selectedMessage?.unread).toBe(false))
      await waitFor(() => expect(loadMessageBody).toHaveBeenCalledOnce())
      await act(async () => {
        completeBody({ ...message, bodyStatus: 'error', remoteMissing: false })
      })
      expect(result.current.selectedMessage).toMatchObject({
        unread: false,
        remoteMissing: true,
        bodyStatus: 'error'
      })
    }
  )
})
