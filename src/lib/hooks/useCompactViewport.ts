'use client'

import { useEffect, useState } from 'react'

/**
 * 컴팩트 뷰포트 판정 — 폭이 좁거나(세로 폰) 높이가 낮은(가로 폰) 화면.
 * Tailwind sm(640px) 브레이크포인트만으로는 가로 폰(폭 640~950px)이 데스크톱으로
 * 판정돼 히어로·툴바·범례가 화면을 다 먹는다(2026-08-21 피드백). 높이 520px 미만을
 * OR 로 묶는다 — 데스크톱 창이 이보다 낮은 경우는 드물다.
 *
 * ⚠ CSS 반응형 display 유틸(sm:flex 등)과 섞지 말 것 — globals.css 의 unlayered
 * 안전망이 layered 변형을 이겨 폭 기준이 되살아난다. 컴팩트 분기는 이 훅의 JS
 * 조건부 렌더로만 처리한다. SSR 은 데스크톱(false)으로 그리고 마운트 후 보정.
 */
export const COMPACT_MQ = '(max-width: 639px), (max-height: 519px)'

export function matchesCompactViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.(COMPACT_MQ)?.matches ?? false
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.(COMPACT_MQ)
    if (!mq) return
    const sync = () => setCompact(mq.matches)
    sync()
    // 구형 Safari·테스트 스텁은 addListener 만 제공한다 — 없으면 초기값만 쓰고 리스너는 생략.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    const legacy = mq as unknown as { addListener?: (fn: () => void) => void; removeListener?: (fn: () => void) => void }
    legacy.addListener?.(sync)
    return () => legacy.removeListener?.(sync)
  }, [])
  return compact
}
