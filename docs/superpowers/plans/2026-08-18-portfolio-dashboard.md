# 전사 포트폴리오 대시보드 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 슈퍼유저 전용 `/portfolio` 화면 — 모든 프로젝트의 신호등·진척/SPI/예상종료·마일스톤을 한 화면에서 비교하고 행 클릭으로 상세 이동.

**Architecture:** 서버 컴포넌트가 전 프로젝트를 병렬 로드(`getComputedWbs`×N)하고, 프로젝트마다 기존 정본 함수(`buildExecSummary`·`scheduleModel`·`milestoneTimeline`·`projectLifecycleStatus`)를 호출한다. 신규 로직은 순수 집계 함수 `buildPortfolio` 하나에 모으고 컴포넌트는 조립만 한다. 마이그레이션 0건.

**Tech Stack:** Next.js 15 App Router(서버 컴포넌트), Tailwind v4(기존 토큰만), 자체 SVG(차트 의존성 0), vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-portfolio-dashboard-design.md`

## Global Constraints

- 작업 브랜치는 `ui/portfolio` (이미 생성됨). **`git add -A` 금지** — 항상 파일명 명시.
- 커밋 메시지는 한국어, "무엇"보다 "왜". 마이그레이션 없음(G1 해당 없음).
- UI 위험 파일(`src/components/app/*`, `src/app/(app)/layout.tsx`)은 Task 6 에서만 수정. `globals.css` 는 수정 금지(기존 토큰·공용 클래스만 사용).
- 상태 변형 display 유틸(`group-hover:flex` 등) 사용 금지(반응형 안전망이 이긴다 — CLAUDE.md).
- 에러 처리 3원칙: 조회 실패를 '데이터 없음'으로 위장 금지(표시=로깅), 가드는 fail-closed, 모르면 'unknown'.
- 숫자 규약: 진척 %는 정본 함수가 이미 round1 적용 — 재반올림하지 않는다. 권한 판정에 `role === '...'` 직접 비교 금지.
- i18n: ko/en 키 패리티는 `Record<keyof ko, string>` 타입으로 강제(누락 시 컴파일 에러).
- 데이터 페치는 단일 `Promise.all` 왕복 — 직렬 2단째 금지(대시보드 관례).
- 로컬 `npm run build`는 `_workspace` 스크래치 ts 때문에 실패할 수 있다 — Task 7 의 buildskip 우회 절차 사용.

---

### Task 1: 순수 계층 — `canViewPortfolio` + `buildPortfolio` (TDD)

**Files:**
- Create: `src/lib/authz/portfolioAccess.ts`
- Create: `src/lib/domain/portfolio.ts`
- Test: `tests/domain/portfolio.test.ts`

**Interfaces:**
- Consumes: `buildExecSummary`/`milestoneTimeline`/`ExecSummary`/`Signal`/`MilestonePoint` (`src/lib/domain/dashboard.ts`), `projectLifecycleStatus`/`ProjectLifecycleStatus` (`src/lib/domain/project-status.ts`), `collectLeaves` (`src/lib/domain/tree.ts`), `Actor` (`src/lib/domain/authz.ts`)
- Produces(후속 태스크가 의존):
  - `canViewPortfolio(actor: Actor | null): boolean`
  - `interface PortfolioProjectInput { projectId: string; name: string; isPrivate: boolean; startDate: string | null; endDate: string | null; baseDate: string | null; today: string; items: ComputedItem[] | null; milestoneKeywords: readonly string[]; leaders: string[] }`
  - `interface PortfolioRow { projectId: string; name: string; isPrivate: boolean; startDate: string | null; endDate: string | null; baseDate: string | null; today: string; lifecycle: ProjectLifecycleStatus; degraded: boolean; exec: ExecSummary | null; spi: number | null; leaders: string[] }`
  - `type PortfolioMilestone = MilestonePoint & { projectId: string; projectName: string }`
  - `interface PortfolioModel { rows: PortfolioRow[]; totals: { count: number; red: number; amber: number; green: number; neutral: number; overdue: number; degraded: number }; milestones: PortfolioMilestone[] }`
  - `buildPortfolio(inputs: PortfolioProjectInput[]): PortfolioModel`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/portfolio.test.ts` (leaf 헬퍼는 `tests/domain/dashboard.test.ts:63`과 동일 형태):

```ts
import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { buildPortfolio, type PortfolioProjectInput } from '@/lib/domain/portfolio'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import type { Actor } from '@/lib/domain/authz'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], depth: 0, ...over,
})

const mkInput = (over: Partial<PortfolioProjectInput>): PortfolioProjectInput => ({
  projectId: 'p1', name: '프로젝트', isPrivate: false,
  startDate: '2026-01-01', endDate: '2026-12-31', baseDate: null, today: '2026-08-18',
  items: [leaf({ plannedPct: 50, rolledActualPct: 50 })], milestoneKeywords: ['보고회'], leaders: [], ...over,
})

describe('canViewPortfolio', () => {
  const actor = (isSuperuser: boolean): Actor =>
    ({ userId: 'u', teamCode: null, teamId: null, isSuperuser, projectRoles: new Map(), rosterTeams: new Map() } as unknown as Actor)
  it('슈퍼유저만 true, null(판정 불가)은 fail-closed', () => {
    expect(canViewPortfolio(actor(true))).toBe(true)
    expect(canViewPortfolio(actor(false))).toBe(false)
    expect(canViewPortfolio(null)).toBe(false)
  })
})

describe('buildPortfolio — 행 산출', () => {
  it('items null(조회 실패) → degraded 행: lifecycle unknown, exec null', () => {
    const m = buildPortfolio([mkInput({ items: null })])
    expect(m.rows[0].degraded).toBe(true)
    expect(m.rows[0].lifecycle).toBe('unknown')
    expect(m.rows[0].exec).toBeNull()
    expect(m.totals.degraded).toBe(1)
  })
  it('정상 행 — exec 신호·진척이 정본 함수 결과 그대로 실린다', () => {
    // planned 50 vs actual 50 → 편차 0 → progress green
    const m = buildPortfolio([mkInput({})])
    expect(m.rows[0].degraded).toBe(false)
    expect(m.rows[0].exec!.progress.variance).toBe(0)
    expect(m.rows[0].exec!.progress.signal).toBe('green')
  })
  it('SPI — schedule.label onTrack 이면 actual/planned 소수 2자리, 조기 가드(early)면 null', () => {
    const onTrack = buildPortfolio([mkInput({ items: [leaf({ plannedPct: 50, rolledActualPct: 45 })] })])
    expect(onTrack.rows[0].spi).toBe(0.9)
    const early = buildPortfolio([mkInput({ items: [leaf({ plannedPct: 3, rolledActualPct: 1 })] })])
    expect(early.rows[0].spi).toBeNull()
  })
  it('생애 상태 — 종료일 경과 + 전 리프 done → done, 미완 리프 있으면 overdue', () => {
    const done = buildPortfolio([mkInput({
      endDate: '2026-06-30', items: [leaf({ status: 'done', rolledActualPct: 100, plannedPct: 100 })],
    })])
    expect(done.rows[0].lifecycle).toBe('done')
    const overdue = buildPortfolio([mkInput({
      endDate: '2026-06-30', items: [leaf({ status: 'in_progress', rolledActualPct: 90, plannedPct: 100 })],
    })])
    expect(overdue.rows[0].lifecycle).toBe('overdue')
  })
})

describe('buildPortfolio — 정렬', () => {
  // 신호 정렬 픽스처는 날짜 null → scheduleModel 이 neutral 이 되어 overall 신호를
  // progress 신호만으로 통제한다(날짜가 있으면 장기 프로젝트에서 편차 -5도 SPI slip>14 로
  // schedule red 가 되어 amber 픽스처가 amber 가 아니게 된다 — 프리플라이트 Ruling 1).
  // 셋 다 lifecycle 'ready'(날짜 없음) 동일 그룹이므로 신호 순서만 검증된다.
  const red = mkInput({ projectId: 'r', name: 'RED', startDate: null, endDate: null, items: [leaf({ plannedPct: 65, rolledActualPct: 50 })] })
  const amber = mkInput({ projectId: 'a', name: 'AMBER', startDate: null, endDate: null, items: [leaf({ plannedPct: 55, rolledActualPct: 50 })] })
  const green = mkInput({ projectId: 'g', name: 'GREEN', startDate: null, endDate: null, items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] })
  it('신호 심각도 순: red → amber → green', () => {
    const m = buildPortfolio([green, red, amber])
    expect(m.rows.map(r => r.projectId)).toEqual(['r', 'a', 'g'])
  })
  it('degraded(확인 불가)는 실패를 묻지 않도록 최상단', () => {
    // degraded 는 lifecycle unknown(그룹 0) + rank -1 — ready 그룹의 green 보다 앞선다
    const m = buildPortfolio([green, mkInput({ projectId: 'd', items: null })])
    expect(m.rows[0].projectId).toBe('d')
  })
  it('생애 그룹 — active 가 앞, ready 는 다음, done 은 맨 뒤', () => {
    // activeGreen: 기간 내 + 편차 0 + SPI 1(slip 0) → 전 신호 green, lifecycle active
    const activeGreen = mkInput({ projectId: 'g', items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] })
    const ready = mkInput({ projectId: 'rd', startDate: '2026-10-01', endDate: '2026-12-31', items: [leaf({})] })
    const doneP = mkInput({
      projectId: 'dn', endDate: '2026-06-30',
      items: [leaf({ status: 'done', rolledActualPct: 100, plannedPct: 100 })],
    })
    const m = buildPortfolio([doneP, ready, activeGreen])
    expect(m.rows.map(r => r.projectId)).toEqual(['g', 'rd', 'dn'])
  })
  it('동신호 동그룹은 편차 오름차순(더 나쁜 게 먼저)', () => {
    const worse = mkInput({ projectId: 'w', startDate: null, endDate: null, items: [leaf({ plannedPct: 58, rolledActualPct: 50 })] })  // -8, amber
    const better = mkInput({ projectId: 'b', startDate: null, endDate: null, items: [leaf({ plannedPct: 54, rolledActualPct: 50 })] }) // -4, amber
    const m = buildPortfolio([better, worse])
    expect(m.rows.map(r => r.projectId)).toEqual(['w', 'b'])
  })
})

describe('buildPortfolio — totals·milestones', () => {
  it('totals — 신호 분포는 정상 행만, overdue 는 lifecycle 기준', () => {
    const m = buildPortfolio([
      mkInput({ projectId: 'g', items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] }),
      mkInput({ projectId: 'o', endDate: '2026-06-30', items: [leaf({ rolledActualPct: 50, plannedPct: 100 })] }),
      mkInput({ projectId: 'd', items: null }),
    ])
    expect(m.totals.count).toBe(3)
    expect(m.totals.degraded).toBe(1)
    expect(m.totals.overdue).toBe(1)
    expect(m.totals.red + m.totals.amber + m.totals.green + m.totals.neutral).toBe(2) // 정상 행 2건만
  })
  it('milestones — 프로젝트명 부착 + 날짜 오름차순 통합', () => {
    const m = buildPortfolio([
      mkInput({ projectId: 'p1', name: 'P1', items: [leaf({ name: '최종 보고회', plannedEnd: '2026-10-01' })], milestoneKeywords: ['보고회'] }),
      mkInput({ projectId: 'p2', name: 'P2', items: [leaf({ name: '착수 보고회', plannedEnd: '2026-09-01' })], milestoneKeywords: ['보고회'] }),
    ])
    expect(m.milestones.map(x => x.projectName)).toEqual(['P2', 'P1'])
  })
  it('키워드 빈 배열 + 일반 리프 → 마일스톤 0건이 정답', () => {
    const m = buildPortfolio([mkInput({ milestoneKeywords: [], items: [leaf({ name: '일반작업', plannedEnd: '2026-09-01' })] })])
    expect(m.milestones).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/portfolio.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/portfolio'`

- [ ] **Step 3: 구현**

`src/lib/authz/portfolioAccess.ts`:

```ts
import type { Actor } from '@/lib/domain/authz'

/**
 * 전사 포트폴리오(/portfolio) 열람 권한 — 판정을 여기 한 곳에만 둔다(canViewUsage 관례).
 *
 * 슈퍼유저 전용(2026-08-18 사용자 결정). 전 프로젝트(비공개 0070 포함)의 진척·신호를
 * 한 화면에 모으므로 프로젝트 관리자에게도 열지 않는다.
 *
 * projects/wbs_items 읽기 RLS 는 전 직원 개방(0002)이라 DB 2차 방어선이 없다 —
 * 이 코드 게이트(+사이드바 어포던스)가 유일한 관문이다.
 */
export function canViewPortfolio(actor: Actor | null): boolean {
  return actor?.isSuperuser === true
}
```

`src/lib/domain/portfolio.ts`:

```ts
import type { ComputedItem } from './types'
import {
  buildExecSummary, milestoneTimeline,
  type ExecSummary, type Signal, type MilestonePoint,
} from './dashboard'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from './project-status'
import { collectLeaves } from './tree'

/** 포트폴리오 집계 입력 — 데이터 계층이 프로젝트별로 채워 넘긴다(순수 함수 유지). */
export interface PortfolioProjectInput {
  projectId: string
  name: string
  isPrivate: boolean
  startDate: string | null
  endDate: string | null
  baseDate: string | null
  /** getComputedWbs 가 반환한 기준일(base_date 우선) — 프로젝트마다 다를 수 있다. */
  today: string
  /** null = WBS/설정 조회 실패. '데이터 없음'(빈 배열)과 반드시 구분한다(3원칙). */
  items: ComputedItem[] | null
  milestoneKeywords: readonly string[]
  leaders: string[]
}

export interface PortfolioRow {
  projectId: string
  name: string
  isPrivate: boolean
  startDate: string | null
  endDate: string | null
  baseDate: string | null
  today: string
  lifecycle: ProjectLifecycleStatus
  degraded: boolean
  exec: ExecSummary | null
  /** SPI(actual/planned, 소수 2자리) — scheduleModel 과 동일 정의. 조기·미산정 구간은 null. */
  spi: number | null
  leaders: string[]
}

export type PortfolioMilestone = MilestonePoint & { projectId: string; projectName: string }

export interface PortfolioModel {
  rows: PortfolioRow[]
  totals: {
    count: number
    red: number; amber: number; green: number; neutral: number   // 정상 행의 overall 신호 분포
    overdue: number                                              // lifecycle === 'overdue'
    degraded: number                                             // 조회 실패 행
  }
  milestones: PortfolioMilestone[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 신호 심각도. degraded 는 -1(최상단) — 실패를 목록 아래 묻으면 아무도 못 본다. */
const SIGNAL_RANK: Record<Signal, number> = { red: 0, amber: 1, green: 2, neutral: 3 }
const rankOf = (r: PortfolioRow) => (r.degraded ? -1 : SIGNAL_RANK[r.exec!.overall.signal])

/** 생애 그룹 — 진행 중(+지연 종료·확인 불가)이 위, 준비는 다음, 완료는 마지막. */
const GROUP_RANK: Record<ProjectLifecycleStatus, number> = {
  active: 0, overdue: 0, unknown: 0, ready: 1, done: 2,
}

export function buildPortfolio(inputs: PortfolioProjectInput[]): PortfolioModel {
  const rows: PortfolioRow[] = inputs.map(input => {
    const base = {
      projectId: input.projectId, name: input.name, isPrivate: input.isPrivate,
      startDate: input.startDate, endDate: input.endDate,
      baseDate: input.baseDate, today: input.today, leaders: input.leaders,
    }
    if (input.items === null) {
      return { ...base, lifecycle: 'unknown' as const, degraded: true, exec: null, spi: null }
    }
    const leaves = collectLeaves(input.items)
    // done 판정은 리프 status(원시값 >=100 규약) — computeCompletionMap 과 동일 결론
    const completion = {
      hasWbs: leaves.length > 0,
      allDone: leaves.length > 0 && leaves.every(l => l.status === 'done'),
    }
    const lifecycle = projectLifecycleStatus(input.startDate, input.endDate, input.today, completion)
    const exec = buildExecSummary(
      input.items,
      { startDate: input.startDate, endDate: input.endDate, today: input.today },
      input.milestoneKeywords,
    )
    const spi = exec.schedule.label === 'onTrack' ? round2(exec.progress.actual / exec.progress.planned) : null
    return { ...base, lifecycle, degraded: false, exec, spi }
  })

  rows.sort((a, b) =>
    GROUP_RANK[a.lifecycle] - GROUP_RANK[b.lifecycle]
    || rankOf(a) - rankOf(b)
    || (a.exec?.progress.variance ?? 0) - (b.exec?.progress.variance ?? 0)
    || a.name.localeCompare(b.name, 'ko'),
  )

  const ok = rows.filter(r => !r.degraded)
  const countSignal = (s: Signal) => ok.filter(r => r.exec!.overall.signal === s).length
  const totals = {
    count: rows.length,
    red: countSignal('red'), amber: countSignal('amber'),
    green: countSignal('green'), neutral: countSignal('neutral'),
    overdue: rows.filter(r => r.lifecycle === 'overdue').length,
    degraded: rows.filter(r => r.degraded).length,
  }

  const milestones: PortfolioMilestone[] = inputs
    .filter(i => i.items !== null)
    .flatMap(i =>
      milestoneTimeline(i.items!, i.today, i.milestoneKeywords)
        .map(p => ({ ...p, projectId: i.projectId, projectName: i.name })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return { rows, totals, milestones }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/portfolio.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authz/portfolioAccess.ts src/lib/domain/portfolio.ts tests/domain/portfolio.test.ts
git commit -m "feat(portfolio): 전사 집계 순수 계층 — buildPortfolio + canViewPortfolio

프로젝트별 지표는 기존 정본 함수(buildExecSummary 등) 재사용으로 대시보드와 값이 반드시 일치.
degraded 행은 최상단 배치 — 조회 실패를 목록 아래 묻지 않는다(3원칙)."
```

---

### Task 2: i18n 사전 — `dict/portfolio.ts` + nav 키

**Files:**
- Create: `src/lib/i18n/dict/portfolio.ts`
- Modify: `src/lib/i18n/dict.ts` (import + 병합 2곳)
- Modify: `src/lib/i18n/dict/common.ts` (`nav.portfolio` ko/en)

**Interfaces:**
- Produces: DictKey `nav.portfolio`, `pf.*` (아래 전체) — Task 4·5·6 이 사용.

- [ ] **Step 1: 네임스페이스 파일 작성**

`src/lib/i18n/dict/portfolio.ts`:

```ts
// 전사 포트폴리오 화면 사전. en은 Record<keyof ko, string>로 키 패리티 강제.
export const portfolioKo = {
  'pf.title': '전사 포트폴리오',
  'pf.listDegraded': '프로젝트 목록 조회에 실패했습니다 — 아래 표가 불완전할 수 있습니다. 서버 로그를 확인하세요.',
  'pf.kpi.projects': '프로젝트',
  'pf.kpi.signals': '신호 분포',
  'pf.kpi.signalsSub': '위험 · 주의 · 정상 · 판단 불가',
  'pf.kpi.overdue': '지연 종료',
  'pf.kpi.degraded': '집계 실패',
  'pf.kpi.degradedSub': '서버 로그를 확인하세요',
  'pf.table.title': '프로젝트 비교',
  'pf.unit': '건',
  'pf.empty': '등록된 프로젝트가 없습니다.',
  'pf.col.signal': '신호',
  'pf.col.project': '프로젝트',
  'pf.col.progress': '진척 (실적/계획)',
  'pf.col.variance': '편차',
  'pf.col.spi': 'SPI',
  'pf.col.end': '예상 종료',
  'pf.col.milestone': '다음 마일스톤',
  'pf.col.pm': 'PM',
  'pf.col.status': '상태',
  'pf.signal.green': '정상',
  'pf.signal.amber': '주의',
  'pf.signal.red': '위험',
  'pf.signal.neutral': '판단 불가',
  'pf.status.ready': '준비',
  'pf.status.active': '진행중',
  'pf.status.overdue': '지연 종료',
  'pf.status.done': '완료',
  'pf.status.unknown': '확인 불가',
  'pf.degradedRow': '집계 실패 — 지표를 확인할 수 없습니다 (서버 로그 확인)',
  'pf.baseDate': '기준일',
  'pf.private': '비공개',
  'pf.leadersUnknown': '확인 불가',
  'pf.ms.title': '마일스톤 통합 타임라인',
  'pf.ms.empty': '표시할 마일스톤이 없습니다. 키워드 미설정 프로젝트는 0건이 정상입니다 (프로젝트 설정 > 마일스톤 키워드).',
} as const

export const portfolioEn: Record<keyof typeof portfolioKo, string> = {
  'pf.title': 'Portfolio Overview',
  'pf.listDegraded': 'Failed to load the project list — the table below may be incomplete. Check server logs.',
  'pf.kpi.projects': 'Projects',
  'pf.kpi.signals': 'Signal mix',
  'pf.kpi.signalsSub': 'Red · Amber · Green · N/A',
  'pf.kpi.overdue': 'Overdue',
  'pf.kpi.degraded': 'Load failures',
  'pf.kpi.degradedSub': 'Check server logs',
  'pf.table.title': 'Project comparison',
  'pf.unit': '',
  'pf.empty': 'No projects registered.',
  'pf.col.signal': 'Signal',
  'pf.col.project': 'Project',
  'pf.col.progress': 'Progress (actual/planned)',
  'pf.col.variance': 'Variance',
  'pf.col.spi': 'SPI',
  'pf.col.end': 'Projected end',
  'pf.col.milestone': 'Next milestone',
  'pf.col.pm': 'PM',
  'pf.col.status': 'Status',
  'pf.signal.green': 'On track',
  'pf.signal.amber': 'At risk',
  'pf.signal.red': 'Critical',
  'pf.signal.neutral': 'N/A',
  'pf.status.ready': 'Ready',
  'pf.status.active': 'Active',
  'pf.status.overdue': 'Overdue',
  'pf.status.done': 'Done',
  'pf.status.unknown': 'Unknown',
  'pf.degradedRow': 'Aggregation failed — metrics unavailable (check server logs)',
  'pf.baseDate': 'As of',
  'pf.private': 'Private',
  'pf.leadersUnknown': 'Unknown',
  'pf.ms.title': 'Milestone timeline (all projects)',
  'pf.ms.empty': 'No milestones to show. Projects without milestone keywords legitimately have none (Project Settings > Milestone keywords).',
}
```

- [ ] **Step 2: `dict.ts` 등록**

`src/lib/i18n/dict.ts` — import 블록 끝에 추가:

```ts
import { portfolioKo, portfolioEn } from './dict/portfolio'
```

`ko` 스프레드 목록 끝(`...accountKo,` 다음)에 `...portfolioKo,`, `en` 쪽(`...accountEn,` 다음)에 `...portfolioEn,` 추가.

- [ ] **Step 3: `common.ts` nav 키**

`src/lib/i18n/dict/common.ts` — `'nav.usage': '사용 현황',` 다음 줄에:

```ts
  'nav.portfolio': '포트폴리오',
```

en 쪽 `'nav.usage': 'Usage',` 다음 줄에:

```ts
  'nav.portfolio': 'Portfolio',
```

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: portfolio 관련 에러 0건 (키 패리티는 Record 타입이 검증)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n/dict/portfolio.ts src/lib/i18n/dict.ts src/lib/i18n/dict/common.ts
git commit -m "feat(portfolio): i18n 사전 — pf.* 네임스페이스 + nav.portfolio"
```

---

### Task 3: 데이터 로더 — `getPortfolioInputs`

**Files:**
- Create: `src/lib/data/portfolio.ts`

**Interfaces:**
- Consumes: `PortfolioProjectInput` (Task 1), `getComputedWbs` (`src/lib/data/wbs.ts`), `getProjectConfig` (`src/lib/data/projectConfig.ts`), `listProjectsWithState` (`src/app/actions/project.ts`), `createServerClient`, `seoulToday`
- Produces: `getPortfolioInputs(): Promise<{ inputs: PortfolioProjectInput[]; leadersDegraded: boolean; listDegraded: boolean }>` — Task 5 페이지가 호출.

- [ ] **Step 1: 구현**

`src/lib/data/portfolio.ts`:

```ts
import { createServerClient } from '@/lib/supabase/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectConfig } from '@/lib/data/projectConfig'
import { listProjectsWithState } from '@/app/actions/project'
import { seoulToday } from '@/lib/domain/dates'
import type { PortfolioProjectInput } from '@/lib/domain/portfolio'

/**
 * 포트폴리오 입력 일괄 로드 — 프로젝트 N개를 병렬로 읽는다(/projects 홈과 같은 패턴).
 * 개별 프로젝트 실패는 그 행만 degraded(items null)로 격리한다 — 한 프로젝트 장애로
 * 전사 화면을 죽이지 않되, 실패를 '데이터 없음'으로 위장하지 않는다(3원칙).
 * 호출 전제: canViewPortfolio 통과(슈퍼유저) — listProjectsWithState 의 canSeeProject 는
 * 슈퍼유저에게 비공개(0070) 포함 전체를 반환한다.
 */
export async function getPortfolioInputs(): Promise<{
  inputs: PortfolioProjectInput[]
  leadersDegraded: boolean
  listDegraded: boolean
}> {
  const { projects, degraded: listDegraded } = await listProjectsWithState()
  const ids = projects.map(p => p.id)

  // PM(리더) = project_members.role='admin' — IN 한 방(getProjectsCompletion 선례).
  // 표시 전용이라 실패해도 throw 하지 않지만, '리더 없음'으로 위장하지 않도록 플래그로 신호한다.
  const sb = await createServerClient()
  let leadersDegraded = false
  const leadersByProject = new Map<string, string[]>()
  if (ids.length) {
    const { data, error } = await sb
      .from('project_members')
      .select('project_id, name')
      .eq('role', 'admin')
      .in('project_id', ids)
    if (error) {
      console.error('[portfolio] 리더 조회 실패:', error.message)
      leadersDegraded = true
    }
    for (const r of data ?? []) {
      const arr = leadersByProject.get(r.project_id as string) ?? []
      arr.push(r.name as string)
      leadersByProject.set(r.project_id as string, arr)
    }
  }

  const inputs = await Promise.all(projects.map(async (p): Promise<PortfolioProjectInput> => {
    const row = p as typeof p & { base_date?: string | null; is_private?: boolean }
    const base = {
      projectId: p.id, name: p.name,
      isPrivate: row.is_private === true,
      startDate: p.start_date ?? null, endDate: p.end_date ?? null,
      baseDate: row.base_date ?? null,
      leaders: leadersByProject.get(p.id) ?? [],
    }
    try {
      const [wbs, config] = await Promise.all([getComputedWbs(p.id), getProjectConfig(p.id)])
      return { ...base, today: wbs.today, items: wbs.items, milestoneKeywords: config.milestoneKeywords }
    } catch (e) {
      console.error(`[portfolio] 프로젝트 로드 실패 — 행을 degraded 로 표시: ${p.name}(${p.id})`, e)
      return { ...base, today: seoulToday(), items: null, milestoneKeywords: [] }
    }
  }))

  return { inputs, leadersDegraded, listDegraded }
}
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 에러 0건

- [ ] **Step 3: 커밋**

```bash
git add src/lib/data/portfolio.ts
git commit -m "feat(portfolio): 전 프로젝트 일괄 로더 — 개별 실패는 행 단위 degraded 격리

리더 조회 실패는 '리더 없음'으로 위장하지 않고 leadersDegraded 플래그로 화면에 전달."
```

---

### Task 4: 화면 컴포넌트 3종

**Files:**
- Create: `src/components/portfolio/PortfolioKpis.tsx`
- Create: `src/components/portfolio/PortfolioTable.tsx`
- Create: `src/components/portfolio/PortfolioMilestoneBoard.tsx`

**Interfaces:**
- Consumes: `PortfolioRow`/`PortfolioModel`/`PortfolioMilestone` (Task 1), `pf.*` 키 (Task 2), `SIGNAL_META` (`src/components/dashboard/signalStyle.ts`), `SectionCard`, `Stat`/`CountBadge`/`MiniEmpty` (`src/components/dashboard/bits.tsx`), `fmtDate` (`src/components/wbs/shared.tsx`), `projectColorClass` (`src/lib/domain/projectColors.ts`), `diffDaysCal`/`addDaysCal`/`MilestoneStatus` (`src/lib/domain/dashboard.ts`)
- Produces: `PortfolioKpis({ totals, locale })`, `PortfolioTable({ rows, leadersDegraded, locale })`, `PortfolioMilestoneBoard({ rows, milestones, today, locale })` — Task 5 페이지가 조립.

모두 서버 컴포넌트(‘use client’ 없음), 집계는 하지 않고 렌더만 한다.

- [ ] **Step 1: KPI 스트립**

`src/components/portfolio/PortfolioKpis.tsx`:

```tsx
import { Stat } from '@/components/dashboard/bits'
import type { PortfolioModel } from '@/lib/domain/portfolio'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

/** 상단 KPI — 프로젝트 수·신호 분포·지연 종료·집계 실패. 집계는 buildPortfolio 가 끝냈다. */
export function PortfolioKpis({ totals, locale }: { totals: PortfolioModel['totals']; locale: Locale }) {
  const tr = (k: DictKey) => t(locale, k)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label={tr('pf.kpi.projects')} value={totals.count} />
      <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{tr('pf.kpi.signals')}</div>
        <div className="mt-1.5 flex items-center gap-3 text-lg font-bold tabular-nums leading-none">
          <span className="inline-flex items-center gap-1.5 text-delayed"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-delayed" />{totals.red}</span>
          <span className="inline-flex items-center gap-1.5 text-accent-warning"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent-warning" />{totals.amber}</span>
          <span className="inline-flex items-center gap-1.5 text-done"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-done" />{totals.green}</span>
          <span className="inline-flex items-center gap-1.5 text-ink-subtle"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-ink-subtle" />{totals.neutral}</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-muted">{tr('pf.kpi.signalsSub')}</div>
      </div>
      <Stat label={tr('pf.kpi.overdue')} value={totals.overdue} tone={totals.overdue > 0 ? 'text-delayed' : undefined} />
      <Stat label={tr('pf.kpi.degraded')} value={totals.degraded}
        tone={totals.degraded > 0 ? 'text-delayed' : undefined}
        sub={totals.degraded > 0 ? tr('pf.kpi.degradedSub') : undefined} />
    </div>
  )
}
```

- [ ] **Step 2: 비교 테이블**

`src/components/portfolio/PortfolioTable.tsx`:

```tsx
import Link from 'next/link'
import { Briefcase, Lock, ArrowRight } from 'lucide-react'
import type { PortfolioRow } from '@/lib/domain/portfolio'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from '@/components/dashboard/signalStyle'
import { SectionCard } from '@/components/ui/SectionCard'
import { CountBadge, MiniEmpty } from '@/components/dashboard/bits'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

const SIGNAL_LABEL: Record<Signal, DictKey> = {
  green: 'pf.signal.green', amber: 'pf.signal.amber', red: 'pf.signal.red', neutral: 'pf.signal.neutral',
}
const STATUS_CHIP: Record<ProjectLifecycleStatus, { labelKey: DictKey; chip: string; dot: string }> = {
  ready: { labelKey: 'pf.status.ready', chip: 'bg-pending-weak text-pending', dot: 'bg-pending' },
  active: { labelKey: 'pf.status.active', chip: 'bg-brand-weak text-brand', dot: 'bg-brand' },
  overdue: { labelKey: 'pf.status.overdue', chip: 'bg-delayed-weak text-delayed', dot: 'bg-delayed' },
  done: { labelKey: 'pf.status.done', chip: 'bg-done-weak text-done', dot: 'bg-done' },
  unknown: { labelKey: 'pf.status.unknown', chip: 'bg-surface-2 text-ink-muted', dot: 'bg-ink-subtle' },
}

const th = 'px-2 py-2 font-semibold'

export function PortfolioTable({ rows, leadersDegraded, locale }: {
  rows: PortfolioRow[]; leadersDegraded: boolean; locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  if (rows.length === 0) {
    return (
      <SectionCard eyebrow="PORTFOLIO" title={tr('pf.table.title')} icon={Briefcase}>
        <MiniEmpty text={tr('pf.empty')} />
      </SectionCard>
    )
  }
  return (
    <SectionCard eyebrow="PORTFOLIO" title={tr('pf.table.title')} icon={Briefcase}
      actions={<CountBadge n={rows.length} unit={tr('pf.unit')} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
              <th className={th}>{tr('pf.col.signal')}</th>
              <th className={th}>{tr('pf.col.project')}</th>
              <th className={th}>{tr('pf.col.progress')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.variance')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.spi')}</th>
              <th className={th}>{tr('pf.col.end')}</th>
              <th className={th}>{tr('pf.col.milestone')}</th>
              <th className={th}>{tr('pf.col.pm')}</th>
              <th className={th}>{tr('pf.col.status')}</th>
              <th className="px-2 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const s = STATUS_CHIP[row.lifecycle]
              const signal = row.exec?.overall.signal ?? 'neutral'
              const m = SIGNAL_META[signal]
              const Icon = m.icon
              const ms = row.exec?.milestone ?? null
              const sched = row.exec?.schedule ?? null
              return (
                <tr key={row.projectId} className="border-b border-line/60 transition hover:bg-surface-2/60">
                  <td className="px-2 py-2.5">
                    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.chip}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden />{tr(SIGNAL_LABEL[signal])}
                    </span>
                  </td>
                  <td className="max-w-[220px] px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`}
                      className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-brand hover:underline">
                      {row.isPrivate && <Lock className="h-3 w-3 shrink-0 text-ink-subtle" aria-label={tr('pf.private')} />}
                      <span className="truncate">{row.name}</span>
                    </Link>
                    {row.baseDate && (
                      <div className="mt-0.5 text-[10px] text-ink-subtle">{tr('pf.baseDate')} {fmtDate(row.baseDate)}</div>
                    )}
                  </td>
                  {row.degraded ? (
                    <td colSpan={5} className="px-2 py-2.5 text-[11px] text-delayed">{tr('pf.degradedRow')}</td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        <span className="font-semibold text-ink">{row.exec!.progress.actual}%</span>
                        <span className="text-ink-subtle"> / {row.exec!.progress.planned}%</span>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums ${row.exec!.progress.variance < 0 ? 'text-delayed' : 'text-done'}`}>
                        {row.exec!.progress.variance > 0 ? '+' : ''}{row.exec!.progress.variance}%p
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink">
                        {row.spi != null ? row.spi.toFixed(2) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        {sched?.projectedEnd ? (
                          <>
                            <span className="text-ink">{fmtDate(sched.projectedEnd)}</span>
                            {sched.slipDays != null && (
                              <span className={`ml-1 text-[10px] font-semibold ${sched.slipDays > 0 ? 'text-delayed' : 'text-done'}`}>
                                {sched.slipDays > 0 ? `+${sched.slipDays}` : sched.slipDays}d
                              </span>
                            )}
                          </>
                        ) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className="max-w-[180px] whitespace-nowrap px-2 py-2.5">
                        {ms?.name ? (
                          <span className={ms.overdue ? 'text-delayed' : 'text-ink'}>
                            <span className="truncate align-middle">{ms.name}</span>
                            <span className="ml-1 text-[10px] font-semibold tabular-nums">
                              {ms.dday != null && (ms.dday >= 0 ? `D-${ms.dday}` : `D+${-ms.dday}`)}
                            </span>
                          </span>
                        ) : <span className="text-ink-subtle">—</span>}
                      </td>
                    </>
                  )}
                  <td className="max-w-[140px] truncate px-2 py-2.5 text-ink-muted">
                    {leadersDegraded ? tr('pf.leadersUnknown') : (row.leaders.join(', ') || '—')}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={`chip ${s.chip} whitespace-nowrap`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {tr(s.labelKey)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`} aria-label={`${row.name} 대시보드`}
                      className="text-ink-subtle transition hover:text-brand">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 3: 마일스톤 통합 타임라인**

`src/components/portfolio/PortfolioMilestoneBoard.tsx` — 프로젝트당 1행, 공통 시간축. 자체 SVG(의존성 0), 라벨은 dot `<title>` 툴팁(다행 밀집에서 텍스트 라벨은 겹침):

```tsx
import Link from 'next/link'
import { Flag } from 'lucide-react'
import type { PortfolioMilestone, PortfolioRow } from '@/lib/domain/portfolio'
import { diffDaysCal, addDaysCal, type MilestoneStatus } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { CountBadge, MiniEmpty } from '@/components/dashboard/bits'
import { fmtDate } from '@/components/wbs/shared'
import { projectColorClass } from '@/lib/domain/projectColors'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

const MS_TONE: Record<MilestoneStatus, string> = { done: 'fill-done', overdue: 'fill-delayed', upcoming: 'fill-brand' }
const W = 960, PL = 10, PR = 10, ROW_H = 26, BASE = 13

/** 축 범위 안의 매월 1일 (헤더 눈금) */
function monthTicks(axisStart: string, axisEnd: string): string[] {
  const ticks: string[] = []
  let [y, m] = axisStart.split('-').map(Number)
  if (axisStart.slice(8) !== '01') { m += 1; if (m > 12) { m = 1; y += 1 } }
  for (;;) {
    const d = `${y}-${String(m).padStart(2, '0')}-01`
    if (d > axisEnd) break
    ticks.push(d)
    m += 1; if (m > 12) { m = 1; y += 1 }
  }
  return ticks
}

/** 전 프로젝트 마일스톤을 공통 시간축 위에 프로젝트당 1행으로. 상세 라벨은 dot 툴팁. */
export function PortfolioMilestoneBoard({ rows, milestones, today, locale }: {
  rows: PortfolioRow[]; milestones: PortfolioMilestone[]; today: string; locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  const byProject = new Map<string, PortfolioMilestone[]>()
  for (const ms of milestones) {
    const arr = byProject.get(ms.projectId) ?? []
    arr.push(ms)
    byProject.set(ms.projectId, arr)
  }
  // 행 순서는 비교 테이블과 동일(rows 정렬 유지) — 마일스톤 있는 프로젝트만
  const board = rows.filter(r => (byProject.get(r.projectId)?.length ?? 0) > 0)

  if (board.length === 0) {
    return (
      <SectionCard eyebrow="MILESTONES" title={tr('pf.ms.title')} icon={Flag}>
        <MiniEmpty text={tr('pf.ms.empty')} />
      </SectionCard>
    )
  }

  // 공통 축: 프로젝트 기간 ∪ 마일스톤 날짜의 최소~최대
  const dates = [
    ...board.flatMap(r => [r.startDate, r.endDate].filter((d): d is string => d != null)),
    ...milestones.map(m => m.date),
  ].sort()
  let axisStart = dates[0]
  let axisEnd = dates[dates.length - 1]
  if (axisStart >= axisEnd) { axisStart = addDaysCal(axisStart, -14); axisEnd = addDaysCal(axisEnd, 14) }
  const total = diffDaysCal(axisStart, axisEnd)
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(axisStart, d))) / total) * (W - PL - PR)
  const todayIn = today >= axisStart && today <= axisEnd
  const ticks = monthTicks(axisStart, axisEnd)
  const projectIds = board.map(r => r.projectId)

  return (
    <SectionCard eyebrow="MILESTONES" title={tr('pf.ms.title')} icon={Flag}
      actions={<CountBadge n={milestones.length} unit={tr('pf.unit')} />}>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* 헤더: 월 눈금 + 오늘 */}
          <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-2">
            <div />
            <svg viewBox={`0 0 ${W} 18`} className="h-auto w-full" aria-hidden>
              {ticks.map(d => (
                <g key={d}>
                  <line x1={x(d)} x2={x(d)} y1={12} y2={18} className="stroke-line" strokeWidth={1} />
                  <text x={x(d)} y={9} textAnchor="middle" fontSize={9} className="fill-ink-subtle">
                    {d.slice(2, 7).replace('-', '.')}
                  </text>
                </g>
              ))}
              {todayIn && (
                <text x={x(today)} y={9} textAnchor="middle" fontSize={9} className="fill-delayed font-semibold">
                  {fmtDate(today)}
                </text>
              )}
            </svg>
          </div>
          {board.map(row => (
            <div key={row.projectId} className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-2 border-t border-line/60">
              <Link href={`/p/${row.projectId}/dashboard`}
                className="flex min-w-0 items-center gap-1.5 py-1 text-xs font-medium text-ink hover:text-brand">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${projectColorClass(projectIds, row.projectId)}`} />
                <span className="truncate">{row.name}</span>
              </Link>
              <svg viewBox={`0 0 ${W} ${ROW_H}`} className="h-auto w-full" role="img"
                aria-label={`${row.name} ${tr('pf.ms.title')}`}>
                <line x1={PL} x2={W - PR} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={1.5} />
                {row.startDate && <line x1={x(row.startDate)} x2={x(row.startDate)} y1={BASE - 5} y2={BASE + 5} className="stroke-line-strong" strokeWidth={1.5} />}
                {row.endDate && <line x1={x(row.endDate)} x2={x(row.endDate)} y1={BASE - 5} y2={BASE + 5} className="stroke-line-strong" strokeWidth={1.5} />}
                {todayIn && <line x1={x(today)} x2={x(today)} y1={2} y2={ROW_H - 2} className="stroke-delayed" strokeWidth={1} strokeDasharray="2 3" />}
                {(byProject.get(row.projectId) ?? []).map(p => (
                  <circle key={p.id} cx={x(p.date)} cy={BASE} r={4.5} className={MS_TONE[p.status]}>
                    <title>{`${p.name} · ${fmtDate(p.date)}${p.status === 'upcoming' ? ` · D-${p.dday}` : ''}`}</title>
                  </circle>
                ))}
              </svg>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 에러 0건

- [ ] **Step 5: 커밋**

```bash
git add src/components/portfolio/PortfolioKpis.tsx src/components/portfolio/PortfolioTable.tsx src/components/portfolio/PortfolioMilestoneBoard.tsx
git commit -m "feat(portfolio): 화면 컴포넌트 — KPI 스트립·비교 테이블·마일스톤 통합 타임라인

집계는 buildPortfolio 가 끝냈고 컴포넌트는 조립만(대시보드 원칙). 차트는 자체 SVG(의존성 0),
degraded 행은 지표 대신 실패 문구를 그대로 노출(빈 값 위장 금지)."
```

---

### Task 5: 페이지 라우트 + loading

**Files:**
- Create: `src/app/(app)/portfolio/page.tsx`
- Create: `src/app/(app)/portfolio/loading.tsx`

**Interfaces:**
- Consumes: `canViewPortfolio` (Task 1), `getPortfolioInputs` (Task 3), `buildPortfolio` (Task 1), 컴포넌트 3종 (Task 4), `getActorForView` (`src/lib/authz`), `recordProgressSnapshot` (`src/lib/data/snapshots.ts`), `PageHero`, `getServerLocale`, `seoulToday`, `Skeleton`/`CardSkeleton` (`src/components/ui/Skeleton`)
- Produces: `/portfolio` 라우트 — Task 6 메뉴가 링크.

- [ ] **Step 1: 페이지**

`src/app/(app)/portfolio/page.tsx`:

```tsx
import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { getActorForView } from '@/lib/authz'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import { createServerClient } from '@/lib/supabase/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { getPortfolioInputs } from '@/lib/data/portfolio'
import { buildPortfolio } from '@/lib/domain/portfolio'
import { PageHero } from '@/components/ui/PageHero'
import { PortfolioKpis } from '@/components/portfolio/PortfolioKpis'
import { PortfolioTable } from '@/components/portfolio/PortfolioTable'
import { PortfolioMilestoneBoard } from '@/components/portfolio/PortfolioMilestoneBoard'
import { getServerLocale } from '@/lib/i18n/server'
import { t } from '@/lib/i18n/dict'
import { seoulToday } from '@/lib/domain/dates'

export const dynamic = 'force-dynamic' // 전사 비교 화면은 항상 최신이어야 한다

export default async function PortfolioPage() {
  // 슈퍼유저 전용 — 판정은 canViewPortfolio 한 곳에서. 사이드바 어포던스도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!canViewPortfolio(actor)) redirect('/projects')

  const [{ inputs, leadersDegraded, listDegraded }, locale] = await Promise.all([
    getPortfolioInputs(), getServerLocale(),
  ])
  const model = buildPortfolio(inputs)

  // 포트폴리오 조회를 스냅샷 기회로 — 아무도 열지 않는 프로젝트의 이력 공백을 메운다.
  // after() 안에서는 cookies() 불가라 client 를 밖에서 만들어 넘긴다(recordProgressSnapshot 관례).
  const sb = await createServerClient()
  after(() => Promise.all(inputs.map(i => recordProgressSnapshot(i.projectId, sb))))

  return (
    <div className="space-y-6 pb-10">
      <PageHero title={t(locale, 'pf.title')} />
      {listDegraded && (
        <div className="rounded-xl border border-delayed/40 bg-delayed-weak px-4 py-3 text-xs font-medium text-delayed">
          {t(locale, 'pf.listDegraded')}
        </div>
      )}
      <PortfolioKpis totals={model.totals} locale={locale} />
      <PortfolioTable rows={model.rows} leadersDegraded={leadersDegraded} locale={locale} />
      {/* 통합 축의 오늘 마커는 실제 오늘 — 행별 마일스톤 상태(dday)는 각 프로젝트 today 로 이미 판정됨 */}
      <PortfolioMilestoneBoard rows={model.rows} milestones={model.milestones} today={seoulToday()} locale={locale} />
    </div>
  )
}
```

- [ ] **Step 2: loading 스켈레톤** (최종 레이아웃과 모양 일치 — dashboard/loading.tsx 관례)

`src/app/(app)/portfolio/loading.tsx`:

```tsx
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="포트폴리오를 불러오는 중">
      {/* PageHero */}
      <Skeleton className="h-14 w-full rounded-2xl" />
      {/* KPI 4타일 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      {/* 비교 테이블 카드 */}
      <CardSkeleton lines={6} />
      {/* 마일스톤 타임라인 카드 */}
      <CardSkeleton lines={4} />
    </div>
  )
}
```

- [ ] **Step 3: 수동 검증(로컬)**

Run: `npm run dev` 후 슈퍼유저 계정으로 `http://localhost:3000/portfolio` 접속(로컬 dev 기본은 스테이징 DB).
Expected: KPI·테이블·타임라인 렌더, 행 클릭 시 `/p/{id}/dashboard` 이동. 비슈퍼유저(또는 시크릿 창 멤버 계정)는 `/projects` 로 redirect.
샌드박스라 브라우저 확인이 불가하면: `npm run test && npx tsc --noEmit` 으로 대체하고 화면 확인은 Task 7 배포 후로 미룬다(verify 스킬 관례).

- [ ] **Step 4: 커밋**

```bash
git add "src/app/(app)/portfolio/page.tsx" "src/app/(app)/portfolio/loading.tsx"
git commit -m "feat(portfolio): /portfolio 라우트 — 슈퍼유저 가드 + 단일 왕복 로드 + 스냅샷 일괄 upsert

조회 자체를 스냅샷 기회로 써서 '안 여는 프로젝트는 이력 공백' 문제를 함께 해소."
```

---

### Task 6: 메뉴 노출 — UI 위험 파일 (사이드바·헤더·layout)

**Files:**
- Modify: `src/app/(app)/layout.tsx:51-67` (identity 스냅샷), `:86` (Sidebar prop)
- Modify: `src/components/app/Sidebar.tsx:40-58` (projectMenu), `:60` (props), `:280-288` (전역 분기)
- Modify: `src/components/app/HeaderChrome.tsx:30-36` (HeaderIdentity), `:342-345` (MobileMenu)

⚠️ 셋 다 UI 위험 파일 — 빌드·테스트로 깨짐이 안 잡힌다. 이 태스크는 반드시 별도 커밋으로 남기고(문제 시 단독 revert), Task 7 에서 브랜치 push → Preview → main 순서를 지킨다.

**Interfaces:**
- Consumes: `canViewPortfolio` (Task 1), `nav.portfolio` 키 (Task 2), `/portfolio` 라우트 (Task 5)
- Produces: 없음 (말단)

- [ ] **Step 1: layout — showPortfolio 플래그**

`src/app/(app)/layout.tsx` — import 에 추가:

```ts
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
```

identity 정상 분기(`showUsage: canViewUsage(actor),` 다음 줄)에:

```ts
        showPortfolio: canViewPortfolio(actor),
```

degraded 분기(`showUsage: false,` 다음 줄)에:

```ts
        showPortfolio: false,
```

Sidebar 호출(86행)을:

```tsx
<Sidebar projects={projectLinks} showUsage={identity?.showUsage ?? false} showPortfolio={identity?.showPortfolio ?? false} />
```

- [ ] **Step 2: Sidebar — 메뉴 2곳**

`src/components/app/Sidebar.tsx` — lucide import 목록에 `Briefcase` 추가.

`projectMenu` 시그니처와 push 부분(40·54-57행)을:

```ts
function projectMenu(base: string, showUsage: boolean, showPortfolio: boolean): { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] {
  // …기존 items 배열 그대로…
  // 포트폴리오·사용 현황은 전사 지표라 프로젝트 스코프가 아니다 — 설정 아래에 두되 전역 링크. 슈퍼유저 전용.
  if (showPortfolio) items.push({ href: '/portfolio', labelKey: 'nav.portfolio', icon: Briefcase, match: '/portfolio' })
  if (showUsage) items.push({ href: '/usage', labelKey: 'nav.usage', icon: BarChart3, match: '/usage' })
  return items
}
```

컴포넌트 시그니처(60행):

```ts
export function Sidebar({ projects, showUsage = false, showPortfolio = false }: { projects: SidebarProject[]; showUsage?: boolean; showPortfolio?: boolean }) {
```

호출부(241행) `projectMenu(`/p/${menuProjectId}`, showUsage)` → `projectMenu(`/p/${menuProjectId}`, showUsage, showPortfolio)`.

프로젝트 미선택 전역 분기 — 기존 `{showUsage && (…/usage 링크…)}` 블록 **바로 앞**에 같은 형태로:

```tsx
{/* 프로젝트를 고르지 않은 상태에서도 포트폴리오에 닿을 수 있어야 한다 — 슈퍼유저 전용 */}
{showPortfolio && (
  <Tooltip label={t('nav.portfolio')} side="right" disabled={!collapsed}>
    <Link href="/portfolio" aria-current={pathname === '/portfolio' ? 'page' : undefined}
      className={`side-link ${pathname === '/portfolio' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
      <Briefcase className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.portfolio')}</span>}
    </Link>
  </Tooltip>
)}
```

- [ ] **Step 3: HeaderChrome — 모바일 진입점**

`src/components/app/HeaderChrome.tsx` — `HeaderIdentity`(30행) 에 필드 추가:

```ts
  showPortfolio: boolean
```

MobileMenu 의 `/usage` 링크(343-345행) **바로 앞**에:

```tsx
{/* 사이드바는 hidden lg:flex 라 lg 미만에서는 여기가 /portfolio 의 유일한 진입점이다 — 슈퍼유저 전용 */}
{identity?.showPortfolio && (
  <Link href="/portfolio" onClick={onClose} aria-current={pathname === '/portfolio' ? 'page' : undefined} className={`side-link ${pathname === '/portfolio' ? 'side-link-active' : ''}`}>{t('nav.portfolio')}</Link>
)}
```

- [ ] **Step 4: 타입·테스트 확인**

Run: `npx tsc --noEmit 2>&1 | head -20 && npm run test 2>&1 | tail -5`
Expected: 타입 에러 0건, 기존 테스트 전체 PASS (HeaderIdentity 필드 추가로 layout 외 다른 조립처가 있으면 타입 에러로 드러난다 — 나오면 그 조립처에도 `showPortfolio: false` 또는 판정값을 채운다)

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/layout.tsx" src/components/app/Sidebar.tsx src/components/app/HeaderChrome.tsx
git commit -m "feat(portfolio): 사이드바·헤더 메뉴 노출 — showUsage 와 동일한 슈퍼유저 플래그 방식

UI 위험 파일 3종만 담은 단독 커밋(문제 시 이 커밋만 revert). 판정은 canViewPortfolio 를
페이지 가드와 공유해 어포던스와 접근 제어가 어긋나지 않게 한다."
```

---

### Task 7: 전체 검증 → Preview → main 반영 → 배포 확인

**Files:** 코드 변경 없음 (검증·배포 절차)

- [ ] **Step 1: 로컬 전체 검증**

```bash
npm run lint && npm run test
```

Expected: 둘 다 초록. 실패 시 해당 태스크로 돌아가 수정 후 재실행.

- [ ] **Step 2: 프로덕션 빌드 (buildskip 우회)**

로컬 build 는 `_workspace` 스크래치 ts 때문에 실패할 수 있다(Vercel 과 무관). 우회:

```bash
for f in _workspace/*.ts; do [ -e "$f" ] && mv "$f" "$f.buildskip"; done
npm run build
for f in _workspace/*.ts.buildskip; do [ -e "$f" ] && mv "$f" "${f%.buildskip}"; done
```

Expected: `npm run build` 성공. (`_workspace` 경로가 다르면 빌드 에러가 가리키는 스크래치 파일을 같은 방식으로 개명.)

- [ ] **Step 3: 브랜치 push → Preview**

```bash
git push -u origin HEAD
```

Expected: push 성공(pre-push G1~G4 통과 — 마이그레이션 없음, UI 커밋은 브랜치 push 라 G2 무관). Vercel 이 Preview 를 빌드한다 — **Preview 는 Supabase 로그인이 안 되므로 빌드 성공 여부만 확인**(G2 속도 방지턱 목적).

- [ ] **Step 4: main 반영 (ff push — worktree 에서 main 체크아웃 불필요)**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

Expected: push 성공(브랜치 커밋은 이미 원격에 있어 G2 통과). `--is-ancestor` 가 실패하면 origin/main 이 앞서간 것 — `git merge origin/main` 후 테스트 재실행하고 다시 push.

- [ ] **Step 5: 배포 후 확인**

```bash
npm run smoke:prod
```

Expected: 스모크 통과. 이후 **사용자 눈확인 체크리스트** (Preview 로 검증 불가한 UI 위험 파일 변경분):

1. 슈퍼유저 계정 — 사이드바(프로젝트 선택/미선택 모두)와 모바일 드로어에 '포트폴리오' 메뉴 표시
2. `/portfolio` — KPI 4타일·비교 테이블(신호등/진척/SPI/예상종료/마일스톤/PM/상태)·마일스톤 타임라인 렌더
3. 행 클릭 → 해당 프로젝트 대시보드 이동, 표의 진척·SPI 값이 그 대시보드와 일치
4. 비슈퍼유저 계정 — 메뉴 미표시 + `/portfolio` 직접 접근 시 `/projects` redirect
5. 기존 화면 회귀 없음(사이드바·헤더 정상)

확인 완료 후:

```bash
npm run mark:good
```

- [ ] **Step 6: 마무리**

작업 완료를 보고하고, v2 백로그(경영진 공유 링크·담당자 충돌·프로젝트 간 선후행)는 스펙 §1 에 남아 있음을 알린다.

---

## Self-Review 결과 (계획 작성 후 점검)

- 스펙 커버리지: §3(라우트·권한)=Task 1·5·6, §4(로딩)=Task 3·5, §5(도메인)=Task 1, §6(화면·i18n)=Task 2·4, §7(에러)=Task 1·3·4(degraded 경로), §8(테스트)=Task 1·7, §9(배포)=Task 7. 누락 없음.
- 플레이스홀더: 없음 — 전 태스크 실코드 포함.
- 타입 일관성: `PortfolioRow`/`PortfolioModel`/`getPortfolioInputs` 반환형이 Task 1↔3↔4↔5 에서 동일 시그니처로 사용됨. `HeaderIdentity.showPortfolio` 추가에 따른 타 조립처 누락은 Task 6 Step 4 의 tsc 가 잡는다.
