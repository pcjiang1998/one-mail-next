import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@renderer/lib/i18n'
import { loadDraftMessages } from '@renderer/lib/api'
import { useLocalDrafts } from './use-local-drafts'

vi.mock('@renderer/lib/api', () => ({ loadDraftMessages: vi.fn() }))
const page = { messages: [], totalCount: 105, draftCount: 105, offset: 0 }
const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <I18nProvider>{children}</I18nProvider>
)

describe('useLocalDrafts', () => {
  beforeEach(() => {
    vi.mocked(loadDraftMessages).mockReset().mockResolvedValue(page)
  })

  it('loads once, resets pagination for filters and refreshes without a render loop', async () => {
    const { result, rerender } = renderHook(() => useLocalDrafts('1,2', true), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(loadDraftMessages).toHaveBeenCalledTimes(1)
    rerender()
    expect(loadDraftMessages).toHaveBeenCalledTimes(1)
    act(() => result.current.changeQuery({ offset: 50 }))
    await waitFor(() =>
      expect(loadDraftMessages).toHaveBeenLastCalledWith({
        accountId: undefined,
        keyword: '',
        offset: 50,
        limit: 50
      })
    )
    act(() => result.current.changeQuery({ accountId: '2', keyword: 'report' }))
    await waitFor(() =>
      expect(loadDraftMessages).toHaveBeenLastCalledWith({
        accountId: 2,
        keyword: 'report',
        offset: 0,
        limit: 50
      })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.refresh())
    await waitFor(() => expect(loadDraftMessages).toHaveBeenCalledTimes(4))
  })

  it('ignores an older response after a filter change', async () => {
    let completeOld!: (value: typeof page) => void
    vi.mocked(loadDraftMessages).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve
        })
    )
    const { result } = renderHook(() => useLocalDrafts('1,2', true), { wrapper })
    await waitFor(() => expect(loadDraftMessages).toHaveBeenCalledOnce())
    act(() => result.current.changeQuery({ accountId: '2' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => completeOld({ ...page, totalCount: 999 }))
    expect(result.current.result?.totalCount).toBe(105)
  })

  it('reports failures and recovers on explicit refresh', async () => {
    vi.mocked(loadDraftMessages).mockRejectedValueOnce(new Error('Database error'))
    const { result } = renderHook(() => useLocalDrafts('1', true), { wrapper })
    await waitFor(() => expect(result.current.error).toBe('Database error'))
    expect(result.current.loading).toBe(false)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.result?.draftCount).toBe(105))
    expect(result.current.error).toBeNull()
  })
})
