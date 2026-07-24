'use client'
// 이슈 모달 3종 — 상세(진행 편집 포함) / 등록·수정 폼 / 삭제 확인.
// 공지 AnnouncementsView 의 3모달 구조를 파일 분리로 복제(스펙 §6).
// 진행 필드(상태·담당자·조치메모)는 멤버 전체, 전체 편집·삭제 버튼은 canEdit(작성자/pmo)만 노출 —
// 서버 액션이 같은 규칙을 재검증한다(UI 노출은 편의일 뿐 보안 경계가 아니다).
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { createIssue, deleteIssue, updateIssue, updateIssueProgress } from '@/app/actions/issues'
import {
  ISSUE_SEVERITIES, ISSUE_SEVERITY_META, ISSUE_STATUS_META, STATUS_TRANSITIONS,
  isOverdue, type Issue, type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import { IssueAssigneePicker } from './IssueAssigneePicker'
import type { ProjectMember } from '@/lib/domain/types'

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-delayed/40 bg-delayed-weak px-3 py-2.5 text-xs font-medium text-delayed">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  )
}

function StatusChip({ status }: { status: IssueStatus }) {
  const { t } = useLocale()
  const meta = ISSUE_STATUS_META[status]
  return (
    <span className={`chip ${meta.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {t(meta.labelKey)}
    </span>
  )
}

function SeverityChip({ severity }: { severity: IssueSeverity }) {
  const { t } = useLocale()
  return <span className={`chip ${ISSUE_SEVERITY_META[severity].chip}`}>{t(ISSUE_SEVERITY_META[severity].labelKey)}</span>
}

/** 순서 무시 동등 비교 — 피커가 중복 없는 배열을 보장하므로 정렬 후 비교로 충분하다. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort(), sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

export function IssueDetailModal({
  issue, members, memberName, canEdit, today, onClose, onEdit, onDelete,
}: {
  issue: Issue | null
  members: ProjectMember[]
  memberName: (id: string | null) => string | null
  canEdit: boolean
  today: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<IssueStatus>('open')
  const [assignees, setAssignees] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 이슈 데이터가 갱신될 때마다 진행 편집 폼을 현재값으로 재베이스라인.
  // 부분 실패 경로(담당자 저장 실패)는 액션이 revalidate 를 하고 에러를 반환하므로,
  // 여기서 error 까지 지우면 새 RSC 커밋의 참조 갱신이 그 고지를 화면에서 소거한다 —
  // 에러 초기화는 아래 이펙트(대상 이슈 '전환' 시점)만 담당한다(리뷰 F2).
  useEffect(() => {
    if (!issue) return
    setStatus(issue.status)
    setAssignees(issue.assigneeMemberIds)
    setNote(issue.resolutionNote)
  }, [issue])
  const issueId = issue?.id
  useEffect(() => { setError(null) }, [issueId])

  // null 이면 닫힘 — 공지 ReadModal 관례(단일 Modal, open={item !== null}).
  const overdue = issue ? isOverdue(issue, today) : false
  const statusOptions: IssueStatus[] = issue ? [issue.status, ...STATUS_TRANSITIONS[issue.status]] : []
  const assigneesDirty = issue !== null && !sameIds(assignees, issue.assigneeMemberIds)
  const dirty = issue !== null
    && (status !== issue.status || assigneesDirty || note !== issue.resolutionNote)

  // 표시용 담당자 이름 — 가나다순. 조인 행은 멤버 삭제 시 cascade 로 사라지므로 이름 미해석은 과도기뿐이다.
  const assigneeNames = issue
    ? sortByKoreanName(issue.assigneeMemberIds.map(id => memberName(id) ?? '—'), n => n).join(', ')
    : ''

  function saveProgress() {
    if (!issue || !dirty) return
    const patch = {
      ...(status !== issue.status ? { status, expectedStatus: issue.status } : {}),
      ...(assigneesDirty ? { assigneeMemberIds: assignees } : {}),
      ...(note !== issue.resolutionNote ? { resolutionNote: note } : {}),
    }
    startTransition(async () => {
      const res = await updateIssueProgress(issue.id, patch)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('issue.err.saveFailed'))
        // CAS 충돌은 최신 데이터로 갱신해 재시도 기반을 맞춰준다
        if (res.conflict) router.refresh()
      }
    })
  }

  return (
    <Modal
      open={issue !== null}
      onClose={onClose}
      eyebrow={issue ? `#${issue.issueNo}` : undefined}
      title={issue?.title ?? ''}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <button onClick={onEdit} className="btn btn-ghost text-xs">
                  <Pencil className="h-3.5 w-3.5" />{t('issue.edit')}
                </button>
                <button onClick={onDelete} className="btn btn-ghost text-xs text-delayed">
                  <Trash2 className="h-3.5 w-3.5" />{t('issue.delete.run')}
                </button>
              </>
            )}
          </div>
          <button onClick={saveProgress} disabled={pending || !dirty} className="btn btn-primary text-xs">
            {t('issue.detail.saveProgress')}
          </button>
        </div>
      }
    >
      {issue && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={issue.status} />
            <SeverityChip severity={issue.severity} />
            {overdue && <span className="chip bg-delayed-weak text-delayed">{t('issue.overdueBadge')}</span>}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.col.assignee')}</dt>
              <dd className="mt-0.5 text-ink">{assigneeNames || t('issue.unassigned')}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.col.due')}</dt>
              <dd className={`mt-0.5 tabular-nums ${overdue ? 'font-semibold text-delayed' : 'text-ink'}`}>{issue.dueDate ?? t('issue.noDue')}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.detail.reporter')}</dt>
              <dd className="mt-0.5 text-ink">{issue.createdByName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {issue.resolvedAt ? t('issue.detail.resolvedAt') : t('issue.detail.createdAt')}
              </dt>
              <dd className="mt-0.5 tabular-nums text-ink">{(issue.resolvedAt ?? issue.createdAt).slice(0, 10)}</dd>
            </div>
          </dl>

          {issue.body && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.detail.body')}</div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{issue.body}</p>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.detail.progress')}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.detail.status')}</span>
                <select className="app-input" value={status} onChange={e => setStatus(e.target.value as IssueStatus)}>
                  {statusOptions.map(s => (
                    <option key={s} value={s}>{t(ISSUE_STATUS_META[s].labelKey)}</option>
                  ))}
                </select>
              </label>
            </div>
            {/* 다중 선택 피커는 셀렉트보다 키가 커서 반 칸에 안 들어간다 — 전체 폭 배치 */}
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.assignee')}</span>
              <IssueAssigneePicker members={members} selected={assignees} onChange={setAssignees} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.detail.note')}</span>
              <textarea
                className="app-textarea min-h-[96px] resize-y"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('issue.detail.notePh')}
              />
            </label>
            {error && <ErrorBox message={error} />}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function IssueFormModal({
  open, onClose, projectId, initial, members,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initial: Issue | null
  members: ProjectMember[]
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<IssueSeverity>('medium')
  const [assignees, setAssignees] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEdit = initial !== null

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setBody(initial?.body ?? '')
    setSeverity(initial?.severity ?? 'medium')
    setAssignees(initial?.assigneeMemberIds ?? [])
    setDueDate(initial?.dueDate ?? '')
    setError(null)
  }, [open, initial])

  function submit() {
    if (!title.trim()) {
      setError(t('issue.err.titleRequired'))
      return
    }
    const input = { title: title.trim(), body, severity, assigneeMemberIds: assignees, dueDate: dueDate || null }
    startTransition(async () => {
      const res = isEdit ? await updateIssue(initial!.id, input) : await createIssue(projectId, input)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('issue.err.saveFailed'))
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('issue.edit') : t('issue.new')}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost text-xs">{t('issue.form.cancel')}</button>
          <button onClick={submit} disabled={pending} className="btn btn-primary text-xs">{t('issue.form.save')}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.title')}</span>
          <input className="app-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('issue.form.titlePh')} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.body')}</span>
          <textarea className="app-textarea min-h-[120px] resize-y" value={body} onChange={e => setBody(e.target.value)} placeholder={t('issue.form.bodyPh')} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.severity')}</span>
            <select className="app-input" value={severity} onChange={e => setSeverity(e.target.value as IssueSeverity)}>
              {ISSUE_SEVERITIES.map(s => (
                <option key={s} value={s}>{t(ISSUE_SEVERITY_META[s].labelKey)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.due')}</span>
            <input type="date" className="app-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </label>
        </div>
        {/* 다중 선택 피커는 셀렉트보다 키가 커서 그리드 한 칸에 안 들어간다 — 전체 폭 배치 */}
        <div>
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.assignee')}</span>
          <IssueAssigneePicker members={members} selected={assignees} onChange={setAssignees} />
        </div>
        <p className="text-[11px] text-ink-subtle">{t('issue.form.dueHint')}</p>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}

export function DeleteIssueModal({ issue, onClose }: { issue: Issue | null; onClose: () => void }) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setError(null) }, [issue])

  function run() {
    if (!issue) return
    startTransition(async () => {
      const res = await deleteIssue(issue.id)
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        setError(res.error ?? t('issue.err.deleteFailed'))
      }
    })
  }

  return (
    <Modal
      open={issue !== null}
      onClose={onClose}
      title={t('issue.delete.title')}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost text-xs">{t('issue.delete.cancel')}</button>
          <button onClick={run} disabled={pending} className="btn btn-primary bg-delayed text-xs">{t('issue.delete.run')}</button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink">{t('issue.delete.confirmPrefix')}</p>
        {issue && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink">#{issue.issueNo} {issue.title}</p>}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}
