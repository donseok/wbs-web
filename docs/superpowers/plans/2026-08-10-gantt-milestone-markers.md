# 간트 마일스톤 기준선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 간트 타임라인에 마일스톤 날짜마다 상태색 점선 세로 기준선 + 라벨 칩을 그리고, 툴바 토글과 범례를 붙인다.

**Architecture:** 대시보드가 쓰는 순수 함수 `milestoneTimeline()`(판정·정렬)을 간트 컴포넌트에서 재사용하고, 신규 순수 로직(같은 날짜 병합 + 2단 교차 배치)만 `ganttScale.ts`에 추가한다. 렌더링은 기존 '오늘' 세로선 오버레이 패턴을 복제한다. 신규 페치·마이그레이션 없음.

**Tech Stack:** Next.js 15 App Router, Tailwind v4 토큰 유틸(`bg-done` 등 자동 생성), vitest.

**Spec:** `docs/superpowers/specs/2026-08-10-gantt-milestone-markers-design.md`

## Global Constraints

- `git add -A` 금지 — 항상 파일명 명시 (병렬 세션 dirty 파일 오염 방지)
- 커밋 메시지는 한국어, "무엇"보다 "왜". 마이그레이션 없음(코드만)이라 G1 무관
- `globals.css` 수정 금지. 상태 변형 display 유틸(`group-hover:flex`, `print:hidden`, `data-[...]:hidden` 등) 사용 금지 — unlayered 안전망에 져서 조용히 죽고 `tests/css/breakpoint-safety-net.test.ts`가 CI 실패시킴. 표시/숨김은 JSX 조건부 렌더링만
- 오버레이 높이·가로 위치는 기존 `rowsH`·`LEFT_W`·`ganttW` 변수 재사용 — 하드코딩 시 과거 '오늘선 끊김' 버그 재발
- `milestoneKeywords`가 빈 배열이면 마커 0건이 정답 — 폴백 키워드 주입 금지 (설정 부재를 드러내는 기존 계약)
- i18n: `src/lib/i18n/dict/wbs.ts`의 en은 `Record<keyof ko, string>` — ko에 키를 추가하면 en에도 반드시 추가 (컴파일 타임 강제)
- 로컬 `npm run build`는 `_workspace` 스크래치 ts 때문에 실패할 수 있음 — 빌드 검증이 필요하면 `verify` 스킬의 `*.buildskip` 개명 절차를 따를 것. 평시 검증은 `npm run lint && npm run test`

---

### Task 1: 도메인 순수 함수 `groupGanttMilestones` (TDD)

**Files:**
- Modify: `src/lib/domain/ganttScale.ts` (파일 끝에 추가)
- Test: `tests/domain/ganttScale.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: `MilestonePoint`, `MilestoneStatus` — `src/lib/domain/dashboard.ts:221-222`에 이미 존재
  (`MilestonePoint = { id: string; name: string; date: string; status: 'done'|'overdue'|'upcoming'; dday: number }`)
- Produces: Task 2가 사용하는 아래 시그니처
  ```ts
  export interface GanttMilestoneMarker {
    date: string            // ISO, 그룹 대표 날짜
    status: MilestoneStatus // 대표 상태: overdue > upcoming > done 우선
    names: string[]         // 같은 날짜 마일스톤 이름 전부 (입력 순서 유지)
    dday: number            // 같은 날짜라 그룹 내 동일
    tier: 0 | 1             // 라벨 칩 상/하 2단 교차 배치 (마커 인덱스 % 2)
  }
  export function groupGanttMilestones(points: readonly MilestonePoint[]): GanttMilestoneMarker[]
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/ganttScale.test.ts` 끝에 추가 (기존 import 라인에 `groupGanttMilestones` 추가):

```ts
import { buildGanttScale, centeredTimelineScrollLeft, collectPlannedDates, groupGanttMilestones } from '@/lib/domain/ganttScale'
```

```ts
describe('groupGanttMilestones', () => {
  const p = (id: string, name: string, date: string, status: 'done' | 'overdue' | 'upcoming', dday: number) =>
    ({ id, name, date, status, dday })

  it('빈 입력은 빈 배열', () => {
    expect(groupGanttMilestones([])).toEqual([])
  })

  it('같은 날짜는 마커 1개로 병합하고 이름을 입력 순서대로 모은다', () => {
    const out = groupGanttMilestones([
      p('a', '분석 완료', '2026-08-01', 'done', -9),
      p('b', '설계 승인', '2026-08-01', 'done', -9),
      p('c', '개발 착수', '2026-08-20', 'upcoming', 10),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].names).toEqual(['분석 완료', '설계 승인'])
    expect(out[0].dday).toBe(-9)
    expect(out[1].names).toEqual(['개발 착수'])
  })

  it('대표 상태는 overdue > upcoming > done 우선', () => {
    const mixed = groupGanttMilestones([
      p('a', 'A', '2026-08-01', 'done', 0),
      p('b', 'B', '2026-08-01', 'overdue', 0),
      p('c', 'C', '2026-08-01', 'upcoming', 0),
    ])
    expect(mixed[0].status).toBe('overdue')
    const noOverdue = groupGanttMilestones([
      p('a', 'A', '2026-08-01', 'done', 0),
      p('c', 'C', '2026-08-01', 'upcoming', 0),
    ])
    expect(noOverdue[0].status).toBe('upcoming')
  })

  it('마커는 날짜 오름차순 정렬, tier는 0/1 교차', () => {
    const out = groupGanttMilestones([
      p('c', 'C', '2026-09-01', 'upcoming', 40),
      p('a', 'A', '2026-07-01', 'done', -20),
      p('b', 'B', '2026-08-01', 'done', -9),
    ])
    expect(out.map(m => m.date)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(out.map(m => m.tier)).toEqual([0, 1, 0])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/ganttScale.test.ts`
Expected: FAIL — `groupGanttMilestones`가 export되지 않음

- [ ] **Step 3: 최소 구현**

`src/lib/domain/ganttScale.ts` 파일 끝에 추가 (파일 상단에 `import type { MilestonePoint, MilestoneStatus } from './dashboard'` 추가 — dashboard.ts는 ganttScale을 import하지 않으므로 순환 없음):

```ts
/* ── 간트 마일스톤 세로 기준선 — 같은 날짜는 마커 1개로 병합, 라벨 칩은 위/아래 2단 교차 배치 ── */
export interface GanttMilestoneMarker {
  date: string
  status: MilestoneStatus
  names: string[]
  dday: number
  tier: 0 | 1
}

const MS_STATUS_PRIORITY: readonly MilestoneStatus[] = ['overdue', 'upcoming', 'done']

export function groupGanttMilestones(points: readonly MilestonePoint[]): GanttMilestoneMarker[] {
  const byDate = new Map<string, MilestonePoint[]>()
  for (const pt of points) {
    const group = byDate.get(pt.date)
    if (group) group.push(pt)
    else byDate.set(pt.date, [pt])
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, group], i) => ({
      date,
      status: MS_STATUS_PRIORITY.find(s => group.some(g => g.status === s)) ?? 'done',
      names: group.map(g => g.name),
      dday: group[0].dday,
      tier: (i % 2) as 0 | 1,
    }))
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/ganttScale.test.ts`
Expected: PASS (기존 buildGanttScale 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/ganttScale.ts tests/domain/ganttScale.test.ts
git commit -m "간트 마일스톤 기준선의 날짜 병합·2단 배치를 순수 함수로 분리"
```

---

### Task 2: 간트 오버레이 + 툴바 토글 + 범례 + i18n + prop 배선

**Files:**
- Modify: `src/lib/i18n/dict/wbs.ts` (ko/en 각 5키 추가)
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (import·props·state·useMemo·오버레이·토글·범례)
- Modify: `src/app/(app)/p/[projectId]/wbs/page.tsx` (prop 1개 추가)

**Interfaces:**
- Consumes: `groupGanttMilestones`, `GanttMilestoneMarker` (Task 1), `milestoneTimeline` (`src/lib/domain/dashboard.ts:224`, 순수 함수 — 클라이언트 import 가능), `projectConfig.milestoneKeywords` (page.tsx:33에서 이미 로드된 `getProjectConfig` 결과)
- Produces: 없음 (말단 UI)

- [ ] **Step 1: i18n 키 추가**

`src/lib/i18n/dict/wbs.ts` — ko 사전의 `'wbs.today': '오늘',`(약 89행) 근처에 추가:

```ts
  // 간트 마일스톤 기준선
  'wbs.milestones': '이정표',
  'wbs.milestonesToggleTitle': '이정표 기준선 표시/숨기기',
  'wbs.msUpcoming': '예정',
  'wbs.msDone': '완료',
  'wbs.msOverdue': '지연',
```

en 사전의 `'wbs.today': 'Today',`(약 253행) 근처에 추가 (en은 `Record<keyof ko, string>`이라 누락 시 컴파일 에러):

```ts
  // 간트 마일스톤 기준선
  'wbs.milestones': 'Milestones',
  'wbs.milestonesToggleTitle': 'Show or hide milestone guide lines',
  'wbs.msUpcoming': 'Upcoming',
  'wbs.msDone': 'Done',
  'wbs.msOverdue': 'Overdue',
```

- [ ] **Step 2: WbsGanttSheet — import·모듈 상수·props**

`src/components/wbs/WbsGanttSheet.tsx`:

(a) 기존 import 수정·추가 (2~27행 구역):

```ts
import { Maximize2, Minimize2, FileText, GitBranch, Flag } from 'lucide-react'   // Flag 추가
import { milestoneTimeline, type MilestoneStatus } from '@/lib/domain/dashboard' // 신규
import { centeredTimelineScrollLeft, groupGanttMilestones } from '@/lib/domain/ganttScale' // groupGanttMilestones 추가
```

(b) 모듈 상수 — `const EMPTY_DEPENDENCIES: TaskDependency[] = []`(54행) 아래에 추가:

```ts
const EMPTY_MILESTONE_KEYWORDS: readonly string[] = []
/* 마일스톤 기준선 색 — 대시보드 MilestoneTimeline의 상태 3색(MS_TONE)과 동일 토큰 */
const MS_LINE: Record<MilestoneStatus, string> = { done: 'border-done', overdue: 'border-delayed', upcoming: 'border-brand' }
const MS_CHIP: Record<MilestoneStatus, string> = { done: 'bg-done', overdue: 'bg-delayed', upcoming: 'bg-brand' }
```

(c) props — `maxDepth = null,`(141행) 아래에 `milestoneKeywords = EMPTY_MILESTONE_KEYWORDS,` 추가, 타입 블록의 `maxDepth?: number | null`(168행) 아래에 추가:

```ts
  /** 프로젝트별 마일스톤 키워드(§7.4 ProjectConfig) — 빈 배열이면 마커 0건이 정답(설정 부재 신호, 폴백 금지). */
  milestoneKeywords?: readonly string[]
```

- [ ] **Step 3: WbsGanttSheet — state와 useMemo**

(a) `const [planningColsHidden, ...]`(199행) 근처에 추가:

```ts
  // 이정표 기준선 — 열 숨김과 같은 일시적 화면 상태. 매 진입 기본값은 켜짐이며 계정에 저장하지 않는다.
  const [showMilestones, setShowMilestones] = useState(true)
```

(b) 컴포넌트 본문(예: 572행 `const actor = useMemo(...)` 근처)에 추가 — 판정·정렬은 대시보드와 단일 출처:

```ts
  const milestoneMarkers = useMemo(
    () => groupGanttMilestones(milestoneTimeline(items, today, milestoneKeywords)),
    [items, today, milestoneKeywords],
  )
  const milestoneCount = useMemo(
    () => milestoneMarkers.reduce((n, m) => n + m.names.length, 0),
    [milestoneMarkers],
  )
```

- [ ] **Step 4: WbsGanttSheet — 세로 기준선 오버레이**

`{/* 오늘 세로선 (행 위) */}` 블록(1321행) **바로 앞**에 삽입. 오늘선(z-30)이 위에 오도록 z-[25].
칩만 `pointer-events-auto`로 살려 title 툴팁이 뜨게 한다. 위치·높이는 반드시 기존 `LEFT_W`·`ganttW`·`rowsH`·`xOf`·`dayPx` 재사용:

```tsx
          {/* 이정표 세로 기준선 (오늘선 아래 레이어) — 같은 날짜는 병합, 칩은 2단 교차 배치 */}
          {showMilestones && milestoneMarkers.length > 0 && (
            <div
              className="pointer-events-none absolute z-[25]"
              style={{ left: LEFT_W, top: 'var(--wbs-head-h)', width: ganttW, height: rowsH }}
            >
              {milestoneMarkers.map(m => {
                const x = xOf(m.date) + dayPx / 2
                const dday = m.status === 'upcoming' ? ` · D-${m.dday}` : m.status === 'overdue' ? ` · D+${-m.dday}` : ''
                const label = m.names[0] + (m.names.length > 1 ? ` +${m.names.length - 1}` : '') + dday
                return (
                  <div key={m.date}>
                    <div
                      className={`absolute top-0 w-0 -translate-x-1/2 border-l-2 border-dashed opacity-60 ${MS_LINE[m.status]}`}
                      style={{ left: x, height: rowsH }}
                    />
                    <div
                      className={`pointer-events-auto absolute -translate-x-1/2 truncate rounded-sm px-1 py-0.5 font-bold leading-none text-white ${MS_CHIP[m.status]}`}
                      style={{ left: x, top: m.tier === 0 ? 0 : 14, maxWidth: 120, fontSize: 'var(--wbs-day-font, 9px)' }}
                      title={`${m.names.join(', ')} — ${fmtDate(m.date)}`}
                    >
                      {label}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
```

- [ ] **Step 5: WbsGanttSheet — 툴바 토글**

의존선 토글 블록(`{dependencies.length > 0 && (...)}`, 788~809행) **바로 뒤**에 추가 — 마일스톤 0건이면 토글 자체를 숨기는 동일 패턴:

```tsx
        {milestoneMarkers.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMilestones(value => !value)}
            aria-pressed={showMilestones}
            title={t('wbs.milestonesToggleTitle')}
            className={`btn h-9 px-3 text-xs ${showMilestones ? 'border border-brand-ring bg-brand-weak text-brand' : 'btn-ghost'}`}
          >
            <Flag className="h-3.5 w-3.5" />
            {t('wbs.milestones')} {milestoneCount}
          </button>
        )}
```

- [ ] **Step 6: WbsGanttSheet — 범례 항목**

범례의 의존성 블록(`{dependencies.length > 0 && (...)}`, 1376~1383행) **바로 뒤**에 추가:

```tsx
        {milestoneMarkers.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span>{t('wbs.milestones')}</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-0 border-l-2 border-dashed border-brand" />{t('wbs.msUpcoming')}</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-0 border-l-2 border-dashed border-done" />{t('wbs.msDone')}</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-0 border-l-2 border-dashed border-delayed" />{t('wbs.msOverdue')}</span>
          </span>
        )}
```

- [ ] **Step 7: page.tsx — prop 배선**

`src/app/(app)/p/[projectId]/wbs/page.tsx` — `maxDepth={projectConfig.maxDepth}`(63행) 아래에 추가:

```tsx
        milestoneKeywords={projectConfig.milestoneKeywords}
```

- [ ] **Step 8: 검증**

Run: `npm run lint && npm run test`
Expected: lint 0 오류, vitest 전부 PASS (breakpoint-safety-net 테스트 포함 — 상태 변형 display 유틸을 안 썼으므로 통과해야 정상)

- [ ] **Step 9: 커밋**

```bash
git add src/lib/i18n/dict/wbs.ts src/components/wbs/WbsGanttSheet.tsx "src/app/(app)/p/[projectId]/wbs/page.tsx"
git commit -m "간트에 이정표 세로 기준선을 얹다 — 대시보드와 판정 단일 출처, 토글·범례 포함"
```

---

### Task 3: 빌드 검증과 배포

**Files:** 없음 (검증·배포만)

**Interfaces:**
- Consumes: Task 1·2의 커밋 전부
- Produces: 프로덕션 배포 (push → Vercel 자동 배포 → 스모크)

- [ ] **Step 1: 로컬 빌드 검증**

`verify` 스킬 절차대로 `_workspace` 스크래치 ts를 `*.buildskip`으로 개명 후:

Run: `npm run build`
Expected: 빌드 성공. 끝나면 개명 원복.

- [ ] **Step 2: push (pre-push 훅 통과 확인)**

```bash
git push origin main
```

Expected: G1(마이그레이션 혼합 없음)·G2(UI 위험 파일 아님)·G3 통과. Vercel 자동 배포 시작.

- [ ] **Step 3: 배포 스모크**

Vercel 배포 완료 대기 후:

Run: `npm run smoke:prod`
Expected: CSS 전달 무결성 + 레이아웃 규칙 전부 통과

- [ ] **Step 4: 사용자 실화면 확인 안내**

`mark:good`은 사용자가 실화면(마커 표시·토글·범례·다크모드)을 확인한 뒤 남긴다 — 자동 실행하지 않는다.
