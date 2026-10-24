import * as React from 'react'
import { loadDraftMessages } from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import { getErrorMessage } from './mailbox-utils'

export const DRAFT_PAGE_SIZE = 50

type DraftQuery = { accountId: string; keyword: string; offset: number }
type DraftPage = Awaited<ReturnType<typeof loadDraftMessages>>

export function useLocalDrafts(
  accountIds: string,
  enabled: boolean
): {
  query: DraftQuery
  result: DraftPage | null
  loading: boolean
  error: string | null
  refresh: () => void
  changeQuery: (next: Partial<DraftQuery>) => void
} {
  const { t } = useI18n()
  const [query, setQuery] = React.useState({ accountId: 'all', keyword: '', offset: 0 })
  const [result, setResult] = React.useState<DraftPage | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [settledAccountIds, setSettledAccountIds] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [revision, bumpRevision] = React.useReducer((value: number) => value + 1, 0)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = window.setTimeout(
      () => {
        void loadDraftMessages({
          accountId: query.accountId === 'all' ? undefined : Number(query.accountId),
          keyword: query.keyword,
          offset: query.offset,
          limit: DRAFT_PAGE_SIZE
        })
          .then((nextResult) => {
            if (!cancelled) {
              setResult(nextResult)
              setSettledAccountIds(accountIds)
              setError(null)
              setLoading(false)
            }
          })
          .catch((loadError) => {
            if (!cancelled) {
              setSettledAccountIds(accountIds)
              setError(getErrorMessage(loadError, t('mailbox.loadDraftsError')))
              setLoading(false)
            }
          })
      },
      query.keyword ? 150 : 0
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [accountIds, enabled, query, revision, t])

  const refresh = React.useCallback(() => {
    setLoading(true)
    setError(null)
    bumpRevision()
  }, [])

  function changeQuery(next: Partial<typeof query>): void {
    setLoading(true)
    setError(null)
    setQuery((current) => ({ ...current, offset: 0, ...next }))
  }

  return {
    query,
    result: settledAccountIds === accountIds ? result : null,
    loading: loading || settledAccountIds !== accountIds,
    error,
    refresh,
    changeQuery
  }
}
