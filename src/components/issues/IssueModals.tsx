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
  createIssue, deleteIssue, fetchIssueMajorProcesses, updateIssue, updateIssueProgress,
  type IssueActionResult, type IssueInput,
} from '@/app/actions/issues'
import {
  ISSUE_SEVERITIES, ISSUE_SEVERITY_META, ISSUE_STATUS_META, STATUS_TRANSITIONS,
  isOverdue, type Issue, type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'
import {
  ISSUE_MAJOR_NAME_MAX,
  ISSUE_MAJOR_NAME_NUMBERED_RE,
  ISSUE_MEGA_AREAS,
  ISSUE_OWNER_DEPARTMENT_MAX,
  ISSUE_RELATED_SYSTEM_MAX,
  ISSUE_RELATED_SYSTEMS_MAX,
  ISSUE_SOURCE_DETAIL_MAX,
  ISSUE_SOURCE_META,
  ISSUE_SOURCE_TYPES,
  ISSUE_SUB_PROCESS_MAX,
  formatIssueMajorCode,
  type IssueMajorProcess,
  type IssueMegaCode,
  type IssueSourceType,
} from '@/lib/domain/issueAnalysis'
import { sortByKoreanName } from '@/lib/domain/nameSort'
import { validateIssueDateRange } from '@/lib/domain/issueMinuteSource'
import { minuteSourceHref } from '@/lib/minutes/source'
import { uploadIssueAttachments } from '@/lib/issues/uploadIssueAttachments'
import { IssueAssigneePicker } from './IssueAssigneePicker'
import { IssueAttachments } from './IssueAttachments'
import { IssueUpdates } from './IssueUpdates'
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
  /** 원문과 편집 가능한 정리 초안이 분리되어 있음을 안내한다. */
  organizedDraft?: boolean
  /** Mega/Sub Process 추천이 실제 AI 응답에 포함됐을 때만 표시한다. */
  classificationRecommended?: boolean
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
  megaCode: IssueMegaCode | ''
  majorName: string
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  sourceType: IssueSourceType | ''
  sourceDetail: string
}

function sourcePreviewDetail(sourcePreview?: IssueSourcePreview): string {
  if (!sourcePreview) return ''
  return [sourcePreview.title.trim(), sourcePreview.date?.trim()].filter(Boolean).join(' · ')
}

function issueFormSeed(
  initial: Issue | null,
  draft?: IssueFormDraft,
  sourcePreview?: IssueSourcePreview,
): IssueFormSeed {
  if (initial) {
    return {
      title: initial.title,
      body: initial.body,
      severity: initial.severity,
      assigneeMemberIds: [...initial.assigneeMemberIds],
      startDate: initial.startDate ?? '',
      dueDate: initial.dueDate ?? '',
      megaCode: initial.megaCode ?? '',
      majorName: initial.majorName ?? '',
      subProcess: initial.subProcess,
      ownerDepartment: initial.ownerDepartment,
      relatedSystems: [...initial.relatedSystems],
      sourceType: initial.sourceType ?? (initial.minuteSources.length > 0 ? 'minutes' : ''),
      sourceDetail: initial.sourceDetail || (
        initial.minuteSources[0]
          ? [initial.minuteSources[0].minuteTitle, initial.minuteSources[0].minuteDate].filter(Boolean).join(' · ')
          : ''
      ),
    }
  }
  const minuteSource = sourcePreview !== undefined
  return {
    title: draft?.title ?? '',
    body: draft?.body ?? '',
    severity: draft?.severity ?? 'medium',
    assigneeMemberIds: [...(draft?.assigneeMemberIds ?? [])],
    startDate: draft?.startDate ?? '',
    dueDate: draft?.dueDate ?? '',
    megaCode: draft?.megaCode ?? '',
    majorName: draft?.majorName ?? '',
    subProcess: draft?.subProcess ?? '',
    ownerDepartment: draft?.ownerDepartment ?? '',
    relatedSystems: [...(draft?.relatedSystems ?? [])],
    sourceType: minuteSource
      ? 'minutes'
      : draft?.sourceType === 'minutes' ? 'other' : (draft?.sourceType ?? 'other'),
    sourceDetail: draft?.sourceDetail?.trim() ? draft.sourceDetail : sourcePreviewDetail(sourcePreview),
  }
}

/** 쉼표 입력을 API 정본(string[])으로 바꾼다. 공백·빈 토큰 제거 후 최초 순서를 보존해 중복 제거. */
export function normalizeRelatedSystems(raw: string): string[] {
  return [...new Set(raw.split(/[,，]/).map(value => value.trim()).filter(Boolean))]
}

function megaAreaName(code: IssueMegaCode, locale: 'ko' | 'en' | undefined): string {
  const area = ISSUE_MEGA_AREAS.find(candidate => candidate.code === code)
  if (!area) return code
  return `${area.code} · ${locale === 'en' ? area.nameEn : area.nameKo}`
}

export function IssueDetailModal({
  issue, members, memberName, canEdit, canWrite, currentUserId, isProjectAdmin, today, onClose, onEdit, onDelete,
}: {
  issue: Issue | null
  members: ProjectMember[]
  memberName: (id: string | null) => string | null
  /** 이슈 전체 편집·삭제 게이트(작성자 또는 pmo_admin). 이력 등록 권한과는 다른 축이다. */
  canEdit: boolean
  /** 프로젝트 멤버 이상 — 이력 등록 어포던스 기준. canEdit 을 재사용하면 남이 만든 이슈에
   *  일반 멤버가 경과를 못 쓴다(컴파일 에러가 없어 리뷰 전까지 드러나지 않는다). */
  canWrite: boolean
  currentUserId: string | null
  isProjectAdmin: boolean
  today: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, locale } = useLocale()
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
  const analysisMegaLabel = issue?.megaCode ? megaAreaName(issue.megaCode, locale) : '—'
  const analysisMajorLabel = issue?.majorName
    ? issue.megaCode && issue.majorSeq
      ? `${formatIssueMajorCode(issue.megaCode, issue.majorSeq)} · ${issue.majorName}`
      : issue.majorName
    : '—'
  const analysisSourceLabel = issue?.sourceType ? t(ISSUE_SOURCE_META[issue.sourceType].labelKey) : '—'

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
      eyebrow={issue
        ? issue.piIssueCode
          ? `${issue.piIssueCode} · #${issue.issueNo}`
          : `#${issue.issueNo}`
        : undefined}
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

          <section className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {t('issue.analysis.fieldsTitle')}
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.mega')}</dt>
                <dd className="mt-0.5 text-ink">{analysisMegaLabel}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.majorProcess')}</dt>
                <dd className="mt-0.5 text-ink">{analysisMajorLabel}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.subProcess')}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-ink">{issue.subProcess || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.ownerDepartment')}</dt>
                <dd className="mt-0.5 text-ink">{issue.ownerDepartment || '—'}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.sourceType')}</dt>
                <dd className="mt-0.5 text-ink">{analysisSourceLabel}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.relatedSystems')}</dt>
                <dd className="mt-1.5">
                  {issue.relatedSystems.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {issue.relatedSystems.map(system => (
                        <span key={system} className="chip bg-surface text-ink">{system}</span>
                      ))}
                    </div>
                  ) : '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-semibold text-ink-subtle">{t('issue.analysis.sourceDetail')}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-ink">{issue.sourceDetail || '—'}</dd>
              </div>
            </dl>
          </section>

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

          {/* 첨부는 읽기 전용이다 — 다운로드는 로그인 사용자 전체에 열려 있고, 추가·삭제는 수정 폼에서 한다.
              진행 편집 블록 안이 아니라 그 앞에 둔다(푸터 '진행 저장' 버튼의 대상이 흐려지지 않게). */}
          <IssueAttachments issueId={issue.id} />

          {/* 이력은 진행 편집 블록 앞에 둔다 — 첨부와 같은 이유로 푸터 '진행 저장'의
              대상이 흐려지지 않게 한다. */}
          <IssueUpdates
            issueId={issue.id}
            canWrite={canWrite}
            currentUserId={currentUserId}
            isProjectAdmin={isProjectAdmin}
          />

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

/** 'AI 추천 일치' 안내 문구 — 세 분류 필드(mega/major/sub)가 같은 마크업을 공유한다. */
function AiRecommendedHint({ show, text }: { show: boolean; text: string }) {
  if (!show) return null
  return <p className="mt-1 text-[11px] leading-4 text-brand">{text}</p>
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
  /** 신규 등록 성공 응답에 id가 있을 때, DB가 확정한 체번 결과와 함께 한 번 호출된다. */
  onCreated?: (id: string, result: IssueActionResult) => void
}) {
  const { t, locale } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // pending 렌더 전에 발생하는 빠른 연속 클릭도 막는다.
  const submittingRef = useRef(false)
  // 첨부 파일은 이 폼이 소유한다 — IssueAttachments 안에 두면 저장 성공 후 업로드를 await 하는
  // 코드(submit)가 값에 닿을 수 없다.
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  // 첨부 업로드가 부분 실패하면 모달을 닫지 않고 재시도하게 하는데, 그때 저장 버튼을 다시 누르면
  // createIssue 가 또 돌아 **같은 이슈가 두 건 생긴다.** 한 번 만들어진 id 를 여기 걸어 두고,
  // 이후의 저장은 생성을 건너뛰고 남은 첨부만 올린다.
  const createdIdRef = useRef<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<IssueSeverity>('medium')
  const [assignees, setAssignees] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [megaCode, setMegaCode] = useState<IssueMegaCode | ''>('')
  const [majorName, setMajorName] = useState('')
  const [majorOptions, setMajorOptions] = useState<IssueMajorProcess[]>([])
  const [subProcess, setSubProcess] = useState('')
  const [ownerDepartment, setOwnerDepartment] = useState('')
  const [relatedSystemsText, setRelatedSystemsText] = useState('')
  const [sourceType, setSourceType] = useState<IssueSourceType | ''>('')
  const [sourceDetail, setSourceDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEdit = initial !== null
  const minuteSourceLocked = (!isEdit && sourcePreview !== undefined)
    || (isEdit && (initial?.sourceType === 'minutes' || Boolean(initial?.minuteSources.length)))
  const megaLocked = isEdit && Boolean(initial?.piIssueCode)
  // 'AI 추천 일치' 판정 — 세 분류 필드가 공통 전제(신규 등록 + 추천 플래그 + Mega 일치)를
  // 각자 복제하다 한 곳만 고쳐져 조건이 어긋나는 것을 막기 위해 한 함수에 모은다.
  // Mega 자체는 '필드값 = megaCode' 인 경우로 같은 판정을 지난다(코드에 공백이 없어 trim 은 무해).
  const matchesAiDraft = (draftValue: string | null | undefined, current: string): boolean => Boolean(
    !isEdit
    && sourcePreview?.classificationRecommended
    && draft?.megaCode
    && megaCode === draft.megaCode
    && draftValue?.trim()
    && current.trim() === draftValue.trim(),
  )
  const sourceOptions = ISSUE_SOURCE_TYPES.filter(type =>
    type !== 'minutes' || minuteSourceLocked || initial?.sourceType === 'minutes')
  // 호출부가 draft 객체/배열을 인라인으로 만들어도 매 렌더 입력을 덮어쓰지 않고,
  // 실제 초깃값 내용이 바뀌거나 모달이 다시 열릴 때만 폼을 재베이스라인한다.
  const seedKey = JSON.stringify(issueFormSeed(initial, draft, sourcePreview))

  function closeIfIdle() {
    // 원자 생성 요청이 끝나기 전에 폼이 닫혔다가 다른 블록으로 다시 열리면, 이전
    // 성공 콜백이 새 폼을 닫거나 두 요청이 겹칠 수 있다. 저장 중에는 모든 닫기 경로를 막는다.
    if (submittingRef.current || pending) return
    onClose()
  }

  useEffect(() => {
    if (!open) {
      submittingRef.current = false
      // 첨부 state 는 여기(!open)에서만 비운다. 아래 open 분기는 seedKey 가 바뀔 때마다,
      // 즉 **모달이 열려 있는 중에도** 다시 도는데 거기서 비우면 사용자가 고른 파일이
      // 조용히 사라진다. IssuesView 는 이 모달을 항상 마운트해 두므로 명시적 리셋이 필요하다.
      setPendingFiles([])
      createdIdRef.current = null
      return
    }
    const seed = JSON.parse(seedKey) as IssueFormSeed
    setTitle(seed.title)
    setBody(seed.body)
    setSeverity(seed.severity)
    setAssignees(seed.assigneeMemberIds)
    setStartDate(seed.startDate)
    setDueDate(seed.dueDate)
    setMegaCode(seed.megaCode)
    setMajorName(seed.majorName)
    setSubProcess(seed.subProcess)
    setOwnerDepartment(seed.ownerDepartment)
    setRelatedSystemsText(seed.relatedSystems.join(', '))
    setSourceType(seed.sourceType)
    setSourceDetail(seed.sourceDetail)
    setError(null)
    submittingRef.current = false
  }, [open, seedKey])

  // Major 자동완성 후보 — 같은 이름 재사용이 기존 체번(02.01…)을 유지하는 핵심이라
  // 열 때마다 프로젝트의 정본 목록을 불러온다. 실패는 입력을 막지 않되 로그로 남긴다.
  useEffect(() => {
    if (!open || !projectId) {
      setMajorOptions([])
      return
    }
    let cancelled = false
    fetchIssueMajorProcesses(projectId)
      .then(res => {
        if (cancelled) return
        if (res.ok && res.majors) {
          setMajorOptions(res.majors)
        } else {
          console.error('[IssueFormModal] Major Process 목록 로드 실패:', res.error ?? 'unknown')
          setMajorOptions([])
        }
      })
      .catch(cause => {
        if (cancelled) return
        console.error('[IssueFormModal] Major Process 목록 로드 실패:', cause)
        setMajorOptions([])
      })
    return () => { cancelled = true }
  }, [open, projectId])

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
    if (!megaCode) {
      setError(t('issue.err.megaRequired'))
      return
    }
    const normalizedMajorName = majorName.trim()
    if (!normalizedMajorName) {
      setError(t('issue.err.majorRequired'))
      return
    }
    if (normalizedMajorName.length > ISSUE_MAJOR_NAME_MAX) {
      setError(t('issue.err.majorTooLong').replace('{n}', String(ISSUE_MAJOR_NAME_MAX)))
      return
    }
    if (ISSUE_MAJOR_NAME_NUMBERED_RE.test(normalizedMajorName)) {
      setError(t('issue.err.majorNumberedName'))
      return
    }
    const normalizedSubProcess = subProcess.trim()
    if (!normalizedSubProcess) {
      setError(t('issue.err.subProcessRequired'))
      return
    }
    if (normalizedSubProcess.length > ISSUE_SUB_PROCESS_MAX) {
      setError(t('issue.err.subProcessTooLong').replace('{n}', String(ISSUE_SUB_PROCESS_MAX)))
      return
    }
    const normalizedOwnerDepartment = ownerDepartment.trim()
    if (!normalizedOwnerDepartment) {
      setError(t('issue.err.ownerDepartmentRequired'))
      return
    }
    if (normalizedOwnerDepartment.length > ISSUE_OWNER_DEPARTMENT_MAX) {
      setError(t('issue.err.ownerDepartmentTooLong').replace('{n}', String(ISSUE_OWNER_DEPARTMENT_MAX)))
      return
    }
    const relatedSystems = normalizeRelatedSystems(relatedSystemsText)
    if (relatedSystems.length > ISSUE_RELATED_SYSTEMS_MAX) {
      setError(t('issue.err.relatedSystemsTooMany').replace('{n}', String(ISSUE_RELATED_SYSTEMS_MAX)))
      return
    }
    if (relatedSystems.some(system => system.length > ISSUE_RELATED_SYSTEM_MAX)) {
      setError(t('issue.err.relatedSystemTooLong').replace('{n}', String(ISSUE_RELATED_SYSTEM_MAX)))
      return
    }
    const normalizedSourceType = minuteSourceLocked ? 'minutes' : sourceType
    if (!normalizedSourceType) {
      setError(t('issue.err.sourceTypeRequired'))
      return
    }
    if (normalizedSourceType === 'minutes' && !minuteSourceLocked && !isEdit) {
      setError(t('issue.err.minutesSourceOnly'))
      return
    }
    const normalizedSourceDetail = sourceDetail.trim()
    if (normalizedSourceDetail.length > ISSUE_SOURCE_DETAIL_MAX) {
      setError(t('issue.err.sourceDetailTooLong').replace('{n}', String(ISSUE_SOURCE_DETAIL_MAX)))
      return
    }
    const input: IssueFormInput = {
      title: title.trim(),
      body,
      severity,
      assigneeMemberIds: assignees,
      startDate: startDate || null,
      dueDate: dueDate || null,
      megaCode,
      majorName: normalizedMajorName,
      subProcess: normalizedSubProcess,
      ownerDepartment: normalizedOwnerDepartment,
      relatedSystems,
      sourceType: normalizedSourceType,
      sourceDetail: normalizedSourceDetail,
    }
    submittingRef.current = true
    startTransition(async () => {
      let res: IssueActionResult
      // 첨부 실패로 남아 있는 재시도라면 이슈는 이미 만들어져 있다. 다시 만들면 같은 내용의
      // 이슈가 두 건 생긴다(회의록 경로는 원문 링크·토스트까지 중복된다).
      const alreadyCreated = !isEdit && createdIdRef.current !== null
      if (alreadyCreated) {
        res = { ok: true, id: createdIdRef.current! }
      } else {
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
      }
      if (res.ok) {
        if (!isEdit && res.id) {
          createdIdRef.current = res.id
          // 생성은 이미 확정됐다. 알림 훅의 UI 오류가 재시도(중복 생성)로 이어지지 않게 분리한다.
          // 재시도 경로에서는 이미 한 번 불렀으므로 다시 부르지 않는다.
          if (!alreadyCreated) {
            try {
              onCreated?.(res.id, res)
            } catch (cause) {
              console.error('[IssueFormModal] onCreated callback failed:', cause)
            }
          }
          // 첨부는 여기서 await 한다 — onCreated 에 걸면 콜백이 반환되자마자 아래 onClose 가
          // 모달을 닫아 파일 state 가 사라진 뒤 업로드가 돈다. 그동안 pending 이 유지되어
          // 닫기 버튼이 막히는데, 업로드 중 창이 닫히지 않는 편이 낫다.
          if (pendingFiles.length > 0) {
            const up = await uploadIssueAttachments(res.id, pendingFiles)
            if (!up.ok) {
              // 이슈는 이미 만들어졌다. 되돌리면 사용자가 입력을 통째로 잃으므로 되돌리지 않고,
              // 모달을 닫지 않아 재시도하게 한다. 성공 경로는 이 ref 를 해제하지 않으므로 직접 푼다.
              //
              // 성공분은 목록에서 걷어낸다 — 남은 것만 남겨야 재시도가 중복 업로드로 가지 않고,
              // 인덱스를 들고 다니지 않으므로 사용자가 목록을 편집해도 어긋나지 않는다.
              const rest = pendingFiles.slice(up.doneCount)
              setPendingFiles(rest)
              submittingRef.current = false
              setError(
                up.error
                  ? `${t('issue.err.attachUploadFailed').replace('{name}', up.fileName)} ${up.error}`
                  : t('issue.err.attachPartial').replace('{n}', String(rest.length)),
              )
              router.refresh()
              return
            }
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
            aria-label={t('issue.analysis.minuteAutoLinked')}
            className="rounded-2xl border border-line bg-surface-2 p-4"
          >
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {t('issue.analysis.minuteAutoLinked')}
              {sourcePreview.label && <span className="chip bg-line text-ink-subtle">{sourcePreview.label}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-sm font-semibold text-ink">{sourcePreview.title}</p>
              {sourcePreview.date && <time className="text-xs tabular-nums text-ink-subtle">{sourcePreview.date}</time>}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-ink-muted">
              {sourcePreview.excerpt}
            </p>
            {sourcePreview.organizedDraft && (
              <p className="mt-2 border-t border-line pt-2 text-[11px] leading-5 text-brand">
                {t('issue.analysis.organizedDraft')}
              </p>
            )}
            {sourcePreview.classificationRecommended && (
              <p className="mt-1 text-[11px] leading-5 text-brand">
                {t('issue.analysis.classificationRecommended')}
              </p>
            )}
          </section>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.title')}</span>
          <input className="app-input" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('issue.form.titlePh')} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.body')}</span>
          <textarea className="app-textarea min-h-[220px] resize-y" value={body} onChange={e => setBody(e.target.value)} placeholder={t('issue.form.bodyPh')} maxLength={20_000} />
        </label>
        <section className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4">
          <div>
            <h3 className="text-xs font-bold text-ink">{t('issue.analysis.fieldsTitle')}</h3>
            <p className="mt-0.5 text-[11px] leading-5 text-ink-subtle">{t('issue.analysis.fieldsDesc')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.analysis.mega')}</span>
              <select
                className="app-input"
                value={megaCode}
                disabled={megaLocked}
                required
                aria-describedby={megaLocked ? 'issue-mega-locked' : undefined}
                onChange={e => setMegaCode(e.target.value as IssueMegaCode | '')}
              >
                <option value="">{t('issue.analysis.megaPlaceholder')}</option>
                {ISSUE_MEGA_AREAS.map(area => (
                  <option key={area.code} value={area.code}>{megaAreaName(area.code, locale)}</option>
                ))}
              </select>
              {megaLocked && (
                <p id="issue-mega-locked" className="mt-1 text-[11px] leading-4 text-ink-subtle">
                  {t('issue.analysis.megaLocked').replace('{id}', initial?.piIssueCode ?? '')}
                </p>
              )}
              <AiRecommendedHint
                show={matchesAiDraft(draft?.megaCode, megaCode)}
                text={t('issue.analysis.megaRecommended').replace('{code}', draft?.megaCode ?? '')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.analysis.majorProcess')}</span>
              <input
                className="app-input"
                value={majorName}
                required
                maxLength={ISSUE_MAJOR_NAME_MAX}
                list="issue-major-process-options"
                onChange={e => setMajorName(e.target.value)}
                placeholder={t('issue.analysis.majorProcessPh')}
              />
              {/* 같은 이름 재사용 = 기존 번호 유지가 체번 계약의 핵심이라, 선택된 Mega의
                  정본 목록(02.01 · 이름)을 자동완성으로 보여 준다. Mega 미선택 상태에서
                  타 Mega 후보를 골라 엉뚱한 영역에 신규 체번되는 것을 막기 위해 후보는
                  Mega 선택 후에만 노출한다. */}
              <datalist id="issue-major-process-options">
                {(megaCode ? majorOptions.filter(major => major.megaCode === megaCode) : [])
                  .map(major => (
                    <option key={major.id} value={major.name}>
                      {`${formatIssueMajorCode(major.megaCode, major.majorSeq)} · ${major.name}`}
                    </option>
                  ))}
              </datalist>
              <span className="mt-1 block text-[11px] leading-4 text-ink-subtle">
                {t('issue.analysis.majorProcessHint')}
              </span>
              <AiRecommendedHint
                show={matchesAiDraft(draft?.majorName, majorName)}
                text={t('issue.analysis.majorProcessRecommended')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.analysis.subProcess')}</span>
              <input
                className="app-input"
                value={subProcess}
                required
                maxLength={ISSUE_SUB_PROCESS_MAX}
                onChange={e => setSubProcess(e.target.value)}
                placeholder={t('issue.analysis.subProcessPh')}
              />
              <AiRecommendedHint
                show={matchesAiDraft(draft?.subProcess, subProcess)}
                text={t('issue.analysis.subProcessRecommended')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.analysis.ownerDepartment')}</span>
              <input
                className="app-input"
                value={ownerDepartment}
                required
                maxLength={ISSUE_OWNER_DEPARTMENT_MAX}
                onChange={e => setOwnerDepartment(e.target.value)}
                placeholder={t('issue.analysis.ownerDepartmentPh')}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
                {t('issue.analysis.relatedSystems')} <span className="font-normal text-ink-subtle">{t('issue.analysis.optional')}</span>
              </span>
              <input
                className="app-input"
                value={relatedSystemsText}
                onChange={e => setRelatedSystemsText(e.target.value)}
                placeholder={t('issue.analysis.relatedSystemsPh')}
              />
              <span className="mt-1 block text-[11px] leading-4 text-ink-subtle">{t('issue.analysis.relatedSystemsHint')}</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.analysis.sourceType')}</span>
              <select
                className="app-input"
                value={sourceType}
                disabled={minuteSourceLocked}
                required
                aria-describedby={minuteSourceLocked ? 'issue-source-locked' : undefined}
                onChange={e => setSourceType(e.target.value as IssueSourceType | '')}
              >
                <option value="">{t('issue.analysis.sourceTypePlaceholder')}</option>
                {sourceOptions.map(type => (
                  <option key={type} value={type}>{t(ISSUE_SOURCE_META[type].labelKey)}</option>
                ))}
              </select>
              {minuteSourceLocked && (
                <p id="issue-source-locked" className="mt-1 text-[11px] leading-4 text-brand">
                  {t('issue.analysis.minuteAutoLinked')}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
                {t('issue.analysis.sourceDetail')} <span className="font-normal text-ink-subtle">{t('issue.analysis.optional')}</span>
              </span>
              <input
                className="app-input"
                value={sourceDetail}
                maxLength={ISSUE_SOURCE_DETAIL_MAX}
                onChange={e => setSourceDetail(e.target.value)}
                placeholder={t('issue.analysis.sourceDetailPh')}
              />
            </label>
          </div>
        </section>
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
        {/* 수정 폼은 이슈가 이미 있으니 고르는 즉시 올린다. 등록 폼은 id 가 없어 담아만 두고,
            저장이 성공한 뒤 submit() 이 발급된 id 로 올린다. */}
        <IssueAttachments
          issueId={isEdit ? initial!.id : null}
          editable
          pending={isEdit ? undefined : pendingFiles}
          onPendingChange={setPendingFiles}
          disabled={pending}
        />
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
        {issue && (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink">
            {issue.piIssueCode ? `${issue.piIssueCode} · #${issue.issueNo}` : `#${issue.issueNo}`} {issue.title}
          </p>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  )
}
