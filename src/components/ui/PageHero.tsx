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
    <section className="grid gap-4">
      <div className="hero-glow hero-card flex flex-col px-6 py-4 sm:px-8">
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
