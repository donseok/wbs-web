import { Gauge } from 'lucide-react'
import type { TrendModel } from '@/lib/domain/trend'
import { progressSignal, type Signal } from '@/lib/domain/dashboard'
import { formatPp1 } from '@/lib/domain/format'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { Stat } from './bits'

const SIG_TONE: Record<Signal, string> = {
  green: 'text-done', amber: 'text-accent-warning', red: 'text-delayed', neutral: 'text-ink',
}
const SPI_TEXT = { done: 'text-done', warn: 'text-accent-warning', delayed: 'text-delayed' } as const
const SPI_FILL = { done: 'fill-done', warn: 'fill-accent-warning', delayed: 'fill-delayed' } as const
const SPI_STROKE = { done: 'stroke-done', warn: 'stroke-accent-warning', delayed: 'stroke-delayed' } as const

// 게이지 기하 — SPI 0.5~1.5를 180° 반원에 사상, 1.0이 정점(12시)에 오도록.
const GW = 240, GH = 134, CX = 120, CY = 116, R = 92
const clampSpi = (v: number) => Math.min(1.5, Math.max(0.5, v))
const angleOf = (v: number) => Math.PI * (1.5 - clampSpi(v))
const gx = (a: number, r: number) => +(CX + r * Math.cos(a)).toFixed(1)
const gy = (a: number, r: number) => +(CY - r * Math.sin(a)).toFixed(1)
const arcPath = (from: number, to: number) =>
  `M ${gx(angleOf(from), R)} ${gy(angleOf(from), R)} A ${R} ${R} 0 0 1 ${gx(angleOf(to), R)} ${gy(angleOf(to), R)}`

/** SPI 반원 게이지 + 스파크라인 + 현재 SPI · 주간 증분 · 현재 편차 스탯. */
export async function SpiPanel({ model, variance }: { model: TrendModel; variance: number }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const fmtPp = (n: number) => `${formatPp1(n)}%p`

  const spi = model.currentSpi
  const spiKey = spi == null ? null : spi >= 0.98 ? 'done' : spi >= 0.9 ? 'warn' : 'delayed'
  const spiTone = spiKey == null ? 'text-ink' : SPI_TEXT[spiKey]
  const v = model.velocityWeek
  const vTone = v == null || v === 0 ? 'text-ink' : v > 0 ? 'text-done' : 'text-delayed'

  // 반원 게이지 — 상태색 호 + 바늘 + 중앙 큰 숫자. 바늘이 숫자를 지나도 읽히게 표면색 할로를 두른다.
  const needle = spi == null ? null : angleOf(spi)
  const gauge = (
    <svg viewBox={`0 0 ${GW} ${GH}`} className="mx-auto h-auto w-full max-w-[280px]"
      role="img" aria-label={`${tr('dash.spi.current')} ${spi == null ? '—' : spi.toFixed(2)}`}>
      <path d={arcPath(0.5, 1.5)} className="stroke-line" strokeWidth={12} fill="none" strokeLinecap="round" />
      {spi != null && clampSpi(spi) > 0.51 && (
        <path d={arcPath(0.5, spi)} className={SPI_STROKE[spiKey!]} strokeWidth={12} fill="none" strokeLinecap="round" />
      )}
      <line x1={CX} x2={CX} y1={CY - R - 9} y2={CY - R + 9} className="stroke-line-strong" strokeWidth={2} />
      <text x={CX} y={CY - R - 14} textAnchor="middle" fontSize={10} className="fill-ink-subtle">1.0</text>
      <text x={CX - R} y={CY + 16} textAnchor="middle" fontSize={10} className="fill-ink-subtle">0.5</text>
      <text x={CX + R} y={CY + 16} textAnchor="middle" fontSize={10} className="fill-ink-subtle">1.5</text>
      {needle != null && (
        <g>
          <line x1={CX} y1={CY} x2={gx(needle, R - 18)} y2={gy(needle, R - 18)}
            className="stroke-ink" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={CX} cy={CY} r={4.5} className="fill-ink" />
        </g>
      )}
      <text x={CX} y={CY - 30} textAnchor="middle" fontSize={32} fontWeight={700}
        paintOrder="stroke" stroke="var(--color-surface)" strokeWidth={6}
        className={spiKey == null ? 'fill-ink' : SPI_FILL[spiKey]}>
        {spi == null ? '—' : spi.toFixed(2)}
      </text>
    </svg>
  )

  // 스파크라인 — SPI 0.5~1.5 클램프, 1.0 기준선
  const s = model.spiSeries
  const spark = s.length >= 2 ? (() => {
    const sx = (i: number) => 4 + (i / (s.length - 1)) * 192
    const sy = (val: number) => 4 + (1 - (Math.min(1.5, Math.max(0.5, val)) - 0.5)) * 40
    return (
      <svg viewBox="0 0 200 48" className="h-12 w-full" aria-hidden>
        <line x1={4} x2={196} y1={sy(1)} y2={sy(1)} className="stroke-line" strokeWidth={1} strokeDasharray="3 3" />
        <polyline
          points={s.map((p, i) => `${sx(i).toFixed(1)},${sy(p.spi).toFixed(1)}`).join(' ')}
          fill="none" className="stroke-brand" strokeWidth={2} strokeLinecap="round"
        />
      </svg>
    )
  })() : (
    <div className="flex h-12 items-center justify-center rounded-xl bg-surface-2/40 text-[11px] text-ink-subtle">—</div>
  )

  return (
    <SectionCard eyebrow="VELOCITY" title={tr('dash.spi.title')} icon={Gauge}>
      <div className="space-y-4">
        {gauge}
        {spark}
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tr('dash.spi.current')} value={spi == null ? '—' : spi.toFixed(2)} tone={spiTone} />
          <Stat label={tr('dash.spi.velocity')} value={v == null ? '—' : fmtPp(v)} tone={vTone} />
          <Stat label={tr('dash.spi.varianceNow')} value={fmtPp(variance)} tone={SIG_TONE[progressSignal(variance)]} />
        </div>
        <div className="text-[11px] text-ink-subtle">{tr('dash.spi.hint')}</div>
      </div>
    </SectionCard>
  )
}
