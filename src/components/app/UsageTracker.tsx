'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/** 같은 경로 재전송 억제(ms) — StrictMode 이중 실행과 리렌더 중복을 함께 막는다. */
const REPEAT_COOLDOWN_MS = 10_000

/**
 * 라우트 전환 1건당 사용 기록 1행. 렌더 출력 없음(PrefsSync 와 같은 형태).
 *
 * 미들웨어가 아니라 여기서 잡는 이유: middleware 는 getClaims() 로 클릭당 100~180ms 를
 * 아끼는 성능 급소이고 /api/**·/share/** 를 matcher 에서 제외해 커버리지도 반쪽이다.
 * keepalive 로 보내 라우트 전환·탭 종료 중에도 전송이 끊기지 않는다.
 * 실패는 삼키되 사용자 이동을 막지 않는다 — 수집 중단은 /usage 의 '수집 상태'에 드러난다.
 */
export function UsageTracker() {
  const pathname = usePathname()
  const last = useRef<{ path: string; at: number } | null>(null)

  useEffect(() => {
    if (!pathname) return
    const now = Date.now()
    if (last.current && last.current.path === pathname && now - last.current.at < REPEAT_COOLDOWN_MS) return
    last.current = { path: pathname, at: now }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {})
  }, [pathname])

  return null
}
