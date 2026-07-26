'use client'
// 이슈 모달 3종 — 상세(진행 편집 포함) / 등록·수정 폼 / 삭제 확인.
// 공지 AnnouncementsView 의 3모달 구조를 파일 분리로 복제(스펙 §6).
// 진행 필드(상태·담당자·조치메모)는 멤버 전체, 전체 편집·삭제 버튼은 canEdit(작성자/pmo)만 노출 —
// 서버 액션이 같은 규칙을 재검증한다(UI 노출은 편의일 뿐 보안 경계가 아니다).
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ExternalLink, FileText, Pencil, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  createIssue, deleteIssue, updateIssue, updateIssueProgress,
  type IssueActionResult, type IssueInput,
} from '@/app/actions/issues'
import {
  ISSUE_SEVERITIES, ISSUE_SEVERITY_META, ISSUE_STATUS_META, STATUS_TRANSITIONS,
  isOverdue, type Issue, type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import { validateIssueDateRange } from '@/lib/domain/issueMinuteSource'
import { minuteSourceHref } from '@/lib/minutes/source'
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

/** 모달 외부 생성 훅에서도 서버 액션과 같은 입력 정본을 사용한다. */
export type IssueFormInput = IssueInput

/** 신규 등록 폼의 선택적 초깃값. 지정하지 않은 값은 일반 신규 등록 기본값을 쓴다. */
export type IssueFormDraft = Partial<IssueFormInput>

/** 회의록 등 이슈가 파생된 원문을 폼에서 읽기 전용으로 확인하기 위한 표시 모델. */
export interface IssueSourcePreview {
  title: string
  date?: string | null
  excerpt: string
  /** 생략하면 공용 "회의록 원문" 번역을 사용한다. */
  label?: string
}

export type IssueCreateHandler = (
  projectId: string,
  input: IssueFormInput,
) => Promise<IssueActionResult>

interface IssueFormSeed {
  title: string
  body: string
  severity: IssueSeverity
  assigneeMemberIds: string[]
  startDate: string
  dueDate: string
}

function issueFormSeed(initial: Issue | null, draft?: IssueFormDraft): IssueFormSeed {
  if (initial) {
    return {
      title: initial.title,
      body: initial.body,
      severity: initial.severity,
      assigneeMemberIds: [...initial.assigneeMemberIds],
      startDate: initial.startDate ?? '',
      dueDate: initial.dueDate ?? '',
    }
  }
  return {
    title: draft?.title ?? '',
    body: draft?.body ?? '',
    severity: draft?.severity ?? 'medium',
    assigneeMemberIds: [...(draft?.assigneeMemberIds ?? [])],
    startDate: draft?.startDate ?? '',
    dueDate: draft?.dueDate ?? '',
  }
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
  const period = issue
    ? issue.startDate && issue.dueDate
      ? `${issue.startDate} → ${issue.dueDate}`
      : issue.startDate
        ? `${issue.startDate} → —`
        : issue.dueDate ?? t('issue.noDue')
    : ''
  const statusOptions: IssueStatus[] = issue ? [issue.status, ...STATUS_TRANSITIONS[issue.status]] : []
  const assigneesDirty = issue !== null && !sameIds(assignees, issue.assigneeMemberIds)
  const dirty = issue !== null
    && (status !== issue.status || assigneesDirty || note !== issue.resolutionNote)

  // 표시용 담당자 칩 — 가나다순, 회의 상세 참석자 칩과 같은 표기(이름 · 팀코드).
  // 여러 명이 쉼표 나열로 좁은 그리드 칸에 들어가면 화면이 빡빡해져 전체 폭 칩 줄로 편다.
  // 조인 행은 멤버 삭제 시 cascade 로 사라지므로 이름 미해석('—')은 과도기뿐이다.
  const memberById = new Map(members.map(m => [m.id, m]))
  const assigneeChips = issue
    ? sortByKoreanName(
      issue.assigneeMemberIds.map(id => {
        const m = memberById.get(id)
        return { id, label: m ? (m.teamCode ? `${m.name} · ${m.teamCode}` : m.name) : (memberName(id) ?? '—') }
      }),
      a => a.label,
    )
    : []

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

          {/* 담당자는 그리드 밖 자기 줄 — 여러 명이면 한 칸 폭으로는 줄바꿈이 겹겹이 쌓인다 */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.col.assignee')}</div>
            {assigneeChips.length === 0 ? (
              <div className="mt-0.5 text-sm text-ink">{t('issue.unassigned')}</div>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {assigneeChips.map(a => (
                  <span key={a.id} className="chip bg-surface-2 text-ink">{a.label}</span>
                ))}
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.col.period')}</dt>
              <dd className={`mt-0.5 tabular-nums ${overdue ? 'font-semibold text-delayed' : 'text-ink'}`}>{period}</dd>
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

          {issue.minuteSources.length > 0 && (
            <section>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {t('issue.source.minute')}
              </div>
              <div className="space-y-2">
                {issue.minuteSources.map(source => (
                  <div key={source.id} className="rounded-2xl border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <FileText className="h-3.5 w-3.5 text-brand" aria-hidden />
                      <span className="text-sm font-semibold text-ink">{source.minuteTitle}</span>
                      <span className="text-xs tabular-nums text-ink-subtle">{source.minuteDate}</span>
                      <span className="chip bg-line text-ink-subtle">
                        {t('issue.source.version').replace('{n}', String(source.minuteVersionNo))}
                      </span>
                      <Link
                        href={minuteSourceHref(source.minuteId, {
                          blockIndex: source.blockIndex,
                          blockHash: source.blockHash,
                          bodyHash: source.bodyHash,
                        }, source.minuteVersionId)}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover"
                      >
                        {t('issue.source.open')}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-ink-muted">
                      {source.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            </section>
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
  open, onClose, projectId, initial, members, draft, sourcePreview, onCreate, onCreated,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  initial: Issue | null
  members: ProjectMember[]
  /** 신규 등록에만 적용된다. 편집 모드에서는 initial 이 항상 우선한다. */
  draft?: IssueFormDraft
  /** 신규 등록에만 표시되는 읽기 전용 출처 카드. */
  sourcePreview?: IssueSourcePreview
  /** 신규 등록 저장을 원문 연결 등과 합성해야 할 때 기본 createIssue 대신 사용한다. */
  onCreate?: IssueCreateHandler
  /** 신규 등록 성공 응답에 id가 있을 때 한 번 호출된다. */
  onCreated?: (id: string) => void
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // pending 렌더 전에 발생하는 빠른 연속 클릭도 막는다.
  const submittingRef = useRef(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<IssueSeverity>('medium')
  const [assignees, setAssignees] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEdit = initial !== null
  // 호출부가 draft 객체/배열을 인라인으로 만들어도 매 렌더 입력을 덮어쓰지 않고,
  // 실제 초깃값 내용이 바뀌거나 모달이 다시 열릴 때만 폼을 재베이스라인한다.
  const seedKey = JSON.stringify(issueFormSeed(initial, draft))

  function closeIfIdle() {
    // 원자 생성 요청이 끝나기 전에 폼이 닫혔다가 다른 블록으로 다시 열리면, 이전
    // 성공 콜백이 새 폼을 닫거나 두 요청이 겹칠 수 있다. 저장 중에는 모든 닫기 경로를 막는다.
    if (submittingRef.current || pending) return
    onClose()
  }

  useEffect(() => {
    if (!open) {
      submittingRef.current = false
      return
    }
    const seed = JSON.parse(seedKey) as IssueFormSeed
    setTitle(seed.title)
    setBody(seed.body)
    setSeverity(seed.severity)
    setAssignees(seed.assigneeMemberIds)
    setStartDate(seed.startDate)
    setDueDate(seed.dueDate)
    setError(null)
    submittingRef.current = false
  }, [open, seedKey])

  function submit() {
    if (submittingRef.current) return
    if (!title.trim()) {
      setError(t('issue.err.titleRequired'))
      return
    }
    if (!validateIssueDateRange(startDate || null, dueDate || null)) {
      setError(t('issue.err.dateRange'))
      return
    }
    const input: IssueFormInput = {
      title: title.trim(),
      body,
      severity,
      assigneeMemberIds: assignees,
      startDate: startDate || null,
      dueDate: dueDate || null,
    }
    submittingRef.current = true
    startTransition(async () => {
      let res: IssueActionResult
      try {
        // 편집은 커스텀 생성 훅의 영향을 받지 않고 기존 권한 검증 액션을 그대로 사용한다.
        res = isEdit
          ? await updateIssue(initial!.id, input)
          : await (onCreate ?? createIssue)(projectId, input)
      } catch (cause) {
        submittingRef.current = false
        setError(cause instanceof Error && cause.message ? cause.message : t('issue.err.saveFailed'))
        return
      }
      if (res.ok) {
        if (!isEdit && res.id) {
          // 생성은 이미 확정됐다. 알림 훅의 UI 오류가 재시도(중복 생성)로 이어지지 않게 분리한다.
          try {
            onCreated?.(res.id)
          } catch (cause) {
            console.error('[IssueFormModal] onCreated callback failed:', cause)
          }
        }
        onClose()
        router.refresh()
      } else {
        submittingRef.current = false
        setError(res.error ?? t('issue.err.saveFailed'))
      }
    })
  }

  return (
    <Modal
      open={open}
      onClose={closeIfIdle}
      title={isEdit ? t('issue.edit') : t('issue.new')}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button onClick={closeIfIdle} disabled={pending} className="btn btn-ghost text-xs">{t('issue.form.cancel')}</button>
          <button onClick={submit} disabled={pending || submittingRef.current} className="btn btn-primary text-xs">{t('issue.form.save')}</button>
        </div>
      }
    >
      <div className="space-y-3">
        {!isEdit && sourcePreview && (
          <section
            aria-label={sourcePreview.label ?? t('issue.source.minute')}
            className="rounded-2xl border border-line bg-surface-2 p-4"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {sourcePreview.label ?? t('issue.source.minute')}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-sm font-semibold text-ink">{sourcePreview.title}</p>
              {sourcePreview.date && <time className="text-xs tabular-nums text-ink-subtle">{sourcePreview.date}</time>}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-muted">
              {sourcePreview.excerpt}
            </p>
          </section>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.title')}</span>
          <input className="app-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('issue.form.titlePh')} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.body')}</span>
          <textarea className="app-textarea min-h-[120px] resize-y" value={body} onChange={e => setBody(e.target.value)} placeholder={t('issue.form.bodyPh')} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.severity')}</span>
            <select className="app-input" value={severity} onChange={e => setSeverity(e.target.value as IssueSeverity)}>
              {ISSUE_SEVERITIES.map(s => (
                <option key={s} value={s}>{t(ISSUE_SEVERITY_META[s].labelKey)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.start')}</span>
            <input
              type="date"
              className="app-input"
              value={startDate}
              max={dueDate || undefined}
              onChange={e => setStartDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.due')}</span>
            <input
              type="date"
              className="app-input"
              value={dueDate}
              min={startDate || undefined}
              onChange={e => setDueDate(e.target.value)}
            />
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
