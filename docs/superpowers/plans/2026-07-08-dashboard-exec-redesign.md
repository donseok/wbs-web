# 대시보드 경영진/PMO 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 대시보드 상단에 경영진/PMO용 "3초 판독" 요약(종합 판정 + 진척 게이지 + 신호등 3타일 + 공지 + 리포트)을 복원하고, 기존 13블록을 접이식 아코디언으로 재배치한다.

**Architecture:** 새 순수 도메인 모듈 `src/lib/domain/dashboard.ts`가 신호등/예상종료/마일스톤/종합판정을 계산(순수·단위테스트). `DashboardView`는 async Server Component 유지하며 상단에 서버 렌더 `ExecSummary`를 얹고, 상세 블록은 서버에서 렌더해 thin `'use client'` `DetailAccordion` 셸에 props로 전달(RSC 경계 보존). 아코디언 펼침 상태는 기존 `UiPrefs`(JSONB, 마이그레이션 없음)에 저장.

**Tech Stack:** Next.js 15 App Router(RSC), React 19, TypeScript, Tailwind v4(토큰 기반), Vitest, Supabase(읽기 전용 재사용).

**설계 스펙:** `docs/superpowers/specs/2026-07-08-dashboard-exec-redesign-design.md` (v2, 검증 반영).

---

## 파일 구조 (생성/수정 대상)

**생성:**
- `src/lib/domain/dashboard.ts` — 순수 계산: `Signal` 타입, `progressSignal`/`scheduleModel`/`detectMilestones`/`riskModel`/`overallSignal`, 진입점 `buildExecSummary`.
- `tests/domain/dashboard.test.ts` — 위 순수 함수 단위 테스트.
- `src/components/dashboard/ProgressGauge.tsx` — SVG 도넛(실적 채움 + 계획 눈금 + 중앙 종합 판정).
- `src/components/dashboard/SignalTile.tsx` — 신호등 KPI 타일(색+아이콘+라벨, neutral 지원).
- `src/components/dashboard/ExecSummary.tsx` — 서버 컴포넌트: 게이지 + 3타일 + 공지 슬림바 + ReportButton.
- `src/components/dashboard/DetailAccordion.tsx` — thin `'use client'` 접이식 셸.

**수정:**
- `src/components/dashboard/DashboardView.tsx` — 상단 ExecSummary + 블록 재배치 + 아코디언(Server Component 유지).
- `src/app/(app)/p/[projectId]/dashboard/page.tsx` — 죽은 prop 정리, `getUiPrefs`로 initialExpanded, ReportButton을 ExecSummary로 이관.
- `src/app/(app)/p/[projectId]/dashboard/loading.tsx` — 새 레이아웃 스켈레톤.
- `src/lib/domain/types.ts` — `UiPrefs.dashSections?: string[]` 추가.
- `src/lib/i18n/dict/dashboard.ts` — 신규 키 추가/미사용 키 삭제(ko+en 패리티).
- `src/components/dashboard/shared.ts`(신규 소형) 또는 기존 위치 — `dueSoonLeaves` 공용 헬퍼 추출.

## 태스크 개요
1. `dashboard.ts` — 캘린더 헬퍼 + `Signal` + `progressSignal` (TDD)
2. `scheduleModel` — SPI 예상종료 + clamp + 가드 + 신호 (TDD)
3. `detectMilestones` + 마일스톤 신호 (TDD)
4. `riskModel` — 지연/마감임박/topWeightDelayed + 신호 (TDD)
5. `overallSignal` + `buildExecSummary` 조립 (TDD)
6. `dueSoonLeaves` 공용 헬퍼 추출 (TDD)
7. i18n 키 추가/삭제
8. `SignalTile` 컴포넌트
9. `ProgressGauge` 컴포넌트
10. `ExecSummary` 컴포넌트(+ ReportButton surface 변형)
11. `DetailAccordion` client 셸 + `UiPrefs.dashSections`
12. `DashboardView` 재구성
13. `page.tsx` 정리 + initialExpanded 배선
14. `loading.tsx` 스켈레톤 교체
15. 최종 검증(test/lint/build + 실제 앱 확인)

---

### Task 1: `dashboard.ts` — 캘린더 헬퍼 · Signal · progressSignal

**Files:**
- Create: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/domain/dashboard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { progressSignal } from '@/lib/domain/dashboard'

describe('progressSignal (편차 %p)', () => {
  it('편차 ≥ -2 → green', () => {
    expect(progressSignal(0)).toBe('green')
    expect(progressSignal(-2)).toBe('green')   // 경계: green 소유
  })
  it('-10 ≤ 편차 < -2 → amber', () => {
    expect(progressSignal(-3)).toBe('amber')
    expect(progressSignal(-10)).toBe('amber')  // 경계: amber 소유
  })
  it('편차 < -10 → red', () => {
    expect(progressSignal(-11)).toBe('red')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `progressSignal` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/domain/dashboard.ts`:
```ts
import type { ComputedItem } from './types'
import { collectLeaves } from '@/components/wbs/shared'

export type Signal = 'green' | 'amber' | 'red' | 'neutral'

/* ── 캘린더 일수(UTC, DST 무관) — DashboardView 로컬 헬퍼와 동일 관례 ── */
const DAY = 86_400_000
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`)
export const diffDaysCal = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY)
export const addDaysCal = (s: string, n: number) =>
  new Date(ms(s) + n * DAY).toISOString().slice(0, 10)

/** 진척 신호 — 편차(실적−계획, %p) 기준. 경계는 green/amber가 소유. */
export function progressSignal(variance: number): Signal {
  if (variance >= -2) return 'green'
  if (variance >= -10) return 'amber'
  return 'red'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): dashboard.ts scaffold + progressSignal (TDD)"
```

---

### Task 2: `scheduleModel` — SPI 예상종료 + clamp + 가드 + 신호

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { scheduleModel } from '@/lib/domain/dashboard'

const sched = (over: Partial<Parameters<typeof scheduleModel>[0]> = {}) =>
  scheduleModel({ startDate: '2026-01-01', endDate: '2026-04-10', today: '2026-02-20', overallActual: 49, overallPlanned: 50, ...over })
// start~end 캘린더 totalDays = 100

describe('scheduleModel', () => {
  it('날짜 없으면 neutral/none', () => {
    const r = scheduleModel({ startDate: null, endDate: null, today: '2026-02-20', overallActual: 10, overallPlanned: 10 })
    expect(r.signal).toBe('neutral'); expect(r.label).toBe('none'); expect(r.projectedEnd).toBeNull()
  })
  it('완료(actual≥100) → green/done, slip·projectedEnd 숨김', () => {
    const r = sched({ overallActual: 100, overallPlanned: 100, today: '2026-05-01' })
    expect(r.signal).toBe('green'); expect(r.label).toBe('done'); expect(r.slipDays).toBeNull(); expect(r.projectedEnd).toBeNull()
  })
  it('계획<5% → neutral/early', () => {
    expect(sched({ overallPlanned: 3, overallActual: 1 }).label).toBe('early')
    expect(sched({ overallPlanned: 3, overallActual: 1 }).signal).toBe('neutral')
  })
  it('경과<15% 바닥 → neutral/early', () => {
    const r = sched({ today: '2026-01-05' }) // elapsed 5 < max(14, 15)
    expect(r.label).toBe('early'); expect(r.signal).toBe('neutral')
  })
  it('정상(slip≤3) → green', () => {
    expect(sched({ overallActual: 49, overallPlanned: 50 }).signal).toBe('green') // SPI .98 → slip 2
  })
  it('주의(3<slip≤14) → amber', () => {
    expect(sched({ overallActual: 45, overallPlanned: 50 }).signal).toBe('amber') // slip 11
  })
  it('위험(slip>14) → red', () => {
    expect(sched({ overallActual: 40, overallPlanned: 50 }).signal).toBe('red') // slip 25
  })
  it('종료일 경과+미완료 → red (slip이 amber라도)', () => {
    const r = sched({ today: '2026-05-01', overallActual: 90, overallPlanned: 100 })
    expect(r.signal).toBe('red')
  })
  it('clamp — actual 극소면 projectedDuration 상한(3×), slip=2×total', () => {
    const r = sched({ overallActual: 2, overallPlanned: 40 }) // SPI .05 → raw 2000
    expect(r.slipDays).toBe(200) // 300 - 100
    expect(r.signal).toBe('red')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `scheduleModel` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `dashboard.ts`)

```ts
export interface ScheduleModel {
  totalDays: number; elapsed: number; remaining: number; elapsedPct: number
  projectedEnd: string | null; slipDays: number | null
  signal: Signal; label: 'onTrack' | 'early' | 'done' | 'none'
}

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function scheduleModel(input: {
  startDate: string | null; endDate: string | null; today: string
  overallActual: number; overallPlanned: number
}): ScheduleModel {
  const { startDate: s, endDate: e, today, overallActual, overallPlanned } = input
  if (!s || !e) {
    return { totalDays: 0, elapsed: 0, remaining: 0, elapsedPct: 0, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'none' }
  }
  const totalDays = Math.max(1, diffDaysCal(s, e) + 1)
  const elapsed = clampN(diffDaysCal(s, today) + 1, 0, totalDays)
  const remaining = totalDays - elapsed
  const elapsedPct = Math.round((elapsed / totalDays) * 100)
  const base = { totalDays, elapsed, remaining, elapsedPct }

  // 완료 예외 — 종료일 경과여도 done이면 정상
  if (overallActual >= 100) return { ...base, projectedEnd: null, slipDays: null, signal: 'green', label: 'done' }
  // 조기 가드 — SPI 불안정 구간은 정직하게 회색(초록 아님)
  const earlyFloor = Math.max(14, Math.round(totalDays * 0.15))
  if (overallPlanned < 5 || elapsed < earlyFloor) {
    return { ...base, projectedEnd: null, slipDays: null, signal: 'neutral', label: 'early' }
  }
  const spi = overallActual / overallPlanned            // planned ≥ 5 → 안전
  const projectedDuration = Math.min(totalDays / spi, totalDays * 3) // clamp: 최대 3×
  const slipDays = Math.round(projectedDuration - totalDays)
  const projectedEnd = addDaysCal(s, Math.round(projectedDuration) - 1)
  const overdueUnfinished = today > e                   // done 가드 통과 = 미완료
  const signal: Signal = slipDays > 14 || overdueUnfinished ? 'red' : slipDays > 3 ? 'amber' : 'green'
  return { ...base, projectedEnd, slipDays, signal, label: 'onTrack' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS (all scheduleModel + progressSignal tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): scheduleModel — SPI 예상종료 + 가드/clamp/신호 (TDD)"
```

---

### Task 3: `detectMilestones` — 자동감지 + 신호

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { detectMilestones } from '@/lib/domain/dashboard'
import type { ComputedItem } from '@/lib/domain/types'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], ...over,
})

describe('detectMilestones', () => {
  const today = '2026-07-08'
  it('키워드 매칭 + 임박(D-14 이내) → amber', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-17', sortOrder: 1 })], today)
    expect(r.name).toBe('중간보고'); expect(r.signal).toBe('amber'); expect(r.dday).toBe(9)
  })
  it('여유(D-15+) → green', () => {
    const r = detectMilestones([leaf({ name: '착수보고회', plannedEnd: '2026-08-01' })], today)
    expect(r.signal).toBe('green')
  })
  it('단일일 + 산출물 → 감지', () => {
    const r = detectMilestones([leaf({ name: '워크샵', plannedStart: '2026-07-20', plannedEnd: '2026-07-20', deliverable: '결과보고' })], today)
    expect(r.name).toBe('워크샵')
  })
  it('날짜 null + 산출물 리프는 감지 안 함(null===null 함정 방지)', () => {
    const r = detectMilestones([leaf({ name: '일반작업', deliverable: '산출물', plannedStart: null, plannedEnd: null })], today)
    expect(r.name).toBeNull(); expect(r.signal).toBe('neutral')
  })
  it('지연 마일스톤(예정일 경과+미완료) → red', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-01', status: 'delayed' })], today)
    expect(r.overdue).toBe(true); expect(r.signal).toBe('red')
  })
  it('완료된 마일스톤은 제외', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-20', status: 'done' })], today)
    expect(r.name).toBeNull()
  })
  it('미감지 → neutral', () => {
    expect(detectMilestones([leaf({ name: '일반작업', plannedEnd: '2026-07-20' })], today).signal).toBe('neutral')
  })
  it('다음 마일스톤 동점은 sortOrder로 결정', () => {
    const r = detectMilestones([
      leaf({ name: '중간보고 B', plannedEnd: '2026-07-20', sortOrder: 5 }),
      leaf({ name: '중간보고 A', plannedEnd: '2026-07-20', sortOrder: 2 }),
    ], today)
    expect(r.name).toBe('중간보고 A')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `detectMilestones` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `dashboard.ts`)

```ts
// 마일스톤 키워드(소문자, WBS 도메인 데이터 기준). 이름에 부분문자열(대소문자 무시) 매칭.
const MILESTONE_KEYWORDS = ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프']

export interface MilestoneModel {
  name: string | null; date: string | null; dday: number | null; overdue: boolean; signal: Signal
}

function isMilestoneLeaf(l: ComputedItem): boolean {
  const name = l.name.toLowerCase()
  const kw = MILESTONE_KEYWORDS.some(k => name.includes(k))
  const singleDay =
    l.plannedStart != null && l.plannedStart === l.plannedEnd && !!(l.deliverable && l.deliverable.trim())
  return kw || singleDay
}
const byEndThenOrder = (a: ComputedItem, b: ComputedItem) =>
  a.plannedEnd! < b.plannedEnd! ? -1 : a.plannedEnd! > b.plannedEnd! ? 1 : a.sortOrder - b.sortOrder

export function detectMilestones(items: ComputedItem[], today: string): MilestoneModel {
  const cands = collectLeaves(items).filter(
    l => isMilestoneLeaf(l) && l.plannedEnd != null && l.status !== 'done',
  )
  const overdue = cands.filter(l => l.plannedEnd! < today).sort(byEndThenOrder)
  if (overdue.length > 0) {
    const od = overdue[0]
    return { name: od.name, date: od.plannedEnd, dday: diffDaysCal(today, od.plannedEnd!), overdue: true, signal: 'red' }
  }
  const next = cands.filter(l => l.plannedEnd! >= today).sort(byEndThenOrder)[0]
  if (!next) return { name: null, date: null, dday: null, overdue: false, signal: 'neutral' }
  const dday = diffDaysCal(today, next.plannedEnd!)
  return { name: next.name, date: next.plannedEnd, dday, overdue: false, signal: dday >= 15 ? 'green' : 'amber' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): detectMilestones 자동감지 + 신호 (TDD)"
```

---

### Task 4: `delayedLeaves` · `dueSoonLeaves` 공용 헬퍼

DashboardView가 인라인으로 갖고 있는 지연/마감임박 판정을 순수 헬퍼로 추출해 히어로·아코디언·리스크가 같은 정의를 공유(§6.3).

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** (append; reuses `leaf` factory from Task 3)

```ts
import { delayedLeaves, dueSoonLeaves } from '@/lib/domain/dashboard'

describe('delayedLeaves / dueSoonLeaves', () => {
  const today = '2026-07-08'
  it('delayedLeaves — status delayed만', () => {
    const ls = [leaf({ status: 'delayed' }), leaf({ status: 'in_progress' }), leaf({ status: 'delayed' })]
    expect(delayedLeaves(ls)).toHaveLength(2)
  })
  it('dueSoonLeaves — 미완료 & 7일 내 마감(오늘 이후)', () => {
    const ls = [
      leaf({ status: 'in_progress', plannedEnd: '2026-07-10' }),   // D+2 ✓
      leaf({ status: 'in_progress', plannedEnd: '2026-07-20' }),   // D+12 ✗
      leaf({ status: 'done', plannedEnd: '2026-07-09' }),          // done ✗
      leaf({ status: 'in_progress', plannedEnd: '2026-07-01' }),   // 과거 ✗
      leaf({ status: 'in_progress', plannedEnd: null }),           // 날짜없음 ✗
    ]
    expect(dueSoonLeaves(ls, today)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Write minimal implementation** (append to `dashboard.ts`)

```ts
export const delayedLeaves = (leaves: ComputedItem[]): ComputedItem[] =>
  leaves.filter(l => l.status === 'delayed')

/** 미완료 & 오늘 이후 7일 내 마감 — DashboardView 인라인 정의와 동일(단일 출처). */
export function dueSoonLeaves(leaves: ComputedItem[], today: string): ComputedItem[] {
  return leaves
    .filter(l => l.status !== 'done' && l.plannedEnd != null && l.plannedEnd >= today && diffDaysCal(today, l.plannedEnd) <= 7)
    .sort((a, b) => (a.plannedEnd! < b.plannedEnd! ? -1 : a.plannedEnd! > b.plannedEnd! ? 1 : 0))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): delayedLeaves/dueSoonLeaves 공용 헬퍼 (TDD)"
```

---

### Task 5: `riskModel` — 지연/마감임박 + topWeightDelayed 격상

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** (append; `leaf` factory 재사용, 루트 Phase는 `leaf`로 만들되 level 'phase')

```ts
import { riskModel } from '@/lib/domain/dashboard'

const phase = (over: Partial<ComputedItem>): ComputedItem =>
  leaf({ level: 'phase', parentId: null, ...over })

describe('riskModel', () => {
  const today = '2026-07-08'
  it('지연 0 → green', () => {
    expect(riskModel([phase({ status: 'in_progress', children: [leaf({ status: 'in_progress' })] })], today).signal).toBe('green')
  })
  it('지연 1~3 → amber', () => {
    const r = phase({ weight: null, status: 'in_progress', children: [leaf({ status: 'delayed' }), leaf({ status: 'delayed' })] })
    expect(riskModel([r], today).signal).toBe('amber')
    expect(riskModel([r], today).delayed).toBe(2)
  })
  it('지연 4+ → red', () => {
    const r = phase({ children: Array.from({ length: 4 }, () => leaf({ status: 'delayed' })) })
    expect(riskModel([r], today).signal).toBe('red')
  })
  it('최상위 가중 Phase 지연 → 한 단계 격상(green→amber)', () => {
    // 지연 리프 0(→green)이지만 최상위 가중 Phase 자체가 delayed → amber
    const top = phase({ weight: 3, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    const other = phase({ weight: 1, status: 'in_progress', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([top, other], today).topWeightDelayed).toBe(true)
    expect(riskModel([top, other], today).signal).toBe('amber')
  })
  it('가중치 전부 null → 격상 없음', () => {
    const a = phase({ weight: null, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([a], today).topWeightDelayed).toBe(false)
    expect(riskModel([a], today).signal).toBe('green')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `riskModel` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `dashboard.ts`)

```ts
export interface RiskModel { delayed: number; dueSoon: number; topWeightDelayed: boolean; signal: Signal }

const escalate = (s: Signal): Signal => (s === 'green' ? 'amber' : s === 'amber' ? 'red' : s)

/** 최상위 유효가중 루트 Phase가 지연인가. 전부 null이면 비교 불가 → false. */
function topWeightPhaseDelayed(roots: ComputedItem[]): boolean {
  if (roots.length === 0 || roots.every(r => r.weight == null)) return false
  const eff = (r: ComputedItem) => r.weight ?? 0
  const top = [...roots].sort((a, b) => eff(b) - eff(a) || a.sortOrder - b.sortOrder)[0]
  return top.status === 'delayed'
}

export function riskModel(roots: ComputedItem[], today: string): RiskModel {
  const leaves = collectLeaves(roots)
  const delayed = delayedLeaves(leaves).length
  const dueSoon = dueSoonLeaves(leaves, today).length
  const topWeightDelayed = topWeightPhaseDelayed(roots)
  let signal: Signal = delayed >= 4 ? 'red' : delayed >= 1 ? 'amber' : 'green'
  if (topWeightDelayed) signal = escalate(signal)
  return { delayed, dueSoon, topWeightDelayed, signal }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): riskModel + topWeightDelayed 격상 (TDD)"
```

---

### Task 6: `overallSignal` + `buildExecSummary` 조립

**Files:**
- Modify: `src/lib/domain/dashboard.ts`
- Test: `tests/domain/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { overallSignal, buildExecSummary } from '@/lib/domain/dashboard'

describe('overallSignal (worst-of, neutral 제외)', () => {
  it('모두 green → green', () => { expect(overallSignal(['green', 'green', 'green', 'green'])).toBe('green') })
  it('하나라도 red → red', () => { expect(overallSignal(['green', 'red', 'amber', 'neutral'])).toBe('red') })
  it('진척 green + 일정 red 충돌 → red', () => { expect(overallSignal(['green', 'red'])).toBe('red') })
  it('neutral만 있으면 green', () => { expect(overallSignal(['neutral', 'neutral'])).toBe('green') })
  it('최악이 amber → amber', () => { expect(overallSignal(['green', 'amber', 'neutral'])).toBe('amber') })
})

describe('buildExecSummary', () => {
  const today = '2026-07-08'
  it('4개 하위 모델 + 종합 판정을 조립', () => {
    const items = [phase({
      weight: null, plannedPct: 40, rolledActualPct: 20, status: 'delayed',
      children: [leaf({ status: 'delayed', plannedEnd: '2026-07-20' })],
    })]
    const r = buildExecSummary(items, { startDate: '2026-01-01', endDate: '2026-12-31', today })
    expect(r.progress.actual).toBe(20)
    expect(r.progress.planned).toBe(40)
    expect(r.progress.variance).toBe(-20)
    expect(r.progress.signal).toBe('red')       // -20 < -10
    expect(r.overall.signal).toBe('red')         // worst-of
    expect(r.risk.delayed).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `overallSignal`/`buildExecSummary` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `dashboard.ts`; add the `overallProgress` import at top)

At the top of `dashboard.ts`, extend the imports:
```ts
import { overallProgress } from './rollup'
```

Append:
```ts
const RANK: Record<Signal, number> = { neutral: -1, green: 0, amber: 1, red: 2 }

/** 하위 신호 worst-of. neutral은 판정에서 제외(모두 neutral이면 green). */
export function overallSignal(signals: Signal[]): Signal {
  return signals
    .filter(s => s !== 'neutral')
    .reduce<Signal>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'green')
}

export interface ExecSummary {
  overall: { signal: Signal }
  progress: { actual: number; planned: number; variance: number; signal: Signal }
  schedule: ScheduleModel
  risk: RiskModel
  milestone: MilestoneModel
}

export function buildExecSummary(
  items: ComputedItem[],
  opts: { startDate: string | null; endDate: string | null; today: string },
): ExecSummary {
  const { actual, planned } = overallProgress(items)
  const variance = actual - planned
  const progress = { actual, planned, variance, signal: progressSignal(variance) }
  const schedule = scheduleModel({
    startDate: opts.startDate, endDate: opts.endDate, today: opts.today,
    overallActual: actual, overallPlanned: planned,
  })
  const risk = riskModel(items, opts.today)
  const milestone = detectMilestones(items, opts.today)
  const overall = { signal: overallSignal([progress.signal, schedule.signal, risk.signal, milestone.signal]) }
  return { overall, progress, schedule, risk, milestone }
}
```

- [ ] **Step 4: Run test to verify it passes** — and run the WHOLE domain suite to confirm no regression

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: PASS.
Run: `npx vitest run`
Expected: PASS (all existing suites still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(dashboard): overallSignal 종합판정 + buildExecSummary 조립 (TDD)"
```

---

### Task 7: i18n 신규 키 추가 (additive)

미사용 키 삭제는 Task 13(page.tsx 정리)에서 함께 처리(모든 커밋이 컴파일되도록). 여기선 추가만.

**Files:**
- Modify: `src/lib/i18n/dict/dashboard.ts` (ko + en 동일 키 추가 — en은 `Record<keyof ko, string>`라 누락 시 컴파일 에러)

- [ ] **Step 1: Add keys to `dashboardKo`** (객체 끝, 닫는 `}` 직전에 추가)

```ts
  // 경영진 요약(ExecSummary)
  'dash.exec.verdictOnTrack': '정상',
  'dash.exec.verdictCaution': '주의',
  'dash.exec.verdictAtRisk': '위험',
  'dash.exec.progressLabel': '전체 진척',
  'dash.exec.scheduleLabel': '일정',
  'dash.exec.riskLabel': '리스크',
  'dash.exec.milestoneLabel': '다음 마일스톤',
  'dash.exec.projectedEnd': '예상 종료(추정)',
  'dash.exec.early': '초기 · 판단보류',
  'dash.exec.doneLabel': '완료',
  'dash.exec.noMilestone': '예정 마일스톤 없음',
  'dash.exec.noSchedule': '일정 미설정',
  'dash.exec.overdue': '예정일 경과',
  'dash.exec.delayed': '지연',
  'dash.exec.dueSoon': '마감임박',
  'dash.exec.reportTitle': '주간 보고서',
  // 아코디언 그룹
  'dash.group.analysis': '진행 분석',
  'dash.group.scheduleRisk': '일정 · 리스크',
  'dash.group.teamDeliv': '팀 · 산출물',
```

- [ ] **Step 2: Add the SAME keys to `dashboardEn`** (same order, English values)

```ts
  'dash.exec.verdictOnTrack': 'On track',
  'dash.exec.verdictCaution': 'Caution',
  'dash.exec.verdictAtRisk': 'At risk',
  'dash.exec.progressLabel': 'Overall progress',
  'dash.exec.scheduleLabel': 'Schedule',
  'dash.exec.riskLabel': 'Risk',
  'dash.exec.milestoneLabel': 'Next milestone',
  'dash.exec.projectedEnd': 'Projected end (est.)',
  'dash.exec.early': 'Early — N/A',
  'dash.exec.doneLabel': 'Complete',
  'dash.exec.noMilestone': 'No upcoming milestone',
  'dash.exec.noSchedule': 'No schedule set',
  'dash.exec.overdue': 'Overdue',
  'dash.exec.delayed': 'Delayed',
  'dash.exec.dueSoon': 'Due soon',
  'dash.exec.reportTitle': 'Weekly report',
  'dash.group.analysis': 'Progress analysis',
  'dash.group.scheduleRisk': 'Schedule & risk',
  'dash.group.teamDeliv': 'Team & deliverables',
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (ko/en 키 패리티 충족).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/dict/dashboard.ts
git commit -m "feat(dashboard): ExecSummary/아코디언 i18n 키 추가(ko/en)"
```

---

### Task 8: `signalStyle.ts` + `SignalTile` 컴포넌트

신호 색/아이콘 토큰을 단일 출처로. 색 단독 금지(색+아이콘+텍스트). 상호작용 없음 → 서버 렌더 가능(`'use client'` 불필요).

**Files:**
- Create: `src/components/dashboard/signalStyle.ts`
- Create: `src/components/dashboard/SignalTile.tsx`

- [ ] **Step 1: Create `signalStyle.ts`**

```ts
import { CheckCircle2, AlertTriangle, AlertOctagon, MinusCircle, type LucideIcon } from 'lucide-react'
import type { Signal } from '@/lib/domain/dashboard'

/** 신호 → 토큰(라이트/다크 자동 대응, 기존 상태 팔레트 재사용) + 접근성 아이콘. */
export const SIGNAL_META: Record<Signal, { text: string; dot: string; borderTop: string; chip: string; icon: LucideIcon }> = {
  green:   { text: 'text-done',           dot: 'bg-done',           borderTop: 'border-t-done',           chip: 'bg-done-weak text-done',              icon: CheckCircle2 },
  amber:   { text: 'text-accent-warning', dot: 'bg-accent-warning', borderTop: 'border-t-accent-warning', chip: 'bg-pending-weak text-accent-warning', icon: AlertTriangle },
  red:     { text: 'text-delayed',        dot: 'bg-delayed',        borderTop: 'border-t-delayed',        chip: 'bg-delayed-weak text-delayed',        icon: AlertOctagon },
  neutral: { text: 'text-ink-subtle',     dot: 'bg-ink-subtle',     borderTop: 'border-t-line-strong',    chip: 'bg-surface-2 text-ink-subtle',        icon: MinusCircle },
}
```

- [ ] **Step 2: Create `SignalTile.tsx`**

```tsx
import type { ReactNode } from 'react'
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from './signalStyle'

/** 신호등 KPI 타일. statusText는 색맹 대응용 텍스트 라벨(필수). */
export function SignalTile({ label, value, sub, signal, statusText }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  signal: Signal
  statusText: string
}) {
  const m = SIGNAL_META[signal]
  const Icon = m.icon
  return (
    <div className={`rounded-2xl border border-line border-t-2 ${m.borderTop} bg-surface-2/50 px-4 py-3.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${m.text}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />{statusText}
        </span>
      </div>
      <div className="mt-2 text-xl font-bold tabular-nums leading-none text-ink">{value}</div>
      {sub != null && <div className="mt-1.5 text-[11px] leading-4 text-ink-muted">{sub}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (토큰 클래스 존재는 Task 15 빌드/실앱에서 시각 확인.)

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/signalStyle.ts src/components/dashboard/SignalTile.tsx
git commit -m "feat(dashboard): SignalTile + signalStyle (신호등 토큰/접근성)"
```

---

### Task 9: `ProgressGauge` — SVG 도넛 + 중앙 종합 판정

시각 위계: 큰 실적% + 종합 판정 칩이 1차, 링/눈금은 보조. SVG + aria-label로 수치 제공.

**Files:**
- Create: `src/components/dashboard/ProgressGauge.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from './signalStyle'

const SIZE = 128, CENTER = 64, R = 52, STROKE = 12
const CIRC = 2 * Math.PI * R
const clamp = (n: number) => Math.min(100, Math.max(0, n))

/** 실적=파랑 채움, 계획=눈금 마커, 중앙=종합 판정 칩 + 큰 실적%. */
export function ProgressGauge({ actual, planned, variance, overall, verdictText, plannedText }: {
  actual: number
  planned: number
  variance: number
  overall: Signal
  verdictText: string
  plannedText: string
}) {
  const m = SIGNAL_META[overall]
  const dash = (clamp(actual) / 100) * CIRC
  const th = (clamp(planned) / 100) * 2 * Math.PI
  const at = (rad: number): [number, number] => [CENTER + rad * Math.sin(th), CENTER - rad * Math.cos(th)]
  const [ix, iy] = at(R - STROKE / 2)
  const [ox, oy] = at(R + STROKE / 2)
  const varText = `${variance >= 0 ? '+' : ''}${variance}%p`
  return (
    <div
      className="relative h-32 w-32 shrink-0"
      role="img"
      aria-label={`전체 진척 실적 ${actual}%, 계획 ${planned}%, 편차 ${varText}, 종합 판정 ${verdictText}`}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        <circle cx={CENTER} cy={CENTER} r={R} fill="none" strokeWidth={STROKE} className="stroke-line" />
        <circle
          cx={CENTER} cy={CENTER} r={R} fill="none" strokeWidth={STROKE} strokeLinecap="round"
          className="stroke-brand" strokeDasharray={`${dash} ${CIRC}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
        <line x1={ix} y1={iy} x2={ox} y2={oy} strokeWidth={2.5} strokeLinecap="round" className="stroke-ink" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className={`badge text-[10px] ${m.chip}`}>{verdictText}</span>
        <span className="text-2xl font-extrabold leading-none tabular-nums text-ink">{actual}%</span>
        <span className="text-[10px] text-ink-subtle">{plannedText}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/ProgressGauge.tsx
git commit -m "feat(dashboard): ProgressGauge SVG 도넛 + 중앙 종합판정"
```

---

### Task 10: `ReportButton` surface 변형 + `ExecSummary` 조립

`ReportButton`은 다크 히어로용 스타일이라 밝은 surface에 놓으면 안 어울림 → `variant` 추가. 이후 `ExecSummary`(서버 컴포넌트)가 게이지+타일3+공지+리포트를 조립.

**Files:**
- Modify: `src/components/report/ReportButton.tsx` (버튼 className을 variant로 분기)
- Create: `src/components/dashboard/ExecSummary.tsx`

- [ ] **Step 1: Add `variant` to ReportButton**

`ReportButton`의 props에 `variant?: 'hero' | 'surface'`(기본 `'hero'`)를 추가하고, `<button>`의 className을 분기한다. 기존 hero className은 그대로 유지(기본값이라 다른 호출부 영향 없음):

```tsx
// props 구조분해에 추가: variant = 'hero'
// <button> className 을 아래로 교체:
className={
  variant === 'surface'
    ? 'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-2'
    : 'inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20'
}
```
타입 시그니처에 `variant?: 'hero' | 'surface'` 한 줄 추가.

- [ ] **Step 2: Create `ExecSummary.tsx`** (서버 컴포넌트 — `'use client'` 없음)

```tsx
import Link from 'next/link'
import { Pin } from 'lucide-react'
import type { Announcement, ComputedItem } from '@/lib/domain/types'
import { buildExecSummary, type Signal } from '@/lib/domain/dashboard'
import { sortAnnouncements, isPublishedNow, ANNOUNCEMENT_META } from '@/lib/domain/announcements'
import { getServerLocale } from '@/lib/i18n/server'
import { t, type DictKey } from '@/lib/i18n/dict'
import { fmtDate } from '@/components/wbs/shared'
import { ProgressGauge } from './ProgressGauge'
import { SignalTile } from './SignalTile'
import { ReportButton } from '@/components/report/ReportButton'

const VERDICT_KEY: Record<Exclude<Signal, 'neutral'>, DictKey> = {
  green: 'dash.exec.verdictOnTrack',
  amber: 'dash.exec.verdictCaution',
  red: 'dash.exec.verdictAtRisk',
}
const statusWord = (sig: Signal, tr: (k: DictKey) => string): string =>
  sig === 'neutral' ? tr('dash.exec.early') : tr(VERDICT_KEY[sig])

export async function ExecSummary({
  items, projectId, projectName, projectDescription, startDate, endDate, today, announcements,
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate: string | null
  endDate: string | null
  today: string
  announcements: Announcement[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const s = buildExecSummary(items, { startDate, endDate, today })

  const verdict = statusWord(s.overall.signal === 'neutral' ? 'green' : s.overall.signal, tr)
  const plannedText = `${tr('dash.plannedLabel')} ${s.progress.planned}% · ${s.progress.variance >= 0 ? '+' : ''}${s.progress.variance}%p`

  const schedValue =
    s.schedule.label === 'none' ? tr('dash.exec.noSchedule')
    : s.schedule.label === 'done' ? tr('dash.exec.doneLabel')
    : `D+${s.schedule.elapsed}`
  const schedSub =
    s.schedule.label === 'onTrack' && s.schedule.projectedEnd ? `${tr('dash.exec.projectedEnd')} ${fmtDate(s.schedule.projectedEnd)}`
    : s.schedule.label === 'early' ? tr('dash.exec.early')
    : s.schedule.label === 'none' ? null
    : `${s.schedule.remaining}${tr('dash.unitDays')}`

  const msValue = s.milestone.name ?? tr('dash.exec.noMilestone')
  const msSub = s.milestone.date
    ? `${fmtDate(s.milestone.date)} · ${s.milestone.overdue ? tr('dash.exec.overdue') : `D-${s.milestone.dday}`}`
    : null

  const notice = sortAnnouncements(announcements.filter(a => isPublishedNow(a, today)))[0] ?? null

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">EXECUTIVE SUMMARY</div>
          <h2 className="mt-0.5 truncate text-base font-bold text-ink">{projectName}</h2>
        </div>
        <ReportButton
          variant="surface" projectId={projectId} items={items} projectName={projectName}
          projectDescription={projectDescription} today={today} startDate={startDate} endDate={endDate}
        />
      </div>

      <div className="grid items-center gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-center gap-4">
          <ProgressGauge
            actual={s.progress.actual} planned={s.progress.planned} variance={s.progress.variance}
            overall={s.overall.signal} verdictText={verdict} plannedText={plannedText}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <SignalTile label={tr('dash.exec.scheduleLabel')} value={schedValue} sub={schedSub}
            signal={s.schedule.signal} statusText={statusWord(s.schedule.signal, tr)} />
          <SignalTile label={tr('dash.exec.riskLabel')} value={`${s.risk.delayed}${tr('dash.unitCount')}`}
            sub={`${tr('dash.exec.delayed')} ${s.risk.delayed} · ${tr('dash.exec.dueSoon')} ${s.risk.dueSoon}`}
            signal={s.risk.signal} statusText={statusWord(s.risk.signal, tr)} />
          <SignalTile label={tr('dash.exec.milestoneLabel')} value={<span className="text-sm">{msValue}</span>} sub={msSub}
            signal={s.milestone.signal} statusText={statusWord(s.milestone.signal, tr)} />
        </div>
      </div>

      {notice && (
        <Link href={`/p/${projectId}/announcements`}
          className="mt-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5 transition hover:bg-surface-2">
          <span className={`chip shrink-0 ${ANNOUNCEMENT_META[notice.category].chip}`}>{tr(ANNOUNCEMENT_META[notice.category].labelKey)}</span>
          {notice.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-accent-warning" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink" title={notice.title}>{notice.title}</span>
          <span className="shrink-0 text-[11px] text-ink-subtle">{tr('common.viewAll')}</span>
        </Link>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Note: `msValue`가 문자열이라 `value`에 `<span>`으로 감싸 크기 축소.)

- [ ] **Step 4: Commit**

```bash
git add src/components/report/ReportButton.tsx src/components/dashboard/ExecSummary.tsx
git commit -m "feat(dashboard): ExecSummary 조립 + ReportButton surface 변형"
```

---

### Task 11: `DetailAccordion` client 셸 + `UiPrefs.dashSections`

thin `'use client'` 셸 — 서버 렌더 그룹 JSX를 props로 받아 접기/펼치기만. 펼침 상태는 기존 UiPrefs(JSONB) 전역 저장.

**Files:**
- Modify: `src/lib/domain/types.ts` (UiPrefs에 키 추가)
- Create: `src/components/dashboard/DetailAccordion.tsx`

- [ ] **Step 1: Add `dashSections` to `UiPrefs`** (`src/lib/domain/types.ts`)

`UiPrefs` 인터페이스에 한 줄 추가(마이그레이션 불필요 — prefs는 JSONB):
```ts
  dashSections?: string[]   // 대시보드 상세 아코디언에서 펼쳐 둔 그룹 id
```

- [ ] **Step 2: Create `DetailAccordion.tsx`**

```tsx
'use client'
import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

export interface AccordionGroup { id: string; title: ReactNode; content: ReactNode }

/** 서버가 렌더한 그룹 콘텐츠를 받아 접기/펼치기만 담당. 펼침 상태는 UiPrefs로 전역 저장. */
export function DetailAccordion({ groups, initialExpanded }: {
  groups: AccordionGroup[]
  initialExpanded: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialExpanded))
  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      queueUiPref({ dashSections: [...next] })
      return next
    })

  return (
    <div className="space-y-3">
      {groups.map(g => {
        const isOpen = open.has(g.id)
        return (
          <div key={g.id} className="card overflow-hidden">
            <button
              type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen}
              className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-[13px] font-semibold text-ink transition hover:bg-surface-2/50"
            >
              <ChevronRight className={`h-4 w-4 text-ink-subtle transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              {g.title}
            </button>
            {isOpen && <div className="border-t border-line px-5 pb-5 pt-4">{g.content}</div>}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/domain/types.ts src/components/dashboard/DetailAccordion.tsx
git commit -m "feat(dashboard): DetailAccordion client 셸 + UiPrefs.dashSections"
```

---

### Task 12: `DashboardView` 재구성 (Server Component 유지)

기존 13블록 JSX·계산은 **삭제하지 않고 재배치**한다. 상단=ExecSummary, 다음=핵심 시각 2개(Phase·지연), 나머지=DetailAccordion 3그룹. 이 태스크는 대량 이동이므로 **기존 블록 JSX를 지시된 슬롯으로 옮기는** 작업이다.

**Files:**
- Modify: `src/components/dashboard/DashboardView.tsx`

- [ ] **Step 1: props · import 변경**

props에 3개 추가: `projectName: string`, `projectDescription?: string | null`, `initialExpanded: string[]`. 상단 import에 추가:
```ts
import { ExecSummary } from './ExecSummary'
import { DetailAccordion } from './DetailAccordion'
```

- [ ] **Step 2: 계산 정리**

`overallProgress`·`variance`·`schedule` 계산과 `overallProgress` import는 **삭제**(이제 ExecSummary가 buildExecSummary로 자체 계산). `roots`, `leaves`, `statusCount`, `teamSummary`, `delayed`, `weightShare`, `recentDone`, `thisWeek`, `nextWeek`, `dueSoon`, `withDeliverable`/`deliverable*`, 근태 계산은 **유지**(핵심 시각·아코디언에서 사용). `overallProgress` 미사용 시 import 제거로 lint 통과.

- [ ] **Step 3: `return` JSX 교체**

기존 `return (<div className="space-y-5"> … </div>)` 전체를 아래로 교체. `{/* ↓ 기존 … SectionCard 이동 */}` 자리에는 **기존 파일의 해당 `<SectionCard>` JSX를 그대로 잘라 붙인다**(내용/로직 변경 없음). 삭제 대상: 기존 **TIMELINE(프로젝트 일정)**·**NOTICE(공지)** SectionCard 2개(→ ExecSummary가 대체).

```tsx
return (
  <div className="space-y-5">
    <ExecSummary
      items={items} projectId={projectId} projectName={projectName} projectDescription={projectDescription}
      startDate={startDate} endDate={endDate} today={today} announcements={announcements}
    />

    {/* 핵심 시각 2개 */}
    <div className="grid gap-5 xl:grid-cols-2">
      {/* ↓ 기존 BY PHASE(dash.phase.title) SectionCard 이동 */}
      {/* ↓ 기존 ATTENTION(dash.kpi.delayed 지연) SectionCard 이동 */}
    </div>

    <DetailAccordion
      initialExpanded={initialExpanded}
      groups={[
        {
          id: 'analysis',
          title: tr('dash.group.analysis'),
          content: (
            <div className="grid gap-5 xl:grid-cols-2">
              {/* ↓ 기존 STATUS MIX(dash.statusMix.title) SectionCard 이동 */}
              {/* ↓ 기존 WEIGHT(dash.weight.title) SectionCard 이동 */}
            </div>
          ),
        },
        {
          id: 'scheduleRisk',
          title: tr('dash.group.scheduleRisk'),
          content: (
            <div className="grid gap-5 xl:grid-cols-2">
              {/* ↓ 기존 DUE SOON(dash.dueSoon.title) SectionCard 이동 */}
              <div className="grid gap-5">
                {/* ↓ 기존 THIS WEEK(dash.thisWeek.title) SectionCard 이동 */}
                {/* ↓ 기존 NEXT WEEK(dash.nextWeek.title) SectionCard 이동 */}
              </div>
            </div>
          ),
        },
        {
          id: 'teamDeliv',
          title: tr('dash.group.teamDeliv'),
          content: (
            <div className="grid gap-5 xl:grid-cols-2">
              {/* ↓ 기존 TEAM LOAD(dash.teamLoad.title) SectionCard 이동 */}
              {/* ↓ 기존 DELIVERABLES(dash.deliv.title) SectionCard 이동 */}
              {/* ↓ 기존 RECENTLY DONE(dash.recentDone.title) SectionCard 이동 */}
              {/* ↓ 기존 THIS WEEK ATTENDANCE(dash.att.title) SectionCard 이동 */}
            </div>
          ),
        },
      ]}
    />
  </div>
)
```

**주의(모든 13블록 귀속 확인):** TIMELINE·NOTICE=ExecSummary / BY PHASE·지연=핵심시각 / STATUS MIX·WEIGHT=analysis / DUE SOON·THIS WEEK·NEXT WEEK=scheduleRisk / TEAM LOAD·DELIVERABLES·RECENTLY DONE·ATTENDANCE=teamDeliv. → 13블록 전부 재배치(정보 손실 0).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (page.tsx가 아직 신규 props를 안 넘기면 이 단계에서 에러 → Task 13에서 배선. 순서상 Task 13과 함께 커밋해도 됨.)

- [ ] **Step 5: Commit** (Task 13과 연속 실행 권장 — 사이 커밋은 타입 에러일 수 있음)

```bash
git add src/components/dashboard/DashboardView.tsx
git commit -m "refactor(dashboard): DashboardView를 ExecSummary+핵심시각+아코디언으로 재구성"
```

---

### Task 13: `page.tsx` 정리 + initialExpanded 배선 + 미사용 키 삭제

죽은 `heroKpis`/`actions` prop 제거(중복 아님 — 미렌더 죽은 코드), `getUiPrefs`로 아코디언 초기 상태 배선, ReportButton은 ExecSummary로 이관(여기선 제거).

**Files:**
- Modify: `src/app/(app)/p/[projectId]/dashboard/page.tsx` (전면 교체)
- Modify: `src/lib/i18n/dict/dashboard.ts` (미사용 키 삭제)

- [ ] **Step 1: Replace `page.tsx` 전체**

```tsx
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectMembers } from '@/lib/data/members'
import { getAttendanceRecords } from '@/lib/data/attendance'
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
  const [{ items, today }, projects, members, attendance, announcements, prefs] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getProjectMembers(projectId),
    getAttendanceRecords(projectId),
    getAnnouncements(projectId),
    getUiPrefs(),
  ])
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'dash.heroProjectFallback')

  return (
    <ProjectPageShell
      hero={<PageHero title={`${projectName}${t(locale, 'dash.heroTitleSuffix')}`} />}
    >
      <DashboardView
        items={items}
        projectId={projectId}
        projectName={projectName}
        projectDescription={project?.description}
        startDate={project?.start_date ?? null}
        endDate={project?.end_date ?? null}
        today={today}
        memberCount={members.length}
        attendance={attendance}
        announcements={announcements}
        initialExpanded={prefs.dashSections ?? []}
      />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 2: Typecheck the wiring**

Run: `npx tsc --noEmit`
Expected: PASS (DashboardView 신규 props 충족, 죽은 import 제거).

- [ ] **Step 3: 미사용 dict 키 확인 후 삭제**

먼저 사용처가 dict 정의뿐인지 확인:
```bash
for k in dash.kpi.actualSub dash.kpi.planned dash.kpi.inProgress dash.kpi.done dash.ofTotalPrefix dash.pctDoneSuffix dash.needsReview dash.normalRange; do
  echo "== $k =="; grep -rn "$k" src --include=*.ts --include=*.tsx | grep -v 'dict/dashboard.ts'
done
```
Expected: 각 키에 대해 **출력 없음**(정의 파일 외 사용처 0). 출력이 있으면 그 키는 남긴다.

그런 다음 `src/lib/i18n/dict/dashboard.ts`의 `dashboardKo`·`dashboardEn` 양쪽에서 위 8개 키 줄을 삭제한다(패리티 유지). `dash.kpi.delayed`·`dash.vsPlan`·`dash.actualLabel`·`dash.plannedLabel`은 **유지**(BY PHASE·ExecSummary에서 사용).

- [ ] **Step 4: Typecheck + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/p/\[projectId\]/dashboard/page.tsx src/lib/i18n/dict/dashboard.ts
git commit -m "refactor(dashboard): page.tsx 죽은 prop 정리 + 아코디언 배선 + 미사용 키 삭제"
```

---

### Task 14: `loading.tsx` 스켈레톤 교체

새 레이아웃과 일치시켜 로딩 플래시 방지(구 4-KPI 레일 제거).

**Files:**
- Modify: `src/app/(app)/p/[projectId]/dashboard/loading.tsx` (전면 교체)

- [ ] **Step 1: Replace `loading.tsx` 전체**

```tsx
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="space-y-5" role="status" aria-label="대시보드를 불러오는 중">
      {/* ExecSummary: 게이지 + 신호등 타일 3 + 공지 슬림바 */}
      <div className="card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
        <div className="grid items-center gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
          <Skeleton className="mx-auto h-32 w-32 rounded-full" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        </div>
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      </div>

      {/* 핵심 시각 2개 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>

      {/* 상세 아코디언(접힘) — 헤더 바 3개 */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-2xl" />)}
      </div>
    </div>
  )
}
```
(기존 `KpiSkeleton` import 제거 — 미사용.)

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/p/\[projectId\]/dashboard/loading.tsx
git commit -m "refactor(dashboard): loading 스켈레톤을 새 레이아웃에 맞춰 교체"
```

---

### Task 15: 최종 검증 (test · lint · build · 실앱)

**Files:** (없음 — 검증만)

- [ ] **Step 1: 전체 단위 테스트**

Run: `npx vitest run`
Expected: PASS (dashboard.test.ts 포함 전 스위트 green).

- [ ] **Step 2: 타입 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0.

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: 빌드 성공. dashboard 라우트가 에러 없이 컴파일(서버 컴포넌트 DashboardView 안에 client DetailAccordion/ReportButton 정상).

- [ ] **Step 4: 실제 앱 시각 확인**

`npm run dev` 후 `/p/<projectId>/dashboard` 접속(로그인 필요). 확인:
- 히어로: 게이지 중앙에 종합 판정 단어+색, 실적%/계획 눈금, 신호등 타일 3개(색+아이콘+라벨), 공지 슬림바, 우상단 "주간 보고서" 버튼.
- 핵심 시각: Phase 진척 / 지연 Top 2단.
- 아코디언 3그룹: 클릭 시 펼침/접힘, 새로고침 후에도 펼침 상태 유지(UiPrefs 저장).
- 반응형: 창을 좁히면 게이지+타일 세로 스택, 320px에서 가로 스크롤 없음.
- 다크/라이트 모두에서 신호 색 대비 정상.

라이브 D-CUBE 데이터 기준 예상: 진척 낮음(초기) → 일정 신호 **회색(초기)**, 마일스톤 = 착수보고회/중간보고 계열 감지.

- [ ] **Step 5: 최종 커밋(없으면 skip)** — 시각 확인 중 소소한 토큰/여백 보정이 있으면 커밋.

```bash
git add -A && git commit -m "fix(dashboard): 시각 확인 후 보정"
```

---

## 완료 기준
- `dashboard.ts` 순수 함수 전부 테스트 green(신호 경계·SPI 가드·마일스톤 null·overall worst-of·격상).
- 대시보드가 종합 판정 중심 히어로 + 접이식 상세로 렌더, 기존 13블록 전부 보존.
- tsc/lint/build 통과, 실앱에서 아코디언 영속·반응형·접근성 확인.
