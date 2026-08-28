import Link from 'next/link'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { ISSUE_SEVERITY_META } from '@/lib/domain/issues'
import { issueQueue, type DashboardIssue, type IssueQueueKind } from '@/lib/domain/issueDashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

// 행 스타일 — 지연=빨강 틴트, 임박=주황 틴트(RiskWorklist ROW_META 미러).
const ROW_META: Record<IssueQueueKind, { border: string; icon: string }> = {
  overdue: { border: 'border-delayed/40', icon: 'text-delayed' },
  dueSoon: { border: 'border-accent-warning/40', icon: 'text-accent-warning' },
}

/**
 * 지연·임박 이슈 — 실행 큐(RiskWorklist)의 이슈판. 기한 경과(경과 많은 순) → 7일 내 마감(가까운 순),
 * 행은 이슈관리 ?focus= 딥링크. 상한(QUEUE_LIMIT)을 넘는 건수는 +N 으로 알린다(조용한 절단 금지).
 */
export function IssueQueueCard({ issues, projectId, today, locale }: {
  issues: DashboardIssue[]
  projectId: string
  /** 실제 오늘(seoulToday). */
  today: string
  locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const q = issueQueue(issues, today)
  const issuesHref = `/p/${projectId}/issues`
  const ddayText = (n: number) => (n <= 0 ? tr('dash.issues.dueToday') : `D-${n}${tr('dash.issues.ddaySuffix')}`)

  return (
    <SectionCard eyebrow="ISSUE QUEUE" title={tr('dash.issues.queueTitle')} icon={AlertTriangle}
      actions={<span className="chip bg-delayed-weak text-delayed">{tr('dash.exec.delayed')} {q.overdueCount} · {tr('dash.exec.dueSoon')} {q.dueSoonCount}</span>}>
      {q.rows.length === 0 ? <p className="text-sm text-ink-muted">{tr('dash.issues.queueEmpty')}</p> : (
        <div className="space-y-2">
          {q.rows.map(({ issue, kind, days }) => {
            const meta = ROW_META[kind]
            const sev = ISSUE_SEVERITY_META[issue.severity]
            const code = issue.piIssueCode ?? `#${issue.issueNo}`
            const detail = kind === 'overdue' ? `${days}${tr('dash.overdueSuffix')}` : ddayText(days)
            const sevLabel = t(locale, sev.labelKey)
            const due = issue.dueDate ? fmtDate(issue.dueDate) : null
            // 코드·마감일은 sm 미만에서 숨긴다 — 360px 에서 고정폭 요소들이 제목을 0 으로 밀어낸다.
            // aria-label 이 둘을 그대로 담아 스크린리더·모바일 모두 정보 손실이 없다.
            // (hidden sm:inline 은 반응형 display 유틸 — 안전망이 보호하는 종류. 상태 변형이 아니다.)
            return (
              <Link key={issue.id} href={`${issuesHref}?focus=${issue.id}`}
                aria-label={`${code} ${issue.title}, ${sevLabel}, ${detail}${due ? `, ${due}` : ''}`}
                className={`flex items-center gap-2.5 rounded-xl border ${meta.border} px-3 py-2.5 hover:bg-surface-2`}>
                <CalendarClock className={`h-4 w-4 shrink-0 ${meta.icon}`} />
                <span className="hidden shrink-0 text-[11px] font-semibold tabular-nums text-ink-subtle sm:inline">{code}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{issue.title}</span>
                <span className={`chip shrink-0 ${sev.chip}`}>{sevLabel}</span>
                {kind === 'dueSoon'
                  ? <span className="chip shrink-0 bg-accent-warning/10 font-semibold text-accent-warning">{detail}</span>
                  : <span className="shrink-0 text-xs text-ink-muted">{detail}</span>}
                {due && <span className="hidden shrink-0 text-xs tabular-nums text-ink-subtle sm:inline">{due}</span>}
              </Link>
            )
          })}
          {q.hiddenCount > 0 && (
            <div className="flex items-center justify-between pt-1 text-xs text-ink-subtle">
              <span className="chip bg-surface-2 text-ink-subtle">+{q.hiddenCount}</span>
              <Link href={issuesHref} className="font-semibold text-brand hover:underline">{tr('dash.issues.moreInList')} →</Link>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}
