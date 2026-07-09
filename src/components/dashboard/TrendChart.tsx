import { TrendingUp } from 'lucide-react'
import type { TrendModel, TrendPoint } from '@/lib/domain/trend'
import { diffDaysCal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { MiniEmpty } from './bits'

const W = 640, H = 240, PL = 34, PR = 12, PT = 12, PB = 26

/** S-Curve — 계획 누적곡선(점선) vs 실적선(실선, 도메인이 항상 2점 이상 보장) + 오늘 마커. 자체 SVG(의존성 0). */
export async function TrendChart({ model, today }: {
  model: TrendModel; today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (model.empty) {
    return (
      <SectionCard eyebrow="S-CURVE" title={tr('dash.trend.title')} icon={TrendingUp}>
        <MiniEmpty text={tr('dash.trend.empty')} />
      </SectionCard>
    )
  }

  const total = Math.max(1, diffDaysCal(model.axisStart, model.axisEnd))
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(model.axisStart, d))) / total) * (W - PL - PR)
  const y = (pct: number) => PT + (1 - pct / 100) * (H - PT - PB)
  const pts = (s: TrendPoint[]) => s.map(p => `${x(p.date).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const todayIn = today >= model.axisStart && today <= model.axisEnd
  const lastActual = model.actualSeries[model.actualSeries.length - 1]

  const legend = (
    <div className="flex items-center gap-3 text-[10px] text-ink-subtle">
      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-brand" />{tr('dash.actualLabel')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-ink-muted" />{tr('dash.plannedLabel')}</span>
    </div>
  )

  return (
    <SectionCard eyebrow="S-CURVE" title={tr('dash.trend.title')} icon={TrendingUp} actions={legend}>
      <div className="space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr('dash.trend.title')}>
          {[0, 25, 50, 75, 100].map(g => (
            <g key={g}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{g}</text>
            </g>
          ))}
          {todayIn && (
            <line x1={x(today)} x2={x(today)} y1={PT} y2={H - PB} className="stroke-ink-subtle" strokeWidth={1} strokeDasharray="2 3" />
          )}
          <polyline points={pts(model.plannedSeries)} fill="none" className="stroke-ink-muted" strokeWidth={1.5} strokeDasharray="4 4" />
          {model.actualSeries.length > 1 && (
            <polyline points={pts(model.actualSeries)} fill="none" className="stroke-brand" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {lastActual && <circle cx={x(lastActual.date)} cy={y(lastActual.pct)} r={4} className="fill-brand" />}
          <text x={PL} y={H - 8} fontSize={9} className="fill-ink-subtle">{fmtDate(model.axisStart)}</text>
          <text x={W - PR} y={H - 8} textAnchor="end" fontSize={9} className="fill-ink-subtle">{fmtDate(model.axisEnd)}</text>
        </svg>
        {!model.hasHistory && <div className="text-[11px] text-ink-subtle">{tr('dash.trend.noHistory')}</div>}
      </div>
    </SectionCard>
  )
}
