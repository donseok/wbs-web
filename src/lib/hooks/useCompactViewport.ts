'use client'

import { useEffect, useState } from 'react'

/**
 * 뷰포트 압축 판정 2단 (2026-08-21 피드백).
 *
 * - 컴팩트(크롬 압축): 히어로·툴바·범례 같은 부가 UI 를 걷는 기준.
 *   폭 1024px 미만(태블릿 세로 768px·좁은 패널) 또는 높이 800px 미만
 *   (1024×768·1366×768 랩탑, 가로 폰). 이 화면들에선 부가 UI 가 표를 가린다.
 *   1440×900 이상 데스크톱은 걸리지 않는다.
 * - 좁음(열 축소): WBS 작업명 열 축소·계획 열 기본 숨김 기준.
 *   폭 640px 미만(세로 폰) 또는 높이 520px 미만(가로 폰) — 태블릿·랩탑은 열이 넉넉하다.
 *
 * ⚠ CSS 반응형 display 유틸(sm:flex 등)과 섞지 말 것 — globals.css 의 unlayered
 * 안전망이 layered 변형을 이겨 폭 기준이 되살아난다. 압축 분기는 이 훅의 JS
 * 조건부 렌더로만 처리한다. SSR 은 데스크톱(false)으로 그리고 마운트 후 보정.
 */
export const COMPACT_MQ = '(max-width: 1023px), (max-height: 799px)'
export const NARROW_MQ = '(max-width: 639px), (max-height: 519px)'

export function matchesNarrowViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.(NARROW_MQ)?.matches ?? false
}

function useMq(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const sync = () => setMatches(mq.matches)
    sync()
    // 구형 Safari·테스트 스텁은 addListener 만 제공한다 — 없으면 초기값만 쓰고 리스너는 생략.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    const legacy = mq as unknown as { addListener?: (fn: () => void) => void; removeListener?: (fn: () => void) => void }
    legacy.addListener?.(sync)
    return () => legacy.removeListener?.(sync)
  }, [query])
  return matches
}

/** 크롬 압축 — 히어로 숨김·툴바 접힘·범례 숨김 */
export function useCompactViewport(): boolean {
  return useMq(COMPACT_MQ)
}

/** 열 축소 — 작업명 열 176px·계획 열 기본 숨김 */
export function useNarrowViewport(): boolean {
  return useMq(NARROW_MQ)
}

/* 툴바 글자 라벨 기준 — 데스크톱이어도 이 폭 미만이면 라벨 탓에 툴바가 2줄로 감긴다(실측 ~1300px 감김). */
export const ROOMY_MIN_MQ = '(max-width: 1439px)'

/** 여유 폭 — 툴바 버튼에 글자 라벨을 붙여도 한 줄에 들어가는 화면(폭 1440px 이상) */
export function useRoomyViewport(): boolean {
  return !useMq(ROOMY_MIN_MQ)
}
