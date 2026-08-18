import Link from 'next/link'
import { Flag } from 'lucide-react'
import type { PortfolioMilestone, PortfolioRow } from '@/lib/domain/portfolio'
import { diffDaysCal, addDaysCal, type MilestoneStatus } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { CountBadge, MiniEmpty } from '@/components/dashboard/bits'
import { fmtDate } from '@/components/wbs/shared'
import { projectColorClass } from '@/lib/domain/projectColors'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

const MS_TONE: Record<MilestoneStatus, string> = { done: 'fill-done', overdue: 'fill-delayed', upcoming: 'fill-brand' }
const W = 960, PL = 10, PR = 10, ROW_H = 26, BASE = 13

/** 축 범위 안의 매월 1일 (헤더 눈금) */
function monthTicks(axisStart: string, axisEnd: string): string[] {
  const ticks: string[] = []
  let [y, m] = axisStart.split('-').map(Number)
  if (axisStart.slice(8) !== '01') { m += 1; if (m > 12) { m = 1; y += 1 } }
  for (;;) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`
    if (d > axisEnd) break
    ticks.push(d)
    m += 1; if (m > 12) { m = 1; y += 1 }
  }
  return ticks
}

/** 전 프로젝트 마일스톤을 공통 시간축 위에 프로젝트당 1행으로. 상세 라벨은 dot 툴팁. */
export function PortfolioMilestoneBoard({ rows, milestones, today, locale }: {
  rows: PortfolioRow[]; milestones: PortfolioMilestone[]; today: string; locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const byProject = new Map<string, PortfolioMilestone[]>()
  for (const ms of milestones) {
    const arr = byProject.get(ms.projectId) ?? []
    arr.push(ms)
    byProject.set(ms.projectId, arr)
  }
  // 행 순서는 비교 테이블과 동일(rows 정렬 유지) — 마일스톤 있는 프로젝트만
  const board = rows.filter(r => (byProject.get(r.projectId)?.length ?? 0) > 0)

  if (board.length === 0) {
    return (
      <SectionCard eyebrow="MILESTONES" title={tr('pf.ms.title')} icon={Flag}>
        <MiniEmpty text={tr('pf.ms.empty')} />
      </SectionCard>
    )
  }

  // 공통 축: 프로젝트 기간 ∪ 마일스톤 날짜의 최소~최대
  const dates = [
    ...board.flatMap(r => [r.startDate, r.endDate].filter((d): d is string => d != null)),
    ...milestones.map(m => m.date),
  ].sort()
  let axisStart = dates[0]
  let axisEnd = dates[dates.length - 1]
  if (axisStart >= axisEnd) { axisStart = addDaysCal(axisStart, -14); axisEnd = addDaysCal(axisEnd, 14) }
  const total = diffDaysCal(axisStart, axisEnd)
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(axisStart, d))) / total) * (W - PL - PR)
  const todayIn = today >= axisStart && today <= axisEnd
  const ticks = monthTicks(axisStart, axisEnd)
  const projectIds = board.map(r => r.projectId)

  return (
    <SectionCard eyebrow="MILESTONES" title={tr('pf.ms.title')} icon={Flag}
      actions={<CountBadge n={milestones.length} unit={tr('pf.unit')} />}>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* 헤더: 월 눈금 + 오늘 */}
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-2">
            <div />
            <svg viewBox={`0 0 ${W} 18`} className="h-auto w-full" aria-hidden>
              {ticks.map(d => (
                <g key={d}>
                  <line x1={x(d)} x2={x(d)} y1={12} y2={18} className="stroke-line" strokeWidth={1} />
                  <text x={x(d)} y={9} textAnchor="middle" fontSize={9} className="fill-ink-subtle">
                    {d.slice(2, 7).replace('-', '.')}
                  </text>
                </g>
              ))}
              {todayIn && (
                <text x={x(today)} y={9} textAnchor="middle" fontSize={9} className="fill-delayed font-semibold">
                  {fmtDate(today)}
                </text>
              )}
            </svg>
          </div>
          {board.map(row => (
            <div key={row.projectId} className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-2 border-t border-line/60">
              <Link href={`/p/${row.projectId}/dashboard`}
                className="flex min-w-0 items-center gap-1.5 py-1 text-xs font-medium text-ink hover:text-brand">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${projectColorClass(projectIds, row.projectId)}`} />
                <span className="truncate">{row.name}</span>
              </Link>
              <svg viewBox={`0 0 ${W} ${ROW_H}`} className="h-auto w-full" role="img"
                aria-label={`${row.name} ${tr('pf.ms.title')}`}>
                <line x1={PL} x2={W - PR} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={1.5} />
                {row.startDate && <line x1={x(row.startDate)} x2={x(row.startDate)} y1={BASE - 5} y2={BASE + 5} className="stroke-line-strong" strokeWidth={1.5} />}
                {row.endDate && <line x1={x(row.endDate)} x2={x(row.endDate)} y1={BASE - 5} y2={BASE + 5} className="stroke-line-strong" strokeWidth={1.5} />}
                {todayIn && <line x1={x(today)} x2={x(today)} y1={2} y2={ROW_H - 2} className="stroke-delayed" strokeWidth={1} strokeDasharray="2 3" />}
                {(byProject.get(row.projectId) ?? []).map(p => (
                  <circle key={p.id} cx={x(p.date)} cy={BASE} r={4.5} className={MS_TONE[p.status]}>
                    <title>{`${p.name} · ${fmtDate(p.date)}${p.status === 'upcoming' ? ` · D-${p.dday}` : ''}`}</title>
                  </circle>
                ))}
              </svg>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}
