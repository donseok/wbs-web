import Link from 'next/link'
import { Pin } from 'lucide-react'
import type { Announcement, ComputedItem } from '@/lib/domain/types'
import { buildExecSummary, type Signal } from '@/lib/domain/dashboard'
import { formatPct1, formatPp1 } from '@/lib/domain/format'
import { sortAnnouncements, isPublishedNow, ANNOUNCEMENT_META } from '@/lib/domain/announcements'
import { getServerLocale } from '@/lib/i18n/server'
import { t, type DictKey } from '@/lib/i18n/dict'
import { fmtDate } from '@/components/wbs/shared'
import { ProgressGauge } from './ProgressGauge'
import { SignalTile } from './SignalTile'
import { ReportButton } from '@/components/report/ReportButton'

const VERDICT_KEY: Record<Exclude<Signal, 'neutral'>, DictKey> = {
  green: 'dash.exec.verdictOnTrack',
  amber: 'dash.exec.verdictCaution',
  red: 'dash.exec.verdictAtRisk',
}
const statusWord = (sig: Signal, tr: (k: DictKey) => string): string =>
  sig === 'neutral' ? tr('dash.exec.early') : tr(VERDICT_KEY[sig])

export async function ExecSummary({
  items, projectId, projectName, projectDescription, startDate, endDate, today, announcements,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate: string | null
  endDate: string | null
  today: string
  announcements: Announcement[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const s = buildExecSummary(items, { startDate, endDate, today })

  const verdict = statusWord(s.overall.signal === 'neutral' ? 'green' : s.overall.signal, tr)
  const plannedText = `${tr('dash.plannedLabel')} ${formatPct1(s.progress.planned)}% · ${formatPp1(s.progress.variance)}%p`

  const schedValue =
    s.schedule.label === 'none' ? tr('dash.exec.noSchedule')
    : s.schedule.label === 'done' ? tr('dash.exec.doneLabel')
    : `D+${s.schedule.elapsed}`
  const schedSub =
    s.schedule.label === 'onTrack' && s.schedule.projectedEnd ? `${tr('dash.exec.projectedEnd')} ${fmtDate(s.schedule.projectedEnd)}`
    : s.schedule.label === 'early' ? tr('dash.exec.early')
    : s.schedule.label === 'none' ? null
    : `${s.schedule.remaining}${tr('dash.unitDays')}`

  // 마일스톤 타일: 값 슬롯에 정량 D-day(다른 타일과 동일 위계), 이름·날짜는 sub로.
  const hasMs = s.milestone.name != null
  const msValue = hasMs
    ? (s.milestone.overdue ? tr('dash.exec.overdue') : `D-${s.milestone.dday}`)
    : tr('dash.exec.noMilestone')
  const msSub = hasMs
    ? `${s.milestone.name}${s.milestone.date ? ` · ${fmtDate(s.milestone.date)}` : ''}`
    : null

  const notice = sortAnnouncements(announcements.filter(a => isPublishedNow(a, today)))[0] ?? null

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">EXECUTIVE SUMMARY</div>
          <h2 className="mt-0.5 truncate text-base font-bold text-ink">{projectName}</h2>
        </div>
        <ReportButton
          variant="surface" label={tr('dash.exec.reportTitle')} projectId={projectId} items={items} projectName={projectName}
          projectDescription={projectDescription} today={today} startDate={startDate} endDate={endDate}
        />
      </div>

      <div className="grid items-center gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-center gap-4">
          <ProgressGauge
            actual={s.progress.actual} planned={s.progress.planned} variance={s.progress.variance}
            overall={s.overall.signal} verdictText={verdict} plannedText={plannedText}
            label={tr('dash.exec.progressLabel')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SignalTile label={tr('dash.exec.scheduleLabel')} value={schedValue} sub={schedSub}
            signal={s.schedule.signal} statusText={statusWord(s.schedule.signal, tr)} />
          <SignalTile label={tr('dash.exec.riskLabel')} value={`${s.risk.delayed + s.risk.dueSoon}${tr('dash.unitCount')}`}
            sub={`${tr('dash.exec.delayed')} ${s.risk.delayed} · ${tr('dash.exec.dueSoon')} ${s.risk.dueSoon}`}
            signal={s.risk.signal} statusText={statusWord(s.risk.signal, tr)} />
          <SignalTile label={tr('dash.exec.milestoneLabel')} value={msValue} sub={msSub}
            signal={s.milestone.signal} statusText={statusWord(s.milestone.signal, tr)} />
        </div>
      </div>

      {notice && (
        <Link href={`/p/${projectId}/announcements`}
          className="mt-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5 transition hover:bg-surface-2">
          <span className={`chip shrink-0 ${ANNOUNCEMENT_META[notice.category].chip}`}>{tr(ANNOUNCEMENT_META[notice.category].labelKey)}</span>
          {notice.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-warning" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={notice.title}>{notice.title}</span>
          <span className="shrink-0 text-[11px] text-ink-subtle">{tr('common.viewAll')}</span>
        </Link>
      )}
    </section>
  )
}
