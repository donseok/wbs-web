import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Tone = 'default' | 'brand' | 'success' | 'warning' | 'danger'

const TONE: Record<Tone, { value: string; iconWrap: string }> = {
  default: { value: 'text-ink', iconWrap: 'bg-surface-2 text-ink-muted' },
  brand: { value: 'text-brand', iconWrap: 'bg-brand-weak text-brand' },
  success: { value: 'text-done', iconWrap: 'bg-done-weak text-done' },
  warning: { value: 'text-accent-warning', iconWrap: 'bg-pending-weak text-accent-warning' },
  danger: { value: 'text-delayed', iconWrap: 'bg-delayed-weak text-delayed' },
}

/** 다크 히어로 패널 안에서 쓰는 아이콘 색(밝은 톤) — 어두운 배경에서 또렷하게. */
const HERO_ICON: Record<Tone, string> = {
  default: 'text-hero-ink-muted',
  brand: 'text-[#3fd8c6]',
  success: 'text-[#5fe39b]',
  warning: 'text-[#fbbf24]',
  danger: 'text-[#fb7185]',
}

/** KPI 카드 — 히어로 우측 레일 또는 그리드에 사용. label 위, 큰 value, 보조 sub.
 *  variant='hero'면 다크 히어로 패널 안에 들어가는 글래스 스타일(밝은 글씨). */
export function KpiCard({
  label, value, sub, icon: Icon, tone = 'default', variant = 'surface', children,
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: LucideIcon
  tone?: Tone
  variant?: 'surface' | 'hero'
  children?: ReactNode
}) {
  if (variant === 'hero') {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur transition hover:bg-white/[0.09]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hero-ink-muted">{label}</div>
            <div className="mt-1.5 text-[28px] font-bold leading-none tabular-nums tracking-tight text-hero-ink">{value}</div>
            {sub && <div className="mt-1.5 text-xs text-hero-ink-muted">{sub}</div>}
          </div>
          {Icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] ${HERO_ICON[tone]}`}><Icon className="h-4 w-4" /></span>}
        </div>
        {children}
      </div>
    )
  }

  const tw = TONE[tone]
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{label}</div>
          <div className={`mt-1.5 text-[28px] font-bold leading-none tabular-nums tracking-tight ${tw.value}`}>{value}</div>
          {sub && <div className="mt-1.5 text-xs text-ink-muted">{sub}</div>}
        </div>
        {Icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tw.iconWrap}`}><Icon className="h-4 w-4" /></span>}
      </div>
      {children}
    </div>
  )
}
