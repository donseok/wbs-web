'use client'
// 에이전트 보기 오른쪽 상세 카드의 폭 상태 — 저장값 복원·보드 폭 측정·내려간 배치 판정을 묶는다.
// SSR 과 첫 렌더는 기본 폭(손잡이 없음)이고, 마운트 뒤 저장값과 측정값으로 보정한다.
// 압축 분기는 CSS 반응형 display 유틸이 아니라 이 JS 판정으로만 한다(useCompactViewport 주석 참고).
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { PANEL_WIDTH, clampPanelWidth, isPanelStacked, readStoredPanelWidth, writeStoredPanelWidth } from '@/lib/domain/panelSize'

export type RosterPanelWidth = {
  /** 사용자가 정한 폭(px). null 이면 종전 기본 폭(CSS 의 340px 기준)을 그대로 쓴다. */
  width: number | null
  /** 손잡이를 그릴 수 있는 배치인가 — 카드가 오른쪽에 나란히 선 넓은 화면만 true. */
  resizable: boolean
  /** 손잡이가 보여 줄 현재 폭과 허용 범위. */
  value: number
  min: number
  max: number
  change: (next: number, commit: boolean) => void
  reset: () => void
}

export function useRosterPanelWidth(boardRef: RefObject<HTMLElement | null>): RosterPanelWidth {
  const [stored, setStored] = useState<number | null>(null)
  const [size, setSize] = useState<{ board: number; viewport: number } | null>(null)

  useEffect(() => { setStored(readStoredPanelWidth()) }, [])

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => setSize(prev => {
      const next = { board: el.clientWidth, viewport: window.innerWidth }
      return prev && prev.board === next.board && prev.viewport === next.viewport ? prev : next
    })
    measure()
    // 화면 폭 60% 상한은 보드 크기가 그대로여도 바뀌므로 창 resize 도 듣는다.
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [boardRef])

  const board = size?.board ?? null
  const viewport = size?.viewport ?? 0
  const width = stored !== null && size ? clampPanelWidth(stored, viewport, board) : null
  const resizable = size !== null && !isPanelStacked(size.board, width ?? PANEL_WIDTH.default)
  const max = size ? clampPanelWidth(Infinity, viewport, board) : PANEL_WIDTH.default

  const change = useCallback((next: number, commit: boolean) => {
    setStored(next)
    if (commit) writeStoredPanelWidth(next)
  }, [])
  const reset = useCallback(() => {
    setStored(null)
    writeStoredPanelWidth(null)
  }, [])

  return { width, resizable, value: width ?? PANEL_WIDTH.default, min: PANEL_WIDTH.min, max, change, reset }
}
