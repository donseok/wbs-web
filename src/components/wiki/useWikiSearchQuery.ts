'use client'
import { useEffect, useRef, useState } from 'react'

const SYNC_DEBOUNCE_MS = 400

/**
 * 검색어를 URL `?q=` 에 남기는 훅.
 *
 * 검색 상태가 컴포넌트 useState 에만 있으면 문서를 열었다 뒤로 왔을 때 검색어가
 * 사라져 후보 3건을 비교하려면 매번 다시 쳐야 하고, 찾은 결과를 동료에게 링크로
 * 넘길 수도 없다.
 *
 * router.replace 가 아니라 history.replaceState 를 쓴다 — 서버 컴포넌트를 다시
 * 태우지 않아 타이핑 중 리렌더가 없고, 히스토리 항목도 늘지 않아 뒤로가기가
 * 글자 수만큼 쌓이지 않는다. 되돌아왔을 때의 복원은 주소에 남은 ?q= 를 서버가
 * initialQuery 로 다시 내려주는 것으로 이뤄진다.
 *
 * `requested` 는 화면 밖(예: Ask 패널의 "문서에서 직접 찾기")에서 밀어 넣는 검색어다.
 * 같은 값을 다시 눌러도 반응해야 하므로 값이 아니라 nonce 로 변화를 감지한다.
 */
export function useWikiSearchQuery(
  initialQuery: string,
  requested?: { query: string; nonce: number },
): [string, (next: string) => void] {
  const [query, setQuery] = useState(initialQuery)
  const lastNonce = useRef(requested?.nonce ?? 0)

  useEffect(() => {
    if (!requested || requested.nonce === lastNonce.current) return
    lastNonce.current = requested.nonce
    setQuery(requested.query)
  }, [requested])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href)
      if (query.trim()) url.searchParams.set('q', query)
      else url.searchParams.delete('q')
      if (url.href !== window.location.href) window.history.replaceState(null, '', url)
    }, SYNC_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  return [query, setQuery]
}
