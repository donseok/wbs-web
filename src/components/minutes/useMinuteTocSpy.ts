'use client'
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import type { MinuteBlock } from '@/lib/minutes/blocks'

/**
 * 목차 점프 + 스크롤 스파이(교차 중 최상단 헤딩, depth ≤ 3) — MinuteViewer/ShareViewer 공용.
 * 스파이 규칙을 바꿀 땐 여기 한 곳만 수정하면 내부/외부 뷰어가 함께 따라온다.
 */
export function useMinuteTocSpy(
  blocks: MinuteBlock[],
  bodyRef: RefObject<HTMLDivElement | null>,
  opts?: { flash?: boolean },
) {
  const [activeToc, setActiveToc] = useState<number | null>(null)
  const flash = opts?.flash ?? false

  // 점프 — 스크롤 컨테이너(xl=본문 카드/미만=main) 차이는 scrollIntoView 가 자동 처리
  const jumpTo = useCallback((blockIndex: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${blockIndex}"]`)
    if (!el) return  // 비렌더 블록 — 조용히 무시(스펙 §6.5)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    if (flash) {
      el.classList.add('mblock-flash')
      setTimeout(() => el.classList.remove('mblock-flash'), 2000)
    }
  }, [bodyRef, flash])

  // 교차 중 최상단 헤딩(없으면 마지막 통과 헤딩), root null 로 두 레이아웃 공통
  const headingIndexes = useMemo(
    () => blocks.filter(b => b.headingDepth !== undefined && b.headingDepth <= 3).map(b => b.index),
    [blocks],
  )
  useEffect(() => {
    if (headingIndexes.length === 0 || !bodyRef.current) return
    const els = headingIndexes
      .map(i => bodyRef.current!.querySelector<HTMLElement>(`[data-mblock="${i}"]`))
      .filter((el): el is HTMLElement => !!el)
    if (els.length === 0) return
    const io = new IntersectionObserver(entries => {
      const visible = entries.filter(en => en.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible.length > 0) setActiveToc(Number((visible[0].target as HTMLElement).dataset.mblock))
    }, { root: null, rootMargin: '0px 0px -70% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [headingIndexes, bodyRef])

  return { activeToc, jumpTo }
}
