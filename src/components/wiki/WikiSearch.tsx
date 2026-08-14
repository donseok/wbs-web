'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { WikiSearchResults } from './WikiSearchResults'
import { toSearchViewState, type SearchViewState } from '@/lib/domain/searchView'
import { t, type Locale } from '@/lib/i18n/dict'

export function WikiSearch({ projectId, locale, initialQuery }: {
  projectId: string
  locale: Locale
  initialQuery: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [state, setState] = useState<SearchViewState>({ kind: 'idle' })

  const run = useCallback(async (next: string) => {
    if (!next.trim()) { setState({ kind: 'idle' }); return }
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/wiki/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, q: next }),
      })
      const body = await res.json().catch(() => null)
      setState(toSearchViewState({ ok: res.ok, status: res.status, body }))
    } catch {
      setState({ kind: 'error' })
    }
  }, [projectId])

  // ?q= 딥링크로 들어오면 한 번은 실제로 검색해 준다. 안 하면 검색어만 채워지고 결과가 빈다.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || !initialQuery.trim()) return
    ranInitial.current = true
    void run(initialQuery)
  }, [initialQuery, run])

  return (
    <div className="flex flex-col gap-4">
      <input
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') void run(query) }}
        placeholder={t(locale, 'wiki.search2.placeholder')}
        className="app-input w-full"
      />
      <WikiSearchResults state={state} locale={locale} />
    </div>
  )
}
