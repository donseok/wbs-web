import type { Signal } from '@/lib/domain/dashboard'
import { formatPct1, formatPp1 } from '@/lib/domain/format'
import { SIGNAL_META } from './signalStyle'

const SIZE = 128, CENTER = 64, R = 52, STROKE = 12
const CIRC = 2 * Math.PI * R
const clamp = (n: number) => Math.min(100, Math.max(0, n))

/** 실적=파랑 채움, 계획=눈금 마커, 중앙=진척 판정 칩 + 큰 실적%. */
export function ProgressGauge({ actual, planned, variance, signal, verdictText, plannedText, label }: {
  actual: number
  planned: number
  variance: number
  signal: Signal
  verdictText: string
  plannedText: string
  label: string
}) {
  const m = SIGNAL_META[signal]
  const dash = (clamp(actual) / 100) * CIRC
  const th = (clamp(planned) / 100) * 2 * Math.PI
  const at = (rad: number): [number, number] => [CENTER + rad * Math.sin(th), CENTER - rad * Math.cos(th)]
  const [ix, iy] = at(R - STROKE / 2)
  const [ox, oy] = at(R + STROKE / 2)
  const varText = `${formatPp1(variance)}%p`
  return (
    <div
      className="relative h-32 w-32 shrink-0"
      role="img"
      aria-label={`${label} 실적 ${formatPct1(actual)}%, 계획 ${formatPct1(planned)}%, 편차 ${varText}, 진척 판정 ${verdictText}`}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        <circle cx={CENTER} cy={CENTER} r={R} fill="none" strokeWidth={STROKE} className="stroke-line" />
        <circle
          cx={CENTER} cy={CENTER} r={R} fill="none" strokeWidth={STROKE} strokeLinecap="round"
          className="stroke-brand" strokeDasharray={`${dash} ${CIRC}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
        <line x1={ix} y1={iy} x2={ox} y2={oy} strokeWidth={2.5} strokeLinecap="round" className="stroke-ink" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className={`badge text-[10px] ${m.chip}`}>{verdictText}</span>
        <span className="text-2xl font-extrabold leading-none tabular-nums text-ink">{formatPct1(actual)}%</span>
        <span className="text-[10px] text-ink-subtle">{plannedText}</span>
      </div>
    </div>
  )
}
