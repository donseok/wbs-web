import { type ReactNode } from 'react'

/**
 * D'Flow 페이지 히어로 — 항상 접힌 컴팩트 상태(제목 한 줄).
 * 접기/펼치기 토글은 제거됨. eyebrow/description/actions/heroKpis/aside/badge는
 * 호출부 호환을 위해 받되 렌더하지 않는다.
 */
export function PageHero({
  title,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  heroKpis?: ReactNode
}) {
  return (
    // 컴팩트 화면에선 숨김 — 헤더가 현재 위치를 보여줘 세로 공간을 아낀다(2026-08-21).
    // 기준은 크롬 압축(useCompactViewport COMPACT_MQ)과 동일: 폭≥1024 그리고 높이≥800 일 때만 표시.
    // lg: 같은 폭 전용 유틸을 쓰면 1024×768 랩탑에서 새 나온다(높이 조건이 없어서).
    <section className="hidden gap-4 [@media(min-width:1024px)_and_(min-height:800px)]:grid">
      <div className="hero-glow hero-card flex flex-col px-6 py-3 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight tracking-tight text-hero-ink">
              {title}
            </h1>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 히어로 상단의 작은 카테고리 pill (예: "Smart Utility") */
export function HeroBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-hero-ink">
      {children}
    </span>
  )
}
