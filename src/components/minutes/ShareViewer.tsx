'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { splitMinuteBlocks } from '@/lib/minutes/blocks'
import type { TeamCode } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { TEAM } from '@/components/wbs/shared'
import { MarkdownView } from './MarkdownView'
import { MinuteToc } from './MinuteToc'

/** 비로그인 외부 열람 전용 미니멀 뷰어 — 본문+목차만(스펙 §3.3). 채팅·하이라이트·인사이트·첨부 없음. */
export function ShareViewer({ minuteDate, teamCode, title, bodyMd }: {
  minuteDate: string
  teamCode: TeamCode
  title: string
  bodyMd: string
}) {
  const { t } = useLocale()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [activeToc, setActiveToc] = useState<number | null>(null)
  const blocks = useMemo(() => splitMinuteBlocks(bodyMd), [bodyMd])

  const jumpTo = useCallback((blockIndex: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-mblock="${blockIndex}"]`)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  // 스크롤 스파이 — MinuteViewer 와 동일 규칙(교차 중 최상단 헤딩)
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
  }, [headingIndexes])

  return (
    <div className="app-backdrop min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <BrandGlyph size={28} />
          <span className="text-sm tabular-nums text-ink-muted">{minuteDate}</span>
          <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white ${TEAM[teamCode].bar}`}>
            {teamCode}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-ink">{title}</h1>
          <span className="text-xs text-ink-subtle">{t('min.share.readonly')}</span>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row">
          <MinuteToc blocks={blocks} insights={[]} highlights={[]} onJump={jumpTo} activeIndex={activeToc} />
          <div ref={bodyRef} className="card min-w-0 flex-1 p-5">
            <MarkdownView content={bodyMd} />
          </div>
        </div>
      </div>
    </div>
  )
}
