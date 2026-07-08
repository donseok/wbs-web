import type { ReactNode } from 'react'
import {
  PieChart, Users, Layers, Scale, AlertTriangle,
  CalendarClock, CalendarPlus, CheckCircle2, CalendarCheck,
  BarChart3, FileText, Timer,
} from 'lucide-react'
import type { Announcement, ComputedItem, Status, TeamCode, AttendanceRecord, AttendanceType } from '@/lib/domain/types'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM, STATUS, OwnerBadges, collectLeaves, fmtDate } from '@/components/wbs/shared'
import { effectiveWeights } from '@/lib/domain/weight'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { DetailAccordion } from './DetailAccordion'

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
const TEAMS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

// label은 참조용 원본(한국어) — 화면 표시는 dict 키 `dash.att.<type>`로 번역해 렌더한다.
const ATT: Record<AttendanceType, { label: string; cls: string }> = {
  work: { label: '정상근무', cls: 'bg-done-weak text-done' },
  remote: { label: '재택', cls: 'bg-progress-weak text-progress' },
  annual: { label: '연차', cls: 'bg-pending-weak text-accent-warning' },
  half: { label: '반차', cls: 'bg-pending-weak text-accent-warning' },
  quarter: { label: '반반차', cls: 'bg-pending-weak text-accent-warning' },
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
function CountBadge({ n, unit, tone = 'bg-brand-weak text-brand' }: { n: number; unit: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{n}{unit}</span>
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

/* 아코디언 그룹 헤더 — 라벨 + 흐린 요약 힌트 */
function GroupTitle({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex items-baseline gap-2">
      {label}
      <span className="text-[11px] font-normal text-ink-subtle">{hint}</span>
    </span>
  )
}

export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  memberCount = 0,
  attendance = [],
  announcements = [],
  initialExpanded = [],
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
  memberCount?: number
  attendance?: AttendanceRecord[]
  announcements?: Announcement[]
  initialExpanded?: string[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title={tr('dash.emptyTitle')}
        description={tr('dash.emptyDesc')}
      />
    )
  }

  const roots = items
  const leaves = collectLeaves(items)
  const total = leaves.length

  // 루트 가중치 정규화(가중치 분포에 사용). 전체 공정율/일정 신호는 ExecSummary가 담당.
  const eff = effectiveWeights(roots)
  const totalEff = eff.reduce((s, w) => s + w, 0) || 1

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
  const weightShare = roots.map((r, i) => ({ id: r.id, name: r.name, share: Math.round((eff[i] / totalEff) * 100) }))

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

  // 금주 근태
  const weekAtt = attendance.filter(a => a.date >= ws && a.date <= we)
  const attCount = (...ts: AttendanceType[]) => weekAtt.filter(a => ts.includes(a.type)).length
  const attByType = (Object.keys(ATT) as AttendanceType[])
    .map(tp => ({ type: tp, count: weekAtt.filter(a => a.type === tp).length }))
    .filter(x => x.count > 0)
  const attMembers = new Set(weekAtt.map(a => a.memberId)).size

  /* ── 상세 아코디언 3그룹: 서버가 렌더한 카드 묶음을 content로 전달 ── */
  const analysis = (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard eyebrow="STATUS MIX" title={tr('dash.statusMix.title')} icon={PieChart} actions={<CountBadge n={total} unit={tr('dash.unitCount')} />}>
        <div className="space-y-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-line">
            {STATUSES.map(s => {
              const c = statusCount(s)
              if (!c || !total) return null
              return <div key={s} className={STATUS[s].bar} style={{ width: `${(c / total) * 100}%` }} title={`${tr(`status.${s}` as DictKey)} ${c}${tr('dash.unitCount')}`} />
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {STATUSES.map(s => {
              const c = statusCount(s)
              return (
                <div key={s} className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS[s].dot}`} />{tr(`status.${s}` as DictKey)}
                  </span>
                  <span className="tabular-nums">
                    <strong className="text-ink">{c}{tr('dash.unitCount')}</strong>
                    <span className="ml-1 text-[11px] text-ink-subtle">{total ? Math.round((c / total) * 100) : 0}%</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard eyebrow="WEIGHT" title={tr('dash.weight.title')} icon={Scale}>
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
  )

  const scheduleRisk = (
    <div className="space-y-5">
      <SectionCard eyebrow="DUE SOON" title={tr('dash.dueSoon.title')} icon={Timer} actions={<CountBadge n={dueSoon.length} unit={tr('dash.unitCount')} />}>
        {dueSoon.length === 0 ? (
          <MiniEmpty text={tr('dash.dueSoon.empty')} />
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

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard eyebrow="THIS WEEK" title={tr('dash.thisWeek.title')} icon={CalendarClock} actions={<CountBadge n={thisWeek.length} unit={tr('dash.unitCount')} />}>
          {thisWeek.length === 0 ? (
            <MiniEmpty text={tr('dash.thisWeek.empty')} />
          ) : (
            <ul className="space-y-2">{thisWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>
          )}
        </SectionCard>

        <SectionCard eyebrow="NEXT WEEK" title={tr('dash.nextWeek.title')} icon={CalendarPlus} actions={<CountBadge n={nextWeek.length} unit={tr('dash.unitCount')} />}>
          {nextWeek.length === 0 ? (
            <MiniEmpty text={tr('dash.nextWeek.empty')} />
          ) : (
            <ul className="space-y-2">{nextWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>
          )}
        </SectionCard>
      </div>
    </div>
  )

  const teamDeliv = (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard eyebrow="TEAM LOAD" title={tr('dash.teamLoad.title')} icon={Users}>
        <div className="space-y-4">
          {TEAMS.map(team => {
            const sm = teamSummary(team)
            return (
              <div key={team}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <span className={`h-2.5 w-2.5 rounded-full ${TEAM[team].bar}`} />{team}
                    <span className="font-normal text-ink-subtle">· {sm.count}{tr('dash.unitTasks')}</span>
                  </span>
                  <span className="tabular-nums font-semibold text-ink">{sm.pct == null ? tr('dash.noAssignment') : `${sm.pct}%`}</span>
                </div>
                <ProgressBar value={sm.pct ?? 0} tone={TEAM[team].bar} />
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard eyebrow="DELIVERABLES" title={tr('dash.deliv.title')} icon={FileText} actions={<CountBadge n={withDeliverable.length} unit={tr('dash.unitCount')} />}>
        {withDeliverable.length === 0 ? (
          <MiniEmpty text={tr('dash.deliv.empty')} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={tr('dash.deliv.total')} value={`${withDeliverable.length}${tr('dash.unitCount')}`} />
              <Stat label={tr('dash.deliv.done')} value={`${deliverableDone}${tr('dash.unitCount')}`} sub={`${deliverablePct}%`} />
              <Stat label={tr('dash.deliv.open')} value={`${withDeliverable.length - deliverableDone}${tr('dash.unitCount')}`} />
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

      <SectionCard eyebrow="RECENTLY DONE" title={tr('dash.recentDone.title')} icon={CheckCircle2} actions={<CountBadge n={statusCount('done')} unit={tr('dash.unitCount')} tone="bg-done-weak text-done" />}>
        {recentDone.length === 0 ? (
          <MiniEmpty text={tr('dash.recentDone.empty')} />
        ) : (
          <ul className="space-y-2">
            {recentDone.map(tk => (
              <li key={tk.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-done-weak text-done"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={tk.name}>{tk.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-subtle">{tr('status.done')} · {fmtDate(tk.plannedEnd)}</div>
                </div>
                <OwnerBadges owners={tk.owners} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard eyebrow="THIS WEEK ATTENDANCE" title={tr('dash.att.title')} icon={CalendarCheck}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr('dash.att.records')} value={`${weekAtt.length}${tr('dash.unitCount')}`} />
            <Stat label={tr('dash.att.leave')} value={`${attCount('annual', 'half', 'sick')}${tr('dash.unitCount')}`} />
            <Stat label={tr('dash.att.tripRemote')} value={`${attCount('trip')}${tr('dash.unitCount')}`} />
          </div>
          {attByType.length === 0 ? (
            <MiniEmpty text={tr('dash.att.empty')} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {attByType.map(({ type, count }) => (
                <span key={type} className={`chip ${ATT[type].cls}`}>{tr(`dash.att.${type}` as DictKey)} {count}</span>
              ))}
            </div>
          )}
          <div className="text-[11px] text-ink-subtle">
            {tr('dash.att.memberPrefix')}{memberCount}{tr('dash.att.memberSuffix')} · {tr('dash.att.regPrefix')}{attMembers}{tr('dash.att.regSuffix')} ({fmtDate(ws)}–{fmtDate(we)})
          </div>
        </div>
      </SectionCard>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 */}
      <ExecSummary
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={projectDescription}
        startDate={startDate}
        endDate={endDate}
        today={today}
        announcements={announcements}
      />

      {/* 핵심 시각 — Phase별 진척 + 지연 Top */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          eyebrow="BY PHASE"
          title={tr('dash.phase.title')}
          icon={Layers}
          actions={
            <div className="flex items-center gap-3 text-[10px] text-ink-subtle">
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-brand" />{tr('dash.actualLabel')}</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-0.5 bg-ink-muted" />{tr('dash.plannedLabel')}</span>
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

        <SectionCard
          eyebrow="ATTENTION"
          title={tr('dash.kpi.delayed')}
          icon={AlertTriangle}
          actions={<CountBadge n={delayed.length} unit={tr('dash.unitCount')} tone="bg-delayed-weak text-delayed" />}
        >
          {delayed.length === 0 ? (
            <MiniEmpty text={tr('dash.delayed.empty')} />
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
                      <span className="h-1.5 w-1.5 rounded-full bg-delayed" />{overdue > 0 ? `${overdue}${tr('dash.overdueSuffix')}` : `${tr('dash.gapLabel')} ${gap}%p`}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* 상세 — 접이식 3그룹(정보 손실 0) */}
      <DetailAccordion
        initialExpanded={initialExpanded}
        groups={[
          { id: 'analysis', title: <GroupTitle label={tr('dash.group.analysis')} hint={`${total}${tr('dash.unitCount')}`} />, content: analysis },
          { id: 'scheduleRisk', title: <GroupTitle label={tr('dash.group.scheduleRisk')} hint={`${tr('dash.exec.dueSoon')} ${dueSoon.length} · ${tr('dash.exec.delayed')} ${delayed.length}`} />, content: scheduleRisk },
          { id: 'teamDeliv', title: <GroupTitle label={tr('dash.group.teamDeliv')} hint={`${tr('dash.deliv.title')} ${withDeliverable.length}`} />, content: teamDeliv },
        ]}
      />
    </div>
  )
}
