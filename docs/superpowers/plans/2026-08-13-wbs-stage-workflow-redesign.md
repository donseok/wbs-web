# WBS Stage 워크플로 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stage 축에서 'todo'를 제거하고(NULL→as→…→xx), 항목별 `dev_workflow` 플래그를 신설해 "체크 = 에이전트 개발 대상 = 주문 자동 존재"로 만들며, 담당자 배정·에이전트 라이프사이클(claim/report/approve)이 stage를 자동 전이시킨다.

**Architecture:** stage 의미는 dev-workflow 리포 `state-machine.json`이 정본(as=할당, fp=강제 진행, ip=진행 중, im=구현 완료·검수 대기, xx=완료). 축 3분리 — 도입 여부(`dev_workflow`), 진행(`stage`), 소유(`assignee_member_id`). 주문(agent_work_orders)은 "dev_workflow ON인 리프에는 주문이 존재한다"로 재정의되어 배정 없이도 available 구획에 노출된다. stage 자동 전이는 `dev_workflow=true`일 때만 작동한다(레거시 % 관리 항목 무간섭).

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17, service_role admin client), vitest.

**사용자 확정 결정 (2026-08-13):**
1. 'todo' 제거 — stage는 `as|fp|ip|im|xx` 또는 NULL(미착수).
2. 담당자 배정 시 stage NULL→`as` 자동 전이. 해제 시 `as`면 NULL 복귀, `ip` 이상은 유지.
3. 관리자는 담당자 없어도 stage 수동 변경 가능(현행 유지).
4. `dev_workflow` 체크박스 — 하위 일괄 적용 지원(담당자 캐스케이드와 같은 UX).
5. dev_workflow ON + 미배정 항목은 에이전트 available 구획에 공개(주문 자동 발행).
6. 과도기: import payload의 stage `"todo"`는 하위호환 별칭으로 수용해 NULL로 정규화(v2.0 export 안전).
7. import 시 `kind='task'` 노드는 dev_workflow 자동 ON(payload 형식 무변경 — 의미만 v2.1).

## Global Constraints

- stage 허용값: `'as','fp','ip','im','xx'` + NULL. `'todo'`는 DB CHECK·타입·UI 어디에도 남지 않는다(import 정규화 제외).
- stage 자동 전이는 **`dev_workflow = true`인 항목에서만** 작동한다. false면 어떤 경로도 stage를 건드리지 않는다.
- 선행 게이트 판정은 기존 그대로 `stage ≥ im`(im·xx), NULL·미지 값은 fail-closed 미충족.
- stage를 쓰는 모든 경로는 `change_logs`(field='stage')를 남긴다. dev_workflow 변경도 field='dev_workflow'로 남긴다.
- 에러 처리 3원칙(CLAUDE.md): 조회 실패를 "없음"으로 위장 금지, 쓰기 전 선행조회 실패 시 중단, 가드 fail-closed.
- 권한: 판정은 `requireProjectAdmin`/`requireProjectMember` 가드만. `memberships.role` 읽기 금지.
- 마이그레이션과 코드는 **다른 커밋**(pre-push G1). 마이그레이션은 `_rollback.sql` 동반, 스테이징 리허설 후 `Staging-verified:` 트레일러(G4).
- 알림 자기제외: 본인 행위는 본인에게 알리지 않음(`actorUserId` 전달 관례).
- work.unblocked 발행 조건: 후행의 depends **전부** im/xx 도달 시 1회(`dedupeKey: unblocked:${successorId}:${predecessorId}`), 어느 경로(수동 setWbsStage·report·approve)로 도달했든 동일.
- i18n: 신규 문자열은 `src/lib/i18n/dict/wbs.ts` ko·en 양쪽에 추가.
- 계약 문서 갱신 후 반드시 피어 세션 `task-review-and-parser-implementation`에 통지(오케스트레이터가 수행 — Task 8 참고).

## File Structure

| 파일 | 역할 |
|---|---|
| `supabase/migrations/0079_wbs_stage_workflow.sql` (+`_rollback`) | todo 이관·CHECK 재정의·dev_workflow 컬럼·RPC 교체 |
| `src/lib/domain/agentWork.ts` | STAGE_ORDER에서 todo 제거 |
| `src/lib/agent/stageTransition.ts` **(신규)** | stage 자동 전이 공용부 + notifySuccessorsOnReached 이동 |
| `src/lib/agent/ensureOrder.ts` | dev_workflow 게이트 추가, 함수명 `ensureOrderForWorkflowLeaf`로 변경 |
| `src/app/actions/wbsAssign.ts` | 배정↔as 자동 전이, setWbsDevWorkflow 신설, setWbsStage 타입 축소 |
| `src/app/api/v1/agent/work/[id]/claim/route.ts` | claim 성공 → stage `ip` |
| `src/app/api/v1/agent/work/[id]/report/route.ts` | completion 보고 → stage `im` + unblocked |
| `src/app/actions/agentWork.ts` | 승인 → stage `xx` + unblocked (반려는 im 유지 = 무동작) |
| `src/lib/agent/wbsImport.ts` | todo→NULL 정규화, dev_workflow(kind=task), 전 신규 task 리프 주문 보장 |
| `src/components/wbs/WbsAssigneeStagePanel.tsx` | todo 옵션 제거, 라벨 교체, dev_workflow 체크박스 |
| `src/lib/i18n/dict/wbs.ts` | 라벨 정정(ko·en) |
| `docs/agent/claude-skill/dflow-work/references/api-contract.md` | v2.1 |

---

### Task 1: 마이그레이션 0079 — todo 제거·dev_workflow 컬럼·RPC 교체

**Files:**
- Create: `supabase/migrations/0079_wbs_stage_workflow.sql`
- Create: `supabase/migrations/0079_wbs_stage_workflow_rollback.sql`
- Test: `tests/migrations/wbs-stage-workflow.test.ts`

**Interfaces:**
- Produces: `wbs_items.dev_workflow boolean not null default false`, stage CHECK `('as','fp','ip','im','xx')`, RPC `import_wbs_upsert`가 노드 필드 `dev_workflow`(boolean)·stage `'todo'` 정규화를 처리.

주의: 커밋 직전 `ls supabase/migrations/ | tail`로 0079가 여전히 비어 있는지 확인(병렬 세션 번호 충돌 이력 2회). 선점됐으면 다음 번호로 파일명·본문 헤더를 함께 올린다.

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- 0079: stage 워크플로 재설계 — 'todo' 제거(NULL=미착수로 통합), dev_workflow 플래그 신설.
-- 배경(2026-08-13 사용자 결정): 담당자·stage가 독립 축이라 "담당자 있는데 할 일/미도입" 같은
-- 모순 조합이 생겼다. 도입 여부는 dev_workflow(boolean), 진행은 stage(NULL→as→…→xx),
-- 소유는 assignee_member_id 로 축을 분리한다. stage 의미 정본은 dev-workflow state-machine.json.

-- 1) 기존 'todo' 행을 NULL 로 이관 (CHECK 재정의 전에 수행해야 한다)
update public.wbs_items set stage = null where stage = 'todo';

-- 2) CHECK 재정의 — 0077 이 컬럼 인라인으로 만든 자동명 제약을 지우고 명시명으로 재생성
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','fp','ip','im','xx'));

-- 3) dev_workflow — "에이전트 개발 워크플로 대상" 플래그. 기존 행은 전부 false(레거시 % 관리).
alter table public.wbs_items
  add column if not exists dev_workflow boolean not null default false;

-- 4) RPC 교체 — dev_workflow upsert + stage 'todo' 하위호환 정규화(v2.0 export 수용).
--    (0077 본문 전체를 복사한 뒤 아래 세 군데만 다르게: stage 값 식, insert 컬럼/값에
--     dev_workflow 추가, on conflict set 에 dev_workflow = excluded.dev_workflow 추가.)
--    stage 값 식은 nullif(v_node->>'stage','') 를 다음으로 교체:
--      case when v_node->>'stage' in ('', 'todo') then null else v_node->>'stage' end
--    dev_workflow 값 식: coalesce((v_node->>'dev_workflow')::boolean, false)
create or replace function public.import_wbs_upsert(...) -- 0077 시그니처 그대로
...
```

구현자는 0077의 `import_wbs_upsert` 본문 전체를 기준으로 위 세 변경만 반영해 `create or replace`로 다시 만든다. 시그니처(인자·반환)는 바꾸지 않는다.

- [ ] **Step 2: rollback SQL 작성**

```sql
-- 0079 rollback: dev_workflow 제거, CHECK 를 0077 형태('todo' 포함)로 복원, RPC 를 0077 본문으로 복원.
-- 주의: NULL→'todo' 역이관은 하지 않는다 — 어떤 NULL 이 원래 'todo' 였는지 정보가 소실됐고,
-- 0077 CHECK 는 NULL 을 허용하므로 역이관 없이도 정합하다.
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('todo','as','fp','ip','im','xx'));
alter table public.wbs_items drop column if exists dev_workflow;
-- (이어서 0077 의 import_wbs_upsert 본문을 그대로 create or replace)
```

- [ ] **Step 3: 마이그레이션 구조 테스트 작성·실행** — `tests/migrations/wbs-assignee-stage.test.ts`의 기존 패턴(SQL 파일을 읽어 문자열 규칙 검증)을 따라: 0079 본문에 `update public.wbs_items set stage = null where stage = 'todo'`가 CHECK 재정의보다 먼저 나오는지, CHECK에 'todo'가 없는지, rollback에 dev_workflow drop이 있는지, RPC에 `'todo'` 정규화 case 식이 있는지 검증. `npx vitest run tests/migrations/wbs-stage-workflow.test.ts` PASS 확인.

- [ ] **Step 4: 커밋** (마이그레이션 단독 커밋 — G1)

```bash
git add supabase/migrations/0079_wbs_stage_workflow.sql supabase/migrations/0079_wbs_stage_workflow_rollback.sql tests/migrations/wbs-stage-workflow.test.ts
git commit -m "feat(db): 0079 — stage 'todo' 제거·dev_workflow 플래그, import RPC v2.1"
```

(테스트 파일은 코드지만 마이그레이션 검증 전용이라 관례상 G1 예외 아님 — G1이 막으면 테스트만 별도 커밋으로 분리한다.)

---

### Task 2: 도메인·전이 공용부 — STAGE_ORDER 축소, stageTransition 모듈 신설

**Files:**
- Modify: `src/lib/domain/agentWork.ts:9` (STAGE_ORDER)
- Create: `src/lib/agent/stageTransition.ts`
- Modify: `src/app/actions/wbsAssign.ts` (notifySuccessorsOnReached·allPredecessorsReached를 새 모듈로 이동, import 교체)
- Test: `tests/agent/stage-transition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/agent/stageTransition.ts
  export type WbsStage = 'as' | 'fp' | 'ip' | 'im' | 'xx'
  export const REACHED_STAGES: Set<string> // {'im','xx'}
  /** dev_workflow=true 항목의 stage 를 조건부로 전이시키고 change_logs 를 남긴다.
   *  - fromIn 이 주어지면 현재 stage 가 그 안에 있을 때만 전이(아니면 no-op, ok:true).
   *  - 전이 결과 im/xx 에 "처음" 도달하면 notifySuccessorsOnReached 를 호출한다.
   *  - 실패는 로깅만 하고 { ok:false } — 호출부 본 로직(claim·report·승인)을 깨지 않는다. */
  export async function transitionStage(
    admin: AdminClient,
    args: {
      itemId: string
      to: WbsStage | null
      fromIn?: ReadonlyArray<WbsStage | null>
      actorUserId: string
    },
  ): Promise<{ ok: boolean; transitioned: boolean }>
  export async function notifySuccessorsOnReached(
    admin: AdminClient,
    item: { id: string; project_id: string; name: string; external_ref: string | null },
    actorUserId: string,
  ): Promise<void>
  ```
- Consumes: `emitNotification`(기존), `AdminClient` 타입(`@/lib/minutes/externalApi`).

`transitionStage` 동작 순서(테스트가 이 순서를 고정한다):
1. `wbs_items`에서 `id, project_id, name, external_ref, stage, dev_workflow` 조회. 실패/없음 → `{ ok:false, transitioned:false }` + 로깅.
2. `dev_workflow !== true` → `{ ok:true, transitioned:false }` (무간섭 — Global Constraints).
3. `fromIn`이 있고 현재 stage가 목록 밖 → `{ ok:true, transitioned:false }`.
4. 현재 stage === to → `{ ok:true, transitioned:false }`.
5. UPDATE(stage, updated_at) + change_logs insert(field='stage', old/new). change_logs 실패는 로깅만.
6. old가 im/xx 아님 && to가 im/xx → `notifySuccessorsOnReached` 호출.

- [ ] **Step 1: 실패 테스트 작성** — vitest + 기존 `tests/agent/`의 supabase admin 모킹 패턴(체이닝 mock)을 그대로 따른다. 케이스: (a) dev_workflow=false면 UPDATE 없이 transitioned:false, (b) fromIn=['as','fp',null]인데 현재 'ip'면 no-op, (c) null→'as' 전이 시 change_logs insert payload {field:'stage', old_value:null, new_value:'as'}, (d) 'ip'→'im' 전이 시 notifySuccessorsOnReached 경로의 후행 조회가 호출됨, (e) 조회 에러 시 ok:false.
- [ ] **Step 2: 테스트 실패 확인** — `npx vitest run tests/agent/stage-transition.test.ts` FAIL(모듈 없음).
- [ ] **Step 3: 구현** — `stageTransition.ts` 작성. `notifySuccessorsOnReached`·`allPredecessorsReached`는 `wbsAssign.ts`에서 **그대로 옮기고**(주석 포함) `wbsAssign.ts`는 새 모듈을 import. 시그니처 중 `item` 파라미터 타입만 위 Interfaces대로 좁힌다(LoadedItem 의존 제거).
- [ ] **Step 4: STAGE_ORDER 축소** — `src/lib/domain/agentWork.ts`: `['todo','as','fp','ip','im','xx']` → `['as','fp','ip','im','xx']`. 주석의 "§2.5" 유지. `stageAtLeast`는 무변경(인덱스 기반이라 자동 정합).
- [ ] **Step 5: 전체 관련 테스트 실행** — `npx vitest run tests/agent/ tests/actions/` PASS. `tests/agent/depends-gate.test.ts`가 'todo'를 참조하면 기대값을 갱신한다('todo'는 이제 STAGE_ORDER 밖 → stageAtLeast false — fail-closed로 기존과 동일 판정이므로 테스트 의미는 유지).
- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/agentWork.ts src/lib/agent/stageTransition.ts src/app/actions/wbsAssign.ts tests/agent/stage-transition.test.ts tests/agent/depends-gate.test.ts
git commit -m "feat(wbs): stage 전이 공용부 신설·STAGE_ORDER에서 todo 제거"
```

---

### Task 3: ensureOrder 재정의 — dev_workflow 게이트, 배정 불요

**Files:**
- Modify: `src/lib/agent/ensureOrder.ts` (함수명 `ensureOrderForWorkflowLeaf`로 변경)
- Modify: 호출부 3곳 — `src/app/actions/wbsAssign.ts`, `src/lib/agent/wbsImport.ts`(import 문·호출명만, 로직 변경은 Task 6), `src/app/actions/agentWork.ts`(호출이 있으면)
- Test: `tests/agent/ensure-order.test.ts` (기존 파일 확장)

**Interfaces:**
- Produces: `ensureOrderForWorkflowLeaf(admin, { projectId, wbsItemId, actorUserId, instructions? })` — 반환 타입에 reason `'not_workflow'` 추가:
  ```ts
  | { ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' | 'not_workflow' }
  | { ok: false; error: string }
  ```

- [ ] **Step 1: 실패 테스트 추가** — 기존 ensure-order 테스트에: (a) 항목 dev_workflow=false → `{ok:true, created:false, reason:'not_workflow'}` (주문 insert 미호출), (b) dev_workflow=true·assignee null → 주문 생성되고 work.order_created 알림은 **발행 안 됨**(기존 Step 5 조건 그대로 — 수신자 없음), (c) 기존 케이스 회귀 없음.
- [ ] **Step 2: FAIL 확인** — `npx vitest run tests/agent/ensure-order.test.ts`.
- [ ] **Step 3: 구현** — Step 4(항목 조회)의 select에 `dev_workflow` 추가하고 Step 2(리프 검증) **앞으로 이동**해 `dev_workflow !== true`면 `reason:'not_workflow'` 반환. 함수명 변경 + 파일 상단 주석을 "§2.8 재정의(2026-08-13): dev_workflow ON 인 리프에는 주문이 존재한다 — 배정은 조건이 아니다"로 갱신. 호출부 3곳 import 교체.
- [ ] **Step 4: PASS 확인 + 커밋**

```bash
git add src/lib/agent/ensureOrder.ts src/app/actions/wbsAssign.ts src/lib/agent/wbsImport.ts tests/agent/ensure-order.test.ts
git commit -m "feat(agent): 주문 존재 조건을 배정에서 dev_workflow 리프로 재정의"
```

(agentWork.ts에 호출이 있으면 add 목록에 포함.)

---

### Task 4: wbsAssign 액션 — 배정↔as 자동 전이, setWbsDevWorkflow 신설

**Files:**
- Modify: `src/app/actions/wbsAssign.ts`
- Test: `tests/actions/wbs-assign.test.ts` (기존 확장), `tests/actions/wbs-dev-workflow.test.ts` (신규)

**Interfaces:**
- Consumes: `transitionStage`(Task 2), `ensureOrderForWorkflowLeaf`(Task 3).
- Produces:
  ```ts
  export async function setWbsDevWorkflow(
    itemId: string, enabled: boolean, cascade: boolean,
  ): Promise<{ ok: boolean; error?: string; count?: number; cascadeFailed?: boolean }>
  ```
- `setWbsStage` 시그니처 축소: `stage: 'as' | 'fp' | 'ip' | 'im' | 'xx' | null`. 모듈 상단 `const STAGES = new Set(['as','fp','ip','im','xx'])`.

동작 규칙:
- `setWbsAssignee(itemId, memberId)` 성공 후:
  - `memberId !== null` → `transitionStage(admin, { itemId, to:'as', fromIn:[null], actorUserId })` — dev_workflow=false·이미 다른 stage면 내부에서 no-op.
  - `memberId === null` → `transitionStage(admin, { itemId, to:null, fromIn:['as'], actorUserId })` — as만 NULL 복귀, ip 이상 유지(사용자 결정 2).
  - 전이 실패는 로깅만, 배정 결과(ok:true) 유지.
- `setWbsAssigneeCascade`: 실제 갱신된 `updatedIds` 각각에 같은 `to:'as', fromIn:[null]` 전이. (하위는 원래 미지정→새 배정이므로 전부 대상. transitionStage가 dev_workflow·현재값 검사를 맡는다.)
- `setWbsDevWorkflow(itemId, enabled, cascade)`:
  1. `resolveItemProjectId` → `requireProjectAdmin` (기존 관례 그대로).
  2. cascade=false → 본인 1건 UPDATE(dev_workflow, updated_at) + change_logs(field='dev_workflow', old/new는 'false'/'true' 문자열). cascade=true → setWbsAssigneeCascade와 동일한 트리 로드·순회로 서브트리 전체 id 수집 후 `.in('id', ids)` 일괄 UPDATE(방향 무관 — enabled 값으로 통일). 트리 조회 실패 시 중단(3원칙 ②). change_logs는 **루트 1건만**(일괄 이력 폭주 방지 — detail에 count 포함: `new_value: enabled ? 'true' : 'false'`, 별도 필드 없음).
  3. `enabled=true` 후처리: 갱신된 항목 중 리프(트리의 hasChildren 미포함) 각각 (a) `assignee_member_id`가 있고 stage NULL이면 `transitionStage(to:'as', fromIn:[null])`, (b) `ensureOrderForWorkflowLeaf` 호출. 실패는 로깅만.
  4. `enabled=false` 후처리: 갱신된 항목들의 `agent_work_orders` 중 `status='ready'`를 `cancelled`로 일괄 UPDATE(claimed/reported는 건드리지 않는다 — 진행 중 작업 강제 중단 금지). 실패는 로깅 + `cascadeFailed:true`.
  5. 반환 count = 실제 dev_workflow가 바뀐 행 수(UPDATE에 `.neq('dev_workflow', enabled)` 조건을 실어 반환 select로 집계).

- [ ] **Step 1: 실패 테스트 작성** — wbs-assign 확장: (a) 배정 성공 시 transitionStage가 `{to:'as', fromIn:[null]}`로 호출, (b) 해제 시 `{to:null, fromIn:['as']}`, (c) 전이 실패해도 반환 ok:true. wbs-dev-workflow 신규: (d) 비관리자 거부, (e) cascade=true ON — 서브트리 UPDATE·리프 ensureOrder 호출·count 집계, (f) OFF — ready 주문 cancelled·claimed 불변, (g) 트리 조회 실패 시 ok:false·UPDATE 미호출.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS 확인** — `npx vitest run tests/actions/`.
- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/wbsAssign.ts tests/actions/wbs-assign.test.ts tests/actions/wbs-dev-workflow.test.ts
git commit -m "feat(wbs): 배정↔as 자동 전이·dev_workflow 토글 액션(하위 일괄·주문 동기화)"
```

---

### Task 5: 에이전트 라이프사이클 stage 배선 — claim→ip, 완료보고→im, 승인→xx

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/claim/route.ts`
- Modify: `src/app/api/v1/agent/work/[id]/report/route.ts`
- Modify: `src/app/actions/agentWork.ts` (승인 액션)
- Test: `tests/agent/stage-lifecycle.test.ts` (신규)

**Interfaces:**
- Consumes: `transitionStage`(Task 2).

배선 규칙(모두 본 로직 성공 **후**, 실패는 로깅만 — 주문 상태 전이가 정본이고 stage는 파생):
- claim 성공(주문 claimed 확정 후): `transitionStage({ itemId, to:'ip', fromIn:['as','fp',null], actorUserId: <claim 주체 userId> })`. `fromIn`에 null 포함 — available에서 미배정 항목을 self-claim한 경우도 착수다. `im` 포함 금지 — 반려 재작업(reported→claimed 재전이)은 정본 규칙상 im 유지("반려 재작업도 im에서 수행, 역행 없음").
- report `kind:'completion'` 성공: `transitionStage({ itemId, to:'im', fromIn:['ip','as','fp',null] })` — im 도달이므로 내부에서 unblocked 발행까지 이어진다. `progress` 보고는 stage 무간섭.
- 승인(approve) 성공: `transitionStage({ itemId, to:'xx', fromIn:['im','ip','as','fp',null] })` — 사람 검수 통과가 곧 완료(정본: accept는 사람만).
- 반려(reject): stage 무간섭(im 유지).
- actorUserId: API 경로는 principal.userId(legacy면 loaded.userId 관례 — T15 참조), 승인은 가드 actor.userId.

- [ ] **Step 1: 실패 테스트 작성** — 라우트 핸들러 단위(기존 tests/agent/work-routes-pat.test.ts의 요청 모킹 패턴): (a) claim 200 후 transitionStage(to:'ip') 호출·주문이 dev_workflow=false 항목이면 stage UPDATE 없음(transitionStage 내부 게이트 — 모킹으로 확인), (b) claim이 403(dependency_not_met)이면 전이 미호출, (c) completion report 200 → to:'im', progress report → 전이 미호출, (d) 승인 성공 → to:'xx', 반려 → 미호출, (e) 전이 실패해도 응답 200 유지.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS** — `npx vitest run tests/agent/`.
- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/[id]/claim/route.ts src/app/api/v1/agent/work/[id]/report/route.ts src/app/actions/agentWork.ts tests/agent/stage-lifecycle.test.ts
git commit -m "feat(agent): claim/완료보고/승인 이 stage ip/im/xx 를 자동 전이"
```

---

### Task 6: import v2.1 — todo 정규화·dev_workflow·전 신규 task 리프 주문

**Files:**
- Modify: `src/lib/agent/wbsImport.ts`
- Modify: `src/app/api/v1/wbs/import/route.ts` (applyAssigneesAndOrders 인자 추가분 전달)
- Test: `tests/agent/wbs-import.test.ts` (기존 확장)

**Interfaces:**
- `toRpcNode` 반환에 `dev_workflow: boolean` 추가(값: `n.kind === 'task'`). stage 입력 검증: `'todo'`를 **수용하고 null로 정규화**(STAGES set은 `['as','fp','ip','im','xx']`로 축소하되 검증 전에 `if (stage === 'todo') stage = null`).
- `applyAssigneesAndOrders` 인자에 `kindByRef: Record<string, string>` 추가. 주문 보장 루프를 "assignee 있는 신규 ref"에서 "**kind='task'인 모든 신규 ref**"로 확장 — assignee 매칭(email→member, unmatched 리포트, work.assigned 알림)은 assignee 있는 것만, `ensureOrderForWorkflowLeaf`는 task 전부 호출(dev_workflow는 RPC가 이미 true로 심었고, 게이트는 함수 내부가 판정).

- [ ] **Step 1: 실패 테스트 작성** — (a) stage:"todo" 노드가 RPC payload에서 stage:null·dev_workflow:true로 변환, (b) kind:'wp'는 dev_workflow:false, (c) assignee 없는 신규 task도 ensureOrderForWorkflowLeaf 호출됨, (d) unmatched_assignees·non_leaf_skipped 기존 규칙(bare id) 회귀 없음.
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS** — `npx vitest run tests/agent/wbs-import.test.ts`.
- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/wbsImport.ts src/app/api/v1/wbs/import/route.ts tests/agent/wbs-import.test.ts
git commit -m "feat(import): 계약 v2.1 — todo 정규화·task 노드 dev_workflow 자동 ON·미배정 리프도 주문 보장"
```

---

### Task 7: UI — stage 셀렉트 정리·라벨 정정·dev_workflow 체크박스

**Files:**
- Modify: `src/components/wbs/WbsAssigneeStagePanel.tsx`
- Modify: `src/lib/i18n/dict/wbs.ts` (ko `:194-201` 부근, en `:417-424` 부근)
- Test: `tests/components/wbs-assignee-stage-panel.test.tsx` (기존 파일 있으면 확장, 없으면 신규)

**Interfaces:**
- Consumes: `setWbsDevWorkflow`(Task 4), `getWbsAssigneeStage` — **주의**: 패널이 dev_workflow 현재값을 알아야 하므로 `getWbsAssigneeStage` 반환에 `devWorkflow: boolean` 추가(Task 4에서 select에 `dev_workflow` 포함해 확장. 반환 타입: `{ assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean } | null`).

i18n 정정(정본: dev-workflow state-machine.json — ① 구현 때 추측 라벨이 들어간 오역 수정):

```ts
// ko
'wbs.stageNoneOption': '미착수',            // 구 '미도입'
// 'wbs.stageTodo' 키 삭제
'wbs.stageAs': '할당됨',                     // 구 '분석·설계'(오역)
'wbs.stageFp': '강제 진행',                  // 구 '기능 구현'(오역)
'wbs.stageIp': '진행 중',
'wbs.stageIm': '구현 완료·검수 대기',        // 구 '검수 중'
'wbs.stageXx': '완료',
'wbs.devWorkflowLabel': '개발 워크플로 대상',
'wbs.devWorkflowCascadeLabel': '하위 항목에도 일괄 적용',
'wbs.devWorkflowResult': '{n}건 변경됨',
'wbs.devWorkflowFail': '일부 항목에 적용하지 못했습니다. 다시 시도해 주세요.',
// en
'wbs.stageNoneOption': 'Not started',
'wbs.stageAs': 'Assigned',
'wbs.stageFp': 'Force proceed',
'wbs.stageIp': 'In progress',
'wbs.stageIm': 'Built · awaiting review',
'wbs.stageXx': 'Done',
'wbs.devWorkflowLabel': 'Dev workflow target',
'wbs.devWorkflowCascadeLabel': 'Apply to sub-items',
'wbs.devWorkflowResult': '{n} item(s) updated',
'wbs.devWorkflowFail': 'Some items could not be updated. Please retry.',
```

패널 변경:
- `type Stage`에서 `'todo'` 제거, `STAGES = ['as','fp','ip','im','xx']`, `STAGE_KEYS`에서 todo 삭제.
- stage 셀렉트 위에 dev_workflow 체크박스 섹션: `<input type="checkbox" checked={loaded.devWorkflow}>` + (hasChildren 시) 하위 일괄 체크박스(담당자 캐스케이드와 같은 배치·기본 on). onChange → `setWbsDevWorkflow(itemId, checked, hasChildren && devCascade)` → 성공 시 낙관적 갱신 + count 결과 표시 + `router.refresh()`. 실패·cascadeFailed 는 기존 err/warn 패턴 재사용.
- editable=false 렌더도 devWorkflow 값 표시(체크박스 disabled).

- [ ] **Step 1: 실패 테스트 작성** — (a) 셀렉트 옵션에 'todo' 없음·'as' 라벨이 '할당됨', (b) 체크박스 토글 시 setWbsDevWorkflow 호출 인자, (c) devWorkflow=false여도 stage 셀렉트는 동작(관리자 수동 변경 — 사용자 결정 3).
- [ ] **Step 2: FAIL 확인** → **Step 3: 구현** → **Step 4: PASS** — `npx vitest run tests/components/ tests/css/`.
- [ ] **Step 5: 커밋**

```bash
git add src/components/wbs/WbsAssigneeStagePanel.tsx src/lib/i18n/dict/wbs.ts tests/components/wbs-assignee-stage-panel.test.tsx
git commit -m "feat(wbs): stage 라벨 정본 정정·todo 옵션 제거·개발 워크플로 체크박스"
```

(이 패널은 `src/components/app/*`이 아니므로 G2 비대상. 다만 신규 화면 요소이므로 스테이징 확인 관례를 따른다.)

---

### Task 8: 계약 v2.1·문서 갱신 (오케스트레이터 직접 수행 항목 포함)

**Files:**
- Modify: `docs/agent/claude-skill/dflow-work/references/api-contract.md`
- Modify: `docs/agent/claude-skill/dflow-work/references/troubleshooting.md` (stage 표가 있으면)
- Modify: `docs/agent/claude-skill/dflow-work/SKILL.md`·`scripts/dflow.sh` (stage 안내 문자열이 있으면)

계약 v2.1 변경점(문서에 "v2.1 (2026-08-13)" 섹션 명시):
1. stage enum: `"as|fp|ip|im|xx"` + null(미착수). **과도기**: 서버는 `"todo"`를 수용해 null로 정규화(v2.0 export 호환 — 부트스트랩이 서버 배포 전후 어느 쪽이든 결과 동일).
2. import는 `kind:"task"` 노드에 `dev_workflow=true`를 자동 설정. payload 형식 무변경.
3. 주문 존재 조건 재정의: "배정된 리프" → "dev_workflow ON인 리프"(배정 불요, available 구획에 공개).
4. stage 자동 전이 표 추가: 배정=as(NULL에서만), claim=ip, 완료보고=im, 승인=xx, 반려=im 유지, 해제=as→NULL만. 모두 dev_workflow=true 한정.
5. 파일 표기 매핑 갱신: `[ ]`↔null. 진척 환산 표의 todo 열 제거(null=0).

- [ ] **Step 1: api-contract.md 갱신** — 위 5개 항목 반영, 문서 머리의 버전 표기를 v2.1로.
- [ ] **Step 2: 흔적 검색** — `grep -rn "todo" docs/agent/ docs/superpowers/plans/2026-08-13-*` 로 남은 'todo' stage 언급 정리(dflow.sh·SKILL.md 포함).
- [ ] **Step 3: 커밋**

```bash
git add docs/agent/claude-skill/dflow-work/references/api-contract.md <기타 갱신 파일>
git commit -m "docs(agent): 계약 v2.1 — stage 워크플로 재설계 반영"
```

- [ ] **Step 4 (오케스트레이터가 직접)**: 커밋 해시를 포함해 피어 세션 `task-review-and-parser-implementation`에 v2.1 확정 통지(SendMessage — 약속 사항).

---

## 배포 절차 (구현 완료 후, 오케스트레이터)

1. 최종 whole-branch 리뷰(SDD 관례) → 수정 반영.
2. `npm run lint && npm run build && npx vitest run` 전체 그린 확인.
3. **DB 먼저**: 팀장에게 0079 스테이징 적용 명령 블록 전달 → 검증 → 빈 커밋 `--trailer "Staging-verified: ..."`(G4) → staging push → 스테이징 브라우저 확인(체크박스·라벨·배정 전이) → 팀장 운영 적용 → main 머지·push.
   - 마이그레이션이 하위호환(컬럼 추가·CHECK 축소·데이터 이관)이라 코드보다 먼저 적용해도 v2.0 코드가 계속 동작한다('todo'를 쓰는 경로가 setWbsStage뿐인데 기존 UI에서 todo 선택 시 CHECK 위반 — **스테이징 적용~코드 배포 사이 todo 선택은 에러**. 창이 짧고 스테이징이므로 수용).
4. `npm run smoke:prod` → 사용자 화면 확인 → `npm run mark:good`.

## Self-Review 결과

- 결정 1~7 전부 태스크에 매핑됨(1→T1·T2·T7, 2→T4, 3→T7c, 4→T4·T7, 5→T3·T6, 6→T1·T6, 7→T6).
- unblocked 이중 발행: report(im)와 승인(xx) 연쇄 — transitionStage는 "im/xx에 처음 도달"만 발행하므로 im 도달 시 1회, xx 전이 시 old가 이미 im이라 미발행. dedupeKey가 2차 방어. OK.
- self-claim(미배정)·승인 시 stage null→xx 점프: fromIn에 null 포함으로 허용 — 정본의 역행 금지 원칙과 충돌 없음(전진만 있음).
- 타입 일관성: `transitionStage`·`WbsStage`·`ensureOrderForWorkflowLeaf`·`setWbsDevWorkflow` 시그니처가 소비 태스크(T4·T5·T6·T7)와 일치함을 확인.
