'use client'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, List, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { InsightKind, MinuteHighlight, MinuteInsight } from '@/lib/domain/types'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import { visibleHighlights } from '@/lib/minutes/annotations'
import { useLocale } from '@/components/providers/LocaleProvider'

const KIND_DOT: Record<InsightKind, string> = {
  decision: 'bg-done', action: 'bg-progress', deadline: 'bg-accent-warning', risk: 'bg-delayed',
}

interface TocEntry {
  blockIndex: number
  depth: number
  text: string
  kinds: InsightKind[]   // 담당 구간에 존재하는 kind (중복 제거)
  hlCount: number        // 담당 구간 하이라이트 블록 수
}

/** 담당 구간 = 이 헤딩 ~ 다음 depth≤3 헤딩 직전 (h4+ 하위 구간은 상위 항목 귀속 — 스펙 §6.6). */
function buildEntries(
  blocks: MinuteBlock[], insights: MinuteInsight[], highlights: MinuteHighlight[],
): TocEntry[] {
  const heads = blocks.filter(b => b.headingDepth !== undefined && b.headingDepth <= 3)
  if (heads.length === 0) return []
  const vis = visibleHighlights(highlights, blocks)
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : blocks.length
    const inRange = (idx: number) => idx >= h.index && idx < end
    const kinds = [...new Set(
      insights.filter(x => x.kind !== 'none' && inRange(x.blockIndex)).map(x => x.kind as InsightKind),
    )]
    const hlCount = new Set(vis.filter(x => inRange(x.blockIndex)).map(x => x.blockIndex)).size
    return { blockIndex: h.index, depth: h.headingDepth!, text: h.text, kinds, hlCount }
  })
}

export function MinuteToc({
  blocks, insights, highlights, onJump, activeIndex,
}: {
  blocks: MinuteBlock[]
  insights: MinuteInsight[]
  highlights: MinuteHighlight[]
  onJump: (blockIndex: number) => void
  activeIndex: number | null
}) {
  const { t } = useLocale()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const entries = useMemo(() => buildEntries(blocks, insights, highlights), [blocks, insights, highlights])
  if (entries.length === 0) return null

  const list = (onItem?: () => void) => (
    <ul className="space-y-0.5">
      {entries.map(e => (
        <li key={e.blockIndex}>
          <button onClick={() => { onJump(e.blockIndex); onItem?.() }}
            className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[13px] transition
              ${activeIndex === e.blockIndex ? 'bg-brand-weak font-semibold text-brand' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}
            style={{ paddingLeft: `${8 + (e.depth - 1) * 12}px` }}>
            <span className="min-w-0 flex-1 truncate">{e.text}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              {e.kinds.map(k => <span key={k} className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[k]}`} />)}
              {e.hlCount > 0 && <span className="h-1.5 w-1.5 rounded-full bg-accent-warning" />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {/* xl: 좌측 상주 컬럼 (자체 스크롤) — 접으면 아이콘 버튼만 남겨 본문에 폭을 양보 */}
      {collapsed ? (
        <button onClick={() => setCollapsed(false)} title={t('min.toc.title')} aria-label={t('min.toc.title')}
          className="btn hidden shrink-0 self-start xl:inline-flex">
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : (
        <nav className="card hidden w-[220px] shrink-0 self-start p-3 xl:block xl:max-h-full xl:overflow-y-auto">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">{t('min.toc.title')}</p>
            <button onClick={() => setCollapsed(true)} title={t('min.insight.collapse')} aria-label={t('min.insight.collapse')}
              className="text-ink-subtle hover:text-ink">
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
          {list()}
        </nav>
      )}
      {/* xl 미만: 접이식 바 — 점프 후 자동 접힘, 접힘 중 스파이 비활성(activeIndex 미표시 무해) */}
      <div className="card shrink-0 p-3 xl:hidden">
        <button onClick={() => setMobileOpen(o => !o)}
          className="flex w-full items-center gap-2 text-sm font-semibold text-ink">
          <List className="h-4 w-4 text-brand" />{t('min.toc.title')}
          {mobileOpen ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
        </button>
        {mobileOpen && <div className="mt-2">{list(() => setMobileOpen(false))}</div>}
      </div>
    </>
  )
}
