'use client'
// 이슈 목록 — 필터(상태·심각도·내담당) + 테이블 + ?focus= 딥링크. (KPI 3장은 사용자 요청으로 제거)
// 테이블 골격은 MeetingsView(가로 스크롤 + 행 키보드 패턴), 모달·focus 소비는 AnnouncementsView 복제.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleAlert, Plus } from 'lucide-react'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useLocale } from '@/components/providers/LocaleProvider'
import { DeleteIssueModal, IssueDetailModal, IssueFormModal } from './IssueModals'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import {
  ISSUE_SEVERITIES, ISSUE_SEVERITY_META, ISSUE_STATUSES, ISSUE_STATUS_META,
  canEditIssue, filterIssues, isOverdue, sortIssues,
  type Issue, type IssueSeverityFilter, type IssueStatusFilter,
} from '@/lib/domain/issues'
import type { ProjectMember } from '@/lib/domain/types'

export function IssuesView({
  issues, members, projectId, currentUserId, role, myMemberIds, today,
}: {
  issues: Issue[]
  members: ProjectMember[]
  projectId: string
  currentUserId: string | null
  role: string | null
  myMemberIds: string[]
  today: string
}) {
  const { t } = useLocale()
  const searchParams = useSearchParams()

  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<IssueSeverityFilter>('all')
  const [mineOnly, setMineOnly] = useState(false)
  // 딥링크 ?focus= — 최초 마운트에서 해당 이슈 상세를 연다. 무효 id 는 조용히 무시(공지·회의 관례).
  // viewing 은 id 만 상태로 갖고 issues 에서 파생한다 — conflict 후 router.refresh() 로 issues 가 새
  // 참조로 갱신되면 모달도 자동으로 최신값을 반영한다(객체 state 로 들고 있으면 refresh 가 못 미친다).
  const [viewingId, setViewingId] = useState<string | null>(() => searchParams.get('focus'))
  const viewing = useMemo(
    () => (viewingId ? issues.find(i => i.id === viewingId) ?? null : null),
    [issues, viewingId],
  )
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Issue | null>(null)
  const [deleting, setDeleting] = useState<Issue | null>(null)

  const myIds = useMemo(() => new Set(myMemberIds), [myMemberIds])
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.name])), [members])
  const memberName = (id: string | null) => (id ? memberNameById.get(id) ?? null : null)

  /** 테이블 셀용 담당자 표기 — 가나다순, 2명까지 이름·나머지는 개수. 없으면 null(셀이 '담당 없음' 폴백). */
  function assigneeLabel(issue: Issue): string | null {
    if (issue.assigneeMemberIds.length === 0) return null
    const names = sortByKoreanName(issue.assigneeMemberIds.map(id => memberNameById.get(id) ?? '—'), n => n)
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} ${t('issue.assigneeMore').replace('{n}', String(names.length - 2))}`
  }

  const visible = useMemo(
    () => sortIssues(filterIssues(issues, { status: statusFilter, severity: severityFilter, mineOnly, myMemberIds: myIds }), today),
    [issues, statusFilter, severityFilter, mineOnly, myIds, today],
  )

  const statusTabs = [
    { key: 'all' as const, label: t('issue.filter.all') },
    ...ISSUE_STATUSES.map(s => ({ key: s, label: t(ISSUE_STATUS_META[s].labelKey) })),
  ]
  const severityTabs = [
    { key: 'all' as const, label: t('issue.filter.all') },
    ...ISSUE_SEVERITIES.map(s => ({ key: s, label: t(ISSUE_SEVERITY_META[s].labelKey) })),
  ]

  function openWrite() {
    setEditing(null)
    setFormOpen(true)
  }
  function openEdit(issue: Issue) {
    setViewingId(null)
    setEditing(issue)
    setFormOpen(true)
  }

  const filtered = statusFilter !== 'all' || severityFilter !== 'all' || mineOnly

  return (
    <div className="space-y-4">
      {/* 툴바: 필터 + 등록 */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} size="sm" />
        <SegmentedTabs tabs={severityTabs} value={severityFilter} onChange={setSeverityFilter} size="sm" />
        <button
          onClick={() => setMineOnly(v => !v)}
          aria-pressed={mineOnly}
          className={`chip cursor-pointer border transition ${mineOnly ? 'border-brand bg-brand-weak text-brand' : 'border-line bg-surface text-ink-muted hover:text-ink'}`}
        >
          {t('issue.filter.mine')}
        </button>
        <div className="ml-auto">
          <button onClick={openWrite} className="btn btn-primary inline-flex items-center gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />{t('issue.new')}
          </button>
        </div>
      </div>

      {/* 테이블 (MeetingsView 골격) */}
      {visible.length > 0 ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th className="px-4 py-3">{t('issue.col.no')}</th>
                  <th className="px-4 py-3">{t('issue.col.title')}</th>
                  <th className="px-4 py-3">{t('issue.col.status')}</th>
                  <th className="px-4 py-3">{t('issue.col.severity')}</th>
                  <th className="px-4 py-3">{t('issue.col.assignee')}</th>
                  <th className="px-4 py-3">{t('issue.col.due')}</th>
                  <th className="px-4 py-3">{t('issue.col.created')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(issue => {
                  const sMeta = ISSUE_STATUS_META[issue.status]
                  const overdue = isOverdue(issue, today)
                  return (
                    <tr
                      key={issue.id}
                      onClick={() => setViewingId(issue.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setViewingId(issue.id) }}
                      className="cursor-pointer border-b border-line/70 transition last:border-0 hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
                    >
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">#{issue.issueNo}</td>
                      <td className="px-4 py-3 font-medium text-ink">{issue.title}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`chip ${sMeta.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sMeta.dot}`} />
                          {t(sMeta.labelKey)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`chip ${ISSUE_SEVERITY_META[issue.severity].chip}`}>{t(ISSUE_SEVERITY_META[issue.severity].labelKey)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{assigneeLabel(issue) ?? t('issue.unassigned')}</td>
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums ${overdue ? 'font-semibold text-delayed' : 'text-ink-muted'}`}>
                        {issue.dueDate ?? '—'}{overdue && ` · ${t('issue.overdueBadge')}`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                        {issue.createdByName ?? '—'} · <span className="tabular-nums">{issue.createdAt.slice(0, 10)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CircleAlert}
          title={filtered ? t('issue.emptyFiltered.title') : t('issue.empty.title')}
          description={filtered ? t('issue.emptyFiltered.desc') : t('issue.empty.desc')}
          action={!filtered ? (
            <button onClick={openWrite} className="btn btn-primary inline-flex items-center gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />{t('issue.new')}
            </button>
          ) : undefined}
        />
      )}

      <IssueDetailModal
        issue={viewing}
        members={members}
        memberName={memberName}
        canEdit={viewing ? canEditIssue(viewing, currentUserId, role) : false}
        today={today}
        onClose={() => setViewingId(null)}
        onEdit={() => viewing && openEdit(viewing)}
        onDelete={() => {
          if (!viewing) return
          setDeleting(viewing)
          setViewingId(null)
        }}
      />
      <IssueFormModal open={formOpen} onClose={() => setFormOpen(false)} projectId={projectId} initial={editing} members={members} />
      <DeleteIssueModal issue={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
