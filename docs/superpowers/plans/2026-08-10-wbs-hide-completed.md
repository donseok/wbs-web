# WBS 완료 숨기기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS 시트/간트에서 전부 완료된 구간을 숨기고 부분완료 구간의 완료 작업은 흐리게 표시하는 계정 저장 토글을 추가한다.

**Architecture:** 숨김 판정은 `src/lib/domain/hideDone.ts` 순수 함수(리프 원시 actualPct ≥ 100 기반)로 분리하고, 표시 필터는 `WbsGanttSheet.tsx`의 `flatRows` 한 곳에만 삽입한다(행높이·행번호·지브라·의존선 좌표가 전부 flatRows 파생이라 시트·간트 자동 정합). 토글 상태는 `UiPrefs.wbsHideDone`으로 계정 전역 저장(JSONB 병합 — DB 마이그레이션 없음). 스펙: `docs/superpowers/specs/2026-08-10-wbs-hide-completed-design.md`.

**Tech Stack:** Next.js 15 App Router, React 19 클라이언트 컴포넌트, vitest, Supabase(user_preferences JSONB).

## Global Constraints

- **`git add -A` 금지** — 항상 파일명을 명시해 stage 한다(병렬 세션 리포).
- 커밋 메시지는 한국어, "무엇"보다 "왜". 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 트레일러.
- DB 마이그레이션 없음 — 이 기능은 코드만 변경한다(G1 훅 걱정 없음).
- 수정 파일 중 UI 위험 파일(`src/app/globals.css`, `src/components/app/*`) 없음 — main 직행 가능. **globals.css 를 건드리지 말 것**(기존 `.btn`/`btn-ghost` 클래스 재사용).
- 완료 판정은 **원시값 비교**(`actualPct >= 100`) — `Math.round`/`round1` 을 판정에 쓰면 99.5 가 완료 처리된다(`src/lib/domain/progress.ts:32-33` 계약).
- 숨김은 **표시 계층에서만** — `computeTree`/rollup/`overallProgress` 및 서버 데이터 경로(엑셀 export·칸반·대시보드·봇)는 무접촉.
- 흐림은 `opacity` 로만 — `group-hover:flex` 같은 상태 변형 display 유틸은 unlayered 반응형 안전망에 져서 금지(CLAUDE.md).
- 로컬 `npm run build` 는 `_workspace` 스크래치 ts 파일 3개 때문에 실패할 수 있다(Vercel 무관). 검증은 `npm run lint` + `npm run test` 로 한다.
- 운영 D-CUBE 데이터 무접촉 — 이 기능은 조회·표시만 바꾼다.

---

### Task 1: 도메인 순수 함수 `computeHideDone` (TDD)

**Files:**
- Create: `src/lib/domain/hideDone.ts`
- Test: `tests/domain/hideDone.test.ts`

**Interfaces:**
- Consumes: `ComputedItem`(`src/lib/domain/types.ts:43-50` — `id: string`, `actualPct: number | null`, `children: ComputedItem[]`), `statusOf`(`src/lib/domain/progress.ts:29`), `round1`(`src/lib/domain/format.ts`)
- Produces: `computeHideDone(items: ComputedItem[]): HideDoneResult`, `interface HideDoneResult { hiddenIds: Set<string>; dimIds: Set<string>; hiddenCount: number }` — Task 2·3 이 이 시그니처를 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/hideDone.test.ts` 를 아래 내용으로 생성한다. 픽스처 헬퍼는 `ComputedItem` 전 필드를 채우되 판정에 쓰이는 것은 `id`·`actualPct`·`children` 뿐이다.

```ts
import { describe, it, expect } from 'vitest'
import { computeHideDone } from '@/lib/domain/hideDone'
import { statusOf } from '@/lib/domain/progress'
import { round1 } from '@/lib/domain/format'
import type { ComputedItem } from '@/lib/domain/types'

let seq = 0
function node(id: string, actualPct: number | null, children: ComputedItem[] = []): ComputedItem {
  seq += 1
  return {
    id,
    parentId: null,
    code: id,
    sortOrder: seq,
    name: id,
    biz: null,
    deliverable: null,
    plannedStart: null,
    plannedEnd: null,
    weight: null,
    actualPct,
    owners: [],
    isOwnerSplit: false,
    plannedPct: 0,
    rolledActualPct: actualPct ?? 0,
    achievement: null,
    status: (actualPct ?? 0) >= 100 ? 'done' : 'in_progress',
    children,
    depth: 0,
  }
}

describe('computeHideDone', () => {
  it('부분완료 부모(4/5 완료) — 아무것도 숨기지 않고 완료 리프만 흐림 대상', () => {
    const done = ['a', 'b', 'c', 'd'].map(id => node(id, 100))
    const open = node('e', 0)
    const tree = [node('p', null, [...done, open])]
    const r = computeHideDone(tree)
    expect(r.hiddenIds.size).toBe(0)
    expect(r.hiddenCount).toBe(0)
    expect([...r.dimIds].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(r.dimIds.has('p')).toBe(false)
    expect(r.dimIds.has('e')).toBe(false)
  })

  it('전부 완료된 최상위 구간 — 서브트리 통째 숨김', () => {
    const tree = [node('p', null, [node('l1', 100), node('l2', 100)])]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['l1', 'l2', 'p'])
    expect(r.hiddenCount).toBe(3)
  })

  it('중간 깊이의 전부 완료 구간(부분완료 phase 아래) — 그 서브트리만 숨김', () => {
    const g = node('g', null, [node('g1', 100), node('g2', 100)])
    const tree = [node('phase', null, [g, node('x', 50)])]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['g', 'g1', 'g2'])
    expect(r.hiddenIds.has('phase')).toBe(false)
    expect(r.hiddenIds.has('x')).toBe(false)
    // 검색으로 g 가 드러나면 흐려져야 하므로 dim 에는 포함
    expect(r.dimIds.has('g')).toBe(true)
  })

  it('가중치 0 미완 자식 엣지 — 부모 status 가 done 이어도 숨기지 않음', () => {
    // 엣지 실재 확인: weight 0 자식은 가중평균에서 소거된다(rollup.ts siblingWeight)
    const rolled = round1((1 * 100 + 0 * 50) / (1 + 0 || 1))
    expect(statusOf(rolled, 100, null, '2026-08-10')).toBe('done')
    const a = node('a', 100)
    a.weight = 1
    const b = node('b', 50)
    b.weight = 0
    const tree = [node('p', null, [a, b])]
    const r = computeHideDone(tree)
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('a')).toBe(true)
    expect(r.dimIds.has('b')).toBe(false)
    expect(r.dimIds.has('p')).toBe(false)
  })

  it('round1 반올림 엣지 — 리프 99.8 + 완료 4개(부모 status done)여도 숨기지 않음', () => {
    // 엣지 실재 확인: (400+99.8)/5 = 99.96 → round1 = 100 → statusOf done
    expect(statusOf(round1((100 * 4 + 99.8) / 5), 100, null, '2026-08-10')).toBe('done')
    const done = ['a', 'b', 'c', 'd'].map(id => node(id, 100))
    const near = node('e', 99.8)
    const r = computeHideDone([node('p', null, [...done, near])])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('e')).toBe(false)
    expect([...r.dimIds].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('원시값 계약 — 99.5 리프와 null 리프는 완료 아님(숨김·흐림 모두 제외)', () => {
    const r = computeHideDone([node('p', null, [node('a', 99.5), node('b', null), node('c', 100)])])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('a')).toBe(false)
    expect(r.dimIds.has('b')).toBe(false)
    expect(r.dimIds.has('c')).toBe(true)
  })

  it('최상위 완료 리프 — 흐림만, 숨김 아님', () => {
    const r = computeHideDone([node('solo', 100)])
    expect(r.hiddenIds.size).toBe(0)
    expect(r.dimIds.has('solo')).toBe(true)
  })

  it('전량 완료(최상위 리프 없는 픽스처) — 전 행 숨김', () => {
    const tree = [
      node('p1', null, [node('a', 100), node('b', 100)]),
      node('p2', null, [node('c', 100)]),
    ]
    const r = computeHideDone(tree)
    expect(r.hiddenCount).toBe(5)
    expect([...r.hiddenIds].sort()).toEqual(['a', 'b', 'c', 'p1', 'p2'])
  })

  it('전량 완료 + 최상위 완료 리프 존재 — 리프는 흐림으로 잔존', () => {
    const tree = [node('p1', null, [node('a', 100)]), node('solo', 100)]
    const r = computeHideDone(tree)
    expect([...r.hiddenIds].sort()).toEqual(['a', 'p1'])
    expect(r.hiddenIds.has('solo')).toBe(false)
    expect(r.dimIds.has('solo')).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/domain/hideDone.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/hideDone'` 계열 에러.

- [ ] **Step 3: 최소 구현**

`src/lib/domain/hideDone.ts` 를 아래 내용으로 생성한다.

```ts
import type { ComputedItem } from './types'

/**
 * WBS 완료 숨기기 판정 (스펙: docs/superpowers/specs/2026-08-10-wbs-hide-completed-design.md).
 * 부모 status('done')가 아니라 리프 원시값으로 판정한다 — round1 반올림·가중치 0 소거
 * 두 엣지에서 미완 리프가 남아 있어도 부모 status 는 done 이 될 수 있기 때문.
 */
export interface HideDoneResult {
  /** 화면에서 제거할 행 — 전부 완료된 구간(자식을 가진 노드)과 그 하위 전체 */
  hiddenIds: Set<string>
  /** 흐림 대상 — 서브트리 전체가 완료인 모든 노드(화면에 남은 것만 흐려진다) */
  dimIds: Set<string>
  /** 토글 버튼에 병기할 N = hiddenIds.size — 접힘 상태와 무관한 "감춘 작업 수" */
  hiddenCount: number
}

export function computeHideDone(items: ComputedItem[]): HideDoneResult {
  const dimIds = new Set<string>()
  const allDone = new Map<string, boolean>()
  const walk = (n: ComputedItem): boolean => {
    let v: boolean
    if (n.children.length === 0) {
      v = (n.actualPct ?? 0) >= 100 // 원시값 비교 — statusOf 의 done 계약과 동일(반올림 금지)
    } else {
      let all = true
      for (const c of n.children) if (!walk(c)) all = false // 단락 금지 — 하위 전 노드 판정 필요
      v = all
    }
    allDone.set(n.id, v)
    if (v) dimIds.add(n.id)
    return v
  }
  items.forEach(walk)

  const hiddenIds = new Set<string>()
  const collect = (n: ComputedItem) => {
    hiddenIds.add(n.id)
    n.children.forEach(collect)
  }
  // 자식을 가진(=구간) 전부 완료 노드만 숨긴다. 리프는 구간이 아니라 부모를 통해서만 숨는다
  // — 최상위 완료 리프가 흐림으로 남는 규칙의 근거.
  const mark = (ns: ComputedItem[]) => {
    for (const n of ns) {
      if (n.children.length > 0 && allDone.get(n.id)) collect(n)
      else mark(n.children)
    }
  }
  mark(items)
  return { hiddenIds, dimIds, hiddenCount: hiddenIds.size }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/hideDone.test.ts`
Expected: PASS 9건.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/hideDone.ts tests/domain/hideDone.test.ts
git commit -m "WBS 완료 숨김 판정을 리프 원시값 기반 순수 함수로 분리

부모 status(done)는 round1 반올림·가중치 0 소거 엣지에서 미완 리프가
남아도 done 이 될 수 있어 판정 근거로 쓰지 않는다. 두 엣지 모두
테스트로 고정.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 토글 상태·계정 저장·flatRows 필터·흐림·툴바 버튼

**Files:**
- Modify: `src/lib/domain/types.ts:177-189` (UiPrefs)
- Modify: `src/app/(app)/p/[projectId]/wbs/page.tsx:8,27-34,46-65`
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (import·props·state·flatRows·툴바·행 렌더)
- Modify: `src/lib/i18n/dict/wbs.ts` (ko·en 각 2키)

**Interfaces:**
- Consumes: `computeHideDone(items) → { hiddenIds, dimIds, hiddenCount }` (Task 1), `queueUiPref(patch: Partial<UiPrefs>)` (`src/lib/prefs/debouncedSave.ts:9`), `getUiPrefs(): Promise<UiPrefs>` (`src/app/actions/preferences.ts:6`)
- Produces: `WbsGanttSheet` prop `initialHideDone?: boolean`, 컴포넌트 내부 상태 `hideDone: boolean`·`hideExempt: Set<string>`·핸들러 `toggleHideDone()`·메모 `hideDoneResult: HideDoneResult` — Task 3 이 이 이름들을 그대로 사용한다.

- [ ] **Step 1: UiPrefs 키 추가**

`src/lib/domain/types.ts` 의 `UiPrefs` 인터페이스(188행 `lastProjectHref` 아래)에 추가:

```ts
  wbsHideDone?: boolean     // WBS 완료 숨김 토글 — 전 프로젝트 공통(스펙 2026-08-10-wbs-hide-completed)
```

- [ ] **Step 2: 서버 페이지 배선**

`src/app/(app)/p/[projectId]/wbs/page.tsx`:

8행 import 를 확장:
```ts
import { getWbsCollapse, getUiPrefs } from '@/app/actions/preferences'
```

27-34행 `Promise.all` 에 `getUiPrefs()` 를 병렬 추가(직렬 await 금지 관례):
```ts
  const [{ items, dependencies, holidays, today }, actor, projects, initialCollapsed, user, projectConfig, uiPrefs] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
    getProjectConfig(projectId),
    getUiPrefs(),
  ])
```

`<WbsGanttSheet>` props 에 추가(64행 `milestoneKeywords` 다음 줄):
```tsx
        initialHideDone={uiPrefs.wbsHideDone ?? false}
```

- [ ] **Step 3: 컴포넌트 — import·prop·상태**

`src/components/wbs/WbsGanttSheet.tsx`:

(a) 기존 `@/lib/prefs/debouncedSave` import 에 `queueUiPref` 추가(현재 `queueWbsCollapse` 만 가져온다), 기존 `lucide-react` import(Maximize2·Minimize2·GitBranch·Flag·FileText 가 있는 줄)에 `ListChecks` 추가, 도메인 import 에 한 줄 추가:
```ts
import { computeHideDone } from '@/lib/domain/hideDone'
```

(b) props: 함수 시그니처(145행 `initialCollapsed,` 근처)에 `initialHideDone = false,` 를 추가하고, 타입 블록(170행 근처)에 추가:
```ts
  /** 계정에 저장된 완료 숨김 토글(UiPrefs.wbsHideDone) — 전 프로젝트 공통. */
  initialHideDone?: boolean
```

(c) 상태: `progressLensPinnedId` 선언(216행) 아래에 추가:
```ts
  // 완료 숨김 — 계정 전역 저장(UiPrefs.wbsHideDone). 접힘(user_wbs_state)과 달리 프로젝트 무관.
  const [hideDone, setHideDone] = useState(initialHideDone)
  // focus 딥링크가 숨겨진 구간을 가리킬 때의 임시 노출 — forcedOpen 과 같은 계열(계정 저장 무접촉)
  const [hideExempt, setHideExempt] = useState<Set<string>>(() => new Set())
  const toggleHideDone = () => {
    // 토글 조작은 명시적 의사표시 — focus 임시 노출을 함께 걷어낸다(스펙 §데이터 흐름 3).
    setHideExempt(s => (s.size ? new Set() : s))
    queueUiPref({ wbsHideDone: !hideDone })
    setHideDone(v => !v)
  }
  // 숨김 판정 — 여기(상태 블록)에 선언해야 아래쪽 focus 효과(Task 3)의 의존성 배열이
  // 선언 전 참조(TDZ)가 되지 않는다. flatRows 근처(394행대)에 두면 렌더 시점에 터진다.
  const hideDoneResult = useMemo(() => computeHideDone(items), [items])
```

- [ ] **Step 4: flatRows 필터**

`flatRows`(389-393행)를 교체(`hideDoneResult` 는 Step 3 에서 상태 블록에 이미 선언됨):
```ts
  const flatRows = useMemo(() => {
    // 검색이 우선 — 완료 작업도 검색으로 찾을 수 있어야 하므로 숨김 미적용(스펙 §결정 사항)
    if (matchKeep) return flatten(items, new Set()).filter(n => matchKeep.has(n.id))
    const rows = flatten(items, effCollapsed)
    if (!hideDone) return rows
    return rows.filter(n => !hideDoneResult.hiddenIds.has(n.id) || hideExempt.has(n.id))
  }, [items, effCollapsed, matchKeep, hideDone, hideDoneResult, hideExempt])
```

- [ ] **Step 5: 행 흐림**

본문 행 map(1028행~) 안 `const isCritical = schedule?.critical ?? false`(1035행) 아래에 추가:
```ts
  const isDim = hideDone && hideDoneResult.dimIds.has(n.id)
```

행 래퍼 div(1079행)의 className 을 교체:
```tsx
  className={`group relative z-10 box-border flex h-[var(--wbs-row-h)] w-max outline-none ${isDim ? 'opacity-50' : ''}`}
```
(opacity 는 행에 새 스태킹 컨텍스트를 만들지만 행은 이미 `relative z-10` 컨텍스트라 동결 셀·오버레이 clip(b141e60)과 간섭 없음. display 유틸 아님 — 안전망 무관.)

- [ ] **Step 6: 툴바 토글 버튼**

진척 돋보기 버튼(795-807행) 닫힘 직후에 추가(이정표 토글 842-853행과 같은 패턴 — 시트·간트 양 모드 공통 위치):
```tsx
        <button
          type="button"
          data-wbs-hide-done-toggle
          onClick={toggleHideDone}
          aria-pressed={hideDone}
          title={t('wbs.hideDoneTitle')}
          className={`btn h-9 px-3 text-xs ${hideDone ? 'border border-brand-ring bg-brand-weak text-brand' : 'btn-ghost'}`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {t('wbs.hideDone')}
          {/* N = 접힘 무관 '감춘 작업 수'. 검색 중엔 숨김이 일시 미적용이라 거짓 신호 방지 위해 생략 */}
          {hideDone && !q && <span className="tabular-nums">· {hideDoneResult.hiddenCount}</span>}
        </button>
```

- [ ] **Step 7: i18n 키(ko·en)**

`src/lib/i18n/dict/wbs.ts` — ko 구역(`'wbs.milestonesToggleTitle'` 92행 근처)에 추가:
```ts
  'wbs.hideDone': '완료 숨김',
  'wbs.hideDoneTitle': '완료된 작업 숨기기 — 전부 완료된 구간만 숨기고, 진행 중 구간의 완료 작업은 흐리게 유지',
```
en 구역(`'wbs.milestonesToggleTitle'` 262행 근처)에 추가:
```ts
  'wbs.hideDone': 'Hide done',
  'wbs.hideDoneTitle': 'Hide completed work — only fully-done sections are hidden; done tasks in active sections are dimmed',
```

- [ ] **Step 8: 검증**

Run: `npm run lint && npm run test`
Expected: lint 통과, vitest 전량 통과(기존 스위트 + Task 1 의 9건). i18n 사전에 누락 키 검사 테스트가 있으면 새 키가 ko·en 양쪽에 있어 통과해야 한다.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/domain/types.ts "src/app/(app)/p/[projectId]/wbs/page.tsx" src/components/wbs/WbsGanttSheet.tsx src/lib/i18n/dict/wbs.ts
git commit -m "WBS 완료 숨김 토글 — 전부 완료 구간만 숨기고 부분완료는 흐림 유지

필터는 flatRows 한 곳에만 삽입해 시트·간트(행높이·행번호·의존선 좌표가
전부 flatRows 파생)가 자동 정합된다. 검색 중에는 숨김을 풀어 완료 작업도
찾을 수 있게 하고, 버튼의 N(감춘 작업 수) 병기도 생략한다(거짓 신호 방지).
상태는 UiPrefs.wbsHideDone 계정 전역 저장 — 마이그레이션 없음.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 빈 상태 3분기 + focus 딥링크 임시 노출 + toggleAll 정리

**Files:**
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (focus 효과 268-282행, toggleAll 502-511행, 빈 상태 1344-1363행 — Task 2 반영 후 행번호는 다소 밀림)
- Modify: `src/lib/i18n/dict/wbs.ts` (ko·en 각 3키)

**Interfaces:**
- Consumes: Task 2 의 `hideDone`·`hideExempt`·`setHideExempt`·`toggleHideDone`·`hideDoneResult`, 기존 `forcedOpen`·`flashId`·`ancestorPath`(`WbsGanttSheet.tsx:98`)·빈 상태 블록의 `q`
- Produces: 없음(말단 UX 처리)

- [ ] **Step 1: toggleAll 에서 임시 노출 정리**

`toggleAll`(502행~) 의 `setForcedOpen(...)` 줄 다음에 추가:
```ts
    setHideExempt(s => (s.size ? new Set() : s)) // 전체 토글은 숨김 임시 노출도 함께 정리
```

- [ ] **Step 2: focus 효과에 숨김 임시 노출 추가**

focus 효과(268-282행)의 `if (path.length) setForcedOpen(new Set(path))` 와 `setFlashId(focusId)` 사이에 추가:
```ts
    // 대상이 숨겨진 구간 안이면 조상 경로+대상 서브트리를 임시 노출(스펙 §데이터 흐름 3).
    // flashId 와 같은 배치로 set — 스크롤 효과는 다음 렌더 후 DOM 을 찾으므로 순서 문제 없음.
    if (hideDone && (hideDoneResult.hiddenIds.has(focusId) || path.some(id => hideDoneResult.hiddenIds.has(id)))) {
      const exempt = new Set(path)
      const findNode = (ns: ComputedItem[]): ComputedItem | null => {
        for (const n of ns) {
          if (n.id === focusId) return n
          const c = findNode(n.children)
          if (c) return c
        }
        return null
      }
      const addSubtree = (n: ComputedItem) => {
        exempt.add(n.id)
        n.children.forEach(addSubtree)
      }
      const target = findNode(items)
      if (target) addSubtree(target)
      setHideExempt(exempt)
    }
```
효과의 의존성 배열을 `[focusId, items, t]` → `[focusId, items, t, hideDone, hideDoneResult]` 로 갱신한다.
(토글을 나중에 조작해 효과가 재실행돼도 `handledFocusRef.current === focusId` 조기 반환으로 재점프하지 않고, `toggleHideDone` 이 임시 노출을 걷어낸다. 임시 노출된 행은 dimIds 에 이미 포함돼 흐림 규칙을 그대로 받는다.)

- [ ] **Step 3: 빈 상태 3번째 분기**

빈 상태 블록(1344-1363행)을 교체(기존 2분기 유지 + 완료 숨김 분기·해제 버튼 추가):
```tsx
          {/* 빈 상태 — 항목 없음 / 검색 결과 없음 / 전량 완료 숨김 (가로 스크롤에도 좌측 고정) */}
          {flatRows.length === 0 && (
            <div
              className="sticky left-0 z-10 flex flex-col items-center justify-center gap-1.5 py-10 text-center"
              style={{ width: 'min(560px, 100vw)' }}
              role="status"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-weak text-brand" aria-hidden>
                <Icon name={items.length === 0 ? 'folder' : q ? 'search' : 'eyeOff'} />
              </span>
              <span className="text-sm font-medium text-ink-muted">
                {items.length === 0
                  ? t('wbs.emptyNoItems')
                  : q
                    ? `${t('wbs.noResultsPrefix')}${query.trim()}${t('wbs.noResultsSuffix')}`
                    : t('wbs.allDoneHidden')}
              </span>
              <span className="text-[12px] text-ink-subtle">
                {items.length === 0 ? t('wbs.emptyNoItemsHint') : q ? t('wbs.noResultsHint') : t('wbs.allDoneHiddenHint')}
              </span>
              {items.length > 0 && !q && (
                <button type="button" onClick={toggleHideDone} className="btn btn-ghost mt-1 h-8 px-3 text-xs">
                  {t('wbs.showDone')}
                </button>
              )}
            </div>
          )}
```
(`items.length > 0 && flatRows.length === 0 && !q` 는 숨김이 켜진 경우에만 도달한다 — 접힘은 루트 행을 남기고, 검색 아님·숨김 꺼짐이면 flatten 은 최소 루트를 반환한다. `Icon` 의 `eyeOff` 는 열 숨김 토글(791행)이 이미 쓰는 유효한 이름.)

- [ ] **Step 4: i18n 키(ko·en)**

`src/lib/i18n/dict/wbs.ts` — ko 구역(`'wbs.noResultsHint'` 127행 근처)에 추가:
```ts
  'wbs.allDoneHidden': '모든 작업이 완료되어 숨겨졌습니다',
  'wbs.allDoneHiddenHint': '완료 숨김을 끄면 전체 작업이 다시 표시됩니다.',
  'wbs.showDone': '숨기기 해제',
```
en 구역(`'wbs.noResultsHint'` 295행 근처)에 추가:
```ts
  'wbs.allDoneHidden': 'All tasks are done and hidden',
  'wbs.allDoneHiddenHint': 'Turn off Hide done to show them again.',
  'wbs.showDone': 'Show done tasks',
```

- [ ] **Step 5: 검증**

Run: `npm run lint && npm run test`
Expected: 전량 통과. 특히 react-hooks/exhaustive-deps 경고가 focus 효과에서 나지 않아야 한다(의존성 배열 갱신 확인).

- [ ] **Step 6: 커밋**

```bash
git add src/components/wbs/WbsGanttSheet.tsx src/lib/i18n/dict/wbs.ts
git commit -m "완료 숨김의 빈 상태·focus 딥링크 임시 노출 처리

전량 완료로 모든 행이 숨으면 '무응답 화면 금지' 원칙대로 사유와 해제
버튼을 보여준다. ?focus= 가 숨겨진 구간을 가리키면 forcedOpen 과 같은
계열로 조상 경로+대상 서브트리만 임시 노출하고, 숨김 토글·전체 접기
조작 시 걷어낸다(계정 저장 무접촉).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 통합 검증

**Files:**
- Modify: 없음(검증만)

**Interfaces:**
- Consumes: Task 1-3 전체
- Produces: 검증 결과 보고(수동 스모크는 사용자 몫으로 체크리스트 전달)

- [ ] **Step 1: 전체 테스트·린트**

Run: `npm run lint && npm run test`
Expected: 전량 통과(2026-08 현재 vitest 2400건+ 규모).

- [ ] **Step 2: 타입 무결성 확인(로컬 빌드 대안)**

로컬 `npm run build` 는 `_workspace` 스크래치 ts 로 실패할 수 있으므로 다음으로 대신한다:
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v _workspace | head -30`
Expected: 신규 코드 관련 타입 에러 0건(`_workspace` 경로 외 에러 없음). 실패 시 원인을 고치고 재실행.

- [ ] **Step 3: 무접촉 확인**

Run: `git diff main --stat` (또는 push 전 `git log --stat`)
Expected: 변경 파일이 정확히 다음 6개뿐 — `src/lib/domain/hideDone.ts`(신규), `tests/domain/hideDone.test.ts`(신규), `src/lib/domain/types.ts`, `src/app/(app)/p/[projectId]/wbs/page.tsx`, `src/components/wbs/WbsGanttSheet.tsx`, `src/lib/i18n/dict/wbs.ts` + 문서 2건(스펙·계획). `supabase/`·`globals.css`·`src/components/app/`·칸반·엑셀 경로가 없어야 한다.

- [ ] **Step 4: 수동 스모크 체크리스트 보고**

배포(push)는 사용자 결정. push 후 사용자 확인용 체크리스트를 최종 보고에 포함한다:
1. WBS 시트에서 "완료 숨김" 클릭 → 전부 완료 구간 사라짐 + 버튼에 `· N` 표기
2. 부분완료 구간의 완료 행이 흐리게 남아 있는지
3. 간트(?view=timeline)에서도 같은 행 구성인지
4. 검색어 입력 → 완료 행도 검색되고 N 병기가 사라지는지
5. 새로고침·다른 프로젝트 이동 후에도 토글 유지(계정 저장)되는지
6. (가능하면) 전 작업 완료 프로젝트에서 빈 상태 문구+해제 버튼
7. 확인 완료 시 `npm run smoke:prod` + `npm run mark:good`

---

## Self-Review 결과 (계획 작성 후 점검)

- 스펙 커버리지: 판정 규칙(Task 1)·flatRows 필터/검색 우선(Task 2 Step 4)·흐림(Step 5)·툴바+N(Step 6)·저장 배선(Step 1-3)·빈 상태(Task 3 Step 3)·focus(Step 2)·toggleAll 정리(Step 1)·i18n(각 태스크)·무접촉(Task 4 Step 3) — 스펙 전 섹션에 대응 태스크 있음. "범위 제외" 3건은 태스크 없음이 정답.
- 플레이스홀더: 없음(전 코드 블록 실코드).
- 타입 일관성: `HideDoneResult`/`computeHideDone`/`hideDone`/`hideExempt`/`toggleHideDone`/`hideDoneResult`/`initialHideDone` 명칭이 Task 1→2→3 에서 동일.
- 발견·수정한 버그: `hideDoneResult` 메모를 flatRows 근처에 두면 위쪽 focus 효과 의존성
  배열이 TDZ 참조로 렌더 시점에 터진다 → 상태 블록(Step 3)으로 이동해 해소.
