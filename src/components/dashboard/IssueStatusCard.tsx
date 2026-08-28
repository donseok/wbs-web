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
import { MiniEmpty } from './bits'
import { RingGauge } from './RingGauge'

/**
 * 이슈 현황 카드(A안 · 링 게이지, 2026-08-28) — 큰 해결률 링 + KPI 2×2 + Mega 영역별 미니 링 타일.
 * 집계는 전부 domain/issueDashboard 가 하고 여기서는 표시만 한다(재계산 금지).
 * 색은 이슈관리 화면의 ISSUE_STATUS_META dot 토큰 그대로 — 두 화면의 색 언어를 맞춘다.
 * 동기 컴포넌트다(locale 은 DashboardView 가 한 번 읽어 내려준다) — renderToStaticMarkup 으로 검증 가능.
 */

/** 타일 상태 점 상한 — 넘치면 +N. 점 하나가 이슈 하나라 수십 건 영역에서 줄이 길어지는 것을 막는다. */
const DOT_CAP = 14

/** 이슈 1건 = 점 1개(상태색, ISSUE_STATUSES 순). 색만으로 읽히지 않게 타일 title 이 건수를 글로 나른다. */
function StatusDots({ counts, total }: { counts: IssueStatusCounts; total: number }) {
  const dots: IssueStatus[] = []
  for (const s of ISSUE_STATUSES) for (let i = 0; i < counts[s] && dots.length < DOT_CAP; i += 1) dots.push(s)
  const rest = total - dots.length
  return (
    <div className="flex flex-wrap items-center gap-[3px]" aria-hidden>
      {dots.map((s, i) => <i key={i} data-dot={s} className={`inline-block h-[7px] w-[7px] rounded-[2px] ${ISSUE_STATUS_META[s].dot}`} />)}
      {rest > 0 && <span className="ml-0.5 text-[10px] font-semibold text-ink-subtle">+{rest}</span>}
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
  const countsText = (c: IssueStatusCounts) =>
    ISSUE_STATUSES.filter(s => c[s] > 0).map(s => `${statusLabel(s)} ${c[s]}`).join(' · ')

  const kpi = issueKpis(issues, today)
  const all = issueStatusCounts(issues)
  const rows = issueMegaBreakdown(issues)
  const resolvedPct = kpi.total ? Math.round((all.resolved / kpi.total) * 100) : 0
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

  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: tr('dash.issues.kpiUnresolved'), value: kpi.unresolved },
    { label: tr('dash.issues.kpiOverdue'), value: kpi.overdue, tone: kpi.overdue > 0 ? 'text-delayed' : undefined },
    { label: tr('dash.issues.kpiHigh'), value: kpi.highUnresolved, tone: kpi.highUnresolved > 0 ? 'text-accent-warning' : undefined },
    { label: tr('dash.issues.kpiResolved7d'), value: kpi.resolved7d, tone: 'text-done' },
  ]

  return (
    <SectionCard eyebrow="ISSUES" title={tr('dash.issues.title')} icon={CircleAlert} actions={actions}>
      <div className="space-y-5">
        {/* 히어로 — 해결률 링 + KPI 2×2. sm 미만은 링을 위에 가운데로, KPI 를 아래로 쌓는다(360px 에서 2×2 가 넘치지 않게).
            서브라인은 히어로 블록 안에 둔다 — space-y 의 margin 이 이기므로 음수 마진으로 당기지 않는다. */}
        <div className="space-y-2">
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5">
            <div className="justify-self-center">
              <RingGauge pct={resolvedPct} size={132} stroke={12} label={`${tr('dash.issues.resolvedRate')} ${resolvedPct}%`}>
                <div>
                  <b className="block text-[30px] font-extrabold leading-none tracking-tight text-ink">{resolvedPct}%</b>
                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{tr('dash.issues.resolvedRate')}</span>
                </div>
              </RingGauge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {kpis.map(k => (
                <div key={k.label} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/50 px-3 py-2">
                  <span className="truncate text-[11px] text-ink-muted">{k.label}</span>
                  <b className={`shrink-0 text-lg font-bold leading-none ${k.tone ?? 'text-ink'}`}>{k.value}</b>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-ink-subtle">
            {tr('dash.issues.kpiUnresolvedSub').replace('{n}', String(kpi.total))} · {tr('dash.issues.kpiResolved7d')} {fmtDate(windowStart)}–{fmtDate(today)}
          </p>
        </div>

        {/* Mega 업무영역별 — 미니 링 타일(8영역 코드순 고정 + 미분류는 있을 때만). 이슈 없는 영역은 흐리게. */}
        <div>
          <div className="mb-2 flex justify-between text-[11px] text-ink-subtle">
            <span>{tr('dash.issues.byMegaRate')}</span><span>{tr('dash.issues.ringHint')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
            {rows.map(r => {
              const area = r.code ? ISSUE_MEGA_AREAS.find(a => a.code === r.code) : null
              const name = area ? (locale === 'en' ? area.nameEn : area.nameKo) : tr('dash.issues.unclassified')
              const empty = r.total === 0
              const title = empty ? `${name}: ${tr('dash.issues.noIssues')}` : `${name}: ${countsText(r.counts)}`
              return (
                <div key={r.code ?? 'none'} title={title}
                  className={`flex min-w-0 flex-col gap-1.5 rounded-xl border border-line p-2.5 ${empty ? 'opacity-60' : ''}`}>
                  {/* 상태 내역은 글로도 — 점(aria-hidden)·title(호버 전용)만으론 키보드·스크린리더 경로가 없다 */}
                  {!empty && <span className="sr-only">{countsText(r.counts)}</span>}
                  <div className="flex min-w-0 items-center gap-2">
                    <RingGauge pct={r.resolvedPct} size={34} stroke={5}
                      label={r.resolvedPct === null ? `${name} ${tr('dash.issues.noIssues')}` : `${name} ${tr('dash.issues.resolvedRate')} ${r.resolvedPct}%`}>
                      <b className="text-[9px] font-bold tracking-tighter text-ink">{r.resolvedPct === null ? '–' : `${r.resolvedPct}%`}</b>
                    </RingGauge>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-ink">
                        <span className="mr-1 text-[10px] font-semibold tabular-nums text-ink-subtle">{r.code ?? '–'}</span>{name}
                      </div>
                      <div className="text-[11px] text-ink-subtle">
                        {empty ? tr('dash.issues.noIssues') : `${r.total}${unit} · ${tr('dash.issues.trendResolvedShort')} ${r.counts.resolved}`}
                      </div>
                    </div>
                  </div>
                  {!empty && <StatusDots counts={r.counts} total={r.total} />}
                </div>
              )
            })}
          </div>
        </div>

        {/* 범례 — 점 순서(ISSUE_STATUSES 고정)를 글로도 알린다(적록 색각 보강). */}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-ink-muted">
          <span className="text-ink-subtle">{tr('dash.issues.legendOrder')}</span>
          {ISSUE_STATUSES.map(s => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-[2px] ${ISSUE_STATUS_META[s].dot}`} aria-hidden />
              <span>{statusLabel(s)}</span> <b className="font-semibold tabular-nums text-ink">{all[s]}</b>
            </span>
          ))}
        </div>

        <p className="text-[11px] leading-4 text-ink-subtle">{tr('dash.issues.caption').replace('{d}', fmtDate(today))}</p>
      </div>
    </SectionCard>
  )
}
