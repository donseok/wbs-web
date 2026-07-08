import { Users, FileText, CheckCircle2, CalendarClock, CalendarPlus, BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem } from '@/lib/domain/types'
import { buildJourney } from '@/lib/domain/journey'
import { buildActionRows } from '@/lib/domain/attention'
import { buildBottleneck } from '@/lib/domain/bottleneck'
import { collectLeaves, TEAMS } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM, OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { DetailAccordion } from './DetailAccordion'
import { JourneyCard } from './JourneyCard'
import { ActionCard } from './ActionCard'
import { BottleneckCard } from './BottleneckCard'
import { CountBadge, MiniEmpty, Stat } from './primitives'

/* ── 날짜 유틸 (UTC 기준 정수 일수 → DST 무관) ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
const shift = (s: string, n: number) => new Date(ms(s) + n * DAY).toISOString().slice(0, 10)
function weekStart(today: string): string {
  const dow = new Date(ms(today)).getUTCDay() // 0=일 … 6=토
  return shift(today, -((dow + 6) % 7))       // 월요일 시작
}
function intersects(start: string | null, end: string | null, ws: string, we: string): boolean {
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return false
  return s <= we && e >= ws // 'YYYY-MM-DD' 사전식 = 시간순
}

const avg = (ns: number[]): number => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0)

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
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
  holidays = [],
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
  holidays?: string[]
  announcements?: Announcement[]
  initialExpanded?: string[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const leaves = collectLeaves(items)

  /* ── Row 1 모델 ── */
  const journey = buildJourney(items, { startDate, endDate, today, holidays })
  const actionRows = buildActionRows(items, today)
  const bottleneck = buildBottleneck(items, today)

  /* ── Row 2: 팀 · 산출물 ── */
  const teamSummary = (team: (typeof TEAMS)[number]) => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return { count: assigned.length, pct: assigned.length ? avg(assigned.map(l => l.rolledActualPct)) : null }
  }
  const withDeliverable = leaves.filter(l => l.deliverable && l.deliverable.trim())
  const deliverableDone = withDeliverable.filter(l => l.status === 'done').length
  const deliverablePct = withDeliverable.length ? Math.round((deliverableDone / withDeliverable.length) * 100) : 0

  /* ── Row 2: 주간 리듬 ── */
  const ws = weekStart(today), we = shift(ws, 6)
  const nws = shift(ws, 7), nwe = shift(ws, 13)
  const thisWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, ws, we))
  const nextWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, nws, nwe))
  const recentDone = leaves
    .filter(l => l.status === 'done')
    .sort((a, b) => (b.plannedEnd ?? '').localeCompare(a.plannedEnd ?? ''))
    .slice(0, 6)

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

      <SectionCard eyebrow="DELIVERABLES" title={tr('dash.deliv.title')} icon={FileText}
        actions={<CountBadge n={withDeliverable.length} unit={tr('dash.unitCount')} />}>
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
    </div>
  )

  const weekly = (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard eyebrow="THIS WEEK" title={tr('dash.thisWeek.title')} icon={CalendarClock}
        actions={<CountBadge n={thisWeek.length} unit={tr('dash.unitCount')} />}>
        {thisWeek.length === 0
          ? <MiniEmpty text={tr('dash.thisWeek.empty')} />
          : <ul className="space-y-2">{thisWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>}
      </SectionCard>

      <SectionCard eyebrow="NEXT WEEK" title={tr('dash.nextWeek.title')} icon={CalendarPlus}
        actions={<CountBadge n={nextWeek.length} unit={tr('dash.unitCount')} />}>
        {nextWeek.length === 0
          ? <MiniEmpty text={tr('dash.nextWeek.empty')} />
          : <ul className="space-y-2">{nextWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>}
      </SectionCard>

      <SectionCard eyebrow="RECENTLY DONE" title={tr('dash.recentDone.title')} icon={CheckCircle2}
        actions={<CountBadge n={leaves.filter(l => l.status === 'done').length} unit={tr('dash.unitCount')} tone="bg-done-weak text-done" />}>
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
    </div>
  )

  return (
    // @container — 사이드바 248↔78px 스윙은 미디어쿼리에 안 보인다. 1280px에서 컨테이너는 976 또는 1146.
    <div className="@container space-y-5">
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

      {/* Row 1 — 스크롤 0은 이 행 한정, ≥900dvh, 3열 구간에서만 보장된다. */}
      <div className="grid gap-5
                      @min-[48rem]:h-[clamp(19rem,calc(100dvh-31rem),30rem)]
                      @min-[48rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]
                      @min-[68rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(17rem,0.78fr)]">
        <div className="min-h-0 @min-[48rem]:col-span-2 @min-[68rem]:col-span-1">
          <JourneyCard model={journey} />
        </div>
        <div className="min-h-0"><ActionCard rows={actionRows} projectId={projectId} /></div>
        <div className="min-h-0"><BottleneckCard model={bottleneck} /></div>
      </div>

      {/* Row 2 — 기본 접힘. teamDeliv는 id를 재사용해 기존 사용자의 펼침 상태를 보존한다. */}
      <DetailAccordion
        initialExpanded={initialExpanded}
        groups={[
          { id: 'teamDeliv', title: <GroupTitle label={tr('dash.group.teamDeliv')} hint={`${tr('dash.deliv.title')} ${withDeliverable.length}`} />, content: teamDeliv },
          { id: 'weekly', title: <GroupTitle label={tr('dash.group.weekly')} hint={`${tr('dash.thisWeek.title')} ${thisWeek.length} · ${tr('dash.nextWeek.title')} ${nextWeek.length}`} />, content: weekly },
        ]}
      />
    </div>
  )
}
