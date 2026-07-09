# 대시보드 본문 재구성 (경영진/PMO 섹션 + 진척 트렌드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드의 ExecSummary 아래 전체를 S-Curve 트렌드·Phase×팀 매트릭스·편차 랭킹·마일스톤 타임라인·기한경과 에이징·데이터 위생으로 완전 교체하고, 실적 이력 스냅샷 테이블을 신설한다.

**Architecture:** 순수 도메인 함수(`src/lib/domain/trend.ts` 신규 + `dashboard.ts` 확장)가 모든 계산을 담당하고, 서버 컴포넌트가 자체 SVG로 렌더한다. 스냅샷은 WBS 변경 서버 액션과 대시보드 조회 시 `next/server`의 `after()`로 무지연 upsert된다(크론 없음).

**Tech Stack:** Next.js 15.5 App Router(RSC), Supabase(RLS), Tailwind v4 토큰, Vitest. 차트 라이브러리 없음.

**Spec:** `docs/superpowers/specs/2026-07-09-dashboard-exec-pmo-redesign-design.md` (승인본)

## Global Constraints

- **새 런타임 의존성 추가 금지** — 차트는 전부 자체 SVG (기존 `ProgressGauge` 노선).
- 신규 컴포넌트는 **서버 컴포넌트** (`'use client'` 금지). 기존 클라이언트 컴포넌트(`ProgressBar`) 재사용은 허용.
- i18n: `dashboardKo`에 키 추가 시 `dashboardEn`에도 동시 추가 — `dashboardEn`은 `Record<keyof typeof dashboardKo, string>`라 누락 시 컴파일 에러. en의 단위 접미사는 선행 공백 포함(예: `' items'`).
- 날짜: KST는 `seoulToday()` 패턴(`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`), 캘린더 일수 계산은 기존 `diffDaysCal`/`addDaysCal`(UTC 정수일, `@/lib/domain/dashboard` export).
- 도메인 계산은 `src/lib/domain`의 순수 함수로만 — UI 컴포넌트 안에서 집계 계산 금지.
- 마이그레이션: 멱등(`if not exists` / `drop policy if exists`). RLS 헬퍼는 **`public.app_role()`** — `current_role()`은 PG 예약어 드리프트라 금지 (0013 주석 참조).
- git: **`git add -A` 절대 금지** — 반드시 명시한 파일만 스테이징 (병렬 세션이 같은 저장소를 사용).
- 커밋 메시지 끝에 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 검증: 이 환경의 브라우저는 dev 서버에 접근 불가 — `npm run lint` / `npm test` / `npm run build`(+ 필요시 curl)로 검증한다.
- 테스트 실행 명령: `npm test` (vitest run). 단일 파일: `npx vitest run tests/domain/trend.test.ts`.

---

### Task 1: 마이그레이션 0020 — 진척 스냅샷 테이블

**Files:**
- Create: `supabase/migrations/0020_progress_snapshots.sql`

**Interfaces:**
- Consumes: 프로덕션 헬퍼 `public.app_role()` (0013에서 생성됨)
- Produces: 테이블 `wbs_progress_snapshots(project_id uuid, snap_date date, actual_pct numeric(5,2), planned_pct numeric(5,2), created_at, updated_at)` PK `(project_id, snap_date)` — Task 5의 upsert 대상

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 프로젝트 진척 스냅샷 — 대시보드 S-Curve/SPI 추이의 실적 이력 원천.
-- 기록: WBS 변경 서버 액션 + 대시보드 조회 시 (project_id, KST 날짜) upsert. 크론 없음.
-- 권한: 읽기 = 인증 사용자 전체 / 쓰기 = 멤버십 보유자(app_role() is not null)
--       — updateActual 이 팀 멤버에게 허용되므로 스냅샷 쓰기도 동일 범위.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0013과 동일 경로).
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

create table if not exists wbs_progress_snapshots (
  project_id  uuid not null references projects(id) on delete cascade,
  snap_date   date not null,
  actual_pct  numeric(5,2) not null check (actual_pct between 0 and 100),
  planned_pct numeric(5,2) not null check (planned_pct between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (project_id, snap_date)
);

alter table wbs_progress_snapshots enable row level security;

drop policy if exists read_all_progress_snapshots on wbs_progress_snapshots;
create policy read_all_progress_snapshots on wbs_progress_snapshots
  for select to authenticated using (true);

drop policy if exists member_write_progress_snapshots on wbs_progress_snapshots;
create policy member_write_progress_snapshots on wbs_progress_snapshots
  for all to authenticated
  using (app_role() is not null)
  with check (app_role() is not null);
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/0020_progress_snapshots.sql
git commit -m "feat(db): wbs_progress_snapshots 테이블 — 진척 이력 스냅샷 (0020)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

프로덕션 적용은 Task 10에서(사용자 확인 후). 로컬 DB가 없으므로 이 태스크의 검증은 SQL 리뷰(멱등성·app_role 사용)로 갈음한다.

---

### Task 2: 트렌드 도메인 (`trend.ts`) — TDD

**Files:**
- Create: `src/lib/domain/trend.ts`
- Test: `tests/domain/trend.test.ts`

**Interfaces:**
- Consumes: `computeTree`, `overallProgress` (`@/lib/domain/rollup`), `collectLeaves` (`@/lib/domain/tree`), `addDaysCal`, `diffDaysCal` (`@/lib/domain/dashboard`), `ComputedItem`, `WbsRow` (`@/lib/domain/types`)
- Produces (Task 5, 6, 9가 사용):
  - `interface SnapshotPoint { date: string; actual: number; planned: number }`
  - `interface TrendPoint { date: string; pct: number }`
  - `interface SpiPoint { date: string; spi: number }`
  - `interface TrendModel { empty: boolean; axisStart: string; axisEnd: string; plannedSeries: TrendPoint[]; actualSeries: TrendPoint[]; spiSeries: SpiPoint[]; currentSpi: number | null; velocityWeek: number | null; hasHistory: boolean }`
  - `function flattenRows(items: ComputedItem[]): WbsRow[]`
  - `function plannedAt(rows: WbsRow[], date: string, holidays: Set<string>): number`
  - `function buildTrend(input: { items: ComputedItem[]; snapshots: SnapshotPoint[]; holidays: Set<string>; startDate: string | null; endDate: string | null; today: string }): TrendModel`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/trend.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { buildTrend, plannedAt, flattenRows, type SnapshotPoint } from '@/lib/domain/trend'

const row = (over: Partial<WbsRow>): WbsRow => ({
  id: over.id ?? Math.random().toString(36).slice(2), parentId: null, level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...over,
})
const TODAY = '2026-02-20'
const items = (rows: WbsRow[]) => computeTree(rows, TODAY, new Set())
const snap = (date: string, actual: number, planned: number): SnapshotPoint => ({ date, actual, planned })

const baseRows = [row({ plannedStart: '2026-01-01', plannedEnd: '2026-04-10', actualPct: 30 })]

describe('plannedAt', () => {
  const rows = flattenRows(items(baseRows))
  it('시작 전 = 0, 종료 후 = 100', () => {
    expect(plannedAt(rows, '2025-12-31', new Set())).toBe(0)
    expect(plannedAt(rows, '2026-05-01', new Set())).toBe(100)
  })
  it('구간 내 단조 비감소, 0 < 중간값 < 100', () => {
    const mid = plannedAt(rows, '2026-02-20', new Set())
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(100)
    expect(plannedAt(rows, '2026-03-20', new Set())).toBeGreaterThanOrEqual(mid)
  })
})

describe('buildTrend — 축/빈 상태', () => {
  it('기간도 WBS 날짜도 없으면 empty', () => {
    const m = buildTrend({ items: items([row({})]), snapshots: [], holidays: new Set(), startDate: null, endDate: null, today: TODAY })
    expect(m.empty).toBe(true)
  })
  it('프로젝트 기간 null이면 WBS 날짜 min/max로 축 대체', () => {
    const m = buildTrend({ items: items(baseRows), snapshots: [], holidays: new Set(), startDate: null, endDate: null, today: TODAY })
    expect(m.empty).toBe(false)
    expect(m.axisStart).toBe('2026-01-01'); expect(m.axisEnd).toBe('2026-04-10')
  })
  it('계획 곡선은 시작~종료 전 구간 + 오늘 포함, 마지막 점 100%', () => {
    const m = buildTrend({ items: items(baseRows), snapshots: [], holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })
    const dates = m.plannedSeries.map(p => p.date)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[dates.length - 1]).toBe('2026-04-10')
    expect(dates).toContain(TODAY)
    expect([...dates].sort()).toEqual(dates) // 정렬 보장
    expect(m.plannedSeries[m.plannedSeries.length - 1].pct).toBe(100)
  })
})

describe('buildTrend — 실적 이력', () => {
  const mk = (snaps: SnapshotPoint[]) =>
    buildTrend({ items: items(baseRows), snapshots: snaps, holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })

  it('carry-forward: 마지막 스냅샷 이후 오늘까지 직전 값 유지', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    expect(m.actualSeries).toEqual([
      { date: '2026-02-10', pct: 10 }, { date: '2026-02-17', pct: 20 }, { date: TODAY, pct: 20 },
    ])
    expect(m.hasHistory).toBe(true)
  })
  it('오늘 이후 스냅샷은 제외(미래 미연장)', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-03-01', 99, 60)])
    expect(m.actualSeries.every(p => p.date <= TODAY)).toBe(true)
  })
  it('스냅샷 0건: actualSeries 비고 hasHistory=false, velocity/SPI null', () => {
    const m = mk([])
    expect(m.actualSeries).toEqual([]); expect(m.hasHistory).toBe(false)
    expect(m.velocityWeek).toBeNull(); expect(m.currentSpi).toBeNull()
  })
})

describe('buildTrend — SPI / velocity', () => {
  const mk = (snaps: SnapshotPoint[]) =>
    buildTrend({ items: items(baseRows), snapshots: snaps, holidays: new Set(), startDate: '2026-01-01', endDate: '2026-04-10', today: TODAY })

  it('SPI = actual/planned (소수 2자리), planned<5 시점은 제외', () => {
    const m = mk([snap('2026-01-05', 1, 3), snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    expect(m.spiSeries).toEqual([
      { date: '2026-02-10', spi: 0.25 }, { date: '2026-02-17', spi: 0.4 },
    ])
    expect(m.currentSpi).toBe(0.4)
  })
  it('velocity = 오늘 값 − 7일 전 값 (carry-forward 기준)', () => {
    const m = mk([snap('2026-02-10', 10, 40), snap('2026-02-17', 20, 50)])
    // weekAgo = 02-13 → carry-forward 10, today = 20 → +10
    expect(m.velocityWeek).toBe(10)
  })
  it('7일 전 시점 이력이 없으면 velocity null', () => {
    const m = mk([snap('2026-02-17', 20, 50)]) // 최초 스냅샷이 weekAgo(02-13)보다 늦음
    expect(m.velocityWeek).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/trend.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/trend'`

- [ ] **Step 3: 구현** — `src/lib/domain/trend.ts`

```ts
import type { ComputedItem, WbsRow } from './types'
import { computeTree, overallProgress } from './rollup'
import { collectLeaves } from './tree'
import { addDaysCal } from './dashboard'

/** wbs_progress_snapshots 1행 (camelCase, 숫자 변환 완료 상태) */
export interface SnapshotPoint { date: string; actual: number; planned: number }
export interface TrendPoint { date: string; pct: number }
export interface SpiPoint { date: string; spi: number }

export interface TrendModel {
  empty: boolean
  axisStart: string
  axisEnd: string
  plannedSeries: TrendPoint[]
  actualSeries: TrendPoint[]   // carry-forward 적용, 오늘까지만
  spiSeries: SpiPoint[]        // planned ≥ 5 시점만(조기 불안정 가드)
  currentSpi: number | null
  velocityWeek: number | null  // 최근 7일 실적 증분(%p), 이력 부족 시 null
  hasHistory: boolean
}

const EMPTY: TrendModel = {
  empty: true, axisStart: '', axisEnd: '', plannedSeries: [], actualSeries: [],
  spiSeries: [], currentSpi: null, velocityWeek: null, hasHistory: false,
}

/** ComputedItem 트리 → 평탄한 WbsRow[] — computeTree를 다른 날짜로 재실행하기 위한 입력. */
export function flattenRows(items: ComputedItem[]): WbsRow[] {
  const out: WbsRow[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      out.push({
        id: n.id, parentId: n.parentId, level: n.level, code: n.code, sortOrder: n.sortOrder,
        name: n.name, biz: n.biz, deliverable: n.deliverable,
        plannedStart: n.plannedStart, plannedEnd: n.plannedEnd,
        weight: n.weight, actualPct: n.actualPct, owners: n.owners,
      })
      walk(n.children)
    })
  walk(items)
  return out
}

/** 임의 날짜의 전체 계획% — computeTree를 해당 날짜로 재실행(주말·공휴일 규칙 재사용). */
export function plannedAt(rows: WbsRow[], date: string, holidays: Set<string>): number {
  return overallProgress(computeTree(rows, date, holidays)).planned
}

/** carry-forward 조회: date 이전(포함) 마지막 스냅샷의 실적. 없으면 null. */
function actualAt(sorted: SnapshotPoint[], date: string): number | null {
  let v: number | null = null
  for (const s of sorted) {
    if (s.date > date) break
    v = s.actual
  }
  return v
}

export function buildTrend(input: {
  items: ComputedItem[]
  snapshots: SnapshotPoint[]
  holidays: Set<string>
  startDate: string | null
  endDate: string | null
  today: string
}): TrendModel {
  const { items, holidays, startDate, endDate, today } = input

  // 축 — 프로젝트 기간 우선, 없으면 WBS leaf 날짜 min/max
  const leafDates = collectLeaves(items)
    .flatMap(l => [l.plannedStart, l.plannedEnd])
    .filter((d): d is string => d != null)
  const axisStart = startDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a < b ? a : b)) : null)
  const axisEnd = endDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a > b ? a : b)) : null)
  if (!axisStart || !axisEnd || axisStart >= axisEnd) return EMPTY

  // 계획 누적곡선 — 주 단위 샘플 + 종료일 + (구간 내) 오늘
  const rows = flattenRows(items)
  const sampleDates = new Set<string>()
  for (let d = axisStart; d <= axisEnd; d = addDaysCal(d, 7)) sampleDates.add(d)
  sampleDates.add(axisEnd)
  if (today >= axisStart && today <= axisEnd) sampleDates.add(today)
  const plannedSeries = [...sampleDates].sort().map(date => ({ date, pct: plannedAt(rows, date, holidays) }))

  // 실적 이력 — 오늘 이후 제외, carry-forward로 오늘까지 연장
  const snaps = input.snapshots.filter(s => s.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1))
  const actualSeries: TrendPoint[] = snaps.map(s => ({ date: s.date, pct: s.actual }))
  const lastSnap = snaps[snaps.length - 1]
  if (lastSnap && lastSnap.date < today) actualSeries.push({ date: today, pct: lastSnap.actual })

  // SPI — 계획 5% 미만 시점 제외(scheduleModel 조기 가드와 동일 원칙)
  const spiSeries: SpiPoint[] = snaps
    .filter(s => s.planned >= 5)
    .map(s => ({ date: s.date, spi: Math.round((s.actual / s.planned) * 100) / 100 }))
  const currentSpi = spiSeries.length ? spiSeries[spiSeries.length - 1].spi : null

  // 주간 velocity — 7일 전 시점 값이 없으면(이력 부족) null
  const nowV = actualAt(snaps, today)
  const prevV = actualAt(snaps, addDaysCal(today, -7))
  const velocityWeek = nowV != null && prevV != null ? nowV - prevV : null

  return {
    empty: false, axisStart, axisEnd, plannedSeries, actualSeries,
    spiSeries, currentSpi, velocityWeek, hasHistory: snaps.length > 0,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/trend.test.ts`
Expected: PASS (전체 그린)

- [ ] **Step 5: 기존 테스트 회귀 확인 + 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/lib/domain/trend.ts tests/domain/trend.test.ts
git commit -m "feat(domain): 진척 트렌드 모델 — plannedAt/S-Curve/SPI/velocity (buildTrend)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 대시보드 도메인 확장 — 매트릭스·랭킹·타임라인·에이징·위생 (TDD)

**Files:**
- Modify: `src/lib/domain/dashboard.ts` (파일 끝에 추가)
- Test: `tests/domain/dashboard.test.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes: `collectLeaves`(이미 import됨), `diffDaysCal`(같은 파일), 기존 private `isMilestoneLeaf`(같은 파일), `ComputedItem`, `TeamCode`
- Produces (Task 7, 8, 9가 사용):
  - `interface MatrixCell { pct: number; planned: number; count: number }`
  - `interface MatrixRow { id: string; name: string; cells: (MatrixCell | null)[]; overall: number; planned: number; variance: number }`
  - `function progressMatrix(roots: ComputedItem[], teams: readonly TeamCode[]): MatrixRow[]`
  - `interface VarianceEntry { item: ComputedItem; gapPp: number }`
  - `function varianceRanking(leaves: ComputedItem[], today: string, limit?: number): VarianceEntry[]`
  - `type MilestoneStatus = 'done' | 'overdue' | 'upcoming'`
  - `interface MilestonePoint { id: string; name: string; date: string; status: MilestoneStatus; dday: number }`
  - `function milestoneTimeline(items: ComputedItem[], today: string): MilestonePoint[]`
  - `interface AgingEntry { item: ComputedItem; overdue: number; gap: number }`
  - `interface AgingModel { d1_7: number; d8_14: number; d15plus: number; total: number; list: AgingEntry[] }`
  - `function delayAging(leaves: ComputedItem[], today: string, limit?: number): AgingModel`
  - `interface HygieneModel { noOwner: number; noDates: number; mixedWeight: number; clean: boolean }`
  - `function dataHygiene(items: ComputedItem[]): HygieneModel`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/dashboard.test.ts` **파일 끝에** 아래를 추가 (기존 `leaf` 픽스처가 파일 상단부에 이미 정의되어 있으므로 재사용):

```ts
import {
  progressMatrix, varianceRanking, milestoneTimeline, delayAging, dataHygiene,
} from '@/lib/domain/dashboard'

describe('progressMatrix (Phase × 팀)', () => {
  const TEAMS = ['PMO', 'ERP', 'MES', '가공'] as const
  const phase = leaf({
    name: 'Phase1', rolledActualPct: 40, plannedPct: 50,
    children: [
      leaf({ owners: [{ team: 'ERP', kind: 'primary' }], rolledActualPct: 60, plannedPct: 70 }),
      leaf({ owners: [{ team: 'ERP', kind: 'support' }, { team: 'MES', kind: 'primary' }], rolledActualPct: 20, plannedPct: 30 }),
    ],
  })
  it('셀 = 담당 leaf 평균(primary+support 모두), 무배정 팀은 null', () => {
    const rows = progressMatrix([phase], TEAMS)
    expect(rows).toHaveLength(1)
    expect(rows[0].cells[0]).toBeNull()                                    // PMO
    expect(rows[0].cells[1]).toEqual({ pct: 40, planned: 50, count: 2 })   // ERP: (60+20)/2
    expect(rows[0].cells[2]).toEqual({ pct: 20, planned: 30, count: 1 })   // MES
    expect(rows[0].cells[3]).toBeNull()                                    // 가공
  })
  it('행 요약 = Phase 롤업값과 편차', () => {
    const r = progressMatrix([phase], TEAMS)[0]
    expect(r.overall).toBe(40); expect(r.planned).toBe(50); expect(r.variance).toBe(-10)
  })
})

describe('varianceRanking (마감 전 따라잡기 후보)', () => {
  const today = '2026-07-09'
  it('done·기한경과·편차≤0 제외, 편차 내림차순', () => {
    const out = varianceRanking([
      leaf({ name: 'A', plannedPct: 50, rolledActualPct: 30, plannedEnd: '2026-07-20' }),          // gap 20
      leaf({ name: 'B', plannedPct: 40, rolledActualPct: 35, plannedEnd: null }),                  // gap 5, 마감 없음 → 포함
      leaf({ name: 'C', plannedPct: 80, rolledActualPct: 10, plannedEnd: '2026-07-01' }),          // 기한경과 → 제외
      leaf({ name: 'D', plannedPct: 50, rolledActualPct: 50, plannedEnd: '2026-07-20' }),          // gap 0 → 제외
      leaf({ name: 'E', status: 'done', plannedPct: 50, rolledActualPct: 100, plannedEnd: '2026-07-20' }), // done → 제외
    ], today)
    expect(out.map(e => e.item.name)).toEqual(['A', 'B'])
    expect(out[0].gapPp).toBe(20); expect(out[1].gapPp).toBe(5)
  })
  it('limit 적용', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      leaf({ name: `T${i}`, plannedPct: 50, rolledActualPct: 50 - (i + 1), plannedEnd: '2026-08-01' }))
    expect(varianceRanking(many, today)).toHaveLength(8)
  })
})

describe('milestoneTimeline (완료 포함 전체)', () => {
  const today = '2026-07-09'
  it('done/overdue/upcoming 분류 + 날짜순 정렬', () => {
    const out = milestoneTimeline([
      leaf({ name: '착수보고', plannedEnd: '2026-06-01', status: 'done' }),
      leaf({ name: '중간보고', plannedEnd: '2026-07-01', status: 'in_progress' }),
      leaf({ name: '최종 선정', plannedEnd: '2026-07-20', status: 'not_started' }),
      leaf({ name: '일반 작업', plannedEnd: '2026-07-15', status: 'in_progress' }),  // 키워드/단일일+산출물 아님 → 제외
    ], today)
    expect(out.map(m => m.name)).toEqual(['착수보고', '중간보고', '최종 선정'])
    expect(out.map(m => m.status)).toEqual(['done', 'overdue', 'upcoming'])
    expect(out[2].dday).toBe(11)
  })
  it('단일일 + 산출물 leaf도 감지', () => {
    const out = milestoneTimeline([
      leaf({ name: '워크샵', plannedStart: '2026-07-20', plannedEnd: '2026-07-20', deliverable: '결과보고' }),
    ], today)
    expect(out).toHaveLength(1)
  })
})

describe('delayAging (기한 경과 에이징)', () => {
  const today = '2026-07-09'
  it('버킷 경계: 1~7 / 8~14 / 15+', () => {
    const m = delayAging([
      leaf({ name: 'a', plannedEnd: '2026-07-08', plannedPct: 50, rolledActualPct: 10 }), // 1일
      leaf({ name: 'b', plannedEnd: '2026-07-02', plannedPct: 50, rolledActualPct: 10 }), // 7일
      leaf({ name: 'c', plannedEnd: '2026-07-01', plannedPct: 50, rolledActualPct: 10 }), // 8일
      leaf({ name: 'd', plannedEnd: '2026-06-24', plannedPct: 50, rolledActualPct: 10 }), // 15일
    ], today)
    expect(m.d1_7).toBe(2); expect(m.d8_14).toBe(1); expect(m.d15plus).toBe(1); expect(m.total).toBe(4)
  })
  it('done·마감 전·마감 없음 제외, 리스트는 경과일 내림차순', () => {
    const m = delayAging([
      leaf({ name: 'done', plannedEnd: '2026-07-01', status: 'done' }),
      leaf({ name: 'future', plannedEnd: '2026-07-20' }),
      leaf({ name: 'nodate', plannedEnd: null }),
      leaf({ name: 'old', plannedEnd: '2026-06-01', plannedPct: 80, rolledActualPct: 10 }),
      leaf({ name: 'new', plannedEnd: '2026-07-08', plannedPct: 50, rolledActualPct: 10 }),
    ], today)
    expect(m.total).toBe(2)
    expect(m.list.map(e => e.item.name)).toEqual(['old', 'new'])
    expect(m.list[0].overdue).toBe(38)
  })
})

describe('dataHygiene (계획 데이터 품질)', () => {
  it('담당 누락·기간 미설정 leaf 카운트', () => {
    const m = dataHygiene([
      leaf({ owners: [], plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
      leaf({ owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: null, plannedEnd: null }),
    ])
    expect(m.noOwner).toBe(1); expect(m.noDates).toBe(1); expect(m.clean).toBe(false)
  })
  it('가중치 혼재: 형제 그룹 내 일부만 null → 그룹당 1 카운트, 전부 null은 정상', () => {
    const mixedRoots = dataHygiene([leaf({ weight: 1 }), leaf({ weight: null })])
    expect(mixedRoots.mixedWeight).toBe(1)
    const allNull = dataHygiene([leaf({ weight: null }), leaf({ weight: null })])
    expect(allNull.mixedWeight).toBe(0)
    const mixedChildren = dataHygiene([
      leaf({ weight: 1, children: [leaf({ weight: 2 }), leaf({ weight: null })] }),
      leaf({ weight: 1 }),
    ])
    expect(mixedChildren.mixedWeight).toBe(1) // 루트 그룹은 전부 non-null, 자식 그룹만 혼재
  })
  it('전부 정상이면 clean', () => {
    const m = dataHygiene([leaf({ owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-01', plannedEnd: '2026-07-10' })])
    expect(m.clean).toBe(true)
  })
})
```

주의: 기존 `leaf` 픽스처의 기본 status는 `'in_progress'`, owners는 `[]`이다. 위 테스트 중 `dataHygiene` 첫 케이스처럼 owners 기본값에 의존하지 않도록 명시적으로 넘긴다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/dashboard.test.ts`
Expected: FAIL — `progressMatrix is not exported` (기존 테스트는 계속 PASS)

- [ ] **Step 3: 구현** — `src/lib/domain/dashboard.ts` **파일 끝에** 추가. 파일 상단 import에 `TeamCode`를 추가한다:

```ts
// 상단 import 수정: types에서 TeamCode 추가
import type { ComputedItem, TeamCode } from './types'
```

(기존 `import type { ComputedItem } from './types'` 줄을 위처럼 교체.)

```ts
/* ═══════════════ 본문 재구성(2026-07-09) 신규 모델 ═══════════════ */

/* ── Phase × 팀 진척 매트릭스 ── */
export interface MatrixCell { pct: number; planned: number; count: number }
export interface MatrixRow {
  id: string; name: string
  cells: (MatrixCell | null)[]
  overall: number; planned: number; variance: number
}

/** 셀 = 해당 팀이 담당(primary·support 모두)인 leaf들의 단순 평균. 무배정이면 null. */
export function progressMatrix(roots: ComputedItem[], teams: readonly TeamCode[]): MatrixRow[] {
  const avg = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) / ns.length)
  return roots.map(phase => {
    const leaves = collectLeaves([phase])
    const cells = teams.map(team => {
      const owned = leaves.filter(l => l.owners.some(o => o.team === team))
      if (!owned.length) return null
      return { pct: avg(owned.map(l => l.rolledActualPct)), planned: avg(owned.map(l => l.plannedPct)), count: owned.length }
    })
    return {
      id: phase.id, name: phase.name, cells,
      overall: phase.rolledActualPct, planned: phase.plannedPct,
      variance: phase.rolledActualPct - phase.plannedPct,
    }
  })
}

/* ── 편차 랭킹 — 뒤처졌지만 아직 마감 전(따라잡기 후보). 기한 경과분은 delayAging 전담.
 *    statusOf 상 actual<planned ⟺ delayed 이므로 분리 기준은 상태가 아니라 마감 경과 여부다. ── */
export interface VarianceEntry { item: ComputedItem; gapPp: number }

export function varianceRanking(leaves: ComputedItem[], today: string, limit = 8): VarianceEntry[] {
  return leaves
    .filter(l => l.status !== 'done' && (l.plannedEnd == null || l.plannedEnd >= today))
    .map(l => ({ item: l, gapPp: l.plannedPct - l.rolledActualPct }))
    .filter(e => e.gapPp > 0)
    .sort((a, b) => b.gapPp - a.gapPp || a.item.sortOrder - b.item.sortOrder)
    .slice(0, limit)
}

/* ── 마일스톤 타임라인 — 완료 포함 전체 여정(detectMilestones는 '다음 1개' 전용으로 유지) ── */
export type MilestoneStatus = 'done' | 'overdue' | 'upcoming'
export interface MilestonePoint { id: string; name: string; date: string; status: MilestoneStatus; dday: number }

export function milestoneTimeline(items: ComputedItem[], today: string): MilestonePoint[] {
  return collectLeaves(items)
    .filter(l => isMilestoneLeaf(l) && l.plannedEnd != null)
    .map(l => ({
      id: l.id, name: l.name, date: l.plannedEnd!,
      status: (l.status === 'done' ? 'done' : l.plannedEnd! < today ? 'overdue' : 'upcoming') as MilestoneStatus,
      dday: diffDaysCal(today, l.plannedEnd!),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/* ── 지연 에이징 — 기한(plannedEnd) 경과 미완료 작업. 경과일은 항상 ≥ 1. ── */
export interface AgingEntry { item: ComputedItem; overdue: number; gap: number }
export interface AgingModel { d1_7: number; d8_14: number; d15plus: number; total: number; list: AgingEntry[] }

export function delayAging(leaves: ComputedItem[], today: string, limit = 8): AgingModel {
  const entries = leaves
    .filter(l => l.status !== 'done' && l.plannedEnd != null && l.plannedEnd < today)
    .map(l => ({ item: l, overdue: diffDaysCal(l.plannedEnd!, today), gap: Math.max(0, l.plannedPct - l.rolledActualPct) }))
    .sort((a, b) => b.overdue - a.overdue || b.gap - a.gap)
  return {
    d1_7: entries.filter(e => e.overdue <= 7).length,
    d8_14: entries.filter(e => e.overdue >= 8 && e.overdue <= 14).length,
    d15plus: entries.filter(e => e.overdue >= 15).length,
    total: entries.length,
    list: entries.slice(0, limit),
  }
}

/* ── 데이터 위생 — 계획 데이터 품질(PMO 거버넌스) ── */
export interface HygieneModel { noOwner: number; noDates: number; mixedWeight: number; clean: boolean }

/** mixedWeight: 형제 그룹에서 weight가 일부만 null이면 카운트.
 *  루트 그룹은 null→유효가중 0(overallProgress eff), 자식 그룹은 null→1(siblingWeight)로
 *  형제와 다른 의도치 않은 가중이 걸리는 실제 버그 소지다. */
export function dataHygiene(items: ComputedItem[]): HygieneModel {
  const leaves = collectLeaves(items)
  const noOwner = leaves.filter(l => l.owners.length === 0).length
  const noDates = leaves.filter(l => l.plannedStart == null && l.plannedEnd == null).length
  let mixedWeight = 0
  const checkGroup = (group: ComputedItem[]) => {
    if (group.length >= 2 && group.some(g => g.weight == null) && group.some(g => g.weight != null)) mixedWeight++
  }
  checkGroup(items)
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => { if (n.children.length) { checkGroup(n.children); walk(n.children) } })
  walk(items)
  return { noOwner, noDates, mixedWeight, clean: noOwner === 0 && noDates === 0 && mixedWeight === 0 }
}
```

- [ ] **Step 4: 테스트 통과 + 회귀 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/dashboard.ts tests/domain/dashboard.test.ts
git commit -m "feat(domain): 매트릭스·편차랭킹·마일스톤 타임라인·에이징·데이터위생 모델

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: i18n 신규 키 (ko/en)

**Files:**
- Modify: `src/lib/i18n/dict/dashboard.ts`

**Interfaces:**
- Produces: 아래 `dash.trend.* / dash.spi.* / dash.matrix.* / dash.rank.* / dash.ms.* / dash.aging.* / dash.hygiene.*` 키 — Task 6~9의 컴포넌트가 `t(locale, key)`로 사용
- 주의: 기존 키 삭제는 이 태스크에서 하지 않는다(고아 확정은 Task 9에서).

- [ ] **Step 1: `dashboardKo` 객체 끝(`'dash.group.teamDeliv'` 줄 뒤, `} as const` 앞)에 추가**

```ts
  // ── 본문 재구성(2026-07-09): 트렌드/매트릭스/랭킹/타임라인/에이징/위생 ──
  'dash.trend.title': '진척 트렌드',
  'dash.trend.empty': '일정 정보가 없어 트렌드를 그릴 수 없습니다. 프로젝트 기간 또는 WBS 일정을 설정하세요.',
  'dash.trend.noHistory': '실적 이력은 지금부터 기록됩니다 — WBS 수정·대시보드 조회 시 자동 축적',
  'dash.spi.title': '속도 지표',
  'dash.spi.current': '현재 SPI',
  'dash.spi.velocity': '주간 증분',
  'dash.spi.varianceNow': '현재 편차',
  'dash.spi.hint': 'SPI = 실적÷계획 · 1.0 이상이면 계획보다 빠름',
  'dash.matrix.title': 'Phase × 팀 매트릭스',
  'dash.matrix.colPhase': 'Phase',
  'dash.matrix.colOverall': '전체',
  'dash.matrix.colVariance': '편차',
  'dash.rank.title': '따라잡기 후보 (마감 전 편차)',
  'dash.rank.empty': '마감 전인데 계획보다 뒤처진 작업이 없습니다.',
  'dash.ms.title': '마일스톤 타임라인',
  'dash.ms.empty': '감지된 마일스톤이 없습니다. 이름에 보고회·승인 등 키워드가 있거나 단일일+산출물 항목이 자동 감지됩니다.',
  'dash.ms.overdueBadge': '경과',
  'dash.aging.title': '기한 경과 에이징',
  'dash.aging.empty': '기한을 넘긴 미완료 작업이 없습니다.',
  'dash.aging.b1': '1~7일',
  'dash.aging.b2': '8~14일',
  'dash.aging.b3': '15일 이상',
  'dash.hygiene.title': '데이터 위생',
  'dash.hygiene.noOwner': '담당팀 누락',
  'dash.hygiene.noDates': '기간 미설정',
  'dash.hygiene.mixedWeight': '가중치 혼재',
  'dash.hygiene.clean': '계획 데이터 이상 없음',
  'dash.hygiene.goWbs': 'WBS에서 정리',
```

- [ ] **Step 2: `dashboardEn` 객체 끝(같은 위치 대응)에 추가**

```ts
  'dash.trend.title': 'Progress trend',
  'dash.trend.empty': 'No schedule to draw a trend. Set the project period or WBS dates.',
  'dash.trend.noHistory': 'Progress history starts recording now — captured on WBS edits and dashboard visits',
  'dash.spi.title': 'Velocity',
  'dash.spi.current': 'Current SPI',
  'dash.spi.velocity': 'Weekly gain',
  'dash.spi.varianceNow': 'Variance',
  'dash.spi.hint': 'SPI = actual ÷ planned · above 1.0 means ahead of plan',
  'dash.matrix.title': 'Phase × team matrix',
  'dash.matrix.colPhase': 'Phase',
  'dash.matrix.colOverall': 'Overall',
  'dash.matrix.colVariance': 'Variance',
  'dash.rank.title': 'Catch-up candidates (behind, not yet due)',
  'dash.rank.empty': 'No open tasks behind plan before their due date.',
  'dash.ms.title': 'Milestone timeline',
  'dash.ms.empty': 'No milestones detected. Items with report/approval keywords or single-day items with deliverables are detected automatically.',
  'dash.ms.overdueBadge': 'overdue',
  'dash.aging.title': 'Overdue aging',
  'dash.aging.empty': 'No unfinished tasks past their due date.',
  'dash.aging.b1': '1–7 days',
  'dash.aging.b2': '8–14 days',
  'dash.aging.b3': '15+ days',
  'dash.hygiene.title': 'Data hygiene',
  'dash.hygiene.noOwner': 'Missing owner team',
  'dash.hygiene.noDates': 'Missing dates',
  'dash.hygiene.mixedWeight': 'Mixed weights',
  'dash.hygiene.clean': 'Plan data looks clean',
  'dash.hygiene.goWbs': 'Fix in WBS',
```

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 에러 0 (en 키 누락 시 여기서 잡힘)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/i18n/dict/dashboard.ts
git commit -m "i18n(dashboard): 트렌드/매트릭스/랭킹/타임라인/에이징/위생 키 추가 (ko/en)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 스냅샷 데이터 계층 + 기록 훅

**Files:**
- Create: `src/lib/data/snapshots.ts`
- Modify: `src/app/actions/wbs.ts` (6개 액션에 훅)
- Modify: `src/app/actions/project.ts` (`addHoliday`, `removeHoliday`에 훅)
- Modify: `src/app/api/import/route.ts` (임포트 성공 후 기록)

**Interfaces:**
- Consumes: `SnapshotPoint` (Task 2), `computeTree`/`overallProgress`, `createServerClient`, 테이블 `wbs_progress_snapshots` (Task 1)
- Produces (Task 9의 page.tsx가 사용):
  - `async function getSnapshots(projectId: string): Promise<SnapshotPoint[]>`
  - `async function recordProgressSnapshot(projectId: string, client?: Awaited<ReturnType<typeof createServerClient>>): Promise<void>` — 오류를 삼키고 로그만 남김

- [ ] **Step 1: `src/lib/data/snapshots.ts` 작성**

```ts
import { createServerClient } from '@/lib/supabase/server'
import { computeTree, overallProgress } from '@/lib/domain/rollup'
import type { SnapshotPoint } from '@/lib/domain/trend'
import type { WbsRow } from '@/lib/domain/types'

type Sb = Awaited<ReturnType<typeof createServerClient>>

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 진척 스냅샷 조회(날짜 오름차순). numeric 컬럼은 문자열로 올 수 있어 Number 변환. */
export async function getSnapshots(projectId: string): Promise<SnapshotPoint[]> {
  const sb = await createServerClient()
  const { data } = await sb
    .from('wbs_progress_snapshots')
    .select('snap_date, actual_pct, planned_pct')
    .eq('project_id', projectId)
    .order('snap_date', { ascending: true })
  return (data ?? []).map((r: Record<string, unknown>) => ({
    date: r.snap_date as string,
    actual: Number(r.actual_pct),
    planned: Number(r.planned_pct),
  }))
}

/** 오늘(KST)의 전체 실적/계획%를 upsert. 본 작업을 실패시키지 않도록 오류는 삼키고 로그만 남긴다.
 *  실적 롤업은 날짜와 무관하고 계획%만 날짜 함수이므로, base_date와 무관하게 항상 실제 오늘로 계산한다.
 *  page 의 after() 안에서는 cookies() 호출이 불가 — 그 경로는 client 를 밖에서 만들어 넘긴다. */
export async function recordProgressSnapshot(projectId: string, client?: Sb): Promise<void> {
  try {
    const sb = client ?? (await createServerClient())
    const [{ data: items }, { data: hol }] = await Promise.all([
      sb.from('wbs_items')
        .select('id, parent_id, level, code, sort_order, name, planned_start, planned_end, weight, actual_pct')
        .eq('project_id', projectId),
      sb.from('holidays').select('date').eq('project_id', projectId),
    ])
    if (!items?.length) return
    const rows: WbsRow[] = items.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      parentId: (r.parent_id as string) ?? null,
      level: r.level as WbsRow['level'],
      code: r.code as string,
      sortOrder: r.sort_order as number,
      name: r.name as string,
      biz: null,
      deliverable: null,
      plannedStart: (r.planned_start as string) ?? null,
      plannedEnd: (r.planned_end as string) ?? null,
      weight: (r.weight as number) ?? null,
      actualPct: (r.actual_pct as number) ?? null,
      owners: [],
    }))
    const today = seoulToday()
    const holidays = new Set((hol ?? []).map((h: { date: string }) => h.date))
    const { actual, planned } = overallProgress(computeTree(rows, today, holidays))
    await sb.from('wbs_progress_snapshots').upsert(
      { project_id: projectId, snap_date: today, actual_pct: actual, planned_pct: planned, updated_at: new Date().toISOString() },
      { onConflict: 'project_id,snap_date' },
    )
  } catch (e) {
    console.error('[snapshot] 진척 스냅샷 기록 실패(무시):', e)
  }
}
```

- [ ] **Step 2: `src/app/actions/wbs.ts`에 훅 추가**

파일 상단 import에 두 줄 추가:

```ts
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
```

아래 6개 액션에서, 성공 경로의 `revalidatePath(...)` 직후에 한 줄씩 추가 (`after()`는 응답 후 실행이라 편집 지연 0):

| 액션 | 추가할 줄 |
|---|---|
| `updateActual` | `after(() => recordProgressSnapshot(item.project_id))` |
| `updateWeight` | `after(() => recordProgressSnapshot(item.project_id))` |
| `addWbsItem` | `after(() => recordProgressSnapshot(projectId))` |
| `addSubAct` | `after(() => recordProgressSnapshot(act.project_id))` |
| `updateWbsFields` | `after(() => recordProgressSnapshot(item.project_id))` |
| `deleteWbsItem` | `after(() => recordProgressSnapshot(item.project_id as string))` |

`moveWbsItem`은 제외 — sort_order만 바뀌어 진척값에 영향 없음. `getChangeLogs`는 조회라 제외.

예시 (`updateActual`의 끝부분):

```ts
  revalidatePath(`/p/${item.project_id}`, 'layout')
  after(() => recordProgressSnapshot(item.project_id))
  return { ok: true }
```

- [ ] **Step 3: `src/app/actions/project.ts`에 훅 추가**

상단 import에 동일한 두 줄 추가 후, 두 함수의 `revalidatePath` 직후에:

```ts
export async function addHoliday(projectId: string, date: string, name: string) {
  // ... 기존 코드 ...
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))   // 공휴일은 계획% 산정에 영향
}

export async function removeHoliday(projectId: string, date: string) {
  // ... 기존 코드 ...
  revalidatePath(`/p/${projectId}`, 'layout')
  after(() => recordProgressSnapshot(projectId))
}
```

`setBaseDate`는 제외 — 스냅샷은 base_date와 무관하게 실제 오늘로 계산하므로 저장값이 변하지 않는다.

- [ ] **Step 4: `src/app/api/import/route.ts`에 기록 추가**

상단 import에 `import { recordProgressSnapshot } from '@/lib/data/snapshots'` 추가. RPC 성공 확인(`if (error) return ...`) 직후에:

```ts
  // 임포트는 실적·계획 전면 교체 — 즉시 스냅샷 기록(라우트라 await로 충분).
  await recordProgressSnapshot(projectId)
```

- [ ] **Step 5: 검증 + 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

```bash
git add src/lib/data/snapshots.ts src/app/actions/wbs.ts src/app/actions/project.ts src/app/api/import/route.ts
git commit -m "feat(snapshots): 진척 스냅샷 기록 — WBS 변경/공휴일/임포트 시 after() upsert

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 공용 조각(bits) + TrendChart + SpiPanel

**Files:**
- Create: `src/components/dashboard/bits.tsx`
- Create: `src/components/dashboard/TrendChart.tsx`
- Create: `src/components/dashboard/SpiPanel.tsx`

**Interfaces:**
- Consumes: `TrendModel` (Task 2), `progressSignal`·`diffDaysCal` (`@/lib/domain/dashboard`), `SectionCard`, `fmtDate`, dict 키 (Task 4)
- Produces (Task 8, 9가 사용):
  - `bits.tsx`: `CountBadge({ n, unit, tone? })`, `MiniEmpty({ text })`, `Stat({ label, value, sub?, tone? })`
  - `TrendChart({ model: TrendModel; currentActual: number; today: string })` — async 서버 컴포넌트
  - `SpiPanel({ model: TrendModel; variance: number })` — async 서버 컴포넌트

- [ ] **Step 1: `src/components/dashboard/bits.tsx` 작성** (기존 DashboardView 로컬 헬퍼의 이동판 — Task 9에서 DashboardView 쪽 원본이 삭제된다. `Stat`에 `tone` 옵션만 추가)

```tsx
import type { ReactNode } from 'react'

/** 카드 우상단 건수 배지 */
export function CountBadge({ n, unit, tone = 'bg-brand-weak text-brand' }: { n: number; unit: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{n}{unit}</span>
}

/** 카드 내부 소형 빈 상태 */
export function MiniEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-center text-xs text-ink-subtle">
      {text}
    </div>
  )
}

/** 라벨+큰 숫자 스탯 타일. tone 으로 값 색상 오버라이드(예: text-done). */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums leading-none ${tone ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-muted">{sub}</div>}
    </div>
  )
}
```

- [ ] **Step 2: `src/components/dashboard/TrendChart.tsx` 작성**

```tsx
import { TrendingUp } from 'lucide-react'
import type { TrendModel, TrendPoint } from '@/lib/domain/trend'
import { diffDaysCal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { MiniEmpty } from './bits'

const W = 640, H = 240, PL = 34, PR = 12, PT = 12, PB = 26

/** S-Curve — 계획 누적곡선(점선) vs 실적 이력(실선) + 오늘 마커. 자체 SVG(의존성 0). */
export async function TrendChart({ model, currentActual, today }: {
  model: TrendModel; currentActual: number; today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (model.empty) {
    return (
      <SectionCard eyebrow="S-CURVE" title={tr('dash.trend.title')} icon={TrendingUp}>
        <MiniEmpty text={tr('dash.trend.empty')} />
      </SectionCard>
    )
  }

  const total = Math.max(1, diffDaysCal(model.axisStart, model.axisEnd))
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(model.axisStart, d))) / total) * (W - PL - PR)
  const y = (pct: number) => PT + (1 - pct / 100) * (H - PT - PB)
  const pts = (s: TrendPoint[]) => s.map(p => `${x(p.date).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const todayIn = today >= model.axisStart && today <= model.axisEnd

  const legend = (
    <div className="flex items-center gap-3 text-[10px] text-ink-subtle">
      <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-full bg-brand" />{tr('dash.actualLabel')}</span>
      <span className="inline-flex items-center gap-1"><span className="h-0 w-4 border-t-2 border-dashed border-ink-muted" />{tr('dash.plannedLabel')}</span>
    </div>
  )

  return (
    <SectionCard eyebrow="S-CURVE" title={tr('dash.trend.title')} icon={TrendingUp} actions={legend}>
      <div className="space-y-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr('dash.trend.title')}>
          {[0, 25, 50, 75, 100].map(g => (
            <g key={g}>
              <line x1={PL} x2={W - PR} y1={y(g)} y2={y(g)} className="stroke-line" strokeWidth={1} />
              <text x={PL - 6} y={y(g) + 3} textAnchor="end" fontSize={9} className="fill-ink-subtle">{g}</text>
            </g>
          ))}
          {todayIn && (
            <line x1={x(today)} x2={x(today)} y1={PT} y2={H - PB} className="stroke-ink-subtle" strokeWidth={1} strokeDasharray="2 3" />
          )}
          <polyline points={pts(model.plannedSeries)} fill="none" className="stroke-ink-muted" strokeWidth={1.5} strokeDasharray="4 4" />
          {model.actualSeries.length > 1 && (
            <polyline points={pts(model.actualSeries)} fill="none" className="stroke-brand" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {model.actualSeries.length === 1 && (
            <circle cx={x(model.actualSeries[0].date)} cy={y(model.actualSeries[0].pct)} r={4} className="fill-brand" />
          )}
          {!model.hasHistory && todayIn && <circle cx={x(today)} cy={y(currentActual)} r={4} className="fill-brand" />}
          <text x={PL} y={H - 8} fontSize={9} className="fill-ink-subtle">{fmtDate(model.axisStart)}</text>
          <text x={W - PR} y={H - 8} textAnchor="end" fontSize={9} className="fill-ink-subtle">{fmtDate(model.axisEnd)}</text>
        </svg>
        {!model.hasHistory && <div className="text-[11px] text-ink-subtle">{tr('dash.trend.noHistory')}</div>}
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 3: `src/components/dashboard/SpiPanel.tsx` 작성**

```tsx
import { Gauge } from 'lucide-react'
import type { TrendModel } from '@/lib/domain/trend'
import { progressSignal, type Signal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { Stat } from './bits'

const SIG_TONE: Record<Signal, string> = {
  green: 'text-done', amber: 'text-accent-warning', red: 'text-delayed', neutral: 'text-ink',
}

/** SPI 스파크라인 + 현재 SPI · 주간 증분 · 현재 편차 스탯. */
export async function SpiPanel({ model, variance }: { model: TrendModel; variance: number }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const fmtPp = (n: number) => `${n >= 0 ? '+' : ''}${n}%p`

  const spi = model.currentSpi
  const spiTone = spi == null ? 'text-ink' : spi >= 0.98 ? 'text-done' : spi >= 0.9 ? 'text-accent-warning' : 'text-delayed'
  const v = model.velocityWeek
  const vTone = v == null || v === 0 ? 'text-ink' : v > 0 ? 'text-done' : 'text-delayed'

  // 스파크라인 — SPI 0.5~1.5 클램프, 1.0 기준선
  const s = model.spiSeries
  const spark = s.length >= 2 ? (() => {
    const sx = (i: number) => 4 + (i / (s.length - 1)) * 192
    const sy = (val: number) => 4 + (1 - (Math.min(1.5, Math.max(0.5, val)) - 0.5)) * 40
    return (
      <svg viewBox="0 0 200 48" className="h-12 w-full" aria-hidden>
        <line x1={4} x2={196} y1={sy(1)} y2={sy(1)} className="stroke-line" strokeWidth={1} strokeDasharray="3 3" />
        <polyline
          points={s.map((p, i) => `${sx(i).toFixed(1)},${sy(p.spi).toFixed(1)}`).join(' ')}
          fill="none" className="stroke-brand" strokeWidth={2} strokeLinecap="round"
        />
      </svg>
    )
  })() : (
    <div className="flex h-12 items-center justify-center rounded-xl bg-surface-2/40 text-[11px] text-ink-subtle">—</div>
  )

  return (
    <SectionCard eyebrow="VELOCITY" title={tr('dash.spi.title')} icon={Gauge}>
      <div className="space-y-4">
        {spark}
        <div className="grid grid-cols-3 gap-3">
          <Stat label={tr('dash.spi.current')} value={spi == null ? '—' : spi.toFixed(2)} tone={spiTone} />
          <Stat label={tr('dash.spi.velocity')} value={v == null ? '—' : fmtPp(v)} tone={vTone} />
          <Stat label={tr('dash.spi.varianceNow')} value={fmtPp(variance)} tone={SIG_TONE[progressSignal(variance)]} />
        </div>
        <div className="text-[11px] text-ink-subtle">{tr('dash.spi.hint')}</div>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 4: 검증 + 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0 (아직 어디서도 사용되지 않지만 단독 컴파일 통과)

```bash
git add src/components/dashboard/bits.tsx src/components/dashboard/TrendChart.tsx src/components/dashboard/SpiPanel.tsx
git commit -m "feat(dashboard): TrendChart(S-Curve)·SpiPanel 서버 컴포넌트 + 공용 bits

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: ProgressMatrix + VarianceRanking

**Files:**
- Create: `src/components/dashboard/ProgressMatrix.tsx`
- Create: `src/components/dashboard/VarianceRanking.tsx`

**Interfaces:**
- Consumes: `MatrixRow`·`VarianceEntry`·`progressSignal` (Task 3), `TEAM`·`OwnerBadges`·`fmtDate` (`@/components/wbs/shared`), `ProgressBar`, bits (Task 6)
- Produces (Task 9가 사용): `ProgressMatrix({ rows: MatrixRow[]; teams: readonly TeamCode[] })`, `VarianceRanking({ entries: VarianceEntry[] })` — 둘 다 async 서버 컴포넌트

- [ ] **Step 1: `src/components/dashboard/ProgressMatrix.tsx` 작성**

```tsx
import { LayoutGrid } from 'lucide-react'
import type { MatrixRow } from '@/lib/domain/dashboard'
import { progressSignal, type Signal } from '@/lib/domain/dashboard'
import type { TeamCode } from '@/lib/domain/types'
import { SectionCard } from '@/components/ui/SectionCard'
import { TEAM } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

const SIG_CELL: Record<Signal, string> = {
  green: 'bg-done-weak text-done',
  amber: 'bg-pending-weak text-accent-warning',
  red: 'bg-delayed-weak text-delayed',
  neutral: 'bg-surface-2 text-ink-muted',
}
const SIG_TEXT: Record<Signal, string> = {
  green: 'text-done', amber: 'text-accent-warning', red: 'text-delayed', neutral: 'text-ink',
}

/** Phase(행) × 팀(열) 진척 히트맵. 셀 틴트 = 편차 신호(progressSignal), 숫자 병기(색맹 대비). */
export async function ProgressMatrix({ rows, teams }: { rows: MatrixRow[]; teams: readonly TeamCode[] }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const fmtPp = (n: number) => `${n >= 0 ? '+' : ''}${n}%p`

  return (
    <SectionCard eyebrow="PHASE × TEAM" title={tr('dash.matrix.title')} icon={LayoutGrid}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-ink-subtle">
              <th className="pb-2 pr-3 text-left font-semibold">{tr('dash.matrix.colPhase')}</th>
              {teams.map(team => (
                <th key={team} className="px-2 pb-2 text-center font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${TEAM[team].bar}`} />{team}
                  </span>
                </th>
              ))}
              <th className="px-2 pb-2 text-right font-semibold">{tr('dash.matrix.colOverall')}</th>
              <th className="pb-2 pl-2 text-right font-semibold">{tr('dash.matrix.colVariance')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="max-w-40 truncate py-2.5 pr-3 font-medium text-ink" title={r.name}>{r.name}</td>
                {r.cells.map((c, i) => (
                  <td key={teams[i]} className="px-2 py-2.5 text-center">
                    {c == null ? <span className="text-ink-subtle">—</span> : (
                      <span
                        className={`inline-flex min-w-12 justify-center rounded-lg px-2 py-1 font-semibold tabular-nums ${SIG_CELL[progressSignal(c.pct - c.planned)]}`}
                        title={`${c.count}${tr('dash.unitCount')}`}
                      >
                        {c.pct}%
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">{r.overall}%</td>
                <td className={`py-2.5 pl-2 text-right font-semibold tabular-nums ${SIG_TEXT[progressSignal(r.variance)]}`}>{fmtPp(r.variance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 2: `src/components/dashboard/VarianceRanking.tsx` 작성**

```tsx
import { TrendingDown } from 'lucide-react'
import type { VarianceEntry } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty } from './bits'

/** 마감 전인데 계획보다 뒤처진 작업 Top N — 기한 경과분은 DelayAging 전담(상호 배타). */
export async function VarianceRanking({ entries }: { entries: VarianceEntry[] }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  return (
    <SectionCard
      eyebrow="CATCH-UP" title={tr('dash.rank.title')} icon={TrendingDown}
      actions={<CountBadge n={entries.length} unit={tr('dash.unitCount')} tone="bg-pending-weak text-accent-warning" />}
    >
      {entries.length === 0 ? (
        <MiniEmpty text={tr('dash.rank.empty')} />
      ) : (
        <ul className="divide-y divide-line">
          {entries.map(({ item, gapPp }) => (
            <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</div>
                <div className="mt-1"><OwnerBadges owners={item.owners} /></div>
              </div>
              <div className="hidden w-36 shrink-0 sm:block">
                <ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" />
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="tabular-nums text-xs text-ink-muted">{fmtDate(item.plannedEnd)}</div>
                <div className="mt-0.5 inline-flex rounded-md bg-pending-weak px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent-warning">
                  −{gapPp}%p
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
```

- [ ] **Step 3: 검증 + 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

```bash
git add src/components/dashboard/ProgressMatrix.tsx src/components/dashboard/VarianceRanking.tsx
git commit -m "feat(dashboard): Phase×팀 매트릭스 + 따라잡기 편차 랭킹 컴포넌트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: MilestoneTimeline + DelayAging + DataHygiene

**Files:**
- Create: `src/components/dashboard/MilestoneTimeline.tsx`
- Create: `src/components/dashboard/DelayAging.tsx`
- Create: `src/components/dashboard/DataHygiene.tsx`

**Interfaces:**
- Consumes: `MilestonePoint`·`AgingModel`·`HygieneModel`·`diffDaysCal`·`addDaysCal` (Task 3/기존), bits (Task 6), `OwnerBadges`·`fmtDate`, `ProgressBar`
- Produces (Task 9가 사용): `MilestoneTimeline({ points, startDate, endDate, today })`, `DelayAging({ aging })`, `DataHygiene({ hygiene, projectId })` — 전부 async 서버 컴포넌트

- [ ] **Step 1: `src/components/dashboard/MilestoneTimeline.tsx` 작성**

```tsx
import { Flag } from 'lucide-react'
import type { MilestonePoint, MilestoneStatus } from '@/lib/domain/dashboard'
import { diffDaysCal, addDaysCal } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty } from './bits'

const MS_TONE: Record<MilestoneStatus, string> = { done: 'fill-done', overdue: 'fill-delayed', upcoming: 'fill-brand' }
const W = 960, H = 124, PL = 24, PR = 24, BASE = 64

/** 프로젝트 시간축 위 마일스톤 여정 — 완료/기한경과/예정을 한 줄에. 라벨은 위/아래 교차 배치. */
export async function MilestoneTimeline({ points, startDate, endDate, today }: {
  points: MilestonePoint[]; startDate: string | null; endDate: string | null; today: string
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (points.length === 0) {
    return (
      <SectionCard eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}>
        <MiniEmpty text={tr('dash.ms.empty')} />
      </SectionCard>
    )
  }

  let axisStart = startDate ?? points[0].date
  let axisEnd = endDate ?? points[points.length - 1].date
  if (axisStart >= axisEnd) { axisStart = addDaysCal(axisStart, -14); axisEnd = addDaysCal(axisEnd, 14) }
  const total = diffDaysCal(axisStart, axisEnd)
  const x = (d: string) => PL + (Math.min(total, Math.max(0, diffDaysCal(axisStart, d))) / total) * (W - PL - PR)
  const trunc = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const todayIn = today >= axisStart && today <= axisEnd

  return (
    <SectionCard
      eyebrow="MILESTONES" title={tr('dash.ms.title')} icon={Flag}
      actions={<CountBadge n={points.length} unit={tr('dash.unitCount')} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={tr('dash.ms.title')}>
        <line x1={PL} x2={W - PR} y1={BASE} y2={BASE} className="stroke-line" strokeWidth={2} />
        {todayIn && (
          <g>
            <line x1={x(today)} x2={x(today)} y1={30} y2={100} className="stroke-ink-subtle" strokeWidth={1} strokeDasharray="2 3" />
            <text x={x(today)} y={20} textAnchor="middle" fontSize={9} className="fill-ink-subtle">{fmtDate(today)}</text>
          </g>
        )}
        {points.map((p, i) => {
          const above = i % 2 === 0
          const nameY = above ? BASE - 28 : BASE + 24
          const dateY = above ? BASE - 16 : BASE + 36
          const sub =
            p.status === 'upcoming' ? `${fmtDate(p.date)} · D-${p.dday}`
            : p.status === 'overdue' ? `${fmtDate(p.date)} · ${tr('dash.ms.overdueBadge')}`
            : fmtDate(p.date)
          return (
            <g key={p.id}>
              <circle cx={x(p.date)} cy={BASE} r={5} className={MS_TONE[p.status]}>
                <title>{`${p.name} · ${fmtDate(p.date)}`}</title>
              </circle>
              <text x={x(p.date)} y={nameY} textAnchor="middle" fontSize={10} className="fill-ink font-medium">{trunc(p.name)}</text>
              <text x={x(p.date)} y={dateY} textAnchor="middle" fontSize={9}
                className={p.status === 'overdue' ? 'fill-delayed' : 'fill-ink-subtle'}>
                {sub}
              </text>
            </g>
          )
        })}
      </svg>
    </SectionCard>
  )
}
```

- [ ] **Step 2: `src/components/dashboard/DelayAging.tsx` 작성**

```tsx
import { AlertTriangle } from 'lucide-react'
import type { AgingModel } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, fmtDate } from '@/components/wbs/shared'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { CountBadge, MiniEmpty, Stat } from './bits'

/** 기한(plannedEnd) 경과 미완료 작업 — 경과일 버킷 + Top 리스트(기존 ATTENTION 흡수). */
export async function DelayAging({ aging }: { aging: AgingModel }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  return (
    <SectionCard
      eyebrow="OVERDUE AGING" title={tr('dash.aging.title')} icon={AlertTriangle}
      actions={<CountBadge n={aging.total} unit={tr('dash.unitCount')} tone="bg-delayed-weak text-delayed" />}
    >
      {aging.total === 0 ? (
        <MiniEmpty text={tr('dash.aging.empty')} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={tr('dash.aging.b1')} value={`${aging.d1_7}${tr('dash.unitCount')}`} />
            <Stat label={tr('dash.aging.b2')} value={`${aging.d8_14}${tr('dash.unitCount')}`}
              tone={aging.d8_14 > 0 ? 'text-accent-warning' : undefined} />
            <Stat label={tr('dash.aging.b3')} value={`${aging.d15plus}${tr('dash.unitCount')}`}
              tone={aging.d15plus > 0 ? 'text-delayed' : undefined} />
          </div>
          <ul className="divide-y divide-line">
            {aging.list.map(({ item, overdue }) => (
              <li key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink" title={item.name}>{item.name}</div>
                  <div className="mt-1"><OwnerBadges owners={item.owners} /></div>
                </div>
                <div className="hidden w-36 shrink-0 sm:block">
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><ProgressBar value={item.rolledActualPct} planned={item.plannedPct} height="h-1.5" tone="bg-delayed" /></div>
                    <span className="shrink-0 tabular-nums text-[11px] font-semibold text-delayed">{item.rolledActualPct}%</span>
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div className="tabular-nums text-xs text-ink-muted">{fmtDate(item.plannedEnd)}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-delayed">
                    <span className="h-1.5 w-1.5 rounded-full bg-delayed" />{overdue}{tr('dash.overdueSuffix')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}
```

- [ ] **Step 3: `src/components/dashboard/DataHygiene.tsx` 작성**

```tsx
import Link from 'next/link'
import { ClipboardCheck, CheckCircle2, ArrowRight } from 'lucide-react'
import type { HygieneModel } from '@/lib/domain/dashboard'
import { SectionCard } from '@/components/ui/SectionCard'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

/** 계획 데이터 품질 — 담당 누락/기간 미설정/가중치 혼재. 전부 0이면 확인 상태. */
export async function DataHygiene({ hygiene, projectId }: { hygiene: HygieneModel; projectId: string }) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)
  const rows: { key: DictKey; n: number }[] = [
    { key: 'dash.hygiene.noOwner', n: hygiene.noOwner },
    { key: 'dash.hygiene.noDates', n: hygiene.noDates },
    { key: 'dash.hygiene.mixedWeight', n: hygiene.mixedWeight },
  ]

  return (
    <SectionCard eyebrow="DATA QUALITY" title={tr('dash.hygiene.title')} icon={ClipboardCheck}>
      {hygiene.clean ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-done-weak/40 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-done" />
          <div className="text-[13px] font-medium text-done">{tr('dash.hygiene.clean')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {rows.map(r => (
              <li key={r.key} className="flex items-center justify-between rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                <span className="text-[13px] font-medium text-ink">{tr(r.key)}</span>
                <span className={`badge ${r.n > 0 ? 'bg-delayed-weak text-delayed' : 'bg-surface-2 text-ink-subtle'}`}>
                  {r.n}{tr('dash.unitCount')}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/p/${projectId}/wbs`} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:underline">
            {tr('dash.hygiene.goWbs')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </SectionCard>
  )
}
```

- [ ] **Step 4: 검증 + 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0

```bash
git add src/components/dashboard/MilestoneTimeline.tsx src/components/dashboard/DelayAging.tsx src/components/dashboard/DataHygiene.tsx
git commit -m "feat(dashboard): 마일스톤 타임라인·기한경과 에이징·데이터 위생 컴포넌트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: DashboardView 재작성 + page.tsx + 구자산 정리

**Files:**
- Modify: `src/components/dashboard/DashboardView.tsx` (전면 재작성)
- Modify: `src/app/(app)/p/[projectId]/dashboard/page.tsx`
- Delete: `src/components/dashboard/DetailAccordion.tsx`
- Modify: `src/lib/i18n/dict/dashboard.ts` (고아 키 제거)

**Interfaces:**
- Consumes: Task 2~8의 모든 산출물
- Produces: 새 `DashboardView` props — `{ items, projectId, projectName, projectDescription?, startDate?, endDate?, today?, holidays?, snapshots?, announcements? }` (attendance/memberCount/initialExpanded **제거**)

- [ ] **Step 1: `DashboardView.tsx` 전면 재작성** (파일 전체를 아래 내용으로 교체)

```tsx
import { BarChart3 } from 'lucide-react'
import type { Announcement, ComputedItem, TeamCode } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import { buildTrend } from '@/lib/domain/trend'
import { progressMatrix, varianceRanking, milestoneTimeline, delayAging, dataHygiene } from '@/lib/domain/dashboard'
import { overallProgress } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import { EmptyState } from '@/components/ui/EmptyState'
import { t, type DictKey } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ExecSummary } from './ExecSummary'
import { TrendChart } from './TrendChart'
import { SpiPanel } from './SpiPanel'
import { ProgressMatrix } from './ProgressMatrix'
import { VarianceRanking } from './VarianceRanking'
import { MilestoneTimeline } from './MilestoneTimeline'
import { DelayAging } from './DelayAging'
import { DataHygiene } from './DataHygiene'

const TEAMS: readonly TeamCode[] = ['PMO', 'ERP', 'MES', '가공']

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

/** 경영진/PMO 대시보드 — ExecSummary 아래를 트렌드·매트릭스·랭킹·타임라인·에이징·위생으로 구성.
 *  모든 집계는 도메인 함수가 담당하고 여기서는 조립만 한다. */
export async function DashboardView({
  items,
  projectId,
  projectName,
  projectDescription = null,
  startDate = null,
  endDate = null,
  today = seoulToday(),
  holidays = [],
  snapshots = [],
  announcements = [],
}: {
  items: ComputedItem[]
  projectId: string
  projectName: string
  projectDescription?: string | null
  startDate?: string | null
  endDate?: string | null
  today?: string
  holidays?: string[]
  snapshots?: SnapshotPoint[]
  announcements?: Announcement[]
}) {
  const locale = await getServerLocale()
  const tr = (k: DictKey) => t(locale, k)

  if (items.length === 0) {
    return <EmptyState icon={BarChart3} title={tr('dash.emptyTitle')} description={tr('dash.emptyDesc')} />
  }

  const leaves = collectLeaves(items)
  const { actual, planned } = overallProgress(items)
  const trend = buildTrend({ items, snapshots, holidays: new Set(holidays), startDate, endDate, today })
  const matrix = progressMatrix(items, TEAMS)
  const ranking = varianceRanking(leaves, today)
  const milestones = milestoneTimeline(items, today)
  const aging = delayAging(leaves, today)
  const hygiene = dataHygiene(items)

  return (
    <div className="space-y-5">
      {/* A. 경영진 요약 — 게이지 + 신호등 3 + 공지 + 리포트 (현행 유지) */}
      <ExecSummary
        items={items} projectId={projectId} projectName={projectName}
        projectDescription={projectDescription} startDate={startDate} endDate={endDate}
        today={today} announcements={announcements}
      />

      {/* B. 진척 트렌드 — S-Curve + SPI/velocity */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TrendChart model={trend} currentActual={actual} today={today} />
        <SpiPanel model={trend} variance={actual - planned} />
      </div>

      {/* C. 병목 식별 — Phase×팀 매트릭스 + 따라잡기 랭킹 */}
      <div className="grid gap-5 xl:grid-cols-2">
        <ProgressMatrix rows={matrix} teams={TEAMS} />
        <VarianceRanking entries={ranking} />
      </div>

      {/* D. 마일스톤 여정 */}
      <MilestoneTimeline points={milestones} startDate={startDate} endDate={endDate} today={today} />

      {/* E. 기한 경과 + 계획 데이터 품질 */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <DelayAging aging={aging} />
        <DataHygiene hygiene={hygiene} projectId={projectId} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `page.tsx` 교체** (파일 전체를 아래 내용으로 교체)

```tsx
import { after } from 'next/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getSnapshots, recordProgressSnapshot } from '@/lib/data/snapshots'
import { getAnnouncements } from '@/lib/data/announcements'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero } from '@/components/ui/PageHero'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

export default async function Dashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const locale = await getServerLocale()
  const [{ items, holidays, today }, projects, announcements, snapshots, sb] = await Promise.all([
    getComputedWbs(projectId),
    listProjects(),
    getAnnouncements(projectId),
    getSnapshots(projectId),
    createServerClient(),
  ])
  // 보험 스냅샷 — 응답 전송 후 실행. 페이지의 after() 안에서는 cookies() 호출이 불가하므로
  // supabase 클라이언트를 미리 만들어 넘긴다(서버 액션 훅과 달리 이 경로만 client 인자 사용).
  after(() => recordProgressSnapshot(projectId, sb))

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
        holidays={holidays}
        snapshots={snapshots}
        announcements={announcements}
      />
    </ProjectPageShell>
  )
}
```

- [ ] **Step 3: DetailAccordion 삭제**

```bash
grep -rn "DetailAccordion" src/   # DashboardView 재작성 후 사용처 0 확인
git rm src/components/dashboard/DetailAccordion.tsx
```

`UiPrefs.dashSections` 타입 필드와 preferences 액션은 손대지 않는다(무해, 정리 범위 밖).

- [ ] **Step 4: 고아 dict 키 제거**

아래 후보 각각에 대해 `grep -rn "<키>" src/`로 사용처 0을 **확인한 뒤** `dashboardKo`와 `dashboardEn` 양쪽에서 제거한다 (하나라도 사용처가 남아 있으면 그 키는 유지):

`dash.kpi.delayed`, `dash.unitTasks`, `dash.statusMix.title`, `dash.teamLoad.title`, `dash.noAssignment`, `dash.phase.title`, `dash.weight.title`, `dash.delayed.empty`, `dash.thisWeek.title`, `dash.thisWeek.empty`, `dash.nextWeek.title`, `dash.nextWeek.empty`, `dash.recentDone.title`, `dash.recentDone.empty`, `dash.att.*`(13개 전부), `dash.dueSoon.title`, `dash.dueSoon.empty`, `dash.deliv.*`(6개), `dash.group.analysis`, `dash.group.scheduleRisk`, `dash.group.teamDeliv`

**유지 확정**: `dash.overdueSuffix`(DelayAging 사용), `dash.gapLabel`은 사용처가 없어지면 제거, `dash.actualLabel`/`dash.plannedLabel`(TrendChart 범례), `dash.exec.*` 전부(ExecSummary), `dash.unitCount`, `dash.unitDays`, `dash.emptyTitle/Desc`, `dash.hero*`.

- [ ] **Step 5: 전체 검증**

Run: `npm run lint && npm test && npm run build`
Expected: 전부 통과. build에서 dict 키 누락·컴포넌트 타입 불일치가 최종 검증된다.

- [ ] **Step 6: 커밋**

```bash
git add src/components/dashboard/DashboardView.tsx "src/app/(app)/p/[projectId]/dashboard/page.tsx" src/lib/i18n/dict/dashboard.ts
git commit -m "feat(dashboard): 본문 완전 교체 — 트렌드/매트릭스/랭킹/타임라인/에이징/위생

- ExecSummary 유지, 그 아래 전 섹션 교체
- DetailAccordion 및 구 카드(상태분포·가중치·주간·팀부하·산출물·근태) 제거
- page.tsx: 스냅샷 조회 + after() 보험 기록, 불용 fetch(멤버·근태·prefs) 제거
- 고아 i18n 키 정리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(`git rm`한 DetailAccordion.tsx는 이미 스테이징돼 있으므로 함께 커밋된다.)

---

### Task 10: 전체 검증 + 배포 게이트

**Files:** (코드 변경 없음)

- [ ] **Step 1: 최종 회귀 확인**

Run: `npm run lint && npm test && npm run build`
Expected: 전부 통과

- [ ] **Step 2: 수동 스모크 (환경상 브라우저 접근 불가 — 빌드 산출 확인으로 갈음)**

- `npm run build` 출력에서 `/p/[projectId]/dashboard` 라우트가 에러 없이 빌드되는지 확인.
- `grep -rn "attendance\|memberCount\|initialExpanded" src/components/dashboard/ src/app/\(app\)/p/` → 대시보드 경로에 잔재 0 확인.

- [ ] **Step 3: 배포 (사용자 확인 후 진행)**

**중요: 이 단계는 사용자에게 배포 여부를 확인받은 뒤 실행한다.**

1. **프로덕션 마이그레이션**: `0020_progress_snapshots.sql`을 Supabase Management API로 적용 — 메모리 `rls-helper-drift.md`의 레시피(키체인 토큰 + `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`) 사용. 적용 후 `select * from pg_policies where tablename = 'wbs_progress_snapshots'`로 정책 2개 확인.
2. **푸시/배포**: `deploy` 스킬 플로우(커밋 → main 푸시 → Vercel 상태 확인). 마이그레이션을 **먼저** 적용한 뒤 푸시한다(새 코드가 테이블 없이 뜨면 스냅샷 기록이 전부 로그 에러로 빠짐 — 대시보드는 정상 렌더되지만 이력이 쌓이지 않음).
3. **배포 후 확인**: 프로덕션 대시보드 1회 조회 → `select * from wbs_progress_snapshots order by snap_date desc limit 3`으로 첫 스냅샷 생성 확인.

---

## Self-Review 결과 (계획 작성 후 점검)

1. **스펙 커버리지**: §3 화면(B~E) → Task 6~9 / §4 테이블 → Task 1 / §5 기록 경로(액션·공휴일·임포트·조회) → Task 5, 9 / §6 도메인 → Task 2~3 / §7 컴포넌트 → Task 6~8 / §8 변경 지점(고아 키·DetailAccordion·page props) → Task 9 / §9 엣지 → Task 2~3 테스트 + 컴포넌트 빈 상태 / §10 테스트 → Task 2~3 / §11 배포 → Task 10. 누락 없음.
2. **타입 일관성**: `SnapshotPoint`/`TrendModel`(Task 2) ↔ `getSnapshots`(Task 5) ↔ `TrendChart`/`SpiPanel`(Task 6) ↔ `DashboardView`(Task 9), `MatrixRow`/`VarianceEntry`/`MilestonePoint`/`AgingModel`/`HygieneModel`(Task 3) ↔ Task 7~9 — 서명 일치 확인함.
3. **주의점 재확인**: `after()` 내 `cookies()` 제약 → page 경로만 client 인자 전달로 회피(Task 5·9에 명시). `moveWbsItem`/`setBaseDate` 훅 제외 사유 명시. 고아 키 제거는 grep 확인 후에만.
