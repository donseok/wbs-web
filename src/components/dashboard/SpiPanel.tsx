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

/** SPI 스파크라인 + 현재 SPI · 주간 증분 · 현재 편차 스탯. */
export async function SpiPanel({ model, variance }: { model: TrendModel; variance: number }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const fmtPp = (n: number) => `${formatPp1(n)}%p`

  const spi = model.currentSpi
  const spiTone = spi == null ? 'text-ink' : spi >= 0.98 ? 'text-done' : spi >= 0.9 ? 'text-accent-warning' : 'text-delayed'
  const v = model.velocityWeek
  const vTone = v == null || v === 0 ? 'text-ink' : v > 0 ? 'text-done' : 'text-delayed'

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
