# 강제 진행(의존 간선 면제 + 스텁) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사람이 선행↔후행 간선 하나를 「강제 진행」으로 면제하면 후행이 스텁으로 먼저 개발되고, 스텁을 치울 하위 Task 가 같은 트랜잭션에서 생기며, 스텁이 남은 동안 후행 승인이 잠기고 화면 곳곳에 「스텁 잔존」 이 보이게 한다.

**Architecture:** 마이그레이션 0103 이 `wbs_items.depends_waived`·`stub_for`, 병목 설정 두 컬럼, `depends` 축소 트리거, 면제 RPC `set_dependency_waiver`, 그리고 리프 판정에서 `stub_for` 하위를 빼고 승인을 잠그는 `apply_workflow_event` 재정의를 담는다. 앱은 선행 판정(`predecessorReached`)에 `waived` 축을 더해 다섯 관문을 한 번에 열고, 트리 조립(`buildTree`)이 `stub_for` 하위를 `children` 이 아닌 `subTasks` 로 빼서 롤업·리프 판정 전부를 그대로 둔다. 스텁 잔존 판정은 `src/lib/domain/forceProgress.ts` 한 곳이고 WBS 표·사이드바·오피스·허브·결재 배지가 그 결과를 쓴다. 스킬은 `waived` 간선을 로컬 도달 검사·행 G 에서 따로 다루고, 승격 관문으로 `dflow.sh stub-check` 를 둔다.

**Tech Stack:** Postgres(plpgsql) · Next.js 15 server actions · supabase-js admin client · React(client component) · vitest · POSIX sh + jq

**Spec:** `docs/superpowers/specs/2026-09-23-force-progress-design.md`

## Global Constraints

- 반영은 **staging 까지**다. main push·운영 DB 적용·dflow-kit 재빌드는 하지 않는다.
- 작업 브랜치 `feat/force-progress`, 기점 **`origin/staging`**, 별도 워크트리 `.claude/worktrees/force-progress`. 메인 체크아웃·로컬 `staging` 브랜치는 쓰지 않는다(병렬 세션 커밋이 섞여 갈라져 있다).
- 마이그레이션 번호는 **0103** 이다(2026-09-23 배정 — 0102 는 과제 C). 파일은 `supabase/migrations/0103_force_progress.sql` · `0103_force_progress_rollback.sql`.
- `git add -A` 금지. 파일명을 명시해 stage 한다.
- **마이그레이션 파일과 코드는 다른 커밋**이다(G1). 마이그레이션 커밋에는 `supabase/migrations/0103_*`·`scripts/checks/0103_*`·`tests/migrations/0103-*` 만 담는다.
- 마이그레이션은 `_rollback.sql` 동반, 스테이징 리허설(`npm run db:apply -- <파일> --target staging`) 뒤 커밋 트레일러 `Staging-verified:` (G4).
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- 권한 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/index.ts`(가드)와 기존 `src/lib/agent/subtreeManager.ts` 가드만 쓴다. 액션에 역할 문자열을 적지 않는다.
- 에러 3원칙: 조회 실패를 "없음"으로 위장하지 않는다(표시=로깅), 쓰기 전 선행 조회 실패면 중단, 보안 가드는 fail-closed.
- 병목 기본값은 **후속 3건 · 4시간**(`DEFAULT_BOTTLENECK = { minSuccessors: 3, minHours: 4 }`, SQL default 도 3·4).
- 스텁 잔존 문구는 **`스텁 잔존: <선행 ref 마지막 칸> 대체`** 한 가지다(`stubLabel`). 배지 텍스트는 「스텁 잔존」(2건 이상이면 「스텁 잔존 N」).
- 하위 Task 의 external_ref 는 **`<후행 ref>.stub.<선행 ref 마지막 칸>`**(`stubTaskRef`).
- API 계약 버전은 **2.8** 로 올린다(additive: `depends_evidence[].waived`). 배정(2026-09-23): origin/staging 현재 2.5, 병행 과제 C=2.6·E=2.7, 이 과제 D=2.8. **머지 순서에 따라 조정될 수 있다** — staging 반영 때 C·E 가 아직 안 들어왔으면 컨트롤러가 번호를 다시 받는다. 세 곳(`src/lib/agent/externalApi.ts` `AGENT_CONTRACT_VERSION`·`dflow.sh CONTRACT_VERSION`·`api-contract.md`)을 항상 같이 바꾼다.
- UI 위험 파일(`src/components/app/*`, `globals.css`, 두 `layout.tsx`)은 건드리지 않는다.
- 상태 변형 display 유틸(`group-hover:flex` 등)을 쓰지 않는다(CLAUDE.md 반응형 안전망).

## Review Focus

- **체인 모킹이 `.is()` 를 모른다**: 이 계획은 자식 존재 질의에 `.is('stub_for', null)` 을 더한다. 기존 액션 테스트의 가짜 쿼리 빌더는 `select·eq·in·limit·order` 만 알아 `is is not a function` 으로 무더기 실패한다. → Task 5 Step 1 이 기존 테스트 파일의 빌더에 `is` 를 더하는 것부터 한다(`tests/actions/wbs-update-actual-lock.test.ts`·`wbs-assign.test.ts`·`wbs-dev-workflow.test.ts`·`add-sub-act.test.ts`·`tests/agent/*ensure*`).
- **wbs.md 재업로드가 면제한 선행을 depends 에서 뺄 때**: CHECK(`depends_waived <@ depends`)만 있으면 import 전체가 실패한다. BEFORE 트리거가 먼저 줄여야 한다. → Task 3 검증 SQL 의 「depends 를 비우면 depends_waived 도 비고 change_logs 1행」.
- **스텁 하위가 있는 후행의 승인**: 하위가 xx 가 아니면 RPC 가 `stub_pending` 으로 거부하고 주문은 reported 그대로여야 한다(반쪽 승인 금지). 하위 xx 뒤에는 후행 승인이 단계 xx·실적 100 을 한 번에 쓴다(`skipped='parent'` 가 나오면 안 된다). → Task 3 검증 SQL.
- **링크가 하위 Task 로 실제로 가는가**: `?focus=<하위 id>` 는 `WbsGanttSheet` 의 조상 경로 탐색이 `subTasks` 를 모르면 "트리에 없음" 으로 조용히 무시된다. → Task 7 의 `findAncestorPath` 테스트.
- **후행 담당자의 자기 승인(F15)**: 후행 담당자는 하위의 서브트리 관리자로 판정되면 안 된다. 서버 가드(`isSubtreeManager`)와 화면(`isSubtreeManagerOf`) 둘 다. → Task 5 테스트 「stub 하위의 조상 탐색은 후행을 건너뛴다」.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/domain/agentWork.ts` | `predecessorReached` 의 `waived` 축 | 1 |
| `src/lib/domain/waitReason.ts` · `dependencyReadiness.ts` · `mergeDependencies.ts` · `types.ts`(TaskDependency) | 대기 사유·착수 가능·간트 합성에 `waived` 전달 | 1 |
| `src/lib/domain/forceProgress.ts` (신규) | 스텁 판정·문구·ref·계약 판정·면제 가능 판정·병목 계산(순수) | 2 |
| `supabase/migrations/0103_force_progress.sql` · `_rollback.sql` | 컬럼·제약·트리거·면제 RPC·전이 RPC 재정의 | 3 |
| `scripts/checks/0103_force_progress_check.sql` | 스테이징 리허설 동작 검증(롤백 트랜잭션) | 3 |
| `tests/migrations/0103-force-progress.test.ts` | 마이그레이션 문안·도메인 대조 | 3 |
| `src/lib/domain/tree.ts` · `types.ts`(WbsRow) · `rollup.ts` · `wbsRealtime.ts` · `project-status.ts` · `levelSettings.ts` | 트리에서 stub 하위를 `subTasks` 로 분리(투명) | 4 |
| `src/lib/data/wbs.ts` · `src/lib/data/snapshots.ts` · `src/app/(app)/projects/page.tsx` · `src/app/actions/project.ts` · `src/lib/agent/wbsImport.ts` | 로더가 `stub_for`·`depends_waived` 를 싣고 투명 규칙을 따름 | 4 |
| `src/app/actions/wbs.ts` · `wbsAssign.ts` · `src/lib/agent/ensureOrder.ts` | 서버 리프 판정에서 stub 하위 제외, F11 가드, 실적 100 스텁 잠금 | 5 |
| `src/lib/agent/assignee.ts` · `src/lib/domain/seatmap.ts`(`isSubtreeManagerOf`) · `src/lib/domain/agentHub.ts`(hasChildren) · `src/lib/data/agentApprovals.ts` | F15 조상 탐색·허브 리프 판정 | 5 |
| `src/app/actions/forceProgress.ts` (신규) · `src/lib/agent/forceProgress.ts` (신규) | 면제·해제·하위 취소 액션과 본체 | 6 |
| `src/lib/agent/depends.ts` · `src/lib/agent/workflowEvent.ts` · `src/lib/agent/externalApi.ts` · claim·show 라우트 | `depends_evidence.waived`, `stub_pending` 문구, 계약 2.8 | 6 |
| `src/components/wbs/WbsGanttSheet.tsx` · `RowDetailPanel.tsx` · `WbsSpecPanel.tsx` · `ForceProgressSection.tsx`(신규) · `StubBadge.tsx`(신규) · i18n `wbs.ko.ts`/`wbs.en.ts` | WBS 표 하위 행·배지, 사이드바 「강제 진행」 절, 승인 비활성 | 7 |
| `src/lib/domain/seatmap.ts` · `src/lib/data/agentSeatmap.ts` · `src/lib/domain/agentHub.ts` · `src/lib/data/agentHub.ts` · `src/lib/data/agentApprovals.ts` · `src/components/agents/*` · `src/components/agent-hub/ApprovalQueue.tsx`·`DelegationTable.tsx` | 오피스·허브의 스텁 잔존 표시·승인 비활성·결재 배지 제외 | 8 |
| `src/lib/data/projectConfig.ts` · `src/app/actions/project.ts`(`updateBottleneckSettings`) · 설정 카드 · `src/components/agents/FloorCard.tsx` | 병목 설정·제안 띠 | 9 |
| `.claude/skills/dflow-work/scripts/dflow.sh` · `references/api-contract.md` · `references/force-progress-hook.md`(신규) · `.claude/skills/dflow-dev/SKILL.md` · `.claude/skills/dflow-merge/SKILL.md` · `.claude/skills/dflow-team/SKILL.md` | 스킬 쪽 `waived`·스텁 규칙·승격 관문 | 10 |

**Task 의존·병렬 경계**

- 1 과 2 는 서로 독립이다 — **병렬**.
- 3 은 2 뒤(마이그레이션 테스트가 `STUB_DONE_STAGE` 를 가져온다).
- 4·10 은 2 뒤, 5 는 1·2 뒤(허브 `deriveWaitReason` 에 Task 1 의 `waived` 인자를 넘긴다)면 된다 — 셋은 **병렬**(파일이 겹치지 않는다. 단 `src/lib/domain/seatmap.ts` 는 5 가 `isSubtreeManagerOf` 만, 8 이 나머지를 고친다 — 8 은 5 뒤).
- 6 은 1·3 뒤(RPC 이름·`predecessorReached` 시그니처).
- 7 은 4·6 뒤. 8 은 5·6 뒤. 9 는 2·8 뒤(`FloorCard.tsx` 를 8 과 같이 고친다).
- 11 은 모두 끝난 뒤(컨트롤러).
- 병렬 Task 는 각자 워크트리 `.claude/worktrees/force-progress-t<N>`(기점 `feat/force-progress` 의 그 시점 HEAD)에서 하고, 끝나면 `feat/force-progress` 로 머지한다.

---

### Task 0: 워크트리 준비 (컨트롤러가 직접)

- [ ] **Step 1: 워크트리 생성**

```bash
cd /Users/jji/project/wbs-web
git fetch -q origin
git worktree add -b feat/force-progress .claude/worktrees/force-progress origin/staging
cd .claude/worktrees/force-progress && npm ci --silent
```

- [ ] **Step 2: 번호·계약 버전 확인**

```bash
git ls-tree --name-only origin/staging supabase/migrations/ | sort | tail -2
grep -n "AGENT_CONTRACT_VERSION =" src/lib/agent/externalApi.ts
```

Expected: 최신이 `0101_*`(또는 과제 C 의 `0102_*`) — `0103_*` 은 없어야 한다. 있으면 멈추고 번호를 다시 받는다. 계약 버전 현재값을 기록해 둔다 — 이 계획은 2.8 로 올린다(Global Constraints, 머지 순서에 따라 조정될 수 있다).

- [ ] **Step 3: 기준선**

Run: `npx vitest run tests/domain tests/agent tests/actions 2>&1 | tail -5`
Expected: 실패 0.

---

### Task 1: 선행 판정에 `waived` 축 (병렬 가능 — Task 2 와)

**Files:**
- Modify: `src/lib/domain/agentWork.ts` (`predecessorReached`)
- Modify: `src/lib/domain/waitReason.ts` (`unmetDepends`, `deriveWaitReason`)
- Modify: `src/lib/domain/types.ts` (`TaskDependency.waived?`)
- Modify: `src/lib/domain/mergeDependencies.ts` (`SpecDependSource.dependsWaived?`)
- Modify: `src/lib/domain/dependencyReadiness.ts` (`ReadinessLink.waived?`)
- Test: `tests/domain/predecessor-reached.test.ts`, `tests/domain/wait-reason-waived.test.ts`(신규), `tests/domain/merge-dependencies-waived.test.ts`(신규)

**Interfaces:**
- Produces:
  - `predecessorReached(p: { stage: string | null; orderApproved?: boolean; actualPct?: number | null; waived?: boolean }): boolean` — `waived === true` 면 곧바로 참.
  - `unmetDepends(depends: string[] | null, byRef: (ref: string) => PredecessorLike | undefined, waived?: readonly string[]): UnmetDepend[]` — `waived` 에 든 ref 는 조회 없이 충족.
  - `deriveWaitReason(args: { …기존…; waived?: readonly string[] })`.
  - `TaskDependency.waived?: boolean`, `SpecDependSource.dependsWaived?: string[] | null`, `ReadinessLink.waived?: boolean`.
  - `mergeSpecDepends` 는 면제된 ref 가 해석되지 않아도 `unresolvedBySuccessorId` 에 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/predecessor-reached.test.ts` 의 첫 `describe` 안에 추가:

```ts
  it('면제된 간선(waived)은 다른 축과 무관하게 충족이다(강제 진행 F2)', () => {
    expect(predecessorReached({ stage: null, waived: true })).toBe(true)
    expect(predecessorReached({ stage: 'ip', orderApproved: false, actualPct: 10, waived: true })).toBe(true)
    expect(predecessorReached({ stage: 'ip', waived: false })).toBe(false)
  })
```

`tests/domain/wait-reason-waived.test.ts`:

```ts
// 강제 진행(스펙 2026-09-23 F2) — 면제된 선행은 대기 사유에서 빠진다. claim 게이트와 같은 판정이어야 화면이 거짓말하지 않는다.
import { describe, expect, it } from 'vitest'
import { deriveWaitReason, unmetDepends, type PredecessorLike } from '@/lib/domain/waitReason'

const pred = (ref: string, stage: string | null): PredecessorLike =>
  ({ external_ref: ref, code: ref.split('/').pop()!, name: `선행 ${ref}`, stage, order_approved: false, actual_pct: 0 })
const byRef = (m: Record<string, PredecessorLike>) => (ref: string) => m[ref]

describe('unmetDepends — waived', () => {
  it('면제된 ref 는 미충족에서 빠진다', () => {
    const m = { 'm/TSK-01': pred('m/TSK-01', 'ip'), 'm/TSK-02': pred('m/TSK-02', 'ip') }
    const u = unmetDepends(['m/TSK-01', 'm/TSK-02'], byRef(m), ['m/TSK-01'])
    expect(u.map(d => d.ref)).toEqual(['m/TSK-02'])
  })
  it('프로젝트에 없는 ref 라도 면제면 충족이다(판정은 면제가 먼저)', () => {
    expect(unmetDepends(['m/GONE'], byRef({}), ['m/GONE'])).toEqual([])
  })
  it('waived 를 안 넘기면 종전과 같다', () => {
    expect(unmetDepends(['m/TSK-01'], byRef({ 'm/TSK-01': pred('m/TSK-01', 'ip') })).length).toBe(1)
  })
})

describe('deriveWaitReason — waived', () => {
  it('유일한 미충족 선행이 면제면 선행 대기가 아니다', () => {
    const r = deriveWaitReason({
      depends: ['m/TSK-01'], predecessorByRef: byRef({ 'm/TSK-01': pred('m/TSK-01', 'ip') }),
      assignee: null, watchers: [], waived: ['m/TSK-01'],
    })
    expect(r.kind).not.toBe('dependency')
  })
})
```

`tests/domain/merge-dependencies-waived.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeSpecDepends } from '@/lib/domain/mergeDependencies'
import { evaluateStartReadiness } from '@/lib/domain/dependencyReadiness'

describe('mergeSpecDepends — dependsWaived', () => {
  const items = [
    { id: 'a', projectId: 'p', externalRef: 'm/TSK-01', depends: null },
    { id: 'b', projectId: 'p', externalRef: 'm/TSK-02', depends: ['m/TSK-01', 'm/GONE'], dependsWaived: ['m/TSK-01', 'm/GONE'] },
  ]
  it('면제된 간선의 합성 링크에 waived:true 를 싣는다', () => {
    const { dependencies } = mergeSpecDepends([], items)
    expect(dependencies).toEqual([expect.objectContaining({ predecessorId: 'a', successorId: 'b', origin: 'spec', waived: true })])
  })
  it('면제된 미해석 ref 는 unresolved 로 세지 않는다', () => {
    expect(mergeSpecDepends([], items).unresolvedBySuccessorId.get('b')).toBeUndefined()
  })
  it('착수 판정은 면제 링크를 충족으로 본다', () => {
    const { dependencies } = mergeSpecDepends([], items)
    const r = evaluateStartReadiness(
      { id: 'b', rolledActualPct: 0, stage: null }, dependencies,
      new Map([['a', { id: 'a', rolledActualPct: 10, stage: 'ip' }]]),
    )
    expect(r.ready).toBe(true)
    expect(r.waitingCount).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/predecessor-reached.test.ts tests/domain/wait-reason-waived.test.ts tests/domain/merge-dependencies-waived.test.ts`
Expected: FAIL (waived 무시로 기대값 불일치)

- [ ] **Step 3: 구현**

`src/lib/domain/agentWork.ts` — 주석 첫 줄에 축을 더하고 본문 맨 앞에 한 줄:

```ts
/**
 * 선행 충족(§3.7) = 면제(강제 진행, 스펙 2026-09-23 F2) ∨ stage ∈ {im,xx} ∨ 승인된 주문 ∨ 실적 ≥ 100.
 * 면제는 간선 단위다 — 호출부가 그 선행이 후행의 depends_waived 에 드는지 넘긴다.
 * (이하 기존 주석 유지)
 */
export function predecessorReached(p: { stage: string | null; orderApproved?: boolean; actualPct?: number | null; waived?: boolean }): boolean {
  if (p.waived === true) return true
  if (p.stage !== null && REACHED_STAGES.has(p.stage)) return true
  if (p.orderApproved === true) return true
  return typeof p.actualPct === 'number' && Number.isFinite(p.actualPct) && p.actualPct >= 100
}
```

`src/lib/domain/waitReason.ts`:

```ts
/** 미충족 선행 — 면제(waived)·검수 대기(im) 이상·승인된 주문·실적 100 중 하나면 충족(predecessorReached). 프로젝트에 없는 ref 는 미충족(fail-closed, 클레임 게이트와 동일) — 단 면제된 ref 는 조회 전에 충족이다. */
export function unmetDepends(
  depends: string[] | null, byRef: (ref: string) => PredecessorLike | undefined, waived: readonly string[] = [],
): UnmetDepend[] {
  const out: UnmetDepend[] = []
  const w = new Set(waived)
  for (const ref of depends ?? []) {
    if (w.has(ref)) continue
    const p = byRef(ref)
    if (!p) { out.push({ ref, found: false }); continue }
    if (predecessorReached({ stage: p.stage, orderApproved: p.order_approved, actualPct: p.actual_pct })) continue
    out.push({ ref, found: true, code: p.code, name: p.name, stage: p.stage })
  }
  return out
}
```

`deriveWaitReason` 인자 타입에 `/** 강제 진행으로 면제한 선행 ref(wbs_items.depends_waived). */ waived?: readonly string[]` 를 더하고 첫 줄을 `const unmet = unmetDepends(args.depends, args.predecessorByRef, args.waived ?? [])` 로 바꾼다.

`src/lib/domain/types.ts` 의 `TaskDependency` 에 필드 추가:

```ts
  /** 강제 진행으로 면제한 spec 간선(스펙 2026-09-23 F1) — origin 'spec' 에만 뜻이 있다. 착수 판정은 충족으로 본다. */
  waived?: boolean
```

`src/lib/domain/mergeDependencies.ts`:

```ts
export interface SpecDependSource {
  id: string
  projectId: string
  externalRef: string | null
  depends: string[] | null
  /** 면제한 선행 ref(0103 depends_waived). 없으면 면제 없음. */
  dependsWaived?: string[] | null
}
```

루프 안: `const waivedRefs = new Set(item.dependsWaived ?? [])` 를 `seenRefs` 옆에 두고, 미해석 분기를 `if (!predecessorId) { if (waivedRefs.has(ref)) continue; …기존… }` 로, push 하는 객체에 `...(waivedRefs.has(ref) ? { waived: true } : {})` 를 더한다.

`src/lib/domain/dependencyReadiness.ts`:

```ts
export interface ReadinessLink {
  id: string
  predecessorId: string
  type: DependencyType
  lagDays: number
  origin: DependencyOrigin
  /** 강제 진행 면제 간선 — spec 축에서 충족으로 본다(predecessorReached 의 waived 축). */
  waived?: boolean
}
```

`evaluateStartReadiness` 의 spec 분기를 `predecessorReached({ stage: predecessor.stage ?? null, actualPct: predecessor.rolledActualPct, waived: dep.waived === true })` 로 바꾸고, 선행 행이 없을 때도 `dep.waived === true` 면 `satisfied` 로 둔다(`unknown` 분기 앞에 `if (dep.waived === true) { byDependencyId.set(dep.id, 'satisfied'); continue }`).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain`
Expected: PASS(기존 포함 실패 0).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/agentWork.ts src/lib/domain/waitReason.ts src/lib/domain/types.ts src/lib/domain/mergeDependencies.ts src/lib/domain/dependencyReadiness.ts tests/domain/predecessor-reached.test.ts tests/domain/wait-reason-waived.test.ts tests/domain/merge-dependencies-waived.test.ts
git commit -m "feat(domain): 선행 충족 판정에 면제(waived) 축을 더한다

강제 진행은 간선 단위 면제다. 다섯 관문이 모두 predecessorReached 를 쓰므로 여기 한 곳에
넣으면 대기 사유·착수 가능·간트 합성이 함께 열린다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 강제 진행 순수 함수 `forceProgress.ts` (병렬 가능 — Task 1 과)

**Files:**
- Create: `src/lib/domain/forceProgress.ts`
- Test: `tests/domain/force-progress.test.ts`

**Interfaces:**
- Produces (전부 `src/lib/domain/forceProgress.ts`):
  - `STUB_DONE_STAGE = 'xx'`
  - `interface StubTaskLike { id: string; stubFor: string; externalRef: string | null; stage: string | null }`
  - `isStubRow(r: { stub_for?: string | null }): boolean`
  - `pendingStubs<T extends StubTaskLike>(subTasks: readonly T[]): T[]`
  - `stubPendingLock(subTasks: readonly StubTaskLike[]): boolean`
  - `lastRefSegment(ref: string): string`
  - `stubLabel(predRef: string): string` → `스텁 잔존: <마지막 칸> 대체`
  - `stubBadgeText(count: number): string` → `스텁 잔존` / `스텁 잔존 N`
  - `stubTaskRef(successorRef: string, predRef: string): string`
  - `stubTaskName(pred: { code: string; name: string }): string`
  - `hasContract(p: { spec: string | null; acceptance: unknown }): boolean`
  - `type WaiveBlock = 'not_in_depends' | 'already_waived' | 'already_reached' | 'no_contract' | 'is_stub_task' | 'not_leaf' | 'no_ref'`
  - `WAIVE_BLOCK_TEXT: Record<WaiveBlock, string>`
  - `waiveBlock(a: { successor: { externalRef: string | null; depends: string[] | null; dependsWaived: string[] | null; stubFor: string | null; hasNormalChildren: boolean }; predRef: string; pred: { stage: string | null; orderApproved: boolean; actualPct: number | null; spec: string | null; acceptance: unknown } | null }): WaiveBlock | null`
  - `interface BottleneckSettings { minSuccessors: number; minHours: number }`, `DEFAULT_BOTTLENECK`
  - `validateBottleneckSettings(raw: unknown): { ok: true; value: BottleneckSettings } | { ok: false; error: string }`
  - `blockedSinceMs(orderUpdatedAt: string, plannedStart: string | null): number`
  - `interface BlockedSuccessor { itemId: string; unmetRefs: string[]; blockedSinceMs: number }`
  - `interface Bottleneck { predRef: string; successorIds: string[]; hours: number }`
  - `findBottlenecks(blocked: readonly BlockedSuccessor[], nowMs: number, s: BottleneckSettings): Bottleneck[]`
  - `bottleneckText(b: Bottleneck, predCode: string): string` → `선행 <code> 이 후속 <n>건을 막고 있습니다(<h>시간째)`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/force-progress.test.ts`:

```ts
// 강제 진행(스펙 2026-09-23) 순수 판정 — 스텁 잔존(F6·F13)·하위 ref(§3.5)·계약(F4)·면제 가능·병목(F14).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOTTLENECK, STUB_DONE_STAGE, WAIVE_BLOCK_TEXT, blockedSinceMs, bottleneckText, findBottlenecks, hasContract,
  isStubRow, lastRefSegment, pendingStubs, stubBadgeText, stubLabel, stubPendingLock, stubTaskName, stubTaskRef,
  validateBottleneckSettings, waiveBlock,
} from '@/lib/domain/forceProgress'

const sub = (id: string, stubFor: string, stage: string | null) => ({ id, stubFor, externalRef: `m/TSK-02.stub.${lastRefSegment(stubFor)}`, stage })

describe('스텁 잔존 — 승인 잠금과 표시가 같은 함수', () => {
  it('xx 가 아닌 stub 하위가 있으면 잔존이다', () => {
    expect(STUB_DONE_STAGE).toBe('xx')
    const subs = [sub('s1', 'm/TSK-01', 'ip'), sub('s2', 'm/TSK-03', 'xx'), sub('s3', 'm/TSK-04', null)]
    expect(pendingStubs(subs).map(s => s.id)).toEqual(['s1', 's3'])
    expect(stubPendingLock(subs)).toBe(true)
    expect(stubPendingLock([sub('s2', 'm/TSK-03', 'xx')])).toBe(false)
    expect(stubPendingLock([])).toBe(false)
  })
  it('문구·배지·ref·이름', () => {
    expect(stubLabel('mdm/TSK-03-01')).toBe('스텁 잔존: TSK-03-01 대체')
    expect(stubBadgeText(1)).toBe('스텁 잔존')
    expect(stubBadgeText(2)).toBe('스텁 잔존 2')
    expect(stubTaskRef('mdm/TSK-03-02', 'mdm/TSK-03-01')).toBe('mdm/TSK-03-02.stub.TSK-03-01')
    expect(stubTaskName({ code: 'TSK-03-01', name: '주문 서비스' })).toBe('스텁 제거·실연결: TSK-03-01 주문 서비스')
  })
  it('stub_for 로 행을 판별한다(레벨·이름이 아니다)', () => {
    expect(isStubRow({ stub_for: 'm/TSK-01' })).toBe(true)
    expect(isStubRow({ stub_for: null })).toBe(false)
    expect(isStubRow({})).toBe(false)
  })
  it('하위 ref 의 마지막 칸은 dflow.sh 작업 폴더 규칙([A-Za-z0-9._-])을 통과한다', () => {
    expect(lastRefSegment(stubTaskRef('mdm/TSK-03-02', 'core/TSK-01-01'))).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})

describe('계약(F4)과 면제 가능 판정', () => {
  it('spec 본문 또는 acceptance 1건 이상이 계약이다', () => {
    expect(hasContract({ spec: '## API\n...', acceptance: [] })).toBe(true)
    expect(hasContract({ spec: '  ', acceptance: ['응답 200'] })).toBe(true)
    expect(hasContract({ spec: null, acceptance: [] })).toBe(false)
    expect(hasContract({ spec: '', acceptance: null })).toBe(false)
  })
  const succ = { externalRef: 'm/TSK-02', depends: ['m/TSK-01'], dependsWaived: [], stubFor: null, hasNormalChildren: false }
  const pred = { stage: 'ip', orderApproved: false, actualPct: 30, spec: '계약', acceptance: [] }
  it('정상 경우는 null', () => {
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred })).toBeNull()
  })
  it('차단 사유를 우선순위대로 돌려준다', () => {
    expect(waiveBlock({ successor: { ...succ, stubFor: 'm/X' }, predRef: 'm/TSK-01', pred })).toBe('is_stub_task')
    expect(waiveBlock({ successor: { ...succ, hasNormalChildren: true }, predRef: 'm/TSK-01', pred })).toBe('not_leaf')
    expect(waiveBlock({ successor: { ...succ, externalRef: null }, predRef: 'm/TSK-01', pred })).toBe('no_ref')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-09', pred })).toBe('not_in_depends')
    expect(waiveBlock({ successor: { ...succ, dependsWaived: ['m/TSK-01'] }, predRef: 'm/TSK-01', pred })).toBe('already_waived')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...pred, stage: 'im' } })).toBe('already_reached')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...pred, spec: null } })).toBe('no_contract')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: null })).toBe('no_contract')
    expect(WAIVE_BLOCK_TEXT.no_contract).toBe('선행 계약 없음')
  })
})

describe('병목(F14)', () => {
  const H = 3600_000
  it('기본값은 3건·4시간', () => {
    expect(DEFAULT_BOTTLENECK).toEqual({ minSuccessors: 3, minHours: 4 })
  })
  it('막힌 시각 = max(주문 updated_at, 계획 시작일 00:00 KST)', () => {
    expect(blockedSinceMs('2026-09-20T00:00:00Z', null)).toBe(Date.parse('2026-09-20T00:00:00Z'))
    expect(blockedSinceMs('2026-09-20T00:00:00Z', '2026-09-22')).toBe(Date.parse('2026-09-22T00:00:00+09:00'))
  })
  it('한 선행이 N건 이상을 T시간 넘게 막을 때만 제안한다 — T 는 가장 오래 막힌 후속 기준', () => {
    const now = Date.parse('2026-09-23T12:00:00Z')
    const blocked = [
      { itemId: 'a', unmetRefs: ['m/P1'], blockedSinceMs: now - 6 * H },
      { itemId: 'b', unmetRefs: ['m/P1'], blockedSinceMs: now - 1 * H },
      { itemId: 'c', unmetRefs: ['m/P1', 'm/P2'], blockedSinceMs: now - 1 * H },
      { itemId: 'd', unmetRefs: ['m/P2'], blockedSinceMs: now - 9 * H },
    ]
    const r = findBottlenecks(blocked, now, DEFAULT_BOTTLENECK)
    expect(r).toEqual([{ predRef: 'm/P1', successorIds: ['a', 'b', 'c'], hours: 6 }])
    expect(bottleneckText(r[0], 'TSK-03-01')).toBe('선행 TSK-03-01 이 후속 3건을 막고 있습니다(6시간째)')
    expect(findBottlenecks(blocked, now, { minSuccessors: 3, minHours: 7 })).toEqual([])
  })
  it('설정 검증 — 1 이상 정수', () => {
    expect(validateBottleneckSettings({ minSuccessors: 2, minHours: 8 })).toEqual({ ok: true, value: { minSuccessors: 2, minHours: 8 } })
    expect(validateBottleneckSettings({ minSuccessors: 0, minHours: 8 }).ok).toBe(false)
    expect(validateBottleneckSettings({ minSuccessors: 2.5, minHours: 8 }).ok).toBe(false)
    expect(validateBottleneckSettings(null).ok).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/force-progress.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/lib/domain/forceProgress.ts`:

```ts
// 강제 진행 — 순수 판정(스펙 docs/superpowers/specs/2026-09-23-force-progress-design.md). DB·세션을 모른다.
// 스텁 잔존(F6·F13)의 정의는 여기 하나다. RPC apply_workflow_event(0103)가 같은 조건을 SQL 로 복제하고
// tests/migrations/0103-force-progress.test.ts 가 대조한다.
import { predecessorReached } from './agentWork'

/** 하위 Task 가 이 단계면 스텁이 치워진 것이다. */
export const STUB_DONE_STAGE = 'xx'

export interface StubTaskLike { id: string; stubFor: string; externalRef: string | null; stage: string | null }

/** DB 행이 「스텁 제거·실연결」 하위 Task 인가 — 판별은 stub_for 플래그 하나다(레벨·이름 아님, SUB-ACT 선례). */
export function isStubRow(r: { stub_for?: string | null }): boolean {
  return typeof r.stub_for === 'string' && r.stub_for !== ''
}

/** 스텁이 아직 남은 하위 — stage 가 xx 가 아닌 것(null 포함). */
export function pendingStubs<T extends StubTaskLike>(subTasks: readonly T[]): T[] {
  return subTasks.filter(s => s.stage !== STUB_DONE_STAGE)
}

/** 후행 승인 잠금(F6) = 스텁 잔존(F13). */
export function stubPendingLock(subTasks: readonly StubTaskLike[]): boolean {
  return pendingStubs(subTasks).length > 0
}

export function lastRefSegment(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] || ref
}

export function stubLabel(predRef: string): string {
  return `스텁 잔존: ${lastRefSegment(predRef)} 대체`
}

export function stubBadgeText(count: number): string {
  return count > 1 ? `스텁 잔존 ${count}` : '스텁 잔존'
}

/** 하위 Task 의 external_ref. 마지막 칸이 dflow.sh 작업 폴더 이름이 된다. */
export function stubTaskRef(successorRef: string, predRef: string): string {
  return `${successorRef}.stub.${lastRefSegment(predRef)}`
}

export function stubTaskName(pred: { code: string; name: string }): string {
  return `스텁 제거·실연결: ${pred.code} ${pred.name}`
}

/** F4 — 서버가 볼 수 있는 계약: spec 본문 또는 acceptance 1건 이상. */
export function hasContract(p: { spec: string | null; acceptance: unknown }): boolean {
  if (typeof p.spec === 'string' && p.spec.trim() !== '') return true
  return Array.isArray(p.acceptance) && p.acceptance.length > 0
}

export type WaiveBlock = 'not_in_depends' | 'already_waived' | 'already_reached' | 'no_contract' | 'is_stub_task' | 'not_leaf' | 'no_ref'

export const WAIVE_BLOCK_TEXT: Record<WaiveBlock, string> = {
  not_in_depends: '이 작업의 선행이 아닙니다.',
  already_waived: '이미 강제 진행 중인 선행입니다.',
  already_reached: '선행이 이미 끝났습니다 — 강제 진행할 필요가 없습니다.',
  no_contract: '선행 계약 없음',
  is_stub_task: '스텁 제거 작업의 선행은 강제 진행할 수 없습니다.',
  not_leaf: '하위 항목이 있는 작업은 강제 진행할 수 없습니다.',
  no_ref: 'WBS 업로드로 만든 작업(external_ref 있음)만 강제 진행할 수 있습니다.',
}

/** 면제 가능 판정 — RPC set_dependency_waiver 가 같은 순서로 다시 판정한다(서버가 정본, 이건 버튼 상태용). */
export function waiveBlock(a: {
  successor: { externalRef: string | null; depends: string[] | null; dependsWaived: string[] | null; stubFor: string | null; hasNormalChildren: boolean }
  predRef: string
  pred: { stage: string | null; orderApproved: boolean; actualPct: number | null; spec: string | null; acceptance: unknown } | null
}): WaiveBlock | null {
  const s = a.successor
  if (s.stubFor) return 'is_stub_task'
  if (s.hasNormalChildren) return 'not_leaf'
  if (!s.externalRef) return 'no_ref'
  if (!(s.depends ?? []).includes(a.predRef)) return 'not_in_depends'
  if ((s.dependsWaived ?? []).includes(a.predRef)) return 'already_waived'
  if (a.pred && predecessorReached({ stage: a.pred.stage, orderApproved: a.pred.orderApproved, actualPct: a.pred.actualPct })) return 'already_reached'
  if (!a.pred || !hasContract(a.pred)) return 'no_contract'
  return null
}

export interface BottleneckSettings { minSuccessors: number; minHours: number }
export const DEFAULT_BOTTLENECK: BottleneckSettings = { minSuccessors: 3, minHours: 4 }

export function validateBottleneckSettings(raw: unknown):
  { ok: true; value: BottleneckSettings } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '설정 형식이 올바르지 않습니다.' }
  const r = raw as Record<string, unknown>
  const n = r.minSuccessors, h = r.minHours
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 1000) return { ok: false, error: '후속 건수는 1 이상 정수입니다.' }
  if (!Number.isInteger(h) || (h as number) < 1 || (h as number) > 720) return { ok: false, error: '시간은 1~720 정수입니다.' }
  return { ok: true, value: { minSuccessors: n as number, minHours: h as number } }
}

/** 막힌 시각(근사, 스펙 §3.2·§6-1) = max(ready 주문의 updated_at, 후속 계획 시작일 00:00 KST). */
export function blockedSinceMs(orderUpdatedAt: string, plannedStart: string | null): number {
  const u = Date.parse(orderUpdatedAt)
  const p = plannedStart ? Date.parse(`${plannedStart}T00:00:00+09:00`) : Number.NaN
  if (Number.isNaN(p)) return u
  if (Number.isNaN(u)) return p
  return Math.max(u, p)
}

export interface BlockedSuccessor { itemId: string; unmetRefs: string[]; blockedSinceMs: number }
export interface Bottleneck { predRef: string; successorIds: string[]; hours: number }

export function findBottlenecks(blocked: readonly BlockedSuccessor[], nowMs: number, s: BottleneckSettings): Bottleneck[] {
  const byPred = new Map<string, BlockedSuccessor[]>()
  for (const b of blocked) for (const ref of b.unmetRefs) {
    const l = byPred.get(ref); if (l) l.push(b); else byPred.set(ref, [b])
  }
  const out: Bottleneck[] = []
  for (const [predRef, list] of byPred) {
    if (list.length < s.minSuccessors) continue
    const oldest = Math.min(...list.map(b => b.blockedSinceMs))
    const hours = Math.floor((nowMs - oldest) / 3600_000)
    if (hours < s.minHours) continue
    out.push({ predRef, successorIds: list.map(b => b.itemId), hours })
  }
  return out.sort((a, b) => b.successorIds.length - a.successorIds.length || b.hours - a.hours)
}

export function bottleneckText(b: Bottleneck, predCode: string): string {
  return `선행 ${predCode} 이 후속 ${b.successorIds.length}건을 막고 있습니다(${b.hours}시간째)`
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/force-progress.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/forceProgress.ts tests/domain/force-progress.test.ts
git commit -m "feat(domain): 강제 진행 순수 판정 모듈을 둔다

스텁 잔존은 승인 잠금과 화면 표시가 같은 함수를 써야 한다. 하위 Task ref·계약 판정·
면제 가능 판정·병목 계산도 여기 모아 서버 액션과 화면이 같은 규칙을 쓰게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 마이그레이션 0103 (Task 2 뒤)

**Files:**
- Create: `supabase/migrations/0103_force_progress.sql`
- Create: `supabase/migrations/0103_force_progress_rollback.sql`
- Create: `scripts/checks/0103_force_progress_check.sql`
- Test: `tests/migrations/0103-force-progress.test.ts`

**Interfaces:**
- Produces (DB):
  - 컬럼 `wbs_items.depends_waived text[] not null default '{}'`, `wbs_items.stub_for text`, `project_settings.force_bottleneck_min_successors int not null default 3`, `project_settings.force_bottleneck_min_hours int not null default 4`.
  - 트리거 `wbs_items_prune_waived`(BEFORE UPDATE OF depends).
  - `set_dependency_waiver(p_item_id uuid, p_pred_ref text, p_waive boolean, p_reason text, p_actor uuid) returns jsonb` — `{ ok, reason?, changed, sub_task_id, sub_task_created }`. 실패 `reason` ∈ `reason_required|item_not_found|is_stub_task|not_leaf|no_ref|not_in_depends|pred_not_found|already_reached|no_contract`. service_role 만.
  - `apply_workflow_event` 재정의: 리프 = `stub_for is null` 인 자식 없음, `approve`·`set_stage xx` 는 스텁 잔존이면 `{ok:false, reason:'stub_pending'}`.

- [ ] **Step 1: 실패하는 문안 테스트 작성**

`tests/migrations/0103-force-progress.test.ts`:

```ts
// tests/migrations/0103-force-progress.test.ts — 강제 진행(스펙 2026-09-23). SQL 조건이 도메인(forceProgress.ts)과 같은지 대조한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BOTTLENECK, STUB_DONE_STAGE } from '@/lib/domain/forceProgress'

const s = () => readFileSync('supabase/migrations/0103_force_progress.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0103_force_progress_rollback.sql', 'utf8')
const fn = (name: string) => s().split(`create or replace function public.${name}`)[1]?.split('$$;')[0] ?? ''

describe('0103 강제 진행', () => {
  it('컬럼과 제약 — depends_waived ⊆ depends, stub_for 는 부모가 있어야 하고 간선당 하나', () => {
    const b = s()
    expect(b).toContain("add column if not exists depends_waived text[] not null default '{}'")
    expect(b).toContain('add column if not exists stub_for text')
    expect(b).toContain("check (depends_waived <@ coalesce(depends, '{}'::text[]))")
    expect(b).toContain('check (stub_for is null or parent_id is not null)')
    expect(b).toMatch(/create unique index if not exists wbs_items_stub_for_uidx\s+on public\.wbs_items \(parent_id, stub_for\) where stub_for is not null/)
  })
  it('병목 설정 기본값이 도메인과 같다', () => {
    expect(s()).toContain(`force_bottleneck_min_successors int not null default ${DEFAULT_BOTTLENECK.minSuccessors}`)
    expect(s()).toContain(`force_bottleneck_min_hours int not null default ${DEFAULT_BOTTLENECK.minHours}`)
  })
  it('depends 가 바뀌면 BEFORE 트리거가 depends_waived 를 줄이고 기록한다(CHECK 보다 먼저)', () => {
    const b = s()
    expect(b).toMatch(/create trigger wbs_items_prune_waived\s+before update of depends on public\.wbs_items/)
    expect(fn('wbs_items_prune_waived')).toContain("'depends_waived'")
    // user_id null 기록이 change_logs RLS(insert_own_log)에 막혀 UPDATE 전체가 실패하지 않게
    expect(fn('wbs_items_prune_waived').split('as $$')[0]).toContain('security definer')
    expect(fn('wbs_items_prune_waived').split('as $$')[0]).toContain('set search_path = public')
  })
  it('전이 RPC 의 리프 판정은 stub 하위를 빼고 본다', () => {
    expect(fn('apply_workflow_event')).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);')
  })
  it('스텁 잔존 조건이 도메인 pendingStubs 와 같다(stage 가 xx 가 아닌 stub 하위)', () => {
    const f = fn('apply_workflow_event')
    expect(f).toContain(`where parent_id = v_item_id and stub_for is not null and stage is distinct from '${STUB_DONE_STAGE}'`)
    expect(f).toContain("(p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx'))")
    expect(f).toContain("'reason', 'stub_pending'")
  })
  it('스텁 잔존 검사가 주문 갱신보다 앞에 있다(반쪽 승인 금지)', () => {
    const f = fn('apply_workflow_event')
    expect(f.indexOf("'stub_pending'")).toBeGreaterThan(-1)
    expect(f.indexOf("'stub_pending'")).toBeLessThan(f.indexOf('-- 주문 갱신'))
  })
  it('면제 RPC 는 후행을 잠그고, 선행 도달·계약·리프를 서버에서 다시 판정하고, 하위를 같은 트랜잭션에서 만든다', () => {
    const f = fn('set_dependency_waiver')
    expect(f).toContain('from public.wbs_items where id = p_item_id for update')
    for (const reason of ['reason_required', 'item_not_found', 'is_stub_task', 'not_leaf', 'no_ref', 'not_in_depends', 'pred_not_found', 'already_reached', 'no_contract']) {
      expect(f).toContain(`'${reason}'`)
    }
    expect(f).toContain("v_ref || '.stub.' || ")
    expect(f).toContain('insert into public.wbs_items')
    expect(f).toContain("'depends_waived'")
  })
  it('두 함수 모두 security invoker, service_role 만 실행', () => {
    const b = s()
    expect(fn('set_dependency_waiver').split('as $$')[0]).toContain('security invoker')
    expect(b).toContain('revoke all on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) from public, anon, authenticated')
    expect(b).toContain('grant execute on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) to service_role')
    expect(b).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(b).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('rollback — 하위 행과 그 활성 주문을 먼저 치우고(일반 자식으로 남으면 후행이 롤업 부모가 된다) 0097 본문으로 되돌린다', () => {
    const rb = r()
    expect(rb.indexOf("update public.agent_work_orders set status = 'cancelled'")).toBeLessThan(rb.indexOf('delete from public.wbs_items where stub_for is not null'))
    expect(rb.indexOf('delete from public.wbs_items where stub_for is not null')).toBeLessThan(rb.indexOf('drop column if exists stub_for'))
    expect(rb).toContain('drop function if exists public.set_dependency_waiver(uuid, text, boolean, text, uuid)')
    expect(rb).toContain('drop trigger if exists wbs_items_prune_waived on public.wbs_items')
    expect(rb).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id);')
    expect(rb).not.toContain('stub_pending')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/migrations/0103-force-progress.test.ts`
Expected: FAIL (ENOENT)

- [ ] **Step 3: 마이그레이션 작성 — 앞부분(컬럼·제약·트리거·면제 RPC)**

`supabase/migrations/0103_force_progress.sql` 를 아래 내용으로 만든다.

```sql
-- supabase/migrations/0103_force_progress.sql
-- 강제 진행 — 의존 간선 면제 + 스텁(docs/superpowers/specs/2026-09-23-force-progress-design.md).
-- ① wbs_items.depends_waived(면제한 선행 ref) ② wbs_items.stub_for(「스텁 제거·실연결」 하위 Task 표식, 구조에 투명)
-- ③ 병목 제안 설정 두 컬럼 ④ depends 축소 시 depends_waived 를 줄이는 트리거 ⑤ 면제 RPC set_dependency_waiver
-- ⑥ apply_workflow_event 재정의: 리프 판정에서 stub 하위 제외 + 스텁 잔존이면 승인·xx 지정 거부.
-- 사전 확인: select count(*) from public.wbs_items where depends is not null;  -- 영향 범위 참고용
-- 적용: npm run db:apply -- supabase/migrations/0103_force_progress.sql --target staging  (운영은 지시 뒤)
begin;

alter table public.wbs_items
  add column if not exists depends_waived text[] not null default '{}',
  add column if not exists stub_for text;

alter table public.wbs_items drop constraint if exists wbs_items_depends_waived_subset;
alter table public.wbs_items add constraint wbs_items_depends_waived_subset
  check (depends_waived <@ coalesce(depends, '{}'::text[]));
alter table public.wbs_items drop constraint if exists wbs_items_stub_for_parent;
alter table public.wbs_items add constraint wbs_items_stub_for_parent
  check (stub_for is null or parent_id is not null);
create unique index if not exists wbs_items_stub_for_uidx
  on public.wbs_items (parent_id, stub_for) where stub_for is not null;

alter table public.project_settings
  add column if not exists force_bottleneck_min_successors int not null default 3,
  add column if not exists force_bottleneck_min_hours int not null default 4;
alter table public.project_settings drop constraint if exists project_settings_force_bottleneck_positive;
alter table public.project_settings add constraint project_settings_force_bottleneck_positive
  check (force_bottleneck_min_successors >= 1 and force_bottleneck_min_hours >= 1);

-- depends 를 바꾸는 모든 쓰기(import_wbs_upsert 재업로드 등)가 면제한 선행을 빼면 depends_waived 를 교집합으로 줄인다.
-- CHECK 만 두면 재업로드 전체가 실패한다. 하위 Task 는 지우지 않는다(스펙 F12 와 같다).
-- security definer: 세션 클라이언트가 depends 를 쓰는 경로가 생겨도 change_logs 의 insert_own_log(user_id = auth.uid())
-- RLS 에 막혀 본 UPDATE 까지 실패하지 않게 한다(0098 broadcast 함수와 같은 선택).
create or replace function public.wbs_items_prune_waived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kept text[];
begin
  if coalesce(array_length(new.depends_waived, 1), 0) = 0 then
    return new;
  end if;
  v_kept := array(select w from unnest(new.depends_waived) as w where w = any(coalesce(new.depends, '{}'::text[])));
  if v_kept is distinct from new.depends_waived then
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (null, new.id, 'depends_waived', array_to_string(new.depends_waived, ','),
              array_to_string(v_kept, ',') || ' (depends 에서 빠짐)');
    new.depends_waived := v_kept;
  end if;
  return new;
end;
$$;

drop trigger if exists wbs_items_prune_waived on public.wbs_items;
create trigger wbs_items_prune_waived
  before update of depends on public.wbs_items
  for each row execute function public.wbs_items_prune_waived();

-- 면제·해제 한 트랜잭션(스펙 F8·§3.2). 판정 순서는 도메인 forceProgress.waiveBlock 과 같다(서버가 정본).
-- 권한은 서버 액션(requireSubtreeManagerOrAdmin)이 먼저 본다 — 이 함수는 service_role 전용.
create or replace function public.set_dependency_waiver(
  p_item_id  uuid,
  p_pred_ref text,
  p_waive    boolean,
  p_reason   text,
  p_actor    uuid
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_project uuid; v_ref text; v_depends text[]; v_waived text[]; v_stub_for text;
  v_assignee uuid; v_tags text[]; v_category text; v_model text; v_priority text;
  v_ps date; v_pe date;
  v_pred_id uuid; v_pred_code text; v_pred_name text; v_pred_stage text; v_pred_pct numeric;
  v_pred_spec text; v_pred_acc jsonb; v_pred_approved boolean;
  v_sub_id uuid; v_sub_created boolean := false; v_sort int; v_sub_name text; v_pred_last text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select project_id, external_ref, coalesce(depends, '{}'::text[]), depends_waived, stub_for,
         assignee_member_id, tags, category, model, priority, planned_start, planned_end
    into v_project, v_ref, v_depends, v_waived, v_stub_for,
         v_assignee, v_tags, v_category, v_model, v_priority, v_ps, v_pe
    from public.wbs_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'item_not_found'); end if;
  if v_stub_for is not null then return jsonb_build_object('ok', false, 'reason', 'is_stub_task'); end if;
  if exists (select 1 from public.wbs_items where parent_id = p_item_id and stub_for is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_leaf');
  end if;
  if v_ref is null then return jsonb_build_object('ok', false, 'reason', 'no_ref'); end if;
  if not (p_pred_ref = any(v_depends)) then return jsonb_build_object('ok', false, 'reason', 'not_in_depends'); end if;

  if not p_waive then
    -- 해제: 목록에서만 뺀다. 하위 Task 는 유지(F12 — 스텁이 이미 개발 브랜치에 있을 수 있다).
    if not (p_pred_ref = any(v_waived)) then
      return jsonb_build_object('ok', true, 'changed', false, 'sub_task_id', null, 'sub_task_created', false);
    end if;
    update public.wbs_items set depends_waived = array_remove(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', p_pred_ref, '해제 | ' || btrim(p_reason));
    return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', null, 'sub_task_created', false);
  end if;

  select id, code, name, stage, actual_pct, spec, acceptance
    into v_pred_id, v_pred_code, v_pred_name, v_pred_stage, v_pred_pct, v_pred_spec, v_pred_acc
    from public.wbs_items where project_id = v_project and external_ref = p_pred_ref;
  if not found then return jsonb_build_object('ok', false, 'reason', 'pred_not_found'); end if;
  v_pred_approved := exists (select 1 from public.agent_work_orders where wbs_item_id = v_pred_id and status = 'approved');
  -- 선행 충족 세 축(agentWork.predecessorReached) — 이미 도달이면 면제할 이유가 없다.
  if v_pred_stage in ('im', 'xx') or v_pred_approved or coalesce(v_pred_pct, 0) >= 100 then
    return jsonb_build_object('ok', false, 'reason', 'already_reached');
  end if;
  -- F4 계약(forceProgress.hasContract): spec 본문 ∨ acceptance 1건 이상.
  if coalesce(btrim(v_pred_spec), '') = ''
     and (jsonb_typeof(v_pred_acc) is distinct from 'array' or jsonb_array_length(v_pred_acc) = 0) then
    return jsonb_build_object('ok', false, 'reason', 'no_contract');
  end if;

  if not (p_pred_ref = any(v_waived)) then
    update public.wbs_items set depends_waived = array_append(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', null, p_pred_ref || ' | ' || btrim(p_reason));
  end if;

  -- 하위 Task — 간선당 하나(wbs_items_stub_for_uidx). 재면제는 기존 하위를 다시 쓴다.
  select id into v_sub_id from public.wbs_items where parent_id = p_item_id and stub_for = p_pred_ref;
  if v_sub_id is null then
    v_pred_last := regexp_replace(p_pred_ref, '^.*/', '');
    v_sub_name := '스텁 제거·실연결: ' || v_pred_code || ' ' || v_pred_name;
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.wbs_items where parent_id = p_item_id;
    insert into public.wbs_items (
      project_id, parent_id, code, sort_order, name, external_ref, stub_for, depends,
      dev_workflow, tags, assignee_member_id, category, model, priority, planned_start, planned_end, weight, spec
    ) values (
      v_project, p_item_id, v_pred_last, v_sort, v_sub_name, v_ref || '.stub.' || v_pred_last, p_pred_ref,
      array[p_pred_ref, v_ref],
      true, v_tags, v_assignee, v_category, v_model, v_priority, v_ps, v_pe, null,
      '## 스텁 제거·실연결' || E'\n\n'
      || '선행 ' || v_pred_code || '(' || p_pred_ref || ') 을 대신한 강제 진행 스텁을 실구현으로 바꾼다.' || E'\n\n'
      || '1. 개발 브랜치에서 `git grep -n ''FORCE-STUB: ' || v_pred_last || '''` 로 표식을 모두 찾는다.' || E'\n'
      || '2. 주입 지점을 선행의 실구현으로 바꾸고 `src/__stubs__/' || v_pred_last || '/` 같은 스텁 파일을 지운다.' || E'\n'
      || '3. 후행 ' || v_ref || ' 의 테스트를 실구현 상대로 다시 돌린다. 실패하면 계약 어긋남으로 보고한다.' || E'\n'
      || '4. 완료 조건: 표식 0건 + 후행 테스트 통과.'
    ) returning id into v_sub_id;
    v_sub_created := true;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, v_sub_id, 'created', null, v_sub_name);
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', v_sub_id, 'sub_task_created', v_sub_created);
end;
$$;

revoke all on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) to service_role;
```

- [ ] **Step 4: 마이그레이션 작성 — `apply_workflow_event` 재정의**

0097 의 함수 본문을 그대로 붙인 뒤 세 군데만 고친다.

```bash
sed -n '/^create or replace function public.apply_workflow_event/,$p' supabase/migrations/0097_stage_credits_single_table.sql >> supabase/migrations/0103_force_progress.sql
printf '\ncommit;\n' >> supabase/migrations/0103_force_progress.sql
```

붙인 본문(0103 파일 안)에서 편집한다.

1) declare 절 `v_reached_first boolean := false;` 다음 줄에 추가:

```sql
  v_stub_pending boolean := false;
```

2) 리프 판정 줄 교체:

```sql
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id);
```
→
```sql
      -- stub_for 하위(스텁 제거 Task)는 구조에 투명하다(스펙 F9) — 후행은 계속 리프다.
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);
```

3) `  -- 주문 갱신` 줄 바로 앞에 삽입:

```sql
  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

```

머리 주석 `-- supabase/migrations/0097_...` 로 시작하던 붙인 부분의 주석 줄은 없다(sed 가 `create or replace` 부터 복사한다). 파일 끝의 revoke/grant 두 줄(0097 에서 함께 복사됨)은 그대로 둔다.

- [ ] **Step 5: 롤백 작성**

```bash
cat > supabase/migrations/0103_force_progress_rollback.sql <<'SQL'
-- supabase/migrations/0103_force_progress_rollback.sql
-- 0103 되돌리기. 순서가 중요하다: stub 하위 행을 남긴 채 stub_for 컬럼을 지우면 그 행이 일반 자식이 되어
-- 후행을 롤업 부모로 바꾼다(실적 롤업·승인 skipped='parent'). 그래서 하위의 활성 주문을 먼저 취소하고 행을 지운다.
-- 사전 확인: select count(*) from public.wbs_items where stub_for is not null;
-- 스텁 코드 자체는 리포에 남는다 — 승격 관문(dflow.sh stub-check)으로 따로 확인한다.
begin;
update public.agent_work_orders set status = 'cancelled', updated_at = now()
 where status in ('ready', 'claimed', 'reported')
   and wbs_item_id in (select id from public.wbs_items where stub_for is not null);
delete from public.wbs_items where stub_for is not null;

drop function if exists public.set_dependency_waiver(uuid, text, boolean, text, uuid);
drop trigger if exists wbs_items_prune_waived on public.wbs_items;
drop function if exists public.wbs_items_prune_waived();
alter table public.project_settings drop constraint if exists project_settings_force_bottleneck_positive;
alter table public.project_settings
  drop column if exists force_bottleneck_min_successors,
  drop column if exists force_bottleneck_min_hours;
drop index if exists public.wbs_items_stub_for_uidx;
alter table public.wbs_items drop constraint if exists wbs_items_stub_for_parent;
alter table public.wbs_items drop constraint if exists wbs_items_depends_waived_subset;
alter table public.wbs_items drop column if exists stub_for;
alter table public.wbs_items drop column if exists depends_waived;
SQL
sed -n '/^create or replace function public.apply_workflow_event/,$p' supabase/migrations/0097_stage_credits_single_table.sql >> supabase/migrations/0103_force_progress_rollback.sql
printf '\ncommit;\n' >> supabase/migrations/0103_force_progress_rollback.sql
```

- [ ] **Step 6: 동작 검증 SQL 작성**

`scripts/checks/0103_force_progress_check.sql`:

```sql
-- scripts/checks/0103_force_progress_check.sql — 0103 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0103_force_progress_check.sql --target staging
begin;
do $$
declare
  u uuid; p uuid; v_pred uuid; v_succ uuid; v_order uuid; v_sub uuid; r jsonb; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into p from public.projects order by created_at limit 1;
  assert u is not null and p is not null, '검증용 사용자·프로젝트가 없다';

  insert into public.wbs_items (project_id, code, sort_order, name, external_ref, dev_workflow, spec)
    values (p, 'TSK-Z-01', 9001, '검증 선행', 'zz0103/TSK-Z-01', true, '## API 계약') returning id into v_pred;
  insert into public.wbs_items (project_id, code, sort_order, name, external_ref, dev_workflow, depends, stage, actual_pct)
    values (p, 'TSK-Z-02', 9002, '검증 후행', 'zz0103/TSK-Z-02', true, array['zz0103/TSK-Z-01'], 'im', 80) returning id into v_succ;
  insert into public.agent_work_orders (project_id, wbs_item_id, status, created_by)
    values (p, v_succ, 'reported', u) returning id into v_order;

  -- 1. 사유 없으면 거부
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, ' ', u);
  assert r->>'reason' = 'reason_required', '사유 없음이 통과했다';
  -- 2. 면제 → 하위 Task 생성(같은 트랜잭션)
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, '병목 해소', u);
  assert (r->>'ok')::boolean and (r->>'sub_task_created')::boolean, '면제 실패: ' || r::text;
  v_sub := (r->>'sub_task_id')::uuid;
  assert (select depends_waived = array['zz0103/TSK-Z-01'] from public.wbs_items where id = v_succ), 'depends_waived 미기록';
  assert (select external_ref = 'zz0103/TSK-Z-02.stub.TSK-Z-01' and stub_for = 'zz0103/TSK-Z-01' and parent_id = v_succ
                 and depends = array['zz0103/TSK-Z-01', 'zz0103/TSK-Z-02'] and dev_workflow
            from public.wbs_items where id = v_sub), '하위 Task 속성이 틀렸다';
  -- 3. 재면제는 하위를 새로 만들지 않는다
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, '재시도', u);
  assert not (r->>'sub_task_created')::boolean and (r->>'sub_task_id')::uuid = v_sub, '재면제가 하위를 또 만들었다';
  -- 4. 후행은 여전히 리프: 실적·단계 그대로, 승인은 stub_pending 으로 거부되고 주문은 reported 그대로
  assert (select stage = 'im' and actual_pct = 80 from public.wbs_items where id = v_succ), '후행 단계·실적이 바뀌었다';
  r := public.apply_workflow_event('approve', u, null, v_order);
  assert r->>'reason' = 'stub_pending', '스텁 잔존 승인이 통과했다: ' || r::text;
  assert (select status = 'reported' from public.agent_work_orders where id = v_order), '거부된 승인이 주문을 바꿨다';
  -- 5. 하위 xx 뒤 승인은 단계 xx·실적 100 을 한 번에(skipped 없음)
  update public.wbs_items set stage = 'xx' where id = v_sub;
  r := public.apply_workflow_event('approve', u, null, v_order);
  assert (r->>'ok')::boolean and r->>'stage' = 'xx' and (r->>'actual_pct')::numeric = 100 and r->>'skipped' is null,
    '하위 xx 뒤 승인이 반쪽이다: ' || r::text;
  -- 6. 해제는 하위를 남긴다
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', false, '선행 도착', u);
  assert (r->>'changed')::boolean, '해제 실패';
  assert exists (select 1 from public.wbs_items where id = v_sub), '해제가 하위를 지웠다';
  -- 7. depends 에서 빠지면 트리거가 depends_waived 를 줄이고 기록한다
  update public.wbs_items set depends_waived = array['zz0103/TSK-Z-01'] where id = v_succ;
  select count(*) into n from public.change_logs where wbs_item_id = v_succ and field = 'depends_waived';
  update public.wbs_items set depends = '{}' where id = v_succ;
  assert (select depends_waived = '{}'::text[] from public.wbs_items where id = v_succ), '트리거가 줄이지 않았다';
  assert (select count(*) from public.change_logs where wbs_item_id = v_succ and field = 'depends_waived') = n + 1, '축소 기록 없음';
  -- 8. 하위 Task 의 간선은 면제할 수 없다
  r := public.set_dependency_waiver(v_sub, 'zz0103/TSK-Z-01', true, 'x', u);
  assert r->>'reason' = 'is_stub_task', '하위의 간선이 면제됐다';
  raise notice 'FORCE_PROGRESS_CHECK_OK';
end $$;
rollback;
```

- [ ] **Step 7: 문안 테스트 통과 확인**

Run: `npx vitest run tests/migrations/0103-force-progress.test.ts tests/migrations/migration-ledger.test.ts`
Expected: PASS. `migration-ledger` 가 실패하면 그 테스트가 요구하는 원장 등록(파일 목록·번호 연속성)을 메시지대로 맞춘다 — 0102 가 아직 origin/staging 에 없어 번호가 비면, 원장 테스트의 허용 규칙을 확인하고 컨트롤러에 알린다(0102 는 과제 C 몫이라 여기서 만들지 않는다).

- [ ] **Step 8: 커밋(마이그레이션 단독 — G1)**

```bash
git add supabase/migrations/0103_force_progress.sql supabase/migrations/0103_force_progress_rollback.sql scripts/checks/0103_force_progress_check.sql tests/migrations/0103-force-progress.test.ts
git commit -m "feat(db): 0103 강제 진행 — 간선 면제·스텁 하위 Task·승인 잠금

면제와 하위 Task 생성을 한 RPC 트랜잭션으로 묶어 반쪽 상태를 없앤다. stub_for 하위는
리프 판정에서 빠지므로 후행은 계속 리프이고, 스텁이 남은 동안 승인·xx 지정은 주문 갱신
전에 거부된다. depends 축소는 트리거가 depends_waived 를 함께 줄인다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(스테이징 적용과 `Staging-verified:` 트레일러는 Task 11 이 한다.)

---

### Task 4: 트리에서 stub 하위를 투명하게 (Task 2 뒤, 병렬 가능 — 5·10 과)

**Files:**
- Modify: `src/lib/domain/types.ts` (`WbsRow.stubFor?`·`dependsWaived?`·`externalRef?`, `ComputedItem.subTasks`)
- Modify: `src/lib/domain/tree.ts` (`buildTree`), `src/lib/domain/rollup.ts` (`computeNode`)
- Modify: `src/lib/domain/wbsRealtime.ts` (`findNode`·`replaceNode`)
- Modify: `src/lib/domain/project-status.ts` (`computeCompletionMap`), `src/lib/domain/levelSettings.ts` (`treeMaxDepth`)
- Modify: `src/lib/data/wbs.ts` (행 매핑·`getProjectsCompletion` select·`mergeSpecDepends` 입력), `src/lib/data/snapshots.ts` (select), `src/app/(app)/projects/page.tsx` (select), `src/app/actions/project.ts:136` · `src/lib/agent/wbsImport.ts:218` (select 에 `stub_for`)
- Test: `tests/domain/tree-stub-subtasks.test.ts`(신규), 기존 `tests/domain/*tree*`·`*rollup*`·`project-status*`·`level-settings*`

**Interfaces:**
- Consumes: `isStubRow` (Task 2)
- Produces:
  - `WbsRow.stubFor?: string | null`, `WbsRow.externalRef?: string | null`, `WbsRow.dependsWaived?: string[]`
  - `ComputedItem.subTasks?: ComputedItem[]` — 선택 필드(`stage` 등과 같은 관례: 필수로 올리면 ComputedItem 리터럴을 만드는 테스트 수십 파일이 깨진다). `buildTree`·`computeNode` 는 항상 채우고, 읽는 쪽은 `n.subTasks ?? []`. `children` 에는 stub 하위가 절대 없다.
  - `TreeNode.subTasks?: TreeNode[]`
  - `CompletionRow.stubFor?: string | null` — stub 행은 완료 판정에서 빠진다.
  - `treeMaxDepth(rows: { id; parent_id; stub_for?: string | null }[])` — stub 행은 깊이 계산에서 빠진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/tree-stub-subtasks.test.ts`:

```ts
// 스텁 제거 하위 Task 는 구조에 투명하다(스펙 2026-09-23 F9) — children 이 아니라 subTasks 로 가고, 롤업·리프 판정에 들어가지 않는다.
import { describe, expect, it } from 'vitest'
import { buildTree, collectLeaves } from '@/lib/domain/tree'
import { computeTree } from '@/lib/domain/rollup'
import { computeCompletionMap } from '@/lib/domain/project-status'
import { treeMaxDepth } from '@/lib/domain/levelSettings'
import { applyWbsChange } from '@/lib/domain/wbsRealtime'
import type { WbsRow } from '@/lib/domain/types'

const row = (id: string, parentId: string | null, over: Partial<WbsRow> = {}): WbsRow => ({
  id, parentId, code: id, sortOrder: 1, name: id, biz: null, deliverable: null,
  plannedStart: '2026-09-01', plannedEnd: '2026-09-30', weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over,
})
const opts = { subActTeamOrder: new Map<string, number>() }
const rows = [
  row('wp', null),
  row('succ', 'wp', { actualPct: 80, stage: 'im' }),
  row('sub', 'succ', { actualPct: 30, stage: 'ip', stubFor: 'm/TSK-01' }),
  row('other', 'wp', { actualPct: 20 }),
]

describe('buildTree — stub 하위 분리', () => {
  it('stub 하위는 children 이 아니라 subTasks 에 들어간다', () => {
    const [wp] = buildTree(rows, opts)
    const succ = wp.children.find(c => c.id === 'succ')!
    expect(succ.children).toEqual([])
    expect(succ.subTasks!.map(s => s.id)).toEqual(['sub'])
    expect(succ.subTasks![0].depth).toBe(succ.depth + 1)
  })
  it('후행은 여전히 리프이고 롤업은 후행 자기 실적(80)을 쓴다', () => {
    const [wp] = computeTree(rows, '2026-09-15', new Set(), opts)
    const succ = wp.children.find(c => c.id === 'succ')!
    expect(succ.rolledActualPct).toBe(80)
    expect(wp.rolledActualPct).toBe(50) // (80 + 20) / 2 — 하위 30 은 들어가지 않는다
    expect(collectLeaves([wp]).map(l => l.id)).toEqual(['succ', 'other'])
    expect(succ.subTasks![0].rolledActualPct).toBe(30) // 하위 자신은 계산된다(표시용)
  })
  it('실시간 패치는 subTasks 안의 하위도 찾아 바꾸고, 후행 롤업은 그대로다', () => {
    const tree = computeTree(rows, '2026-09-15', new Set(), opts)
    const next = applyWbsChange(tree, { id: 'sub', projectId: 'p', stage: 'xx', actualPct: 100, updatedAt: '2026-09-23T00:00:00Z' }, { today: '2026-09-15', holidays: new Set() })
    const succ = next![0].children.find(c => c.id === 'succ')!
    expect(succ.subTasks![0].stage).toBe('xx')
    expect(next![0].rolledActualPct).toBe(50)
  })
})

describe('raw 행 판정도 투명하다', () => {
  it('완료 배지 — stub 행은 리프 집합에서도, 부모 판정에서도 빠진다', () => {
    const m = computeCompletionMap([
      { id: 'succ', parentId: null, projectId: 'p', actualPct: 100 },
      { id: 'sub', parentId: 'succ', projectId: 'p', actualPct: 0, stubFor: 'm/TSK-01' },
    ])
    expect(m.p).toEqual({ hasWbs: true, allDone: true })
  })
  it('레벨 깊이 — stub 행은 세지 않는다', () => {
    expect(treeMaxDepth([
      { id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 's', parent_id: 'b', stub_for: 'm/X' },
    ])).toBe(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/tree-stub-subtasks.test.ts`
Expected: FAIL (`subTasks` undefined)

- [ ] **Step 3: 구현**

`src/lib/domain/types.ts` — `WbsRow` 끝에:

```ts
  /**
   * 「스텁 제거·실연결」 하위 Task 표식(0103) — 대신한 선행의 external_ref. 값이 있으면 구조에 투명하다
   * (buildTree 가 children 이 아닌 subTasks 로 뺀다, 스펙 2026-09-23 F9). stage 와 같은 이유로 선택 필드다.
   */
  stubFor?: string | null
  /** 업로드 매칭 키(0077). 스텁 배지의 링크·문구 재료. */
  externalRef?: string | null
  /** 강제 진행으로 면제한 선행 ref(0103). */
  dependsWaived?: string[]
```

`ComputedItem` 에 `children` 옆으로 추가한다:

```ts
  /**
   * 「스텁 제거·실연결」 하위 Task(0103 stub_for) — 롤업·리프 판정에 들어가지 않는 표시 전용 자식(스펙 2026-09-23 F9).
   * 선택 필드인 이유는 WbsRow.stage 와 같다: 필수로 올리면 ComputedItem 리터럴을 만드는 테스트가 한꺼번에 깨진다.
   * buildTree·computeNode 는 항상 채운다 — 읽는 쪽은 `?? []`.
   */
  subTasks?: ComputedItem[]
```

`src/lib/domain/tree.ts`:

```ts
export type TreeNode = WbsRow & { children: TreeNode[]; subTasks?: TreeNode[]; depth: number }
```

`buildTree` 의 노드 생성·연결을 바꾼다:

```ts
  rows.forEach(r => byId.set(r.id, { ...r, children: [], subTasks: [], depth: 0 }))
  const roots: TreeNode[] = []
  byId.forEach(node => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) {
      // stub 하위는 구조에 투명하다(스펙 2026-09-23 F9) — 리프 판정·롤업이 보는 children 에 넣지 않는다.
      if (node.stubFor) (parent.subTasks ??= []).push(node)
      else parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
```

정렬 함수 `sort` 끝에 `ns.forEach(n => n.subTasks?.sort((a, b) => a.sortOrder - b.sortOrder))` 를, `assignDepth` 에 `n.subTasks?.forEach(c => assignDepth(c, d + 1))` 를 더한다. (부모를 못 찾은 stub 행은 고아라 root 로 간다 — 종전 고아 규칙과 같다.)

`src/lib/domain/rollup.ts` `computeNode` — `children` 계산 다음 줄:

```ts
  // stub 하위는 계산만 하고 롤업에는 넣지 않는다(F9). 표시(하위 행·스텁 배지)에 쓴다.
  const subTasks = (node.subTasks ?? []).map(c => computeNode(c, today, holidays))
```

반환 객체에 `subTasks,` 를 `children,` 옆에 더한다. (`node.subTasks ?? []` 는 `ComputedItem` 을 다시 돌릴 때와 옛 호출부 대비.)

`src/lib/domain/wbsRealtime.ts`:

```ts
function findNode(ns: readonly ComputedItem[], id: string): ComputedItem | null {
  for (const n of ns) {
    if (n.id === id) return n
    const hit = findNode(n.children, id) ?? findNode(n.subTasks ?? [], id)
    if (hit) return hit
  }
  return null
}

function replaceNode(ns: readonly ComputedItem[], p: WbsChangePayload): ComputedItem[] | null {
  let changed = false
  const next = ns.map(n => {
    if (n.id === p.id) {
      changed = true
      return { ...n, stage: p.stage, actualPct: p.actualPct, updatedAt: p.updatedAt }
    }
    const sub = replaceNode(n.children, p)
    const st = replaceNode(n.subTasks ?? [], p)
    if (sub === null && st === null) return n
    changed = true
    return { ...n, ...(sub ? { children: sub } : {}), ...(st ? { subTasks: st } : {}) }
  })
  return changed ? next : null
}
```

`src/lib/domain/project-status.ts`:

```ts
export function computeCompletionMap(rows: CompletionRow[]): Record<string, ProjectCompletion> {
  // stub 하위(0103 stub_for)는 구조에 투명하다 — 부모 판정에도 리프 집합에도 넣지 않는다(스펙 2026-09-23 F9).
  const live = rows.filter(r => !r.stubFor)
  const parents = new Set<string>()
  for (const r of live) if (r.parentId) parents.add(r.parentId)
  const map: Record<string, ProjectCompletion> = {}
  for (const r of live) {
    …기존 루프 본문 그대로…
  }
  return map
}
```

`CompletionRow` 에 `stubFor?: string | null` 을 더한다.

`src/lib/domain/levelSettings.ts` `treeMaxDepth` — 시그니처를 `rows: ReadonlyArray<{ id: string; parent_id: string | null; stub_for?: string | null }>` 로 넓히고 첫 줄에 `rows = rows.filter(r => !r.stub_for)` (매개변수 재할당 대신 `const live = …` 로 받아 이하 `rows` 를 `live` 로).

로더:
- `src/lib/data/wbs.ts` 행 매핑(`rows: WbsRow[]`)에 추가: `stubFor: (r.stub_for as string | null) ?? null, externalRef: (r.external_ref as string | null) ?? null, dependsWaived: (r.depends_waived as string[] | null) ?? [],` (select('*') 가 이미 싣는다). `mergeSpecDepends` 입력 매핑에 `dependsWaived: (r.depends_waived as string[] | null) ?? null` 을 더한다. `getProjectsCompletion` 의 select 를 `'id, parent_id, project_id, actual_pct, stub_for'` 로, 매핑에 `stubFor: (r.stub_for as string | null) ?? null` 을 더한다.
- `src/app/(app)/projects/page.tsx:47` 도 같은 select·매핑.
- `src/lib/data/snapshots.ts:67` select 에 `, stub_for` 를, 행 매핑에 `stubFor: (r.stub_for as string | null) ?? null` 을 더한다.
- `src/app/actions/project.ts:136`·`src/lib/agent/wbsImport.ts:218` 의 `select('id,parent_id')`/`select('id, parent_id')` 에 `stub_for` 를 더한다(`treeMaxDepth` 가 뺀다).

- [ ] **Step 4: 통과 확인(기존 포함)**

Run: `npx vitest run tests/domain tests/data tests/lib 2>&1 | tail -8 && npx tsc --noEmit -p .`
Expected: PASS(`subTasks` 는 선택 필드라 기존 픽스처는 그대로 컴파일된다).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/domain/tree.ts src/lib/domain/rollup.ts src/lib/domain/wbsRealtime.ts src/lib/domain/project-status.ts src/lib/domain/levelSettings.ts src/lib/data/wbs.ts src/lib/data/snapshots.ts "src/app/(app)/projects/page.tsx" src/app/actions/project.ts src/lib/agent/wbsImport.ts tests/domain/tree-stub-subtasks.test.ts
git commit -m "feat(wbs): 스텁 제거 하위 Task 를 트리에서 투명하게 둔다

stub_for 하위를 children 대신 subTasks 로 빼면 롤업·리프 판정을 쓰는 20여 곳이 그대로
후행을 리프로 본다. 트리를 거치지 않는 완료 배지·레벨 깊이·실시간 패치도 같은 규칙을 따른다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 서버 리프 판정·F11 가드·F15 조상 (Task 1·2 뒤, 병렬 가능 — 4·10 과)

**Files:**
- Modify: `src/app/actions/wbs.ts` (`updateActual`·`addWbsItem`·`addSubAct`)
- Modify: `src/app/actions/wbsAssign.ts` (`hasChildren` 세 곳: 194–206, 431–440, 445–456)
- Modify: `src/lib/agent/ensureOrder.ts` (Step 3)
- Modify: `src/lib/agent/assignee.ts` (`isSubtreeManager`), `src/lib/domain/seatmap.ts` (`isSubtreeManagerOf`·`AncestorLike`), `src/lib/data/agentApprovals.ts` (select)
- Modify: `src/lib/domain/agentHub.ts` (`hasChildren`), `src/lib/data/agentHub.ts` (`HUB_ITEM_COLS`), `src/lib/data/agentSeatmap.ts` (`ITEM_COLS`)
- Test: 기존 `tests/actions/wbs-update-actual-lock.test.ts`·`wbs-assign.test.ts`·`wbs-dev-workflow.test.ts`·`add-sub-act.test.ts` 빌더 보강, 신규 `tests/actions/wbs-stub-guards.test.ts`, `tests/domain/subtree-manager-stub.test.ts`

**Interfaces:**
- Consumes: `isStubRow`, `stubPendingLock` (Task 2), `deriveWaitReason({ waived })` (Task 1)
- Produces:
  - `AncestorLike` 에 `stub_for?: string | null`. `isSubtreeManagerOf(itemId, itemById, mine)` — 시작 항목이 stub 이면 조상 탐색을 **부모의 부모**부터 한다. `isSubtreeManager(admin, …)` 도 같다.
  - `HubItemRow.stub_for?: string | null`, seatmap `ItemRow.stub_for?: string | null`, `ItemRow.planned_start?: string | null`, `ItemRow.depends_waived?: string[] | null`.
  - `updateActual` 거부 문구 `STUB_LOCK_ACTUAL_MSG = '스텁이 남아 있어 완료(100)로 둘 수 없습니다 — 스텁 제거 작업이 끝나면 승인으로 완료합니다.'`(export, `src/app/actions/wbs.ts` 가 아니라 `src/lib/domain/forceProgress.ts` 에 두지 않는다 — 액션 문구라 액션 파일 상단 상수).

- [ ] **Step 1: 기존 테스트 빌더에 `is` 를 더한다**

아래 파일에서 체인 메서드 목록 배열(`['select', 'eq', 'in', 'limit', 'order']` 꼴)을 찾아 `'is'` 를 넣는다.

```bash
grep -ln "\['select', 'eq'" tests/actions/wbs-update-actual-lock.test.ts tests/actions/wbs-assign.test.ts tests/actions/wbs-dev-workflow.test.ts tests/actions/add-sub-act.test.ts tests/agent/*.test.ts
```

각 파일의 그 배열에 `'is'` 를 추가한다(예: `for (const k of ['select', 'eq', 'in', 'limit', 'order', 'is']) b[k] = () => b`). 목록이 아닌 객체 리터럴 빌더(`{ select: () => b, eq: () => b, … }`)는 `is: () => b` 를 더한다.

Run: `npx vitest run tests/actions tests/agent 2>&1 | tail -3`
Expected: PASS(아직 동작 변화 없음).

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/domain/subtree-manager-stub.test.ts`:

```ts
// F15 — stub 하위의 서브트리 관리자 판정은 후행(부모)을 조상으로 치지 않는다. 후행 담당자의 자기 승인을 막는다.
import { describe, expect, it } from 'vitest'
import { isSubtreeManagerOf, type AncestorLike } from '@/lib/domain/seatmap'

const items: AncestorLike[] = [
  { id: 'wp', parent_id: null, assignee_member_id: 'lead' },
  { id: 'succ', parent_id: 'wp', assignee_member_id: 'dev' },
  { id: 'sub', parent_id: 'succ', assignee_member_id: 'dev', stub_for: 'm/TSK-01' },
  { id: 'child', parent_id: 'succ', assignee_member_id: null },
]
const byId = new Map(items.map(i => [i.id, i]))

describe('isSubtreeManagerOf — stub 하위', () => {
  it('후행 담당자는 stub 하위의 서브트리 관리자가 아니다', () => {
    expect(isSubtreeManagerOf('sub', byId, new Set(['dev']))).toBe(false)
  })
  it('후행보다 위 조상의 담당자는 여전히 관리자다', () => {
    expect(isSubtreeManagerOf('sub', byId, new Set(['lead']))).toBe(true)
  })
  it('일반 자식은 종전대로 부모 담당자가 관리자다', () => {
    expect(isSubtreeManagerOf('child', byId, new Set(['dev']))).toBe(true)
  })
})
```

`tests/actions/wbs-stub-guards.test.ts` — `wbs-update-actual-lock.test.ts` 의 `server()` 헬퍼·mock 머리를 그대로 복사해 쓴다(파일 맨 위 `vi.hoisted`·`vi.mock` 블록과 `server`, `item`, `ADMIN` 정의까지). 그 아래:

```ts
import { addWbsItem } from '@/app/actions/wbs'

describe('updateActual — 스텁 잔존이면 100 거부(F6)', () => {
  it('stub 하위가 xx 가 아니면 사람 Task 라도 100 을 거부한다', async () => {
    server({
      wbs_items: [item({ tags: [] }), { data: null }, { data: [{ id: 's1', stub_for: 'm/TSK-01', external_ref: 'm/TSK-02.stub.TSK-01', stage: 'ip' }] }],
      agent_work_orders: [{ data: null }],
    })
    const r = await updateActual(W1, 100)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('스텁이 남아 있어')
  })
  it('stub 하위만 있으면 리프로 본다 — 99 는 저장된다', async () => {
    const { writes } = server({ wbs_items: [item({ tags: [] }), { data: null }, { data: [] }, { data: [{ id: W1 }] }] })
    expect((await updateActual(W1, 99)).ok).toBe(true)
    expect(writes.some(w => w.table === 'wbs_items')).toBe(true)
  })
})

describe('addWbsItem — F11', () => {
  it('stub 하위가 있는 후행에는 일반 하위를 추가할 수 없다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue(ADMIN)
    server({ wbs_items: [{ data: [{ sort_order: 1, is_owner_split: false, stub_for: 'm/TSK-01' }] }] })
    const r = await addWbsItem('p1', W1, '새 항목')
    expect(r).toEqual({ ok: false, error: '스텁 제거 작업이 있는 Task 에는 하위 항목을 추가할 수 없습니다' })
  })
  it('stub 하위 아래에는 추가할 수 없다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue(ADMIN)
    server({ wbs_items: [{ data: [] }, { data: { stub_for: 'm/TSK-01' } }] })
    const r = await addWbsItem('p1', 'sub-id', '새 항목')
    expect(r).toEqual({ ok: false, error: '스텁 제거 작업 아래에는 하위 항목을 둘 수 없습니다' })
  })
})
```

(`updateActual` 의 조회 순서가 Step 3 구현과 맞는지 — ① 항목 ② 일반 자식 존재 ③ stub 하위 목록 — 구현 후 테스트 큐 순서를 다시 확인한다.)

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/domain/subtree-manager-stub.test.ts tests/actions/wbs-stub-guards.test.ts`
Expected: FAIL

- [ ] **Step 4: 구현**

`src/lib/domain/seatmap.ts`:

```ts
export interface AncestorLike { id: string; parent_id: string | null; assignee_member_id: string | null; stub_for?: string | null }

export function isSubtreeManagerOf(
  itemId: string, itemById: ReadonlyMap<string, AncestorLike>, mine: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>()
  const start = itemById.get(itemId)
  let cur = start?.parent_id ?? null
  // stub 하위(0103)는 후행과 같은 자리로 본다 — 후행을 조상으로 치면 후행 담당자가 자기 스텁 제거를 승인한다(스펙 F15).
  if (start?.stub_for && cur !== null) cur = itemById.get(cur)?.parent_id ?? null
  while (cur !== null && !visited.has(cur)) {
    …기존 루프 그대로…
  }
  return false
}
```

`src/lib/agent/assignee.ts` `isSubtreeManager` — select 를 `'id, parent_id, assignee_member_id, stub_for'` 로, `AncestorRow` 에 `stub_for: string | null`, 루프 시작을:

```ts
  const start = byId.get(args.itemId)
  let cur = start?.parent_id ?? null
  if (start?.stub_for && cur !== null) cur = byId.get(cur)?.parent_id ?? null // 스펙 F15 — isSubtreeManagerOf 와 같은 규칙
```

`src/lib/data/agentApprovals.ts` — `ItemRow` 에 `stub_for: string | null`, select 를 `'id, parent_id, assignee_member_id, stub_for'`.

`src/lib/data/agentSeatmap.ts` — `ITEM_COLS` 를 `'id, project_id, code, name, parent_id, actual_pct, assignee_member_id, tags, depends, model, stub_for, depends_waived, planned_start, stage, external_ref'` 로. `src/lib/domain/seatmap.ts` `ItemRow` 에 `stub_for?: string | null; depends_waived?: string[] | null; planned_start?: string | null; stage?: string | null; external_ref?: string | null` 를 더한다.

`src/lib/data/agentHub.ts` — `HUB_ITEM_COLS` 끝에 `, stub_for, depends_waived`. `src/lib/domain/agentHub.ts` `HubItemRow` 에 `stub_for?: string | null; depends_waived?: string[] | null`, 그리고:

```ts
  // stub 하위는 구조에 투명하다(스펙 F9) — 후행을 부모로 만들지 않는다. 하위 행 자신은 표에 리프로 보인다.
  const hasChildren = new Set(rows.items.filter(i => !i.stub_for).map(i => i.parent_id).filter((x): x is string => x !== null))
```

`deriveWaitReason` 호출에 `waived: item.depends_waived ?? []` 를 더한다.

`src/lib/agent/ensureOrder.ts` Step 3 질의에 `.is('stub_for', null)` 을 `.eq('parent_id', wbsItemId)` 뒤에 더하고 주석 `// stub 하위는 리프 판정에 투명(0103, 스펙 F9)` .

`src/app/actions/wbsAssign.ts`:
- 194행 select 를 `'id, parent_id, name, assignee_member_id, stub_for'` 로, 203–206 의 `hasChildren` 채움에서 `if (r.parent_id && !r.stub_for) hasChildren.add(r.parent_id)` 로.
- 435행 질의에 `.is('stub_for', null)`.
- 445행 select 를 `'id, parent_id, tags, stub_for'` 로, 456 부근 `hasChildren.add(r.parent_id)` 앞에 `!r.stub_for` 조건.

`src/app/actions/wbs.ts`:
- 파일 상단 import 옆에 상수:

```ts
const STUB_LOCK_ACTUAL_MSG = '스텁이 남아 있어 완료(100)로 둘 수 없습니다 — 스텁 제거 작업이 끝나면 승인으로 완료합니다.'
```

- `updateActual` 의 자식 질의에 `.is('stub_for', null)`. D7 블록 **앞**(권한 판정 뒤)에:

```ts
  // 스텁 잔존(스펙 2026-09-23 F6) — 후행은 하위 스텁 제거가 xx 가 되기 전엔 100 이 될 수 없다. 위임 여부와 무관.
  if (newPct > 99) {
    const { data: subs, error: subErr } = await sb.from('wbs_items')
      .select('id, stub_for, external_ref, stage').eq('parent_id', itemId).not('stub_for', 'is', null)
    if (subErr) return { ok: false, error: `스텁 하위 확인 실패: ${subErr.message}` }
    const list = ((subs ?? []) as Array<{ id: string; stub_for: string; external_ref: string | null; stage: string | null }>)
      .map(s => ({ id: s.id, stubFor: s.stub_for, externalRef: s.external_ref, stage: s.stage }))
    if (stubPendingLock(list)) return { ok: false, error: STUB_LOCK_ACTUAL_MSG }
  }
```

(테스트 빌더에 `not` 도 필요하다 — Step 1 의 배열에 `'not'` 을 함께 넣는다.)

- `addWbsItem`: 형제 select 를 `'sort_order, is_owner_split, stub_for'` 로 바꾸고, SUB-ACT 가드 바로 뒤에:

```ts
  // F11 — stub 하위가 있는 후행에 일반 자식을 섞으면 후행이 롤업 부모가 되어 강제 진행 규칙이 무너진다.
  if (parentId && sibs.some(s => s.stub_for)) {
    return { ok: false, error: '스텁 제거 작업이 있는 Task 에는 하위 항목을 추가할 수 없습니다' }
  }
  if (parentId) {
    const { data: parentRow, error: parentErr } = await sb.from('wbs_items').select('stub_for').eq('id', parentId).maybeSingle()
    if (parentErr) return { ok: false, error: `상위 항목 조회 실패: ${parentErr.message}` }
    if ((parentRow as { stub_for: string | null } | null)?.stub_for) {
      return { ok: false, error: '스텁 제거 작업 아래에는 하위 항목을 둘 수 없습니다' }
    }
  }
```

  `nextOrder` 계산은 그대로(stub 행도 sort_order 를 차지하므로 포함). `discardRolledUpActual` 조건 `sibs.length === 0` 은 stub 하위가 있으면 위 가드에서 이미 끝나므로 그대로 둔다.
- `addSubAct` 형제 select 에 `stub_for` 를 더하고 가드 ①을 `if (sibs.some(s => s.stub_for)) return { ok: false, error: '스텁 제거 작업이 있는 항목에는 SUB-ACT 를 추가할 수 없습니다' }` 로 먼저 막는다.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/actions tests/agent tests/domain 2>&1 | tail -5 && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/wbs.ts src/app/actions/wbsAssign.ts src/lib/agent/ensureOrder.ts src/lib/agent/assignee.ts src/lib/domain/seatmap.ts src/lib/data/agentApprovals.ts src/lib/data/agentSeatmap.ts src/lib/data/agentHub.ts src/lib/domain/agentHub.ts tests/domain/subtree-manager-stub.test.ts tests/actions/wbs-stub-guards.test.ts tests/actions/wbs-update-actual-lock.test.ts tests/actions/wbs-assign.test.ts tests/actions/wbs-dev-workflow.test.ts tests/actions/add-sub-act.test.ts
git commit -m "feat(wbs): 서버 리프 판정에서 스텁 하위를 빼고 자기 승인을 막는다

자식 존재 질의가 stub_for 하위를 세면 후행이 주문·단계·실적 입력을 잃는다. 후행 담당자가
stub 하위의 서브트리 관리자로 판정되면 분리 원칙(자기 완료를 자기가 승인 못 함)이 깨진다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Step 1 에서 고친 `tests/agent/*` 파일도 이름으로 함께 stage 한다.)

---

### Task 6: 면제 액션·API evidence·계약 2.8 (Task 1·3 뒤)

**Files:**
- Create: `src/lib/agent/forceProgress.ts` (본체 — 'use server' 아님)
- Create: `src/app/actions/forceProgress.ts` (가드 + 본체 호출)
- Modify: `src/lib/agent/depends.ts` (`DependInfo.waived`, `loadDependsInfo(… waived)`), `ITEM_DETAIL_COLUMNS` 에 `depends_waived, stub_for`
- Modify: `src/app/api/v1/agent/work/[id]/claim/route.ts`, `src/app/api/v1/agent/work/[id]/route.ts`(show — `loadDependsInfo` 호출부)
- Modify: `src/lib/agent/workflowEvent.ts` (`REASON_TEXT.stub_pending`)
- Modify: `src/lib/agent/externalApi.ts` (`AGENT_CONTRACT_VERSION = '2.8'`)
- Test: `tests/actions/force-progress-actions.test.ts`(신규), `tests/agent/depends-waived.test.ts`(신규), 기존 claim 라우트 테스트

**Interfaces:**
- Consumes: RPC `set_dependency_waiver`(Task 3), `predecessorReached({waived})`(Task 1), `requireSubtreeManagerOrAdmin`, `ensureOrderForWorkflowLeaf`
- Produces:
  - `setDependencyWaiver(itemId: string, predRef: string, waive: boolean, reason: string): Promise<{ ok: true; subTaskId: string | null; subTaskCreated: boolean; warning?: string } | { ok: false; error: string }>` (서버 액션)
  - `cancelStubTask(subTaskId: string): Promise<{ ok: boolean; error?: string }>` (서버 액션)
  - `WAIVER_REASON_TEXT: Record<string, string>` (`src/lib/agent/forceProgress.ts`)
  - `DependInfo.waived: boolean`, `loadDependsInfo(admin, { projectId, depends, waived?: string[] })`
  - `REASON_TEXT.stub_pending = '스텁이 남아 있어 승인할 수 없습니다 — 스텁 제거 작업을 먼저 끝내세요.'`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/agent/depends-waived.test.ts`:

```ts
// depends_evidence.waived(계약 2.8) — 면제된 선행은 reached 가 참이다. claim 게이트와 스킬이 같은 값을 본다.
import { describe, expect, it } from 'vitest'
import { loadDependsInfo } from '@/lib/agent/depends'

function admin(items: unknown[]) {
  const q = (data: unknown) => {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
    b.maybeSingle = async () => ({ data: null, error: null })
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(r)
    return b
  }
  return { from: (t: string) => q(t === 'wbs_items' ? items : null) } as never
}

describe('loadDependsInfo — waived', () => {
  it('면제된 선행은 waived:true·reached:true, 나머지는 종전 판정', async () => {
    const out = await loadDependsInfo(admin([
      { id: 'a', external_ref: 'm/TSK-01', stage: 'ip', actual_pct: 30 },
      { id: 'b', external_ref: 'm/TSK-03', stage: 'ip', actual_pct: 30 },
    ]), { projectId: 'p', depends: ['m/TSK-01', 'm/TSK-03'], waived: ['m/TSK-01'] })
    expect(out.map(d => [d.external_ref, d.waived, d.reached])).toEqual([['m/TSK-01', true, true], ['m/TSK-03', false, false]])
  })
  it('프로젝트에 없는 ref 라도 면제면 reached 다', async () => {
    const out = await loadDependsInfo(admin([]), { projectId: 'p', depends: ['m/GONE'], waived: ['m/GONE'] })
    expect(out[0]).toEqual(expect.objectContaining({ waived: true, reached: true }))
  })
})
```

`tests/actions/force-progress-actions.test.ts`:

```ts
// 면제·해제·하위 취소 액션 — 가드(관리자·서브트리 관리자)·사유 필수·RPC 사유 문구·하위 주문 보장·취소 거부.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveProjectId: vi.fn(), requireSubtreeManagerOrAdmin: vi.fn(), createAdminClient: vi.fn(), ensureOrder: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ resolveProjectId: mocks.resolveProjectId }))
vi.mock('@/lib/agent/subtreeManager', () => ({ requireSubtreeManagerOrAdmin: mocks.requireSubtreeManagerOrAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrder }))

import { cancelStubTask, setDependencyWaiver } from '@/app/actions/forceProgress'

const ITEM = '44444444-4444-4444-8444-444444444444'
const SUB = '55555555-5555-4555-8555-555555555555'

function adminWith(opts: { rpc?: unknown; tables?: Record<string, Array<{ data?: unknown; error?: unknown }>> }) {
  const rpc = vi.fn(async () => ({ data: opts.rpc ?? null, error: null }))
  const writes: Array<{ table: string; op: string; payload?: unknown }> = []
  const from = (t: string) => {
    const resp = (opts.tables?.[t] ?? []).shift() ?? { data: null, error: null }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'is', 'not', 'limit']) b[k] = () => b
    b.update = (payload: unknown) => { writes.push({ table: t, op: 'update', payload }); return b }
    b.delete = () => { writes.push({ table: t, op: 'delete' }); return b }
    b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
    b.single = b.maybeSingle
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
    return b
  }
  mocks.createAdminClient.mockReturnValue({ rpc, from })
  return { rpc, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  mocks.requireSubtreeManagerOrAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u1' }, isAdmin: true })
  mocks.ensureOrder.mockResolvedValue({ ok: true, created: true })
})

describe('setDependencyWaiver', () => {
  it('가드가 거부하면 RPC 를 부르지 않는다', async () => {
    mocks.requireSubtreeManagerOrAdmin.mockResolvedValue({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
    const { rpc } = adminWith({})
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: false, error: '관리자 또는 서브트리 관리자만 할 수 있습니다.' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('사유가 비면 거부한다', async () => {
    adminWith({})
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '  ')).toEqual({ ok: false, error: '사유를 입력하세요.' })
  })
  it('면제 성공 — 하위가 새로 생기면 그 주문을 보장한다', async () => {
    const { rpc } = adminWith({ rpc: { ok: true, changed: true, sub_task_id: SUB, sub_task_created: true } })
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: true, subTaskId: SUB, subTaskCreated: true })
    expect(rpc).toHaveBeenCalledWith('set_dependency_waiver', { p_item_id: ITEM, p_pred_ref: 'm/TSK-01', p_waive: true, p_reason: '병목', p_actor: 'u1' })
    expect(mocks.ensureOrder).toHaveBeenCalledWith(expect.anything(), { projectId: 'p1', wbsItemId: SUB, actorUserId: 'u1' })
  })
  it('하위 주문 보장 실패는 면제를 되돌리지 않고 warning 으로 드러낸다', async () => {
    adminWith({ rpc: { ok: true, changed: true, sub_task_id: SUB, sub_task_created: true } })
    mocks.ensureOrder.mockResolvedValue({ ok: false, error: 'db down' })
    const r = await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')
    expect(r).toEqual(expect.objectContaining({ ok: true, warning: expect.stringContaining('db down') }))
  })
  it('RPC 거부 사유는 사람 문구로', async () => {
    adminWith({ rpc: { ok: false, reason: 'no_contract' } })
    expect(await setDependencyWaiver(ITEM, 'm/TSK-01', true, '병목')).toEqual({ ok: false, error: '선행 계약 없음' })
  })
})

describe('cancelStubTask', () => {
  it('stub 하위가 아니면 거부한다', async () => {
    adminWith({ tables: { wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: null } }] } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: false, error: '스텁 제거 작업이 아닙니다.' })
  })
  it('에이전트가 쥔 주문(claimed·reported)이 있으면 거부한다', async () => {
    adminWith({ tables: {
      wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: 'm/TSK-01' } }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'claimed' }] }],
    } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: false, error: '에이전트가 작업 중이거나 보고한 스텁 제거 작업은 취소할 수 없습니다 — 중단·반려로 먼저 정리하세요.' })
  })
  it('ready 주문을 취소하고 행을 지운다(가드는 후행 기준)', async () => {
    const { writes } = adminWith({ tables: {
      wbs_items: [{ data: { id: SUB, parent_id: ITEM, stub_for: 'm/TSK-01' } }, { data: [{ id: SUB }] }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'ready' }] }, { data: [{ id: 'o1' }] }],
    } })
    expect(await cancelStubTask(SUB)).toEqual({ ok: true })
    expect(mocks.requireSubtreeManagerOrAdmin).toHaveBeenCalledWith(ITEM, 'p1')
    expect(writes.map(w => `${w.table}:${w.op}`)).toEqual(['agent_work_orders:update', 'wbs_items:delete'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/depends-waived.test.ts tests/actions/force-progress-actions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 — evidence·문구·계약**

`src/lib/agent/depends.ts`:
- `DependInfo` 에 `/** 강제 진행으로 면제한 간선(계약 v2.8). 참이면 reached 도 참이다. */ waived: boolean` 추가.
- `ITEM_DETAIL_COLUMNS` 끝에 `, depends_waived, stub_for` 를 더한다.
- 시그니처 `args: { projectId: string; depends: string[]; waived?: string[] }`, 루프 맨 앞 `const waived = (args.waived ?? []).includes(ref)`. 미해석 분기의 push 를 `{ …, waived, reached: waived }` 로, 정상 분기 push 에 `waived,` 와 `reached: predecessorReached({ stage: item.stage, orderApproved: order !== null, actualPct, waived })` 로.

claim 라우트: `type ItemDetail` 에 `depends_waived?: string[] | null` 을 더하고 호출을 `loadDependsInfo(admin, { projectId: loaded.order.project_id, depends, waived: item?.depends_waived ?? [] })` 로. show 라우트(`src/app/api/v1/agent/work/[id]/route.ts`)의 `loadDependsInfo` 호출도 같게.

`src/lib/agent/workflowEvent.ts` `REASON_TEXT` 에:

```ts
  stub_pending: '스텁이 남아 있어 승인할 수 없습니다 — 스텁 제거 작업을 먼저 끝내세요.',
```

`src/lib/agent/externalApi.ts`: `export const AGENT_CONTRACT_VERSION = '2.8'`. 이 상수를 기대하는 기존 테스트(`grep -rn "AGENT_CONTRACT_VERSION\|contract_version" tests/agent tests/api` 로 찾는다)를 `'2.8'` 로.

- [ ] **Step 4: 구현 — 본체와 액션**

`src/lib/agent/forceProgress.ts`:

```ts
// 강제 진행 본체(스펙 2026-09-23 §3.2·F8·F12). 'use server' 파일이 아니다 — 가드 없는 본체를 액션 모듈에 두면
// 누구나 부를 수 있는 액션이 된다(delegation.ts 와 같은 분리).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { WAIVE_BLOCK_TEXT } from '@/lib/domain/forceProgress'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'

export const WAIVER_REASON_TEXT: Record<string, string> = {
  ...WAIVE_BLOCK_TEXT,
  reason_required: '사유를 입력하세요.',
  item_not_found: '항목 없음',
  pred_not_found: '선행 작업을 프로젝트에서 찾을 수 없습니다.',
}

export async function applyWaiver(
  admin: AdminClient,
  a: { projectId: string; itemId: string; predRef: string; waive: boolean; reason: string; actorUserId: string },
): Promise<{ ok: true; subTaskId: string | null; subTaskCreated: boolean; warning?: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('set_dependency_waiver', {
    p_item_id: a.itemId, p_pred_ref: a.predRef, p_waive: a.waive, p_reason: a.reason, p_actor: a.actorUserId,
  })
  if (error) return { ok: false, error: `강제 진행 처리 실패: ${error.message}` }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; sub_task_id?: string | null; sub_task_created?: boolean }
  if (r.ok !== true) return { ok: false, error: WAIVER_REASON_TEXT[r.reason ?? ''] ?? `강제 진행 처리 실패(${r.reason ?? 'unknown'})` }
  const subTaskId = r.sub_task_id ?? null
  const subTaskCreated = r.sub_task_created === true
  if (subTaskId) {
    // 하위 주문은 트랜잭션 밖에서 보장한다 — 실패해도 면제·하위는 이미 커밋됐고, 위임 토글·백필이 다시 만든다(멱등).
    const ord = await ensureOrderForWorkflowLeaf(admin, { projectId: a.projectId, wbsItemId: subTaskId, actorUserId: a.actorUserId })
    if (!ord.ok) {
      console.error('[forceProgress] 하위 주문 보장 실패:', subTaskId, ord.error)
      return { ok: true, subTaskId, subTaskCreated, warning: `스텁 제거 작업은 만들었지만 주문 발행에 실패했습니다 — ${ord.error}` }
    }
  }
  return { ok: true, subTaskId, subTaskCreated }
}

export const ERR_NOT_STUB = '스텁 제거 작업이 아닙니다.'
export const ERR_STUB_HELD = '에이전트가 작업 중이거나 보고한 스텁 제거 작업은 취소할 수 없습니다 — 중단·반려로 먼저 정리하세요.'

/** F12 — 스텁이 아직 없을 때 사람이 하위 Task 를 치운다. ready 주문 취소 → 행 삭제. 에이전트가 쥐었으면 거부. */
export async function cancelStub(admin: AdminClient, subTaskId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: orders, error: oErr } = await admin.from('agent_work_orders').select('id, status')
    .eq('wbs_item_id', subTaskId).in('status', ['ready', 'claimed', 'reported'])
  if (oErr) return { ok: false, error: `주문 조회 실패: ${oErr.message}` }
  const list = (orders ?? []) as Array<{ id: string; status: string }>
  if (list.some(o => o.status !== 'ready')) return { ok: false, error: ERR_STUB_HELD }
  if (list.length > 0) {
    const { data: done, error: cErr } = await admin.from('agent_work_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', list.map(o => o.id)).eq('status', 'ready').select('id')
    if (cErr) return { ok: false, error: `주문 취소 실패: ${cErr.message}` }
    if (((done ?? []) as unknown[]).length !== list.length) return { ok: false, error: '상태가 바뀌어 취소하지 못했습니다. 다시 시도하세요.' }
  }
  const { data: del, error: dErr } = await admin.from('wbs_items').delete().eq('id', subTaskId).not('stub_for', 'is', null).select('id')
  if (dErr) return { ok: false, error: `삭제 실패: ${dErr.message}` }
  if (((del ?? []) as unknown[]).length === 0) return { ok: false, error: ERR_NOT_STUB }
  return { ok: true }
}
```

`src/app/actions/forceProgress.ts`:

```ts
'use server'
// 강제 진행 액션 — 가드만 하고 본체(src/lib/agent/forceProgress.ts)를 부른다. 권한: 관리자 또는 후행의 서브트리 관리자(스펙 §3.2).
import { revalidatePath } from 'next/cache'
import { resolveProjectId } from '@/lib/authz'
import { requireSubtreeManagerOrAdmin } from '@/lib/agent/subtreeManager'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { ERR_NOT_STUB, applyWaiver, cancelStub } from '@/lib/agent/forceProgress'

export async function setDependencyWaiver(itemId: string, predRef: string, waive: boolean, reason: string) {
  if (!isUuidLike(itemId) || typeof predRef !== 'string' || predRef.trim() === '') return { ok: false as const, error: '잘못된 요청입니다.' }
  if (typeof reason !== 'string' || reason.trim() === '') return { ok: false as const, error: '사유를 입력하세요.' }
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false as const, error: found.error }
  if (!found.projectId) return { ok: false as const, error: '프로젝트 확인 실패' }
  const g = await requireSubtreeManagerOrAdmin(itemId, found.projectId)
  if (!g.ok) return { ok: false as const, error: g.error }
  const r = await applyWaiver(createAdminClient(), {
    projectId: found.projectId, itemId, predRef: predRef.trim(), waive, reason: reason.trim(), actorUserId: g.actor.userId,
  })
  if (r.ok) revalidatePath(`/p/${found.projectId}`, 'layout')
  return r
}

export async function cancelStubTask(subTaskId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(subTaskId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data: row, error } = await admin.from('wbs_items').select('id, parent_id, stub_for').eq('id', subTaskId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  const sub = row as { id: string; parent_id: string | null; stub_for: string | null } | null
  if (!sub) return { ok: false, error: '항목 없음' }
  if (!sub.stub_for || !sub.parent_id) return { ok: false, error: ERR_NOT_STUB }
  const found = await resolveProjectId('wbs_items', sub.parent_id)
  if (!found.ok) return { ok: false, error: found.error }
  if (!found.projectId) return { ok: false, error: '프로젝트 확인 실패' }
  // 권한은 후행 기준 — 면제와 같은 사람이 치운다.
  const g = await requireSubtreeManagerOrAdmin(sub.parent_id, found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const r = await cancelStub(admin, subTaskId)
  if (r.ok) revalidatePath(`/p/${found.projectId}`, 'layout')
  return r
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/agent tests/actions tests/api 2>&1 | tail -5 && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/forceProgress.ts src/app/actions/forceProgress.ts src/lib/agent/depends.ts src/lib/agent/workflowEvent.ts src/lib/agent/externalApi.ts "src/app/api/v1/agent/work/[id]/claim/route.ts" "src/app/api/v1/agent/work/[id]/route.ts" tests/agent/depends-waived.test.ts tests/actions/force-progress-actions.test.ts
git commit -m "feat(agent): 강제 진행 면제·해제·하위 취소 액션과 depends_evidence.waived

면제는 RPC 한 트랜잭션이고 하위 주문 보장만 트랜잭션 밖에서 멱등으로 한다. claim 게이트와
스킬이 같은 판정을 보도록 evidence 에 waived 를 싣고 계약을 2.8 로 올린다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(계약 버전 기대값을 고친 기존 테스트 파일도 이름으로 함께 stage 한다.)

---

### Task 7: WBS 화면 — 하위 행·스텁 배지·사이드바 「강제 진행」 (Task 4·6 뒤)

**Files:**
- Create: `src/components/wbs/StubBadge.tsx`, `src/components/wbs/ForceProgressSection.tsx`, `src/components/wbs/sheetTree.ts`(평탄화·조상 경로 순수 함수 — 테스트가 컴포넌트 모듈을 끌어오지 않게)
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (`flatten`·조상 경로·작업명 칸), `src/components/wbs/RowDetailPanel.tsx` (절 배치), `src/components/wbs/WbsSpecPanel.tsx` (승인 버튼)
- Modify: `src/lib/i18n/dict/wbs.ko.ts` · `wbs.en.ts`
- Test: `tests/components/wbs-stub-badge.test.tsx`(신규), `tests/components/wbs-force-progress-section.test.tsx`(신규), `tests/components/wbs-gantt-stub-rows.test.ts`(신규)

**Interfaces:**
- Consumes: `ComputedItem.subTasks`·`stubFor`·`externalRef`·`dependsWaived`(Task 4), `pendingStubs`·`stubLabel`·`stubBadgeText`·`waiveBlock`·`WAIVE_BLOCK_TEXT`(Task 2), `setDependencyWaiver`·`cancelStubTask`(Task 6)
- Produces:
  - `StubBadge({ stubs, onOpen }: { stubs: StubTaskLike[]; onOpen?: (subTaskId: string) => void })` — `stubs` 는 이미 `pendingStubs` 로 거른 목록. 0건이면 `null`.
  - `ForceProgressSection({ item, itemByRef, editable, onSelectItem })` — `itemByRef: Map<string, ComputedItem>`.
  - `src/components/wbs/sheetTree.ts`: `flattenForSheet(items: ComputedItem[], collapsed: Set<string>): ComputedItem[]`(`n.subTasks` 를 `n.children` 뒤에 잇는다), `findAncestorPath(items: ComputedItem[], id: string): string[] | null`(subTasks 도 탄다). `WbsGanttSheet` 의 기존 `flatten`·`ancestorPath` 를 이것으로 옮긴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/components/wbs-stub-badge.test.tsx`(이 리포 컴포넌트 테스트 관례 — jsdom + `createRoot`·`act`, testing-library 없음):

```tsx
// tests/components/wbs-stub-badge.test.tsx
// @vitest-environment jsdom
// 스텁 잔존 배지(스펙 F13) — 문구·툴팁·링크가 같은 함수에서 나온다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StubBadge } from '@/components/wbs/StubBadge'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const s = (id: string, stubFor: string) => ({ id, stubFor, externalRef: null, stage: 'ip' })
const badge = () => host.querySelector('[data-stub-badge]') as HTMLButtonElement | null

describe('StubBadge', () => {
  it('0건이면 그리지 않는다', () => {
    act(() => root.render(<StubBadge stubs={[]} />))
    expect(badge()).toBeNull()
  })
  it('1건: 「스텁 잔존」, 툴팁에 대체 선행, 누르면 그 하위로', () => {
    const onOpen = vi.fn()
    act(() => root.render(<StubBadge stubs={[s('sub1', 'mdm/TSK-03-01')]} onOpen={onOpen} />))
    expect(badge()!.textContent).toBe('스텁 잔존')
    expect(badge()!.getAttribute('title')).toBe('스텁 잔존: TSK-03-01 대체')
    act(() => badge()!.click())
    expect(onOpen).toHaveBeenCalledWith('sub1')
  })
  it('2건: 「스텁 잔존 2」, 툴팁은 한 줄씩', () => {
    act(() => root.render(<StubBadge stubs={[s('a', 'm/TSK-01'), s('b', 'm/TSK-02')]} onOpen={() => {}} />))
    expect(badge()!.textContent).toBe('스텁 잔존 2')
    expect(badge()!.getAttribute('title')).toBe('스텁 잔존: TSK-01 대체\n스텁 잔존: TSK-02 대체')
  })
})
```

`tests/components/wbs-gantt-stub-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findAncestorPath, flattenForSheet } from '@/components/wbs/sheetTree'
import type { ComputedItem } from '@/lib/domain/types'

const n = (id: string, over: Partial<ComputedItem> = {}): ComputedItem => ({
  id, parentId: null, code: id, sortOrder: 1, name: id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, children: [], subTasks: [], depth: 0,
  plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started', ...over,
} as ComputedItem)

const sub = n('sub', { parentId: 'succ', depth: 2, stubFor: 'm/TSK-01' })
const succ = n('succ', { parentId: 'wp', depth: 1, subTasks: [sub] })
const wp = n('wp', { children: [succ] })

describe('WBS 표 — stub 하위 행', () => {
  it('하위는 후행 바로 뒤에 온다', () => {
    expect(flattenForSheet([wp], new Set()).map(x => x.id)).toEqual(['wp', 'succ', 'sub'])
  })
  it('부모를 접으면 하위도 숨는다', () => {
    expect(flattenForSheet([wp], new Set(['wp'])).map(x => x.id)).toEqual(['wp'])
  })
  it('?focus= 조상 경로가 subTasks 를 탄다', () => {
    expect(findAncestorPath([wp], 'sub')).toEqual(['wp', 'succ'])
  })
})
```

`tests/components/wbs-force-progress-section.test.tsx`:

```tsx
// tests/components/wbs-force-progress-section.test.tsx
// @vitest-environment jsdom
// 사이드바 「강제 진행」 절 — 선행별 상태·버튼·사유 입력·스텁 잔존 목록.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const actions = vi.hoisted(() => ({ setDependencyWaiver: vi.fn(), cancelStubTask: vi.fn() }))
vi.mock('@/app/actions/forceProgress', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ForceProgressSection } from '@/components/wbs/ForceProgressSection'
import type { ComputedItem } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks()
  actions.setDependencyWaiver.mockResolvedValue({ ok: true, subTaskId: 's1', subTaskCreated: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const base = (id: string, over: Partial<ComputedItem>): ComputedItem => ({
  id, parentId: null, code: id, sortOrder: 1, name: id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], isOwnerSplit: false, children: [], subTasks: [], depth: 0,
  plannedPct: 0, rolledActualPct: 0, achievement: 0, status: 'not_started', ...over,
} as ComputedItem)
const pred = base('pred', { code: 'TSK-03-01', name: '주문 서비스', externalRef: 'm/TSK-03-01', stage: 'ip', rolledActualPct: 30, spec: '## API', acceptance: [] })
const succ = base('succ', { externalRef: 'm/TSK-03-02', depends: ['m/TSK-03-01'], dependsWaived: [], stage: 'im' })
const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
const setInput = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }))
}
const draw = (item: ComputedItem, map = new Map([['m/TSK-03-01', pred]]), editable = true, onSelectItem = vi.fn()) => {
  act(() => root.render(<ForceProgressSection item={item} itemByRef={map} editable={editable} onSelectItem={onSelectItem} />))
  return onSelectItem
}

describe('ForceProgressSection', () => {
  it('미도달 선행에 「강제 진행」, 사유 없이는 확정할 수 없다', async () => {
    draw(succ)
    await act(async () => { (q('[data-waive="m/TSK-03-01"]') as HTMLButtonElement).click() })
    const ok = q('[data-waive-confirm]') as HTMLButtonElement
    expect(ok.textContent).toBe('강제 진행 확정')
    expect(ok.disabled).toBe(true)
    await act(async () => { setInput(q('[data-waive-reason]') as HTMLInputElement, '병목') })
    expect(ok.disabled).toBe(false)
    await act(async () => { ok.click() })
    expect(actions.setDependencyWaiver).toHaveBeenCalledWith('succ', 'm/TSK-03-01', true, '병목')
  })
  it('면제된 간선은 「면제 해제」, 스텁 잔존 목록이 하위로 링크된다', async () => {
    const sub = base('s1', { stubFor: 'm/TSK-03-01', externalRef: 'm/TSK-03-02.stub.TSK-03-01', stage: 'ip' })
    const onSelect = draw({ ...succ, dependsWaived: ['m/TSK-03-01'], subTasks: [sub] })
    expect(q('[data-unwaive="m/TSK-03-01"]')!.textContent).toBe('면제 해제')
    const link = q('[data-stub-link="s1"]') as HTMLButtonElement
    expect(link.textContent).toBe('스텁 잔존: TSK-03-01 대체')
    await act(async () => { link.click() })
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
  it('계약 없는 선행은 버튼을 끄고 「선행 계약 없음」', () => {
    draw(succ, new Map([['m/TSK-03-01', { ...pred, spec: null, acceptance: [] }]]))
    expect((q('[data-waive="m/TSK-03-01"]') as HTMLButtonElement).disabled).toBe(true)
    expect(q('[data-waive-block]')!.textContent).toBe('선행 계약 없음')
  })
  it('편집 권한이 없으면 버튼이 없다', () => {
    draw(succ, undefined, false)
    expect(q('[data-waive]')).toBeNull()
  })
})
```

계약 판정 재료(`spec`·`acceptance`)가 `ComputedItem` 에 없으면 위 테스트가 가정하는 필드를 Step 3 에서 더한다(아래 참고).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/wbs-stub-badge.test.tsx tests/components/wbs-gantt-stub-rows.test.ts tests/components/wbs-force-progress-section.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`WbsRow`(Task 4 가 연 `src/lib/domain/types.ts`)에 표시 재료를 더한다 — 선행 계약 판정용:

```ts
  /** 선행 계약 판정 재료(스펙 F4) — spec 본문 유무와 acceptance 배열. 표시·버튼 상태용이고 정본 판정은 RPC 다. */
  spec?: string | null
  acceptance?: unknown
  /** wbs.md 선행 ref(0077). 강제 진행 절이 간선마다 버튼을 그린다. */
  depends?: string[] | null
```

`src/lib/data/wbs.ts` 행 매핑에 `spec: (r.spec as string | null) ?? null, acceptance: r.acceptance ?? [], depends: (r.depends as string[] | null) ?? null,` 를 더한다(select('*')).

`src/components/wbs/StubBadge.tsx`:

```tsx
'use client'
// 스텁 잔존 배지(스펙 2026-09-23 F13). 판정은 호출부가 pendingStubs 로 끝낸 목록을 넘긴다 — 여기서 다시 거르지 않는다.
import { stubBadgeText, stubLabel, type StubTaskLike } from '@/lib/domain/forceProgress'

export function StubBadge({ stubs, onOpen }: { stubs: readonly StubTaskLike[]; onOpen?: (subTaskId: string) => void }) {
  if (stubs.length === 0) return null
  const title = stubs.map(s => stubLabel(s.stubFor)).join('\n')
  return (
    <button type="button" data-stub-badge title={title} aria-label={`${stubBadgeText(stubs.length)} — ${title.replace(/\n/g, ', ')}`}
      onClick={e => { e.stopPropagation(); onOpen?.(stubs[0].id) }}
      className="shrink-0 rounded-full border border-delayed/40 bg-delayed-weak px-1.5 py-0.5 text-[10px] font-bold text-delayed">
      {stubBadgeText(stubs.length)}
    </button>
  )
}
```

(`aria-label` 은 스크린리더용으로 대체 선행을 함께 읽히고, 보이는 텍스트는 `stubBadgeText` 그대로다.)

`src/components/wbs/ForceProgressSection.tsx`:

```tsx
'use client'
// 작업 정보 사이드바 「강제 진행」 절(스펙 §3.2·§3.6). 간선마다 면제·해제, 아래에 스텁 잔존 목록.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ComputedItem } from '@/lib/domain/types'
import { WAIVE_BLOCK_TEXT, lastRefSegment, pendingStubs, stubLabel, waiveBlock } from '@/lib/domain/forceProgress'
import { cancelStubTask, setDependencyWaiver } from '@/app/actions/forceProgress'

type Props = { item: ComputedItem; itemByRef: ReadonlyMap<string, ComputedItem>; editable: boolean; onSelectItem?: (id: string) => void }

export function ForceProgressSection({ item, itemByRef, editable, onSelectItem }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<{ ref: string; waive: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const depends = item.depends ?? []
  const waived = item.dependsWaived ?? []
  const stubs = pendingStubs((item.subTasks ?? []).filter(s => s.stubFor).map(s => ({ id: s.id, stubFor: s.stubFor as string, externalRef: s.externalRef ?? null, stage: s.stage ?? null })))
  if (depends.length === 0 && stubs.length === 0) return null

  const submit = async () => {
    if (!open) return
    setBusy(true); setMsg(null)
    try {
      const r = await setDependencyWaiver(item.id, open.ref, open.waive, reason)
      if (!r.ok) setMsg(r.error)
      else { setMsg(r.warning ?? null); setOpen(null); setReason(''); router.refresh() }
    } finally { setBusy(false) }
  }

  return (
    <section data-force-progress className="space-y-2">
      <div className="text-[11px] font-semibold text-ink-muted">강제 진행</div>
      <ul className="space-y-1.5">
        {depends.map(ref => {
          const p = itemByRef.get(ref)
          const isWaived = waived.includes(ref)
          const block = isWaived ? null : waiveBlock({
            successor: { externalRef: item.externalRef ?? null, depends, dependsWaived: waived, stubFor: item.stubFor ?? null, hasNormalChildren: item.children.length > 0 },
            predRef: ref,
            pred: p ? { stage: p.stage ?? null, orderApproved: false, actualPct: p.rolledActualPct, spec: p.spec ?? null, acceptance: p.acceptance } : null,
          })
          if (block === 'already_reached') return null
          return (
            <li key={ref} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{p ? `${p.code} ${p.name}` : lastRefSegment(ref)}</span>
              {isWaived && <span className="chip shrink-0 text-[10px]">면제됨</span>}
              {editable && (isWaived
                ? <button type="button" className="btn h-6 px-2 text-[11px]" disabled={busy} data-unwaive={ref} onClick={() => setOpen({ ref, waive: false })}>면제 해제</button>
                : <button type="button" className="btn h-6 px-2 text-[11px]" disabled={busy || block !== null} title={block ? WAIVE_BLOCK_TEXT[block] : undefined}
                    data-waive={ref} onClick={() => setOpen({ ref, waive: true })}>강제 진행</button>)}
              {!isWaived && block !== null && <span data-waive-block className="shrink-0 text-[10px] text-ink-subtle">{WAIVE_BLOCK_TEXT[block]}</span>}
            </li>
          )
        })}
      </ul>
      {open && (
        <div className="space-y-1 rounded-lg border border-line p-2">
          <p className="text-[11px] text-ink-muted">
            {open.waive
              ? '이 선행을 기다리지 않고 스텁으로 먼저 개발합니다. 스텁 제거 작업이 하위에 생기고, 그 작업이 끝날 때까지 이 작업의 승인은 잠깁니다. 개발 브랜치가 운영 브랜치와 같으면(개발 브랜치 미설정) 스텁이 운영에 들어갈 수 있으니 확인하세요.'
              : '면제를 풉니다. 이미 만든 스텁 제거 작업은 남습니다 — 스텁이 없다면 아래 목록에서 취소하세요.'}
          </p>
          <input data-waive-reason aria-label="강제 진행 사유" className="app-input h-7 w-full text-xs" value={reason} onChange={e => setReason(e.target.value)} placeholder="사유(필수)" />
          <div className="flex gap-1.5">
            <button type="button" data-waive-confirm className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy || reason.trim() === ''} onClick={() => void submit()}>
              {open.waive ? '강제 진행 확정' : '면제 해제 확정'}
            </button>
            <button type="button" className="btn h-7 px-2.5 text-xs" disabled={busy} onClick={() => { setOpen(null); setReason('') }}>취소</button>
          </div>
        </div>
      )}
      {stubs.length > 0 && (
        <ul className="space-y-1">
          {stubs.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-xs">
              <button type="button" data-stub-link={s.id} className="min-w-0 flex-1 truncate text-left font-semibold text-delayed underline-offset-2 hover:underline"
                onClick={() => onSelectItem?.(s.id)}>{stubLabel(s.stubFor)}</button>
              {editable && (
                <button type="button" data-stub-cancel={s.id} className="btn h-6 px-2 text-[11px]" disabled={busy}
                  onClick={async () => { setBusy(true); try { const r = await cancelStubTask(s.id); setMsg(r.ok ? null : r.error ?? null); if (r.ok) router.refresh() } finally { setBusy(false) } }}>
                  스텁 제거 작업 취소
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role="status" className="text-[11px] text-delayed">{msg}</p>}
    </section>
  )
}
```

`src/components/wbs/WbsGanttSheet.tsx`:
- 106행 `flatten` 과 150행 `ancestorPath` 를 새 파일 `src/components/wbs/sheetTree.ts` 로 옮기고 이름을 `flattenForSheet`·`findAncestorPath` 로 바꿔 export 한다. `WbsGanttSheet.tsx` 는 그 둘을 import 하고 파일 안 호출부(`flatten(`·`ancestorPath(`)를 새 이름으로 바꾼다.

```ts
// src/components/wbs/sheetTree.ts — WBS 표의 평탄화·조상 경로(순수). stub 하위(subTasks)는 후행 바로 뒤 행으로 보인다(스펙 F9·§3.6).
import type { ComputedItem } from '@/lib/domain/types'

export function flattenForSheet(items: ComputedItem[], collapsed: Set<string>): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    out.push(n)
    if (!collapsed.has(n.id)) { walk(n.children); walk(n.subTasks ?? []) }
  })
  walk(items)
  return out
}

/** focus 대상의 조상 id 경로(루트→부모 순). 트리에 없으면 null. ?focus=<하위 id> 링크가 subTasks 를 타야 한다. */
export function findAncestorPath(items: ComputedItem[], id: string): string[] | null {
  const walk = (ns: ComputedItem[], anc: string[]): string[] | null => {
    for (const n of ns) {
      if (n.id === id) return anc
      const found = walk(n.children, [...anc, n.id]) ?? walk(n.subTasks ?? [], [...anc, n.id])
      if (found) return found
    }
    return null
  }
  return walk(items, [])
}
```

  옮기기 전 `flatten` 본문을 먼저 확인한다 — 위와 다른 규칙(예: 접힘 판정 방식)이 있으면 그 규칙을 그대로 두고 `walk(n.subTasks ?? [])` 한 줄만 더한다.
- 작업명 셀(단계 칩을 지운 자리, `data-wbs-stage` 컬럼 앞의 이름 칸 우단)에:

```tsx
{n.subTasks && n.subTasks.length > 0 && (
  <StubBadge
    stubs={pendingStubs(n.subTasks.map(s => ({ id: s.id, stubFor: s.stubFor as string, externalRef: s.externalRef ?? null, stage: s.stage ?? null })))}
    onOpen={id => onSelectRow(id)} />
)}
{n.stubFor && <span className="chip shrink-0 text-[10px]" data-stub-task>스텁 제거</span>}
```

  `onSelectRow` 는 이 파일이 행 클릭 때 부르는 선택 함수 이름으로 맞춘다(`grep -n "setSelectedId\|onRowClick\|setDetailId" src/components/wbs/WbsGanttSheet.tsx` 로 확인해 그 함수를 쓴다).
- 행 클릭·실적 편집 판정(`canEditActual`)은 그대로다 — 하위 행은 `children` 이 비어 있어 리프로 편집된다.

`src/components/wbs/RowDetailPanel.tsx`: 선행 목록 블록(`t('wbs.predecessors')` div) 바로 위에:

```tsx
<ForceProgressSection item={item} itemByRef={itemByRef} editable={editable} onSelectItem={onSelectItem} />
```

`itemByRef` 는 `useMemo(() => new Map(allItemsFlat.filter(i => i.externalRef).map(i => [i.externalRef as string, i])), [allItemsFlat])` 로 만든다 — `allItemsFlat` 은 이 파일이 이미 `itemById` 를 만드는 평탄 목록을 쓴다(그 목록이 `children` 만 타면 `subTasks` 도 타도록 같은 곳을 고친다).

`src/components/wbs/WbsSpecPanel.tsx` 승인 버튼: 이 패널이 받는 항목의 `subTasks` 로 `const stubs = pendingStubs(…)` 를 만들고(패널이 항목 객체가 아니라 id 만 받으면 부모 `RowDetailPanel` 에서 `stubs` prop 으로 내려 준다),

```tsx
<button type="button" className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy || stubs.length > 0}
  title={stubs.length > 0 ? stubs.map(s => stubLabel(s.stubFor)).join('\n') : undefined}
  onClick={() => void run(() => approveAgentCompletion(order.id))}>{t('wbs.agentOrderApprove')}</button>
{stubs.length > 0 && <span className="text-[11px] font-semibold text-delayed">{stubs.map(s => stubLabel(s.stubFor)).join(' · ')}</span>}
```

i18n: 이 절의 문구는 스펙이 한국어 문구를 고정하므로(Global Constraints) 컴포넌트에 직접 둔다. en 사전은 건드리지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/wbs/StubBadge.tsx src/components/wbs/ForceProgressSection.tsx src/components/wbs/sheetTree.ts src/components/wbs/WbsGanttSheet.tsx src/components/wbs/RowDetailPanel.tsx src/components/wbs/WbsSpecPanel.tsx src/lib/domain/types.ts src/lib/data/wbs.ts tests/components/wbs-stub-badge.test.tsx tests/components/wbs-gantt-stub-rows.test.ts tests/components/wbs-force-progress-section.test.tsx
git commit -m "feat(wbs): 강제 진행 절과 스텁 잔존 배지를 보인다

스텁이 남은 Task 는 im 이라 끝난 것처럼 보인다. 작업명 옆 배지와 사이드바 목록이 무엇을
치워야 승인이 풀리는지 보여 주고, 누르면 그 스텁 제거 작업으로 간다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 오피스·허브·결재 배지 (Task 5·6 뒤)

**Files:**
- Modify: `src/lib/domain/seatmap.ts` (`Seat.stubPending`, `assembleSeatmap` 입력 `stubs`), `src/lib/data/agentSeatmap.ts` (stub 하위 조회)
- Modify: `src/lib/domain/agentHub.ts` (`HubRow.stubPending`, `HubQueueEntry.stubPending`), `src/lib/data/agentApprovals.ts` (`countApprovable`)
- Modify: `src/components/agents/SeatOpsBar.tsx` · `DetailPanel.tsx` · `seatOps.ts`, `src/components/agent-hub/ApprovalQueue.tsx` · `DelegationTable.tsx`
- Test: `tests/domain/seatmap-stub.test.ts`(신규), `tests/domain/agent-hub-stub.test.ts`(신규), `tests/data/agent-approvals-stub.test.ts`(신규), 기존 `tests/components/agent-hub-queue.test.tsx` 에 케이스 추가

**Interfaces:**
- Consumes: `pendingStubs`·`stubLabel`·`stubBadgeText`(Task 2), `stub_for` 컬럼 로드(Task 5)
- Produces:
  - `Seat.stubPending?: { subTaskId: string; label: string }[]` — 선택 필드(`Seat.model` 과 같은 관례: 기존 좌석 리터럴 픽스처를 깨지 않는다). 조립 함수는 항상 채우고, 읽는 쪽은 `?? []`.
  - `HubRow.stubPending?` · `HubQueueEntry.stubPending?` 같은 형·같은 규칙
  - `stubPendingByItem(items: ReadonlyArray<{ id: string; parent_id: string | null; stub_for?: string | null; stage?: string | null; external_ref?: string | null }>): Map<string, { subTaskId: string; label: string }[]>` — `src/lib/domain/forceProgress.ts` 에 추가(부모 id → 잔존 목록)
  - `countApprovable(orders, items, viewer, stubRows?)` — `stubRows`(주문 항목들의 stub 하위만)로 스텁 잔존 주문을 세지 않는다. 관리자도 이 작은 조회 하나만 더한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/force-progress.test.ts` 끝에 추가:

```ts
import { stubPendingByItem } from '@/lib/domain/forceProgress'

describe('stubPendingByItem — raw 행에서 부모별 잔존 목록', () => {
  it('xx 가 아닌 stub 하위만 부모 id 로 묶는다', () => {
    const m = stubPendingByItem([
      { id: 'succ', parent_id: 'wp' },
      { id: 's1', parent_id: 'succ', stub_for: 'm/TSK-01', stage: 'ip' },
      { id: 's2', parent_id: 'succ', stub_for: 'm/TSK-02', stage: 'xx' },
      { id: 'c', parent_id: 'succ', stage: 'ip' },
    ])
    expect(m.get('succ')).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
    expect(m.has('wp')).toBe(false)
  })
})
```

`tests/data/agent-approvals-stub.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { countApprovable } from '@/lib/data/agentApprovals'

const items = [
  { id: 'wp', parent_id: null, assignee_member_id: 'lead', stub_for: null, stage: null },
  { id: 'succ', parent_id: 'wp', assignee_member_id: 'dev', stub_for: null, stage: 'im' },
  { id: 's1', parent_id: 'succ', assignee_member_id: 'dev', stub_for: 'm/TSK-01', stage: 'ip' },
  { id: 'other', parent_id: 'wp', assignee_member_id: 'dev', stub_for: null, stage: 'im' },
]
const orders = [{ wbs_item_id: 'succ' }, { wbs_item_id: 'other' }]

describe('countApprovable — 스텁 잔존 주문은 세지 않는다(지금 승인할 수 있는 것만)', () => {
  const stubRows = items.filter(i => i.stub_for)
  it('관리자', () => {
    expect(countApprovable(orders, [], { isAdmin: true, memberIds: [] }, stubRows)).toBe(1)
  })
  it('서브트리 관리자', () => {
    expect(countApprovable(orders, items, { isAdmin: false, memberIds: ['lead'] }, stubRows)).toBe(1)
  })
  it('stubRows 를 안 넘기면 종전과 같다', () => {
    expect(countApprovable(orders, [], { isAdmin: true, memberIds: [] })).toBe(2)
  })
})
```

`tests/domain/seatmap-stub.test.ts` — 기존 `tests/domain/seatmap.test.ts` 의 행 픽스처 헬퍼(주문·항목 생성 함수)를 import 하거나 그 파일 머리의 헬퍼를 복사해 쓴다. 검사:

```ts
it('reported 주문 좌석에 스텁 잔존 목록이 실린다', () => {
  // items: succ(주문 reported) + s1(stub_for, stage ip, parent succ)
  const map = assembleSeatmap({ ...rowsWith(/* succ reported 주문 */), items: [succItem, stubItem], parents: [wpItem] }, NOW, { viewer })
  const seat = map.floors[0].zones.flatMap(z => z.seats).find(s => s.itemId === 'succ')!
  expect(seat.stubPending).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
})
```

(`rowsWith`·`succItem`·`stubItem`·`wpItem`·`NOW`·`viewer` 는 `tests/domain/seatmap.test.ts` 의 기존 헬퍼 이름에 맞춰 작성한다 — 그 파일을 열어 주문·항목 행을 만드는 헬퍼를 확인하고 같은 방식으로 `stub_for: 'm/TSK-01', stage: 'ip', parent_id: 'succ'` 인 항목 행을 더한다. stub 하위 행은 주문이 없어도 `items` 에 실어야 한다 — 아래 로더 변경 참고.)

`tests/domain/agent-hub-stub.test.ts` 도 같은 방식으로 `assembleAgentHub` 에 stub 하위 행을 넣고 `rows.find(r => r.itemId === 'succ')!.stubPending` 과 `queue[0].stubPending`, 그리고 `rows.find(r => r.itemId === 'succ')!.isLeaf === true` 를 검사한다.

`tests/components/agent-hub-queue.test.tsx` 의 첫 `describe` 에 케이스 추가(그 파일의 `render`·`Q`·`host` 를 쓴다):

```tsx
  it('스텁 잔존 카드는 승인 버튼이 비활성이고 문구와 WBS 링크를 보인다', () => {
    render({ queue: [{ ...Q[0], stubPending: [{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }] }] })
    expect((host.querySelector('[data-queue-approve]') as HTMLButtonElement).disabled).toBe(true)
    const link = host.querySelector('[data-queue-stub-link]') as HTMLAnchorElement
    expect(link.textContent).toBe('스텁 잔존: TSK-01 대체')
    expect(link.getAttribute('href')).toBe('/p/p1/wbs?focus=s1')
  })
```

(`stubPending` 은 선택 필드라 기존 `Q` 픽스처는 고치지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/force-progress.test.ts tests/data/agent-approvals-stub.test.ts tests/domain/seatmap-stub.test.ts tests/domain/agent-hub-stub.test.ts tests/components/agent-hub-queue.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/domain/forceProgress.ts` 에 추가:

```ts
export interface StubPendingEntry { subTaskId: string; label: string }

/** raw 행(DB snake_case)에서 부모 id → 스텁 잔존 목록. 오피스·허브·결재 배지가 쓴다(판정은 pendingStubs 와 같다). */
export function stubPendingByItem(
  items: ReadonlyArray<{ id: string; parent_id: string | null; stub_for?: string | null; stage?: string | null; external_ref?: string | null }>,
): Map<string, StubPendingEntry[]> {
  const out = new Map<string, StubPendingEntry[]>()
  for (const it of items) {
    if (!it.stub_for || !it.parent_id) continue
    if (pendingStubs([{ id: it.id, stubFor: it.stub_for, externalRef: it.external_ref ?? null, stage: it.stage ?? null }]).length === 0) continue
    const e = { subTaskId: it.id, label: stubLabel(it.stub_for) }
    const l = out.get(it.parent_id); if (l) l.push(e); else out.set(it.parent_id, [e])
  }
  return out
}
```

`src/lib/data/agentApprovals.ts`:
- `countApprovable(orders, items, viewer, stubRows = [])` — 넷째 인자 `stubRows: ReadonlyArray<{ id: string; parent_id: string | null; stub_for: string | null; stage: string | null }>` 를 더한다. 첫 줄에 `const locked = stubPendingByItem(stubRows)` 와 `const approvable = orders.filter(o => o.wbs_item_id === null || !locked.has(o.wbs_item_id))` 를 두고, 이하 `orders` 대신 `approvable` 을 쓴다(관리자면 `approvable.length`).
- `getPendingApprovalCount` — 셸 조회라 좁게 읽는 원칙(파일 머리 주석)을 지킨다. 주문을 읽은 직후, 관리자 분기 **앞**에서 그 주문 항목들의 stub 하위만 읽는다:

```ts
  const orderItemIds = rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null)
  const { data: stubData, error: stubErr } = orderItemIds.length === 0
    ? { data: [], error: null }
    : await admin.from('wbs_items').select('id, parent_id, stub_for, stage').in('parent_id', orderItemIds).not('stub_for', 'is', null)
  if (stubErr) throw new Error(`[approvals] 스텁 하위 조회 실패: ${stubErr.message}`)
  const stubRows = (stubData ?? []) as Array<{ id: string; parent_id: string | null; stub_for: string | null; stage: string | null }>
  if (isProjectAdmin(actor, projectId)) return countApprovable(rows, [], { isAdmin: true, memberIds: [] }, stubRows)
```

  비관리자 경로의 마지막 호출도 `countApprovable(rows, items, { isAdmin: false, memberIds }, stubRows)` 로.

`src/lib/data/agentSeatmap.ts` — 주문 항목을 읽은 뒤, 그 항목들의 stub 하위를 한 번 더 읽어 `items` 에 합친다:

```ts
  const stubRows = itemIds.length === 0 ? [] : must<ItemRow[]>('스텁 하위',
    await admin.from('wbs_items').select(ITEM_COLS).in('parent_id', itemIds).not('stub_for', 'is', null))
```

`SeatmapRows` 에 `stubs?: ItemRow[]` 를 두고 그 값을 넘긴다(좌석 대상 `items` 에 섞지 않는다 — 섞으면 주문 없는 좌석으로 오해된다).

`src/lib/domain/seatmap.ts`:
- `Seat` 에 `/** 스텁 잔존(스펙 F13) — 승인 버튼 비활성·배지 재료. 선택 필드: 옛 픽스처 호환, 조립은 항상 채운다. */ stubPending?: StubPendingEntry[]`.
- `assembleSeatmap` 안에서 `const stubsByItem = stubPendingByItem(rows.stubs ?? [])`, `toSeat` 결과에 `stubPending: o.wbs_item_id ? (stubsByItem.get(o.wbs_item_id) ?? []) : []` 를 싣는다(`toSeat` 초기값에는 `stubPending: []`).
- `deriveWaitReason` 호출에 `waived: item?.depends_waived ?? []` 를 더한다.

`src/lib/domain/agentHub.ts`:
- `HubRow`·`HubQueueEntry` 에 `stubPending?: StubPendingEntry[]`(같은 이유로 선택 필드).
- `const stubsByItem = stubPendingByItem(rows.items)` 를 `hasChildren` 옆에 두고, `hubRows.push` 에 `stubPending: stubsByItem.get(item.id) ?? []`, 큐 항목에 `stubPending: o.wbs_item_id ? (stubsByItem.get(o.wbs_item_id) ?? []) : []`.

`src/components/agent-hub/ApprovalQueue.tsx` 승인 버튼:

```tsx
{(isAdmin || q.canManage) && (
  <button type="button" data-queue-approve disabled={busy || (q.stubPending ?? []).length > 0}
    title={(q.stubPending ?? []).length > 0 ? (q.stubPending ?? []).map(s => s.label).join('\n') : OP_TITLE.approve}
    onClick={() => { void run({ kind: 'approve', orderId: q.orderId }) }} className="btn btn-primary h-8 px-3 text-xs">{OP_LABEL.approve}</button>
)}
```

카드 제목 줄 아래에:

```tsx
{(q.stubPending ?? []).length > 0 && (
  <p className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold text-delayed">
    {(q.stubPending ?? []).map(s => <a key={s.subTaskId} data-queue-stub-link href={`/p/${projectId}/wbs?focus=${s.subTaskId}`} className="underline-offset-2 hover:underline">{s.label}</a>)}
  </p>
)}
```

`src/components/agent-hub/DelegationTable.tsx` — 승인 select/버튼이 있는 행 셀(`canReviewRow` 블록)에서 `(r.stubPending ?? []).length > 0` 이면 승인 선택지를 `disabled` 로 두고 이름 칸에 `<StubBadge stubs={…} />` 대신 같은 모양의 링크 배지를 둔다:

```tsx
{(r.stubPending ?? []).length > 0 && (
  <a href={`/p/${projectId}/wbs?focus=${r.stubPending![0].subTaskId}`} title={r.stubPending!.map(s => s.label).join('\n')}
    className="shrink-0 rounded-full border border-delayed/40 bg-delayed-weak px-1.5 py-0.5 text-[10px] font-bold text-delayed">
    {stubBadgeText(r.stubPending!.length)}
  </a>
)}
```

`src/components/agents/seatOps.ts` — 승인 op 가능 판정 함수(승인 버튼 노출을 정하는 곳, `grep -n "approve" src/components/agents/seatOps.ts`)에 `(seat.stubPending ?? []).length === 0` 조건을 더하고, 막힌 사유 문구로 `(seat.stubPending ?? []).map(s => s.label).join(' · ')` 를 돌려준다. `SeatOpsBar.tsx`·`DetailPanel.tsx` 는 그 사유를 승인 버튼 `title` 과 버튼 옆 한 줄로 보이고, `DetailPanel` 은 각 항목을 `/p/<projectId>/wbs?focus=<subTaskId>` 링크로 그린다. 좌석 카드(Seat 컴포넌트)에도 `stubBadgeText` 배지를 이름 옆에 둔다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain tests/data tests/components 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/forceProgress.ts src/lib/domain/seatmap.ts src/lib/data/agentSeatmap.ts src/lib/domain/agentHub.ts src/lib/data/agentApprovals.ts src/components/agents/seatOps.ts src/components/agents/SeatOpsBar.tsx src/components/agents/DetailPanel.tsx src/components/agent-hub/ApprovalQueue.tsx src/components/agent-hub/DelegationTable.tsx tests/domain/force-progress.test.ts tests/domain/seatmap-stub.test.ts tests/domain/agent-hub-stub.test.ts tests/data/agent-approvals-stub.test.ts tests/components/agent-hub-queue.test.tsx
git commit -m "feat(agents): 오피스·허브에 스텁 잔존을 보이고 승인을 잠근다

승인 큐·좌석·허브 표가 같은 판정으로 스텁 잔존을 보이고 하위 Task 로 가는 링크를 단다.
결재 대기 배지는 지금 승인할 수 있는 것만 세므로 스텁 잔존 주문을 뺀다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(좌석 카드 컴포넌트 파일도 이름으로 함께 stage 한다.)

---

### Task 9: 병목 설정과 제안 띠 (Task 2·8 뒤)

**Files:**
- Modify: `src/lib/data/projectConfig.ts` (`ProjectConfig.bottleneck`)
- Modify: `src/app/actions/project.ts` (`updateBottleneckSettings`)
- Modify: 설정 페이지 에이전트 카드 — `grep -rln "StageCreditSlider" src/app src/components` 로 찾은 파일(슬라이더 바로 아래)
- Modify: `src/lib/domain/seatmap.ts` (`Floor.bottlenecks`), `src/lib/data/agentSeatmap.ts` (설정 로드), `src/components/agents/FloorCard.tsx`
- Test: `tests/actions/project-bottleneck.test.ts`(신규), `tests/domain/seatmap-bottleneck.test.ts`(신규)

**Interfaces:**
- Consumes: `DEFAULT_BOTTLENECK`·`validateBottleneckSettings`·`findBottlenecks`·`blockedSinceMs`·`bottleneckText`(Task 2), `unmetDepends`(Task 1)
- Produces:
  - `ProjectConfig.bottleneck: BottleneckSettings`(행 없으면 `DEFAULT_BOTTLENECK`)
  - `updateBottleneckSettings(projectId: string, raw: unknown): Promise<{ ok: boolean; error?: string }>`
  - `Floor.bottlenecks?: { text: string; predRef: string; successorIds: string[] }[]`(선택 필드 — 옛 층 픽스처 호환, 조립은 항상 채운다)
  - `assembleSeatmap(rows, nowMs, opts)` 의 `rows.bottleneckSettings?: Record<string, BottleneckSettings>`(프로젝트 id → 설정)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/actions/project-bottleneck.test.ts` — `tests/actions/project-stage-credits.test.ts` 의 mock 머리(hoisted·vi.mock 네 줄·`P1`·beforeEach)를 그대로 복사하고:

```ts
import { updateBottleneckSettings } from '@/app/actions/project'

describe('updateBottleneckSettings', () => {
  it('관리자가 아니면 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateBottleneckSettings(P1, { minSuccessors: 3, minHours: 4 })).toEqual({ ok: false, error: '권한 없음' })
  })
  it('검증 실패는 저장하지 않는다', async () => {
    const r = await updateBottleneckSettings(P1, { minSuccessors: 0, minHours: 4 })
    expect(r.ok).toBe(false)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('두 컬럼을 upsert 한다', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    mocks.createAdminClient.mockReturnValue({ from: () => ({ upsert }) })
    expect(await updateBottleneckSettings(P1, { minSuccessors: 5, minHours: 8 })).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ project_id: P1, force_bottleneck_min_successors: 5, force_bottleneck_min_hours: 8, updated_by: 'admin-1' }))
  })
})
```

`tests/domain/seatmap-bottleneck.test.ts` — `tests/domain/seatmap.test.ts` 의 헬퍼로 위임된 ready 주문 3건(각 항목 `depends: ['m/P1']`, `tags: ['agent']`, 주문 `updated_at` 은 NOW 기준 6시간 전)과 선행 행 `m/P1`(stage `ip`)을 만들고:

```ts
it('한 선행이 기본값(3건·4시간)을 넘겨 막으면 층에 제안 띠가 뜬다', () => {
  const map = assembleSeatmap(rows, NOW, { viewer })
  expect(map.floors[0].bottlenecks).toEqual([{ predRef: 'm/P1', successorIds: expect.any(Array), text: '선행 P1 이 후속 3건을 막고 있습니다(6시간째)' }])
})
it('면제된 간선은 막힘으로 세지 않는다', () => {
  // 한 항목에 depends_waived: ['m/P1']
  expect(assembleSeatmap(rowsWithOneWaived, NOW, { viewer }).floors[0].bottlenecks).toEqual([])
})
```

(선행 `code` 가 `P1` 이 되도록 선행 행의 `code` 를 `'P1'` 로 둔다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/actions/project-bottleneck.test.ts tests/domain/seatmap-bottleneck.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/data/projectConfig.ts` — select 에 `, force_bottleneck_min_successors, force_bottleneck_min_hours` 를, 인터페이스에 `/** 병목 제안 기준(0103, 스펙 F14). */ bottleneck: BottleneckSettings`, 기본값에 `bottleneck: DEFAULT_BOTTLENECK`, 반환에:

```ts
    bottleneck: {
      minSuccessors: (row as { force_bottleneck_min_successors?: number }).force_bottleneck_min_successors ?? DEFAULT_BOTTLENECK.minSuccessors,
      minHours: (row as { force_bottleneck_min_hours?: number }).force_bottleneck_min_hours ?? DEFAULT_BOTTLENECK.minHours,
    },
```

`src/app/actions/project.ts` — `updateStageCredits` 바로 아래:

```ts
/** 병목 제안 기준(스펙 2026-09-23 F14) — 관리자 전용, 제안 띠만 바뀐다(자동 면제 없음). */
export async function updateBottleneckSettings(projectId: string, raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const v = validateBottleneckSettings(raw)
  if (!v.ok) return { ok: false, error: v.error }
  const admin = createAdminClient()
  const { error } = await admin.from('project_settings').upsert({
    project_id: projectId,
    force_bottleneck_min_successors: v.value.minSuccessors,
    force_bottleneck_min_hours: v.value.minHours,
    updated_at: new Date().toISOString(),
    updated_by: g.actor.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
```

설정 카드(StageCreditSlider 가 있는 파일) — 슬라이더 아래에 관리자만 편집 가능한 숫자 두 칸:

```tsx
<div data-bottleneck-settings className="mt-4 space-y-1">
  <div className="text-xs font-semibold text-ink">병목 제안</div>
  <p className="text-[11px] text-ink-muted">한 선행이 후속을 이만큼 이상 막으면 오피스에 강제 진행을 제안합니다. 자동으로 면제하지는 않습니다.</p>
  <label className="flex items-center gap-2 text-xs">후속 <input type="number" min={1} className="app-input h-7 w-16" disabled={!isAdmin}
    value={bn.minSuccessors} onChange={e => setBn({ ...bn, minSuccessors: Number(e.target.value) })} />건 이상</label>
  <label className="flex items-center gap-2 text-xs"><input type="number" min={1} className="app-input h-7 w-16" disabled={!isAdmin}
    value={bn.minHours} onChange={e => setBn({ ...bn, minHours: Number(e.target.value) })} />시간 넘게</label>
  {isAdmin && <button type="button" className="btn h-7 px-2.5 text-xs" onClick={async () => { const r = await updateBottleneckSettings(projectId, bn); setBnMsg(r.ok ? '저장했습니다.' : r.error ?? null) }}>저장</button>}
  {bnMsg && <p role="status" className="text-[11px] text-ink-muted">{bnMsg}</p>}
</div>
```

(`bn` 은 `useState(config.bottleneck)`, `bnMsg` 는 `useState<string | null>(null)`. `isAdmin`·`projectId`·`config` 는 그 카드가 이미 받는 prop 이름에 맞춘다.)

`src/lib/data/agentSeatmap.ts` — 층 프로젝트의 설정을 한 번에 읽는다:

```ts
  const settingRows = projIds.length === 0 ? [] : must<Array<{ project_id: string; force_bottleneck_min_successors: number; force_bottleneck_min_hours: number }>>('병목 설정',
    await admin.from('project_settings').select('project_id, force_bottleneck_min_successors, force_bottleneck_min_hours').in('project_id', projIds))
  const bottleneckSettings = Object.fromEntries(settingRows.map(s => [s.project_id, { minSuccessors: s.force_bottleneck_min_successors, minHours: s.force_bottleneck_min_hours }]))
```

`SeatmapRows` 에 `bottleneckSettings?: Record<string, BottleneckSettings>` 로 넘긴다.

`src/lib/domain/seatmap.ts` — `Floor` 에 `bottlenecks?: { text: string; predRef: string; successorIds: string[] }[]`. 층을 만드는 자리(`const floors: Floor[] = …`)에서 그 층 프로젝트의 READY·위임 좌석마다:

```ts
    const settings = rows.bottleneckSettings?.[id] ?? DEFAULT_BOTTLENECK
    const blocked: BlockedSuccessor[] = []
    for (const o of rows.orders) {
      if (o.project_id !== id || o.status !== 'ready' || !o.wbs_item_id) continue
      const it = itemById.get(o.wbs_item_id)
      if (!it || !(it.tags ?? []).includes(AGENT_TAG)) continue
      const unmet = unmetDepends(it.depends ?? null, ref => predByRef.get(`${id}|${ref}`), it.depends_waived ?? [])
      if (unmet.length === 0) continue
      blocked.push({ itemId: it.id, unmetRefs: unmet.map(u => u.ref), blockedSinceMs: blockedSinceMs(o.updated_at, it.planned_start ?? null) })
    }
    const bottlenecks = findBottlenecks(blocked, nowMs, settings).map(b => ({
      predRef: b.predRef, successorIds: b.successorIds,
      text: bottleneckText(b, predByRef.get(`${id}|${b.predRef}`)?.code ?? lastRefSegment(b.predRef)),
    }))
```

`itemById`·`predByRef` 는 `assembleSeatmap` 이 좌석 대기 사유를 만들 때 이미 쓰는 지도 이름에 맞춘다(없으면 `rows.items`·`rows.predecessors` 로 같은 모양의 Map 을 만든다 — 선행 키는 `project_id|external_ref`).

`src/components/agents/FloorCard.tsx` — 층 머리(lease 칩 옆 줄) 아래:

```tsx
{(floor.bottlenecks ?? []).length > 0 && (
  <ul data-bottleneck className="mt-1 space-y-0.5">
    {floor.bottlenecks!.map(b => (
      <li key={b.predRef} className="rounded-md border border-pending/40 bg-pending-weak px-2 py-1 text-[11px] font-semibold text-pending">
        {b.text} — 후속의 사이드바 「강제 진행」 에서 이 선행을 면제할 수 있습니다.
      </li>
    ))}
  </ul>
)}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/actions tests/domain tests/components 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/data/projectConfig.ts src/app/actions/project.ts src/lib/domain/seatmap.ts src/lib/data/agentSeatmap.ts src/components/agents/FloorCard.tsx tests/actions/project-bottleneck.test.ts tests/domain/seatmap-bottleneck.test.ts
git commit -m "feat(agents): 병목 선행을 오피스에 제안하고 기준을 설정에서 바꾼다

한 선행이 후속 3건 이상을 4시간 넘게 막으면 층 머리에 알린다. 면제는 사람이 한다 —
무인 실행에서 자동 면제는 계약 충돌을 대량으로 만든다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(설정 카드 파일도 이름으로 함께 stage 한다.)

---

### Task 10: 스킬 — `waived` 간선·스텁 규칙·승격 관문 (Task 2 뒤, 병렬 가능 — 4·5 와)

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (`check_depends_local`, `stub-check` 명령, `CONTRACT_VERSION=2.8`, usage)
- Modify: `.claude/skills/dflow-work/references/api-contract.md` (v2.8 절)
- Create: `.claude/skills/dflow-work/references/force-progress-hook.md`
- Modify: `.claude/skills/dflow-dev/SKILL.md` (Phase 01 2번 선행 검사, 행 G, 스텁 규칙 절), `.claude/skills/dflow-merge/SKILL.md` (개발=운영 브랜치일 때 FORCE-STUB 거부), `.claude/skills/dflow-team/SKILL.md` (사전 필터 설명 한 줄)
- Test: `tests/skills/dflow-force-progress.test.ts`(신규)

**Interfaces:**
- Consumes: 계약 2.8 `depends_evidence[].waived`(Task 6)
- Produces:
  - `dflow.sh stub-check [<ref>]` — `<ref>` 기본값은 `dflow.sh branch release` 값. `git grep -n 'FORCE-STUB:' <ref>` 가 있으면 exit 4 + `FORCE_STUB_FOUND <건수>` 와 목록, 없으면 exit 0 + `FORCE_STUB_NONE`.
  - `check_depends_local` 은 `waived == true` 원소를 건너뛴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/skills/dflow-force-progress.test.ts`:

```ts
// 강제 진행 스킬 계약(스펙 2026-09-23 §3.3·§3.4·§4) — waived 간선은 로컬 도달 검사·행 G 에서 따로 다루고, 승격 관문은 stub-check.
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const sh = readFileSync(DFLOW, 'utf8')
const dev = readFileSync(join(ROOT, '.claude/skills/dflow-dev/SKILL.md'), 'utf8')
const merge = readFileSync(join(ROOT, '.claude/skills/dflow-merge/SKILL.md'), 'utf8')
const contract = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')

function repo(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'fp-'))
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d })
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't')
  for (const [p, c] of Object.entries(files)) writeFileSync(join(d, p), c)
  g('add', '.'); g('commit', '-qm', 'init')
  return d
}

describe('check_depends_local — waived 간선은 로컬 도달 검사에서 뺀다', () => {
  it('jq 필터가 waived 를 거른다', () => {
    expect(sh).toContain('.[] | select(.head_sha != null and .waived != true)')
  })
})

describe('dflow.sh stub-check', () => {
  it('FORCE-STUB 표식이 있으면 exit 4 와 건수', () => {
    const d = repo({ 'a.ts': '// FORCE-STUB: TSK-03-01\nexport const x = 1\n', 'b.ts': 'ok\n' })
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: d, encoding: 'utf8', env: { ...process.env, DFLOW_SKIP_CONFIG: '1' } })
    expect(r.status).toBe(4)
    expect(r.stdout).toContain('FORCE_STUB_FOUND 1')
    expect(r.stdout).toContain('a.ts:1:')
  })
  it('없으면 exit 0', () => {
    const d = repo({ 'a.ts': 'clean\n' })
    const r = spawnSync('sh', [DFLOW, 'stub-check', 'HEAD'], { cwd: d, encoding: 'utf8', env: { ...process.env, DFLOW_SKIP_CONFIG: '1' } })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('FORCE_STUB_NONE')
  })
})

describe('/dflow-dev — waived 갈래', () => {
  it('선행 검사에 waived 갈래가 있고 기본 브랜치 반영 확인을 하지 않는다', () => {
    expect(dev).toContain("`d.waived === true` 면 **강제 진행 간선**이다")
    expect(dev).toContain('강제 진행: <선행> 은 스텁으로 대신한다')
    expect(dev).toContain('기점은 항상 `origin/<기본브랜치>`')
  })
  it('스텁 규칙(후행 소유 경로·표식·완료 보고 절)을 적는다', () => {
    expect(dev).toContain('FORCE-STUB: <선행 TSK-ID>')
    expect(dev).toContain('src/__stubs__/<선행 TSK-ID>/')
    expect(dev).toContain('「강제 진행 스텁」 절')
  })
})

describe('/dflow-merge — 개발 브랜치 = 운영 브랜치면 스텁 머지 거부', () => {
  it('stub-check 로 막는다', () => {
    expect(merge).toContain('dflow.sh stub-check <머지 대상>')
    expect(merge).toContain('개발 브랜치와 운영 브랜치가 같으면')
  })
})

describe('계약 문서 v2.8', () => {
  it('waived 필드와 reached 관계를 적는다', () => {
    expect(contract).toContain('## v2.8 변경점')
    expect(contract).toContain('`depends_evidence[].waived`')
    expect(sh).toMatch(/^CONTRACT_VERSION=2\.6$/m)
  })
})
```

`DFLOW_SKIP_CONFIG` 는 `stub-check` 가 설정 파일 없이도 도는지 보려는 것이다 — `stub-check` 에 ref 인자를 주면 `.dflow` 를 읽지 않도록 구현한다(아래). 이 환경변수 이름이 dflow.sh 에 이미 다른 뜻으로 있으면(`grep -n SKIP_CONFIG dflow.sh`) 테스트에서 빼고, ref 인자 경로가 설정을 읽지 않는 것으로 충분하다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-force-progress.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현 — dflow.sh**

- `CONTRACT_VERSION=<현재값>` → `CONTRACT_VERSION=2.8`(배정값 — 머지 순서에 따라 조정될 수 있다).
- `check_depends_local` 의 jq 줄:

```sh
  _jq_out=$(printf '%s' "$1" | jq -c '.[] | select(.head_sha != null and .waived != true)' 2>&1) || die 6 "의존성 정보 파싱 실패"
```

  바로 위 주석에 `# 강제 진행으로 면제한 간선(waived, 계약 2.8)은 선행 코드가 없는 게 정상이다 — 스텁으로 대신한다.` 한 줄.
- 명령 추가(`cmd_branch` 아래):

```sh
# 승격 관문(스펙 2026-09-23 F7·§4) — 운영 브랜치로 올리기 전에 강제 진행 스텁 표식이 남았는지 본다.
# ref 를 주면 설정을 읽지 않는다(훅·스크립트에서 쓰기 쉽게). 없으면 운영 브랜치(release_branch).
cmd_stub_check() {
  _ref=${1:-}
  if [ -z "$_ref" ]; then
    _ref=$(cmd_branch release) || die 6 "운영 브랜치를 알 수 없다 — dflow.sh stub-check <ref> 로 지정하라"
  fi
  git rev-parse -q --verify "$_ref^{commit}" >/dev/null 2>&1 || die 6 "ref 없음: $_ref"
  _hits=$(git grep -n 'FORCE-STUB:' "$_ref" -- . 2>/dev/null | sed "s#^$_ref:##")
  if [ -n "$_hits" ]; then
    printf 'FORCE_STUB_FOUND %s\n' "$(printf '%s\n' "$_hits" | wc -l | tr -d ' ')"
    printf '%s\n' "$_hits"
    exit 4
  fi
  echo FORCE_STUB_NONE
}
```

- 디스패치(`branch) shift; cmd_branch "$@"; exit $? ;;` 아래)에 `stub-check) shift; cmd_stub_check "$@"; exit $? ;;` — 이 줄은 설정 로드보다 **앞**의 디스패치 블록(`config`·`branch` 가 있는 곳)에 둔다.
- usage 에 `  stub-check [<ref>]                FORCE-STUB 표식 검사(기본 운영 브랜치). 있으면 exit 4` 한 줄.

- [ ] **Step 4: 구현 — 문서**

`.claude/skills/dflow-work/references/api-contract.md` — 제목·`contract_version` 줄을 2.8 로, 첫 문단 끝에 「v2.8은 강제 진행(간선 면제)을 더했다.」, 그리고 맨 위의 기존 `## v2.x 변경점` 절 앞에:

```markdown
## v2.8 변경점 (2026-09-23)

- `depends_evidence[].waived: boolean` 추가 — 사람이 그 선행을 「강제 진행」 으로 면제한 간선(0103 `wbs_items.depends_waived`).
  면제된 간선은 `reached` 가 참이다(claim 게이트도 통과). 면제된 간선에는 `head_sha` 가 없는 것이 정상이다 — 서버의
  `head_sha` 는 승인된 주문의 완료 보고에서만 오고, 승인된 선행은 면제할 이유가 없다.
- 스텁 제거 하위 Task 가 주문으로 나온다. `external_ref` 는 `<후행 ref>.stub.<선행 TSK>` 이고 `depends` 는 `[선행, 후행]` 이다.
- CLI: `check_depends_local` 이 `waived` 간선을 건너뛴다. `dflow.sh stub-check [<ref>]` — 승격 관문(표식 있으면 exit 4).
- 설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-23-force-progress-design.md(킷에는 미동봉).
```

`.claude/skills/dflow-work/references/force-progress-hook.md`:

````markdown
# 강제 진행 스텁 — 승격 관문 훅 예시

운영 브랜치(`.dflow` 의 `release_branch`)로 push 할 때만 스텁 표식을 검사한다. 대상 리포의 `.githooks/pre-push`
(또는 쓰는 훅 관리자)에 넣는다.

```sh
#!/bin/sh
# pre-push: 운영 브랜치로 가는 push 에 FORCE-STUB 표식이 있으면 거부한다.
DFLOW=.claude/skills/dflow-work/scripts/dflow.sh
REL=$(sh "$DFLOW" branch release 2>/dev/null) || exit 0   # 설정이 없으면 관여하지 않는다
while read -r _local_ref _local_sha _remote_ref _remote_sha; do
  [ "$_remote_ref" = "refs/heads/${REL#origin/}" ] || continue
  sh "$DFLOW" stub-check "$_local_sha" || { echo "운영 브랜치에 강제 진행 스텁이 남아 있다 — 스텁 제거 작업을 먼저 끝내라" >&2; exit 1; }
done
exit 0
```

개발 브랜치와 운영 브랜치가 같은 리포(종전 운영)는 이 훅으로 막을 수 없다 — `/dflow-merge` 가 머지 전에 같은 검사를 한다.
````

`.claude/skills/dflow-dev/SKILL.md` — Phase 01 2번 「선행 검사」 목록의 **맨 앞**(「v2.3 서버는 판정 결과를 `d.reached` 로 준다」 항목 앞)에:

```markdown
     - **v2.8: `d.waived === true` 면 **강제 진행 간선**이다**(사람이 이 선행을 기다리지 않기로 면제했다).
       완료 판정·기본 브랜치 반영 확인·스택을 하지 않는다. 「강제 진행: <선행> 은 스텁으로 대신한다」 를 한 줄 남기고,
       그 선행의 계약(show 의 선행 spec·acceptance, 없으면 `dflow.sh show <선행 ref>`)을 읽어 아래 「강제 진행 스텁 규칙」대로
       스텁/목을 둔다. 기점은 항상 `origin/<기본브랜치>` 다(면제된 선행에는 `head_sha` 가 없다 — 승인 전 브랜치 위에
       쌓으면 선행이 반려될 때 함께 무너진다). 대화형은 행 G 갈래 1 처럼 로컬 선행 산출물이 있으면 스택할 수 있으나
       `--worker` 는 하지 않는다.
```

행 G 표 칸(「--worker」 표의 G 행)의 설명 끝에 한 문장: `` `waived:true` 간선은 이 행의 대상이 아니다 — Phase 01 2번의 강제 진행 갈래로 간다(기본 브랜치 반영 확인 없음). ``

Phase 01 2번 목록 뒤(「판정 통과 후 **기점을 정하고**」 문단 앞)에 새 절:

```markdown
   - **강제 진행 스텁 규칙**(스펙 2026-09-23 §3.4):
     1. 후행 소유 경로에 둔다 — 선행이 만들 파일을 먼저 만들지 않는다. 예: `src/__stubs__/<선행 TSK-ID>/order.ts` 에 계약대로
        쓰고 주입 지점 한 곳에서만 바꿔 끼운다. 공유 등록 목록의 같은 줄을 고치지 않는다(2026-09-21 충돌 원인).
     2. 테스트에만 필요하면 테스트용 목으로 끝내고 런타임 스텁을 만들지 않는다.
     3. 런타임 스텁에는 계약에 맞는 고정 응답을 넣어 후행 테스트가 개발 브랜치에서 통과하게 한다.
     4. 표식: 코드에 `FORCE-STUB: <선행 TSK-ID>` 주석. design.md 와 완료 보고에 「강제 진행 스텁」 절(대신한 선행·대상·가정한 계약).
     5. 완료 보고 뒤 승인은 스텁 제거 하위 Task(`<후행 ref>.stub.<선행 TSK>`)가 끝날 때까지 잠긴다 — 정상이다.
     6. 스텁 제거 하위 Task 를 맡으면: `git grep -n 'FORCE-STUB: <선행 TSK>'` 가 0건이 되고 후행 테스트가 실구현 상대로
        통과해야 완료다. 실구현 상대로 실패하면 계약 어긋남으로 보고한다(스텁을 고쳐 통과시키지 않는다).
```

`.claude/skills/dflow-merge/SKILL.md` — 머지 절차의 머지 명령 직전 단계에:

```markdown
- **강제 진행 스텁 관문**: 개발 브랜치와 운영 브랜치가 같으면(`dflow.sh branch dev` 와 `dflow.sh branch release` 가 같은 값)
  머지 전에 `dflow.sh stub-check <머지 대상>` 을 돌린다. exit 4 면 머지하지 않고 「스텁 잔존 — 개발 브랜치 미설정 리포라
  운영에 스텁이 들어간다」 로 보고한다(스펙 2026-09-23 §4). 두 브랜치가 다르면 이 검사를 하지 않는다 — 스텁은 개발 브랜치에
  머지되는 것이 정상이고(F5), 관문은 운영 승격이다.
```

`.claude/skills/dflow-team/SKILL.md` — 「선행 사전 검사」 문단(`deps_unmet` 설명) 끝에 한 문장: `면제된 간선(`waived:true`, 계약 2.8)은 서버가 `reached:true` 로 주므로 이 검사에 걸리지 않는다 — 그대로 spawn 한다.`

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills 2>&1 | tail -5`
Expected: PASS(기존 셸 블록 문법 검사 포함 — `tests/skills/dflow-team-shell-blocks.test.ts` 가 있으면 함께 통과해야 한다)

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/references/api-contract.md .claude/skills/dflow-work/references/force-progress-hook.md .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-merge/SKILL.md .claude/skills/dflow-team/SKILL.md tests/skills/dflow-force-progress.test.ts
git commit -m "feat(skills): 강제 진행 간선·스텁 규칙·승격 관문을 스킬에 넣는다

면제된 간선은 head_sha 가 없는 것이 정상이라 로컬 도달 검사와 행 G 가 막으면 면제가 무력해진다.
스텁은 후행 소유 경로에 표식과 함께 두고, 운영 승격 전에 stub-check 로 남은 표식을 거부한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 통합·스테이징 리허설·반영 (컨트롤러가 직접)

- [ ] **Step 1: 병렬 워크트리 머지와 전체 검증**

각 Task 워크트리 브랜치를 `feat/force-progress` 로 머지한 뒤(`git merge --no-ff <브랜치>`), 워크트리 `.claude/worktrees/force-progress` 에서:

Run: `npx vitest run 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: 실패 0.

- [ ] **Step 2: 스테이징 DB 적용과 동작 검증**

`staging:sync` 는 돌리지 않는다. 판단: 0103 은 컬럼 추가(기본값 있음)·함수·트리거라 기존 데이터에 기대지 않고, sync 는 스테이징 데이터를 운영 데이터로 덮어 병렬 세션의 검증 데이터를 지운다. 이 판단을 원장에 `Ruling:` 으로 남긴다. 0102(과제 C)가 스테이징에 먼저 적용됐는지 확인한다 — 번호 순서를 지키기 위해서다(`npm run db:apply` 원장이 순서를 요구하면 0102 적용을 기다린다).

```bash
npm run db:apply -- supabase/migrations/0103_force_progress.sql --target staging
npm run db:apply -- scripts/checks/0103_force_progress_check.sql --target staging
```

Expected: 첫 명령 성공. 둘째 명령은 `FORCE_PROGRESS_CHECK_OK` 알림 또는 오류 없이 끝나고(assert 실패면 예외 메시지로 멈춘다), 롤백되어 `zz0103/` 행이 남지 않는다. 확인용 한 줄 SQL(`select count(*) from wbs_items where external_ref like 'zz0103/%'`)을 스크래치 파일로 써서 `db:apply` 로 넘긴다. 기대 0.

롤백 리허설: `npm run db:apply -- supabase/migrations/0103_force_progress_rollback.sql --target staging` → 성공 확인 → 다시 `0103_force_progress.sql` 적용.

- [ ] **Step 3: 스테이징 검증 트레일러**

```bash
git commit --allow-empty -m "chore: 0103 스테이징 리허설 통과를 기록한다" \
  --trailer "Staging-verified: $(date +%F) db 리허설·롤백 리허설 통과" \
  --trailer "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: staging 반영**

```bash
cd /Users/jji/project/wbs-web && git fetch -q origin
cd .claude/worktrees/force-progress && git merge -q origin/main && git merge -q origin/staging   # back-merge(병렬 세션 몫 포함)
npx vitest run tests/domain tests/agent tests/skills 2>&1 | tail -3
git push origin HEAD:staging
```

Expected: push 성공. force push 금지.

- [ ] **Step 5: 스테이징 실동작 확인 (ego-browser)**

스테이징 배포가 끝난 뒤, 스테이징 프로젝트에서:
1. 계약(spec)이 있는 미도달 선행을 가진 후행 Task 의 사이드바 「강제 진행」 → 사유 입력 → 확정. 후행 아래에 「스텁 제거」 칩의 하위 행이 생기고, 후행 작업명 옆에 「스텁 잔존」 배지가 뜨는지 본다. 배지를 누르면 하위 행으로 이동하는지.
2. 후행에 reported 주문이 있으면 사이드바·허브 승인 큐·오피스 좌석에서 승인 버튼이 비활성이고 「스텁 잔존: <선행> 대체」 가 보이는지, 사이드바 결재 대기 배지 수가 그만큼 줄었는지.
3. `dflow.sh show <후행 id>` 의 `depends_evidence` 에 `"waived": true, "reached": true` 가 있는지.
4. 「면제 해제」 → 하위 행은 남고 배지도 남는지. 「스텁 제거 작업 취소」 → 하위 행이 사라지고 승인 버튼이 풀리는지.
5. 계약 없는 선행에는 버튼이 꺼지고 「선행 계약 없음」 이 보이는지.

- [ ] **Step 6: 정리**

워크트리를 지우고(`git worktree remove .claude/worktrees/force-progress` 와 Task 별 워크트리), 브랜치 `feat/force-progress` 와 Task 브랜치를 지운다(`git branch --merged origin/staging` 으로 포함을 확인한 뒤). 운영 반영은 지시 뒤이고 순서는 **0103 prod 적용 먼저 → main 머지**(역순이면 `stub_for` 컬럼이 없어 WBS 로더가 깨진다) → dflow-kit 재빌드(계약 2.8).

---

## 실행 기록

(2026-09-23, 워크트리 `/Users/jji/project/wbs-web-force`, 브랜치 `feat/force-progress`. 서브에이전트 없이 한 세션이 Task 1~10 을 순서대로 했다.)

- Task 0: 워크트리는 컨트롤러가 준비. 기준선 tsc 오류 28건(테스트 파일)·계약 2.5·최신 마이그레이션 0101. 병렬 Task 워크트리는 쓰지 않았다(순차 진행).
- 전 커밋: `Co-Authored-By` 에 더해 `Claude-Session` 트레일러를 붙였다(세션 규칙).
- Task 1: `evaluateStartReadiness` 는 면제 링크를 선행 행 조회 **전에** satisfied 로 둔다 — 그 뒤 `predecessorReached` 호출에는 `waived` 를 넘기지 않는다(좁혀진 타입이라 tsc 가 비교를 거부). 면제 링크의 선행 행이 없을 때 unknown 이 아닌 것을 테스트로 더했다.
- Task 3: 0097 이 `apply_workflow_event` 의 최신 정의임을 확인(0098~0101 재정의 없음, 0097 파일에 begin/commit 없음). `change_logs.user_id` nullable·`acceptance jsonb`·`(project_id, code)` 유니크 없음을 확인했다.
- Task 3: 스테이징 DB 적용·검증을 Task 11 대신 **Task 3 커밋 직후** 했다 — 뒤 Task 가 SQL 위에 쌓이기 전에 문법·동작을 확인하려고. `staging:sync` 는 돌리지 않았다(Ruling: 0103 은 기본값 있는 컬럼·함수·트리거라 기존 데이터에 기대지 않고, sync 는 병렬 세션의 스테이징 검증 데이터를 덮는다). assert 가 실제로 오류를 내는지 탐침(`assert false`)으로 먼저 확인했다. 순서: 적용 → 검증 SQL 통과 → 잔존 0 → 롤백 리허설 → 컬럼·RPC 사라짐 확인 → 재적용 → 검증 SQL 통과 → 잔존 0. 마지막에 한 번 더 검증 SQL 통과.
- Task 4: `src/app/(app)/projects/page.tsx` 는 select 만이 아니라 `heroTaskStats` 도 stub 행을 뺀다(홈 히어로 리프 수가 늘지 않게). `wbsImport.ts` 의 `treeMaxDepth` 캐스트 타입에 `stub_for` 를 더했다.
- Task 5: `STUB_LOCK_ACTUAL_MSG` 는 export 하지 않는다 — `'use server'` 파일의 비동기 함수 외 export 는 `next build` 를 깬다.
- Task 5: `updateActual` 의 스텁 하위 조회는 100 입력일 때만 돈다. 계획의 「99 는 저장된다」 테스트 큐(`{data: []}` 한 칸 더)는 99 에서 그 조회가 없어 update 응답을 잘못 소비하므로 큐를 고쳤다. 기존 lock 테스트 두 건(100 저장 경로)에 스텁 조회 응답 `{ data: [] }` 한 칸을 넣었다. 조회 실패 거부 테스트를 더했다.
- Task 5: `addSubAct` 는 대상 자신이 stub 하위일 때도 거부한다(F11 잎 전용 — 계획은 형제 검사만 적었다). `isSubtreeManager`(서버 가드)의 F15 테스트를 `tests/agent/subtree-manager.test.ts` 에 더했다.
- Task 5: 빌더 `is`·`not` 보강은 계획 목록 대신 실제로 실패한 파일만 고쳤다(`wbs-dev-workflow`·`wbs-update-actual-lock`·`ensure-agent-project`·`ensure-order`·`wbs-import`). 허브 컬럼 계약 테스트(`tests/data/agent-hub.test.ts`)의 select 문자열도 갱신.
- Task 6: 계약 2.8 은 서버 상수(`externalApi.ts`)를 Task 6 에서, `dflow.sh`·`api-contract.md` 를 Task 10 에서 올렸다(두 값을 대조하는 테스트는 없다). `me-route`·`depends-gate`·`work-routes-pat` 테스트 기대값에 `contract_version '2.8'`·`waived: false` 를 반영.
- Task 7: **선행 계약 판정 재료를 `spec`·`acceptance` 원본이 아니라 로더가 계산한 불리언 `WbsRow.hasContract` 로 싣는다** — spec 은 조립된 마크다운 본문이라 항목마다 클라이언트로 보내면 WBS 페이로드가 커진다. `waiveBlock` 의 pred 는 `hasContract` 가 있으면 그것을 쓰고 없으면 원본으로 판정한다(테스트 추가). 사이드바 테스트 픽스처도 `hasContract` 로 바꿨다.
- Task 7: 「강제 진행」 절은 선행 목록 블록 **안이 아니라** 의존성 절 바로 위 별도 블록에 둔다 — 의존성 절은 접히고 그래프 보기도 있어, 그 안에 두면 버튼이 안 보인다. 승인 버튼 비활성은 `RowDetailPanel → WbsAssigneeStagePanel → WbsSpecPanel → WbsAgentOrderStatus` 로 `stubs` prop 을 내려 처리했다.
- Task 7: `WbsGanttSheet` 의 다른 트리 순회도 `subTasks` 를 탄다 — 검색(buildMatch)·depthMap·자손 수·개요 번호(하위는 `<후행 번호>.S1`)·L1/L2 그룹·focus 예외. 레벨 버튼 수 계산은 stub 행을 뺀다. 완료 숨김이 켜지면 stub 행은 후행을 따라 숨는다(고아 행 방지). 편집 버튼 노출은 기존 `editable`(관리자) 그대로 — 서브트리 관리자는 서버 액션이 허용하지만 사이드바 버튼은 관리자에게만 보인다(후속 과제).
- Task 8: 좌석 카드는 버튼 안이라 링크를 둘 수 없어 배지(`title` 에 문구)만 두고, 링크는 상세 패널(`DetailPanel`)에 둔다. 좌석 승인 잠금은 `seatOps.opsFor` 한 곳에서 한다(좌석 바·상세 패널 공통). 오피스 로더의 스텁 하위 조회는 기존 조회 순서를 흐트리지 않도록 맨 끝에 두었다(`tests/data/agent-seatmap.test.ts` 호출 기대값 갱신). 결재 배지 데이터 테스트의 목에 `in`·`not` 과 스텁 조회 카운터를 더했다.
- Task 9: 설정 폼은 `StageCreditSlider` 안이 아니라 새 컴포넌트 `src/components/settings/BottleneckSettingsForm.tsx` 로 두고 설정 페이지에서 슬라이더 아래에 그린다. 층 제안 띠·배지 스타일은 오피스 CSS 모듈(`seatmap.module.css`)에 클래스로 더했다.
- Task 10: 계획 테스트의 `CONTRACT_VERSION=2\.6` 은 오타로 보고 2.8 로 고쳤다. `DFLOW_SKIP_CONFIG` 는 dflow.sh 에 없는 이름이라 테스트에서 뺐다(설정이 없어도 `stub-check <ref>` 는 돈다 — 설정 로드가 없는 리포에서 실패하지 않음을 확인). 계약 문서 문구는 테스트 기대에 맞춰 `` `depends_evidence[].waived`(boolean) `` 로 적었다. `/dflow-dev` 원문 보존 테스트가 표지 블록 밖 `--worker` 와 블록 수를 고정하므로, 강제 진행 갈래의 워커 문장은 「팀원(워커) 모드는 하지 않는다(행 G)」 로 표지 블록 없이 적었다.
- 마감 점검(advisor): **SQL 쪽 리프 판정을 전수 확인**했다. 살아 있는 것은 `apply_workflow_event`(0103 이 이미 고침) 말고 `wbs_is_leaf`(0022, `member_update_actual` RLS 정책이 씀) 하나였다 — 자식 유무만 보면 멤버가 스텁 하위 달린 후행의 실적%를 고칠 때 RLS 가 0행으로 막는다. 0103 에 `and c.stub_for is null` 로 재정의하고 rollback 은 컬럼 삭제 전에 0022 본문으로 되돌리도록 고쳤다(마이그레이션 단독 커밋, 검증 SQL 에 `wbs_is_leaf(v_succ)` 단언 추가). 스테이징은 새 rollback → 복원 확인 → 새 0103 적용 → 검증 SQL → 잔존 0 → `wbs_is_leaf` 본문 확인까지 다시 했고, 그 뒤 `Staging-verified:` 빈 커밋을 새로 남겼다. `import_wbs_upsert`(0096 최신)는 리프 판정·삭제가 없고, 0092 는 일회성 데이터 정리라 해당 없다.
- 마감 점검: 엑셀 내보내기는 트리 `children` 을 돌아 stub 하위가 빠진다. `/api/v1/wbs/structure` 는 raw `parent_id` 로 돌아 stub 하위를 일반 노드로 냈으므로 `stub_for` 행을 걸러 냈다(테스트 추가).
- Task 11: push·origin/staging 머지·ego-browser 실동작 확인·워크트리 정리는 하지 않았다 — **반영 대기**(컨트롤러가 순서대로 머지). origin/staging 에는 그사이 과제 C(0102·계약 2.6)가 들어왔다. 0102 는 `agent_work_reports` 만 바꿔 0103 과 겹치지 않는다. 머지 때 `externalApi.ts`·`dflow.sh`·`api-contract.md` 의 계약 버전 줄이 충돌할 수 있다(이 과제 값은 2.8).
- 최종 검증: `npx vitest run` 544 파일·6217 건 통과(부하가 높을 때 `tests/skills/dflow-lead-lease`·`heartbeat-hook`·`tests/domain/trend` 가 시간 초과로 간헐 실패했고 단독 재실행은 전부 통과 — 이번 변경과 무관), tsc 오류 28건(기준선과 같음), `npm run lint` 오류 0·경고 6(기존).

### 최종 리뷰 반영 (2026-09-23)

- stub-check 오탐: `.claude/`·`docs/`·`*.md` 를 제외하고 `FORCE-STUB: [A-Za-z0-9]`(ID 가 바로 뒤따르는 표식)만 센다. ref 를 준 호출은 설정 로드 전에 처리한다 — 이 리포처럼 `.dflow` 는 있고 `.dflow.local` 이 없는 곳에서 NO_LOCAL(exit 2)로 죽었다. 테스트 파일의 표식 문자열은 조립해 이 리포 HEAD 가 0건으로 통과한다(테스트로 고정).
- AI 도구 저장소(`repositories/supabase/wbs.ts`)가 `stub_for`·`depends_waived` 를 읽고 `mergeSpecDepends` 에 부모·stub 표식을 넘긴다. 간트 합성은 스텁 하위의 부모(후행) 간선을 긋지 않는다.
- 하위 취소: 사유 필수, 부모 기준 `change_logs(field=stub_cancelled)` 를 **주문 취소·삭제 전에** 남기고(이력 실패면 중단), 부모 `depends_waived` 에 그 선행이 있으면 거부(「먼저 면제를 해제하세요」). 사이드바는 면제가 살아 있으면 취소 버튼을 숨기고, 취소도 같은 확인 창에서 사유를 받는다.
- 사이드바 권한: 페이지 로더(`lib/data/forceProgress.ts` → 순수 `domain/forceProgressRights.ts`)가 `isSubtreeManagerOf`(F15 포함)로 관리 대상 id 를 계산해 넘기고, 버튼은 `editable || canForce`. 조회 실패는 빈 목록(버튼 숨김) + 로그.
- 오피스 진입점: 비용이 작아 구현했다 — 「선행 대기」 좌석 상세에 「강제 진행 검토」 링크. 링크가 사이드바까지 열도록 WBS 페이지에 `?open=1`(focusOpen)을 더했다. 기존 `?focus=` 만의 동작(사이드바 안 엶)은 그대로다. 스텁 잔존 링크(허브 큐·허브 표·좌석 상세)도 `&open=1` 을 붙였다. 좌석 상세에서 바로 면제하는 UI 는 두지 않았다 — 사유·계약 판정·해제·취소가 사이드바 한 곳에 있어야 판정이 갈리지 않는다.
- 재업로드(F11): `runWbsImport` 가 RPC 전에 스텁 하위가 달린 후행 아래 일반 자식, 그리고 스텁 하위 ref 를 덮어쓰는 노드를 전량 보고하며 거부한다.
- `deleteWbsItem` 은 스텁 하위를 지우지 않고 취소 경로를 안내한다(조회 실패는 중단).
- 선행 도달 알림: 면제 간선은 충족으로 보고, 도달한 선행이 그 후행의 면제 간선이면 알리지 않는다(이미 착수 가능했다).
- 하위 ref·code 는 선행 ref **전체**를 `[^A-Za-z0-9._-]→_` 로 치환해 만든다(`m/TSK-02.stub.m_TSK-01`). 0103 을 고쳐 마이그레이션 단독 커밋으로 두고, 스테이징은 rollback → 복원 확인 → 재적용 → 검증 SQL(`code`·`external_ref` 새 식 단언) → 잔존 0 → `wbs_is_leaf` 확인까지 다시 했다. 스텁 마커 검색 예시(`FORCE-STUB: <TSK>`)·`__stubs__/<TSK>/` 경로는 사람이 읽는 TSK 코드라 마지막 칸을 그대로 쓴다.
- 강제 진행 버튼의 선행 도달은 롤업값이 아닌 원값(stage·actual_pct)으로 판정한다 — RPC 와 같다. 승인된 주문 축은 화면에 재료가 없어 여전히 RPC 가 최종 판정한다(버튼이 켜져 있어도 `already_reached` 로 거부될 수 있다).
- 검증: `npx vitest run --testTimeout=60000` 546 파일·6240 건 통과, tsc 28(기준선), lint 오류 0·경고 6(기존), `dflow.sh stub-check HEAD` → FORCE_STUB_NONE.
