'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MINUTE_FS_DEFAULT, MINUTE_FS_MAX, MINUTE_FS_MIN, MINUTE_FS_STORAGE_KEY,
  clampMinuteFontSize, stepMinuteFontSize,
} from '@/lib/minutes/fontSize'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

function readStored(): number | null {
  try {
    const raw = localStorage.getItem(MINUTE_FS_STORAGE_KEY)
    // 빈 문자열/공백은 Number() 가 0 으로 읽어 최소값(12px)으로 수렴한다 — 값 없음으로 취급.
    if (raw === null || raw.trim() === '') return null
    return clampMinuteFontSize(Number(raw))
  } catch {
    // 프라이빗 모드·스토리지 차단 — 캐시 실패일 뿐이라 조용히 기본값 유지(표시 실패 아님)
    return null
  }
}

function writeStored(px: number): void {
  try { localStorage.setItem(MINUTE_FS_STORAGE_KEY, String(px)) } catch {}
}

/**
 * 회의록 본문 글자크기 상태(스펙 §4.2).
 *
 * - `initial`(서버 UiPrefs)이 있으면 그 값이 첫 렌더부터 적용된다 → SSR/CSR 파리티, 깜빡임 없음.
 * - 서버값이 없을 때만 마운트 후 localStorage 를 읽어 적용한다.
 *   (localStorage 는 SSR 이 알 수 없어 초기 렌더에 넣으면 하이드레이션이 깨진다.)
 * - `persist: false`(비로그인 공유 뷰어)는 서버 저장을 건너뛰고 localStorage 만 쓴다.
 */
export function useMinuteFontSize(
  { initial = null, persist = true }: { initial?: number | null; persist?: boolean } = {},
) {
  const hasServerValue = typeof initial === 'number' && Number.isFinite(initial)
  const [size, setSizeState] = useState(() =>
    hasServerValue ? clampMinuteFontSize(initial) : MINUTE_FS_DEFAULT)
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    // 서버값이 진실이면 로컬 캐시를 서버값으로 맞춰 둔다(같은 브라우저의 공유 뷰어와 값 공유).
    if (hasServerValue) { writeStored(clampMinuteFontSize(initial)); return }
    const stored = readStored()
    if (stored !== null) setSizeState(stored)
    // 마운트 1회만 — initial 은 서버 렌더 값이라 세션 중 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 저장 부수효과는 setState 업데이터 밖에서 — StrictMode 의 업데이터 재호출로 중복 저장되지 않게. */
  const commit = useCallback((next: number) => {
    const v = clampMinuteFontSize(next)
    if (v === size) return
    setSizeState(v)
    writeStored(v)
    if (persist) queueUiPref({ minuteFontSize: v })
  }, [persist, size])

  return {
    size,
    setSize: commit,
    dec: useCallback(() => commit(stepMinuteFontSize(size, -1)), [commit, size]),
    inc: useCallback(() => commit(stepMinuteFontSize(size, 1)), [commit, size]),
    reset: useCallback(() => commit(MINUTE_FS_DEFAULT), [commit]),
    canDec: size > MINUTE_FS_MIN,
    canInc: size < MINUTE_FS_MAX,
  }
}
