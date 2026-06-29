import type { ReactNode } from 'react'

/**
 * D'Flow 스타일 페이지 히어로 — 다크 그라데이션 카드 + 우측 KPI 레일.
 * 각 페이지가 자신의 히어로를 렌더한다.
 */
export function PageHero({
  eyebrow, title, description, badge, actions, aside,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className={`grid gap-4 ${aside ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]' : ''}`}>
      <div className="hero-glow hero-card flex flex-col justify-between gap-7 p-6 sm:p-8">
        <div className="min-w-0">
          {badge && <div className="mb-4">{badge}</div>}
          {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-hero-ink-muted">{eyebrow}</div>}
          <h1 className="mt-2 break-words text-[26px] font-bold leading-tight tracking-tight text-hero-ink sm:text-[34px]">{title}</h1>
          {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-hero-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {aside && <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">{aside}</div>}
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
