# 칸반보드 활용성 개선 (실행·집중 보드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS 항목을 그대로 둔 채 칸반 UI만 개조해, 진척 3단(시작전/진행중/완료) 실행 보드 + 개인(팀) 렌즈 + 낙관적 드래그로 실무자가 매일 쓰게 만든다.

**Architecture:** 순수 도메인 함수(`kanban.ts`, 신규 `kanban-drop.ts`)로 그룹핑·드롭 규칙·필터·마감신호를 TDD로 먼저 고정하고, 그 위에 `KanbanCard`(카드 강화)·`ProgressPopover`(신규)·`KanbanBoard`(오케스트레이션) UI를 얹는다. 쓰기는 기존 서버 액션 `updateActual`만 재사용(신규 스키마/액션/테이블 없음). 파생 상태(delayed 등)는 컬럼이 아니라 카드 배지+필터로 표현.

**Tech Stack:** Next.js App Router(클라이언트 컴포넌트) · React · TypeScript(strict) · Tailwind 토큰 · Vitest(+jsdom) · lucide-react · 기존 UI 프리미티브(`SegmentedTabs`/`Modal`/`ProgressBar`/`StatusPill`/`EmptyState`/`useToast`).

## Global Constraints

- **범위 잠금:** `src/components/kanban/*`, `src/lib/domain/kanban.ts`, 신규 `src/lib/domain/kanban-drop.ts`, `src/app/(app)/p/[projectId]/kanban/page.tsx`, `src/lib/i18n/dict/kanban.ts` **만** 수정/생성. WBS·이슈 등 **다른 기능의 스키마·페이지·서버 액션·도메인은 절대 수정 금지**. 신규 테이블/컬럼/마이그레이션 **없음**. (근거: 진행 중 운영 프로젝트 — 스펙 §3, 메모 kanban-improvement-scope.)
- **쓰기 경로 유일:** 기존 `updateActual(itemId, newPct, expectedCurrent?)` (=`wbs_items.actual_pct`) 재사용. 새 쓰기 경로·새 액션 금지. 시그니처: `Promise<{ ok: boolean; error?: string; conflict?: boolean }>`.
- **읽기:** 기존 `getComputedWbs` 결과(`items`, `today`) + `getMembership()`만. 추가 조회 없음.
- **패키지 매니저: npm.** 테스트 러너: Vitest. 테스트 위치: 최상위 `tests/`(도메인=`tests/domain/`, UI=`tests/ui/`, 파일명 `*.test.ts(x)`, UI는 첫 줄 `// @vitest-environment jsdom`). 테스트 제목은 한국어 관례.
- **검증 3종(모든 태스크 말미):** `npx vitest run <file>` → `npx tsc --noEmit` → `npm run lint`.
- **커밋:** 이 저장소는 **병렬 세션**이 돌아 `git add -A` **절대 금지**. 각 커밋은 **명시된 파일만** `git add`. (실행자는 사용자의 "요청 시 커밋" 정책을 따르되, 커밋할 때 파일 목록은 아래 스텝대로.)
- **디자인 일관성:** 기존 토큰 팔레트·프리미티브만 사용, 라이트/다크 자동 대응(메모 dkflow-design-consistency).
- **에러 처리:** 표시=로깅, 조용한 실패 금지, 쓰기 실패 시 롤백+토스트, 권한 fail-closed(메모 silent-empty-screens).
- **% 표시:** 카드 `%`는 `Math.round`(메모 pct-precision-convention).
- **불변식:** 카드는 **리프(자식 없는 노드)** 전용. `canEditActual(item, membership)`(말단+PMO 전체/팀 편집자 자기팀)로만 편집 어포던스.

---

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `src/lib/domain/kanban.ts` | 수정(추가) | `bucketOf`·`groupByProgress`·`leafPaths`·`dueSignal`·`lensCards`·`applyQuickFilters`·`sortCards` 추가. 기존 `groupByPhase/Owner/Status`·`leavesOf`·`KanbanColumn` 유지 |
| `src/lib/domain/kanban-drop.ts` | **신규** | `DropResult`·`resolveDrop(card, target)` 순수 상태기계 |
| `src/lib/i18n/dict/kanban.ts` | 수정(추가) | 신규 UI 문자열(ko/en 패리티). 기존 키는 유지 |
| `src/components/kanban/ProgressPopover.tsx` | **신규** | 진척% 입력(프리셋+직접입력), `Modal` size='sm' 기반 |
| `src/components/kanban/KanbanCard.tsx` | 재작성 | breadcrumb·마감 배지·+/− 스텝퍼·착수/완료/재개 액션·카드클릭=WBS 딥링크·드래그 핸들 |
| `src/components/kanban/KanbanBoard.tsx` | 대개조 | 진행 모드 기본·드롭 규칙(resolveDrop)·낙관적+CAS+토스트·렌즈·빠른필터·정렬·온보딩 |
| `src/app/(app)/p/[projectId]/kanban/page.tsx` | 무변경(확인만) | `items`/`today`/`membership` 전달은 이미 존재 |
| `tests/domain/kanban.test.ts` | 수정(추가) | 신규 순수 함수 테스트 |
| `tests/domain/kanbanDrop.test.ts` | **신규** | `resolveDrop` 분기 테스트 |
| `tests/ui/kanban-card.test.tsx` | **신규** | 카드 배지·스텝퍼·딥링크 |
| `tests/ui/kanban-board.test.tsx` | **신규** | 진행 컬럼·렌즈·필터·낙관적 롤백·코치마크 |

**Sequencing:** Task 1→4(순수, 병렬 가능) → 5(dict) → 6(popover) → 7(card) → 8→12(board, 순차 — 같은 파일 누적 수정).

---

## Task 1: 진척 버킷 그룹핑 (`bucketOf` + `groupByProgress`)

**Files:**
- Modify: `src/lib/domain/kanban.ts` (파일 끝에 추가)
- Test: `tests/domain/kanban.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `leavesOf`, `KanbanColumn`, `ComputedItem`.
- Produces: `ProgressBucket = 'not_started'|'in_progress'|'done'`; `bucketOf(pct: number|null): ProgressBucket`; `groupByProgress(items: ComputedItem[]): KanbanColumn[]` (3컬럼, 키=버킷).

- [ ] **Step 1: 실패 테스트 작성** — `tests/domain/kanban.test.ts` 하단에 추가

```ts
import { groupByProgress, bucketOf } from '@/lib/domain/kanban'

// 기존 node() 헬퍼를 rolledActualPct·actualPct 지정 가능하게 확장한다(기존 호출 호환 — opts 선택적).
// node() 정의의 반환 객체에서 아래 두 줄을 교체:
//   actualPct: opts.actualPct ?? (children.length ? null : 0),
//   rolledActualPct: opts.rolledActualPct ?? 0,
// 그리고 opts 타입에 actualPct?: number|null; rolledActualPct?: number 를 추가.

describe('bucketOf', () => {
  it('0·null·음수는 시작전, 100 이상은 완료, 그 사이는 진행중', () => {
    expect(bucketOf(0)).toBe('not_started')
    expect(bucketOf(null)).toBe('not_started')
    expect(bucketOf(-5)).toBe('not_started')
    expect(bucketOf(1)).toBe('in_progress')
    expect(bucketOf(99)).toBe('in_progress')
    expect(bucketOf(100)).toBe('done')
    expect(bucketOf(120)).toBe('done')
  })
})

describe('groupByProgress', () => {
  it('시작전/진행중/완료 3컬럼을 rolledActualPct 기준으로 분류한다', () => {
    const items = [
      node('P', { children: [
        node('L0', { rolledActualPct: 0 }),
        node('L45', { rolledActualPct: 45 }),
        node('L100', { rolledActualPct: 100 }),
      ] }),
    ]
    const cols = groupByProgress(items)
    expect(cols.map(c => c.key)).toEqual(['not_started', 'in_progress', 'done'])
    expect(cols.map(c => c.title)).toEqual(['시작전', '진행중', '완료'])
    const by = (k: string) => cols.find(c => c.key === k)!
    expect(by('not_started').cards.map(c => c.id)).toEqual(['L0'])
    expect(by('in_progress').cards.map(c => c.id)).toEqual(['L45'])
    expect(by('done').cards.map(c => c.id)).toEqual(['L100'])
    expect(cols.reduce((n, c) => n + c.count, 0)).toBe(3)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/kanban.test.ts`
Expected: FAIL — `groupByProgress`/`bucketOf` is not exported (또는 node opts 타입 에러).

- [ ] **Step 3: 구현** — `src/lib/domain/kanban.ts` 끝에 추가

```ts
/** 진척 버킷 키(파생 status 아님 — 원시 실적% 기준). */
export type ProgressBucket = 'not_started' | 'in_progress' | 'done'

/** 실적% → 버킷. 0·null·음수=시작전, 100 이상=완료, 그 사이=진행중. */
export function bucketOf(pct: number | null): ProgressBucket {
  const v = pct ?? 0
  if (v <= 0) return 'not_started'
  if (v >= 100) return 'done'
  return 'in_progress'
}

const PROGRESS_ORDER: ProgressBucket[] = ['not_started', 'in_progress', 'done']
const PROGRESS_LABEL: Record<ProgressBucket, string> = {
  not_started: '시작전', in_progress: '진행중', done: '완료',
}
const PROGRESS_DOT: Record<ProgressBucket, string> = {
  not_started: 'bg-pending', in_progress: 'bg-progress', done: 'bg-done',
}

/** 진척 3단 — 시작전(0%)/진행중(1~99%)/완료(100%). leaf.rolledActualPct 기준. */
export function groupByProgress(items: ComputedItem[]): KanbanColumn[] {
  const leaves = leavesOf(items)
  return PROGRESS_ORDER.map(bucket => {
    const cards = leaves.filter(leaf => bucketOf(leaf.rolledActualPct) === bucket)
    return { key: bucket, title: PROGRESS_LABEL[bucket], count: cards.length, cards, accentDot: PROGRESS_DOT[bucket] }
  })
}
```

- [ ] **Step 4: node() 헬퍼 확장** — `tests/domain/kanban.test.ts`의 `node()` opts 타입과 반환값을 Step 1 주석대로 수정(기존 3개 describe는 그대로 통과해야 함).

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/domain/kanban.test.ts`
Expected: PASS (기존 groupByPhase/Owner/Status 테스트 포함 전부).

- [ ] **Step 6: 타입·린트**

Run: `npx tsc --noEmit` → Expected: no errors. `npm run lint` → Expected: clean.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/kanban.ts tests/domain/kanban.test.ts
git commit -m "feat(kanban): 진척 버킷 그룹핑(bucketOf·groupByProgress) 추가"
```

---

## Task 2: 드롭 상태기계 (`resolveDrop`)

**Files:**
- Create: `src/lib/domain/kanban-drop.ts`
- Test: `tests/domain/kanbanDrop.test.ts`

**Interfaces:**
- Consumes: `ComputedItem`, `ProgressBucket`(from `kanban.ts`).
- Produces: `DropResult = {kind:'noop'} | {kind:'set';pct:number} | {kind:'confirm-reset'} | {kind:'prompt';suggested:number}`; `resolveDrop(card: ComputedItem, target: ProgressBucket): DropResult`.

- [ ] **Step 1: 실패 테스트 작성** — `tests/domain/kanbanDrop.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { resolveDrop } from '@/lib/domain/kanban-drop'

function card(rolledActualPct: number): ComputedItem {
  return {
    id: 'c', parentId: null, level: 'activity', code: 'c', sortOrder: 0, name: 'c',
    biz: null, deliverable: null, plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
    weight: null, actualPct: rolledActualPct, owners: [], plannedPct: 0,
    rolledActualPct, achievement: null, status: 'in_progress', children: [],
  }
}

describe('resolveDrop', () => {
  it('시작전 대상: 이미 0%면 noop, 진척>0이면 확인 요청', () => {
    expect(resolveDrop(card(0), 'not_started')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(40), 'not_started')).toEqual({ kind: 'confirm-reset' })
  })
  it('완료 대상: 이미 100이면 noop, 아니면 100 설정', () => {
    expect(resolveDrop(card(100), 'done')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(40), 'done')).toEqual({ kind: 'set', pct: 100 })
  })
  it('진행중 대상: 1~99면 noop(재정렬), 0에서 오면 30 제안, 100에서 오면 90 제안', () => {
    expect(resolveDrop(card(45), 'in_progress')).toEqual({ kind: 'noop' })
    expect(resolveDrop(card(0), 'in_progress')).toEqual({ kind: 'prompt', suggested: 30 })
    expect(resolveDrop(card(100), 'in_progress')).toEqual({ kind: 'prompt', suggested: 90 })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/kanbanDrop.test.ts`
Expected: FAIL — cannot find module `kanban-drop`.

- [ ] **Step 3: 구현** — `src/lib/domain/kanban-drop.ts`

```ts
// 칸반 드롭 규칙 — 순수(I/O 없음). 컬럼은 진척 버킷(kanban.ts ProgressBucket)이고,
// WBS 상태는 파생값이라 '진행중'으로의 진입은 % 를 물어야 한다(prompt). 데이터 되돌림(진척>0→0%)은 확인(confirm-reset).
import type { ComputedItem } from '@/lib/domain/types'
import type { ProgressBucket } from '@/lib/domain/kanban'

export type DropResult =
  | { kind: 'noop' }
  | { kind: 'set'; pct: number }
  | { kind: 'confirm-reset' }
  | { kind: 'prompt'; suggested: number }

/** 카드를 target 버킷에 드롭했을 때의 결과. cur=현재 실적%(rolledActualPct). 편집 권한은 호출부가 선판정. */
export function resolveDrop(card: ComputedItem, target: ProgressBucket): DropResult {
  const cur = card.rolledActualPct ?? 0
  if (target === 'not_started') return cur <= 0 ? { kind: 'noop' } : { kind: 'confirm-reset' }
  if (target === 'done') return cur >= 100 ? { kind: 'noop' } : { kind: 'set', pct: 100 }
  // in_progress
  if (cur > 0 && cur < 100) return { kind: 'noop' }
  return { kind: 'prompt', suggested: cur >= 100 ? 90 : 30 }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/kanbanDrop.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: 타입·린트** — `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/kanban-drop.ts tests/domain/kanbanDrop.test.ts
git commit -m "feat(kanban): 드롭 상태기계 resolveDrop 추가"
```

---

## Task 3: 카드 맥락·마감 신호 (`leafPaths` + `dueSignal`)

**Files:**
- Modify: `src/lib/domain/kanban.ts`
- Test: `tests/domain/kanban.test.ts`

**Interfaces:**
- Produces: `leafPaths(items): Map<string, string[]>` (리프 id → 루트→부모 이름 배열); `DueSignal = {kind:'overdue';days:number} | {kind:'due';days:number} | null`; `dueSignal(plannedEnd: string|null, cur: number, today: string): DueSignal`.

- [ ] **Step 1: 실패 테스트 작성** — `tests/domain/kanban.test.ts` 하단에 추가

```ts
import { leafPaths, dueSignal } from '@/lib/domain/kanban'

describe('leafPaths', () => {
  it('리프마다 루트→부모 이름 경로를 만든다', () => {
    const items = [
      node('A', { name: '준비', children: [
        node('A1', { name: '설계', children: [ node('L', { name: '리프' }) ] }),
      ] }),
    ]
    const m = leafPaths(items)
    expect(m.get('L')).toEqual(['준비', '설계'])
    expect(m.has('A')).toBe(false) // 중간 노드는 키 아님
  })
})

describe('dueSignal', () => {
  const today = '2026-07-25'
  it('완료(100%)는 신호 없음', () => {
    expect(dueSignal('2026-07-01', 100, today)).toBeNull()
  })
  it('기한 경과+미완은 overdue(경과 일수)', () => {
    expect(dueSignal('2026-07-20', 40, today)).toEqual({ kind: 'overdue', days: 5 })
  })
  it('기한 이전은 due(남은 일수), 당일은 0', () => {
    expect(dueSignal('2026-07-28', 40, today)).toEqual({ kind: 'due', days: 3 })
    expect(dueSignal('2026-07-25', 0, today)).toEqual({ kind: 'due', days: 0 })
  })
  it('plannedEnd 없으면 null', () => {
    expect(dueSignal(null, 40, today)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/domain/kanban.test.ts` → FAIL (미export).

- [ ] **Step 3: 구현** — `src/lib/domain/kanban.ts` 끝에 추가

```ts
/** 리프 id → 조상 이름 배열(루트→부모 순, 카드 breadcrumb 용). */
export function leafPaths(items: ComputedItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (ns: ComputedItem[], path: string[]) => {
    for (const n of ns) {
      if (!n.children.length) map.set(n.id, path)
      else walk(n.children, [...path, n.name])
    }
  }
  walk(items, [])
  return map
}

/** 두 'YYYY-MM-DD' 사이 캘린더 일수(to - from). 칸반 마감신호 전용(자기완결). */
function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

export type DueSignal =
  | { kind: 'overdue'; days: number }
  | { kind: 'due'; days: number }
  | null

/** 마감 신호(순수). 완료면 없음, 기한 경과+미완=overdue, 그 외=due(남은 일수). today·plannedEnd는 'YYYY-MM-DD'. */
export function dueSignal(plannedEnd: string | null, cur: number, today: string): DueSignal {
  if (!plannedEnd || cur >= 100) return null
  const d = dayDiff(today, plannedEnd)
  return d < 0 ? { kind: 'overdue', days: -d } : { kind: 'due', days: d }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/domain/kanban.test.ts` → PASS.

- [ ] **Step 5: 타입·린트** — `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/kanban.ts tests/domain/kanban.test.ts
git commit -m "feat(kanban): 카드 맥락(leafPaths)·마감신호(dueSignal) 추가"
```

---

## Task 4: 렌즈·빠른필터·정렬 (`lensCards` + `applyQuickFilters` + `sortCards`)

**Files:**
- Modify: `src/lib/domain/kanban.ts`
- Test: `tests/domain/kanban.test.ts`

**Interfaces:**
- Produces:
  - `lensCards(leaves, lens: 'myTeam'|'all', myTeam: string|null): ComputedItem[]`
  - `QuickFilters = { overdue:boolean; dueThisWeek:boolean; inProgress:boolean; notStarted:boolean }`
  - `applyQuickFilters(leaves, f: QuickFilters, today: string): ComputedItem[]`
  - `sortCards(cards, today: string): ComputedItem[]`

- [ ] **Step 1: 실패 테스트 작성** — `tests/domain/kanban.test.ts` 하단

```ts
import { lensCards, applyQuickFilters, sortCards } from '@/lib/domain/kanban'

describe('lensCards', () => {
  it("myTeam은 내 팀이 담당(primary/support)인 리프만, all은 전체", () => {
    const leaves = [
      node('a', { owners: [{ team: 'PMO', kind: 'primary' }] }),
      node('b', { owners: [{ team: 'ERP', kind: 'support' }] }),
    ]
    expect(lensCards(leaves, 'myTeam', 'ERP').map(c => c.id)).toEqual(['b'])
    expect(lensCards(leaves, 'all', 'ERP').map(c => c.id)).toEqual(['a', 'b'])
    expect(lensCards(leaves, 'myTeam', null).map(c => c.id)).toEqual(['a', 'b']) // 팀 미상이면 전체
  })
})

describe('applyQuickFilters', () => {
  const today = '2026-07-25'
  const leaves = [
    node('over', { status: 'delayed', rolledActualPct: 30, plannedEnd: '2026-07-20' }),
    node('soon', { status: 'in_progress', rolledActualPct: 30, plannedEnd: '2026-07-28' }),
    node('far', { status: 'in_progress', rolledActualPct: 30, plannedEnd: '2026-09-01' }),
    node('ns', { status: 'not_started', rolledActualPct: 0, plannedEnd: '2026-08-01' }),
  ]
  const off = { overdue: false, dueThisWeek: false, inProgress: false, notStarted: false }
  it('아무것도 안 켜면 전부', () => {
    expect(applyQuickFilters(leaves, off, today).length).toBe(4)
  })
  it('overdue=지연 status만', () => {
    expect(applyQuickFilters(leaves, { ...off, overdue: true }, today).map(c => c.id)).toEqual(['over'])
  })
  it('dueThisWeek=오늘~+6일 마감', () => {
    expect(applyQuickFilters(leaves, { ...off, dueThisWeek: true }, today).map(c => c.id).sort()).toEqual(['over', 'soon'].sort())
    // over(-5)는 범위 밖(<0)이므로 제외되는지 확인: over의 plannedEnd 2026-07-20 < today → dueThisWeek 제외
  })
  it('notStarted=버킷 시작전만', () => {
    expect(applyQuickFilters(leaves, { ...off, notStarted: true }, today).map(c => c.id)).toEqual(['ns'])
  })
})

describe('sortCards', () => {
  it('지연 우선 → 계획종료 오름차순 → 이름', () => {
    const cards = [
      node('c', { name: '가', status: 'in_progress', plannedEnd: '2026-08-10' }),
      node('a', { name: '나', status: 'delayed', plannedEnd: '2026-08-20' }),
      node('b', { name: '다', status: 'in_progress', plannedEnd: '2026-08-05' }),
    ]
    expect(sortCards(cards, '2026-07-25').map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})
```

> 주의: `dueThisWeek` 테스트에서 `over`(2026-07-20)는 `dayDiff(today, end) = -5 < 0` 이므로 제외되어야 한다. 즉 기대값은 `['soon']`. 위 테스트의 기대를 `expect(...).toEqual(['soon'])` 로 확정하라(주석의 계산을 반영).

- [ ] **Step 2: 위 테스트의 dueThisWeek 기대값을 `['soon']`으로 수정** 후 저장.

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/domain/kanban.test.ts` → FAIL (미export).

- [ ] **Step 4: 구현** — `src/lib/domain/kanban.ts` 끝에 추가 (`bucketOf`·`dayDiff`는 이미 이 파일에 있음)

```ts
/** 렌즈: 'myTeam'=내 팀이 담당(primary/support)인 리프만, 'all'=전체. myTeam 미상이면 전체. */
export function lensCards(leaves: ComputedItem[], lens: 'myTeam' | 'all', myTeam: string | null): ComputedItem[] {
  if (lens === 'all' || !myTeam) return leaves
  return leaves.filter(leaf => leaf.owners.some(o => o.team === myTeam))
}

export interface QuickFilters {
  overdue: boolean
  dueThisWeek: boolean
  inProgress: boolean
  notStarted: boolean
}

/** 빠른 필터(켜진 것만 AND). overdue=파생 지연, in/not=실적% 버킷, dueThisWeek=오늘~+6일 마감. */
export function applyQuickFilters(leaves: ComputedItem[], f: QuickFilters, today: string): ComputedItem[] {
  return leaves.filter(leaf => {
    if (f.overdue && leaf.status !== 'delayed') return false
    if (f.inProgress && bucketOf(leaf.rolledActualPct) !== 'in_progress') return false
    if (f.notStarted && bucketOf(leaf.rolledActualPct) !== 'not_started') return false
    if (f.dueThisWeek) {
      if (!leaf.plannedEnd) return false
      const d = dayDiff(today, leaf.plannedEnd)
      if (d < 0 || d > 6) return false
    }
    return true
  })
}

/** 정렬(원본 불변): 지연 우선 → 계획종료 오름차순(null 뒤) → 이름(ko). */
export function sortCards(cards: ComputedItem[], _today: string): ComputedItem[] {
  return [...cards].sort((a, b) => {
    const ad = a.status === 'delayed' ? 0 : 1
    const bd = b.status === 'delayed' ? 0 : 1
    if (ad !== bd) return ad - bd
    if (a.plannedEnd !== b.plannedEnd) {
      if (!a.plannedEnd) return 1
      if (!b.plannedEnd) return -1
      return a.plannedEnd < b.plannedEnd ? -1 : 1
    }
    return a.name.localeCompare(b.name, 'ko')
  })
}
```

> `sortCards`의 `_today`는 시그니처 일관성용(현재 미사용). ESLint no-unused는 `_` 접두어로 통과. 미통과 시 인자를 제거하고 호출부도 맞춘다.

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/domain/kanban.test.ts` → PASS(전체).

- [ ] **Step 6: 타입·린트** — `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/kanban.ts tests/domain/kanban.test.ts
git commit -m "feat(kanban): 렌즈·빠른필터·정렬 순수 함수 추가"
```

---

## Task 5: i18n 사전 키 추가 (ko/en 패리티)

**Files:**
- Modify: `src/lib/i18n/dict/kanban.ts`

**Interfaces:**
- Produces: 아래 신규 키(컴포넌트가 `t('kanban.*')`로 소비). 기존 키는 모두 유지.

- [ ] **Step 1: ko 블록에 추가** — `kanbanKo`의 마지막 항목 뒤(닫는 `} as const` 앞)에 삽입

```ts
  // ── 재개편(실행 보드) ──
  'kanban.byProgress': '진행',
  'kanban.readOnlyHint': '이 뷰는 조회 전용입니다 — 진척 이동은 ‘진행’ 뷰에서 하세요.',
  // 렌즈·필터
  'kanban.lensMyTeam': '내 팀',
  'kanban.lensAll': '전체',
  'kanban.qfOverdue': '지연',
  'kanban.qfDueThisWeek': '이번 주 마감',
  'kanban.qfInProgress': '진행중',
  'kanban.qfNotStarted': '미착수',
  // 카드 액션·배지
  'kanban.start': '착수',
  'kanban.complete': '완료',
  'kanban.reopen': '재개',
  'kanban.decrease': '실적 10% 감소',
  'kanban.increase': '실적 10% 증가',
  'kanban.openInWbs': 'WBS에서 열기',
  'kanban.overduePrefix': '지연 ',
  'kanban.overdueSuffix': '일',
  'kanban.ddayPrefix': 'D-',
  'kanban.ddayToday': 'D-DAY',
  // 진척 입력 팝오버
  'kanban.progressTitle': '진척 입력',
  'kanban.progressDesc': '이 작업의 실적%를 선택하세요.',
  'kanban.progressCustom': '직접 입력(1~99)',
  'kanban.progressApply': '적용',
  // 되돌림 확인
  'kanban.resetTitle': '진척을 0%로 되돌릴까요?',
  'kanban.resetDesc': '현재 진척이 사라지고 ‘시작전’으로 이동합니다.',
  'kanban.resetConfirm': '0%로 되돌리기',
  'kanban.cancel': '취소',
  // 토스트
  'kanban.saveFailedTitle': '저장 실패',
  'kanban.conflict': '다른 사용자가 먼저 변경했어요. 새로고침 후 다시 시도하세요.',
  // 온보딩·빈 상태
  'kanban.coachTitle': '카드를 끌어 진척을 옮겨보세요',
  'kanban.coachDesc': '시작전·진행중·완료 사이로 드래그하거나, 카드의 +/− 로 실적을 조정할 수 있어요.',
  'kanban.coachDismiss': '알겠어요',
  'kanban.noMatchTitle': '필터에 맞는 작업이 없습니다',
  'kanban.noMatchDesc': '렌즈·필터·검색을 조정해 보세요.',
```

- [ ] **Step 2: en 블록에 동일 키 추가** — `kanbanEn`의 마지막 항목 뒤에 삽입

```ts
  'kanban.byProgress': 'Progress',
  'kanban.readOnlyHint': 'This view is read-only — move progress in the “Progress” view.',
  'kanban.lensMyTeam': 'My team',
  'kanban.lensAll': 'All',
  'kanban.qfOverdue': 'Overdue',
  'kanban.qfDueThisWeek': 'Due this week',
  'kanban.qfInProgress': 'In progress',
  'kanban.qfNotStarted': 'Not started',
  'kanban.start': 'Start',
  'kanban.complete': 'Complete',
  'kanban.reopen': 'Reopen',
  'kanban.decrease': 'Decrease actual by 10%',
  'kanban.increase': 'Increase actual by 10%',
  'kanban.openInWbs': 'Open in WBS',
  'kanban.overduePrefix': 'Overdue ',
  'kanban.overdueSuffix': 'd',
  'kanban.ddayPrefix': 'D-',
  'kanban.ddayToday': 'D-DAY',
  'kanban.progressTitle': 'Set progress',
  'kanban.progressDesc': 'Pick the actual % for this task.',
  'kanban.progressCustom': 'Custom (1–99)',
  'kanban.progressApply': 'Apply',
  'kanban.resetTitle': 'Reset progress to 0%?',
  'kanban.resetDesc': 'Current progress will be cleared and the task moves to “Not started”.',
  'kanban.resetConfirm': 'Reset to 0%',
  'kanban.cancel': 'Cancel',
  'kanban.saveFailedTitle': 'Save failed',
  'kanban.conflict': 'Someone changed this first. Refresh and try again.',
  'kanban.coachTitle': 'Drag a card to move its progress',
  'kanban.coachDesc': 'Drag between Not started · In progress · Done, or use +/− on a card to adjust the actual.',
  'kanban.coachDismiss': 'Got it',
  'kanban.noMatchTitle': 'No tasks match your filters',
  'kanban.noMatchDesc': 'Try adjusting the lens, filters, or search.',
```

- [ ] **Step 3: 패리티·타입 확인** (en은 `Record<keyof typeof kanbanKo, string>`라 누락 시 컴파일 에러)

Run: `npx tsc --noEmit`
Expected: no errors. (키 누락/오타가 있으면 여기서 잡힌다.)

- [ ] **Step 4: 린트** — `npm run lint` → clean.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/i18n/dict/kanban.ts
git commit -m "feat(kanban): 실행 보드 재개편 사전 키(ko/en) 추가"
```

---

## Task 6: 진척 입력 팝오버 컴포넌트 (`ProgressPopover`)

**Files:**
- Create: `src/components/kanban/ProgressPopover.tsx`
- Test: `tests/ui/kanban-card.test.tsx` (이 파일을 이 태스크에서 생성, Task 7에서 확장)

**Interfaces:**
- Produces: `ProgressPopover({ open, title, initial, onSubmit, onClose })` — `initial:number`, `onSubmit:(pct:number)=>void`. 프리셋 `10/30/50/70/90` 버튼 + 직접입력(1~99) + 적용. `Modal`(size='sm') 기반.

- [ ] **Step 1: 실패 테스트 작성** — `tests/ui/kanban-card.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => k }),
}))

import { ProgressPopover } from '@/components/kanban/ProgressPopover'

describe('ProgressPopover', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('프리셋 버튼을 누르면 해당 %로 onSubmit 된다', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(
      <ProgressPopover open title="t" initial={30} onSubmit={onSubmit} onClose={() => {}} />,
    ))
    const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '50%')!
    await act(async () => btn.click())
    expect(onSubmit).toHaveBeenCalledWith(50)
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/kanban-card.test.tsx` → FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/components/kanban/ProgressPopover.tsx`

```tsx
'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'

const PRESETS = [10, 30, 50, 70, 90]

/** 진척% 입력 — 프리셋 칩 + 직접입력(1~99). 진행중 진입/재개 시 사용. Modal(size sm) 기반. */
export function ProgressPopover({
  open, title, initial, onSubmit, onClose,
}: {
  open: boolean
  title: string
  initial: number
  onSubmit: (pct: number) => void
  onClose: () => void
}) {
  const { t } = useLocale()
  const [custom, setCustom] = useState('')
  const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)))
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="KANBAN"
      title={title}
      size="sm"
      footer={<button className="btn btn-ghost" onClick={onClose}>{t('kanban.cancel')}</button>}
    >
      <p className="mb-3 text-sm text-ink-muted">{t('kanban.progressDesc')}</p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(p => (
          <button
            key={p}
            className="badge bg-surface-2 text-ink hover:bg-brand-weak hover:text-brand"
            onClick={() => onSubmit(p)}
          >{p}%</button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          type="number" min={1} max={99} inputMode="numeric"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          placeholder={t('kanban.progressCustom')}
          aria-label={t('kanban.progressCustom')}
          className="app-input w-32"
        />
        <button
          className="btn btn-primary"
          disabled={custom.trim() === '' || Number.isNaN(Number(custom))}
          onClick={() => onSubmit(clamp(Number(custom)))}
        >{t('kanban.progressApply')}</button>
      </div>
    </Modal>
  )
}
```

> `initial`은 향후 입력 프리필용 계약(이번 UI는 프리셋/직접입력으로 값을 정하므로 `initial`은 표시하지 않아도 무방). ESLint no-unused-vars 경고가 나면 `initial`을 직접입력 기본값으로 사용: `useState(String(initial))`로 초기화하고 프리필. 그렇게 바꾸면 경고 해소 + UX 개선.

- [ ] **Step 4: `initial` 프리필 반영** — `const [custom, setCustom] = useState(String(initial))`로 변경(경고 해소 + 제안값 노출).

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/ui/kanban-card.test.tsx` → PASS.

- [ ] **Step 6: 타입·린트** — `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 7: 커밋**

```bash
git add src/components/kanban/ProgressPopover.tsx tests/ui/kanban-card.test.tsx
git commit -m "feat(kanban): 진척 입력 팝오버(ProgressPopover) 추가"
```

---

## Task 7: 카드 재작성 (`KanbanCard`)

**Files:**
- Modify(재작성): `src/components/kanban/KanbanCard.tsx`
- Test: `tests/ui/kanban-card.test.tsx` (확장)

**Interfaces:**
- Consumes: `ComputedItem`, `DueSignal`(kanban.ts), `ProgressBucket`.
- Produces: `KanbanCard` props:
  - `card: ComputedItem`, `bucket: ProgressBucket`, `pathLabel?: string`, `due?: DueSignal`
  - `draggable?: boolean`, `dragging?: boolean`, `editable?: boolean`, `saving?: boolean`
  - `onOpen?: () => void` (카드 본문 클릭/Enter → WBS 딥링크)
  - `onStart?: () => void` (시작전 → 착수 팝오버 트리거)
  - `onStep?: (delta: number) => void` (진행중 ±)
  - `onComplete?: () => void` (진행중 → 100)
  - `onReopen?: () => void` (완료 → 재개 팝오버 트리거)
  - `onDragStart?/onDragEnd?: (e: DragEvent<HTMLDivElement>) => void`

- [ ] **Step 1: 실패 테스트 추가** — `tests/ui/kanban-card.test.tsx`에 추가

```tsx
import { KanbanCard } from '@/components/kanban/KanbanCard'
import type { ComputedItem } from '@/lib/domain/types'

function leaf(over: Partial<ComputedItem> = {}): ComputedItem {
  return {
    id: 'L', parentId: null, level: 'activity', code: '1-1', sortOrder: 0, name: '리프작업',
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30',
    weight: null, actualPct: 40, owners: [{ team: 'PMO', kind: 'primary' }],
    plannedPct: 0, rolledActualPct: 40, achievement: null, status: 'in_progress', children: [], ...over,
  }
}

describe('KanbanCard — 상호작용', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('본문 클릭 시 onOpen(WBS 딥링크)이 불린다', async () => {
    const onOpen = vi.fn()
    await act(async () => root.render(
      <KanbanCard card={leaf()} bucket="in_progress" editable onOpen={onOpen} />,
    ))
    const body = container.querySelector('[data-card-body]') as HTMLElement
    await act(async () => body.click())
    expect(onOpen).toHaveBeenCalled()
  })

  it('진행중 편집 카드는 +/− 스텝퍼로 onStep(±10)이 불린다(본문 클릭 전파 안 됨)', async () => {
    const onStep = vi.fn(); const onOpen = vi.fn()
    await act(async () => root.render(
      <KanbanCard card={leaf()} bucket="in_progress" editable onStep={onStep} onOpen={onOpen} />,
    ))
    const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
    await act(async () => inc.click())
    expect(onStep).toHaveBeenCalledWith(10)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('지연 신호가 배지로 표시된다', async () => {
    await act(async () => root.render(
      <KanbanCard card={leaf({ status: 'delayed' })} bucket="in_progress" due={{ kind: 'overdue', days: 5 }} />,
    ))
    expect(container.textContent).toContain('kanban.overduePrefix')
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/kanban-card.test.tsx` → FAIL (신규 props 미지원).

- [ ] **Step 3: 카드 재작성** — `src/components/kanban/KanbanCard.tsx` 전체 교체

```tsx
'use client'

import type { DragEvent, KeyboardEvent } from 'react'
import { CalendarRange, GripVertical, Minus, Plus, Check, RotateCcw, Play, Loader2 } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import type { DueSignal, ProgressBucket } from '@/lib/domain/kanban'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, STATUS } from '@/components/wbs/shared'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 칸반 카드 — 실행 보드용. 본문 클릭=WBS 딥링크, 진행중은 +/− 스텝퍼, 시작전=착수, 완료=재개.
 *  드래그(진행 뷰·편집권한)로 버킷 이동. 파생 상태색 액센트 + 마감 배지 + 상위 단계 breadcrumb. */
export function KanbanCard({
  card, bucket, pathLabel, due,
  draggable = false, dragging = false, editable = false, saving = false,
  onOpen, onStart, onStep, onComplete, onReopen, onDragStart, onDragEnd,
}: {
  card: ComputedItem
  bucket: ProgressBucket
  pathLabel?: string
  due?: DueSignal
  draggable?: boolean
  dragging?: boolean
  editable?: boolean
  saving?: boolean
  onOpen?: () => void
  onStart?: () => void
  onStep?: (delta: number) => void
  onComplete?: () => void
  onReopen?: () => void
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
}) {
  const { t } = useLocale()
  const accent = STATUS[card.status].bar
  const pct = Math.round(card.rolledActualPct)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  const openKey = onOpen
    ? (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }
    : undefined

  const dueBadge = due && (
    <span className={`badge ${due.kind === 'overdue' ? 'bg-delayed-weak text-delayed' : 'bg-surface-2 text-ink-muted'}`}>
      {due.kind === 'overdue'
        ? `${t('kanban.overduePrefix')}${due.days}${t('kanban.overdueSuffix')}`
        : due.days === 0 ? t('kanban.ddayToday') : `${t('kanban.ddayPrefix')}${due.days}`}
    </span>
  )

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative shrink-0 overflow-hidden rounded-xl border border-line bg-surface p-3.5 shadow-sm transition
        ${draggable ? 'cursor-grab select-none hover:border-line-strong hover:shadow-md active:cursor-grabbing' : ''}
        ${dragging ? 'opacity-40' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden />
      {draggable && (
        <GripVertical className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-ink-subtle opacity-0 transition group-hover:opacity-100" aria-hidden />
      )}

      {/* 본문(클릭=WBS 딥링크) */}
      <div
        data-card-body
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? `${card.name} — ${t('kanban.card.actual')} ${pct}%. ${t('kanban.openInWbs')}` : undefined}
        onClick={onOpen}
        onKeyDown={openKey}
        className={`pl-1.5 ${onOpen ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring rounded' : ''}`}
      >
        {pathLabel && <p className="mb-1 truncate text-[10px] font-medium uppercase tracking-wide text-ink-subtle" title={pathLabel}>{pathLabel}</p>}
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={card.name}>{card.name}</p>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-subtle">
          <CalendarRange className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{card.plannedEnd ?? '—'}</span>
          {dueBadge}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={card.rolledActualPct} tone={accent} height="h-1.5" label={`${card.name} ${t('kanban.card.actual')}`} />
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">{pct}%</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <OwnerBadges owners={card.owners} />
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" aria-label={t('kanban.saving')} />}
        </div>
      </div>

      {/* 액션 행(편집 권한 · 진행 뷰). 본문 클릭과 분리 위해 stopPropagation. */}
      {editable && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5" onClick={stop}>
          {bucket === 'not_started' && onStart && (
            <button className="btn btn-ghost btn-sm gap-1" onClick={onStart}><Play className="h-3.5 w-3.5" />{t('kanban.start')}</button>
          )}
          {bucket === 'in_progress' && (
            <>
              {onStep && <button className="btn btn-ghost btn-sm" aria-label={t('kanban.decrease')} onClick={() => onStep(-10)}><Minus className="h-3.5 w-3.5" /></button>}
              {onStep && <button className="btn btn-ghost btn-sm" aria-label={t('kanban.increase')} onClick={() => onStep(10)}><Plus className="h-3.5 w-3.5" /></button>}
              {onComplete && <button className="btn btn-ghost btn-sm ml-auto gap-1 text-done" onClick={onComplete}><Check className="h-3.5 w-3.5" />{t('kanban.complete')}</button>}
            </>
          )}
          {bucket === 'done' && onReopen && (
            <button className="btn btn-ghost btn-sm gap-1" onClick={onReopen}><RotateCcw className="h-3.5 w-3.5" />{t('kanban.reopen')}</button>
          )}
        </div>
      )}
    </div>
  )
}
```

> **주의(디자인 클래스):** `btn-sm` 유틸이 없으면 `btn` + `text-[12px] px-2 py-1`로 대체. 실행자는 `src/app/globals.css`/토큰에서 `btn`·`badge`·`app-input` 존재를 확인하고, 없는 변형은 인접 컴포넌트(예: `IssuesView`/`WbsGanttSheet`)에서 쓰는 실제 클래스로 맞춘다. **globals.css는 수정하지 말 것**(범위 밖) — 기존 클래스 조합만 사용.
> `fmtDate` 대신 `plannedEnd` 원문(YYYY-MM-DD)만 노출(카드 간결화). 기간 전체가 필요하면 `fmtDate` 재도입 가능(shared.tsx에서 import).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui/kanban-card.test.tsx` → PASS(팝오버+카드 4케이스).

- [ ] **Step 5: 타입·린트** — `npx tsc --noEmit`; `npm run lint` → clean. (미사용 import 정리.)

- [ ] **Step 6: 커밋**

```bash
git add src/components/kanban/KanbanCard.tsx tests/ui/kanban-card.test.tsx
git commit -m "feat(kanban): 카드 재작성 — breadcrumb·마감배지·스텝퍼·착수/완료/재개·딥링크"
```

---

## Task 8: 보드 — 진행 모드 기본 + 뷰 배선

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`
- Test: `tests/ui/kanban-board.test.tsx` (생성)

**Interfaces:**
- Consumes: `groupByProgress`(Task 1), 기존 `groupByPhase/Owner`.
- Produces: 내부 `type Mode = 'progress' | 'phase' | 'owner'`; 기본 `progress`; 레거시 `?view=status`→`progress` 매핑.

- [ ] **Step 1: 실패 테스트 작성** — `tests/ui/kanban-board.test.tsx`

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const updateActual = vi.fn(async () => ({ ok: true }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: (...a: unknown[]) => updateActual(...(a as [])) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/app/TeamsProvider', () => ({ useTeamCodes: () => ['PMO', 'ERP'] }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { KanbanBoard } from '@/components/kanban/KanbanBoard'

function n(id: string, over: Partial<ComputedItem> = {}, children: ComputedItem[] = []): ComputedItem {
  return {
    id, parentId: null, level: children.length ? 'phase' : 'activity', code: id, sortOrder: 0, name: id,
    biz: null, deliverable: null, plannedStart: '2026-07-01', plannedEnd: '2026-07-30', weight: null,
    actualPct: children.length ? null : (over.rolledActualPct ?? 0), owners: over.owners ?? [{ team: 'PMO', kind: 'primary' }],
    plannedPct: 0, rolledActualPct: over.rolledActualPct ?? 0, achievement: null, status: over.status ?? 'in_progress', children,
  }
}
const ADMIN = { role: 'pmo_admin', teamCode: 'PMO', teamId: 't-pmo' }

function tree(): ComputedItem[] {
  return [n('Phase', {}, [
    n('L0', { rolledActualPct: 0, status: 'not_started' }),
    n('L50', { rolledActualPct: 50, status: 'in_progress' }),
    n('L100', { rolledActualPct: 100, status: 'done' }),
  ])]
}

describe('KanbanBoard — 진행 모드 기본', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { updateActual.mockClear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  it('기본 뷰에서 시작전/진행중/완료 3컬럼과 각 카드 수를 보여준다', async () => {
    await act(async () => root.render(
      <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
    ))
    const heads = [...container.querySelectorAll('h3')].map(h => h.textContent)
    expect(heads).toEqual(['status.not_started', 'status.in_progress', 'status.done'])
  })
})
```

> t()가 키를 그대로 반환하므로 컬럼 제목은 `COLUMN_TITLE_KEY` 매핑 결과 키(`status.not_started` 등)로 나온다.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/kanban-board.test.tsx` → FAIL (아직 status 모드/기본 phase).

- [ ] **Step 3: 보드 뷰 배선 수정** — `KanbanBoard.tsx`

3-1. import에 `groupByProgress` 추가, 아이콘 정리:
```ts
import { Layers, Users, Columns3, Search, Inbox } from 'lucide-react'
import { groupByPhase, groupByOwner, groupByProgress, type KanbanColumn } from '@/lib/domain/kanban'
```

3-2. `Mode` 타입·기본값·`?view` 매핑 교체:
```ts
type Mode = 'progress' | 'phase' | 'owner'
```
```ts
const [mode, setMode] = useState<Mode>(() => {
  const view = searchParams.get('view')
  if (view === 'phase' || view === 'owner' || view === 'progress') return view
  if (view === 'status') return 'progress' // 레거시 딥링크 호환
  return 'progress'
})
```

3-3. `editable` 및 `baseColumns` 교체:
```ts
const editable = !readOnly && mode === 'progress'
```
```ts
const baseColumns = useMemo<KanbanColumn[]>(() => {
  if (mode === 'owner') return groupByOwner(items, teamCodes)
  if (mode === 'phase') return groupByPhase(items)
  return groupByProgress(items)
}, [mode, items, teamCodes])
```

3-4. 모드 SegmentedTabs 교체:
```tsx
<SegmentedTabs<Mode>
  value={mode}
  onChange={setMode}
  tabs={[
    { key: 'progress', label: t('kanban.byProgress'), icon: Columns3 },
    { key: 'phase', label: t('kanban.byPhase'), icon: Layers },
    { key: 'owner', label: t('kanban.byOwner'), icon: Users },
  ]}
/>
```

3-5. 조회 전용 힌트(진행 뷰가 아닐 때) — 기존 "드래그 안내" 블록을 아래로 교체:
```tsx
{!editable && !readOnly && (
  <div className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-[12px] text-ink-subtle">
    {t('kanban.readOnlyHint')}
  </div>
)}
```

> 이 태스크에서는 드롭/드래그 로직(DROP_TARGET·dropValidFor·handleDrop·commitActual·keyboardToggle)은 **아직 그대로 둔다**. 단, `editable`가 `mode==='progress'`가 되면서 progress 컬럼 키('not_started'/'in_progress'/'done')와 기존 DROP_TARGET 키가 부분만 맞아 드롭이 어정쩡해진다 — Task 9에서 전면 교체하므로, 이 태스크 커밋 시점엔 "3컬럼 렌더 + 뷰 토글"만 검증한다.

3-6. `useBotPageContext`의 `view: mode`는 그대로 둔다(문자열 데이터, 봇 계약 무변경).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui/kanban-board.test.tsx` → PASS.

- [ ] **Step 5: 타입·린트** — `npx tsc --noEmit`(미사용 `groupByStatus` import가 남았으면 제거); `npm run lint` → clean.

- [ ] **Step 6: 커밋**

```bash
git add src/components/kanban/KanbanBoard.tsx tests/ui/kanban-board.test.tsx
git commit -m "feat(kanban): 진행(진척) 모드 기본화 + 뷰 토글 재편"
```

---

## Task 9: 보드 — 드롭 규칙(resolveDrop) + 확인창 + 진척 팝오버

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `resolveDrop`(Task 2), `ProgressBucket`(Task 1), `ProgressPopover`(Task 6), `bucketOf`.
- Produces: 드롭/카드액션이 `commit(card, pct)`(Task 10에서 낙관적화)로 수렴.

- [ ] **Step 1: DROP 로직 교체** — `KanbanBoard.tsx`

1-1. import 추가:
```ts
import { resolveDrop } from '@/lib/domain/kanban-drop'
import { bucketOf, groupByPhase, groupByOwner, groupByProgress, type KanbanColumn, type ProgressBucket } from '@/lib/domain/kanban'
import { ProgressPopover } from './ProgressPopover'
```

1-2. `DROP_TARGET`·`started`·`dropValidFor` 삭제. 상태 추가:
```ts
const [confirmCard, setConfirmCard] = useState<ComputedItem | null>(null)
const [promptState, setPromptState] = useState<{ card: ComputedItem; suggested: number } | null>(null)
```

1-3. `commitActual`를 잠정 `commit`으로 대체(낙관적화는 Task 10):
```ts
function commit(card: ComputedItem, pct: number) {
  if (Math.round(card.rolledActualPct) === pct) return
  startTransition(async () => {
    const res = await updateActual(card.id, pct)
    if (!res.ok) { setErrorMsg(res.error ?? t('kanban.errChange')); return }
    router.refresh()
  })
}
```

1-4. `handleDrop` 교체(컬럼 키 = ProgressBucket):
```ts
function handleDrop(e: DragEvent<HTMLDivElement>, columnKey: string) {
  e.preventDefault()
  setDragOverKey(null)
  const id = e.dataTransfer.getData('text/plain')
  setDraggingId(null)
  const card = id ? cardById.get(id) : undefined
  if (!card || !cardEditable(card)) return
  const r = resolveDrop(card, columnKey as ProgressBucket)
  if (r.kind === 'noop') return
  if (r.kind === 'set') commit(card, r.pct)
  else if (r.kind === 'confirm-reset') setConfirmCard(card)
  else if (r.kind === 'prompt') setPromptState({ card, suggested: r.suggested })
}
```

1-5. `keyboardToggle` 삭제(카드가 onOpen/스텝퍼로 조작). 카드 액션 핸들러 추가:
```ts
const stepCard = (card: ComputedItem, delta: number) =>
  commit(card, Math.max(0, Math.min(100, Math.round(card.rolledActualPct) + delta)))
const startCard = (card: ComputedItem) => setPromptState({ card, suggested: 30 })
const reopenCard = (card: ComputedItem) => setPromptState({ card, suggested: 90 })
const openInWbs = (card: ComputedItem) => router.push(`/p/${projectId}/wbs?focus=${card.id}`)
```

1-6. 드롭존/하이라이트: `isDropZone`·`accepts` 교체:
```ts
const isDropZone = editable // 세 컬럼 모두 드롭 대상
const accepts = isDropZone && (!draggingCard || resolveDrop(draggingCard, col.key as ProgressBucket).kind !== 'noop')
```

1-7. 카드 렌더 교체(`col.cards.map` 내부):
```tsx
col.cards.map(card => {
  const canDrag = cardEditable(card)
  const b = bucketOf(card.rolledActualPct)
  return (
    <KanbanCard
      key={card.id}
      card={card}
      bucket={b}
      pathLabel={pathById.get(card.id)?.[0]}
      due={dueSignal(card.plannedEnd, card.rolledActualPct, today)}
      draggable={canDrag}
      editable={canDrag}
      dragging={draggingId === card.id}
      onOpen={() => openInWbs(card)}
      onStart={canDrag ? () => startCard(card) : undefined}
      onStep={canDrag ? d => stepCard(card, d) : undefined}
      onComplete={canDrag ? () => commit(card, 100) : undefined}
      onReopen={canDrag ? () => reopenCard(card) : undefined}
      onDragStart={canDrag ? e => {
        e.dataTransfer.setData('text/plain', card.id)
        e.dataTransfer.effectAllowed = 'move'
        setDraggingId(card.id)
      } : undefined}
      onDragEnd={() => setDraggingId(null)}
    />
  )
})
```

1-8. `pathById`·`dueSignal` 배선: 상단에 추가
```ts
import { /* ... */ dueSignal, leafPaths } from '@/lib/domain/kanban'
const pathById = useMemo(() => leafPaths(items), [items])
```

1-9. 확인창·팝오버 렌더(파일 하단 `</div>` 직전, 기존 error `Modal` 아래):
```tsx
<Modal
  open={confirmCard !== null}
  onClose={() => setConfirmCard(null)}
  eyebrow="KANBAN"
  title={t('kanban.resetTitle')}
  size="sm"
  footer={
    <div className="flex justify-end gap-2">
      <button className="btn btn-ghost" onClick={() => setConfirmCard(null)}>{t('kanban.cancel')}</button>
      <button className="btn btn-primary" onClick={() => { if (confirmCard) commit(confirmCard, 0); setConfirmCard(null) }}>{t('kanban.resetConfirm')}</button>
    </div>
  }
>
  <p className="text-sm leading-6 text-ink-muted">{t('kanban.resetDesc')}</p>
</Modal>

{promptState && (
  <ProgressPopover
    open
    title={t('kanban.progressTitle')}
    initial={promptState.suggested}
    onClose={() => setPromptState(null)}
    onSubmit={pct => { commit(promptState.card, pct); setPromptState(null) }}
  />
)}
```

- [ ] **Step 2: 타입·린트** — `npx tsc --noEmit`(미사용 `MoveHorizontal`·`liveMsg`·`pending` 등 정리; `pending`은 저장 인디케이터로 남겨도 됨); `npm run lint` → clean.

- [ ] **Step 3: 기존 보드 테스트 유지 확인** — Run: `npx vitest run tests/ui/kanban-board.test.tsx` → PASS(3컬럼 렌더 유지).

- [ ] **Step 4: 착수/완료 액션 스모크 테스트 추가** — `tests/ui/kanban-board.test.tsx`

```tsx
it("진행중 카드의 '완료' 액션은 updateActual(id, 100)을 부른다", async () => {
  await act(async () => root.render(
    <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
  ))
  const complete = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.complete'))!
  await act(async () => complete.click())
  expect(updateActual).toHaveBeenCalledWith('L50', 100)
})
```

Run: `npx vitest run tests/ui/kanban-board.test.tsx` → PASS.

> `commit`이 `startTransition` 안에서 `updateActual`을 부르므로 `act` 안에서 호출이 관찰된다. `expectedCurrent` 인자는 Task 10에서 붙는다 — 그때 이 기대를 `('L50', 100, 50)`로 갱신한다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/kanban/KanbanBoard.tsx tests/ui/kanban-board.test.tsx
git commit -m "feat(kanban): 드롭 규칙(resolveDrop)·되돌림 확인·진척 팝오버 배선"
```

---

## Task 10: 보드 — 낙관적 업데이트 + CAS + 토스트

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `useToast`(`@/components/ui/Toast`), `statusOf`(`@/lib/domain/progress`).
- Produces: `commit`이 낙관적 override + `updateActual(id, pct, expectedCurrent)` + 실패 롤백·토스트.

- [ ] **Step 1: import·상태 추가** — `KanbanBoard.tsx`

```ts
import { useEffect } from 'react'
import { useToast } from '@/components/ui/Toast'
import { statusOf } from '@/lib/domain/progress'
```
```ts
const { toast } = useToast()
const [override, setOverride] = useState<Record<string, number>>({})
const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
// 서버 데이터가 새로 오면 낙관적 레이어를 비운다(재조정).
useEffect(() => { setOverride({}); setSavingIds(new Set()) }, [items])
```

- [ ] **Step 2: 오버라이드 적용** — `baseColumns` 계산 전에 items에 override를 입힌 트리를 만든다

```ts
const viewItems = useMemo<ComputedItem[]>(() => {
  const ids = Object.keys(override)
  if (ids.length === 0) return items
  const map = (ns: ComputedItem[]): ComputedItem[] => ns.map(n => {
    if (!n.children.length && override[n.id] !== undefined) {
      const pct = override[n.id]
      return { ...n, actualPct: pct, rolledActualPct: pct, status: statusOf(pct, n.plannedPct, n.plannedStart, today) }
    }
    if (n.children.length) return { ...n, children: map(n.children) }
    return n
  })
  return map(items)
}, [items, override, today])
```
그리고 `baseColumns`·`cardById`·`pathById`의 `items`를 **`viewItems`**로 교체(단 `pathById`는 이름 경로라 `items` 그대로 두어도 무방 — 그러나 일관성 위해 `viewItems` 사용 가능). `dueSignal`·`bucketOf`는 카드의 override된 `rolledActualPct`를 자동 반영.

> `statusOf` 시그니처 확인: `statusOf(actual, planned, start, today)` (progress.ts). 인자 순서를 실제 정의에 맞춰라(테스트 progress.test.ts 참고). 다르면 맞춘다.

- [ ] **Step 3: `commit` 낙관적화** — Task 9의 `commit`을 교체

```ts
async function commit(card: ComputedItem, pct: number) {
  const prev = Math.round(card.rolledActualPct)
  if (prev === pct) return
  setOverride(o => ({ ...o, [card.id]: pct }))            // 낙관적 이동
  setSavingIds(s => new Set(s).add(card.id))
  try {
    const res = await updateActual(card.id, pct, prev)   // CAS: expectedCurrent = 현재값
    if (!res.ok) {
      setOverride(o => { const n = { ...o }; delete n[card.id]; return n }) // 롤백
      toast({
        title: t('kanban.saveFailedTitle'),
        description: res.conflict ? t('kanban.conflict') : (res.error ?? t('kanban.errChange')),
        variant: 'error',
      })
      if (res.conflict) router.refresh()
      return
    }
    router.refresh() // 성공 확정 — 새 items 도착 시 useEffect가 override 비움
  } catch {
    setOverride(o => { const n = { ...o }; delete n[card.id]; return n })
    toast({ title: t('kanban.saveFailedTitle'), variant: 'error' })
  } finally {
    setSavingIds(s => { const n = new Set(s); n.delete(card.id); return n })
  }
}
```
`startTransition`/`useTransition`·`pending`·`errorMsg` 상태 및 하단 error `Modal`은 제거(토스트로 대체). `liveMsg`/`aria-live` div는 유지하고 성공 시 갱신하려면 남겨도 됨(선택). `saving` prop은 `savingIds.has(card.id)`로 카드에 전달.

- [ ] **Step 4: 카드에 saving 전달** — 렌더에 `saving={savingIds.has(card.id)}` 추가.

- [ ] **Step 5: Task 9 스모크 테스트 기대 갱신** — `updateActual` 호출 기대를 `('L50', 100, 50)`으로 수정.

- [ ] **Step 6: 낙관적 롤백 테스트 추가** — `tests/ui/kanban-board.test.tsx`

```tsx
it('저장 실패 시 낙관적 이동을 롤백하고 토스트를 부른다', async () => {
  const toastFn = vi.fn()
  // 이 테스트만 toast/실패를 재설정: 모듈 모킹 상단에서 useToast가 toastFn을 반환하도록 하려면
  // 파일 상단 vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: toastFn }) })) 로 toastFn을 hoist된 변수로 잡는다.
  updateActual.mockResolvedValueOnce({ ok: false, error: 'x' })
  await act(async () => root.render(
    <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
  ))
  const inc = [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'kanban.increase')!
  await act(async () => inc.click())
  // 실패 후 카드 %는 원복(50%)이어야 한다
  expect(container.textContent).toContain('50%')
})
```

> hoisted 변수: 파일 상단에 `const toastFn = vi.fn()` 선언 후 `vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: toastFn }) }))`. `vi.mock`은 hoist되므로 변수는 `vi.hoisted`로 감싼다: `const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }))`. 이 관례로 정리하라.

- [ ] **Step 7: 검증** — `npx vitest run tests/ui/kanban-board.test.tsx` → PASS; `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 8: 커밋**

```bash
git add src/components/kanban/KanbanBoard.tsx tests/ui/kanban-board.test.tsx
git commit -m "feat(kanban): 낙관적 업데이트 + CAS 충돌감지 + 토스트"
```

---

## Task 11: 보드 — 렌즈·빠른필터·정렬·검색

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Interfaces:**
- Consumes: `lensCards`·`applyQuickFilters`·`sortCards`·`QuickFilters`(Task 4).

- [ ] **Step 1: import·상태** — `KanbanBoard.tsx`

```ts
import { /* ... */ lensCards, applyQuickFilters, sortCards, type QuickFilters } from '@/lib/domain/kanban'
```
```ts
const [lens, setLens] = useState<'myTeam' | 'all'>(() =>
  membership?.role === 'pmo_admin' || !membership?.teamCode ? 'all' : 'myTeam')
const [quick, setQuick] = useState<QuickFilters>({ overdue: false, dueThisWeek: false, inProgress: false, notStarted: false })
const toggleQuick = (k: keyof QuickFilters) => setQuick(q => ({ ...q, [k]: !q[k] }))
```

- [ ] **Step 2: `columns` 파이프라인 교체** — 기존 statusFilter/query 필터 블록을 렌즈→빠른필터→검색→정렬로 교체

```ts
const columns = useMemo<KanbanColumn[]>(() => {
  const q = query.trim().toLowerCase()
  const myTeam = membership?.teamCode ?? null
  return baseColumns.map(col => {
    let cards = lensCards(col.cards, lens, myTeam)
    cards = applyQuickFilters(cards, quick, today)
    if (q) cards = cards.filter(c => `${c.name} ${c.code} ${c.owners.map(o => o.team).join(' ')}`.toLowerCase().includes(q))
    cards = sortCards(cards, today)
    return { ...col, cards, count: cards.length }
  })
}, [baseColumns, lens, quick, query, membership, today])
```
기존 `statusFilter` 상태·SegmentedTabs(all/in_progress/done)는 제거.

- [ ] **Step 3: 툴바 UI 교체** — 우측 컨트롤을 렌즈 토글 + 빠른필터 칩 + 검색으로

```tsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
  <SegmentedTabs<'myTeam' | 'all'>
    size="sm"
    value={lens}
    onChange={setLens}
    tabs={[{ key: 'myTeam', label: t('kanban.lensMyTeam') }, { key: 'all', label: t('kanban.lensAll') }]}
  />
  <div className="flex flex-wrap gap-1.5">
    {([
      ['overdue', 'kanban.qfOverdue'],
      ['dueThisWeek', 'kanban.qfDueThisWeek'],
      ['inProgress', 'kanban.qfInProgress'],
      ['notStarted', 'kanban.qfNotStarted'],
    ] as [keyof QuickFilters, string][]).map(([k, label]) => (
      <button
        key={k}
        aria-pressed={quick[k]}
        onClick={() => toggleQuick(k)}
        className={`badge transition ${quick[k] ? 'bg-brand text-white' : 'bg-surface-2 text-ink-muted hover:text-ink'}`}
      >{t(label)}</button>
    ))}
  </div>
  <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
    <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('kanban.searchPlaceholder')} aria-label={t('kanban.searchPlaceholder')} className="app-input pl-9 sm:w-56" />
  </div>
</div>
```

- [ ] **Step 4: 봇 컨텍스트 필터 동기화** — `useBotPageContext`의 `filters`를 활성 빠른필터로

```ts
useBotPageContext({
  domain: 'kanban',
  projectId,
  view: mode,
  search: query || null,
  filters: {
    ...(lens === 'myTeam' ? { lens: 'myTeam' } : {}),
    ...(Object.entries(quick).filter(([, v]) => v).reduce((a, [k]) => ({ ...a, [k]: true }), {})),
  },
})
```
> 봇 계약(BotPageContextRegistration)은 `filters`를 자유 객체로 받는다(범위 밖 파일 무변경). 값만 채운다.

- [ ] **Step 5: 렌즈 필터 테스트 추가** — `tests/ui/kanban-board.test.tsx`

```tsx
it('내 팀 렌즈는 내 팀 담당 카드만 남긴다(team_editor)', async () => {
  const items = [n('P', {}, [
    n('mine', { rolledActualPct: 50, owners: [{ team: 'ERP', kind: 'primary' }] }),
    n('other', { rolledActualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }] }),
  ])]
  const EDITOR = { role: 'team_editor', teamCode: 'ERP', teamId: 't-erp' }
  await act(async () => root.render(
    <KanbanBoard projectId="p1" items={items} membership={EDITOR} today="2026-07-25" />,
  ))
  // 기본 렌즈=myTeam(ERP) → 'mine'만, 'other' 없음
  expect(container.textContent).toContain('mine')
  expect(container.textContent).not.toContain('other')
})
```

- [ ] **Step 6: 검증** — `npx vitest run tests/ui/kanban-board.test.tsx` → PASS; `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 7: 커밋**

```bash
git add src/components/kanban/KanbanBoard.tsx tests/ui/kanban-board.test.tsx
git commit -m "feat(kanban): 내 팀 렌즈·빠른필터·지연우선 정렬·검색 재편"
```

---

## Task 12: 보드 — 온보딩(코치마크)·빈 상태 구분·마감 재검토

**Files:**
- Modify: `src/components/kanban/KanbanBoard.tsx`

**Interfaces:**
- Produces: 최초 방문 코치마크(localStorage), 필터 0건 안내(데이터 0건과 구분).

- [ ] **Step 1: 코치마크 상태** — `KanbanBoard.tsx`

```ts
const COACH_KEY = 'kanban.coach.v1'
const [showCoach, setShowCoach] = useState(false)
useEffect(() => {
  if (editable && typeof window !== 'undefined' && !window.localStorage.getItem(COACH_KEY)) setShowCoach(true)
}, [editable])
const dismissCoach = () => { setShowCoach(false); try { window.localStorage.setItem(COACH_KEY, '1') } catch {} }
```

- [ ] **Step 2: 코치마크 렌더** — 조회전용 힌트 자리(진행 뷰) 아래에

```tsx
{showCoach && editable && (
  <div className="flex shrink-0 items-start justify-between gap-3 rounded-xl border border-brand-ring bg-brand-weak px-3.5 py-2.5">
    <div>
      <p className="text-[13px] font-semibold text-brand">{t('kanban.coachTitle')}</p>
      <p className="mt-0.5 text-[12px] text-ink-muted">{t('kanban.coachDesc')}</p>
    </div>
    <button className="btn btn-ghost btn-sm shrink-0" onClick={dismissCoach}>{t('kanban.coachDismiss')}</button>
  </div>
)}
```

- [ ] **Step 3: 필터 0건 구분** — 보드 그리드 위(또는 컬럼이 모두 0건일 때) 안내. `columns` 카드 총합 계산 후:

```ts
const filteredEmpty = items.length > 0 && columns.every(c => c.cards.length === 0)
```
그리드 렌더 직전:
```tsx
{filteredEmpty && (
  <div className="shrink-0 rounded-xl border border-dashed border-line px-4 py-3 text-center text-[12px] text-ink-subtle">
    <span className="font-medium text-ink-muted">{t('kanban.noMatchTitle')}</span> · {t('kanban.noMatchDesc')}
  </div>
)}
```
> 데이터 자체가 0건일 때(`items.length === 0`)는 기존 `EmptyState`(변경 없음)가 먼저 반환되므로 충돌 없음.

- [ ] **Step 4: 코치마크 테스트** — `tests/ui/kanban-board.test.tsx`

```tsx
it('최초 방문(로컬 플래그 없음·편집 가능)엔 코치마크가 뜨고, 닫으면 플래그가 저장된다', async () => {
  window.localStorage.removeItem('kanban.coach.v1')
  await act(async () => root.render(
    <KanbanBoard projectId="p1" items={tree()} membership={ADMIN} today="2026-07-25" />,
  ))
  expect(container.textContent).toContain('kanban.coachTitle')
  const dismiss = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('kanban.coachDismiss'))!
  await act(async () => dismiss.click())
  expect(window.localStorage.getItem('kanban.coach.v1')).toBe('1')
  expect(container.textContent).not.toContain('kanban.coachTitle')
})
```
> jsdom에 `localStorage`가 있다. 없으면 테스트 상단에서 간단 폴리필. `afterEach`에 `window.localStorage.clear()` 추가로 격리.

- [ ] **Step 5: 검증** — `npx vitest run tests/ui/kanban-board.test.tsx` → PASS(전체); `npx tsc --noEmit`; `npm run lint` → clean.

- [ ] **Step 6: 전체 회귀** — Run: `npx vitest run tests/domain/kanban.test.ts tests/domain/kanbanDrop.test.ts tests/ui/kanban-card.test.tsx tests/ui/kanban-board.test.tsx tests/ai/tools-kanban.test.ts tests/ai/deep-links.test.ts`
Expected: PASS 전부(특히 봇 도구/딥링크가 깨지지 않았는지).

- [ ] **Step 7: 빌드 스모크** — Run: `npm run build`
Expected: 성공(칸반 라우트 타입/린트 게이트 통과). [[wbs-web-verify-env]] — 브라우저 대신 build로 검증.

- [ ] **Step 8: 커밋**

```bash
git add src/components/kanban/KanbanBoard.tsx tests/ui/kanban-board.test.tsx
git commit -m "feat(kanban): 최초방문 코치마크·필터 빈상태 구분"
```

---

## 수동 스모크 체크리스트 (배포 전, 드래그는 jsdom 미검증분)

- [ ] 진행 뷰 기본 진입 → 시작전/진행중/완료 3컬럼.
- [ ] 카드 드래그: 완료로 → 100%, 시작전으로(진척>0) → 확인창 → 0%, 진행중으로(0%에서) → 팝오버 → 선택% 반영.
- [ ] 진행중 카드 +/− 즉시 반영(낙관적) → 새로고침 후 유지.
- [ ] 다른 창에서 같은 카드 변경 후 드롭 → 충돌 토스트 + 롤백.
- [ ] 렌즈 "내 팀"/"전체", 빠른필터 4종, 검색, 지연 우선 정렬.
- [ ] 단계/담당 뷰 = 조회 전용 힌트 노출·드래그 불가.
- [ ] 카드 클릭 → `/p/{id}/wbs?focus={id}` 이동·해당 행 하이라이트.
- [ ] 권한 없는 카드(타 팀·비말단)는 드래그/액션 없음.
- [ ] 라이트/다크 모두 정상.

---

## Self-Review

**Spec coverage(스펙 §↔태스크):** §4 컬럼/드롭 = T1·T2·T9 · §5 카드 = T3·T7 · §6 렌즈/필터/정렬 = T4·T11 · §7 낙관적/CAS/토스트 = T10 · §8 온보딩/빈상태 = T12 · §3 범위/쓰기 = Global Constraints + 전 태스크 파일 잠금 · §9 데이터흐름 = page 무변경 확인 · i18n = T5. 누락 없음.

**Placeholder scan:** "적절히"·"등등"·"TODO" 없음. 모든 코드 스텝에 실제 코드 포함. 클래스 유틸(`btn-sm` 등)·`statusOf` 인자 순서는 실제 확인 지시를 명시(globals.css 무변경 원칙).

**Type consistency:** `ProgressBucket`(T1) → resolveDrop(T2)·card `bucket`(T7)·board(T9) 일치. `DueSignal`(T3) → card `due`(T7) 일치. `QuickFilters`(T4) → board(T11) 일치. `commit(card, pct)`는 T9 도입 → T10에서 낙관적화(같은 이름). `updateActual` 기대는 T9에서 `(id,100)` → T10에서 `(id,100,50)`으로 갱신 지시.
