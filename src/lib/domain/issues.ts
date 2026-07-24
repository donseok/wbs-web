// 이슈관리 도메인 — 순수 함수만(I/O 없음). 스펙: docs/superpowers/specs/2026-07-23-issues-mvp-design.md §3.
// 상태 전환의 단일 정본은 STATUS_TRANSITIONS — UI(select 옵션)와 서버 액션(전환 검증)이
// 이 맵만 참조한다. 5번째 상태를 추가할 때 이 파일 + 0041 check 제약만 바꾸면 되게 유지할 것.

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'on_hold'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_SEVERITIES = ['high', 'medium', 'low'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

export interface Issue {
  id: string
  issueNo: number
  projectId: string
  title: string
  body: string
  status: IssueStatus
  severity: IssueSeverity
  /** 담당자 멤버 id 목록(0042 조인 테이블). 표시 순서는 뷰가 이름순으로 다시 정렬한다. */
  assigneeMemberIds: string[]
  dueDate: string | null          // 'YYYY-MM-DD'
  resolutionNote: string
  resolvedAt: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

/** 허용 상태 전환. 자기 자신으로의 전환은 항상 불허(맵에 없음). */
export const STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ['in_progress', 'on_hold', 'resolved'],
  in_progress: ['open', 'on_hold', 'resolved'],
  on_hold: ['open', 'in_progress', 'resolved'],
  resolved: ['open', 'in_progress'],
}

export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

/**
 * 상태 전환에 따른 resolved_at 다음 값 — resolved 진입 시 now, resolved 밖으로/밖에서는 null.
 * (재오픈 시 해결 시각을 지워 '해결됨' 흔적이 남지 않게 한다 — 스펙 §3)
 */
export function nextResolvedAt(from: IssueStatus, to: IssueStatus, current: string | null, nowIso: string): string | null {
  if (to === 'resolved') return from === 'resolved' ? current : nowIso
  return null
}

// 배지 META — 회의 MEETING_META 형식(labelKey 는 dict 키, 표시 지점에서 t()).
// 색은 전부 기존 토큰 팔레트(라이트·다크 자동 대응). on_hold dot 은 사이드바 unknown 관례(slate-400).
export const ISSUE_STATUS_META: Record<
  IssueStatus,
  { labelKey: `issue.status.${IssueStatus}`; chip: string; dot: string }
> = {
  open:        { labelKey: 'issue.status.open',        chip: 'bg-delayed-weak text-delayed',   dot: 'bg-delayed' },
  in_progress: { labelKey: 'issue.status.in_progress', chip: 'bg-progress-weak text-progress', dot: 'bg-progress' },
  resolved:    { labelKey: 'issue.status.resolved',    chip: 'bg-done-weak text-done',         dot: 'bg-done' },
  on_hold:     { labelKey: 'issue.status.on_hold',     chip: 'bg-line text-ink-subtle',        dot: 'bg-slate-400' },
}

export const ISSUE_SEVERITY_META: Record<
  IssueSeverity,
  { labelKey: `issue.severity.${IssueSeverity}`; chip: string }
> = {
  high:   { labelKey: 'issue.severity.high',   chip: 'bg-delayed-weak text-delayed' },
  medium: { labelKey: 'issue.severity.medium', chip: 'bg-pending-weak text-pending' },
  low:    { labelKey: 'issue.severity.low',    chip: 'bg-line text-ink-subtle' },
}

/** 지연 = 기한 경과(당일 제외) + 미해결. today 는 'YYYY-MM-DD'(Asia/Seoul) — 호출부가 계산해 내려준다. */
export function isOverdue(issue: Pick<Issue, 'dueDate' | 'status'>, today: string): boolean {
  if (!issue.dueDate || issue.status === 'resolved') return false
  return issue.dueDate < today
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }

/** 기본 정렬: 미해결 우선 → 지연 우선 → 심각도(높음 먼저) → 목표일 오름차순(없으면 뒤) → 최신 등록순. 원본 불변. */
export function sortIssues(issues: Issue[], today: string): Issue[] {
  return [...issues].sort((a, b) => {
    const ar = a.status === 'resolved' ? 1 : 0
    const br = b.status === 'resolved' ? 1 : 0
    if (ar !== br) return ar - br
    const ao = isOverdue(a, today) ? 0 : 1
    const bo = isOverdue(b, today) ? 0 : 1
    if (ao !== bo) return ao - bo
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    }
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1
      if (b.dueDate === null) return -1
      return a.dueDate < b.dueDate ? -1 : 1
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  })
}

export type IssueStatusFilter = 'all' | IssueStatus
export type IssueSeverityFilter = 'all' | IssueSeverity

/** 필터 칩 적용. mineOnly 는 담당자 중 한 명이라도 내 멤버 id 집합에 속하는 이슈만(미지정 담당 제외). */
export function filterIssues(
  issues: Issue[],
  f: { status: IssueStatusFilter; severity: IssueSeverityFilter; mineOnly: boolean; myMemberIds: ReadonlySet<string> },
): Issue[] {
  return issues.filter(i =>
    (f.status === 'all' || i.status === f.status)
    && (f.severity === 'all' || i.severity === f.severity)
    && (!f.mineOnly || i.assigneeMemberIds.some(id => f.myMemberIds.has(id))))
}

/** 전체 편집(제목·내용·심각도·기한·담당자)·삭제 게이트 — 작성자 또는 pmo_admin. UI 노출용(서버 액션이 재검증). */
export function canEditIssue(issue: Pick<Issue, 'createdBy'>, userId: string | null, role: string | null): boolean {
  if (role === 'pmo_admin') return true
  return userId !== null && issue.createdBy !== null && issue.createdBy === userId
}
