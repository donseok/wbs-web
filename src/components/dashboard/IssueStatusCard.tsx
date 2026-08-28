import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import { ISSUE_STATUSES, ISSUE_STATUS_META, type IssueStatus } from '@/lib/domain/issues'
import { ISSUE_MEGA_AREAS } from '@/lib/domain/issueAnalysis'
import {
  issueKpis, issueMegaBreakdown, issueStatusCounts, RESOLVED_WINDOW_DAYS,
  type DashboardIssue, type IssueStatusCounts,
} from '@/lib/domain/issueDashboard'
import { addDaysIso } from '@/lib/domain/dates'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
import { MiniEmpty, Stat } from './bits'

/**
 * 이슈 현황 카드 — KPI 4타일 + 전체 상태 분포 + Mega 업무영역별 스택 바.
 * 집계는 전부 domain/issueDashboard 가 하고 여기서는 표시만 한다(재계산 금지).
 * 색은 이슈관리 화면의 ISSUE_STATUS_META dot 토큰 그대로 — 두 화면의 색 언어를 맞춘다.
 * 동기 컴포넌트다(locale 은 DashboardView 가 한 번 읽어 내려준다) — renderToStaticMarkup 으로 검증 가능.
 */

/** 상태 스택 바 — 세그먼트 사이 2px 표면 간격(gap-0.5)으로 색만으로 나누지 않는다. total 0 은 트랙만. */
function StatusStack({ counts, total, label }: { counts: IssueStatusCounts; total: number; label: string }) {
  if (total === 0) return <div className="h-2.5 rounded-full bg-line" aria-hidden />
  return (
    <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface" role="img" aria-label={label} title={label}>
      {ISSUE_STATUSES.filter(s => counts[s] > 0).map(s => (
        <span key={s} className={`block h-full min-w-0.5 ${ISSUE_STATUS_META[s].dot}`} style={{ flex: counts[s] }} />
      ))}
    </div>
  )
}

export function IssueStatusCard({ issues, projectId, today, locale }: {
  issues: DashboardIssue[]
  projectId: string
  /** 실제 오늘(seoulToday) — 공정율 base_date 가 아니다. */
  today: string
  locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const unit = tr('dash.unitCount')
  const statusLabel = (s: IssueStatus) => t(locale, ISSUE_STATUS_META[s].labelKey)
  const stackLabel = (c: IssueStatusCounts) =>
    ISSUE_STATUSES.filter(s => c[s] > 0).map(s => `${statusLabel(s)} ${c[s]}`).join(' · ')

  const kpi = issueKpis(issues, today)
  const all = issueStatusCounts(issues)
  const rows = issueMegaBreakdown(issues)
  const windowStart = addDaysIso(today, -(RESOLVED_WINDOW_DAYS - 1))

  const actions = (
    <>
      <span className="chip bg-surface-2 text-ink-subtle">{tr('dash.issues.totalPrefix')}{kpi.total}{unit}</span>
      <Link href={`/p/${projectId}/issues`} className="text-xs font-semibold text-brand hover:underline">
        {tr('dash.issues.open')} →
      </Link>
    </>
  )

  if (issues.length === 0) {
    return (
      <SectionCard eyebrow="ISSUES" title={tr('dash.issues.title')} icon={CircleAlert} actions={actions}>
        <MiniEmpty text={tr('dash.issues.empty')} />
      </SectionCard>
    )
  }

  return (
    <SectionCard eyebrow="ISSUES" title={tr('dash.issues.title')} icon={CircleAlert} actions={actions}>
      <div className="space-y-5">
        {/* KPI — 지연·심각은 0 이면 기본 잉크(경고색은 실제 건수가 있을 때만) */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label={tr('dash.issues.kpiUnresolved')} value={kpi.unresolved}
            sub={tr('dash.issues.kpiUnresolvedSub').replace('{n}', String(kpi.total))} />
          <Stat label={tr('dash.issues.kpiOverdue')} value={kpi.overdue} sub={tr('dash.issues.kpiOverdueSub')}
            tone={kpi.overdue > 0 ? 'text-delayed' : undefined} />
          <Stat label={tr('dash.issues.kpiHigh')} value={kpi.highUnresolved} sub={tr('dash.issues.kpiHighSub')}
            tone={kpi.highUnresolved > 0 ? 'text-accent-warning' : undefined} />
          <Stat label={tr('dash.issues.kpiResolved7d')} value={kpi.resolved7d}
            sub={`${fmtDate(windowStart)}–${fmtDate(today)}`} tone="text-done" />
        </div>

        {/* 전체 상태 분포 */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-ink-subtle">{tr('dash.issues.distribution')}</span>
            <span className="text-xs font-semibold tabular-nums text-ink">
              {tr('dash.issues.kpiUnresolved')} {kpi.unresolved} / {statusLabel('resolved')} {all.resolved}
            </span>
          </div>
          <StatusStack counts={all} total={kpi.total} label={stackLabel(all)} />
          {/* 범례 — 세그먼트 순서(ISSUE_STATUSES 고정)를 글로도 알린다. Mega 행 스택 바엔 범례가 없어
              적록 색각에서 열림/해결이 색만으로는 안 갈리므로 '왼쪽부터' 순서 단서가 그 보강이다. */}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-subtle">{tr('dash.issues.legendOrder')}</span>
            {ISSUE_STATUSES.map(s => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${ISSUE_STATUS_META[s].dot}`} aria-hidden />
                <span>{statusLabel(s)}</span> <b className="font-semibold tabular-nums text-ink">{all[s]}</b>
              </span>
            ))}
          </div>
        </div>

        {/* Mega 업무영역별 — 8영역 코드순 고정, 이슈 없는 영역은 흐리게 '–'(TeamProgress 관례) */}
        <div>
          <div className="mb-2.5 flex justify-between text-[11px] text-ink-subtle">
            <span>{tr('dash.issues.byMega')}</span><span>{tr('dash.issues.byMegaCols')}</span>
          </div>
          <div className="space-y-2.5">
            {rows.map(r => {
              const area = r.code ? ISSUE_MEGA_AREAS.find(a => a.code === r.code) : null
              const name = area ? (locale === 'en' ? area.nameEn : area.nameKo) : tr('dash.issues.unclassified')
              const empty = r.total === 0
              // 이슈 없는 행은 흐리게 — 같은 속성의 클래스를 겹쳐 쓰지 않고(순서 무관하게 한쪽이 죽는다) 조건으로 고른다.
              const nameCls = empty ? 'font-medium text-ink-subtle' : 'font-semibold text-ink'
              const pctCls = empty ? 'font-medium text-ink-subtle' : 'font-semibold text-ink'
              return (
                <div key={r.code ?? 'none'} className="grid grid-cols-[104px_40px_minmax(0,1fr)_78px] items-center gap-3">
                  <span className={`truncate text-sm ${nameCls}`} title={name}>
                    <span className="mr-1.5 text-[10px] font-semibold tabular-nums text-ink-subtle">{r.code ?? '–'}</span>{name}
                  </span>
                  <span className="text-right text-[11px] tabular-nums text-ink-subtle">{empty ? '–' : `${r.total}${unit}`}</span>
                  <StatusStack counts={r.counts} total={r.total} label={`${name}: ${stackLabel(r.counts)}`} />
                  <span className={`text-right text-xs tabular-nums ${pctCls}`}>
                    {empty ? '–' : <><span className="mr-1 font-medium text-ink-subtle">{r.counts.resolved}/{r.total}</span>{r.resolvedPct}%</>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <p className="text-[11px] leading-4 text-ink-subtle">{tr('dash.issues.caption').replace('{d}', fmtDate(today))}</p>
      </div>
    </SectionCard>
  )
}
