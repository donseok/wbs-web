import type { ReactNode } from 'react'
import {
  CalendarRange, PieChart, Users, Layers, Scale, AlertTriangle,
  CalendarClock, CalendarPlus, CheckCircle2, CalendarCheck,
  TrendingUp, TrendingDown, BarChart3, FileText, Timer,
} from 'lucide-react'
import type { ComputedItem, Status, TeamCode, AttendanceRecord, AttendanceType } from '@/lib/domain/types'
import { overallProgress } from '@/lib/domain/rollup'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM, STATUS, OwnerBadges, collectLeaves, fmtDate } from '@/components/wbs/shared'

/* ── 날짜 유틸 (UTC 기준 정수 일수 계산 → DST 무관) ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
const diffDays = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY)
const shift = (s: string, n: number) => new Date(ms(s) + n * DAY).toISOString().slice(0, 10)
function weekStart(today: string): string {
  const dow = new Date(ms(today)).getUTCDay() // 0=일 … 6=토
  return shift(today, -((dow + 6) % 7)) // 월요일 시작
}
function intersects(start: string | null, end: string | null, ws: string, we: string): boolean {
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return false
  return s <= we && e >= ws // 'YYYY-MM-DD' 사전식 = 시간순
}

const STATUSES: Status[] = ['done', 'in_progress', 'delayed', 'not_started']
const TEAMS: TeamCode[] = ['PMO', 'DT', 'ERP', 'MES']

const ATT: Record<AttendanceType, { label: string; cls: string }> = {
  work: { label: '정상근무', cls: 'bg-done-weak text-done' },
  remote: { label: '재택', cls: 'bg-progress-weak text-progress' },
  annual: { label: '연차', cls: 'bg-pending-weak text-accent-warning' },
  half: { label: '반차', cls: 'bg-pending-weak text-accent-warning' },
  sick: { label: '병가', cls: 'bg-delayed-weak text-delayed' },
  trip: { label: '출장', cls: 'bg-brand-weak text-brand' },
  official: { label: '공가', cls: 'bg-surface-2 text-ink-muted' },
  absent: { label: '결근', cls: 'bg-delayed-weak text-delayed' },
}

function avg(ns: number[]): number {
  return ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0
}

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/* ── 소형 프리미티브 ── */
function CountBadge({ n, tone = 'bg-brand-weak text-brand' }: { n: number; tone?: string }) {
  return <span className={`badge ${tone}`}>{n}건</span>
}

function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center text-xs text-ink-subtle">
      {text}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}

function TaskRow({ item }: { item: ComputedItem }) {
  return (
    <li className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</span>
        <StatusPill status={item.status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1"><ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" /></div>
        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-ink-muted">{item.rolledActualPct}%</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ink-subtle">
        <OwnerBadges owners={item.owners} />
        <span className="shrink-0 tabular-nums">{fmtDate(item.plannedStart)} – {fmtDate(item.plannedEnd)}</span>
      </div>
    </li>
  )
}

export function DashboardView({
  items,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  memberCount = 0,
  attendance = [],
}: {
  items: ComputedItem[]
  startDate?: string | null
  endDate?: string | null
  today?: string
  memberCount?: number
  attendance?: AttendanceRecord[]
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="분석할 WBS 데이터가 없습니다"
        description="설정에서 WBS 엑셀을 가져오면 진행률·팀별 현황·지연 작업을 자동으로 분석합니다."
      />
    )
  }

  const roots = items
  const leaves = collectLeaves(items)
  const total = leaves.length

  // 전체 공정율(루트 가중치 정규화)
  const allNull = roots.every(r => r.weight == null)
  const eff = (r: ComputedItem) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = roots.reduce((s, r) => s + eff(r), 0) || 1
  // 전체 공정율은 공유 헬퍼로(보고서·대시보드 동일값). eff/totalEff는 아래 가중치 분포에 재사용.
  const { actual: overallActual, planned: overallPlanned } = overallProgress(roots)
  const variance = overallActual - overallPlanned

  // 상태 분포
  const statusCount = (s: Status) => leaves.filter(l => l.status === s).length

  // 팀별 작업량
  const teamSummary = (team: TeamCode) => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return { count: assigned.length, pct: assigned.length ? avg(assigned.map(l => l.rolledActualPct)) : null }
  }

  // 지연 작업
  const delayed = leaves
    .filter(l => l.status === 'delayed')
    .map(l => ({
      item: l,
      overdue: l.plannedEnd ? Math.max(0, diffDays(l.plannedEnd, today)) : 0,
      gap: Math.max(0, l.plannedPct - l.rolledActualPct),
    }))
    .sort((a, b) => b.overdue - a.overdue || b.gap - a.gap)

  // 주간 범위
  const ws = weekStart(today)
  const we = shift(ws, 6)
  const nws = shift(ws, 7)
  const nwe = shift(ws, 13)
  const thisWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, ws, we))
  const nextWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, nws, nwe))

  // 가중치 분포
  const weightShare = roots.map(r => ({ id: r.id, name: r.name, share: Math.round((eff(r) / totalEff) * 100) }))

  // 최근 완료
  const recentDone = leaves
    .filter(l => l.status === 'done')
    .sort((a, b) => (b.plannedEnd ?? '').localeCompare(a.plannedEnd ?? ''))
    .slice(0, 6)

  // 마감 임박 — 미완료 + 7일 내 마감(기준일 이후)
  const dueSoon = leaves
    .filter(l => l.status !== 'done' && l.plannedEnd && l.plannedEnd >= today && diffDays(today, l.plannedEnd) <= 7)
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))

  // 산출물 현황 — deliverable이 있는 leaf의 완료/예정
  const withDeliverable = leaves.filter(l => l.deliverable && l.deliverable.trim())
  const deliverableDone = withDeliverable.filter(l => l.status === 'done').length
  const deliverablePct = withDeliverable.length ? Math.round((deliverableDone / withDeliverable.length) * 100) : 0

  // 프로젝트 일정
  let schedule: { totalDays: number; elapsed: number; remaining: number; elapsedPct: number } | null = null
  if (startDate && endDate) {
    const totalDays = Math.max(1, diffDays(startDate, endDate) + 1)
    const elapsed = Math.min(totalDays, Math.max(0, diffDays(startDate, today) + 1))
    const elapsedPct = Math.round((elapsed / totalDays) * 100)
    schedule = { totalDays, elapsed, remaining: totalDays - elapsed, elapsedPct }
  }

  // 금주 근태
  const weekAtt = attendance.filter(a => a.date >= ws && a.date <= we)
  const attCount = (...ts: AttendanceType[]) => weekAtt.filter(a => ts.includes(a.type)).length
  const attByType = (Object.keys(ATT) as AttendanceType[])
    .map(t => ({ type: t, count: weekAtt.filter(a => a.type === t).length }))
    .filter(x => x.count > 0)
  const attMembers = new Set(weekAtt.map(a => a.memberId)).size

  return (
    <div className="space-y-5">
      {/* 프로젝트 일정 */}
      <SectionCard
        eyebrow="TIMELINE"
        title="프로젝트 일정"
        icon={CalendarRange}
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
            {variance >= 0
              ? <span className="inline-flex items-center gap-1 text-done"><TrendingUp className="h-3.5 w-3.5" />계획 대비 +{variance}%p</span>
              : <span className="inline-flex items-center gap-1 text-delayed"><TrendingDown className="h-3.5 w-3.5" />계획 대비 {variance}%p</span>}
          </span>
        }
      >
        {schedule ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="총 일수" value={`${schedule.totalDays}일`} sub={`${fmtDate(startDate)} – ${fmtDate(endDate)}`} />
              <Stat label="경과" value={`${schedule.elapsed}일`} sub={`${schedule.elapsedPct}% 진행`} />
              <Stat label="잔여" value={`${schedule.remaining}일`} sub={`${100 - schedule.elapsedPct}% 남음`} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-ink">실적 {overallActual}%</span>
                <span className="text-ink-subtle">계획 {overallPlanned}% · 일정 경과 {schedule.elapsedPct}%</span>
              </div>
              <ProgressBar value={overallActual} planned={overallPlanned} tone="bg-brand" height="h-3" />
            </div>
          </div>
        ) : (
          <MiniEmpty text="프로젝트 일정이 설정되지 않았습니다. 설정에서 시작일·종료일을 입력하세요." />
        )}
      </SectionCard>

      {/* 상태 분포 + 팀별 작업량 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard eyebrow="STATUS MIX" title="상태 분포" icon={PieChart} actions={<CountBadge n={total} />}>
          <div className="space-y-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-line">
              {STATUSES.map(s => {
                const c = statusCount(s)
                if (!c || !total) return null
                return <div key={s} className={STATUS[s].bar} style={{ width: `${(c / total) * 100}%` }} title={`${STATUS[s].label} ${c}건`} />
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {STATUSES.map(s => {
                const c = statusCount(s)
                return (
                  <div key={s} className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}
                    </span>
                    <span className="tabular-nums">
                      <strong className="text-ink">{c}건</strong>
                      <span className="ml-1 text-[11px] text-ink-subtle">{total ? Math.round((c / total) * 100) : 0}%</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="TEAM LOAD" title="담당자별 작업량" icon={Users}>
          <div className="space-y-4">
            {TEAMS.map(team => {
              const sm = teamSummary(team)
              return (
                <div key={team}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      <span className={`h-2.5 w-2.5 rounded-full ${TEAM[team].bar}`} />{team}
                      <span className="font-normal text-ink-subtle">· {sm.count}개</span>
                    </span>
                    <span className="tabular-nums font-semibold text-ink">{sm.pct == null ? '배정 없음' : `${sm.pct}%`}</span>
                  </div>
                  <ProgressBar value={sm.pct ?? 0} tone={TEAM[team].bar} />
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>

      {/* Phase별 진척 + 가중치 분포 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          eyebrow="BY PHASE"
          title="Phase별 진척"
          icon={Layers}
          actions={
            <div className="flex items-center gap-3 text-[10px] text-ink-subtle">
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-brand" />실적</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-ink-muted" />계획</span>
            </div>
          }
        >
          <div className="space-y-4">
            {roots.map(phase => (
              <div key={phase.id}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-ink" title={phase.name}>{phase.name}</span>
                  <span className="shrink-0 tabular-nums">
                    <strong className={phase.status === 'delayed' ? 'text-delayed' : 'text-ink'}>{phase.rolledActualPct}%</strong>
                    <span className="text-ink-subtle"> / {phase.plannedPct}%</span>
                  </span>
                </div>
                <ProgressBar
                  value={phase.rolledActualPct}
                  planned={phase.plannedPct}
                  tone={phase.status === 'delayed' ? 'bg-delayed' : phase.status === 'done' ? 'bg-done' : 'bg-brand'}
                />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard eyebrow="WEIGHT" title="가중치 분포" icon={Scale}>
          <ul className="space-y-3.5">
            {weightShare.map(r => (
              <li key={r.id}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-ink" title={r.name}>{r.name}</span>
                  <span className="shrink-0 tabular-nums font-semibold text-brand">{r.share}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent-secondary" style={{ width: `${r.share}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {/* 지연 작업 */}
      <SectionCard
        eyebrow="ATTENTION"
        title="지연 작업"
        icon={AlertTriangle}
        actions={<CountBadge n={delayed.length} tone="bg-delayed-weak text-delayed" />}
      >
        {delayed.length === 0 ? (
          <MiniEmpty text="현재 지연 작업이 없습니다. 모든 작업이 계획 범위 안에 있습니다." />
        ) : (
          <ul className="divide-y divide-line">
            {delayed.slice(0, 8).map(({ item, overdue, gap }) => (
              <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</div>
                  <div className="mt-1"><OwnerBadges owners={item.owners} /></div>
                </div>
                <div className="hidden w-40 shrink-0 sm:block">
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" tone="bg-delayed" /></div>
                    <span className="shrink-0 tabular-nums text-[11px] font-semibold text-delayed">{item.rolledActualPct}%</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div className="tabular-nums text-xs text-ink-muted">{fmtDate(item.plannedEnd)}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-delayed">
                    <span className="h-1.5 w-1.5 rounded-full bg-delayed" />{overdue > 0 ? `${overdue}일 지연` : `격차 ${gap}%p`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 이번 주 / 다음 주 작업 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard eyebrow="THIS WEEK" title="이번 주 작업" icon={CalendarClock} actions={<CountBadge n={thisWeek.length} />}>
          {thisWeek.length === 0 ? (
            <MiniEmpty text="이번 주에 진행되는 작업이 없습니다." />
          ) : (
            <ul className="space-y-2">{thisWeek.slice(0, 6).map(t => <TaskRow key={t.id} item={t} />)}</ul>
          )}
        </SectionCard>

        <SectionCard eyebrow="NEXT WEEK" title="다음 주 작업" icon={CalendarPlus} actions={<CountBadge n={nextWeek.length} />}>
          {nextWeek.length === 0 ? (
            <MiniEmpty text="다음 주에 예정된 작업이 없습니다." />
          ) : (
            <ul className="space-y-2">{nextWeek.slice(0, 6).map(t => <TaskRow key={t.id} item={t} />)}</ul>
          )}
        </SectionCard>
      </div>

      {/* 최근 완료 + 금주 근태 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard eyebrow="RECENTLY DONE" title="최근 완료 작업" icon={CheckCircle2} actions={<CountBadge n={statusCount('done')} tone="bg-done-weak text-done" />}>
          {recentDone.length === 0 ? (
            <MiniEmpty text="완료된 작업이 아직 없습니다." />
          ) : (
            <ul className="space-y-2">
              {recentDone.map(t => (
                <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-done-weak text-done"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink" title={t.name}>{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-ink-subtle">완료 · {fmtDate(t.plannedEnd)}</div>
                  </div>
                  <OwnerBadges owners={t.owners} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard eyebrow="THIS WEEK ATTENDANCE" title="금주 근태 요약" icon={CalendarCheck}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="금주 기록" value={`${weekAtt.length}건`} />
              <Stat label="휴가·연차" value={`${attCount('annual', 'half', 'sick')}건`} />
              <Stat label="출장·재택" value={`${attCount('trip', 'remote')}건`} />
            </div>
            {attByType.length === 0 ? (
              <MiniEmpty text="이번 주 등록된 근태가 없습니다." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {attByType.map(({ type, count }) => (
                  <span key={type} className={`chip ${ATT[type].cls}`}>{ATT[type].label} {count}</span>
                ))}
              </div>
            )}
            <div className="text-[11px] text-ink-subtle">
              팀원 {memberCount}명 · 이번 주 {attMembers}명 일정 등록 ({fmtDate(ws)}–{fmtDate(we)})
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 마감 임박 + 산출물 현황 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard eyebrow="DUE SOON" title="마감 임박 (7일 내)" icon={Timer} actions={<CountBadge n={dueSoon.length} />}>
          {dueSoon.length === 0 ? (
            <MiniEmpty text="7일 내 마감 예정인 미완료 작업이 없습니다." />
          ) : (
            <ul className="divide-y divide-line">
              {dueSoon.slice(0, 8).map(l => {
                const dleft = diffDays(today, l.plannedEnd!)
                const urgent = dleft <= 1
                return (
                  <li key={l.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-ink" title={l.name}>{l.name}</div>
                      <div className="mt-1"><OwnerBadges owners={l.owners} /></div>
                    </div>
                    <div className="w-24 shrink-0 text-right">
                      <div className="tabular-nums text-xs text-ink-muted">{fmtDate(l.plannedEnd)}</div>
                      <div className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${urgent ? 'text-delayed' : 'text-accent-warning'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${urgent ? 'bg-delayed' : 'bg-accent-warning'}`} />D-{dleft}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard eyebrow="DELIVERABLES" title="산출물 현황" icon={FileText} actions={<CountBadge n={withDeliverable.length} />}>
          {withDeliverable.length === 0 ? (
            <MiniEmpty text="등록된 산출물이 없습니다. WBS에 산출물을 입력하면 완료 현황을 추적합니다." />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="전체" value={`${withDeliverable.length}건`} />
                <Stat label="완료" value={`${deliverableDone}건`} sub={`${deliverablePct}%`} />
                <Stat label="진행·예정" value={`${withDeliverable.length - deliverableDone}건`} />
              </div>
              <ProgressBar value={deliverablePct} tone="bg-done" height="h-2.5" />
              <ul className="space-y-1.5">
                {withDeliverable.filter(l => l.status !== 'done').slice(0, 5).map(l => (
                  <li key={l.id} className="flex items-center gap-2 text-[12px]">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span className="truncate text-ink-muted" title={l.deliverable ?? ''}>{l.deliverable}</span>
                    <span className="ml-auto shrink-0"><StatusPill status={l.status} /></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
