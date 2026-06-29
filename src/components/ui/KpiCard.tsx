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

/** KPI 카드 — 히어로 우측 레일 또는 그리드에 사용. label 위, 큰 value, 보조 sub. */
export function KpiCard({
  label, value, sub, icon: Icon, tone = 'default', children,
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: LucideIcon
  tone?: Tone
  children?: ReactNode
}) {
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
