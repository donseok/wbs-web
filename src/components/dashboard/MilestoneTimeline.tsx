import { Flag } from 'lucide-react'
import type { MilestonePoint, MilestoneStatus } from '@/lib/domain/dashboard'
import { diffDaysCal, addDaysCal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty } from './bits'

const MS_TONE: Record<MilestoneStatus, string> = { done: 'fill-done', overdue: 'fill-delayed', upcoming: 'fill-brand' }
const W = 960, H = 124, PL = 24, PR = 24, BASE = 64

/** 프로젝트 시간축 위 마일스톤 여정 — 완료/기한경과/예정을 한 줄에. 라벨은 위/아래 교차 배치. */
export async function MilestoneTimeline({ points, startDate, endDate, today }: {
  points: MilestonePoint[]; startDate: string | null; endDate: string | null; today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (points.length === 0) {
    return (
      <SectionCard eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}>
        <MiniEmpty text={tr('dash.ms.empty')} />
      </SectionCard>
    )
  }

  let axisStart = startDate ?? points[0].date
  let axisEnd = endDate ?? points[points.length - 1].date
  if (axisStart >= axisEnd) { axisStart = addDaysCal(axisStart, -14); axisEnd = addDaysCal(axisEnd, 14) }
  const total = diffDaysCal(axisStart, axisEnd)
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(axisStart, d))) / total) * (W - PL - PR)
  const trunc = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const todayIn = today >= axisStart && today <= axisEnd

  return (
    <SectionCard
      eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}
      actions={<CountBadge n={points.length} unit={tr('dash.unitCount')} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr('dash.ms.title')}>
        <line x1={PL} x2={W - PR} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={2} />
        {todayIn && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={30} y2={100} className="stroke-ink-subtle" strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(today)} y={20} textAnchor="middle" fontSize={9} className="fill-ink-subtle">{fmtDate(today)}</text>
          </g>
        )}
        {points.map((p, i) => {
          const above = i % 2 === 0
          const nameY = above ? BASE - 28 : BASE + 24
          const dateY = above ? BASE - 16 : BASE + 36
          const sub =
            p.status === 'upcoming' ? `${fmtDate(p.date)} · D-${p.dday}`
            : p.status === 'overdue' ? `${fmtDate(p.date)} · ${tr('dash.ms.overdueBadge')}`
            : fmtDate(p.date)
          return (
            <g key={p.id}>
              <circle cx={x(p.date)} cy={BASE} r={5} className={MS_TONE[p.status]}>
                <title>{`${p.name} · ${fmtDate(p.date)}`}</title>
              </circle>
              <text x={x(p.date)} y={nameY} textAnchor="middle" fontSize={10} className="fill-ink font-medium">{trunc(p.name)}</text>
              <text x={x(p.date)} y={dateY} textAnchor="middle" fontSize={9}
                className={p.status === 'overdue' ? 'fill-delayed' : 'fill-ink-subtle'}>
                {sub}
              </text>
            </g>
          )
        })}
      </svg>
    </SectionCard>
  )
}
