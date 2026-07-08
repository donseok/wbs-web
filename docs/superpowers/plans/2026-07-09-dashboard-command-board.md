# 대시보드 지휘 상황판 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/p/[projectId]/dashboard` 의 공지사항 줄 아래 전 영역을 「여정 · 조치 · 병목」 3열 상황판 + 접이식 2그룹으로 교체한다.

**Architecture:** 계산은 전부 `src/lib/domain/` 순수 함수로 내려 React 없이 단위 테스트한다. 카드 셋은 전부 RSC(클라이언트 훅 0)이고, 여정만 손으로 쓴 SVG, 병목은 접근성을 위해 진짜 `<table>`이다. DB 스키마 변경·마이그레이션·크론 없음.

**Tech Stack:** Next.js App Router (RSC), TypeScript, Tailwind v4 (`@theme`, `@container`), vitest (`environment: 'node'`, alias `@ → src`), Supabase.

**Branch:** `feat/dashboard-command-board` (스펙 커밋 `111a604` 위에서 작업)

**Spec:** `docs/superpowers/specs/2026-07-09-dashboard-command-board-design.md`

---

## File Structure

### 신규 — 도메인 (순수, React 없음)

| 파일 | 책임 |
|---|---|
| `src/lib/domain/attention.ts` | 조치 행 모델 · 전순서 comparator |
| `src/lib/domain/bottleneck.ts` | 단계×팀 셀 상태 격자 |
| `src/lib/domain/journey.ts` | 계획 곡선 샘플 · 단계 밴드 · 마일스톤 · 예측 |

### 신규 — 컴포넌트 (전부 RSC)

| 파일 | 책임 |
|---|---|
| `src/components/dashboard/primitives.tsx` | `CountBadge` · `Stat` · `MiniEmpty` (DashboardView 내부에서 승격) |
| `src/components/dashboard/JourneyCard.tsx` | 여정 SVG |
| `src/components/dashboard/ActionCard.tsx` | 조치 리스트 + 링크 행 |
| `src/components/dashboard/BottleneckCard.tsx` | 병목 `<table>` |

### 신규 — 테스트

`tests/domain/bizDayIndex.test.ts` · `tests/domain/plannedAt.test.ts` · `tests/domain/attention.test.ts` · `tests/domain/bottleneck.test.ts` · `tests/domain/journey.test.ts` · `tests/ui/dashboard-accordion-prefs.test.tsx`

### 수정

| 파일 | 변경 |
|---|---|
| `src/lib/domain/dates.ts` | `makeBizDayIndex` 추가 (기존 함수 불변) |
| `src/lib/domain/tree.ts` | `TEAMS` · `primaryTeamOf` export, `subActTeamRank`가 재사용 |
| `src/lib/domain/rollup.ts` | `siblingWeight` export, `weightedMean` 공유 결합 규칙, `plannedRollupAt` · `overallPlannedAt` · `leafWeightShares` 추가 |
| `src/lib/domain/dashboard.ts` | `ScheduleModel.earlyFloor`, `RiskModel.attention`, `attentionLeaves`, `milestoneLeaves` |
| `src/lib/report/model.ts` | `REPORT_TEAMS` → `tree.ts`의 `TEAMS` 재수출 (사본 제거) |
| `src/components/ui/SectionCard.tsx` | `fill` · `bodyClassName` 옵트인 |
| `src/components/dashboard/ExecSummary.tsx` | 리스크 타일 → `s.risk.attention` |
| `src/components/dashboard/DetailAccordion.tsx` | 저장 시 죽은 group id 필터 |
| `src/components/dashboard/DashboardView.tsx` | 491줄 → 조립만 |
| `src/app/(app)/p/[projectId]/dashboard/page.tsx` | `Promise.all` 6→4, `holidays` 추가 |
| `src/app/globals.css` | `.hatch`, `.dark { --color-today }` |
| `src/lib/i18n/dict/dashboard.ts` | 키 삭제·추가 |

### 스펙에서 벗어난 결정 1건

스펙 §5.2는 "`computeNode`가 `plannedRollupAt`을 호출하도록 리팩터"라고 썼다. **그러면 O(n²)이 된다** — `computeNode`는 이미 상향식 1패스로 자식 값을 갖고 있는데, 노드마다 서브트리를 다시 도는 함수를 부르게 되기 때문이다.

대신 **결합 규칙만 공유**한다: `weightedMean(children, valueOf)`. `computeNode`와 `plannedRollupAt`이 같은 가중·같은 반올림을 쓰고, 둘이 오늘 날짜에서 일치한다는 것을 Task 2의 불변식 테스트가 강제한다. 목적(단일 진실)은 지키고 O(n)을 유지한다.

---

## Task 1: 업무일 prefix-sum 인덱스

순진한 `plannedPct` 호출은 하루당 `Date` 할당 + `toISOString()`을 하고, 40샘플 × 157노드면 렌더당 107ms(최악 1.2s)다. 프로젝트 창을 1회 스캔해 누적 업무일 표를 만든다.

**Files:**
- Modify: `src/lib/domain/dates.ts` (기존 export는 건드리지 않는다 — `dates.test.ts`, `edgecases.test.ts`가 고정)
- Test: `tests/domain/bizDayIndex.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/bizDayIndex.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { businessDaysBetween, makeBizDayIndex } from '@/lib/domain/dates'

const H = new Set(['2026-07-17'])          // 제헌절 (금)
const idx = makeBizDayIndex('2026-07-01', '2026-07-31', H)

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

describe('makeBizDayIndex', () => {
  it('창 안의 모든 (a,b) 쌍에서 businessDaysBetween과 동일하다', () => {
    const days = eachDay('2026-07-01', '2026-07-31')
    for (const a of days) for (const b of days) {
      expect(idx.between(a, b)).toBe(businessDaysBetween(a, b, H))
    }
  })

  it('b < a 이면 0', () => {
    expect(idx.between('2026-07-10', '2026-07-01')).toBe(0)
  })

  it('같은 날: 평일 1, 주말 0, 공휴일 0', () => {
    expect(idx.between('2026-07-01', '2026-07-01')).toBe(1)   // 수
    expect(idx.between('2026-07-04', '2026-07-04')).toBe(0)   // 토
    expect(idx.between('2026-07-17', '2026-07-17')).toBe(0)   // 공휴일
  })

  it('창 밖 날짜는 businessDaysBetween으로 폴백한다', () => {
    expect(idx.between('2026-06-29', '2026-07-03')).toBe(businessDaysBetween('2026-06-29', '2026-07-03', H))
    expect(idx.between('2026-07-28', '2026-08-05')).toBe(businessDaysBetween('2026-07-28', '2026-08-05', H))
  })

  it('Date 객체를 재할당하지 않는다 — 184일 창을 1000회 조회해도 10ms 미만', () => {
    const big = makeBizDayIndex('2026-07-01', '2026-12-31', H)
    const t0 = performance.now()
    for (let i = 0; i < 1000; i++) big.between('2026-07-01', '2026-12-31')
    expect(performance.now() - t0).toBeLessThan(10)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/bizDayIndex.test.ts`
Expected: FAIL — `makeBizDayIndex is not a function` (또는 import 에러)

- [ ] **Step 3: 최소 구현**

`src/lib/domain/dates.ts` 끝에 추가 (기존 코드 위·아래 모두 수정 금지):

```ts
/** 창 [start, end] 안에서 O(1) 업무일 계산. 창 밖은 businessDaysBetween으로 폴백. */
export interface BizDayIndex {
  /** a..b 양끝 포함 업무일 수. b < a 이면 0. */
  between(a: string, b: string): number
}

export function makeBizDayIndex(start: string, end: string, holidays: Set<string>): BizDayIndex {
  // cum[d] = start..d(포함) 업무일 수
  const cum = new Map<string, number>()
  let n = 0
  const endDt = parse(end)
  for (const cur = parse(start); cur <= endDt; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const d = fmt(cur)
    if (isBusinessDay(d, holidays)) n++
    cum.set(d, n)
  }
  const first = start, last = end
  return {
    between(a: string, b: string): number {
      if (b < a) return 0
      if (a < first || b > last) return businessDaysBetween(a, b, holidays)
      // between(a,b) = cum(b) − cum(a) + (a가 업무일이면 1)
      return cum.get(b)! - cum.get(a)! + (isBusinessDay(a, holidays) ? 1 : 0)
    },
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/bizDayIndex.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 기존 날짜 테스트가 무손상인지 확인한다**

Run: `npx vitest run tests/domain/dates.test.ts tests/domain/edgecases.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/dates.ts tests/domain/bizDayIndex.test.ts
git commit -m "feat(domain): makeBizDayIndex — 업무일 prefix-sum 인덱스 (TDD)"
```

---

## Task 2: 임의 날짜의 계획 롤업 + 리프 가중치 몫

**왜 중요한가.** `computeNode`(`rollup.ts:41-43`)는 비-리프의 `plannedPct`를 자식들의 가중평균으로 **덮어쓴다**. 곡선을 루트의 자체 날짜로 샘플링하면 오늘 지점에서 6.56%가 나오는데, 바로 위 게이지는 6%를 찍는다. 곡선은 **날짜 D에서 트리를 재귀 롤업**해야 한다.

**Files:**
- Modify: `src/lib/domain/rollup.ts`
- Test: `tests/domain/plannedAt.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/plannedAt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeTree, overallProgress, overallPlannedAt, leafWeightShares } from '@/lib/domain/rollup'
import { makeBizDayIndex } from '@/lib/domain/dates'
import { plannedPct } from '@/lib/domain/progress'
import type { WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const row = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

// P1(w .25) 07-01..07-10 · P2(w .75) 07-01..07-31, 각 리프 2개
const rows: WbsRow[] = [
  row({ id: 'P1', level: 'phase', weight: 0.25, plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
  row({ id: 'P2', level: 'phase', weight: 0.75, plannedStart: '2026-07-01', plannedEnd: '2026-07-31', sortOrder: 1 }),
  row({ id: 'a', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-03', actualPct: 100 }),
  row({ id: 'b', parentId: 'P1', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', sortOrder: 1 }),
  row({ id: 'c', parentId: 'P2', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  row({ id: 'd', parentId: 'P2', plannedStart: '2026-07-20', plannedEnd: '2026-07-31', sortOrder: 1 }),
]

const idx = makeBizDayIndex('2026-07-01', '2026-07-31', H)

describe('overallPlannedAt', () => {
  it('불변식: 오늘 값이 overallProgress().planned 와 일치한다', () => {
    for (const today of ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-31']) {
      const tree = computeTree(rows, today, H)
      expect(overallPlannedAt(tree, today, idx)).toBe(overallProgress(tree).planned)
    }
  })

  it('종점: 종료일에 100', () => {
    const tree = computeTree(rows, '2026-07-31', H)
    expect(overallPlannedAt(tree, '2026-07-31', idx)).toBe(100)
  })

  it('시작 전: 0', () => {
    const tree = computeTree(rows, '2026-07-01', H)
    expect(overallPlannedAt(tree, '2026-06-01', idx)).toBe(0)
  })

  it('단조 비감소', () => {
    const tree = computeTree(rows, '2026-07-31', H)
    const days = ['2026-07-01','2026-07-06','2026-07-13','2026-07-20','2026-07-27','2026-07-31']
    const vals = days.map(d => overallPlannedAt(tree, d, idx))
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1])
  })

  it('루트 자체 날짜 기준값과 롤업값은 다르다 — 롤업이 진실이다', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    // P1 자체 날짜: 07-01..07-10 = 8업무일, 07-08까지 6일 경과 → 75%
    // P1 롤업: a(07-01..07-03, 이미 지남)=100, b(07-06..07-10, 5중 3일)=60 → (100+60)/2 = 80
    expect(plannedPct('2026-07-01', '2026-07-10', '2026-07-08', H)).toBe(75)
    expect(tree[0].plannedPct).toBe(80)
  })
})

describe('leafWeightShares', () => {
  it('모든 리프 몫의 합이 1이다', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    const shares = leafWeightShares(tree)
    expect(shares.size).toBe(4)
    const sum = [...shares.values()].reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it('형제 균등: P1의 두 리프가 각각 0.125', () => {
    const tree = computeTree(rows, '2026-07-08', H)
    const shares = leafWeightShares(tree)
    expect(shares.get('a')).toBeCloseTo(0.125, 10)
    expect(shares.get('b')).toBeCloseTo(0.125, 10)
    expect(shares.get('c')).toBeCloseTo(0.375, 10)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/plannedAt.test.ts`
Expected: FAIL — `overallPlannedAt is not a function`

- [ ] **Step 3a: `progress.ts`에서 계획% 계산 원시를 뽑아낸다**

`plannedPct`의 로직을 rollup.ts에 복사하면 두 번째 구현이 생긴다. 대신 "업무일 세는 법"만 주입받는 원시를 만들고 `plannedPct`가 그걸 위임하게 한다. **`plannedPct`의 시그니처·동작은 그대로다.**

`src/lib/domain/progress.ts`:

```ts
import { businessDaysBetween } from './dates'
import type { Status } from './types'

/** 계획% 계산의 유일한 구현. 업무일 세는 법만 주입받는다. */
export function plannedPctWith(
  start: string | null, end: string | null, today: string,
  between: (a: string, b: string) => number,
): number {
  if (!start || !end) return 0
  if (today < start) return 0
  const total = between(start, end)
  if (total === 0) return 0
  const cappedToday = today > end ? end : today
  const done = between(start, cappedToday)
  const pct = (done / total) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function plannedPct(
  start: string | null, end: string | null, today: string, holidays: Set<string>,
): number {
  return plannedPctWith(start, end, today, (a, b) => businessDaysBetween(a, b, holidays))
}

export function achievementOf(actual: number, planned: number): number | null {
  if (planned === 0) return null
  return Math.round((actual / planned) * 100)
}

export function statusOf(
  actual: number, planned: number, start: string | null, today: string,
): Status {
  if (actual >= 100) return 'done'
  if (start && today < start && actual === 0) return 'not_started'
  if (planned === 0 && actual === 0) return 'not_started'
  if (actual < planned) return 'delayed'
  return 'in_progress'
}
```

- [ ] **Step 3b: `rollup.ts` 구현**

`computeNode`의 동작은 바뀌지 않는다 — 결합 규칙만 `weightedMean`으로 뽑아내 `plannedRollupAt`과 공유한다.

```ts
import { buildTree, type TreeNode } from './tree'
import { plannedPct, plannedPctWith, achievementOf, statusOf } from './progress'
import type { BizDayIndex } from './dates'
import type { ComputedItem, WbsRow } from './types'

export function computeTree(rows: WbsRow[], today: string, holidays: Set<string>): ComputedItem[] {
  const tree = buildTree(rows)
  return tree.map(node => computeNode(node, today, holidays))
}

/**
 * 프로젝트 전체 공정율 — 루트(Phase) 가중 평균. weight가 모두 null이면 균등.
 * 대시보드·현황 보고서·기타 요약이 같은 값을 쓰도록 단일 출처로 공유한다.
 */
export function overallProgress(roots: ComputedItem[]): { actual: number; planned: number } {
  const allNull = roots.every(r => r.weight == null)
  const eff = (r: ComputedItem) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = roots.reduce((s, r) => s + eff(r), 0) || 1
  return {
    actual: Math.round(roots.reduce((s, r) => s + eff(r) * r.rolledActualPct, 0) / totalEff),
    planned: Math.round(roots.reduce((s, r) => s + eff(r) * r.plannedPct, 0) / totalEff),
  }
}

export function siblingWeight(w: number | null): number {
  return w == null ? 1 : w
}

/**
 * 형제 가중 평균 — computeNode와 plannedRollupAt이 공유하는 유일한 결합 규칙.
 * 반올림 위치가 두 곳에서 갈라지지 않도록 여기서만 Math.round 한다.
 */
function weightedMean<T extends { weight: number | null }>(children: T[], valueOf: (c: T) => number): number {
  const totalW = children.reduce((s, c) => s + siblingWeight(c.weight), 0) || 1
  return Math.round(children.reduce((s, c) => s + siblingWeight(c.weight) * valueOf(c), 0) / totalW)
}

/** 날짜 d 시점의 계획 진척(롤업). 리프는 자기 날짜, 상위는 자식 가중평균 — computeNode와 동일 규칙. */
export function plannedRollupAt(node: ComputedItem, d: string, idx: BizDayIndex): number {
  if (node.children.length === 0) {
    return plannedPctWith(node.plannedStart, node.plannedEnd, d, (a, b) => idx.between(a, b))
  }
  return weightedMean(node.children, c => plannedRollupAt(c, d, idx))
}

/** 날짜 d 시점의 전체 계획 진척. overallProgress(...).planned 와 d=today에서 일치해야 한다. */
export function overallPlannedAt(roots: ComputedItem[], d: string, idx: BizDayIndex): number {
  const allNull = roots.every(r => r.weight == null)
  const eff = (r: ComputedItem) => (allNull ? 1 : r.weight ?? 0)
  const totalEff = roots.reduce((s, r) => s + eff(r), 0) || 1
  return Math.round(roots.reduce((s, r) => s + eff(r) * plannedRollupAt(r, d, idx), 0) / totalEff)
}

/** 리프가 프로젝트 전체 100% 중 차지하는 몫(0~1). 루트부터 곱해 내려간다. */
export function leafWeightShares(roots: ComputedItem[]): Map<string, number> {
  const out = new Map<string, number>()
  const totalRoot = roots.reduce((s, r) => s + siblingWeight(r.weight), 0) || 1
  const walk = (n: ComputedItem, acc: number) => {
    if (n.children.length === 0) { out.set(n.id, acc); return }
    const totalW = n.children.reduce((s, c) => s + siblingWeight(c.weight), 0) || 1
    n.children.forEach(c => walk(c, (acc * siblingWeight(c.weight)) / totalW))
  }
  roots.forEach(r => walk(r, siblingWeight(r.weight) / totalRoot))
  return out
}

function computeNode(node: TreeNode, today: string, holidays: Set<string>): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, holidays))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, holidays)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    rolledActual = weightedMean(children, c => c.rolledActualPct)
    rolledPlanned = weightedMean(children, c => c.plannedPct)
  }

  return {
    ...node,
    plannedPct: rolledPlanned,
    rolledActualPct: rolledActual,
    achievement: achievementOf(rolledActual, rolledPlanned),
    status: statusOf(rolledActual, rolledPlanned, node.plannedStart, today),
    children,
  }
}
```

`weightedMean`의 제네릭 제약은 `{ weight: number | null }`이다. `TreeNode`와 `ComputedItem` 둘 다 만족한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/plannedAt.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 롤업 회귀가 없는지 확인한다**

`computeNode`와 `plannedPct`를 건드렸으므로 관련 테스트를 전부 돌린다.

Run: `npx vitest run tests/domain/rollup.test.ts tests/domain/overallProgress.test.ts tests/domain/progress.test.ts tests/domain/edgecases.test.ts tests/domain/dashboard.test.ts tests/domain/dates.test.ts`
Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/progress.ts src/lib/domain/rollup.ts tests/domain/plannedAt.test.ts
git commit -m "feat(domain): overallPlannedAt · leafWeightShares + weightedMean 공유 결합 규칙 (TDD)"
```

---

## Task 3: 팀 순서·담당팀 해석을 도메인 단일 출처로

`['PMO','ERP','MES','가공']` 리터럴이 세 곳(`tree.ts:6`, `DashboardView.tsx:35`, `report/model.ts:46`)에 있고, "리프의 담당팀을 하나로 정하는 법"은 `tree.ts:9`에만 있다. 병목이 네 번째 사본을 만들지 않도록 먼저 정리한다.

**Files:**
- Modify: `src/lib/domain/tree.ts`
- Modify: `src/lib/report/model.ts:46`
- Test: 없음 (순수 리팩터, 기존 테스트가 회귀를 잡는다)

- [ ] **Step 1: `tree.ts`에 `TEAMS`와 `primaryTeamOf`를 export 한다**

`src/lib/domain/tree.ts` 상단 6~11행을 교체:

```ts
import type { ComputedItem, OwnerKind, TeamCode, WbsRow } from './types'

export type TreeNode = WbsRow & { children: TreeNode[] }

/** 팀 표시 순서 — 도메인 단일 출처. sub-act 정렬·병목 열 순서·주간보고가 모두 이걸 쓴다. */
export const TEAMS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

const SUB_ACT_TEAM_ORDER: Record<TeamCode, number> =
  Object.fromEntries(TEAMS.map((t, i) => [t, i])) as Record<TeamCode, number>

/** 항목의 대표 담당팀. 주관(primary) 우선, 없으면 첫 담당, 담당 없으면 null. */
export function primaryTeamOf(n: { owners: { team: TeamCode; kind: OwnerKind }[] }): TeamCode | null {
  return n.owners.find(o => o.kind === 'primary')?.team ?? n.owners[0]?.team ?? null
}

function subActTeamRank(n: TreeNode): number {
  const team = primaryTeamOf(n)
  return team != null ? SUB_ACT_TEAM_ORDER[team] : Number.MAX_SAFE_INTEGER
}
```

나머지(`buildTree`, `collectLeaves`)는 그대로.

- [ ] **Step 2: `report/model.ts`의 사본을 제거한다**

`src/lib/report/model.ts:46` 을 교체:

```ts
// 기존: export const REPORT_TEAMS: TeamCode[] = ['PMO', 'ERP', 'MES', '가공']
export { TEAMS as REPORT_TEAMS } from '@/lib/domain/tree'
```

`model.ts` 안에서 `REPORT_TEAMS`를 값으로 쓰고 있으므로(102행 `REPORT_TEAMS.map`), re-export만으로는 지역 스코프에 바인딩이 생기지 않는다. 다음처럼 쓴다:

```ts
import { TEAMS } from '@/lib/domain/tree'
// …
export const REPORT_TEAMS = TEAMS
```

- [ ] **Step 3: 회귀 확인**

Run: `npx vitest run tests/domain/tree.test.ts tests/report 2>/dev/null; npx vitest run`
Expected: 전체 스위트 PASS. 실패 0.

- [ ] **Step 4: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/tree.ts src/lib/report/model.ts
git commit -m "refactor(domain): TEAMS·primaryTeamOf를 tree.ts 단일 출처로 (REPORT_TEAMS 사본 제거)"
```

---

## Task 4: `dashboard.ts` — earlyFloor · milestoneLeaves · attentionLeaves

세 가지를 한 번에 한다. 셋 다 `dashboard.ts` 한 파일이고 서로 얽혀 있다.

1. **`ScheduleModel.earlyFloor`** — 여정 카드가 `D+9 / 28`을 찍으려면 이 값이 필요하다. 지금은 `Math.max(14, round(totalDays*0.15))`가 함수 안에 갇혀 있어 카드가 매직넘버를 복제해야 한다.
2. **`milestoneLeaves()`** — `detectMilestones`는 **하나만** 반환하고, 판정 술어 `isMilestoneLeaf`는 module-private다. 여정이 이걸 재구현하면 ExecSummary의 마일스톤 타일과 갈라진다.
3. **`attentionLeaves()`** — `dueSoonLeaves`가 `delayed`를 제외하지 않아 `riskModel`의 `delayed + dueSoon`이 중복 계상한다(실측 13+7=20, 고유 14). 헤더 벨(`notifications.ts:42`)은 이미 14로 제대로 세고 있어 **앱 안에서 두 surface가 이미 불일치**한다.

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts` (기존 케이스 무수정, 추가만)

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`tests/domain/dashboard.test.ts`의 **기존 1~3행은 그대로 두고**, 파일 맨 위 import 뒤에 아래 import를 덧붙인 다음, 파일 끝에 describe 블록들을 붙인다. `describe/it/expect`와 `scheduleModel`은 이미 import되어 있으므로 다시 import하지 않는다.

```ts
// 파일 상단 import 뒤에 추가
import { riskModel, attentionLeaves, milestoneLeaves, detectMilestones } from '@/lib/domain/dashboard'
import { computeTree } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'
```

```ts
// 파일 끝에 추가
const H2 = new Set<string>()
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})
const TODAY = '2026-07-09'

// x: 마감 지남 + 0% → delayed, dueSoon 아님
// y: 07-13 마감(D-4) + 0% → delayed(계획 미달) AND dueSoon  ← 중복 케이스
// z: 07-13 마감(D-4) + 100% → done, 어느 쪽도 아님
// w: 08-01 마감 → 아직 시작 전, 어느 쪽도 아님
const attRows: WbsRow[] = [
  r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
  r({ id: 'x', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07' }),
  r({ id: 'y', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', sortOrder: 1 }),
  r({ id: 'z', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', actualPct: 100, sortOrder: 2 }),
  r({ id: 'w', parentId: 'P', plannedStart: '2026-07-27', plannedEnd: '2026-08-01', sortOrder: 3 }),
]

describe('attentionLeaves — 지연 ∪ 마감임박 중복 제거', () => {
  const leaves = collectLeaves(computeTree(attRows, TODAY, H2))

  it('y는 delayed이자 dueSoon이지만 한 번만 센다', () => {
    const ids = attentionLeaves(leaves, TODAY).map(l => l.id).sort()
    expect(ids).toEqual(['x', 'y'])
  })

  it('riskModel.attention은 고유 건수, delayed+dueSoon은 중복 포함', () => {
    const m = riskModel(computeTree(attRows, TODAY, H2), TODAY)
    expect(m.delayed).toBe(2)      // x, y
    expect(m.dueSoon).toBe(1)      // y
    expect(m.attention).toBe(2)    // x, y — 3이 아니다
  })

  it('signal은 delayed만 읽으므로 attention 추가로 변하지 않는다', () => {
    const m = riskModel(computeTree(attRows, TODAY, H2), TODAY)
    expect(m.signal).toBe('amber') // delayed 2 → 1 이상 4 미만
  })
})

describe('scheduleModel.earlyFloor', () => {
  it('max(14, round(totalDays * 0.15))', () => {
    const a = scheduleModel({ startDate: '2026-07-01', endDate: '2026-12-31', today: '2026-07-09', overallActual: 1, overallPlanned: 6 })
    expect(a.earlyFloor).toBe(28)  // totalDays 184 → round(27.6) = 28
    expect(a.label).toBe('early')  // elapsed 9 < 28
    expect(a.projectedEnd).toBeNull()

    const b = scheduleModel({ startDate: '2026-01-01', endDate: '2026-02-01', today: '2026-01-05', overallActual: 1, overallPlanned: 6 })
    expect(b.earlyFloor).toBe(14)  // totalDays 32 → round(4.8)=5 → max(14,5)
  })
})

describe('milestoneLeaves', () => {
  const msRows: WbsRow[] = [
    r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-12-31' }),
    r({ id: 'kick', parentId: 'P', name: '1-3. 프로젝트 착수 보고회(Kick-off)', plannedStart: '2026-07-10', plannedEnd: '2026-07-10' }),
    r({ id: 'mid', parentId: 'P', name: '2-5. 중간보고', plannedStart: '2026-09-17', plannedEnd: '2026-09-17', sortOrder: 1 }),
    r({ id: 'donems', parentId: 'P', name: '착수보고 준비', plannedStart: '2026-07-01', plannedEnd: '2026-07-02', actualPct: 100, sortOrder: 2 }),
    r({ id: 'plain', parentId: 'P', name: '일반 작업', plannedStart: '2026-07-01', plannedEnd: '2026-07-30', sortOrder: 3 }),
  ]
  const tree = computeTree(msRows, TODAY, H2)

  it('완료된 마일스톤도 포함한다 (detectMilestones와 다르다)', () => {
    expect(milestoneLeaves(tree).map(l => l.id)).toEqual(['donems', 'kick', 'mid'])
  })

  it('마일스톤이 아닌 항목은 제외한다', () => {
    expect(milestoneLeaves(tree).map(l => l.id)).not.toContain('plain')
  })

  it('plannedEnd 오름차순, 동률이면 sortOrder', () => {
    const ends = milestoneLeaves(tree).map(l => l.plannedEnd)
    expect([...ends].sort()).toEqual(ends)
  })

  it('detectMilestones는 여전히 미완료 중 다음 하나만 반환한다', () => {
    const m = detectMilestones(tree, TODAY)
    expect(m.name).toBe('1-3. 프로젝트 착수 보고회(Kick-off)')  // donems는 done이라 제외
    expect(m.dday).toBe(1)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `attentionLeaves is not a function`, `milestoneLeaves is not a function`, `earlyFloor` undefined

- [ ] **Step 3: 구현**

`src/lib/domain/dashboard.ts` 를 아래 네 군데 수정한다.

**(a) `ScheduleModel`에 `earlyFloor` 추가하고 `scheduleModel`이 채운다:**

```ts
export interface ScheduleModel {
  totalDays: number; elapsed: number; remaining: number; elapsedPct: number
  earlyFloor: number                                    // ← 추가
  projectedEnd: string | null; slipDays: number | null
  signal: Signal; label: 'onTrack' | 'early' | 'done' | 'none'
}
```
`scheduleModel` 안에서 `base`를 만들기 전에 `earlyFloor`를 계산하고 모든 반환 경로에 포함시킨다:

```ts
export function scheduleModel(input: {
  startDate: string | null; endDate: string | null; today: string
  overallActual: number; overallPlanned: number
}): ScheduleModel {
  const { startDate: s, endDate: e, today, overallActual, overallPlanned } = input
  if (!s || !e) {
    return { totalDays: 0, elapsed: 0, remaining: 0, elapsedPct: 0, earlyFloor: 0,
             projectedEnd: null, slipDays: null, signal: 'neutral', label: 'none' }
  }
  const totalDays = Math.max(1, diffDaysCal(s, e) + 1)
  const elapsed = clampN(diffDaysCal(s, today) + 1, 0, totalDays)
  const remaining = totalDays - elapsed
  const elapsedPct = Math.round((elapsed / totalDays) * 100)
  const earlyFloor = Math.max(14, Math.round(totalDays * 0.15))   // 매직넘버는 여기 한 곳에만
  const base = { totalDays, elapsed, remaining, elapsedPct, earlyFloor }

  if (overallActual >= 100) return { ...base, projectedEnd: null, slipDays: null, signal: 'green', label: 'done' }
  if (overallPlanned < 5 || elapsed < earlyFloor) {
    return { ...base, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'early' }
  }
  const spi = overallActual / overallPlanned
  const projectedDuration = Math.min(totalDays / spi, totalDays * 3)
  const slipDays = Math.round(projectedDuration - totalDays)
  const projectedEnd = addDaysCal(s, Math.round(projectedDuration) - 1)
  const overdueUnfinished = today > e
  const signal: Signal = slipDays > 14 || overdueUnfinished ? 'red' : slipDays > 3 ? 'amber' : 'green'
  return { ...base, projectedEnd, slipDays, signal, label: 'onTrack' }
}
```

⚠️ `spi === 0`이면 `totalDays / spi === Infinity` → `Math.min(Infinity, totalDays*3)` = `totalDays*3`. 클램프가 받아준다. `overallPlanned >= 5` 가드 덕분에 0 나누기는 없다.

**(b) `milestoneLeaves` export, `detectMilestones`가 이걸 소비:**

```ts
/** 마일스톤 리프 전체 — 완료 포함, plannedEnd 오름차순. 타임라인용. today에 의존하지 않는다. */
export function milestoneLeaves(items: ComputedItem[]): ComputedItem[] {
  return collectLeaves(items)
    .filter(l => isMilestoneLeaf(l) && l.plannedEnd != null)
    .sort(byEndThenOrder)
}

export function detectMilestones(items: ComputedItem[], today: string): MilestoneModel {
  const cands = milestoneLeaves(items).filter(l => l.status !== 'done')
  const overdue = cands.filter(l => l.plannedEnd! < today)
  if (overdue.length > 0) {
    const od = overdue[0]
    return { name: od.name, date: od.plannedEnd, dday: diffDaysCal(today, od.plannedEnd!), overdue: true, signal: 'red' }
  }
  const next = cands.filter(l => l.plannedEnd! >= today)[0]
  if (!next) return { name: null, date: null, dday: null, overdue: false, signal: 'neutral' }
  const dday = diffDaysCal(today, next.plannedEnd!)
  return { name: next.name, date: next.plannedEnd, dday, overdue: false, signal: dday >= 15 ? 'green' : 'amber' }
}
```
`milestoneLeaves`가 이미 정렬해서 주므로 `detectMilestones`의 `.sort(byEndThenOrder)` 두 번을 지운다.

**(c) `attentionLeaves` export:**

```ts
/**
 * 조치가 필요한 리프 — 지연 ∪ 마감임박, 중복 제거. delayed가 이긴다.
 * dueSoonLeaves가 delayed를 제외하지 않으므로 둘을 그냥 더하면 중복 계상된다.
 */
export function attentionLeaves(leaves: ComputedItem[], today: string): ComputedItem[] {
  const delayed = delayedLeaves(leaves)
  const seen = new Set(delayed.map(l => l.id))
  return [...delayed, ...dueSoonLeaves(leaves, today).filter(l => !seen.has(l.id))]
}
```

**(d) `RiskModel.attention`:**

```ts
export interface RiskModel { delayed: number; dueSoon: number; attention: number; topWeightDelayed: boolean; signal: Signal }

export function riskModel(roots: ComputedItem[], today: string): RiskModel {
  const leaves = collectLeaves(roots)
  const delayed = delayedLeaves(leaves).length
  const dueSoon = dueSoonLeaves(leaves, today).length
  const attention = attentionLeaves(leaves, today).length
  const topWeightDelayed = topWeightPhaseDelayed(roots)
  let signal: Signal = delayed >= 4 ? 'red' : delayed >= 1 ? 'amber' : 'green'
  if (topWeightDelayed) signal = escalate(signal)
  return { delayed, dueSoon, attention, topWeightDelayed, signal }
}
```
`signal` 임계값은 `delayed`만 읽는다 — **신호등은 변하지 않는다.**

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS. 기존 케이스 전부 + 신규 8케이스.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(domain): earlyFloor · milestoneLeaves · attentionLeaves (지연∪임박 중복 제거) (TDD)"
```

---

## Task 5: `attention.ts` — 조치 행 모델과 전순서 comparator

**Files:**
- Create: `src/lib/domain/attention.ts`
- Test: `tests/domain/attention.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/attention.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildActionRows, compareActionRows, type ActionRow } from '@/lib/domain/attention'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const TODAY = '2026-07-09'
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const rows: WbsRow[] = [
  r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
  // 초과 2일, 격차 100
  r({ id: 'over2', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 0 }),
  // 초과 6일, 격차 100  → 더 위
  r({ id: 'over6', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-03', sortOrder: 1 }),
  // 초과 0, 격차 67 (지연이지만 마감 전) — dueSoon과도 겹친다
  r({ id: 'gap67', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', sortOrder: 2 }),
  // 순수 dueSoon: 계획 미달 아님(actual = planned = 80) + 7일 내 마감
  // 07-06..07-10 업무일 5, 07-09까지 4일 → planned 80. actual 80 → in_progress.
  r({ id: 'due', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 80, sortOrder: 3 }),
  // 무관
  r({ id: 'far', parentId: 'P', plannedStart: '2026-08-20', plannedEnd: '2026-08-31', sortOrder: 4 }),
]
const tree = computeTree(rows, TODAY, H)

describe('buildActionRows', () => {
  const out = buildActionRows(tree, TODAY)

  it('지연 ∪ 마감임박 고유 집합만 담는다', () => {
    expect(out.map(x => x.item.id).sort()).toEqual(['due', 'gap67', 'over2', 'over6'])
  })

  it('정렬 결과의 id 전체 시퀀스 — 초과일 → 격차 → 가중치 → sortOrder', () => {
    expect(out.map(x => x.item.id)).toEqual(['over6', 'over2', 'gap67', 'due'])
  })

  it('delayed가 dueSoon보다 항상 앞이다 (gap67은 양쪽이지만 delayed로 태깅)', () => {
    expect(out.find(x => x.item.id === 'gap67')!.kind).toBe('delayed')
    expect(out.find(x => x.item.id === 'due')!.kind).toBe('dueSoon')
  })

  it('overdueDays / dday / gapPp', () => {
    const o6 = out.find(x => x.item.id === 'over6')!
    expect(o6.overdueDays).toBe(6)      // 07-03 → 07-09
    expect(o6.dday).toBe(-6)
    expect(o6.gapPp).toBe(100)

    const d = out.find(x => x.item.id === 'due')!
    expect(d.overdueDays).toBe(0)
    expect(d.dday).toBe(1)              // 07-10
    expect(d.gapPp).toBe(0)             // 계획 미달 아님 → clamp 0
  })

  it('weightShare 합은 1을 넘지 않고 각 값은 0..1', () => {
    out.forEach(x => { expect(x.weightShare).toBeGreaterThan(0); expect(x.weightShare).toBeLessThanOrEqual(1) })
  })

  it('빈 입력 → []', () => {
    expect(buildActionRows([], TODAY)).toEqual([])
  })
})

describe('compareActionRows — 전순서', () => {
  const rowsOut = buildActionRows(tree, TODAY)

  it('반대칭: compare(a,b) === -compare(b,a)', () => {
    for (const a of rowsOut) for (const b of rowsOut) {
      expect(Math.sign(compareActionRows(a, b))).toBe(-Math.sign(compareActionRows(b, a)))
    }
  })

  it('반사성: compare(a,a) === 0', () => {
    rowsOut.forEach(a => expect(compareActionRows(a, a)).toBe(0))
  })

  it('추이성: 정렬 결과를 뒤섞어 다시 정렬해도 같다', () => {
    const shuffled = [...rowsOut].reverse().sort(compareActionRows)
    expect(shuffled.map(x => x.item.id)).toEqual(rowsOut.map(x => x.item.id))
  })
})

describe('날짜 없는 리프', () => {
  const nullRows: WbsRow[] = [
    r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
    // 날짜 없음 → plannedPct 0 → 'actual < planned'가 성립할 수 없다 → 결코 delayed가 아니다.
    // plannedEnd null → dueSoon도 아니다. 즉 조치 목록에 원리적으로 들어올 수 없다.
    r({ id: 'nodate', parentId: 'P', plannedStart: null, plannedEnd: null, actualPct: 50 }),
    r({ id: 'x', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 1 }),
  ]
  const out = buildActionRows(computeTree(nullRows, TODAY, H), TODAY)

  it('조치 목록에 들어오지 않는다', () => {
    expect(out.map(x => x.item.id)).toEqual(['x'])
  })

  it('남은 행에 NaN이 없다', () => {
    out.forEach((x: ActionRow) => {
      expect(Number.isNaN(x.overdueDays)).toBe(false)
      expect(Number.isNaN(x.gapPp)).toBe(false)
      expect(x.dday === null || Number.isFinite(x.dday)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/attention.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/attention'`

- [ ] **Step 3: 구현**

`src/lib/domain/attention.ts`:

```ts
import { attentionLeaves, delayedLeaves, diffDaysCal } from './dashboard'
import { leafWeightShares } from './rollup'
import { collectLeaves } from './tree'
import type { ComputedItem } from './types'

export type ActionKind = 'delayed' | 'dueSoon'

export interface ActionRow {
  item: ComputedItem
  kind: ActionKind
  /** plannedEnd < today 인 경우의 초과 일수. 아니면 0. plannedEnd null → 0. */
  overdueDays: number
  /** max(0, plannedPct - rolledActualPct) */
  gapPp: number
  /** today → plannedEnd 캘린더 일수. 지난 항목은 음수. plannedEnd null → null. */
  dday: number | null
  /** 이 리프가 프로젝트 전체 100% 중 차지하는 몫 (0~1) */
  weightShare: number
}

const KIND_RANK: Record<ActionKind, number> = { delayed: 0, dueSoon: 1 }

/**
 * 전순서. 불안정 정렬에 기대지 않도록 마지막에 sortOrder로 결정적 타이브레이크.
 * 1) 지연 먼저  2) 초과일 많은 순  3) 격차 큰 순  4) 가중치 큰 순  5) sortOrder
 */
export function compareActionRows(a: ActionRow, b: ActionRow): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.overdueDays - a.overdueDays ||
    b.gapPp - a.gapPp ||
    b.weightShare - a.weightShare ||
    a.item.sortOrder - b.item.sortOrder
  )
}

export function buildActionRows(roots: ComputedItem[], today: string): ActionRow[] {
  const leaves = collectLeaves(roots)
  const shares = leafWeightShares(roots)
  const delayedIds = new Set(delayedLeaves(leaves).map(l => l.id))

  return attentionLeaves(leaves, today)
    .map<ActionRow>(item => ({
      item,
      kind: delayedIds.has(item.id) ? 'delayed' : 'dueSoon',
      overdueDays: item.plannedEnd ? Math.max(0, diffDaysCal(item.plannedEnd, today)) : 0,
      gapPp: Math.max(0, item.plannedPct - item.rolledActualPct),
      dday: item.plannedEnd ? diffDaysCal(today, item.plannedEnd) : null,
      weightShare: shares.get(item.id) ?? 0,
    }))
    .sort(compareActionRows)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/attention.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/attention.ts tests/domain/attention.test.ts
git commit -m "feat(domain): buildActionRows + 전순서 compareActionRows (TDD)"
```

---

## Task 6: `bottleneck.ts` — 단계 × 팀 셀 상태 격자

**핵심 설계.** 오늘 20칸 중 15칸이 "아직 시작 안 함"이다. 진척률만 칠하면 12칸 회색 + 8칸 새빨강이 되어 양쪽 다 정보가 없다. 셀은 **상태**를 담는다. 그리고 리프는 **정확히 한 칸**에만 들어간다(`primaryTeamOf`) — 그래야 `Σ셀 + 미배정 = 리프 수`가 성립하고 표의 행/열 합이 거짓말을 하지 않는다.

**Files:**
- Create: `src/lib/domain/bottleneck.ts`
- Test: `tests/domain/bottleneck.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/bottleneck.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildBottleneck } from '@/lib/domain/bottleneck'
import { computeTree } from '@/lib/domain/rollup'
import { TEAMS } from '@/lib/domain/tree'
import type { OwnerKind, TeamCode, WbsRow } from '@/lib/domain/types'

const H = new Set<string>()
const TODAY = '2026-07-09'
const own = (team: TeamCode, kind: OwnerKind = 'primary') => [{ team, kind }]
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const rows: WbsRow[] = [
  r({ id: 'P1', level: 'phase', name: '1. 준비', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  r({ id: 'P2', level: 'phase', name: '2. 설계', plannedStart: '2026-08-01', plannedEnd: '2026-09-30', sortOrder: 1 }),

  // P1 / PMO : 하나는 완료, 하나는 지연 → 지연이 이긴다
  r({ id: 'a', parentId: 'P1', owners: own('PMO'), plannedStart: '2026-07-01', plannedEnd: '2026-07-03', actualPct: 100 }),
  r({ id: 'b', parentId: 'P1', owners: own('PMO'), plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 1 }),
  // P1 / ERP : 전부 완료
  r({ id: 'c', parentId: 'P1', owners: own('ERP'), plannedStart: '2026-07-01', plannedEnd: '2026-07-03', actualPct: 100, sortOrder: 2 }),
  // P1 / MES : 창 열림, 계획대로 → 진행중
  r({ id: 'd', parentId: 'P1', owners: own('MES'), plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 80, sortOrder: 3 }),
  // P1 / 가공 : 담당 없음 → 열은 존재하되 미배정

  // P2 / ERP : 미래 시작 → 예정 (D-23)
  r({ id: 'e', parentId: 'P2', owners: own('ERP'), plannedStart: '2026-08-01', plannedEnd: '2026-08-20' }),
  // P2 / MES : 미래 단계인데 창이 이미 열린 지연 리프 → 지연이 예정을 이긴다
  r({ id: 'f', parentId: 'P2', owners: own('MES'), plannedStart: '2026-07-01', plannedEnd: '2026-07-07', sortOrder: 1 }),
  // P2 / 가공 : support-only 담당 → primary 없어도 가공 칸으로
  r({ id: 'g', parentId: 'P2', owners: own('가공', 'support'), plannedStart: '2026-08-05', plannedEnd: '2026-08-25', sortOrder: 2 }),
  // 무담당 리프
  r({ id: 'h', parentId: 'P2', owners: [], plannedStart: '2026-08-05', plannedEnd: '2026-08-25', sortOrder: 3 }),
]

const model = buildBottleneck(computeTree(rows, TODAY, H), TODAY)
const cell = (p: number, team: TeamCode) => model.cells[p][TEAMS.indexOf(team)]

describe('buildBottleneck — 격자 모양', () => {
  it('행 = 루트 phase, 열 = TEAMS 순서', () => {
    expect(model.phases.map(p => p.id)).toEqual(['P1', 'P2'])
    expect(model.teams).toEqual(TEAMS)
    expect(model.cells).toHaveLength(2)
    model.cells.forEach(row => expect(row).toHaveLength(4))
  })

  it('Σ셀 + unassignedLeaves = 리프 수 (중복·누락 0)', () => {
    const inCells = model.cells.flat().reduce((s, c) => s + c.count, 0)
    expect(inCells + model.unassignedLeaves).toBe(8)   // a..h
    expect(model.unassignedLeaves).toBe(1)             // h
  })

  it('담당 없는 팀 칸도 지우지 않는다', () => {
    expect(cell(0, '가공').state).toBe('unassigned')
    expect(cell(0, '가공').count).toBe(0)
  })
})

describe('셀 상태 우선순위: unassigned > done > delayed > scheduled > inProgress', () => {
  it('완료 + 지연이 섞이면 지연', () => {
    expect(cell(0, 'PMO').state).toBe('delayed')
    expect(cell(0, 'PMO').delayedCount).toBe(1)
    expect(cell(0, 'PMO').count).toBe(2)
  })

  it('전부 완료면 done, avgPct 100', () => {
    expect(cell(0, 'ERP').state).toBe('done')
    expect(cell(0, 'ERP').avgPct).toBe(100)
  })

  it('창 열림 + 계획대로면 inProgress', () => {
    expect(cell(0, 'MES').state).toBe('inProgress')
    expect(cell(0, 'MES').avgPct).toBe(80)
  })

  it('미래 시작이면 scheduled + D-day', () => {
    const c = cell(1, 'ERP')
    expect(c.state).toBe('scheduled')
    expect(c.dday).toBe(23)      // 07-09 → 08-01
    expect(c.count).toBe(1)
  })

  it('미래 단계여도 창이 열린 지연 리프가 있으면 delayed가 이긴다', () => {
    expect(cell(1, 'MES').state).toBe('delayed')
  })

  it('담당 없는 칸은 절대 done이 아니다', () => {
    expect(cell(1, 'PMO').state).toBe('unassigned')
  })
})

describe('담당팀 해석', () => {
  it('primary가 없으면 첫 담당(support)으로 배정된다', () => {
    expect(cell(1, '가공').count).toBe(1)
    expect(cell(1, '가공').state).toBe('scheduled')
  })

  it('다중 담당 리프도 한 칸에만 들어간다', () => {
    const multi = computeTree([
      r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
      r({ id: 'm', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-31',
          owners: [{ team: 'MES', kind: 'primary' }, { team: '가공', kind: 'support' }] }),
    ], TODAY, H)
    const mm = buildBottleneck(multi, TODAY)
    expect(mm.cells[0][TEAMS.indexOf('MES')].count).toBe(1)
    expect(mm.cells[0][TEAMS.indexOf('가공')].count).toBe(0)
    expect(mm.cells.flat().reduce((s, c) => s + c.count, 0) + mm.unassignedLeaves).toBe(1)
  })
})

describe('날짜 없는 셀', () => {
  it('plannedStart가 전부 null이면 scheduled + dday null', () => {
    const t = computeTree([
      r({ id: 'P', level: 'phase' }),
      r({ id: 'n', parentId: 'P', owners: own('PMO') }),   // 날짜 없음 → not_started
    ], TODAY, H)
    const m = buildBottleneck(t, TODAY)
    const c = m.cells[0][TEAMS.indexOf('PMO')]
    expect(c.state).toBe('scheduled')
    expect(c.dday).toBeNull()
  })
})

describe('avgPct 반올림', () => {
  it('Math.round(sum/n) — 절삭 아님', () => {
    const t = computeTree([
      r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
      r({ id: 'p', parentId: 'P', owners: own('PMO'), plannedStart: '2026-07-01', plannedEnd: '2026-07-31', actualPct: 33 }),
      r({ id: 'q', parentId: 'P', owners: own('PMO'), plannedStart: '2026-07-01', plannedEnd: '2026-07-31', actualPct: 34, sortOrder: 1 }),
    ], TODAY, H)
    expect(buildBottleneck(t, TODAY).cells[0][0].avgPct).toBe(34)   // (33+34)/2 = 33.5 → 34
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/bottleneck.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/bottleneck'`

- [ ] **Step 3: 구현**

`src/lib/domain/bottleneck.ts`:

```ts
import { diffDaysCal } from './dashboard'
import { TEAMS, collectLeaves, primaryTeamOf } from './tree'
import type { ComputedItem, TeamCode } from './types'

/** 셀 상태. 우선순위: unassigned > done > delayed > scheduled > inProgress */
export type CellState = 'unassigned' | 'done' | 'delayed' | 'scheduled' | 'inProgress'

export interface BottleneckCell {
  phaseId: string
  team: TeamCode
  state: CellState
  /** 이 (단계, 팀)에 배정된 리프 수 */
  count: number
  /** 그중 지연 리프 수 */
  delayedCount: number
  /** 리프 rolledActualPct의 비가중 평균. count 0이면 0. */
  avgPct: number
  /** scheduled일 때만 의미 있음. 날짜 없으면 null. */
  dday: number | null
}

export interface BottleneckModel {
  phases: { id: string; name: string }[]
  teams: TeamCode[]
  /** [phaseIndex][teamIndex] */
  cells: BottleneckCell[][]
  /** 담당팀이 없어 어느 칸에도 못 들어간 리프 수. 표 아래 각주로 반드시 노출한다. */
  unassignedLeaves: number
}

const avg = (ns: number[]): number =>
  ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0

function cellOf(phaseId: string, team: TeamCode, leaves: ComputedItem[], today: string): BottleneckCell {
  const base = { phaseId, team, count: leaves.length }

  if (leaves.length === 0) {
    return { ...base, state: 'unassigned', delayedCount: 0, avgPct: 0, dday: null }
  }

  const delayedCount = leaves.filter(l => l.status === 'delayed').length
  const avgPct = avg(leaves.map(l => l.rolledActualPct))
  const starts = leaves.map(l => l.plannedStart).filter((s): s is string => s != null)
  const cellStart = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null

  if (leaves.every(l => l.status === 'done')) {
    return { ...base, state: 'done', delayedCount: 0, avgPct, dday: null }
  }
  // 지연은 예정보다 앞선다: 아직 시작 안 한 단계에도 창이 열린 리프가 있을 수 있다.
  if (delayedCount > 0) {
    return { ...base, state: 'delayed', delayedCount, avgPct, dday: null }
  }
  if (cellStart === null || today < cellStart) {
    return { ...base, state: 'scheduled', delayedCount: 0, avgPct, dday: cellStart ? diffDaysCal(today, cellStart) : null }
  }
  return { ...base, state: 'inProgress', delayedCount: 0, avgPct, dday: null }
}

export function buildBottleneck(roots: ComputedItem[], today: string): BottleneckModel {
  let unassignedLeaves = 0

  const cells = roots.map(phase => {
    const byTeam = new Map<TeamCode, ComputedItem[]>(TEAMS.map(t => [t, []]))
    collectLeaves([phase]).forEach(l => {
      const team = primaryTeamOf(l)
      if (team === null) { unassignedLeaves++; return }
      byTeam.get(team)!.push(l)
    })
    return TEAMS.map(team => cellOf(phase.id, team, byTeam.get(team)!, today))
  })

  return {
    phases: roots.map(p => ({ id: p.id, name: p.name })),
    teams: TEAMS,
    cells,
    unassignedLeaves,
  }
}
```

⚠️ `roots.map`의 콜백 안에서 `unassignedLeaves++` 하므로 `cells`를 만들고 나서 읽어야 한다. `map`은 동기라 위 순서로 안전하다.

⚠️ 셀 창은 **리프의 `plannedStart` 최솟값**이지 phase의 `plannedStart`가 아니다. P2가 08-01에 시작해도 그 안의 가공 리프는 9월에야 시작할 수 있다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/bottleneck.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/bottleneck.ts tests/domain/bottleneck.test.ts
git commit -m "feat(domain): buildBottleneck — 단계×팀 셀 상태 격자 (Σ셀+미배정=리프) (TDD)"
```

---

## Task 7: `journey.ts` — 계획 곡선 · 단계 밴드 · 마일스톤 · 예측

**세 가지 함정.**
1. 곡선은 날짜 D에서 **재귀 롤업**이어야 한다 (Task 2). 루트 날짜 샘플링이면 게이지와 다른 숫자가 된다.
2. **예측선은 `label`이 아니라 `projectedEnd <= endDate`로 게이팅**한다. 7/28에 early 가드가 풀리는 순간 `label`은 `'onTrack'`이 되지만 `spi ≈ 0.05` → 3배 클램프 → `projectedEnd = 2028-01-03`. x축을 재스케일하면 실적%를 편집할 때마다 축이 춤춘다.
3. **x축은 절대 재스케일하지 않는다.** `[startDate, endDate]` 고정. 예측이 창을 넘으면 `clipped: true`로 표시하고 카드가 오른쪽 가장자리에 꺾쇠를 그린다.

x는 0~1로 정규화해서 반환한다. viewBox 매핑은 카드의 책임이다.

**Files:**
- Create: `src/lib/domain/journey.ts`
- Test: `tests/domain/journey.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/domain/journey.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildJourney } from '@/lib/domain/journey'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})

const START = '2026-07-01', END = '2026-12-31'
const rows: WbsRow[] = [
  r({ id: 'P1', level: 'phase', name: '1. 준비', weight: 0.2, plannedStart: '2026-07-01', plannedEnd: '2026-07-31' }),
  r({ id: 'P2', level: 'phase', name: '2. 설계', weight: 0.8, plannedStart: '2026-08-01', plannedEnd: '2026-12-31', sortOrder: 1 }),
  r({ id: 'a', parentId: 'P1', plannedStart: '2026-07-01', plannedEnd: '2026-07-31', actualPct: 10 }),
  r({ id: 'kick', parentId: 'P1', name: '착수 보고회', plannedStart: '2026-07-10', plannedEnd: '2026-07-10', sortOrder: 1 }),
  r({ id: 'b', parentId: 'P2', plannedStart: '2026-08-01', plannedEnd: '2026-12-31' }),
]
const opts = { startDate: START, endDate: END, holidays: [] as string[] }

describe('buildJourney — 기간 미설정', () => {
  it('startDate 또는 endDate가 null이면 null을 반환한다 (카드가 EmptyState로 분기)', () => {
    const tree = computeTree(rows, '2026-07-09', new Set())
    expect(buildJourney(tree, { ...opts, startDate: null, today: '2026-07-09' })).toBeNull()
    expect(buildJourney(tree, { ...opts, endDate: null, today: '2026-07-09' })).toBeNull()
  })
})

describe('buildJourney — 곡선', () => {
  const today = '2026-07-09'
  const tree = computeTree(rows, today, new Set())
  const j = buildJourney(tree, { ...opts, today })!

  it('불변식: 곡선의 오늘 지점이 게이지의 planned와 같다', () => {
    // 이게 깨지면 곡선과 바로 위 게이지가 서로 다른 숫자를 말한다.
    expect(j.planned).toBe(overallProgress(tree).planned)
    expect(j.curve.find(p => p.date === today)!.planned).toBe(overallProgress(tree).planned)
  })

  it('종점이 100이다', () => {
    expect(j.terminalPlanned).toBe(100)
    expect(j.curve[j.curve.length - 1].planned).toBe(100)
  })

  it('첫 점이 시작일, 마지막 점이 종료일', () => {
    expect(j.curve[0].date).toBe(START)
    expect(j.curve[j.curve.length - 1].date).toBe(END)
  })

  it('x는 0..1 정규화, 오름차순', () => {
    expect(j.curve[0].x).toBe(0)
    expect(j.curve[j.curve.length - 1].x).toBe(1)
    j.curve.forEach(p => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1) })
    for (let i = 1; i < j.curve.length; i++) expect(j.curve[i].x).toBeGreaterThan(j.curve[i - 1].x)
  })

  it('단조 비감소', () => {
    for (let i = 1; i < j.curve.length; i++) {
      expect(j.curve[i].planned).toBeGreaterThanOrEqual(j.curve[i - 1].planned)
    }
  })

  it('샘플에 단계 경계와 오늘이 포함된다', () => {
    const dates = j.curve.map(p => p.date)
    expect(dates).toContain('2026-07-31')   // P1 종료
    expect(dates).toContain('2026-08-01')   // P2 시작
    expect(dates).toContain(today)
  })

  it('variance = actual - planned', () => {
    expect(j.variance).toBe(j.actual - j.planned)
  })
})

describe('buildJourney — 밴드와 마일스톤', () => {
  const today = '2026-07-09'
  const j = buildJourney(computeTree(rows, today, new Set()), { ...opts, today })!

  it('루트 phase마다 밴드 하나, x0<x1', () => {
    expect(j.bands.map(b => b.id)).toEqual(['P1', 'P2'])
    j.bands.forEach(b => expect(b.x1).toBeGreaterThan(b.x0))
  })

  it('아직 시작 안 한 밴드는 started=false', () => {
    expect(j.bands[0].started).toBe(true)    // 07-01 시작
    expect(j.bands[1].started).toBe(false)   // 08-01 시작
  })

  it('밴드 채움은 phase의 롤업 plannedPct다', () => {
    const tree = computeTree(rows, today, new Set())
    expect(j.bands[0].fillPct).toBe(tree[0].plannedPct)
  })

  it('마일스톤 다이아몬드 — 완료 여부와 x를 담는다', () => {
    expect(j.milestones.map(m => m.id)).toEqual(['kick'])
    expect(j.milestones[0].done).toBe(false)
    expect(j.milestones[0].x).toBeGreaterThan(0)
  })
})

describe('buildJourney — 예측선 게이팅', () => {
  const tree = (today: string) => computeTree(rows, today, new Set())

  it('early(경과 < earlyFloor)면 forecast=null, earlyFloor/elapsed를 노출한다', () => {
    const j = buildJourney(tree('2026-07-09'), { ...opts, today: '2026-07-09' })!
    expect(j.forecast).toBeNull()
    expect(j.earlyFloor).toBe(28)      // totalDays 184 → round(27.6)
    expect(j.elapsed).toBe(9)
    expect(j.earlyFloorX).toBeGreaterThan(0)
  })

  it('projectedEnd가 종료일을 넘으면 clipped=true, x는 1로 고정된다', () => {
    // 08-15: elapsed 46 ≥ 28, planned 충분, actual 낮음 → spi 작음 → projectedEnd ≫ endDate
    const j = buildJourney(tree('2026-08-15'), { ...opts, today: '2026-08-15' })!
    expect(j.forecast).not.toBeNull()
    expect(j.forecast!.clipped).toBe(true)
    expect(j.forecast!.x).toBe(1)
    expect(j.forecast!.slipDays).toBeGreaterThan(0)
  })

  it('projectedEnd가 창 안이면 clipped=false, x<1', () => {
    // 계획대로 진행되는 트리: actual = planned
    const onTrack: WbsRow[] = [
      r({ id: 'P', level: 'phase', plannedStart: START, plannedEnd: END }),
      r({ id: 'x', parentId: 'P', plannedStart: START, plannedEnd: END, actualPct: 27 }),
    ]
    const today = '2026-08-15'
    const t = computeTree(onTrack, today, new Set())
    const j = buildJourney(t, { ...opts, today })!
    expect(j.forecast).not.toBeNull()
    expect(j.forecast!.clipped).toBe(false)
    expect(j.forecast!.x).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/domain/journey.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/journey'`

- [ ] **Step 3: 구현**

`src/lib/domain/journey.ts`:

```ts
import { addDaysCal, diffDaysCal, milestoneLeaves, scheduleModel } from './dashboard'
import { makeBizDayIndex } from './dates'
import { overallPlannedAt, overallProgress } from './rollup'
import type { ComputedItem } from './types'

export interface JourneyPoint { date: string; x: number; planned: number }
export interface JourneyBand { id: string; name: string; x0: number; x1: number; fillPct: number; started: boolean }
export interface JourneyMilestone { id: string; name: string; date: string; x: number; done: boolean }
/** x는 창 안으로 클립된 위치. clipped면 x===1이고 카드가 오른쪽 가장자리에 꺾쇠를 그린다. */
export interface JourneyForecast { x: number; slipDays: number; clipped: boolean; projectedEnd: string }

export interface JourneyModel {
  curve: JourneyPoint[]
  bands: JourneyBand[]
  milestones: JourneyMilestone[]
  todayX: number
  actual: number
  planned: number
  variance: number
  /** 종료일의 계획 진척. 정상이면 100. 100 미만이면 업무일 0짜리 리프가 섞였다는 뜻. */
  terminalPlanned: number
  elapsed: number
  earlyFloor: number
  /** earlyFloor 지점의 x. 예측 산정 시작일 눈금용. label!=='early'면 null. */
  earlyFloorX: number | null
  forecast: JourneyForecast | null
}

/** 곡선이 꺾이는 곳은 단계 경계뿐이다. 월요일 + 경계 + {시작, 오늘, 종료}면 충분하다. */
function sampleDates(roots: ComputedItem[], startDate: string, endDate: string, today: string): string[] {
  const set = new Set<string>([startDate, endDate])
  if (today >= startDate && today <= endDate) set.add(today)

  const span = diffDaysCal(startDate, endDate)
  for (let d = 0; d <= span; d += 7) set.add(addDaysCal(startDate, d))

  const clamp = (s: string) => (s < startDate ? startDate : s > endDate ? endDate : s)
  roots.forEach(p => {
    if (p.plannedStart) set.add(clamp(p.plannedStart))
    if (p.plannedEnd) set.add(clamp(p.plannedEnd))
  })
  return [...set].sort()
}

export function buildJourney(
  roots: ComputedItem[],
  opts: { startDate: string | null; endDate: string | null; today: string; holidays: string[] },
): JourneyModel | null {
  const { startDate, endDate, today, holidays } = opts
  if (!startDate || !endDate || roots.length === 0) return null

  const span = Math.max(1, diffDaysCal(startDate, endDate))
  const xOf = (d: string) => Math.min(1, Math.max(0, diffDaysCal(startDate, d) / span))

  const idx = makeBizDayIndex(startDate, endDate, new Set(holidays))
  const curve = sampleDates(roots, startDate, endDate, today)
    .map(date => ({ date, x: xOf(date), planned: overallPlannedAt(roots, date, idx) }))

  const { actual, planned } = overallProgress(roots)
  const sched = scheduleModel({ startDate, endDate, today, overallActual: actual, overallPlanned: planned })

  const bands: JourneyBand[] = roots.map(p => ({
    id: p.id,
    name: p.name,
    x0: xOf(p.plannedStart ?? startDate),
    x1: xOf(p.plannedEnd ?? endDate),
    fillPct: p.plannedPct,
    started: p.plannedStart != null && today >= p.plannedStart,
  }))

  const milestones: JourneyMilestone[] = milestoneLeaves(roots).map(l => ({
    id: l.id,
    name: l.name,
    date: l.plannedEnd!,
    x: xOf(l.plannedEnd!),
    done: l.status === 'done',
  }))

  // 예측선은 label이 아니라 projectedEnd의 존재로 게이팅한다.
  // label==='onTrack'은 "정상"이 아니라 "early도 done도 아님"일 뿐이고, slip +368일에도 켜진다.
  const forecast: JourneyForecast | null = sched.projectedEnd
    ? {
        projectedEnd: sched.projectedEnd,
        slipDays: sched.slipDays ?? 0,
        clipped: sched.projectedEnd > endDate,
        x: xOf(sched.projectedEnd),   // xOf가 1로 클램프한다 — x축은 재스케일하지 않는다
      }
    : null

  return {
    curve,
    bands,
    milestones,
    todayX: xOf(today),
    actual,
    planned,
    variance: actual - planned,
    terminalPlanned: overallPlannedAt(roots, endDate, idx),
    elapsed: sched.elapsed,
    earlyFloor: sched.earlyFloor,
    earlyFloorX: sched.label === 'early' ? xOf(addDaysCal(startDate, sched.earlyFloor - 1)) : null,
    forecast,
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/domain/journey.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: 전체 도메인 스위트 확인**

Run: `npx vitest run tests/domain`
Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/journey.ts tests/domain/journey.test.ts
git commit -m "feat(domain): buildJourney — 계획 곡선·밴드·마일스톤·예측 (projectedEnd 게이팅) (TDD)"
```

---

## Task 8: 공유 UI — SectionCard `fill`, 다크 토큰, `.hatch`, primitives

테스트 없음(순수 스타일·구조). 회귀는 `tsc --noEmit` + 기존 스위트가 잡는다.

**Files:**
- Modify: `src/components/ui/SectionCard.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/dashboard/primitives.tsx`

- [ ] **Step 1: `SectionCard`에 옵트인 prop 두 개를 추가한다**

현재 `<div className="mt-5">`는 `height: auto`라 자식의 `overflow-y-auto`가 클램프할 대상이 없다. 리스트가 늘어나 섹션을 넘치고 그리드 행 높이를 결정해 버린다. **호출부 19곳의 기본 동작을 바꾸면 안 되므로 옵트인이다.**

`src/components/ui/SectionCard.tsx` 전체:

```tsx
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** eyebrow + 타이틀 헤더가 있는 카드 컨테이너. */
export function SectionCard({
  eyebrow, title, icon: Icon, actions, children, className = '',
  fill = false, bodyClassName = '',
}: {
  eyebrow?: string
  title: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** 그리드 행 높이를 채우고 본문이 내부 스크롤할 수 있게 한다. 기본 false — 기존 호출부 동작 불변. */
  fill?: boolean
  bodyClassName?: string
}) {
  return (
    <section className={`card p-5 sm:p-6 ${fill ? 'flex h-full min-h-0 flex-col' : ''} ${className}`}>
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-weak text-brand"><Icon className="h-4 w-4" /></span>}
          <div>
            {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">{eyebrow}</div>}
            <h3 className="mt-0.5 text-sm font-semibold text-ink">{title}</h3>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={`mt-5 ${fill ? 'min-h-0 flex-1' : ''} ${bodyClassName}`}>{children}</div>
    </section>
  )
}
```

`shrink-0`을 헤더에 붙인 것은 `fill` 모드에서만 의미가 있고, 비-flex 컨테이너에선 무해하다.

- [ ] **Step 2: `globals.css` — 다크 토큰 하나와 `.hatch` 하나**

`--color-today`는 `@theme`에 `#cb4b5f`로 있는데 `.dark`에 재선언이 없다. 다크 캔버스(`#0f1217`)에 라이트용 진홍이 찍힌다. `--color-delayed`는 제대로 재선언되어 있다(`#ff738a`).

`src/app/globals.css`의 `.dark { … }` 블록 안, `--color-weekend` 근처에 추가:

```css
  --color-today: #ff738a;
```

그리고 `@layer components` 안, `.freeze-edge` 근처에 추가:

```css
  /* 미착수(예정) 셀의 대각 빗금 — 색조가 아니라 질감으로 상태를 전달한다.
     색맹 안전 + 인쇄 시 background-color가 떨어져도 살아남는다. */
  .hatch {
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0 3px,
      var(--color-line-strong) 3px 4px
    );
  }
```

`--color-line-strong`은 `.dark` 오버라이드가 있으므로 자동으로 테마 전환된다.

- [ ] **Step 3: `primitives.tsx` — DashboardView 내부 헬퍼를 승격**

`src/components/dashboard/primitives.tsx`:

```tsx
import type { ReactNode } from 'react'

export function CountBadge({ n, unit, tone = 'bg-brand-weak text-brand' }: { n: number; unit: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{n}{unit}</span>
}

export function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center text-xs text-ink-subtle">
      {text}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
```

- [ ] **Step 4: i18n 신규 키를 추가한다 (삭제는 Task 13에서)**

카드들이 이 키를 참조하므로 먼저 넣는다. `dashboardEn`이 `Record<keyof typeof dashboardKo, string>`이라 **ko와 en을 함께 넣지 않으면 컴파일 에러**가 난다.

`src/lib/i18n/dict/dashboard.ts` — `dashboardKo`의 `'dash.group.teamDeliv'` 뒤에 추가:

```ts
  // 여정
  'dash.journey.title': '전체 여정',
  'dash.journey.noSchedule': '프로젝트 기간이 설정되지 않았습니다',
  'dash.journey.forecastPending': '예측 미산정',
  // 조치
  'dash.action.title': '조치가 필요한 작업',
  'dash.action.empty': '조치가 필요한 작업이 없습니다.',
  'dash.action.viewAll': 'WBS에서 전체 보기',
  'dash.action.totalPrefix': '전체 ',
  'dash.action.overdueSuffix': '일 초과',
  'dash.action.gapLabel': '격차',
  'dash.action.delayedTag': '지연',
  // 병목
  'dash.bottleneck.title': '단계 × 팀',
  'dash.phase.axis': '단계',
  'dash.bottleneck.noOwner': '담당 없음',
  'dash.bottleneck.scheduled': '예정',
  'dash.bottleneck.delayed': '지연',
  'dash.bottleneck.legend': '숫자 = 팀 평균 진척 · 빗금 = 미착수 · 점선 = 담당 없음',
  'dash.bottleneck.unassignedLeaves': '미배정 리프',
  // 아코디언 그룹
  'dash.group.weekly': '주간 리듬',
```

`dashboardEn`에도 같은 키를:

```ts
  'dash.journey.title': 'Project journey',
  'dash.journey.noSchedule': 'Project schedule is not set',
  'dash.journey.forecastPending': 'Forecast pending',
  'dash.action.title': 'Needs action',
  'dash.action.empty': 'Nothing needs action right now.',
  'dash.action.viewAll': 'View all in WBS',
  'dash.action.totalPrefix': 'Total ',
  'dash.action.overdueSuffix': 'd overdue',
  'dash.action.gapLabel': 'Gap',
  'dash.action.delayedTag': 'Delayed',
  'dash.bottleneck.title': 'Phase × Team',
  'dash.phase.axis': 'Phase',
  'dash.bottleneck.noOwner': 'No owner',
  'dash.bottleneck.scheduled': 'Scheduled',
  'dash.bottleneck.delayed': 'Delayed',
  'dash.bottleneck.legend': 'Number = team avg progress · Hatch = not started · Dashed = no owner',
  'dash.bottleneck.unassignedLeaves': 'Unassigned leaves',
  'dash.group.weekly': 'Weekly rhythm',
```

`dash.unitCount`(`건` / ` items`)와 `dash.unitDays`(`일` / ` days`)는 이미 있으므로 재사용한다.

- [ ] **Step 5: 타입·빌드 확인**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 0, 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/components/ui/SectionCard.tsx src/app/globals.css src/components/dashboard/primitives.tsx src/lib/i18n/dict/dashboard.ts
git commit -m "feat(ui): SectionCard fill 옵트인 · .hatch · 다크 --color-today · primitives · 신규 dict 키"
```

---

## Task 9: ExecSummary 리스크 타일 — 20건 → 14건

유지하기로 한 카드 안의 **실제 버그**다. `dueSoonLeaves`가 `delayed`를 제외하지 않아 `delayed + dueSoon`이 중복 계상한다. 조치 카드가 14를 찍는 순간 3인치 거리에서 충돌한다. 헤더 벨(`notifications.ts:42`)은 이미 14로 제대로 세고 있다.

**Files:**
- Modify: `src/components/dashboard/ExecSummary.tsx:85`

- [ ] **Step 1: 값만 교체한다 (서브텍스트는 그대로)**

`src/components/dashboard/ExecSummary.tsx`의 리스크 `SignalTile`:

```tsx
<SignalTile label={tr('dash.exec.riskLabel')} value={`${s.risk.attention}${tr('dash.unitCount')}`}
  sub={`${tr('dash.exec.delayed')} ${s.risk.delayed} · ${tr('dash.exec.dueSoon')} ${s.risk.dueSoon}`}
  signal={s.risk.signal} statusText={statusWord(s.risk.signal, tr)} />
```

서브텍스트 `지연 13 · 마감임박 7`은 그대로 둔다. 둘 다 각각 맞는 숫자이고, 합이 아니라 두 관점이다. 바뀌는 것은 큰 숫자 하나뿐이다.

- [ ] **Step 2: 회귀 확인**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. `RiskModel`에 필드를 추가했을 뿐 기존 테스트는 속성 접근만 하므로 깨지는 것이 없다.

- [ ] **Step 3: 커밋**

```bash
git add src/components/dashboard/ExecSummary.tsx
git commit -m "fix(dashboard): 리스크 타일이 지연∪임박 고유 건수를 표시 (중복 계상 20 → 14)"
```

---

## Task 10: `JourneyCard.tsx`

전부 RSC. `ProgressGauge.tsx`가 유일한 SVG 선례이고, 거기서 배운 규칙은 하나다: **hex를 하드코딩하지 말고 Tailwind 유틸리티(`stroke-line`, `fill-brand`)를 쓴다.** v4 `@theme`가 모든 `--color-*`에 대해 `stroke-*`/`fill-*`를 생성하고 `.dark`가 같은 프로퍼티를 재선언하므로 **`dark:` 배리언트가 필요 없다.**

viewBox `0 0 320 148`. 도메인이 준 x(0~1)를 `PLOT_X0 + x * PLOT_W`로 매핑한다.

**Files:**
- Create: `src/components/dashboard/JourneyCard.tsx`

- [ ] **Step 1: 컴포넌트를 쓴다**

`src/components/dashboard/JourneyCard.tsx`:

```tsx
import { TrendingUp } from 'lucide-react'
import type { JourneyModel } from '@/lib/domain/journey'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { MiniEmpty } from './primitives'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/* 좌표계 — 도메인의 x(0~1)를 여기서만 픽셀로 바꾼다. */
const VB_W = 320, VB_H = 148
const PLOT_X0 = 20, PLOT_W = 292        // 왼쪽에 y축 라벨 자리
const PLOT_Y0 = 8, PLOT_H = 72          // 100% → y=8, 0% → y=80
const BAND_Y0 = 100, BAND_H = 5, BAND_GAP = 2.4
const MS_Y = 92

const px = (x: number) => PLOT_X0 + x * PLOT_W
const py = (pct: number) => PLOT_Y0 + (1 - pct / 100) * PLOT_H

export async function JourneyCard({ model }: { model: JourneyModel | null }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  // EmptyState는 자체 .card를 렌더하므로 SectionCard 안에 넣으면 카드가 겹친다. MiniEmpty를 쓴다.
  if (!model) {
    return (
      <SectionCard eyebrow="JOURNEY" title={tr('dash.journey.title')} icon={TrendingUp} fill>
        <MiniEmpty text={tr('dash.journey.noSchedule')} />
      </SectionCard>
    )
  }

  const { curve, bands, milestones, todayX, actual, planned, variance, forecast, earlyFloorX, elapsed, earlyFloor } = model
  const line = curve.map(p => `${px(p.x).toFixed(1)},${py(p.planned).toFixed(1)}`).join(' L')
  const area = `M${line} L${px(1).toFixed(1)},${py(0)} L${px(0).toFixed(1)},${py(0)} Z`

  // 가장 무거운 단계 = 계획이 몰려 있는 구간. 경영진이 봐야 할 한 문장.
  const heaviest = bands.length ? bands.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a)) : null

  const varianceText = `${variance >= 0 ? '+' : ''}${variance}%p`

  return (
    <SectionCard
      eyebrow="JOURNEY"
      title={tr('dash.journey.title')}
      icon={TrendingUp}
      fill
      actions={
        <span className="tabular-nums text-[11px] text-ink-muted">
          {tr('dash.actualLabel')} {actual}% / {tr('dash.plannedLabel')} {planned}%
          <strong className={variance < 0 ? 'ml-1.5 text-delayed' : 'ml-1.5 text-done'}>{varianceText}</strong>
        </span>
      }
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full overflow-visible" role="img"
        aria-label={`${tr('dash.actualLabel')} ${actual}%, ${tr('dash.plannedLabel')} ${planned}%`}>
        <defs>
          <linearGradient id="journeyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
          <pattern id="journeyHatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="4" className="stroke-line-strong" strokeWidth="1.4" />
          </pattern>
        </defs>

        {/* 격자 */}
        <g className="stroke-line" strokeWidth="0.5">
          <line x1={PLOT_X0} y1={py(0)} x2={px(1)} y2={py(0)} />
          <line x1={PLOT_X0} y1={py(50)} x2={px(1)} y2={py(50)} />
          <line x1={PLOT_X0} y1={py(100)} x2={px(1)} y2={py(100)} />
        </g>
        <g className="fill-ink-subtle" fontSize="5">
          <text x="0" y={py(100) + 2}>100</text>
          <text x="4" y={py(50) + 2}>50</text>
          <text x="8" y={py(0) + 2}>0</text>
        </g>

        {/* 가장 무거운 단계 음영 — "계획이 여기 몰려 있다" */}
        {heaviest && (
          <>
            <rect x={px(heaviest.x0)} y={PLOT_Y0} width={px(heaviest.x1) - px(heaviest.x0)} height={PLOT_H}
              className="fill-brand" opacity="0.06" />
            <text x={px(heaviest.x0) + 2} y={PLOT_Y0 + 6} fontSize="4.4" className="fill-brand" opacity="0.75">
              {heaviest.name}
            </text>
          </>
        )}

        {/* 계획 누적 곡선 */}
        <path d={area} fill="url(#journeyFill)" />
        <path d={`M${line}`} fill="none" className="stroke-brand" strokeWidth="1.5" />

        {/* 예측 산정 시작 눈금 (early 구간에만) */}
        {earlyFloorX != null && (
          <>
            <line x1={px(earlyFloorX)} y1={PLOT_Y0 + 4} x2={px(earlyFloorX)} y2={py(0)}
              className="stroke-ink-subtle" strokeWidth="0.6" strokeDasharray="1.5 2" />
            <text x={px(earlyFloorX) + 2} y={PLOT_Y0 + 9} fontSize="4.4" className="fill-ink-subtle">
              {tr('dash.journey.forecastPending')} · D+{elapsed} / {earlyFloor}
            </text>
          </>
        )}

        {/* 예측 점선 — projectedEnd가 있을 때만. clipped면 x=1에서 꺾쇠. */}
        {forecast && (
          <>
            <path d={`M${px(todayX)},${py(actual)} L${px(forecast.x)},${py(100)}`}
              fill="none" className="stroke-accent-secondary" strokeWidth="1" strokeDasharray="3 2" opacity="0.6" />
            {forecast.clipped && (
              <text x={px(1) - 2} y={py(100) - 3} fontSize="4.6" textAnchor="end" className="fill-accent-secondary">
                +{forecast.slipDays}{tr('dash.unitDays')} →
              </text>
            )}
          </>
        )}

        {/* 오늘 선 + 편차 스텁. --color-today는 다크 오버라이드가 없으므로 delayed를 쓴다.
            y는 아래로 갈수록 크다. 실적 1% / 계획 6%면 두 점의 y 차가 3.6px뿐이라 최소 14px을 보장한다. */}
        <line x1={px(todayX)} y1={PLOT_Y0 - 4} x2={px(todayX)} y2={py(0) + 4}
          className="stroke-delayed" strokeWidth="0.8" strokeDasharray="2 2" />
        <line x1={px(todayX)} y1={Math.max(py(actual), py(planned) + 14)} x2={px(todayX)} y2={py(planned)}
          className="stroke-delayed" strokeWidth="2.2" opacity="0.55" />
        <circle cx={px(todayX)} cy={py(planned)} r="1.7" fill="none" className="stroke-brand" strokeWidth="0.9" />
        <circle cx={px(todayX)} cy={py(actual)} r="2.3" className="fill-done" />
        <text x={px(todayX) + 4} y={py(actual) + 1.5} fontSize="5" className="fill-ink-muted">{varianceText}</text>

        {/* 마일스톤 다이아몬드 */}
        {milestones.map(m => (
          <path key={m.id} d={`M${px(m.x)},${MS_Y} l2.3,2.3 -2.3,2.3 -2.3,-2.3 Z`}
            className={m.done ? 'fill-done' : 'fill-accent-warning'}>
            <title>{`${m.name} · ${fmtDate(m.date)}`}</title>
          </path>
        ))}

        {/* 단계 띠 — 기하는 계획 기간, 채움은 롤업 plannedPct. 미착수는 빗금. */}
        {bands.map((b, i) => {
          const y = BAND_Y0 + i * (BAND_H + BAND_GAP)
          const w = Math.max(1, px(b.x1) - px(b.x0))
          // 띠가 오른쪽 끝까지 뻗으면 라벨을 왼쪽 안쪽에 그린다.
          const labelRight = px(b.x1) + 3 > VB_W - 40
          return (
            <g key={b.id}>
              <rect x={px(b.x0)} y={y} width={w} height={BAND_H} rx={BAND_H / 2}
                className={b.started ? 'fill-phasebar' : ''}
                fill={b.started ? undefined : 'url(#journeyHatch)'} opacity={b.started ? 0.3 : 1} />
              {b.started && (
                <rect x={px(b.x0)} y={y} width={(w * b.fillPct) / 100} height={BAND_H} rx={BAND_H / 2} className="fill-brand" />
              )}
              <text
                x={labelRight ? px(b.x0) - 3 : px(b.x1) + 3}
                textAnchor={labelRight ? 'end' : 'start'}
                y={y + BAND_H - 0.6} fontSize="4.4" className="fill-ink-muted"
              >
                {b.name}{b.started ? ` ${b.fillPct}%` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </SectionCard>
  )
}
```

이 카드가 쓰는 신규 dict 키는 Task 8 Step 4에서 이미 추가되어 있다.

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/dashboard/JourneyCard.tsx
git commit -m "feat(dashboard): JourneyCard — 계획 곡선·단계 띠·마일스톤 SVG (RSC)"
```

---

## Task 11: `ActionCard.tsx`

**고정 행수 캡이 없다.** 현행 코드는 배지에 `delayed.length`(15)를 찍고 `slice(0,8)`로 8개만 그린다 — 카드가 자기가 방금 말한 숫자를 부정한다. 대신 리스트가 높이만큼 렌더하고 내부 스크롤하며, 푸터는 **항상** 전체 건수와 WBS 링크를 보여준다.

행은 `next/link`라 클라이언트 훅이 필요 없다. **딥링크 없이** `/p/{id}/wbs`로만 간다 (스펙 §15).

**Files:**
- Create: `src/components/dashboard/ActionCard.tsx`

- [ ] **Step 1: 컴포넌트를 쓴다**

`src/components/dashboard/ActionCard.tsx`:

```tsx
import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { ActionRow } from '@/lib/domain/attention'
import { SectionCard } from '@/components/ui/SectionCard'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { CountBadge, MiniEmpty } from './primitives'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

export async function ActionCard({ rows, projectId }: { rows: ActionRow[]; projectId: string }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const wbsHref = `/p/${projectId}/wbs`

  return (
    <SectionCard
      eyebrow="ACTION REQUIRED"
      title={tr('dash.action.title')}
      icon={AlertTriangle}
      fill
      bodyClassName="flex min-h-0 flex-col"
      actions={<CountBadge n={rows.length} unit={tr('dash.unitCount')} tone="bg-delayed-weak text-delayed" />}
    >
      {rows.length === 0 ? (
        <MiniEmpty text={tr('dash.action.empty')} />
      ) : (
        <>
          {/* 내부 스크롤. 부모가 overscroll-y-contain이므로 여기도 contain 해야 페이지를 끌고 가지 않는다. */}
          <ul className="-mr-2 min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain pr-2">
            {rows.map(row => {
              const badge = row.overdueDays > 0
                ? `${row.overdueDays}${tr('dash.action.overdueSuffix')}`
                : row.kind === 'delayed'
                  ? tr('dash.action.delayedTag')
                  : `D-${row.dday}`
              const urgent = row.kind === 'delayed'
              return (
                <li key={row.item.id}>
                  <Link href={wbsHref} className="flex items-center gap-2.5 py-2.5 transition hover:bg-surface-2/50">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                      urgent ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'}`}>
                      {badge}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink" title={row.item.name}>
                        {row.item.name}
                      </span>
                      <span className="mt-0.5 block truncate tabular-nums text-[10px] text-ink-subtle">
                        {row.item.plannedEnd ? fmtDate(row.item.plannedEnd) : '—'}
                        {row.gapPp > 0 && ` · ${tr('dash.action.gapLabel')} ${row.gapPp}%p`}
                      </span>
                    </span>
                    <OwnerBadges owners={row.item.owners} />
                  </Link>
                </li>
              )
            })}
          </ul>
          <Link href={wbsHref}
            className="mt-2 flex shrink-0 items-center justify-center gap-1 border-t border-dashed border-line pt-2 text-[11px] font-semibold text-ink-muted transition hover:text-brand">
            {tr('dash.action.totalPrefix')}{rows.length}{tr('dash.unitCount')} · {tr('dash.action.viewAll')}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </SectionCard>
  )
}
```

`rows.length`는 **잘리지 않은 전체 건수**다. 리스트가 몇 행을 보여주든 배지와 푸터는 항상 같은 숫자를 말한다.

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/dashboard/ActionCard.tsx
git commit -m "feat(dashboard): ActionCard — 지연∪임박 단일 우선순위 리스트, 캡 없는 내부 스크롤"
```

---

## Task 12: `BottleneckCard.tsx`

**`<div>` 그리드가 아니라 진짜 `<table>`이다.** 20칸 행렬의 올바른 원시 자료는 HTML이고, `<div>`는 스크린리더에서 행/열 연관을 파괴한다.

**색이 단독으로 의미를 지지 않는다.** 팔레트가 청록-초록 / 파랑 / 진홍이라 `done` vs `delayed`는 적록색약의 전형적 실패다. 그래서 셀마다 글리프, 예정은 빗금(질감), 미배정은 점선 테두리(테두리 스타일) — 세 채널이 직교한다. 인쇄 시 `background-color`가 떨어져도 살아남는다.

**팀을 색으로 인코딩하지 않는다.** `--color-team-*`은 다크 오버라이드가 없고 `--color-team-가공`은 아예 존재하지 않는다(`team-dt` 잔재). 팀은 열 축의 라벨 텍스트다.

**Files:**
- Create: `src/components/dashboard/BottleneckCard.tsx`

- [ ] **Step 1: 컴포넌트를 쓴다**

`src/components/dashboard/BottleneckCard.tsx`:

```tsx
import { Grid3x3 } from 'lucide-react'
import type { BottleneckCell, BottleneckModel, CellState } from '@/lib/domain/bottleneck'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** 색조 = 상태(범주형), 질감/테두리 = 두 번째 채널, 글리프 = 세 번째. 색 단독 의미 부여 금지. */
const CELL: Record<CellState, { box: string; glyph: string }> = {
  unassigned: { box: 'border border-dashed border-line bg-surface-2/40 text-ink-subtle', glyph: '' },
  done:       { box: 'bg-done-weak text-done', glyph: '✓' },
  delayed:    { box: 'bg-delayed-weak text-delayed font-bold', glyph: '⚠' },
  scheduled:  { box: 'hatch bg-pending-weak/50 text-ink-muted', glyph: '○' },
  inProgress: { box: 'bg-progress-weak text-progress font-bold', glyph: '·' },
}

function cellText(c: BottleneckCell, tr: (k: DictKey) => string): { head: string; sub: string } {
  switch (c.state) {
    case 'unassigned': return { head: '–', sub: '' }
    case 'done':       return { head: '100%', sub: `${c.count}${tr('dash.unitCount')}` }
    case 'delayed':    return { head: `${tr('dash.bottleneck.delayed')} ${c.delayedCount}`, sub: `/ ${c.count}${tr('dash.unitCount')} · ${c.avgPct}%` }
    case 'scheduled':  return { head: c.dday == null ? tr('dash.bottleneck.scheduled') : `D-${c.dday}`, sub: `${tr('dash.bottleneck.scheduled')} ${c.count}${tr('dash.unitCount')}` }
    case 'inProgress': return { head: `${c.avgPct}%`, sub: `${c.count}${tr('dash.unitCount')}` }
  }
}

export async function BottleneckCard({ model }: { model: BottleneckModel }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  const stateLabel: Record<CellState, string> = {
    unassigned: tr('dash.bottleneck.noOwner'),
    done: tr('status.done'),
    delayed: tr('dash.bottleneck.delayed'),
    scheduled: tr('dash.bottleneck.scheduled'),
    inProgress: tr('status.in_progress'),
  }

  return (
    <SectionCard eyebrow="BOTTLENECK" title={tr('dash.bottleneck.title')} icon={Grid3x3} fill
      bodyClassName="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-separate border-spacing-[3px] text-[9px]">
          <caption className="sr-only">{tr('dash.bottleneck.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[46px]"><span className="sr-only">{tr('dash.phase.axis')}</span></th>
              {model.teams.map(team => (
                <th key={team} scope="col" className="p-0.5 text-[8.5px] font-semibold text-ink-subtle">{team}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.phases.map((phase, pi) => (
              <tr key={phase.id}>
                <th scope="row" title={phase.name}
                  className="max-w-[46px] truncate p-0.5 text-left text-[8.5px] font-medium text-ink-muted">
                  {phase.name}
                </th>
                {model.cells[pi].map(c => {
                  const { head, sub } = cellText(c, tr)
                  const style = CELL[c.state]
                  return (
                    <td key={c.team}
                      aria-label={`${phase.name} · ${c.team} · ${stateLabel[c.state]}${c.count ? ` · ${c.count}${tr('dash.unitCount')}` : ''}`}
                      className={`relative h-9 rounded px-0.5 text-center leading-tight ${style.box}`}>
                      {style.glyph && <span aria-hidden className="absolute right-0.5 top-0.5 text-[7px] opacity-70">{style.glyph}</span>}
                      <span className="block tabular-nums">{head}</span>
                      {sub && <span className="block text-[7.5px] opacity-70">{sub}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 shrink-0 text-[8.5px] leading-relaxed text-ink-subtle">
        {tr('dash.bottleneck.legend')}
        {model.unassignedLeaves > 0 && (
          <>
            <br />
            {tr('dash.bottleneck.unassignedLeaves')} {model.unassignedLeaves}{tr('dash.unitCount')}
          </>
        )}
      </p>
    </SectionCard>
  )
}
```

⚠️ 무담당 리프가 있으면 각주가 반드시 뜬다. **조용히 버리지 않는다.**

⚠️ `status.done` / `status.in_progress`는 `dict/common.ts`의 기존 키다. 새로 만들지 않는다.

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/dashboard/BottleneckCard.tsx
git commit -m "feat(dashboard): BottleneckCard — 단계×팀 접근성 table, 색+질감+글리프 3채널"
```

---

## Task 13: `DetailAccordion` — 죽은 group id를 다시 저장하지 않는다

낡은 id(`analysis`, `scheduleRisk`)는 렌더에서는 무해한 no-op(`open.has(g.id)`가 매치되지 않을 뿐)이다. 그러나 `toggle()`이 `[...next]`를 통째로 다시 저장하므로 **영원히 DB에 남는다.** 마이그레이션은 필요 없고, 저장 직전에 필터하면 된다.

`teamDeliv` id는 재사용하므로, 그 그룹을 펼쳐 두었던 사용자의 상태는 그대로 보존된다.

**Files:**
- Modify: `src/components/dashboard/DetailAccordion.tsx`
- Test: `tests/ui/dashboard-accordion-prefs.test.tsx`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/ui/dashboard-accordion-prefs.test.tsx`:

`@testing-library/react`는 이 저장소에 **없다**. 기존 UI 테스트(`tests/ui/sidebar-sync.test.tsx`)와 똑같이 `react-dom/client` + `act`를 직접 쓰고, `queueUiPref`를 모킹한다.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { DetailAccordion } from '@/components/dashboard/DetailAccordion'

const groups = [
  { id: 'teamDeliv', title: '팀 · 산출물', content: <div>팀 본문</div> },
  { id: 'weekly', title: '주간 리듬', content: <div>주간 본문</div> },
]
const STALE = ['analysis', 'scheduleRisk', 'teamDeliv']

describe('DetailAccordion — 낡은 dashSections id', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container); queueUiPref.mockClear()
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const mount = () => act(() => {
    root.render(<StrictMode><DetailAccordion groups={groups} initialExpanded={STALE} /></StrictMode>)
  })

  it('낡은 id는 아무 그룹도 열지 않고, teamDeliv만 열린다', () => {
    mount()
    expect(container.textContent).toContain('팀 본문')
    expect(container.textContent).not.toContain('주간 본문')
  })

  it('토글 시 낡은 id를 다시 저장하지 않는다', () => {
    mount()
    const weeklyBtn = [...container.querySelectorAll('button')]
      .find(b => b.textContent?.includes('주간 리듬'))!
    act(() => { weeklyBtn.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ dashSections: ['teamDeliv', 'weekly'] })
  })
})
```

`queueUiPref`를 모킹하므로 600ms debounce 타이머를 기다릴 필요가 없다 — 호출 인자만 검사한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run tests/ui/dashboard-accordion-prefs.test.tsx`
Expected: FAIL — `queueUiPref`가 `{ dashSections: ['analysis','scheduleRisk','teamDeliv','weekly'] }`로 호출됨

- [ ] **Step 3: 필터를 넣는다**

`src/components/dashboard/DetailAccordion.tsx`의 `toggle`:

```tsx
export function DetailAccordion({ groups, initialExpanded }: {
  groups: AccordionGroup[]
  initialExpanded: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialExpanded))
  // 부수효과(queueUiPref)는 업데이터 밖 이벤트 핸들러에서 — 업데이터는 순수 유지(StrictMode 이중호출 안전).
  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id); else next.add(id)
    setOpen(next)
    // 렌더되지 않는 낡은 group id(analysis·scheduleRisk)를 DB에 영구 잔류시키지 않는다.
    const live = new Set(groups.map(g => g.id))
    queueUiPref({ dashSections: [...next].filter(gid => live.has(gid)) })
  }
  // …나머지 동일
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run tests/ui/dashboard-accordion-prefs.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/dashboard/DetailAccordion.tsx tests/ui/dashboard-accordion-prefs.test.tsx
git commit -m "fix(dashboard): 아코디언 저장 시 죽은 group id 필터 (TDD)"
```

---

## Task 14: `DashboardView` 재작성 + 로더 정리

491줄 → 조립만. 계산은 전부 Task 1~7의 도메인 함수가 한다.

**Files:**
- Modify: `src/components/dashboard/DashboardView.tsx`
- Modify: `src/app/(app)/p/[projectId]/dashboard/page.tsx`

- [ ] **Step 1: `DashboardView.tsx` 전체를 교체한다**

```tsx
import { Users, FileText, CheckCircle2, CalendarClock, CalendarPlus, BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem } from '@/lib/domain/types'
import { buildJourney } from '@/lib/domain/journey'
import { buildActionRows } from '@/lib/domain/attention'
import { buildBottleneck } from '@/lib/domain/bottleneck'
import { collectLeaves, TEAMS } from '@/lib/domain/tree'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { TEAM, OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { DetailAccordion } from './DetailAccordion'
import { JourneyCard } from './JourneyCard'
import { ActionCard } from './ActionCard'
import { BottleneckCard } from './BottleneckCard'
import { CountBadge, MiniEmpty, Stat } from './primitives'

/* ── 날짜 유틸 (UTC 기준 정수 일수 → DST 무관) ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
const shift = (s: string, n: number) => new Date(ms(s) + n * DAY).toISOString().slice(0, 10)
function weekStart(today: string): string {
  const dow = new Date(ms(today)).getUTCDay() // 0=일 … 6=토
  return shift(today, -((dow + 6) % 7))       // 월요일 시작
}
function intersects(start: string | null, end: string | null, ws: string, we: string): boolean {
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return false
  return s <= we && e >= ws // 'YYYY-MM-DD' 사전식 = 시간순
}

const avg = (ns: number[]): number => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0)

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function TaskRow({ item }: { item: ComputedItem }) {
  return (
    <li className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</span>
        <StatusPill status={item.status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1"><ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" /></div>
        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-ink-muted">{item.rolledActualPct}%</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-ink-subtle">
        <OwnerBadges owners={item.owners} />
        <span className="shrink-0 tabular-nums">{fmtDate(item.plannedStart)} – {fmtDate(item.plannedEnd)}</span>
      </div>
    </li>
  )
}

function GroupTitle({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex items-baseline gap-2">
      {label}
      <span className="text-[11px] font-normal text-ink-subtle">{hint}</span>
    </span>
  )
}

export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  holidays = [],
  announcements = [],
  initialExpanded = [],
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
  holidays?: string[]
  announcements?: Announcement[]
  initialExpanded?: string[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const leaves = collectLeaves(items)

  /* ── Row 1 모델 ── */
  const journey = buildJourney(items, { startDate, endDate, today, holidays })
  const actionRows = buildActionRows(items, today)
  const bottleneck = buildBottleneck(items, today)

  /* ── Row 2: 팀 · 산출물 ── */
  const teamSummary = (team: (typeof TEAMS)[number]) => {
    const assigned = leaves.filter(l => l.owners.some(o => o.team === team))
    return { count: assigned.length, pct: assigned.length ? avg(assigned.map(l => l.rolledActualPct)) : null }
  }
  const withDeliverable = leaves.filter(l => l.deliverable && l.deliverable.trim())
  const deliverableDone = withDeliverable.filter(l => l.status === 'done').length
  const deliverablePct = withDeliverable.length ? Math.round((deliverableDone / withDeliverable.length) * 100) : 0

  /* ── Row 2: 주간 리듬 ── */
  const ws = weekStart(today), we = shift(ws, 6)
  const nws = shift(ws, 7), nwe = shift(ws, 13)
  const thisWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, ws, we))
  const nextWeek = leaves.filter(l => intersects(l.plannedStart, l.plannedEnd, nws, nwe))
  const recentDone = leaves
    .filter(l => l.status === 'done')
    .sort((a, b) => (b.plannedEnd ?? '').localeCompare(a.plannedEnd ?? ''))
    .slice(0, 6)

  const teamDeliv = (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard eyebrow="TEAM LOAD" title={tr('dash.teamLoad.title')} icon={Users}>
        <div className="space-y-4">
          {TEAMS.map(team => {
            const sm = teamSummary(team)
            return (
              <div key={team}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <span className={`h-2.5 w-2.5 rounded-full ${TEAM[team].bar}`} />{team}
                    <span className="font-normal text-ink-subtle">· {sm.count}{tr('dash.unitTasks')}</span>
                  </span>
                  <span className="tabular-nums font-semibold text-ink">{sm.pct == null ? tr('dash.noAssignment') : `${sm.pct}%`}</span>
                </div>
                <ProgressBar value={sm.pct ?? 0} tone={TEAM[team].bar} />
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard eyebrow="DELIVERABLES" title={tr('dash.deliv.title')} icon={FileText}
        actions={<CountBadge n={withDeliverable.length} unit={tr('dash.unitCount')} />}>
        {withDeliverable.length === 0 ? (
          <MiniEmpty text={tr('dash.deliv.empty')} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={tr('dash.deliv.total')} value={`${withDeliverable.length}${tr('dash.unitCount')}`} />
              <Stat label={tr('dash.deliv.done')} value={`${deliverableDone}${tr('dash.unitCount')}`} sub={`${deliverablePct}%`} />
              <Stat label={tr('dash.deliv.open')} value={`${withDeliverable.length - deliverableDone}${tr('dash.unitCount')}`} />
            </div>
            <ProgressBar value={deliverablePct} tone="bg-done" height="h-2.5" />
            <ul className="space-y-1.5">
              {withDeliverable.filter(l => l.status !== 'done').slice(0, 5).map(l => (
                <li key={l.id} className="flex items-center gap-2 text-[12px]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="truncate text-ink-muted" title={l.deliverable ?? ''}>{l.deliverable}</span>
                  <span className="ml-auto shrink-0"><StatusPill status={l.status} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
    </div>
  )

  const weekly = (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard eyebrow="THIS WEEK" title={tr('dash.thisWeek.title')} icon={CalendarClock}
        actions={<CountBadge n={thisWeek.length} unit={tr('dash.unitCount')} />}>
        {thisWeek.length === 0
          ? <MiniEmpty text={tr('dash.thisWeek.empty')} />
          : <ul className="space-y-2">{thisWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>}
      </SectionCard>

      <SectionCard eyebrow="NEXT WEEK" title={tr('dash.nextWeek.title')} icon={CalendarPlus}
        actions={<CountBadge n={nextWeek.length} unit={tr('dash.unitCount')} />}>
        {nextWeek.length === 0
          ? <MiniEmpty text={tr('dash.nextWeek.empty')} />
          : <ul className="space-y-2">{nextWeek.slice(0, 6).map(tk => <TaskRow key={tk.id} item={tk} />)}</ul>}
      </SectionCard>

      <SectionCard eyebrow="RECENTLY DONE" title={tr('dash.recentDone.title')} icon={CheckCircle2}
        actions={<CountBadge n={leaves.filter(l => l.status === 'done').length} unit={tr('dash.unitCount')} tone="bg-done-weak text-done" />}>
        {recentDone.length === 0 ? (
          <MiniEmpty text={tr('dash.recentDone.empty')} />
        ) : (
          <ul className="space-y-2">
            {recentDone.map(tk => (
              <li key={tk.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-done-weak text-done"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={tk.name}>{tk.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-subtle">{tr('status.done')} · {fmtDate(tk.plannedEnd)}</div>
                </div>
                <OwnerBadges owners={tk.owners} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )

  return (
    // @container — 사이드바 248↔78px 스윙은 미디어쿼리에 안 보인다. 1280px에서 컨테이너는 976 또는 1146.
    <div className="@container space-y-5">
      <ExecSummary
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={projectDescription}
        startDate={startDate}
        endDate={endDate}
        today={today}
        announcements={announcements}
      />

      {/* Row 1 — 스크롤 0은 이 행 한정, ≥900dvh, 3열 구간에서만 보장된다. */}
      <div className="grid gap-5
                      @min-[48rem]:h-[clamp(19rem,calc(100dvh-31rem),30rem)]
                      @min-[48rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]
                      @min-[68rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(17rem,0.78fr)]">
        <div className="min-h-0 @min-[48rem]:col-span-2 @min-[68rem]:col-span-1">
          <JourneyCard model={journey} />
        </div>
        <div className="min-h-0"><ActionCard rows={actionRows} projectId={projectId} /></div>
        <div className="min-h-0"><BottleneckCard model={bottleneck} /></div>
      </div>

      {/* Row 2 — 기본 접힘. teamDeliv는 id를 재사용해 기존 사용자의 펼침 상태를 보존한다. */}
      <DetailAccordion
        initialExpanded={initialExpanded}
        groups={[
          { id: 'teamDeliv', title: <GroupTitle label={tr('dash.group.teamDeliv')} hint={`${tr('dash.deliv.title')} ${withDeliverable.length}`} />, content: teamDeliv },
          { id: 'weekly', title: <GroupTitle label={tr('dash.group.weekly')} hint={`${tr('dash.thisWeek.title')} ${thisWeek.length} · ${tr('dash.nextWeek.title')} ${nextWeek.length}`} />, content: weekly },
        ]}
      />
    </div>
  )
}
```

⚠️ 3열의 각 칸을 `<div className="min-h-0">`로 감싼 이유: `SectionCard fill`의 `h-full`이 그리드 아이템의 늘어난 높이를 잡으려면 부모가 `min-h-0`이어야 한다. 감싸지 않으면 카드가 내용 높이로 부풀어 행 높이를 결정한다.

- [ ] **Step 2: `page.tsx` — 로더 6개 → 4개, holidays 추가**

`getAttendanceRecords`와 `getProjectMembers`의 유일한 대시보드 소비처가 근태 카드였다. **로더 자체는 지우지 않는다** (attendance/members/meetings 페이지와 report route가 계속 쓴다). 호출만 뺀다 → Supabase 왕복 2회 감소.

`getComputedWbs`는 이미 `holidays`를 반환하는데 지금은 버리고 있다. 구조분해만 넓힌다 — 추가 쿼리 0.

`src/app/(app)/p/[projectId]/dashboard/page.tsx` 전체:

```tsx
import { getComputedWbs } from '@/lib/data/wbs'
import { getAnnouncements } from '@/lib/data/announcements'
import { getUiPrefs } from '@/app/actions/preferences'
import { listProjects } from '@/app/actions/project'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, today, holidays }, projects, announcements, prefs] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getUiPrefs(),
  ])
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'dash.heroProjectFallback')

  return (
    <ProjectPageShell hero={<PageHero title={`${projectName}${t(locale, 'dash.heroTitleSuffix')}`} />}>
      <DashboardView
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={project?.description}
        startDate={project?.start_date ?? null}
        endDate={project?.end_date ?? null}
        today={today}
        holidays={holidays}
        announcements={announcements}
        initialExpanded={prefs.dashSections ?? []}
      />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 3: 타입 확인 — 죽은 i18n 키가 여기서 드러난다**

Run: `npx tsc --noEmit`
Expected: 에러 0. (아직 dict에서 키를 지우지 않았으므로 통과한다.)

- [ ] **Step 4: i18n 죽은 키를 지운다 (ko 먼저, en 다음)**

이제 렌더 코드가 없으므로 안전하다. `src/lib/i18n/dict/dashboard.ts`의 `dashboardKo`와 `dashboardEn` **양쪽에서** 지운다:

```
dash.statusMix.title
dash.weight.title
dash.phase.title
dash.kpi.delayed
dash.delayed.empty
dash.overdueSuffix
dash.gapLabel
dash.group.analysis
dash.group.scheduleRisk
dash.att.title  .records  .leave  .tripRemote  .empty
dash.att.work  .remote  .annual  .half  .quarter  .sick  .trip  .official  .absent
dash.att.memberPrefix  .memberSuffix  .regPrefix  .regSuffix
```

`dash.att.*`는 근태 **페이지**와 공유되지 않는다 — 그쪽은 `att.*` 네임스페이스다. 주간보고(`src/lib/report/*`)는 `dash.*`를 하나도 참조하지 않는다.

- [ ] **Step 5: 삭제가 안전했는지 증명한다**

```bash
grep -rn "dash\.att\.\|dash\.statusMix\|dash\.weight\|dash\.phase\.title\|dash\.kpi\.delayed\|dash\.delayed\.empty\|dash\.overdueSuffix\|dash\.gapLabel\|dash\.group\.analysis\|dash\.group\.scheduleRisk" src/ | grep -v "i18n/dict/dashboard.ts"
```
Expected: **출력 없음.** 한 줄이라도 나오면 그 키는 아직 쓰이고 있으니 되살린다.

`dashboardEn`이 `Record<keyof typeof dashboardKo, string>`이므로 en에만 남은 키는 컴파일 에러가 된다:

Run: `npx tsc --noEmit`
Expected: 에러 0

- [ ] **Step 6: 전체 스위트 + 빌드**

Run: `npx vitest run && npm run build`
Expected: 테스트 전부 PASS, 빌드 성공, RSC 경계 위반 없음

- [ ] **Step 7: 커밋**

```bash
git add src/components/dashboard/DashboardView.tsx src/app/\(app\)/p/\[projectId\]/dashboard/page.tsx src/lib/i18n/dict/dashboard.ts
git commit -m "feat(dashboard): 지휘 상황판 조립 — 3열 + 접이식 2그룹, 근태·상태분포·가중치 카드 제거"
```

---

## Task 15: 실제 앱에서 검증

테스트와 타입은 계산이 맞는지만 말해준다. 화면이 맞는지는 화면을 봐야 안다. **아래 값들은 2026-07-09 프로덕션 데이터에서 실측한 것이다.** 하나라도 다르면 그 자리에서 멈춘다.

- [ ] **Step 1: dev 서버를 띄운다**

```bash
npm run dev
```
`http://localhost:3000/p/7a1c6034-a647-4673-ae85-d0b6daa2f6f3/dashboard`

- [ ] **Step 2: 숫자 일치 — 같은 화면에서 두 숫자가 싸우지 않는가**

| 확인 | 기대값 |
|---|---|
| ExecSummary 게이지 | 실적 **1%** / 계획 **6%** |
| 여정 카드 헤더 | 실적 1% / 계획 6% / **−5%p** — 게이지와 동일 |
| 여정 곡선의 오늘 지점 | 계획 곡선이 **6%** 를 지난다 (게이지와 같은 값) |
| ExecSummary 리스크 타일 | **14건** (20 아님). 서브텍스트는 `지연 13 · 마감임박 7` |
| 조치 카드 배지 | **14건** — 리스크 타일과 일치 |
| 조치 카드 푸터 | `전체 14건 · WBS에서 전체 보기` |
| 조치 첫 4행 | PMO, `2일 초과`, 격차 100%p (TFT R&R 확정 등) |
| 병목 20칸 | 지연 **5** · 예정 **11** · 미배정 **4**. 죽은 칸 0 |
| 병목 3행(To-Be) | PMO `–`, ERP/MES/가공 각 `D-39` + `예정 17건` |
| 병목 각주 | 미배정 리프 0건이므로 **각주가 안 뜬다** |
| 여정 예측선 | **없음**. 대신 `예측 미산정 · D+9 / 28` 캡션과 7/28 눈금 |

- [ ] **Step 3: 레이아웃**

- 1440px 뷰포트, 사이드바 펼침 → **3열**
- 1280px, 사이드바 **펼침** → 2열 (여정 전폭)
- 1280px, 사이드바 **접힘** → 3열 ← 미디어쿼리로는 불가능한 지점. 여기가 컨테이너 쿼리의 존재 이유다.
- 900dvh에서 Row 1이 스크롤 없이 들어간다 (Row 2 접이식은 폴드 아래 — 정상)
- 조치 리스트가 카드를 넘치지 않고 **내부에서** 스크롤한다. 페이지가 딸려 스크롤되지 않는다 (`overscroll-contain`)

- [ ] **Step 4: 다크 모드**

- 오늘 세로선이 **`#ff738a`** (밝은 분홍)이다. `#cb4b5f`(어두운 진홍)면 `stroke-today`를 쓴 것이다 — 고친다.
- 병목 예정 셀의 빗금이 보인다.
- 곡선 아래 그라디언트가 다크에서도 브랜드 색이다.

- [ ] **Step 5: 접근성 · 인쇄**

- 병목을 스크린리더로 읽으면 행/열 연관이 들린다 (`<th scope>`).
- 브라우저 인쇄 미리보기(`Cmd+P`)에서 **배경색이 빠져도** 예정 셀의 빗금, 미배정 셀의 점선 테두리, ⚠/○/✓ 글리프가 살아있다.
- 색맹 시뮬레이터(deuteranopia)에서 지연 셀과 완료 셀이 **글리프로** 구분된다.

- [ ] **Step 6: 링크**

- 조치 행을 클릭하면 `/p/{id}/wbs`로 간다.
- 클릭 후 **WBS의 접힘 상태가 바뀌지 않는다.** (딥링크를 넣지 않았으므로 `user_wbs_state`에 쓰기가 없다.)

- [ ] **Step 7: 최종 확인 + 커밋**

```bash
npx vitest run && npx tsc --noEmit && npm run build
git add -A && git commit -m "chore(dashboard): 지휘 상황판 실앱 검증 완료" --allow-empty
```

---

## Self-Review

**스펙 커버리지**

| 스펙 § | 태스크 |
|---|---|
| §5.2 곡선 재귀 롤업 | Task 2 |
| §5.2 종점 100 불변식 | Task 2 (`plannedAt.test.ts`), Task 7 (`terminalPlanned`) |
| §5.3 예측선 게이팅 | Task 7 (`forecast`), Task 10 (렌더) |
| §5.4 milestoneLeaves | Task 4 |
| §5.5 업무일 prefix-sum | Task 1 |
| §6.1 attentionLeaves 단일 출처 | Task 4 |
| §6.2 전순서 comparator | Task 5 |
| §6.3 캡 없음 + 푸터 | Task 11 |
| §6.4 딥링크 없음 | Task 11 |
| §7.1 teamOf 단일 배정 | Task 3 (`primaryTeamOf`), Task 6 |
| §7.2 셀 상태 우선순위 | Task 6 |
| §7.3 table + 3채널 + 빗금 | Task 8 (`.hatch`), Task 12 |
| §8.1 컨테이너 쿼리 | Task 14 |
| §8.2 세로 예산 | Task 14 (`clamp`), Task 15 (검증) |
| §8.3 SectionCard fill | Task 8 |
| §8.4 다크 토큰 함정 2개 | Task 8 (`--color-today`), Task 12 (팀 색 미사용) |
| §9 파일 구조 | Task 1~14 전부 |
| §10 ExecSummary 20→14 | Task 4 (모델), Task 9 (렌더) |
| §11 삭제 | Task 14 Step 4~5 |
| §12 접이식 2그룹 + id 재사용 | Task 13, Task 14 |
| §13 빈 상태 | Task 10 (`journey === null`), Task 11 (`MiniEmpty`) |
| §14 테스트 | Task 1,2,4,5,6,7,13 |
| §15 범위 밖 | 태스크 없음 (의도적) |
| §16 검증 | Task 15 |

**타입 일관성**

- `BizDayIndex.between(a,b)` — Task 1 정의, Task 2·7 사용. 일치.
- `plannedPctWith(start,end,today,between)` — Task 2 정의, Task 2 내부 사용. 일치.
- `ActionRow{item,kind,overdueDays,gapPp,dday,weightShare}` — Task 5 정의, Task 11 사용. `isMilestone`은 스펙 §6.1에 있었으나 **어느 카드도 쓰지 않아 제거**했다(YAGNI).
- `CellState = 'unassigned'|'done'|'delayed'|'scheduled'|'inProgress'` — Task 6 정의, Task 12의 `CELL` 맵·`cellText`·`stateLabel`이 5개 전부 커버.
- `JourneyModel{curve,bands,milestones,todayX,actual,planned,variance,terminalPlanned,elapsed,earlyFloor,earlyFloorX,forecast}` — Task 7 정의, Task 10이 `terminalPlanned`만 안 쓴다(테스트 전용 불변식 노출). 의도적.
- `milestoneLeaves(items)` — Task 4에서 `today` 인자 없음. Task 7에서 `milestoneLeaves(roots)`로 호출. 일치.
- `TEAMS` / `primaryTeamOf` — Task 3 정의, Task 6·14 사용. 일치.
- `SectionCard{fill, bodyClassName}` — Task 8 정의, Task 10·11·12 사용. 일치.

**의도적으로 스펙과 다른 점**

1. `computeNode`가 `plannedRollupAt`을 호출하지 않는다 (O(n²) 회피). 대신 `weightedMean` 결합 규칙을 공유하고 불변식 테스트로 강제한다.
2. `plannedPctWith`를 `progress.ts`에 두어 계획% 계산 구현을 하나로 유지한다 (스펙은 이 함수를 언급하지 않았다).
3. `ActionRow.isMilestone` 제거 — 쓰는 곳이 없다.
4. `REPORT_TEAMS`를 지우지 않고 `TEAMS`의 별칭으로 남긴다 — `report/*` 호출부를 건드리지 않기 위해.
5. 병목 셀 `avgPct`를 `진행중`·`완료`·`지연` 셀에서만 표시한다. 스펙 §7.2 표와 동일.

**남은 위험**

- Task 15 Step 3의 "900dvh에서 Row 1이 스크롤 없이" 는 **측정값에 근거한 추정**이다. `clamp(19rem, calc(100dvh-31rem), 30rem)`의 `31rem`은 header 68 + main pt 24 + hero 55 + gap 20 + ExecSummary(공지 포함) 293 + space-y 20 ≈ 480px = 30rem + 여유. 실측이 어긋나면 이 한 숫자만 조정한다.
- 공지 2건이 07-09/07-10에 만료된다. 만료 후 ExecSummary가 235px로 줄어 Row 1이 58px 넓어진다. **두 높이 모두 정상 경로**이므로 `clamp`의 상한(30rem)이 흡수한다.
