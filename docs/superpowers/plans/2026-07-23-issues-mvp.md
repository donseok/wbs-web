# 이슈관리 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트별 이슈(리스크/장애물) 관리 메뉴 `/p/[projectId]/issues` — 필터 테이블 + 모달 + KPI 3장 + `?focus=` 딥링크.

**Architecture:** 기존 공지/회의 패턴 1:1 복제. 순수 도메인(`lib/domain/issues.ts`) → 읽기 계층(`lib/data/issues.ts`) → 서버 액션(`app/actions/issues.ts`) → 서버 페이지 + 클라이언트 뷰(`components/issues/`). DB는 `issues` 테이블 1개(0040 마이그레이션, RLS 포함).

**Tech Stack:** Next.js 15 App Router, Supabase(PostgREST + RLS), vitest, Tailwind 토큰 시스템, lucide-react.

**스펙(정본):** `docs/superpowers/specs/2026-07-23-issues-mvp-design.md`

## Global Constraints

- **`git add -A` 절대 금지** — 병렬 세션이 있는 저장소다. 커밋마다 파일을 명시적으로 나열한다.
- 마이그레이션 번호는 **0040** (0039는 `0039_minutes_explorer.sql`이 선점). 적용은 Task 11에서 Supabase Management API로만 — `db push`/pg 직결 금지. **로컬 dev도 프로덕션 DB를 공유**하므로 마이그레이션 적용 전에는 이슈 화면 런타임이 PGRST 오류(빈 목록)로 보이는 게 정상이다.
- 운영 D-CUBE 프로젝트 데이터에 쓰기 검증 금지 — 쓰기 스모크는 전용 테스트 프로젝트에서만.
- DB에는 영문 코드만 저장: status `open|in_progress|resolved|on_hold`, severity `high|medium|low`.
- `updated_at` 트리거는 이 DB에 없다 — 모든 update 페이로드에 `updated_at: new Date().toISOString()` 수동 포함(레포 관례).
- i18n: ko↔en 키 패리티는 `Record<keyof typeof ko, string>`로 컴파일 타임 강제. `nav.issues`만 `dict/common.ts`, 나머지는 `dict/issues.ts`.
- 아이콘은 lucide-react 직접 import(`CircleAlert`). 레거시 `components/ui/Icon.tsx`는 사용 금지.
- PageHero의 `actions`/`heroKpis` prop은 렌더되지 않는 죽은 경로 — KPI·등록 버튼은 본문(IssuesView)에 배치.
- 검증 명령: `npm run test` / `npm run lint` / `npm run build` (lint는 인자 없는 flat config eslint).
- 커밋 메시지는 한국어 관례(`feat(issues): …`) + 마지막 줄 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 도메인 모듈 (순수 함수 + 단위 테스트)

**Files:**
- Create: `src/lib/domain/issues.ts`
- Test: `tests/domain/issues.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 모듈, I/O 없음)
- Produces (이후 태스크 전부가 의존):
  - `type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'on_hold'`
  - `type IssueSeverity = 'high' | 'medium' | 'low'`
  - `interface Issue` (아래 코드 그대로)
  - `ISSUE_STATUSES`, `ISSUE_SEVERITIES`, `STATUS_TRANSITIONS`, `ISSUE_STATUS_META`, `ISSUE_SEVERITY_META`
  - `canTransition(from, to): boolean`, `isOverdue(issue, today): boolean`, `nextResolvedAt(from, to, current, nowIso): string | null`
  - `sortIssues(issues, today): Issue[]`, `summarizeIssues(issues, today): { open; inProgress; overdue }`
  - `filterIssues(issues, f): Issue[]`, `canEditIssue(issue, userId, role): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/issues.test.ts` 전체 내용 (도메인 테스트 관례: 환경 지시자 없음, mock 없음, `Partial` 오버라이드 팩토리, 한글 describe/it — `tests/domain/meetings.test.ts` 형식):

```ts
import { describe, it, expect } from 'vitest'
import {
  ISSUE_STATUSES, ISSUE_SEVERITIES, STATUS_TRANSITIONS,
  canTransition, isOverdue, nextResolvedAt, sortIssues, summarizeIssues, filterIssues, canEditIssue,
  type Issue, type IssueStatus,
} from '@/lib/domain/issues'

function issue(id: string, opts: Partial<Issue> = {}): Issue {
  return {
    id, issueNo: 1, projectId: 'p1', title: `이슈 ${id}`, body: '',
    status: 'open', severity: 'medium', assigneeMemberId: null, dueDate: null,
    resolutionNote: '', resolvedAt: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00+00:00', updatedAt: '2026-07-01T00:00:00+00:00', ...opts,
  }
}
const TODAY = '2026-07-23'

describe('STATUS_TRANSITIONS / canTransition — 전환 맵 전수', () => {
  it('맵은 4개 상태 전부를 키로 갖는다', () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...ISSUE_STATUSES].sort())
  })
  it('허용 전환: open→in_progress/on_hold/resolved, in_progress→open/on_hold/resolved, on_hold→open/in_progress/resolved, resolved→open/in_progress', () => {
    expect(STATUS_TRANSITIONS.open).toEqual(['in_progress', 'on_hold', 'resolved'])
    expect(STATUS_TRANSITIONS.in_progress).toEqual(['open', 'on_hold', 'resolved'])
    expect(STATUS_TRANSITIONS.on_hold).toEqual(['open', 'in_progress', 'resolved'])
    expect(STATUS_TRANSITIONS.resolved).toEqual(['open', 'in_progress'])
  })
  it('거부 전환: 자기 자신·resolved→on_hold', () => {
    for (const s of ISSUE_STATUSES) expect(canTransition(s, s)).toBe(false)
    expect(canTransition('resolved', 'on_hold')).toBe(false)
  })
})

describe('isOverdue — 지연 판정', () => {
  it('기한 경과 + 미해결이면 지연', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-22' }), TODAY)).toBe(true)
  })
  it('기한 당일은 지연 아님(경계)', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-23' }), TODAY)).toBe(false)
  })
  it('resolved 는 기한이 지나도 지연 아님', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-01', status: 'resolved' }), TODAY)).toBe(false)
  })
  it('기한 없음은 지연 아님', () => {
    expect(isOverdue(issue('a'), TODAY)).toBe(false)
  })
  it('on_hold 도 기한 경과면 지연(미해결이므로)', () => {
    expect(isOverdue(issue('a', { dueDate: '2026-07-22', status: 'on_hold' }), TODAY)).toBe(true)
  })
})

describe('nextResolvedAt — resolved 진입/이탈 규칙', () => {
  const NOW = '2026-07-23T09:00:00.000Z'
  it('resolved 진입 시 now', () => {
    expect(nextResolvedAt('open', 'resolved', null, NOW)).toBe(NOW)
  })
  it('resolved 이탈 시 null', () => {
    expect(nextResolvedAt('resolved', 'open', '2026-07-20T00:00:00Z', NOW)).toBeNull()
  })
  it('resolved 무관 전환은 현재값 유지', () => {
    expect(nextResolvedAt('open', 'in_progress', null, NOW)).toBeNull()
    expect(nextResolvedAt('in_progress', 'on_hold', null, NOW)).toBeNull()
  })
})

describe('sortIssues — 미해결 → 지연 → 심각도 → 목표일 → 최신 등록', () => {
  it('resolved 는 항상 마지막', () => {
    const r = sortIssues([issue('done', { status: 'resolved', severity: 'high' }), issue('open1')], TODAY)
    expect(r.map(i => i.id)).toEqual(['open1', 'done'])
  })
  it('미해결 안에서 지연이 먼저', () => {
    const r = sortIssues([issue('later', { dueDate: '2026-08-01' }), issue('over', { dueDate: '2026-07-01' })], TODAY)
    expect(r.map(i => i.id)).toEqual(['over', 'later'])
  })
  it('같은 지연 여부면 심각도 높음 먼저', () => {
    const r = sortIssues([issue('lo', { severity: 'low' }), issue('hi', { severity: 'high' }), issue('mid')], TODAY)
    expect(r.map(i => i.id)).toEqual(['hi', 'mid', 'lo'])
  })
  it('같은 심각도면 목표일 오름차순, 목표일 없음은 뒤', () => {
    const r = sortIssues([issue('none'), issue('aug', { dueDate: '2026-08-10' }), issue('jul', { dueDate: '2026-07-30' })], TODAY)
    expect(r.map(i => i.id)).toEqual(['jul', 'aug', 'none'])
  })
  it('전부 같으면 최신 등록순(createdAt desc)', () => {
    const r = sortIssues([
      issue('old', { createdAt: '2026-07-01T00:00:00+00:00' }),
      issue('new', { createdAt: '2026-07-20T00:00:00+00:00' }),
    ], TODAY)
    expect(r.map(i => i.id)).toEqual(['new', 'old'])
  })
  it('원본 배열을 변경하지 않는다', () => {
    const src = [issue('b', { severity: 'low' }), issue('a', { severity: 'high' })]
    sortIssues(src, TODAY)
    expect(src.map(i => i.id)).toEqual(['b', 'a'])
  })
})

describe('summarizeIssues — KPI 집계', () => {
  it('open/in_progress/지연 3종을 센다 (지연은 상태와 독립 집계)', () => {
    const r = summarizeIssues([
      issue('a'),                                                     // open
      issue('b', { status: 'in_progress', dueDate: '2026-07-01' }),   // in_progress + 지연
      issue('c', { status: 'resolved', dueDate: '2026-07-01' }),      // resolved (지연 아님)
      issue('d', { status: 'on_hold' }),
    ], TODAY)
    expect(r).toEqual({ open: 1, inProgress: 1, overdue: 1 })
  })
  it('빈 배열이면 전부 0', () => {
    expect(summarizeIssues([], TODAY)).toEqual({ open: 0, inProgress: 0, overdue: 0 })
  })
})

describe('filterIssues — 상태·심각도·내 담당', () => {
  const list = [
    issue('a', { status: 'open', severity: 'high', assigneeMemberId: 'm1' }),
    issue('b', { status: 'resolved', severity: 'low', assigneeMemberId: 'm2' }),
    issue('c', { status: 'open', severity: 'low', assigneeMemberId: null }),
  ]
  it('all 필터는 전량 통과', () => {
    expect(filterIssues(list, { status: 'all', severity: 'all', mineOnly: false, myMemberIds: new Set() })).toHaveLength(3)
  })
  it('상태·심각도 AND 결합', () => {
    const r = filterIssues(list, { status: 'open', severity: 'low', mineOnly: false, myMemberIds: new Set() })
    expect(r.map(i => i.id)).toEqual(['c'])
  })
  it('내 담당은 myMemberIds 포함 여부 — 미지정 담당은 제외', () => {
    const r = filterIssues(list, { status: 'all', severity: 'all', mineOnly: true, myMemberIds: new Set(['m1']) })
    expect(r.map(i => i.id)).toEqual(['a'])
  })
})

describe('canEditIssue — 전체 편집/삭제 게이트(UI 노출용)', () => {
  it('pmo_admin 은 항상 가능', () => {
    expect(canEditIssue(issue('a', { createdBy: 'other' }), 'me', 'pmo_admin')).toBe(true)
  })
  it('작성자 본인 가능, 타인 불가', () => {
    expect(canEditIssue(issue('a', { createdBy: 'me' }), 'me', 'team_editor')).toBe(true)
    expect(canEditIssue(issue('a', { createdBy: 'other' }), 'me', 'team_editor')).toBe(false)
  })
  it('비로그인·작성자 미상은 불가', () => {
    expect(canEditIssue(issue('a', { createdBy: 'me' }), null, null)).toBe(false)
    expect(canEditIssue(issue('a', { createdBy: null }), 'me', 'team_editor')).toBe(false)
  })
})

describe('심각도 상수', () => {
  it('ISSUE_SEVERITIES 는 high/medium/low', () => {
    expect([...ISSUE_SEVERITIES]).toEqual(['high', 'medium', 'low'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/issues.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/issues'` 계열 오류.

- [ ] **Step 3: 도메인 모듈 구현**

`src/lib/domain/issues.ts` 전체 내용:

```ts
// 이슈관리 도메인 — 순수 함수만(I/O 없음). 스펙: docs/superpowers/specs/2026-07-23-issues-mvp-design.md §3.
// 상태 전환의 단일 정본은 STATUS_TRANSITIONS — UI(select 옵션)와 서버 액션(전환 검증)이
// 이 맵만 참조한다. 5번째 상태를 추가할 때 이 파일 + 0040 check 제약만 바꾸면 되게 유지할 것.

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
  assigneeMemberId: string | null
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

/** KPI 3장: 열림 / 진행중 / 지연. 지연은 상태와 독립 집계(open·in_progress·on_hold 모두 포함 가능). */
export function summarizeIssues(issues: Issue[], today: string): { open: number; inProgress: number; overdue: number } {
  let open = 0
  let inProgress = 0
  let overdue = 0
  for (const i of issues) {
    if (i.status === 'open') open++
    if (i.status === 'in_progress') inProgress++
    if (isOverdue(i, today)) overdue++
  }
  return { open, inProgress, overdue }
}

export type IssueStatusFilter = 'all' | IssueStatus
export type IssueSeverityFilter = 'all' | IssueSeverity

/** 필터 칩 적용. mineOnly 는 담당자가 내 멤버 id 집합에 속하는 이슈만(미지정 담당 제외). */
export function filterIssues(
  issues: Issue[],
  f: { status: IssueStatusFilter; severity: IssueSeverityFilter; mineOnly: boolean; myMemberIds: ReadonlySet<string> },
): Issue[] {
  return issues.filter(i =>
    (f.status === 'all' || i.status === f.status)
    && (f.severity === 'all' || i.severity === f.severity)
    && (!f.mineOnly || (i.assigneeMemberId !== null && f.myMemberIds.has(i.assigneeMemberId))))
}

/** 전체 편집(제목·내용·심각도·기한·담당자)·삭제 게이트 — 작성자 또는 pmo_admin. UI 노출용(서버 액션이 재검증). */
export function canEditIssue(issue: Pick<Issue, 'createdBy'>, userId: string | null, role: string | null): boolean {
  if (role === 'pmo_admin') return true
  return userId !== null && issue.createdBy !== null && issue.createdBy === userId
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/issues.test.ts`
Expected: PASS (전체 그린).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/issues.ts tests/domain/issues.test.ts
git commit -m "feat(issues): 이슈 도메인 모듈 — 상태 전환 맵·지연 판정·정렬·집계·필터

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: i18n 사전

**Files:**
- Create: `src/lib/i18n/dict/issues.ts`
- Modify: `src/lib/i18n/dict/common.ts` (nav 블록에 `nav.issues` — ko/en 두 곳)
- Modify: `src/lib/i18n/dict.ts` (import 1곳 + ko/en 병합 2곳)

**Interfaces:**
- Consumes: 없음
- Produces: `DictKey`에 `issue.*` 전체 키와 `nav.issues` 추가 — Task 6~9의 모든 `t()` 호출이 의존. 키 목록은 아래 코드가 정본.

- [ ] **Step 1: `src/lib/i18n/dict/issues.ts` 생성**

```ts
// issues 화면 사전 — 이 파일은 issues 영역 담당만 수정한다.
// en은 Record<keyof ko, string> 타입으로 ko와의 키 패리티를 컴파일 타임에 강제한다.
// nav.issues 만 예외로 dict/common.ts 의 nav 블록에 있다(전 nav.* 키 집중 관례).
export const issuesKo = {
  'issue.heroTitleSuffix': '이슈관리',
  'issue.heroDesc': '프로젝트 리스크와 장애물을 담당자·기한과 함께 추적하고 해결까지 관리하세요.',
  'issue.projectFallback': '프로젝트',
  'issue.kpi.open': '열림',
  'issue.kpi.openSub': '조치 대기 이슈',
  'issue.kpi.inProgress': '진행중',
  'issue.kpi.inProgressSub': '조치 진행 이슈',
  'issue.kpi.overdue': '지연',
  'issue.kpi.overdueSub': '기한 경과 미해결',
  'issue.new': '이슈 등록',
  'issue.edit': '이슈 수정',
  'issue.listTitle': '이슈 목록',
  'issue.unitCount': '건',
  'issue.filter.all': '전체',
  'issue.filter.mine': '내 담당',
  'issue.status.open': '열림',
  'issue.status.in_progress': '진행중',
  'issue.status.resolved': '해결',
  'issue.status.on_hold': '보류',
  'issue.severity.high': '높음',
  'issue.severity.medium': '보통',
  'issue.severity.low': '낮음',
  'issue.col.no': '번호',
  'issue.col.title': '제목',
  'issue.col.status': '상태',
  'issue.col.severity': '심각도',
  'issue.col.assignee': '담당자',
  'issue.col.due': '목표일',
  'issue.col.created': '등록',
  'issue.overdueBadge': '지연',
  'issue.unassigned': '미지정',
  'issue.noDue': '기한 없음',
  'issue.empty.title': '등록된 이슈가 없습니다',
  'issue.empty.desc': '프로젝트에서 발생한 리스크나 장애물을 등록해 추적을 시작하세요.',
  'issue.emptyFiltered.title': '조건에 맞는 이슈가 없습니다',
  'issue.emptyFiltered.desc': '필터를 조정하거나 전체 보기로 전환해 보세요.',
  'issue.form.title': '제목',
  'issue.form.titlePh': '이슈를 한 줄로 요약하세요',
  'issue.form.body': '내용',
  'issue.form.bodyPh': '배경, 영향, 상세 내용을 적어주세요',
  'issue.form.severity': '심각도',
  'issue.form.assignee': '담당자',
  'issue.form.due': '목표 해결일',
  'issue.form.dueHint': '과거 날짜를 지정하면 즉시 지연으로 표시됩니다.',
  'issue.form.save': '저장',
  'issue.form.cancel': '취소',
  'issue.detail.body': '내용',
  'issue.detail.progress': '진행 업데이트',
  'issue.detail.status': '상태 변경',
  'issue.detail.note': '조치/해결 경과',
  'issue.detail.notePh': '지금까지의 조치 내용과 경과를 기록하세요',
  'issue.detail.saveProgress': '진행 저장',
  'issue.detail.reporter': '작성자',
  'issue.detail.createdAt': '등록일',
  'issue.detail.resolvedAt': '해결일',
  'issue.delete.title': '이슈 삭제',
  'issue.delete.confirmPrefix': '다음 이슈를 삭제합니다. 되돌릴 수 없습니다:',
  'issue.delete.run': '삭제',
  'issue.delete.cancel': '취소',
  'issue.err.titleRequired': '제목을 입력하세요.',
  'issue.err.saveFailed': '저장에 실패했습니다.',
  'issue.err.deleteFailed': '삭제에 실패했습니다.',
} as const

export const issuesEn: Record<keyof typeof issuesKo, string> = {
  'issue.heroTitleSuffix': 'Issues',
  'issue.heroDesc': 'Track project risks and blockers with owners and due dates, all the way to resolution.',
  'issue.projectFallback': 'Project',
  'issue.kpi.open': 'Open',
  'issue.kpi.openSub': 'Awaiting action',
  'issue.kpi.inProgress': 'In progress',
  'issue.kpi.inProgressSub': 'Being worked on',
  'issue.kpi.overdue': 'Overdue',
  'issue.kpi.overdueSub': 'Past due, unresolved',
  'issue.new': 'New issue',
  'issue.edit': 'Edit issue',
  'issue.listTitle': 'Issue list',
  'issue.unitCount': '',
  'issue.filter.all': 'All',
  'issue.filter.mine': 'Mine',
  'issue.status.open': 'Open',
  'issue.status.in_progress': 'In progress',
  'issue.status.resolved': 'Resolved',
  'issue.status.on_hold': 'On hold',
  'issue.severity.high': 'High',
  'issue.severity.medium': 'Medium',
  'issue.severity.low': 'Low',
  'issue.col.no': 'No.',
  'issue.col.title': 'Title',
  'issue.col.status': 'Status',
  'issue.col.severity': 'Severity',
  'issue.col.assignee': 'Assignee',
  'issue.col.due': 'Due',
  'issue.col.created': 'Created',
  'issue.overdueBadge': 'Overdue',
  'issue.unassigned': 'Unassigned',
  'issue.noDue': 'No due date',
  'issue.empty.title': 'No issues yet',
  'issue.empty.desc': 'Register risks or blockers from this project to start tracking.',
  'issue.emptyFiltered.title': 'No issues match the filters',
  'issue.emptyFiltered.desc': 'Adjust the filters or switch back to All.',
  'issue.form.title': 'Title',
  'issue.form.titlePh': 'Summarize the issue in one line',
  'issue.form.body': 'Details',
  'issue.form.bodyPh': 'Background, impact, and details',
  'issue.form.severity': 'Severity',
  'issue.form.assignee': 'Assignee',
  'issue.form.due': 'Target resolution date',
  'issue.form.dueHint': 'A past date will immediately show as overdue.',
  'issue.form.save': 'Save',
  'issue.form.cancel': 'Cancel',
  'issue.detail.body': 'Details',
  'issue.detail.progress': 'Progress update',
  'issue.detail.status': 'Change status',
  'issue.detail.note': 'Resolution notes',
  'issue.detail.notePh': 'Record actions taken and current progress',
  'issue.detail.saveProgress': 'Save progress',
  'issue.detail.reporter': 'Reporter',
  'issue.detail.createdAt': 'Created',
  'issue.detail.resolvedAt': 'Resolved',
  'issue.delete.title': 'Delete issue',
  'issue.delete.confirmPrefix': 'This issue will be permanently deleted:',
  'issue.delete.run': 'Delete',
  'issue.delete.cancel': 'Cancel',
  'issue.err.titleRequired': 'Title is required.',
  'issue.err.saveFailed': 'Failed to save.',
  'issue.err.deleteFailed': 'Failed to delete.',
}
```

- [ ] **Step 2: `dict/common.ts`의 nav 블록에 키 추가**

`common.ts`를 열어 ko의 `'nav.weekly'` 줄 **위(칸반 다음이 아니라 kanban 키 뒤가 정위치 — 실제 파일에서 `'nav.kanban'` 줄 바로 아래)**에 추가:

```ts
  'nav.issues': '이슈관리',
```

en 쪽 대응 위치(`'nav.kanban'` 줄 바로 아래)에 추가:

```ts
  'nav.issues': 'Issues',
```

(정확한 삽입 위치는 파일을 열어 기존 nav 키 나열 순서를 확인하고 kanban 바로 다음에 넣는다 — 사이드바 메뉴 순서와 일치시키기 위함.)

- [ ] **Step 3: `dict.ts` 병합 등록 (3곳)**

import 블록 마지막 줄(`import { minutesKo, minutesEn } from './dict/minutes'`) 뒤에:

```ts
import { issuesKo, issuesEn } from './dict/issues'
```

`ko: { ... }` 병합 마지막(`...minutesKo,`) 뒤에 `...issuesKo,` / `en: { ... }` 병합 마지막(`...minutesEn,`) 뒤에 `...issuesEn,` 추가.

- [ ] **Step 4: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (en 키 누락 시 여기서 컴파일 에러).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n/dict/issues.ts src/lib/i18n/dict/common.ts src/lib/i18n/dict.ts
git commit -m "feat(issues): i18n 사전 — issue.* 네임스페이스 + nav.issues(common)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 마이그레이션 0040 (파일 작성만 — 적용은 Task 11)

**Files:**
- Create: `supabase/migrations/0040_issues.sql`
- Create: `supabase/migrations/0040_issues_rollback.sql`

**Interfaces:**
- Consumes: `projects`, `project_members`, `auth.users`, `app_role()` (기존 DB 객체)
- Produces: `issues` 테이블 — Task 4 데이터 계층의 select 컬럼 목록과 1:1 대응. RLS: select=전체 / insert=본인+멤버 / update=멤버 백스톱 / delete=작성자 or pmo.

- [ ] **Step 1: `0040_issues.sql` 작성**

```sql
-- 이슈관리 (프로젝트 스코프) — 리스크/장애물 트래킹. 스펙: docs/superpowers/specs/2026-07-23-issues-mvp-design.md §2.
-- 권한: 읽기 = 인증 사용자 전체(0013 회의 관례) / 생성 = 멤버십 보유자 본인 /
--       수정 = 멤버 전체 백스톱 — 행 단위 RLS 로는 열 단위 요구(상태·담당자·조치메모는 멤버 전체,
--       제목·내용·심각도·기한은 작성자/pmo_admin)를 표현할 수 없어 의도적으로 완화한다.
--       세분화는 서버 액션(src/app/actions/issues.ts)이 fail-closed 로 강제 / 삭제 = 작성자 또는 pmo_admin.
-- 멱등: SQL Editor 반복 실행 안전(create table if not exists / create index if not exists /
--       drop policy if exists 선행).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0030/0034/0038 과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다(0027 PGRST 사고 교훈) —
--       테이블이 없는 상태로 getIssues 가 돌면 매 요청 PGRST 오류가 로그를 오염시킨다.
-- 롤백: 0040_issues_rollback.sql (등록된 이슈 전량 + issue_no 발번 이력 소실 — 롤백 파일 헤더 경고 참조).
-- 주의: RLS 헬퍼는 public.app_role() (0012/0013 에서 생성, memberships.role 조회). 재정의하지 말 것.
--       updated_at 트리거 없음 — 레포 관례(0023/0030/0038)대로 앱이 직접 갱신한다
--       (AI 인덱스 신선도 가드의 입력이므로 쓰기 액션마다 갱신 필수).

-- ── 1) 복합 FK 전제: project_members(id, project_id) 유니크 인덱스 ──
-- 0032 에서 이미 생성됨(프로덕션 적용 확인) — 신규/미적용 DB 재현을 위해 같은 이름으로
-- 방어적 재선언(멱등 no-op). 이 인덱스가 없으면 아래 복합 FK 생성이 실패한다.
create unique index if not exists project_members_id_project_uidx
  on public.project_members (id, project_id);

-- ── 2) 이슈 테이블 ──
-- issue_no 는 0031(ai_index_jobs)/0038(llm_profiles) 관례의 identity bigint — 표시 "#12".
-- 시퀀스 발번이라 동시 등록에도 중복이 없다. 소급 발번 불가 → day-one 필수(스펙 §2).
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  issue_no bigint generated by default as identity unique,
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'open'
    check (status in ('open','in_progress','resolved','on_hold')),
  severity text not null default 'medium'
    check (severity in ('high','medium','low')),
  assignee_member_id uuid,
  due_date date,
  resolution_note text not null default '',
  resolved_at timestamptz,                                     -- resolved 진입 시각. 소급 복원 불가 → day-one
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,                                        -- 탈퇴 후 표시용 스냅샷 (0013 회의 관례)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),               -- AI 인덱스 신선도 가드의 필수 입력 (0031/0033 접점 전제)
  -- 타 프로젝트 멤버 담당 혼입 DB 차단 (0032 근태 선례의 유니크 인덱스 재사용).
  -- 주의: 컬럼 지정 SET NULL 구문 필수 — 무지정 SET NULL 은 NOT NULL project_id 까지
  -- null 시도되어 멤버 삭제가 런타임 실패한다. 프로덕션 PG 17.6 실측으로 구문 사용 가능 확인.
  constraint issues_assignee_project_fk
    foreign key (assignee_member_id, project_id)
    references project_members (id, project_id)
    on delete set null (assignee_member_id)
);

create index if not exists issues_project_idx on issues(project_id, created_at desc);

-- ── 3) RLS (enable 이 전제 — 누락 시 기본 GRANT 로 authenticated 읽기/쓰기가 그대로 열린다) ──
alter table issues enable row level security;

-- 읽기 전체 (앱 관례 — 0013 과 동일)
drop policy if exists read_all_issues on issues;
create policy read_all_issues on issues for select to authenticated using (true);

-- 생성: 본인 + 멤버십 보유자 (0013 과 동일)
drop policy if exists insert_own_issues on issues;
create policy insert_own_issues on issues
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

-- 수정: 멤버 전체 백스톱 — 0013 의 작성자 한정과 다른 의도적 완화(헤더 주석 참조).
-- 진행 필드(상태·담당자·조치메모) vs 전체 편집의 세분화는 서버 액션이 담당한다.
drop policy if exists member_update_issues on issues;
create policy member_update_issues on issues
  for update to authenticated
  using (app_role() is not null)
  with check (app_role() is not null);

-- 삭제: 작성자 또는 pmo_admin (0013 과 동일)
drop policy if exists delete_own_issues on issues;
create policy delete_own_issues on issues
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
```

- [ ] **Step 2: `0040_issues_rollback.sql` 작성**

```sql
-- 0040 롤백 — issues 테이블을 제거해 0040 적용 이전 상태로 되돌린다.
--
-- 경고(데이터 소실): 등록된 모든 이슈(제목/본문/상태/조치 경과/resolved_at)가 함께 사라진다.
--   issue_no 발번 시퀀스도 테이블과 함께 제거되므로 재적용 시 #1 부터 다시 시작한다 —
--   소급 발번 불가(스펙 §2). 필요하면 drop 전에 백업할 것.
-- 순서: 코드가 이 테이블을 읽는 상태에서 먼저 drop 하면 getIssues 가 매 요청 PGRST 오류를
--       로그에 남긴다(읽기 계층은 실패 시 [] 폴백이라 화면은 죽지 않는다). 가능하면 코드 롤백 후 적용할 것.
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (정방향과 동일 경로,
--       db push 금지). 멱등: if exists 라 반복 실행 안전.
-- 주의: project_members_id_project_uidx 는 drop 하지 않는다 — 0032 소유이며
--       attendance_member_project_fk 가 의존한다(drop 시도 시 dependent objects 오류).

-- 정책 drop 은 테이블 존재를 전제한다(drop policy if exists 의 if exists 는 정책만 커버 —
-- 테이블이 이미 없으면 42P01). 재실행 안전을 위해 to_regclass 로 감싼다.
do $$
begin
  if to_regclass('public.issues') is not null then
    execute 'drop policy if exists read_all_issues on issues';
    execute 'drop policy if exists insert_own_issues on issues';
    execute 'drop policy if exists member_update_issues on issues';
    execute 'drop policy if exists delete_own_issues on issues';
  end if;
end $$;

drop table if exists issues;
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/0040_issues.sql supabase/migrations/0040_issues_rollback.sql
git commit -m "feat(issues): 0040 issues 테이블 + RLS 마이그레이션(롤백 동봉)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 데이터 계층 (읽기)

**Files:**
- Create: `src/lib/data/issues.ts`

**Interfaces:**
- Consumes: `createServerClient`(`@/lib/supabase/server`), `Issue`(`@/lib/domain/issues`)
- Produces: `getIssues(projectId: string): Promise<Issue[]>` — cache() 래핑, 실패 시 `[]`. Task 6 페이지가 호출. 담당자 이름은 여기서 조인하지 않는다(페이지가 병렬 로드하는 `getProjectMembers` 결과를 뷰에서 Map 병합 — 왕복 0회 추가).

- [ ] **Step 1: 구현**

`src/lib/data/issues.ts` 전체 내용:

```ts
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Issue, IssueSeverity, IssueStatus } from '@/lib/domain/issues'

/**
 * 프로젝트 이슈 목록 — DB 는 등록순(최신 먼저)으로만 가져오고, 표시 정렬은 도메인
 * sortIssues 가 담당한다. 실패 시 [] + 로그 (읽기 계층 관례 — silent-empty 금지, 로그 필수).
 * 담당자 이름은 여기서 조인하지 않는다: 페이지가 getProjectMembers 를 병렬 로드하므로
 * 뷰에서 Map 병합이 왕복 0회 추가다 (FK 임베드는 관계 미탐지 시 부모 쿼리 전체가 죽는다).
 */
export const getIssues = cache(async (projectId: string): Promise<Issue[]> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issues')
    .select('id, issue_no, project_id, title, body, status, severity, assignee_member_id, due_date, resolution_note, resolved_at, created_by, created_by_name, created_at, updated_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) console.error('[getIssues] 조회 실패:', error.message)

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    issueNo: Number(r.issue_no),
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    status: r.status as IssueStatus,
    severity: r.severity as IssueSeverity,
    assigneeMemberId: (r.assignee_member_id as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    resolutionNote: (r.resolution_note as string) ?? '',
    resolvedAt: (r.resolved_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
})
```

- [ ] **Step 2: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/data/issues.ts
git commit -m "feat(issues): 읽기 데이터 계층 getIssues

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 서버 액션 + 게이트 테스트

**Files:**
- Create: `src/app/actions/issues.ts`
- Test: `tests/actions/issues-gate.test.ts`

**Interfaces:**
- Consumes: `getMembership`/`getSession`(`@/lib/auth`), `createServerClient`, `displayNameFrom`(`@/lib/domain/display-name`), 도메인 `ISSUE_SEVERITIES`/`canTransition`/`nextResolvedAt`/`IssueStatus`/`IssueSeverity`
- Produces (Task 8 모달이 호출):
  - `interface IssueInput { title: string; body: string; severity: IssueSeverity; assigneeMemberId: string | null; dueDate: string | null }`
  - `interface IssueProgressPatch { status?: IssueStatus; assigneeMemberId?: string | null; resolutionNote?: string }`
  - `interface IssueActionResult { ok: boolean; error?: string; id?: string; conflict?: boolean }`
  - `createIssue(projectId, input)`, `updateIssue(issueId, input)`, `updateIssueProgress(issueId, patch)`, `deleteIssue(issueId)` — 전부 `Promise<IssueActionResult>`

- [ ] **Step 1: 실패하는 게이트 테스트 작성**

`tests/actions/issues-gate.test.ts` 전체 내용 (announcement-from-meeting-gate 패턴 — 게이트 전 DB 접근 금지 + 체이너블 스텁):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 게이트 통과 전에는 DB 클라이언트가 만들어지면 안 된다. 각 테스트가 state.client 를
// 지정하지 않으면 호출 즉시 throw — "게이트 전 DB 접근 없음"을 기본값으로 강제한다.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { createServerClient } = vi.hoisted(() => ({
  createServerClient: vi.fn(async () => {
    if (state.client === undefined) throw new Error('게이트 통과 전 createServerClient 호출 금지')
    return state.client
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { getMembership, getSession } from '@/lib/auth'
import { createIssue, updateIssue, updateIssueProgress, deleteIssue } from '@/app/actions/issues'

const MEMBER = { role: 'team_editor', teamCode: 'PMO', teamId: 't1' } as const
const USER = { id: 'me', email: 'me@x.com', user_metadata: {} } as const

const INPUT = { title: '테스트 이슈', body: '', severity: 'medium', assigneeMemberId: null, dueDate: null } as const

/** 선검증 조회(maybeSingle) 스텁 — from().select().eq().maybeSingle() 체인만 지원. */
function sbWithCurrent(current: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: current })) })) })),
      update: vi.fn(() => { throw new Error('게이트 전 update 금지') }),
      delete: vi.fn(() => { throw new Error('게이트 전 delete 금지') }),
      insert: vi.fn(() => { throw new Error('게이트 전 insert 금지') }),
      ...extra,
    })),
  }
}

beforeEach(() => {
  state.client = undefined
  createServerClient.mockClear()
  vi.mocked(getMembership).mockReset()
  vi.mocked(getSession).mockReset()
})

describe('멤버십 게이트 — 비멤버는 전부 거부 + DB 무접근', () => {
  it.each([
    ['createIssue', () => createIssue('p1', { ...INPUT })],
    ['updateIssue', () => updateIssue('i1', { ...INPUT })],
    ['updateIssueProgress', () => updateIssueProgress('i1', { status: 'in_progress' })],
    ['deleteIssue', () => deleteIssue('i1')],
  ] as const)('%s: 멤버십 없음 → ok:false, DB 미호출', async (_name, run) => {
    vi.mocked(getMembership).mockResolvedValue(null)
    const res = await run()
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
})

describe('작성자/pmo 게이트 — updateIssue·deleteIssue', () => {
  it('작성자도 pmo도 아니면 권한 없음 (선검증 조회까지만, update/delete 미호출)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other' })
    const up = await updateIssue('i1', { ...INPUT })
    expect(up).toMatchObject({ ok: false, error: '권한 없음' })
    const del = await deleteIssue('i1')
    expect(del).toMatchObject({ ok: false, error: '권한 없음' })
  })
  it('이슈가 없으면 안내 반환', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent(null)
    const res = await updateIssue('i1', { ...INPUT })
    expect(res.ok).toBe(false)
  })
})

describe('updateIssueProgress — 전환 검증 + CAS', () => {
  it('전환 맵에 없는 전환은 거부 (resolved→on_hold)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = sbWithCurrent({ project_id: 'p1', created_by: 'other', status: 'resolved', resolved_at: '2026-07-20T00:00:00Z' })
    const res = await updateIssueProgress('i1', { status: 'on_hold' })
    expect(res.ok).toBe(false)
  })
  it('CAS 0행이면 conflict:true (다른 사용자 선변경)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    state.client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { project_id: 'p1', created_by: 'other', status: 'open', resolved_at: null } })) })) })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) })),
        })),
      })),
    }
    const res = await updateIssueProgress('i1', { status: 'in_progress' })
    expect(res).toMatchObject({ ok: false, conflict: true })
  })
})

describe('입력 검증 — createIssue', () => {
  it('빈 제목 거부 (게이트 통과 후에도 DB insert 미도달)', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createIssue('p1', { ...INPUT, title: '   ' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
  it('잘못된 날짜 형식 거부', async () => {
    vi.mocked(getMembership).mockResolvedValue(MEMBER as never)
    vi.mocked(getSession).mockResolvedValue(USER as never)
    const res = await createIssue('p1', { ...INPUT, dueDate: '2026-02-30' })
    expect(res.ok).toBe(false)
    expect(createServerClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/issues-gate.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions/issues'`.

- [ ] **Step 3: 액션 구현**

`src/app/actions/issues.ts` 전체 내용:

```ts
'use server'
// 이슈 쓰기 액션 — 전부 세션+멤버십 fail-closed. RLS 는 "멤버면 수정 가능" 백스톱까지만
// 보장하므로(0040 헤더 참조) 진행 필드 vs 전체 편집의 세분화는 여기서 강제한다.
// updated_at 트리거 없음 — 모든 update 페이로드에 수동 포함(레포 관례).
import { createServerClient } from '@/lib/supabase/server'
import { getMembership, getSession } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  ISSUE_SEVERITIES, canTransition, nextResolvedAt,
  type IssueSeverity, type IssueStatus,
} from '@/lib/domain/issues'

export interface IssueActionResult {
  ok: boolean
  error?: string
  id?: string
  /** CAS 0행 — 다른 사용자가 먼저 상태를 바꿨다. 클라이언트는 router.refresh() 후 안내. */
  conflict?: boolean
}

export interface IssueInput {
  title: string
  body: string
  severity: IssueSeverity
  assigneeMemberId: string | null
  dueDate: string | null
}

export interface IssueProgressPatch {
  status?: IssueStatus
  assigneeMemberId?: string | null
  resolutionNote?: string
}

const TITLE_MAX = 200
const TEXT_MAX = 20000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 형식 + 실재성(2026-02-30 반려) — announcements isValidDate 관례. */
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function validateInput(input: IssueInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > TITLE_MAX) return `제목은 ${TITLE_MAX}자 이하여야 합니다.`
  if (input.body.length > TEXT_MAX) return `내용은 ${TEXT_MAX}자 이하여야 합니다.`
  if (!ISSUE_SEVERITIES.includes(input.severity)) return '잘못된 심각도입니다.'
  // 과거 날짜는 허용(즉시 지연 표시 안내는 폼 몫) — 형식·실재성만 검증
  if (input.dueDate !== null && !isValidDate(input.dueDate)) return '목표 해결일 날짜 형식이 올바르지 않습니다.'
  return null
}

function revalidateIssues(projectId: string) {
  revalidatePath(`/p/${projectId}/issues`)
}

export async function createIssue(projectId: string, input: IssueInput): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issues')
    .insert({
      project_id: projectId,
      title: input.title.trim(),
      body: input.body,
      severity: input.severity,
      // 담당자-프로젝트 정합은 0040 복합 FK 가 DB 에서 이중 방어(타 프로젝트 멤버면 FK 위반)
      assignee_member_id: input.assigneeMemberId,
      due_date: input.dueDate,
      created_by: user.id,
      created_by_name: displayNameFrom(user.user_metadata, user.email),
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(projectId)
  return { ok: true, id: data.id as string }
}

/** 전체 편집(제목·내용·심각도·기한·담당자) — 작성자 또는 pmo_admin 만. */
export async function updateIssue(issueId: string, input: IssueInput): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const err = validateInput(input)
  if (err) return { ok: false, error: err }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  // 소유권 선검증(RLS 와 동일 — 0행 무음 성공 방지, meetings 관례)
  const { data: cur } = await sb.from('issues').select('project_id, created_by').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb
    .from('issues')
    .update({
      title: input.title.trim(),
      body: input.body,
      severity: input.severity,
      assignee_member_id: input.assigneeMemberId,
      due_date: input.dueDate,
      updated_at: new Date().toISOString(),
      // created_by / status / resolution_note 는 여기서 SET 하지 않음(전자 불변, 후자는 진행 액션 전용)
    })
    .eq('id', issueId)
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}

/** 진행 업데이트(상태·담당자·조치메모) — 멤버 전체. 상태 변경은 전환 맵 검증 + CAS. */
export async function updateIssueProgress(issueId: string, patch: IssueProgressPatch): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (patch.status === undefined && patch.assigneeMemberId === undefined && patch.resolutionNote === undefined) {
    return { ok: false, error: '변경할 내용이 없습니다.' }
  }
  if (patch.resolutionNote !== undefined && patch.resolutionNote.length > TEXT_MAX) {
    return { ok: false, error: `조치 메모는 ${TEXT_MAX}자 이하여야 합니다.` }
  }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by, status, resolved_at').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const from = cur.status as IssueStatus

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.assigneeMemberId !== undefined) payload.assignee_member_id = patch.assigneeMemberId
  if (patch.resolutionNote !== undefined) payload.resolution_note = patch.resolutionNote
  if (patch.status !== undefined) {
    if (!canTransition(from, patch.status)) {
      return { ok: false, error: '허용되지 않는 상태 전환입니다. 화면을 새로고침해 주세요.' }
    }
    payload.status = patch.status
    payload.resolved_at = nextResolvedAt(from, patch.status, (cur.resolved_at as string | null) ?? null, new Date().toISOString())
  }

  if (patch.status !== undefined) {
    // CAS: 선검증 시점의 상태와 같을 때만 반영. 0행 = 그새 다른 사용자가 바꿈(또는 삭제됨).
    // .select() 필수 — RLS/0행은 error 없이 빈 배열이라 그대로 두면 실패가 성공으로 둔갑한다(wbs.ts 관례).
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .eq('status', from)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) {
      return { ok: false, conflict: true, error: '다른 사용자가 먼저 변경했거나 이슈가 삭제되었습니다. 최신 상태로 새로고침합니다.' }
    }
  } else {
    const { data: updated, error } = await sb
      .from('issues')
      .update(payload)
      .eq('id', issueId)
      .select('id')
    if (error) return { ok: false, error: error.message }
    if (!updated?.length) return { ok: false, error: '이슈가 삭제되어 저장할 수 없습니다.' }
  }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}

export async function deleteIssue(issueId: string): Promise<IssueActionResult> {
  const m = await getMembership()
  if (!m) return { ok: false, error: '로그인 필요' }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }

  const sb = await createServerClient()
  const { data: cur } = await sb.from('issues').select('project_id, created_by').eq('id', issueId).maybeSingle()
  if (!cur) return { ok: false, error: '이슈를 찾을 수 없습니다.' }
  const isOwner = (cur.created_by as string | null) === user.id
  if (!isOwner && m.role !== 'pmo_admin') return { ok: false, error: '권한 없음' }

  const { error } = await sb.from('issues').delete().eq('id', issueId).select('id').single()
  if (error) return { ok: false, error: error.message }
  revalidateIssues(cur.project_id as string)
  return { ok: true }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/issues-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/issues.ts tests/actions/issues-gate.test.ts
git commit -m "feat(issues): 서버 액션 4종(생성·전체수정·진행 CAS·삭제) + 게이트 테스트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 이슈 모달 3종

**Files:**
- Create: `src/components/issues/IssueModals.tsx`

**Interfaces:**
- Consumes: Task 5 액션 4종, Task 1 도메인(META·STATUS_TRANSITIONS·canEditIssue·isOverdue), `Modal`/`useLocale`/`sortByKoreanName`, `ProjectMember`(`@/lib/domain/types`)
- Produces (Task 7 IssuesView 가 사용):
  - `IssueDetailModal({ issue, members, memberName, canEdit, today, onClose, onEdit, onDelete }): JSX` — issue 가 null 이면 닫힘
  - `IssueFormModal({ open, onClose, projectId, initial, members }): JSX` — initial null 이면 신규
  - `DeleteIssueModal({ issue, onClose }): JSX` — issue 가 null 이면 닫힘

- [ ] **Step 1: 구현**

`src/components/issues/IssueModals.tsx` 전체 내용:

```tsx
'use client'
// 이슈 모달 3종 — 상세(진행 편집 포함) / 등록·수정 폼 / 삭제 확인.
// 공지 AnnouncementsView 의 3모달 구조를 파일 분리로 복제(스펙 §6).
// 진행 필드(상태·담당자·조치메모)는 멤버 전체, 전체 편집·삭제 버튼은 canEdit(작성자/pmo)만 노출 —
// 서버 액션이 같은 규칙을 재검증한다(UI 노출은 편의일 뿐 보안 경계가 아님).
import { useEffect, useMemo, useState, useTransition } from 'react'
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

/** 담당자 단일 선택 — 회의 폼의 카테고리 셀렉트 관례(app-input). 이름 · 팀코드 병기, 가나다순. */
function AssigneeSelect({
  members, value, onChange,
}: {
  members: ProjectMember[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const { t } = useLocale()
  const sorted = useMemo(() => sortByKoreanName(members, m => m.name), [members])
  return (
    <select
      className="app-input"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">{t('issue.unassigned')}</option>
      {sorted.map(m => (
        <option key={m.id} value={m.id}>{m.teamCode ? `${m.name} · ${m.teamCode}` : m.name}</option>
      ))}
    </select>
  )
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
  const [assignee, setAssignee] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 대상 이슈가 바뀔 때마다 진행 편집 폼을 현재값으로 리셋
  useEffect(() => {
    if (!issue) return
    setStatus(issue.status)
    setAssignee(issue.assigneeMemberId)
    setNote(issue.resolutionNote)
    setError(null)
  }, [issue])

  if (!issue) return <Modal open={false} onClose={onClose}><span /></Modal>

  const overdue = isOverdue(issue, today)
  const statusOptions: IssueStatus[] = [issue.status, ...STATUS_TRANSITIONS[issue.status]]
  const dirty = status !== issue.status || assignee !== issue.assigneeMemberId || note !== issue.resolutionNote

  function saveProgress() {
    if (!issue || !dirty) return
    const patch = {
      ...(status !== issue.status ? { status } : {}),
      ...(assignee !== issue.assigneeMemberId ? { assigneeMemberId: assignee } : {}),
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
      open
      onClose={onClose}
      eyebrow={`#${issue.issueNo}`}
      title={issue.title}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <button onClick={onEdit} className="btn-ghost inline-flex items-center gap-1.5 text-xs">
                  <Pencil className="h-3.5 w-3.5" />{t('issue.edit')}
                </button>
                <button onClick={onDelete} className="btn-ghost inline-flex items-center gap-1.5 text-xs text-delayed">
                  <Trash2 className="h-3.5 w-3.5" />{t('issue.delete.run')}
                </button>
              </>
            )}
          </div>
          <button onClick={saveProgress} disabled={pending || !dirty} className="btn-primary text-xs disabled:opacity-50">
            {t('issue.detail.saveProgress')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={issue.status} />
          <SeverityChip severity={issue.severity} />
          {overdue && <span className="chip bg-delayed-weak text-delayed">{t('issue.overdueBadge')}</span>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{t('issue.col.assignee')}</dt>
            <dd className="mt-0.5 text-ink">{memberName(issue.assigneeMemberId) ?? t('issue.unassigned')}</dd>
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
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.assignee')}</span>
              <AssigneeSelect members={members} value={assignee} onChange={setAssignee} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.detail.note')}</span>
            <textarea
              className="app-input min-h-[96px] resize-y"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('issue.detail.notePh')}
            />
          </label>
          {error && <ErrorBox message={error} />}
        </div>
      </div>
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
  const [assignee, setAssignee] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isEdit = initial !== null

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setBody(initial?.body ?? '')
    setSeverity(initial?.severity ?? 'medium')
    setAssignee(initial?.assigneeMemberId ?? null)
    setDueDate(initial?.dueDate ?? '')
    setError(null)
  }, [open, initial])

  function submit() {
    if (!title.trim()) {
      setError(t('issue.err.titleRequired'))
      return
    }
    const input = { title: title.trim(), body, severity, assigneeMemberId: assignee, dueDate: dueDate || null }
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
          <button onClick={onClose} className="btn-ghost text-xs">{t('issue.form.cancel')}</button>
          <button onClick={submit} disabled={pending} className="btn-primary text-xs disabled:opacity-50">{t('issue.form.save')}</button>
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
          <textarea className="app-input min-h-[120px] resize-y" value={body} onChange={e => setBody(e.target.value)} placeholder={t('issue.form.bodyPh')} />
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
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.assignee')}</span>
            <AssigneeSelect members={members} value={assignee} onChange={setAssignee} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('issue.form.due')}</span>
            <input type="date" className="app-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </label>
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
          <button onClick={onClose} className="btn-ghost text-xs">{t('issue.delete.cancel')}</button>
          <button onClick={run} disabled={pending} className="btn-primary bg-delayed text-xs disabled:opacity-50">{t('issue.delete.run')}</button>
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
```

**구현 시 확인:** `app-input`/`btn-primary`/`btn-ghost` 클래스가 `globals.css`에 실재하는지 grep — 없으면 공지 폼 모달(AnnouncementsView 내부)의 실제 input/button 클래스 문자열을 그대로 복제한다(클래스 이름만 다를 뿐 구조는 동일하게).

- [ ] **Step 2: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/issues/IssueModals.tsx
git commit -m "feat(issues): 상세(진행 편집)·폼·삭제 모달 3종

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: IssuesView (목록 + KPI + 필터 + focus)

**Files:**
- Create: `src/components/issues/IssuesView.tsx`

**Interfaces:**
- Consumes: Task 6 모달 3종, Task 1 도메인 전부, `SegmentedTabs`/`KpiCard`/`EmptyState`/`useLocale`
- Produces (Task 8 페이지가 렌더):
  - `IssuesView({ issues, members, projectId, currentUserId, role, myMemberIds, today }): JSX`
  - props 타입: `{ issues: Issue[]; members: ProjectMember[]; projectId: string; currentUserId: string | null; role: string | null; myMemberIds: string[]; today: string }`

- [ ] **Step 1: 구현**

`src/components/issues/IssuesView.tsx` 전체 내용:

```tsx
'use client'
// 이슈 목록 — KPI 3장(본문 배치) + 필터(상태·심각도·내담당) + 테이블 + ?focus= 딥링크.
// 테이블 골격은 MeetingsView(가로 스크롤 + 행 키보드 패턴), 모달·focus 소비는 AnnouncementsView 복제.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleAlert, CircleDashed, Clock3, Plus } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { useLocale } from '@/components/providers/LocaleProvider'
import { DeleteIssueModal, IssueDetailModal, IssueFormModal } from './IssueModals'
import {
  ISSUE_SEVERITIES, ISSUE_SEVERITY_META, ISSUE_STATUSES, ISSUE_STATUS_META,
  canEditIssue, filterIssues, isOverdue, sortIssues, summarizeIssues,
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
  const [viewing, setViewing] = useState<Issue | null>(() => {
    const focus = searchParams.get('focus')
    if (!focus) return null
    return issues.find(i => i.id === focus) ?? null
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Issue | null>(null)
  const [deleting, setDeleting] = useState<Issue | null>(null)

  const myIds = useMemo(() => new Set(myMemberIds), [myMemberIds])
  const memberNameById = useMemo(() => new Map(members.map(m => [m.id, m.name])), [members])
  const memberName = (id: string | null) => (id ? memberNameById.get(id) ?? null : null)

  const kpi = useMemo(() => summarizeIssues(issues, today), [issues, today])
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
    setViewing(null)
    setEditing(issue)
    setFormOpen(true)
  }

  const filtered = statusFilter !== 'all' || severityFilter !== 'all' || mineOnly

  return (
    <div className="space-y-4">
      {/* KPI 3장 — PageHero heroKpis 는 렌더되지 않는 죽은 prop 이라 본문 배치(스펙 §6) */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label={t('issue.kpi.open')} value={kpi.open} sub={t('issue.kpi.openSub')} icon={CircleAlert} tone="brand" />
        <KpiCard label={t('issue.kpi.inProgress')} value={kpi.inProgress} sub={t('issue.kpi.inProgressSub')} icon={CircleDashed} />
        <KpiCard label={t('issue.kpi.overdue')} value={kpi.overdue} sub={t('issue.kpi.overdueSub')} icon={Clock3} tone="danger" />
      </div>

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
          <button onClick={openWrite} className="btn-primary inline-flex items-center gap-1.5 text-xs">
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
                      onClick={() => setViewing(issue)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') setViewing(issue) }}
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
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{memberName(issue.assigneeMemberId) ?? t('issue.unassigned')}</td>
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
            <button onClick={openWrite} className="btn-primary inline-flex items-center gap-1.5 text-xs">
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
        onClose={() => setViewing(null)}
        onEdit={() => viewing && openEdit(viewing)}
        onDelete={() => {
          if (!viewing) return
          setDeleting(viewing)
          setViewing(null)
        }}
      />
      <IssueFormModal open={formOpen} onClose={() => setFormOpen(false)} projectId={projectId} initial={editing} members={members} />
      <DeleteIssueModal issue={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
```

- [ ] **Step 2: 타입 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/components/issues/IssuesView.tsx
git commit -m "feat(issues): IssuesView — KPI·필터·테이블·focus 딥링크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 페이지 + loading

**Files:**
- Create: `src/app/(app)/p/[projectId]/issues/page.tsx`
- Create: `src/app/(app)/p/[projectId]/issues/loading.tsx`

**Interfaces:**
- Consumes: `getIssues`(Task 4), `getProjectMembers`(`@/lib/data/members`), `resolveMemberIds`(`@/lib/data/meetings`), `getMembership`/`getSession`, `listProjects`(`@/app/actions/project`), `getServerLocale`/`t`, `PageHero`/`HeroBadge`/`ProjectPageShell`, `IssuesView`(Task 7)
- Produces: 라우트 `/p/[projectId]/issues`

- [ ] **Step 1: `page.tsx` 구현**

```tsx
import { getIssues } from '@/lib/data/issues'
import { getProjectMembers } from '@/lib/data/members'
import { resolveMemberIds } from '@/lib/data/meetings'
import { getMembership, getSession } from '@/lib/auth'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { IssuesView } from '@/components/issues/IssuesView'

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export default async function IssuesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const [issues, members, m, user, projects, locale] = await Promise.all([
    getIssues(projectId),
    getProjectMembers(projectId),
    getMembership(),
    getSession(),
    listProjects(),
    getServerLocale(),
  ])
  // '내 담당' 필터용 — user_id+email 이중 매칭(meetings 관례). 비로그인은 빈 배열.
  const myMemberIds = user ? await resolveMemberIds(await createServerClient(), user) : []

  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'issue.projectFallback')

  return (
    <ProjectPageShell
      hero={
        <PageHero
          eyebrow="ISSUES"
          badge={<HeroBadge>Issue Tracker</HeroBadge>}
          title={`${projectName} ${t(locale, 'issue.heroTitleSuffix')}`}
          description={t(locale, 'issue.heroDesc')}
        />
      }
    >
      <IssuesView
        issues={issues}
        members={members}
        projectId={projectId}
        currentUserId={user?.id ?? null}
        role={m?.role ?? null}
        myMemberIds={myMemberIds}
        today={seoulToday()}
      />
    </ProjectPageShell>
  )
}
```

**구현 시 확인:** `getProjectMembers`의 실제 export 이름·시그니처를 `src/lib/data/members.ts`에서 확인(파라미터 `projectId`, 반환 `ProjectMember[]`). `PageHero`가 실제로 받는 prop(`eyebrow`/`badge`/`title`/`description`)은 announcements/page.tsx 사용부와 동일하게.

- [ ] **Step 2: `loading.tsx` 구현** (announcements 관례 — 본문 KPI 3장 + 테이블 행 스켈레톤)

```tsx
import { Skeleton, KpiSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="이슈를 불러오는 중">
      <Skeleton className="h-[140px] rounded-3xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
      <div className="card space-y-3 p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-10 rounded" />
            <Skeleton className="h-4 flex-1 rounded" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 빌드 검증**

Run: `npm run build`
Expected: 성공 — `/p/[projectId]/issues` 라우트가 출력 목록에 등장.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/p/[projectId]/issues/page.tsx" "src/app/(app)/p/[projectId]/issues/loading.tsx"
git commit -m "feat(issues): /p/[projectId]/issues 페이지 + loading 스켈레톤

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 내비게이션 등록 (3곳) + weekly drift 해소 + 아이콘 정본

**Files:**
- Modify: `src/components/app/Sidebar.tsx` (lucide import + projectMenu)
- Modify: `src/components/app/HeaderChrome.tsx` (SECTION_LABEL + MobileMenu links — **weekly 누락 drift 동시 해소**)
- Modify: `docs/design/icon-guideline.md` (내비게이션 정본 표 + 변경 이력)

**Interfaces:**
- Consumes: `nav.issues` DictKey(Task 2), 라우트(Task 8)
- Produces: 사이드바·모바일 메뉴·헤더 타이틀에 이슈관리 노출

- [ ] **Step 1: Sidebar 수정**

lucide import 블록(알파벳 정렬)에 `CircleAlert` 추가 — `CalendarRange`와 `Columns3` 사이:

```tsx
import {
  CalendarCheck, CalendarClock, CalendarRange, CircleAlert, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, Megaphone, NotebookPen, NotebookText, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
```

`projectMenu`의 kanban 줄과 members 줄 사이에 삽입:

```tsx
    { href: `${base}/issues`, labelKey: 'nav.issues', icon: CircleAlert, match: `${base}/issues` },
```

- [ ] **Step 2: HeaderChrome 수정 (2곳)**

`SECTION_LABEL`에 추가 (kanban 뒤):

```tsx
  dashboard: '대시보드', wbs: 'WBS · 간트', gantt: '간트 차트', kanban: '칸반 보드', issues: '이슈관리',
```

MobileMenu `links` 배열 — kanban 다음에 issues, **meetings 다음에 weekly(기존 누락 drift 해소)**:

```tsx
  const links = activeId
    ? [
        { href: `/p/${activeId}/dashboard`, label: t('nav.dashboard') },
        { href: `/p/${activeId}/wbs`, label: t('nav.wbsGantt') },
        { href: `/p/${activeId}/kanban`, label: t('nav.kanban') },
        { href: `/p/${activeId}/issues`, label: t('nav.issues') },
        { href: `/p/${activeId}/members`, label: t('nav.members') },
        { href: `/p/${activeId}/attendance`, label: t('nav.attendance') },
        { href: `/p/${activeId}/announcements`, label: t('nav.announcements'), badge: unreadAnn },
        { href: `/p/${activeId}/meetings`, label: t('nav.meetings') },
        { href: `/p/${activeId}/weekly`, label: t('nav.weekly') },
        { href: `/p/${activeId}/settings`, label: t('nav.settings') },
      ]
    : []
```

- [ ] **Step 3: icon-guideline.md 정본 등록**

내비게이션 표의 "칸반 보드" 행과 "멤버" 행 사이에 추가:

```markdown
| 이슈관리 | `CircleAlert` | `CircleAlert` | 프로젝트 리스크/장애물. 지연·위험 "상태" 의미의 `AlertTriangle` 과 구분 |
```

문서 하단 "## 변경 이력" 표에 행 추가:

```markdown
| 2026-07-23 | 내비게이션 정본에 이슈관리(`CircleAlert`) 등록 | 이슈관리 메뉴 신설 |
```

- [ ] **Step 4: 빌드 + 육안 검증**

Run: `npm run build`
Expected: 성공. (사이드바 순서: 대시보드→WBS→칸반→**이슈관리**→멤버→…)

- [ ] **Step 5: 커밋**

```bash
git add src/components/app/Sidebar.tsx src/components/app/HeaderChrome.tsx docs/design/icon-guideline.md
git commit -m "feat(issues): 내비 3곳 등록(사이드바·모바일·타이틀) + 모바일 weekly 누락 drift 해소

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 딥링크 UI 테스트 + 전체 검증

**Files:**
- Modify: `tests/ui/deep-link-params.test.tsx`

**Interfaces:**
- Consumes: `IssuesView`(Task 7), `Issue`(Task 1)
- Produces: `?focus=` 계약의 회귀 방어

- [ ] **Step 1: 테스트 확장**

`tests/ui/deep-link-params.test.tsx`에 4가지 추가 (기존 파일 구조를 열어 위치 확인 후):

(a) 액션 스텁 — 기존 `vi.mock('@/app/actions/…')` 블록들 뒤에:

```tsx
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true })),
  updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({ ok: true })),
}))
```

(b) 뷰 import — 기존 뷰 import 블록 뒤에:

```tsx
import { IssuesView } from '@/components/issues/IssuesView'
import type { Issue } from '@/lib/domain/issues'
```

(c) 픽스처 팩토리 — 기존 팩토리들 뒤에:

```tsx
function issueFx(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'iss-1', issueNo: 1, projectId: 'p1', title: '기준정보 오류', body: '',
    status: 'open', severity: 'medium', assigneeMemberId: null, dueDate: null,
    resolutionNote: '', resolvedAt: null, createdBy: 'u1', createdByName: '홍길동',
    createdAt: '2026-07-01T00:00:00+00:00', updatedAt: '2026-07-01T00:00:00+00:00', ...overrides,
  }
}
```

(d) 케이스 쌍 — describe 말미(기존 마지막 뷰 케이스 뒤):

```tsx
  it('IssuesView: ?focus= 로 해당 이슈 상세를 연다', async () => {
    currentSearch = 'focus=iss-2'
    await mount(
      <IssuesView projectId="p1" currentUserId={null} role={null} myMemberIds={[]} today="2026-07-23"
        members={[]} issues={[issueFx(), issueFx({ id: 'iss-2', title: '인터페이스 오류' })]} />,
    )
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('인터페이스 오류')
  })

  it('IssuesView: 무효 focus id 는 조용히 무시한다', async () => {
    currentSearch = 'focus=iss-없음'
    await mount(
      <IssuesView projectId="p1" currentUserId={null} role={null} myMemberIds={[]} today="2026-07-23"
        members={[]} issues={[issueFx()]} />,
    )
    expect(dialog()).toBeNull()
  })
```

**주의:** 이 파일의 mock은 전부 top-level이라 스텁 누락 시 파일 전체가 깨진다 — `mount()`/`dialog()` 헬퍼와 기존 케이스 형식을 파일에서 그대로 따른다.

- [ ] **Step 2: 전체 스위트 + lint + build**

Run: `npm run test && npm run lint && npm run build`
Expected: 기존 포함 전체 그린(이 계획 추가분: domain issues + actions gate + deep-link 2케이스).

- [ ] **Step 3: 커밋**

```bash
git add tests/ui/deep-link-params.test.tsx
git commit -m "test(issues): ?focus= 딥링크 계약 — 상세 열기·무효 id 무시

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 마이그레이션 프로덕션 적용 + 배포 + 스모크

**Files:** 없음 (운영 작업)

**Interfaces:**
- Consumes: `0040_issues.sql`(Task 3), 메모리의 Supabase Management API 레시피(키체인 "Supabase CLI" 토큰 → go-keyring-base64 디코드 → `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`)
- Produces: 프로덕션 `issues` 테이블 + 라이브 메뉴

- [ ] **Step 1: 마이그레이션 적용 (코드 배포 전 — 0027 교훈)**

메모리 `supabase-mgmt-api-recipe`의 레시피대로 키체인 토큰을 꺼내 `0040_issues.sql` 전문을 Management API로 실행한다.

- [ ] **Step 2: 적용 검증 (읽기 전용 쿼리)**

같은 경로로 확인:

```sql
select
  (select count(*) from information_schema.tables where table_name = 'issues') as tbl,
  (select count(*) from pg_policies where tablename = 'issues') as policies,
  (select conname from pg_constraint where conname = 'issues_assignee_project_fk') as fk;
```

Expected: `tbl=1, policies=4, fk=issues_assignee_project_fk`.

- [ ] **Step 3: 배포**

`/deploy` 스킬 절차(커밋 확인 → push → Vercel 상태 확인). 이 시점까지의 커밋 전부가 push 대상.

- [ ] **Step 4: 스모크 (verify 스킬 관례 — curl 기반)**

- 비인증: `curl -s -o /dev/null -w '%{http_code}' https://<prod>/p/<테스트프로젝트id>/issues` → 로그인 리다이렉트(3xx) 확인
- 로그인 세션으로 이슈 등록→상태 변경→목록 확인은 **전용 테스트 프로젝트에서만** (운영 D-CUBE 쓰기 금지)
- Vercel 함수 로그에 `[getIssues] 조회 실패` 부재 확인

- [ ] **Step 5: 메모리 기록**

`~/.claude/projects/-Users-jerry-wbs-web/memory/`에 이슈관리 기능 메모리 파일 신규 작성 + MEMORY.md 인덱스 1줄 추가(배포 커밋 해시·0040 적용 여부·잔여 백로그 포인터).

---

## Self-Review 결과

- **스펙 커버리지:** 스펙 §1~§8 전 항목이 Task 1~11에 매핑됨. §9(백로그)·§7(접점 전제)은 구현 없음이 정답(스키마에 반영 완료). 스펙 §6의 "공지 1파일 완결(±600줄) 상한 감각"은 IssueModals/IssuesView 2파일 분리로 대체 — 파일당 책임이 더 명확해 스펙 §10 수용 기준에 영향 없음.
- **플레이스홀더:** 없음. 단 두 곳은 의도된 "구현 시 확인" 지시(Task 6 `app-input`/`btn-*` 클래스 실재 확인, Task 8 `getProjectMembers` 시그니처 확인) — 실행자가 실제 파일과 대조해야 하는 지점을 명시한 것.
- **타입 일관성:** `Issue`/`IssueInput`/`IssueProgressPatch`/`IssueActionResult`/META·필터 타입이 Task 1·5 정의와 6~10 사용부에서 동일. `memberName(id): string | null` 시그니처 일치.
