// 이슈관리 도메인 — 순수 함수만(I/O 없음). 스펙: docs/superpowers/specs/2026-07-23-issues-mvp-design.md §3.
// 상태 전환의 단일 정본은 STATUS_TRANSITIONS — UI(select 옵션)와 서버 액션(전환 검증)이
// 이 맵만 참조한다. 5번째 상태를 추가할 때 이 파일 + 0041 check 제약만 바꾸면 되게 유지할 것.
import type { IssueMinuteSource } from './issueMinuteSource'
import type { IssueMegaCode, IssueMegaFilter, IssueSourceType } from './issueAnalysis'
import { diffDaysCal } from './dashboard'

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'on_hold'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_SEVERITIES = ['high', 'medium', 'low'] as const
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number]

export interface Issue {
  id: string
  issueNo: number
  /** 보고서 업무키. 0055 이전 미분류 이슈는 null이며 최초 Mega 분류 때 한 번 발급된다. */
  piIssueCode: string | null
  projectId: string
  megaCode: IssueMegaCode | null
  megaSeq: number | null
  /**
   * Major Process 연결(0062). 레거시(0062 이전 분류) 이슈는 null — 편집으로 백필된다.
   * optional 인 이유: 0062 이전에 만들어진 Issue 픽스처·스냅샷과의 호환(생략 = 미연결).
   * 데이터 계층(getIssues·loadIssueAnalysisIssues)은 항상 세 필드를 채워 반환한다.
   */
  majorId?: string | null
  majorSeq?: number | null
  majorName?: string | null
  /**
   * 첨부 개수(0068) — 목록의 클립 배지 전용.
   * optional 인 이유는 majorId 와 같다: 이 타입으로 객체를 만드는 14곳(src 2 + tests 12)이
   * 필수 필드에 전부 깨진다. **getIssues 는 항상 채워 반환하고**, 다른 데이터 계층은 채우지
   * 않는다(분석서 경로가 첨부 조회 실패에 끌려 들어가지 않게). 소비처는 `?? 0` 으로 읽는다.
   */
  attachmentCount?: number
  title: string
  body: string
  status: IssueStatus
  severity: IssueSeverity
  /** 담당자 멤버 id 목록(0042 조인 테이블). 표시 순서는 뷰가 이름순으로 다시 정렬한다. */
  assigneeMemberIds: string[]
  startDate: string | null        // 'YYYY-MM-DD'
  dueDate: string | null          // 'YYYY-MM-DD'
  subProcess: string
  ownerDepartment: string
  relatedSystems: string[]
  sourceType: IssueSourceType | null
  sourceDetail: string
  minuteSources: IssueMinuteSource[]
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

/** 목록의 '남은일수' 강조 경계 — 오늘 포함 7일 이내(D-0~D-7)와 경과분을 빨강으로. */
export const DUE_URGENT_DAYS = 7

/**
 * 오늘 기준 목표일까지 남은 달력일. 미래 양수 · 오늘 0 · 경과 음수(D+N).
 * 목표일 없음·해결됨은 null — 카운트다운 대상이 아니다(isOverdue 와 같은 제외 규칙).
 */
export function dueDaysLeft(issue: Pick<Issue, 'dueDate' | 'status'>, today: string): number | null {
  if (!issue.dueDate || issue.status === 'resolved') return null
  return diffDaysCal(today, issue.dueDate)
}

/** 남은일수 강조 여부 — DUE_URGENT_DAYS 이내(경과 포함). null 은 표시 대상이 아니므로 false. */
export function isDueUrgent(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft <= DUE_URGENT_DAYS
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
  f: {
    status: IssueStatusFilter
    severity: IssueSeverityFilter
    mega: IssueMegaFilter
    mineOnly: boolean
    myMemberIds: ReadonlySet<string>
  },
): Issue[] {
  return issues.filter(i =>
    (f.status === 'all' || i.status === f.status)
    && (f.severity === 'all' || i.severity === f.severity)
    && (f.mega === 'all' || i.megaCode === f.mega)
    && (!f.mineOnly || i.assigneeMemberIds.some(id => f.myMemberIds.has(id))))
}

/** 전체 편집(제목·내용·심각도·기한·담당자)·삭제 게이트 — 작성자 또는 pmo_admin. UI 노출용(서버 액션이 재검증). */
export function canEditIssue(issue: Pick<Issue, 'createdBy'>, userId: string | null, role: string | null): boolean {
  if (role === 'pmo_admin') return true
  return userId !== null && issue.createdBy !== null && issue.createdBy === userId
}
