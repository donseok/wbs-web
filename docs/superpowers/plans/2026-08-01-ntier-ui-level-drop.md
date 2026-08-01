# N단 UI + level 컬럼 제거 (Plan C: 설계 §11 단계 5~6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WBS UI(배지·자식추가·접기·행 배경·엑셀 접기)를 `level` 문자열이 아니라 `depth`+`isOwnerSplit`+`levelLabels`로 구동하고, 검증 후 `wbs_items.level` 컬럼을 제거한다 — D-CUBE 화면·배지·엑셀이 1픽셀도 바뀌지 않은 채로.

**Architecture:** 정본 스펙 `docs/design/dflow-generic-wbs-design-2026-07-29.md` §4.4·§5·§6.5·§11 단계 5~6. Plan A가 깊이를 `parent_id` 트리에서 파생하고(level=DEPRECATED), Plan B가 임포트를 프로파일화했다. 이 계획은 마지막 잔존 `level` 소비처(UI 4파일 + insert 4경로 + data 매핑 3곳)를 depth/플래그로 옮기고 컬럼을 drop한다. 화면 변경이 있으므로 **회귀 0의 유일한 최종 판정은 배포 후 육안 + 엑셀 셀 비교**(빌드·테스트가 UI 깨짐을 못 잡는다 — §10.8).

**Tech Stack:** Next.js 15 · Supabase(Management API) · vitest · 기존 주입 패턴(Plan A getProjectConfig, teamOrderMap)


> **2026-08-01 범위 조정(사용자 결정):** C6(WbsRow.level 제거·RPC 교체)과 C7(level 컬럼 drop·구 임포트 제거)은
> **Plan D로 분리**한다. C6 착수 중 `WbsRow.level` 제거가 계획이 예상 못한 비-UI 소비처 7곳
> (DK Bot RAG 임베딩 `analytics.ts`, phase 감지 `match.ts`, 봇 도구 스키마 `ai/tools/wbs.ts`,
> 엑셀 `buildWbsAoa` 3열 하드코딩, 주간보고 `weekly.ts`·`report/excel.ts`, 리포지토리 매핑)을 노출했고,
> 이들은 전부 회귀 0 대상(챗봇·주간 PPT·엑셀)이라 각자 Task 2급 depth+levelLabels 재설계가 필요하다.
> 따라서 **이 계획은 C1~C5(UI depth화 + 엑셀 접기)까지만 실행**하고 `level` 컬럼·필드는 DEPRECATED로 남긴다
> (UI는 안 읽으므로 무해). 비-UI 7곳 전환과 컬럼 drop은 Plan D.

## Global Constraints

- **회귀 0이 유일한 합격 기준**(§2-4): 각 배포 후 D-CUBE의 ① WBS 화면(레벨 배지 텍스트 `PHASE/TASK/ACT`·SUB-ACT, 트리 구조, 행 배경, 자식추가 버튼 노출)이 육안 동일 ② 엑셀 익스포트 셀 단위 동일 ③ 대시보드 KPI·스냅샷 동일 ④ `npm run test`·`npm run smoke:prod` 초록.
- **`level` 컬럼 drop(T7)은 T1~T6 배포·`mark:good` 완료 후에만.** 비가역이므로 UI가 depth로 정상 동작함을 프로덕션에서 확인한 뒤 별도 배포. drop 전까지 insert 경로는 `level`을 계속 써도 무방하나 UI·신규 코드는 읽지 않는다.
- **UI 위험 파일 규칙**(CLAUDE.md·§10.8): `WbsGanttSheet.tsx`·`RowDetailPanel.tsx`·`shared.tsx`·`WbsProgressLens.tsx`는 브랜치 push로 G2 통과 후 배포, **배포 후 smoke+육안 필수**(Preview는 로그인 화면 못 봄). `src/components/app/*`·`globals.css`·`layout.tsx`는 이 계획에서 절대 무접촉.
- 마이그레이션(0063 RPC 교체, 0064 drop)은 단독 커밋 + `_rollback.sql`(G1). 적용은 Management API. 0062는 Major Process가 사용하므로 다음 번호는 착수 시 `ls supabase/migrations | tail`로 재확인(기준 0063·0064).
- 에러 3원칙 유지. `git add -A` 금지. 커밋 한국어 "왜" + 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **D-CUBE 설정 실측(회귀 기준값)**: `level_labels=['Phase','Task','Activity']`, `max_depth=3`, sub-act는 `is_owner_split=true`(depth에 미포함). 배지 현행: `LEVEL[phase]={PHASE,brand}`, `[task]={TASK,progress}`, `[activity]={ACT,pending}`, SUB-ACT={SUB-ACT, surface-2}(shared.tsx:23-31).

---

### Task 1: buildTree가 depth를 부여 + ComputedItem.depth 전파

**Files:**
- Modify: `src/lib/domain/types.ts` (TreeNode·ComputedItem에 depth)
- Modify: `src/lib/domain/tree.ts` (buildTree가 depth 계산)
- Test: `tests/domain/tree.test.ts` (depth 케이스 추가)

**Interfaces:**
- Produces: `TreeNode`에 `depth: number`(0-based, 루트=0). `buildTree(rows, opts)`가 순회 중 depth를 채운다. `collectLeaves`·rollup이 depth를 보존(WbsRow 확장이라 자동). 화면·계산 동작 무변경(추가 필드일 뿐).

- [ ] **Step 1: 실패하는 테스트 추가** (tests/domain/tree.test.ts)

```ts
it('buildTree가 트리 순회로 depth를 부여한다(0-based)', () => {
  const rows = [
    row({ id: 'p', parentId: null }),
    row({ id: 't', parentId: 'p' }),
    row({ id: 'a', parentId: 't' }),
    row({ id: 'a2', parentId: 'a' }),   // 4단
  ]
  const tree = buildTree(rows, { subActTeamOrder: new Map() })
  const depthOf = (id: string): number => {
    let found = -1
    const walk = (ns: TreeNode[]) => ns.forEach(n => { if (n.id === id) found = n.depth; walk(n.children) })
    walk(tree)
    return found
  }
  expect(depthOf('p')).toBe(0)
  expect(depthOf('t')).toBe(1)
  expect(depthOf('a')).toBe(2)
  expect(depthOf('a2')).toBe(3)
})
```

- [ ] **Step 2: RED** — `TreeNode`에 depth 없음(tsc) / 값 없음
- [ ] **Step 3: 구현**

`types.ts`: `TreeNode`(tree.ts에 정의됨)와 `ComputedItem`에 depth 추가. 실제 위치 확인: `TreeNode = WbsRow & { children: TreeNode[] }` → `& { children: TreeNode[]; depth: number }`. `ComputedItem extends WbsRow`에 `depth: number` 추가.

`tree.ts` buildTree: 노드 생성 시 depth 미상 → 트리 조립 후 순회로 채운다. `roots.forEach(r => assignDepth(r, 0))` 헬퍼:

```ts
function assignDepth(n: TreeNode, d: number): void {
  n.depth = d
  n.children.forEach(c => assignDepth(c, d + 1))
}
```

`buildTree` 반환 직전 `sort(roots)` 뒤에 `roots.forEach(r => assignDepth(r, 0))`. rollup(computeNode)이 TreeNode를 ComputedItem으로 만들 때 depth를 그대로 전파하는지 확인 — `rollup.ts`가 `{...node}` 스프레드면 자동. 아니면 명시 전파 추가(구현 시 rollup.ts 열어 확인, 무변경이면 그대로).

- [ ] **Step 4: GREEN** — `npx vitest run tests/domain` + `npx tsc --noEmit`(ComputedItem 소비처가 depth 필수화로 안 깨지는지 — 추가 필드라 안전)
- [ ] **Step 5: 커밋** — "feat(wbs): buildTree가 depth를 부여 — UI의 level 의존을 걷어낼 기반(§4.4)"

---

### Task 2: LevelBadge를 depth+levelLabels 기반으로 + WBS 페이지가 levelLabels 주입

**Files:**
- Modify: `src/components/wbs/shared.tsx` (LevelBadge 시그니처)
- Modify: `src/components/wbs/WbsGanttSheet.tsx:1052` (LevelBadge 호출)
- Modify: `src/components/wbs/RowDetailPanel.tsx:217` (LevelBadge 호출)
- Modify: `src/components/wbs/WbsProgressLens.tsx:57` (LevelBadge 호출)
- Modify: WBS 서버 페이지(`src/app/(app)/p/[projectId]/wbs/page.tsx` — 실물 경로 확인) + WbsGanttSheet props에 `levelLabels` 전달
- Test: `tests/ui/level-badge.test.tsx` (신규 — 있으면 tests/ui 관례, 없으면 순수 라벨 함수를 shared에서 분리해 tests/domain)

**Interfaces:**
- Consumes: Task 1의 `depth`.
- Produces: `LevelBadge({ depth, isOwnerSplit, levelLabels, compact? })` — level 문자열 인자 폐기. 배지 텍스트 = `isOwnerSplit ? 'SUB-ACT' : (levelLabels[depth] ?? \`${depth+1}단\`)`. 색상 = depth 기반 팔레트(현행 phase/task/activity 3색을 depth 0/1/2에 매핑, depth≥3는 pending 재사용). **D-CUBE(levelLabels=[Phase,Task,Activity])에서 depth 0/1/2 배지가 현행 PHASE/TASK/ACT와 텍스트·색 동일해야 회귀 0.**
- 순수 라벨 함수 `levelBadgeText(depth, isOwnerSplit, levelLabels): string`·`levelBadgeClass(depth, isOwnerSplit): string`를 shared에서 export해 테스트.

- [ ] **Step 1: 실패하는 테스트** (신규 tests/domain/level-badge.test.ts — 순수 함수)

```ts
import { describe, expect, it } from 'vitest'
import { levelBadgeText, levelBadgeClass } from '@/components/wbs/shared'

const DCUBE = ['Phase', 'Task', 'Activity']
describe('levelBadge (§4.4 depth 기반)', () => {
  it('D-CUBE 라벨에서 현행 배지 텍스트를 재현한다(회귀 0)', () => {
    expect(levelBadgeText(0, false, DCUBE)).toBe('PHASE')   // 현행 대문자 표기 유지
    expect(levelBadgeText(1, false, DCUBE)).toBe('TASK')
    expect(levelBadgeText(2, false, DCUBE)).toBe('ACT')     // 'Activity'→'ACT' 축약 규칙 유지
    expect(levelBadgeText(2, true, DCUBE)).toBe('SUB-ACT')
  })
  it('라벨 밖 깊이는 N단 폴백', () => {
    expect(levelBadgeText(3, false, DCUBE)).toBe('4단')
    expect(levelBadgeText(0, false, ['단계', '기능'])).toBe('단계')
  })
  it('색상은 depth 기반, sub는 별도', () => {
    expect(levelBadgeClass(0, false)).toContain('brand')
    expect(levelBadgeClass(2, true)).toContain('surface-2')
  })
})
```

⚠️ **현행 배지 표기 규칙을 shared.tsx 실물에서 확인**: 현재 `LEVEL[phase].label='PHASE'`(대문자), `[activity].label='ACT'`(축약). `levelBadgeText`는 이 규칙을 재현해야 한다 — `levelLabels[depth]`가 'Phase'/'Activity'일 때 'PHASE'/'ACT'로 변환하는 매핑 테이블(현행 3레벨 한정)을 두고, 그 밖은 라벨 원문 대문자화 or 원문. 구현 시 현행 텍스트를 정확히 재현하는 규칙을 정하고 위 테스트를 그에 맞춘다(테스트가 회귀 기준).

- [ ] **Step 2: RED** → **Step 3: 구현**

shared.tsx: `levelBadgeText`/`levelBadgeClass` 순수 함수 + `LevelBadge`가 그것을 쓰도록. 시그니처 `{ depth, isOwnerSplit, levelLabels, compact }`. `LEVEL`/`LEVEL_FALLBACK`/`SUB_ACT` 상수는 색 팔레트로 재활용.

호출처 3곳: `level={n.level}` → `depth={n.depth} isOwnerSplit={n.isOwnerSplit} levelLabels={levelLabels}`. `levelLabels`는 각 컴포넌트가 prop으로 받는다. WbsGanttSheet/RowDetailPanel/WbsProgressLens의 상위(WBS 페이지 서버 컴포넌트)가 `getProjectConfig(projectId).levelLabels`를 로드해 내린다. **클라이언트 공용 주입이 필요하면 TeamsProvider 패턴의 `ProjectConfigProvider`를 신설**(구현 시 판단: prop 드릴이 2단 이하면 prop, 그 이상이면 provider — 실물 트리 확인 후 결정, 리포트에 근거).

- [ ] **Step 4: GREEN** — 테스트 + `npx tsc --noEmit` + eslint. 배지 텍스트 회귀는 Step 8(배포 육안)에서 최종 확인.
- [ ] **Step 5: 커밋**(브랜치 — UI 위험 파일 포함) — "feat(wbs): LevelBadge를 depth+levelLabels로 — D-CUBE 배지 텍스트 불변"

---

### Task 3: RowDetailPanel 자식추가·isAct를 depth+maxDepth+isOwnerSplit로

**Files:**
- Modify: `src/components/wbs/RowDetailPanel.tsx` (CHILD_LEVEL 폐기, childLevel/isAct 재정의)
- Modify: `src/app/actions/wbs.ts` addWbsItem (level 인자 → 부모 depth 파생, 또는 유지하되 UI가 안 넘김)
- Test: 기존 addWbsItem 테스트 + RowDetailPanel 판정 순수화

**Interfaces:**
- Consumes: Task 1 depth, Task 2 levelLabels, `getProjectConfig().maxDepth`.
- Produces: 자식 추가 가능 판정 = `maxDepth == null || item.depth + 1 < maxDepth`(§4.4 — `depth+1 < maxDepth`). sub-act 추가 가능(isAct 대체) = `!item.isOwnerSplit && item.children 없음`(리프) — Plan A addSubAct 가드와 동치. `addWbsItem`은 level 인자를 계속 받되(drop 전) UI는 `levelLabels[item.depth+1] ?? 'activity'` 같은 하위호환 문자열을 넘긴다 — **또는** T6에서 addWbsItem 시그니처를 바꿀 때 함께. 이 태스크에서는 **UI 판정만 depth화**하고 addWbsItem 호출은 기존 유지(level 인자에 하위호환값 전달), 시그니처 변경은 T6로 미룬다(작은 단위 유지).

- [ ] **Step 1: 실패하는 테스트** — RowDetailPanel의 순수 판정을 함수로 분리(`canAddChild(depth, maxDepth)`, `canSplit(isOwnerSplit, hasChildren)`)해 tests/domain/wbs-affordance.test.ts:

```ts
import { canAddChild, canSplit } from '@/lib/domain/wbsAffordance'   // 신규 순수 모듈
it('자식 추가 = depth+1 < maxDepth (무제한이면 항상)', () => {
  expect(canAddChild(0, 3)).toBe(true)   // depth 0 → 자식 depth 1 < 3 ✓
  expect(canAddChild(1, 3)).toBe(true)
  expect(canAddChild(2, 3)).toBe(false)  // depth 2 자식은 3 → 3<3 거짓 (D-CUBE ACT 아래 불가 = 현행)
  expect(canAddChild(2, null)).toBe(true) // 무제한
})
it('sub-act 분리 = 리프이고 자기 자신이 sub-act 아님', () => {
  expect(canSplit(false, false)).toBe(true)
  expect(canSplit(true, false)).toBe(false)   // 이미 sub-act
  expect(canSplit(false, true)).toBe(false)   // 자식 있음
})
```

- [ ] **Step 2: RED** → **Step 3: 구현**

`src/lib/domain/wbsAffordance.ts` 신설(순수). RowDetailPanel: `CHILD_LEVEL` 폐기, `const canChild = canAddChild(item.depth, maxDepth)`, `const isAct = canSplit(item.isOwnerSplit, item.children.length > 0)`. `maxDepth`는 prop(Task 2 provider/prop과 같은 경로). addWbsItem 호출 시 level 인자엔 하위호환 문자열(`levelLabels[item.depth+1]`가 3레벨이면 'task'/'activity' 매핑, 그 밖 'activity') 전달 + `// TODO 없음` 대신 주석 "level은 하위호환 기록 — T6에서 시그니처 제거". placeholder 라벨(446행)은 `levelLabels[item.depth+1] ?? '항목'`.

- [ ] **Step 4: GREEN** + tsc + eslint. **D-CUBE(maxDepth 3)에서 버튼 노출이 현행과 동일**(depth 0·1은 자식추가 보임, depth 2는 안 보임 = 현행 phase/task 보임·activity 안 보임)을 배포 육안(Step 8)에서 확인.
- [ ] **Step 5: 커밋**(브랜치) — "feat(wbs): 자식추가·sub-act 어포던스를 depth·maxDepth로 — CHILD_LEVEL 폐기"

---

### Task 4: WbsGanttSheet 접기·sub-act 라벨·행 배경을 depth/isOwnerSplit로

**Files:**
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (74·347·983·998·1542)
- Test: `tests/ui/wbs-initial-collapsed.test.tsx`(기존 접힘 테스트 — depth fixture로 회귀 유지)

**Interfaces:**
- Consumes: Task 1 depth·isOwnerSplit.
- Produces: 접기 대상(74 `splitParentIds`) = `n.isOwnerSplit 자식을 가진 노드`(현행 'level==activity && children'과 백필 데이터에서 동치). sub-act 라벨(347) = `n.children 중 isOwnerSplit인 것`에 subActLabel. 행 배경(983/998) = depth 기반 틴트(현행 phase/task/else 3분기를 depth 0/1/그외로 — 들여쓰기는 이미 `depth*14`(972·1054)라 선례). 1542는 실물 확인 후 depth/플래그로.

- [ ] **Step 1: 기존 접힘 테스트를 depth fixture로 확장** — `tests/ui/wbs-initial-collapsed.test.tsx`에 4단 fixture 케이스 추가(sub-act 보유 노드가 접힘 대상). 기존 3단 케이스 유지(회귀선).
- [ ] **Step 2: RED**(현행이 level 참조라 4단 fixture에서 실패) → **Step 3: 구현** — 다섯 지점을 depth/isOwnerSplit로 교체. `subActLabel`은 이름 접두 파싱 대신 isOwnerSplit 노드에만 적용.
- [ ] **Step 4: GREEN** + tsc + eslint + `npm run build`.
- [ ] **Step 5: 커밋**(브랜치) — "feat(wbs): 간트 접기·라벨·배경을 depth·플래그로 — 이름 파싱·level 분기 폐기"

---

### Task 5: 엑셀 익스포트 flatten을 isOwnerSplit 기준으로

**Files:**
- Modify: `src/lib/excel/export.ts:23-33` (flatten)
- Test: `tests/excel/export.test.ts` (sub-act 접힘 회귀 + 4단 일반트리 펼침)

**Interfaces:**
- Produces: `flatten`이 `n.level !== 'activity'` 대신 `!n.isOwnerSplit`로 재귀 — sub-act만 접고 일반 자식(깊이 무관)은 전개. **D-CUBE(3단, sub-act는 isOwnerSplit)에서 익스포트 셀 동일**(sub-act 여전히 접힘, 일반 3단 트리 전개는 현행과 동일). 4단 일반 트리는 이제 4번째 계층 열에 전개(현행은 activity에서 멈춰 유실됐음 — 개선).

- [ ] **Step 1: 실패하는 테스트** — export.test.ts에 (a) sub-act 보유 3단 트리 → 현행과 셀 동일(회귀) (b) 4단 일반 트리(isOwnerSplit 전부 false) → 4단까지 행 출력.
- [ ] **Step 2: RED** → **Step 3: 구현** — `if (!n.isOwnerSplit) walk(n.children)`. flatten이 ComputedItem을 받으므로 isOwnerSplit 접근 가능(WbsRow 필드).
- [ ] **Step 4: GREEN** — `npx vitest run tests/excel`(기존 라운드트립 회귀 포함).
- [ ] **Step 5: 커밋** — "feat(excel): 익스포트 접기를 isOwnerSplit로 — 깊은 일반 트리 유실 해소(§6.5)"

---

### Task 6: insert 경로에서 level 제거 준비 + WbsRow.level 필드 제거

**Files:**
- Modify: `src/app/actions/wbs.ts` addWbsItem(level 인자 제거·insert에서 level 제외)·addSubAct(insert에서 `level:'activity'` 제외)
- Modify: `src/lib/domain/types.ts` (WbsRow에서 `level` 제거)
- Modify: `src/lib/data/wbs.ts:72`·`snapshots.ts:54`·`trend.ts:36` (level 매핑 제거)
- Create: `supabase/migrations/0063_wbs_rpc_drop_level.sql` + rollback (import_wbs·replace_wbs가 level을 insert하지 않게 `create or replace`)
- Test: 기존 addWbsItem/addSubAct·import 테스트 회귀 + 0063 계약 테스트

**Interfaces:**
- Consumes: Task 2·3의 depth 어포던스(addWbsItem 호출부가 level을 안 넘겨도 되게 이미 정리됨).
- Produces: `addWbsItem(projectId, parentId, name)` — level 인자 제거. insert에서 level 컬럼 안 씀(0063 이후 컬럼이 nullable이라 안 넣어도 됨 — drop은 T7). import_wbs·replace_wbs RPC가 level을 insert하지 않게 교체(is_owner_split·code 등은 유지). `WbsRow`에서 level 필드 제거 → tsc가 남은 소비처 전수 노출(Task 2~4에서 이미 걷어냈으므로 data 매핑 3곳만 남아야 함).

- [ ] **Step 1: WbsRow.level 제거 후 tsc로 잔존 소비처 확인** — `npx tsc --noEmit`이 드러내는 곳이 정확히 data/wbs·snapshots·trend(매핑)와 addWbsItem 시그니처뿐이어야 한다. UI에 남아 있으면 Task 2~4 미완 — 되돌아가 정리.
- [ ] **Step 2: 액션·매핑·RPC 정리** — addWbsItem 시그니처·insert, addSubAct insert, data 매핑 3곳 제거. 0063 마이그레이션: import_wbs·replace_wbs를 level 없이 `create or replace`(0060/0061 본문에서 level insert 라인만 제거 — 나머지 바이트 동일). 롤백은 0060/0061 정의 복원.
- [ ] **Step 3: 계약 테스트** — 0063이 두 RPC에서 level 미포함·is_owner_split 유지·롤백 복원을 assert.
- [ ] **Step 4: GREEN** — `npx vitest run` 전량 + tsc + eslint. (level 컬럼은 아직 존재·nullable이라 insert 생략이 안전.)
- [ ] **Step 5: 커밋 2개** — 코드(액션·타입·매핑) 단독 / 마이그레이션 0063 단독(G1).

---

### Task 7: 0064 — level 컬럼 drop (게이트: T1~T6 배포·mark:good 후) + 구 임포트 경로 제거

**Files:**
- Create: `supabase/migrations/0064_drop_wbs_level.sql` + rollback
- Modify/Delete: 구 임포트 라우트(`src/app/api/import/route.ts`)·`src/lib/excel/parse.ts`·`validate.ts`의 구 export 중 Plan B가 대체한 것(§11 단계 6 — 마법사가 대체하므로 제거. 단 `splitLeafOwners`는 parseWithProfile이 재사용하므로 유지)
- Test: 0064 계약 테스트 + 제거 라우트의 참조 0 확인

**⚠️ 이 태스크는 T1~T6가 프로덕션 배포되고 `mark:good`된 뒤에만 실행한다**(Global Constraints). level을 읽는 코드가 프로덕션에 하나도 없음을 확인한 상태에서만 drop이 안전하다.

**Interfaces:**
- Produces: `alter table wbs_items drop column level`. 구 임포트 라우트/파서 제거로 코드가 level을 참조하는 곳이 0. 롤백은 `add column level text`(nullable, 데이터 복원 불가 — 주석 명시: is_owner_split·트리로 재파생 가능하나 이 마이그레이션은 컬럼만 되살린다).

- [ ] **Step 1: drop 전 최종 확인** — `grep -rn "\.level\b\|'level'\|\"level\"" src/ | grep -v level_labels | grep -v levelLabels` → wbs_items.level 참조 0건(민트·폴더 등 다른 level은 제외). RPC도 `pg_get_functiondef`로 level 미참조 확인.
- [ ] **Step 2: 0064 SQL + 롤백** — begin/commit·search_path 핀. drop column. 롤백은 add column nullable + 데이터 미복원 주석.
- [ ] **Step 3: 구 임포트 라우트·파서 제거** — `src/app/api/import/route.ts` 삭제(마법사가 대체), `parse.ts`의 `parseWbsWorkbook`·`LEGACY_COLUMN_MAP` 등 Plan B가 대체한 export 제거. **`splitLeafOwners`(validate.ts)는 parseWithProfile이 import하므로 유지** — 제거 전 `grep -rn "splitLeafOwners\|validateAndLink\|parseWbsWorkbook"`로 잔존 참조 확인. WbsImportForm의 구 폼도 제거하고 마법사 링크만 남길지 결정(구현 시 — 사용자 확인 대상일 수 있어 리포트에 명시).
- [ ] **Step 4: GREEN** — `npx vitest run` 전량 + tsc + build. 제거로 깨지는 테스트가 있으면 그 테스트도 구 경로 전용인지 확인 후 제거.
- [ ] **Step 5: 커밋 2개** — 코드(구 경로 제거) 단독 / 마이그레이션 0064 단독.

---

### Task 8: 배포·회귀 0·육안 검증 (사람 개입 구간)

- [ ] **Step 1**: `npm run test && npm run lint && npm run build` 전량.
- [ ] **Step 2**: 배포 전 D-CUBE 스냅샷 — WBS 엑셀 익스포트 파일 보관 + 화면 캡처(레벨 배지·트리·자식추가 버튼) + `select md5(...) from wbs_items where project_id=7a1c6034...` 해시.
- [ ] **Step 3: T1~T6 배포** — 브랜치 push(G2, UI 위험 파일 포함) → main 머지·push → Ready → `npm run smoke:prod`. **0063은 코드 배포 후 적용**(RPC가 level 생략 — 컬럼은 아직 존재).
- [ ] **Step 4: 회귀 0 육안 판정** — D-CUBE WBS 화면 열어 ① 레벨 배지 텍스트/색 동일 ② 트리·행 배경 동일 ③ 자식추가 버튼 노출 위치 동일 ④ 엑셀 재익스포트 셀 비교(Step 2 파일과 diff) ⑤ 대시보드 KPI 동일. **다르면 즉시 롤백**(0063_rollback → 코드 revert). 통과 시 `npm run mark:good`.
- [ ] **Step 5: T7 실행(별도 배포)** — Step 4 mark:good 후에만. grep으로 level 참조 0 재확인 → 0064 적용(drop) + 구 경로 제거 코드 배포 → smoke → 육안(WBS·임포트 마법사 정상) → `mark:good`. 롤백: 0064_rollback(컬럼만 복원) → 코드 revert.
- [ ] **Step 6**: 메모리 갱신(Plan C 완료, level 컬럼 제거, 구 임포트 경로 제거) + `generic-wbs-core` 메모리의 "Plan C 선행조건" 해소 기록.

---

## Self-Review 결과 (작성 시점)

- **스펙 커버리지**: §4.4 UI 교체 표(RowDetailPanel·shared·WbsGanttSheet·자식추가)→T2/T3/T4 · §5 sub-act 플래그 표시→T2/T4(정렬은 Plan A 완료) · §6.5 익스포트 펼침→T5 · §11 단계 5(N단 UI)→T1~T5 · 단계 6(level drop·구 경로 제거)→T6/T7 · §10.8 UI 위험 파일 육안→T8.
- **의도적 비범위**: 주간보고 구분(P4)·메뉴 on/off(P3)·전역 축(P6)·로케일(P7)은 별개 계획. levelLabels 편집 UI(설정 화면)는 P2 잔여 — 이 계획은 levelLabels를 읽기만 한다.
- **타입 일관성**: `depth`(T1)를 T2~T6 전부 소비. `levelBadgeText/Class`(T2), `canAddChild/canSplit`(T3) 순수 함수를 UI가 소비. WbsRow.level 제거(T6)는 UI가 depth로 전환된 뒤에만.
- **위험 메모**: T7 level drop은 비가역 — T8 Step 4 mark:good 게이트가 필수 방어선. levelLabels 주입 방식(prop vs provider)은 T2 구현 시 실물 트리로 결정(검증 지시). 배지 텍스트 회귀(PHASE/ACT 축약)는 T2 테스트가 고정하되 최종은 육안.
```
