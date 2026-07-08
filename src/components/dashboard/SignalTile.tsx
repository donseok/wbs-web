import type { ReactNode } from 'react'
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from './signalStyle'

/** 신호등 KPI 타일. statusText는 색맹 대응용 텍스트 라벨(필수). */
export function SignalTile({ label, value, sub, signal, statusText }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  signal: Signal
  statusText: string
}) {
  const m = SIGNAL_META[signal]
  const Icon = m.icon
  return (
    <div className={`rounded-2xl border border-line border-t-2 ${m.borderTop} bg-surface-2/50 px-4 py-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${m.text}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />{statusText}
        </span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums leading-none text-ink">{value}</div>
      {sub != null && <div className="mt-1.5 text-[11px] leading-4 text-ink-muted">{sub}</div>}
    </div>
  )
}
