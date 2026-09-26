# 설계 상태·구현자동 구현 계획서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업마다 설계 방식(완전자동·설계 검토·구현자동)을 고르고, 서버가 설계 상태와 새 단계 `dd`(설계 완료)를 기록해 "승인되지 않은 설계로 구현하지 않는다"와 "같은 작업을 둘이 구현하지 않는다"를 모든 경로에서 지킨다.

**Architecture:** 규칙은 순수 모듈 `src/lib/domain/designGate.ts` 한 곳에 둔다(관문·판단·PC 판정·화면 판정). 라우트가 관문을 집행하고, 전이 RPC `apply_workflow_event`(0108)는 원자 전이와 CAS 만 한다. 목록·상세·watch 응답이 서버 판단(`action`·`mine`)을 싣고, 팀장·워커 스킬은 그 값을 따른다. `dflow.sh` 는 새 거부 코드를 exit 11·12 로 옮기고, heartbeat 훅은 다른 PC 가 이어받은 워커를 멈춘다.

**Tech Stack:** Next.js 15 App Router(route handlers·server actions), Supabase Postgres 17(plpgsql RPC, Management API 로 적용), TypeScript, vitest, POSIX sh(`dflow.sh`·`poll.sh`·`tick.sh`·훅), jq.

**Spec:** `docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md`(5판 본문 + 12절 예외 대응표, 2026-09-27 승인). **12절이 본문과 다르면 12절을 따른다.** 이 계획서는 둘을 합친 규칙을 적고, 스펙이 계획서로 넘긴 빈칸은 아래 「계획에서 새로 정한 것」(P1~P16)으로 정했다. 상태 공간 모델은 `docs/superpowers/specs/2026-09-26-design-state-model/model5.py`(Task 2 가 P16 스위치를 더한다).

---

## 한 쪽 요약(사람이 먼저 읽는 곳)

**무엇이 바뀌나.** WBS 작업 패널에서 위임 표식 옆에 **설계 방식**을 고른다.

| 방식 | 누가 설계 | 사람이 할 일 | 팀장이 하는 일 |
| --- | --- | --- | --- |
| 완전자동(auto, 기본값) | 에이전트 | 없음 | 지금처럼 처음부터 끝까지 |
| 설계 검토(review) | 에이전트 | agent 브랜치의 design.md 를 보고, 고쳤으면 push 한 뒤 「설계 승인」 | 설계만 하고 멈춤 → 승인되면 다음 TICK 에 구현 |
| 구현자동(human) | 사람 | 개발 브랜치에 design.md 를 올리고 「설계 확정」 | 확정된 작업만 구현 |

새 단계 **설계 완료(`dd`)** 가 `설계 중(ds)` 과 `작업 중(ip)` 사이에 생기고, 실적은 20% 다. 새 버튼은 「설계 승인」·「설계 확정」·「설계 되돌리기」 셋이다.

**시나리오 1 — 설계 검토.** 팀장이 작업 A 를 설계만 하고 멈춘다. 화면에 「설계 검토 대기」와 agent 브랜치 경로가 보인다. 사람이 design.md 한 줄을 고쳐 push 하고 「설계 승인」을 누른다. 다음 TICK(기본 30분 안)에 팀장이 같은 설계로 구현을 시작한다. 승인 전에 누가 `/dflow-dev --scope build` 를 손으로 돌려도 서버가 거부한다(exit 11).

**시나리오 2 — 구현자동.** 사람이 개발 브랜치에 design.md 를 올리고 「설계 확정」을 누른다. 팀장은 띄우기 전에 원격 design.md 의 필수 5개 절을 확인한다. 절이 하나 빠졌으면 워커를 띄우지 않고 설계를 되돌린다. 화면은 「사람 설계 대기」와 "빠진 절: 테스트 계획"을 보인다. 사람이 고쳐 다시 확정하면 다음 TICK 에 구현된다.

**시나리오 3 — 두 PC.** A PC 의 워커가 구현하다가 네트워크가 끊겨 30분 넘게 조용하다. 사람이 B PC 에서 `--resume` 하면 B 가 이어받는다(서버의 `runner` 가 B 로 바뀐다). A 가 살아나면 다음 heartbeat 가 409 로 거부되고, 새 훅을 깐 PC 에서는 A 워커가 멈춘다. 훅이 옛것이어도 A 의 완료 보고는 서버가 거부한다. 같은 작업이 두 번 보고되지 않는다.

**반영 범위와 사람이 할 일.**
- 반영은 **staging 까지**다. 운영 DB·main·킷은 이 계획에 없다.
- 사람이 할 일은 넷이다.
  1. 계획서를 승인하고 실행 방식을 고른다.
  2. `staging:sync` 직전에 확인한다(스테이징 데이터를 운영 복제로 덮는다, Task 5).
  3. 스테이징에서 버튼을 눈으로 확인한다.
  4. 킷을 배포할 때 PC마다 훅을 다시 설치한다(`kit/install.sh --hooks`). 킷 배포는 이 계획 밖이다.

---

## Global Constraints

- **스펙 우선순위:** 스펙 12절(예외 대응표)이 1~9절 본문보다 우선한다. 결정 D1~D28 은 바꾸지 않는다.
- **작업 위치:** 워크트리 `~/project/wbs-web-design-state`, 브랜치 `feat/design-state`. 본 체크아웃 `~/project/wbs-web` 는 여러 세션이 공유하므로 거기서 편집·커밋하지 않는다. 본 체크아웃 pull 은 dmes-standard-87 세션의 확인 뒤에만 한다(이 계획 밖).
- **git:** `git add -A` 금지(파일명 지정). 마이그레이션(`supabase/migrations/*`)은 코드와 다른 커밋. `.dflow.local` 커밋 금지. `git push --force`·훅 우회(`SKIP_GUARD`) 금지. 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **반영:** staging 까지만. main·킷 반영을 제안하지 않는다.
- **마이그레이션:** 다음 번호 `0108`. `_rollback.sql` 필수. 적용은 `npm run db:apply -- <파일> --target staging` 만(`supabase db push` 금지). 리허설 뒤 커밋 트레일러 `Staging-verified: YYYY-MM-DD db 리허설 통과`.
- **계약 버전:** `2.10` → `2.11`. 정본은 두 곳뿐이다: `.claude/skills/dflow-work/scripts/dflow.sh` 의 `CONTRACT_VERSION`, `src/lib/agent/externalApi.ts` 의 `AGENT_CONTRACT_VERSION`.
- **옛 서버 호환:** dmes 는 본 체크아웃 스킬로 **운영 API(계약 2.9)** 를 부른다. 스킬·CLI 의 모든 새 동작은 `dflow.sh contract-ge 2.11` 이 거짓이면 지금 동작으로 돌아가야 한다(D20, 8절).
- **응답 호환:** 레거시(시크릿, 비-PAT) 응답은 v1 기준선이다 — 새 칸은 PAT 응답에만 싣는다. 새 요청 칸은 모두 선택이다.
- **에러 3원칙:** 조회 실패를 "없음"으로 위장하지 않는다. 쓰기 전 선행 조회가 실패하면 중단한다. 보안 가드는 fail-closed.
- **UI 위험 파일:** `src/components/app/*`·`src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx` 는 건드리지 않는다(설계 검토 대기 배지는 허브 카운터로 둔다).
- **App Router:** `route.ts` 는 HTTP 메서드 외 export 금지 — 공용 로직은 `src/lib/agent/*` 로.
- **킷:** 스킬·스크립트에 특정 PC 이름을 넣지 않는다.
- **문구:** 사용자에게 보이는 문구와 보고는 완전한 한국어 문장.
- **테스트:** `npx vitest run <파일>`. 전체 실행 때만 흔들리는 테스트 4개(`tests/skills/heartbeat-hook.test.ts`·`dflow-lead-lease.test.ts`·`dflow-lead-worktree.test.ts`·`dflow-done-decisions.test.ts`)는 단독 실행으로 확인한다.
- **브라우저 확인:** ego-browser 스킬(`~/.claude/skills/ego-browser`). Playwright MCP·claude-in-chrome 을 쓰지 않는다.

## 계획에서 새로 정한 것(스펙 12절 끝의 "계획서에서 같은 원칙으로 정한다")

| # | 무엇 | 정한 내용 | 대응 |
| --- | --- | --- | --- |
| P1 | RPC CAS 모양 | `p_cas jsonb` — 키가 있으면 그 값과 같아야 한다(`design_state`·`design_mode`·`runner`·`runner_seen_at`). JSON null 이 "없음"을 뜻한다 | 막기 |
| P2 | RPC 시그니처 | 새 인자 `p_scope`·`p_cas`·`p_note`·`p_mode`·`p_runner`(모두 기본값 null). 옛 7인자 함수는 drop 뒤 새 12인자로 create(오버로드 모호성 방지). 2.9 앱의 이름 인자 호출은 기본값으로 그대로 돈다 | 호환 |
| P3 | 새 사건 | `design_done`·`design_accept`·`design_reopen`·`cancel`(D14 공용 헬퍼)·`set_design_mode`. `cancel` 은 직전 주문 status 를 돌려준다. `set_design_mode` 는 주문 행을 먼저 잠그고 항목을 잠근다(claim 과 같은 순서 — 교착 없음) | 막기 |
| P4 | build-start 검사 순서 | runner → 설계 → 선행. 주문이 claimed 가 아니면(취소는 409 `cancelled` 그대로) 409 `design_gate`(Y7) | 막기 |
| P5 | PC 판정 | `pcOfLabel`: `a/b/c` 는 둘째 칸, `claude-<host>` 는 접두어를 뗀 값(L1), 그 밖은 라벨 전체, 소문자. SQL 에는 두지 않는다 — 판정은 라우트(TS), RPC·UPDATE 는 읽은 값 CAS | 막기 |
| P6 | heartbeat 의 runner | 워커 갈래만. `runnerFree` 면 runner 를 호출 라벨로 넘겨받고 `runner_seen_at` 을 갱신(읽은 runner·runner_seen_at CAS), 아니면 409 `runner_active`(본문에 runner·runner_seen_at). 팀장 merge_conflict 갈래는 그대로 | 막기+경고 |
| P7 | 재개 때 runner | 재개·재시작한 워커는 단계가 `ip` 이상이면 먼저 `build-start`(멱등)를 불러 runner 를 넘겨받는다. 훅이 없는 PC 에서도 Y1 이 막힘으로만 끝나지 않게 한다 | 다시 시작 |
| P8 | 「설계 확정」의 단계 | 단계 없음(null)도 `as` 처럼 받는다(담당자 없는 human 위임 항목). 화면 6·7행도 같다 | 막힘 해소 |
| P9 | 훅의 runner_active | state.json 을 바꾸지 않고 멈춤 JSON 만 낸다. 절제 스탬프를 지워 다음 도구 호출에서 다시 묻고 다시 세운다(영속 표식 없음 — 나중에 이 PC 가 정당하게 넘겨받으면 풀린다) | 막기 |
| P10 | 목록 요청 | `/work/mine` 에 `agent`(라벨)·`require_tag`·`wp`·`lead=1`. `lead=1` 이면 claimed 의 mine 에 거르기 통과와 팀원 라벨(`/w<n>`)을 더한다(Y9) | 막기 |
| P11 | list·poll 출력 | `dflow.sh list` 는 끝에 `action`·`mine` 두 열을 더한다(기존 열 번호 불변). `poll.sh` 는 두 열이 있으면 RD 중 `action`∈`--actions` ∧ `mine`=1 만(Y4), 없으면(옛 서버) 지금대로. `--actions` 기본 `full,design,build`, `/dflow-poll` 은 `full` | 막기 |
| P12 | dd 크레딧 채움 | 표에 dd 가 없으면 `greatest(ds, least(20, ip-5))`. ds·dd 는 간격 규칙에서 빼고 `as ≤ ds ≤ dd ≤ ip` 만 본다(D18) | 표시=전이 |
| P13 | 실적을 낮추지 않는 사건 | claim·design_done·design_accept②·build_start·report_completion 은 `greatest(현재, 크레딧)`(D19) | 막기 |
| P14 | 스테이징 리허설 | `staging:sync`(실행 직전 사용자 확인) → 2.10 잔재·살아 있는 팀장·영향 건수 조회(Y6) → db:apply → 검증 SQL(끝에 raise 로 되돌려 흔적 없음) → 건수 재조회 → 트레일러 | 경고 |
| P15 | import 의 표식 제거 | import 가 위임 표식을 떼면(L7) 그 항목의 ready·claimed 주문을 `cancel` 로 취소하고 결과에 건수를 싣는다 | 막기+경고 |
| P16 | 완료 보고와 살아 있는 다른 세션 | 완료 보고는 `heartbeat_agent` 가 호출 라벨과 다르고 그 세션이 살아 있으면(`workerAlive`) 409 `runner_active`. 계획 단계 모델 검사에서 "워커가 도는 중 사람이 `dflow.sh done` → 반려 → 두 구현자" 3,312 상태가 나왔고, 이 조건으로 0 이 됐다 | 막기 |

## Review Focus

테스트가 직접 두드리지 않지만 사람이 가장 먼저 부딪힐 입력·조건이다. 줄마다 그 조건을 고정하는 테스트를 담당 Task 에 넣었다.

1. **옛 서버(계약 2.9)에서 새 킷이 돈다** — dmes 가 운영 API 로 `poll.sh`·`dflow.sh`·워커 문서를 쓴다. 기대: action·mine 열이 없으면 poll 은 지금처럼 RD 를 돌려주고, `design-done` 404 는 `DESIGN_STATE_UNSUPPORTED` 로 끝나며, 설계 선행 멈춤은 옛 `heartbeat --phase wait_pred` 로 간다. (Task 18·19·21 의 가짜 curl 테스트)
2. **0108 의 데이터 단계가 운영 행을 바꾼다** — claimed·ds·wait_pred → dd(L4), 모든 claimed 의 runner·claim_scope 채움, 진행된 항목의 ready 취소(D26). 기대: 리허설 전후 건수가 표로 남고 예상과 같다. (Task 4 의 SQL 대조 테스트, Task 5 의 건수 표)
3. **두 PC 가 한 작업을 이어받는다** — 조용한 A PC 와 이어받은 B PC. 기대: 완료 보고는 runner PC 에서만(P7·P16 포함), heartbeat 는 넘겨받거나 409, 재개한 워커는 build-start 로 넘겨받는다. (Task 1·12·13 테스트, Task 2 모델 I5=0)
4. **사람 설계가 없거나 절이 빠진 구현자동 작업** — 기대: 팀장이 띄우기 전에 `design-reopen` 으로 되돌리고 화면에 사유가 보인다. 워커도 claim 뒤 같은 검사를 한다. (Task 15·22 테스트, Task 25 화면 테스트)
5. **수동 `--resume`·`/dflow-poll` 이 review·human 작업을 만난다** — 기대: claimed 주문은 서버 `claim_scope` 가 수동 `--scope` 를 이기고, `/dflow-poll` 은 action 이 full 이 아니면 사유를 알리고 건너뛴다. (Task 19·21·23 테스트)

---

## 파일 지도

| 파일 | 책임 | Task |
| --- | --- | --- |
| `src/lib/domain/designGate.ts`(새) | 관문·판단·PC 판정·화면 판정 — 규칙 원본 | 1 |
| `tests/domain/design-gate.test.ts`(새) | 표 테스트 | 1 |
| `tests/domain/design-gate-model.test.ts`(새) | 상태 공간 모델(BFS) — 실제 designGate 함수로 불변식 검사 | 2 |
| `docs/superpowers/specs/2026-09-26-design-state-model/model5.py` | P16 스위치 | 2 |
| `src/lib/domain/stageLabels.ts`·`agentWork.ts`·`stageCredits.ts`, i18n 사전 | 단계 `dd`·사람 단계 목록·크레딧 dd | 3 |
| `supabase/migrations/0108_design_state.sql`(새)·`_rollback.sql`(새) | 칸·CHECK·RPC·데이터 이전 | 4 |
| `tests/migrations/0108-design-state.test.ts`(새) | SQL ↔ 도메인 대조 | 4 |
| `src/lib/agent/workflowEvent.ts` | 새 사건·인자·사유 | 6 |
| `src/lib/agent/cancelOrder.ts`(새) | D14 공용 취소 | 7 |
| `src/lib/agent/delegation.ts`·`src/app/actions/agentHub.ts`·`wbsAssign.ts`·`src/lib/agent/forceProgress.ts`·`wbsImport.ts` | 취소 경로 교체, L7 | 7 |
| `src/lib/agent/ensureOrder.ts` | D26 발행 차단 | 8 |
| `src/lib/agent/designFacts.ts`(새) | 판단 재료 일괄 로더 | 9 |
| `src/lib/agent/routeShared.ts` | 주문 행 열 | 10 |
| `src/app/api/v1/agent/work/[id]/{claim,build-start,heartbeat,report,release}/route.ts` | 관문 집행 | 10~14 |
| `src/app/api/v1/agent/work/[id]/{design-done,design-reopen}/route.ts`(새) | 새 동사 | 15 |
| `src/app/api/v1/agent/work/mine/route.ts`·`work/[id]/route.ts`·`watch/route.ts` | 판단 싣기, build_ready | 16 |
| `src/lib/agent/externalApi.ts`·`.claude/skills/dflow-work/references/api-contract.md` | 계약 2.11 | 17 |
| `.claude/skills/dflow-work/scripts/dflow.sh` | exit 11·12, 새 동사, scope, list 열 | 18 |
| `.claude/skills/dflow-poll/scripts/poll.sh` | action·mine | 19 |
| `kit/hooks/heartbeat.sh` | runner_active 멈춤 | 20 |
| `.claude/skills/dflow-dev/**` | 워커 문서 | 21 |
| `.claude/skills/dflow-team/**` | 팀장 문서·tick.sh | 22 |
| `.claude/skills/dflow-poll/SKILL.md`·`dflow-work/SKILL.md` | 문서 | 23 |
| `src/app/actions/designActions.ts`(새)·`wbsSpec.ts`·`agentHub.ts`·`agentWork.ts` | 버튼·방식 서버 액션 | 24 |
| `src/components/wbs/*` | 작업 패널 | 25 |
| `src/lib/domain/seatState.ts`·`seatmap.ts`·`agentHub.ts`, `src/lib/data/agentSeatmap.ts`, `src/components/agents/*`·`agent-hub/*` | 좌석·허브 | 26 |

---

## Task 0: 기준선 — origin/staging 머지와 전체 테스트

**Files:** 없음(머지 커밋만)

**Interfaces:**
- Consumes: 없음
- Produces: `feat/design-state` 가 `origin/staging`(d9b5bd0b 이후)을 포함한다. 전체 테스트의 기준 실패 목록.

- [ ] **Step 1: 워크트리에서 staging 을 받아 머지한다**

```bash
cd ~/project/wbs-web-design-state
git status --short            # 비어 있어야 한다
git fetch origin staging
git merge --no-edit origin/staging
```

Expected: 충돌 없음(회의록 3커밋뿐, 에이전트·마이그레이션 파일 변경 없음). 충돌이 나면 멈추고 사용자에게 알린다.

- [ ] **Step 2: 의존성을 설치한다(워크트리에 node_modules 가 없다)**

```bash
npm ci
```

- [ ] **Step 3: 전체 테스트 기준선을 남긴다**

```bash
npx vitest run 2>&1 | tail -40 > /tmp/design-state-baseline.txt; tail -15 /tmp/design-state-baseline.txt
```

Expected: 통과. 실패가 있으면 Global Constraints 의 흔들리는 4개인지 단독 실행으로 확인하고, 그 밖의 실패는 파일 이름을 기록해 둔다(이후 Task 가 새로 깬 것과 구별하는 재료).

---

## Task 1: `designGate.ts` — 관문·판단·PC 판정·화면 판정

**Files:**
- Create: `src/lib/domain/designGate.ts`
- Test: `tests/domain/design-gate.test.ts`

**Interfaces:**
- Consumes: `AgentOrderStatus`(`src/lib/domain/agentWork.ts`), `STALE_MS`(`src/lib/domain/seatState.ts`)
- Produces(이후 모든 Task 가 이 이름·모양을 쓴다):
  - 상수: `DESIGN_MODES`, `DESIGN_STATES`, `CLAIM_SCOPES`, `CLAIM_REQUEST_SCOPES`, `BUILD_SCOPES`, `RUNNER_STALE_MS`(30분), `BLOCKED_MAX_AGE_MS`(60분)
  - 타입: `DesignMode`, `DesignState`, `ClaimScope`, `BuildScope`, `AgentAction`, `PredsState`, `ItemFacts`, `OrderFacts`, `GateRefusal`, `DesignButton`, `ScreenOrder`, `DesignScreenRow`, `MineRequest`
  - 함수: `toDesignMode(v): DesignMode`, `toDesignState(v): DesignState|null`, `toClaimScope(v): ClaimScope`, `stageAtOrPastIp(stage): boolean`, `pcOfLabel(label): string|null`, `isWorkerLabel(label): boolean`, `predsState(unmet): PredsState`, `alreadyProgressed(item): boolean`, `workerAlive(order, nowMs): boolean`, `runnerFree(order, callerLabel, nowMs): boolean`, `nextAgentAction(item, order, nowMs): { action; reason; depsUnmet }`, `isMine(order, req, nowMs): boolean`, `canClaim(item, designState, scope, designFirst): GateRefusal|null`, `canBuildStart(item, order, scope, callerLabel, nowMs): GateRefusal|null`, `canReportCompletion(item|null, order, callerLabel, nowMs): GateRefusal|null`, `canRelease(item|null, order): GateRefusal|null`, `canDesignDone(item|null, order): GateRefusal|null`, `designModeChangeBlock({designState, orderStatuses}): string|null`, `designButtons(item, active): DesignButton[]`, `designScreen({item, active, lastReview, nowMs}): DesignScreenRow|null`, `designPushWarning(item, active): string|null`, `parseWpList(raw): string[]|null|'invalid'`, `listFilterPass(item, filters): boolean`

- [ ] **Step 1: 실패하는 표 테스트를 쓴다**

`tests/domain/design-gate.test.ts`:

```ts
// tests/domain/design-gate.test.ts — 설계 상태 관문·판단·화면 판정.
// 스펙 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 3·5절(12절이 우선), 계획서 P4·P5·P8·P16.
import { describe, expect, it } from 'vitest'
import {
  BLOCKED_MAX_AGE_MS, RUNNER_STALE_MS, alreadyProgressed, canBuildStart, canClaim, canDesignDone, canRelease,
  canReportCompletion, designButtons, designModeChangeBlock, designPushWarning, designScreen, isMine, isWorkerLabel,
  listFilterPass, nextAgentAction, parseWpList, pcOfLabel, predsState, runnerFree, toClaimScope, toDesignMode,
  toDesignState, workerAlive, type ItemFacts, type OrderFacts, type ScreenOrder,
} from '@/lib/domain/designGate'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const item = (o: Partial<ItemFacts> = {}): ItemFacts => ({
  mode: 'auto', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: false, preds: 'met', ...o,
})
const order = (o: Partial<OrderFacts> = {}): OrderFacts => ({
  status: 'ready', designState: null, claimScope: 'legacy', runner: null, runnerSeenAt: null,
  lastHeartbeatAt: null, heartbeatPhase: null, heartbeatAgent: null, claimedBy: null, claimedByUserId: null, ...o,
})
const claimed = (o: Partial<OrderFacts> = {}) =>
  order({ status: 'claimed', claimedBy: 'hong/mbp/w1', claimedByUserId: 'u-1', runner: 'hong/mbp/w1', runnerSeenAt: ago(1), ...o })

describe('값 정규화', () => {
  it('모르는 값·null 은 auto·없음·legacy 로 본다(D17·D8)', () => {
    expect(toDesignMode(undefined)).toBe('auto')
    expect(toDesignMode('human')).toBe('human')
    expect(toDesignState('nope')).toBeNull()
    expect(toDesignState('accepted')).toBe('accepted')
    expect(toClaimScope(null)).toBe('legacy')
    expect(toClaimScope('design')).toBe('design')
  })
})

describe('pcOfLabel·isWorkerLabel(P5, L1, Y9)', () => {
  it.each([
    ['hong/mbp/w1', 'mbp'], ['HONG/MBP/w2', 'mbp'], ['hong/mbp/poll', 'mbp'], ['claude-mbp', 'mbp'],
    ['legacy-agent', 'legacy-agent'], ['', null], [null, null],
  ])('%s → %s', (label, pc) => { expect(pcOfLabel(label)).toBe(pc) })
  it('팀원 라벨만 참', () => {
    expect(isWorkerLabel('hong/mbp/w1')).toBe(true)
    expect(isWorkerLabel('hong/mbp/w12')).toBe(true)
    expect(isWorkerLabel('hong/mbp/poll')).toBe(false)
    expect(isWorkerLabel('claude-mbp')).toBe(false)
    expect(isWorkerLabel(null)).toBe(false)
  })
})

describe('predsState(D15)', () => {
  it('없으면 met, 모두 dd·ip 면 ahead, 하나라도 그 밖이면 blocked', () => {
    expect(predsState([])).toBe('met')
    expect(predsState([{ stage: 'ip' }, { stage: 'dd' }])).toBe('ahead')
    expect(predsState([{ stage: 'ds' }])).toBe('blocked')
    expect(predsState([{ stage: null }])).toBe('blocked')
    expect(predsState([{ stage: 'as' }, { stage: 'ip' }])).toBe('blocked')
  })
})

describe('alreadyProgressed(D26, L6)', () => {
  it('단계 ip 이상·실적 100·approved 주문 중 하나면 참', () => {
    expect(alreadyProgressed(item({ stage: 'ip' }))).toBe(true)
    expect(alreadyProgressed(item({ actualPct: 100 }))).toBe(true)
    expect(alreadyProgressed(item({ hasApprovedOrder: true }))).toBe(true)
    expect(alreadyProgressed(item({ stage: 'dd', actualPct: 20 }))).toBe(false)
  })
})

describe('workerAlive(5.3 2행, Y12)', () => {
  it('5분 안의 작업 phase 는 살아 있다', () => {
    expect(workerAlive({ lastHeartbeatAt: ago(2), heartbeatPhase: 'build' }, NOW)).toBe(true)
    expect(workerAlive({ lastHeartbeatAt: ago(6), heartbeatPhase: 'build' }, NOW)).toBe(false)
  })
  it('BLOCKED 는 2 TICK(60분)까지만 살아 있다', () => {
    expect(BLOCKED_MAX_AGE_MS).toBe(60 * 60_000)
    expect(workerAlive({ lastHeartbeatAt: ago(50), heartbeatPhase: 'blocked' }, NOW)).toBe(true)
    expect(workerAlive({ lastHeartbeatAt: ago(61), heartbeatPhase: 'blocked' }, NOW)).toBe(false)
  })
  it('대기 phase 와 신호 없음은 살아 있지 않다', () => {
    expect(workerAlive({ lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_review' }, NOW)).toBe(false)
    expect(workerAlive({ lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_pred' }, NOW)).toBe(false)
    expect(workerAlive({ lastHeartbeatAt: null, heartbeatPhase: null }, NOW)).toBe(false)
  })
})

describe('runnerFree(D25)', () => {
  it('runner 없음·같은 PC(다른 슬롯·수동 세션)·30분 넘게 조용함이면 참', () => {
    expect(RUNNER_STALE_MS).toBe(30 * 60_000)
    expect(runnerFree({ runner: null, runnerSeenAt: null }, 'kim/pc2/w1', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(1) }, 'hong/mbp/w2', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(1) }, 'claude-mbp', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(10) }, 'hong/pc2/w1', NOW)).toBe(false)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(31) }, 'hong/pc2/w1', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: null }, 'hong/pc2/w1', NOW)).toBe(true)
  })
})

describe('nextAgentAction — 5.3 판단표 1~12행', () => {
  const a = (i: Partial<ItemFacts>, o: Partial<OrderFacts>) => nextAgentAction(item(i), order(o), NOW)
  it.each([
    ['1 reported', {}, { status: 'reported' as const }, 'skip'],
    ['1 approved', {}, { status: 'approved' as const }, 'skip'],
    ['1 cancelled', {}, { status: 'cancelled' as const }, 'skip'],
    ['2 claimed·ip', { stage: 'ip' }, { status: 'claimed' as const }, 'skip'],
    ['2 claimed·ds·살아 있음', { stage: 'ds' }, { status: 'claimed' as const, lastHeartbeatAt: ago(1), heartbeatPhase: 'design' }, 'skip'],
    ['3 ready·ip', { stage: 'ip' }, {}, 'skip'],
    ['3 ready·실적 100(L6)', { actualPct: 100 }, {}, 'skip'],
    ['3 ready·approved 주문', { hasApprovedOrder: true }, {}, 'skip'],
    ['4 review', { stage: 'dd' }, { status: 'claimed' as const, designState: 'review' as const, lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_review' }, 'wait'],
    ['5 accepted·as', { stage: 'as', mode: 'human' }, { designState: 'accepted' as const }, 'skip'],
    ['6 accepted·선행 ahead', { stage: 'dd', mode: 'human', preds: 'ahead' }, { designState: 'accepted' as const }, 'wait'],
    ['7 accepted·dd·met', { stage: 'dd', mode: 'human' }, { designState: 'accepted' as const }, 'build'],
    ['8 claimed·as', { stage: 'as' }, { status: 'claimed' as const }, 'skip'],
    ['8 design·blocked', { stage: 'ds', mode: 'review', preds: 'blocked' }, { status: 'claimed' as const, claimScope: 'design' as const }, 'wait'],
    ['8 design·ahead', { stage: 'ds', mode: 'review', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'design' as const }, 'design'],
    ['8 full·dd·ahead', { stage: 'dd', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'full' as const }, 'wait'],
    ['8 full·ds·ahead', { stage: 'ds', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'full' as const }, 'full'],
    ['8 legacy·ds·met', { stage: 'ds' }, { status: 'claimed' as const, claimScope: 'legacy' as const }, 'full'],
    ['8 build·설계 상태 없음', { stage: 'dd', mode: 'human' }, { status: 'claimed' as const, claimScope: 'build' as const }, 'skip'],
    ['9 human', { mode: 'human' }, {}, 'skip'],
    ['10 blocked', { preds: 'blocked' }, {}, 'wait'],
    ['11 review·ahead', { mode: 'review', preds: 'ahead' }, {}, 'design'],
    ['12 auto·met', {}, {}, 'full'],
  ] as const)('%s', (_n, i, o, want) => { expect(a(i as Partial<ItemFacts>, o as Partial<OrderFacts>).action).toBe(want) })
  it('12행·8행 full 은 선행 미충족이면 depsUnmet 을 켠다(설계 선행 경로)', () => {
    expect(a({ preds: 'ahead' }, {})).toMatchObject({ action: 'full', depsUnmet: true })
    expect(a({}, {})).toMatchObject({ action: 'full', depsUnmet: false })
    expect(a({ stage: 'ds', preds: 'ahead' }, { status: 'claimed', claimScope: 'full' })).toMatchObject({ depsUnmet: true })
  })
  it('사유 문장을 싣는다', () => {
    expect(a({ mode: 'human' }, {}).reason).toBe('사람 설계 대기')
  })
})

describe('isMine(5.3, Y9)', () => {
  const req = (o: Partial<{ userId: string; label: string | null; lead: boolean; filtersPass: boolean }> = {}) =>
    ({ userId: 'u-1', label: 'hong/mbp/w3', lead: false, filtersPass: true, ...o })
  it('ready 는 목록 거르기만 본다', () => {
    expect(isMine(order(), req(), NOW)).toBe(true)
    expect(isMine(order(), req({ filtersPass: false }), NOW)).toBe(false)
  })
  it('claimed 는 같은 신원 ∧ runnerFree', () => {
    expect(isMine(claimed(), req(), NOW)).toBe(true)
    expect(isMine(claimed({ claimedByUserId: 'u-2' }), req(), NOW)).toBe(false)
    expect(isMine(claimed(), req({ label: 'hong/pc2/w1' }), NOW)).toBe(false)
    expect(isMine(claimed({ runnerSeenAt: ago(31) }), req({ label: 'hong/pc2/w1' }), NOW)).toBe(true)
  })
  it('팀장 요청은 claimed 에도 거르기와 팀원 라벨을 요구한다(Y9)', () => {
    expect(isMine(claimed({ claimedBy: 'claude-mbp', runner: 'claude-mbp' }), req({ lead: true }), NOW)).toBe(false)
    expect(isMine(claimed(), req({ lead: true, filtersPass: false }), NOW)).toBe(false)
    expect(isMine(claimed(), req({ lead: true }), NOW)).toBe(true)
  })
  it('reported·approved·cancelled 는 거짓', () => {
    expect(isMine(order({ status: 'reported' }), req(), NOW)).toBe(false)
  })
})

describe('canClaim — 5.2 claim 관문', () => {
  it('이미 진행된 항목은 모든 범위에서 409 design_gate(D26·L6)', () => {
    for (const i of [item({ stage: 'ip' }), item({ actualPct: 100 }), item({ hasApprovedOrder: true })]) {
      expect(canClaim(i, null, 'full', false)).toMatchObject({ status: 409, code: 'design_gate' })
    }
  })
  it('full·legacy 는 auto ∧ 설계 상태 없음', () => {
    expect(canClaim(item(), null, 'full', false)).toBeNull()
    expect(canClaim(item({ mode: 'review' }), null, 'full', false)).toMatchObject({ code: 'design_gate' })
    expect(canClaim(item({ mode: 'human' }), null, 'legacy', false)).toMatchObject({ code: 'design_gate' })
  })
  it('full 의 선행: design_first 없으면 403, 있으면 ahead 만 통과', () => {
    expect(canClaim(item({ preds: 'ahead' }), null, 'full', false)).toMatchObject({ status: 403, code: 'dependency_not_met' })
    expect(canClaim(item({ preds: 'ahead' }), null, 'full', true)).toBeNull()
    expect(canClaim(item({ preds: 'blocked' }), null, 'full', true)).toMatchObject({ status: 403, reason: 'design_first_too_early' })
  })
  it('design 은 auto·review ∧ 설계 상태 없음, 선행 미충족이면 설계 선행으로 본다', () => {
    expect(canClaim(item({ mode: 'review', preds: 'ahead' }), null, 'design', false)).toBeNull()
    expect(canClaim(item({ mode: 'review', preds: 'blocked' }), null, 'design', false)).toMatchObject({ reason: 'design_first_too_early' })
    expect(canClaim(item({ mode: 'human' }), null, 'design', false)).toMatchObject({ code: 'design_gate' })
  })
  it('build 는 human ∧ accepted ∧ dd, design_first 무시', () => {
    expect(canClaim(item({ mode: 'human', stage: 'dd' }), 'accepted', 'build', false)).toBeNull()
    expect(canClaim(item({ mode: 'human', stage: 'dd', preds: 'ahead' }), 'accepted', 'build', true)).toMatchObject({ status: 403, code: 'dependency_not_met' })
    expect(canClaim(item({ mode: 'human', stage: 'dd' }), null, 'build', false)).toMatchObject({ status: 409, code: 'design_not_accepted' })
    expect(canClaim(item({ mode: 'review', stage: 'dd' }), 'accepted', 'build', false)).toMatchObject({ code: 'design_not_accepted' })
  })
})

describe('canBuildStart — 5.2 build-start 관문(P4 순서: runner → 설계 → 선행)', () => {
  const bs = (i: Partial<ItemFacts>, o: Partial<OrderFacts>, scope: 'full' | 'build' | 'rework' | 'legacy', caller = 'hong/mbp/w1') =>
    canBuildStart(item(i), claimed(o), scope, caller, NOW)
  it('claimed 가 아니면 409 design_gate(Y7)', () => {
    expect(canBuildStart(item({ stage: 'dd' }), order({ status: 'ready' }), 'build', 'hong/mbp/w1', NOW))
      .toMatchObject({ status: 409, code: 'design_gate' })
  })
  it('다른 PC 가 30분 안에 신호를 냈으면 409 runner_active — 설계 검사보다 먼저', () => {
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'review' }, 'build', 'kim/pc2/w1')).toMatchObject({ code: 'runner_active' })
  })
  it('full: auto ∧ 설계 상태 없음 ∧ claim_scope full·legacy, 단계 ds·dd(ip 이상은 멱등)', () => {
    expect(bs({ stage: 'ds' }, { claimScope: 'full' }, 'full')).toBeNull()
    expect(bs({ stage: 'ip', preds: 'blocked' }, { claimScope: 'legacy' }, 'full')).toBeNull()
    expect(bs({ stage: 'ds', mode: 'review' }, { claimScope: 'design' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ds' }, { claimScope: 'design' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'as' }, { claimScope: 'full' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ds', preds: 'ahead' }, { claimScope: 'full' }, 'full')).toMatchObject({ status: 403, code: 'dependency_not_met' })
  })
  it('build: accepted, 단계 dd(ip 이상은 멱등)', () => {
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toBeNull()
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'review', claimScope: 'build' }, 'build')).toMatchObject({ code: 'design_not_accepted' })
    expect(bs({ stage: 'ds', mode: 'human' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toMatchObject({ code: 'design_gate' })
  })
  it('rework: 단계 ip ∧ (accepted 이거나 auto·설계 상태 없음)(Y2), 선행은 보지 않는다', () => {
    expect(bs({ stage: 'ip', preds: 'blocked' }, {}, 'rework')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, { designState: 'accepted' }, 'rework')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, {}, 'rework')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'accepted' }, 'rework')).toMatchObject({ code: 'design_gate' })
  })
  it('legacy: ip 이상은 review 만 거부, ip 미만은 full 과 같다', () => {
    expect(bs({ stage: 'ip' }, { designState: 'review' }, 'legacy')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ip' }, {}, 'legacy')).toBeNull()
    expect(bs({ stage: 'ds' }, { claimScope: 'legacy' }, 'legacy')).toBeNull()
    expect(bs({ stage: 'ds', mode: 'review' }, { claimScope: 'legacy' }, 'legacy')).toMatchObject({ code: 'design_gate' })
  })
})

describe('canReportCompletion(Y1·Y2·W23·P16)', () => {
  const leaf = (stage: string | null) => ({ stage, isLeaf: true })
  it('설계 검토 대기면 409 design_gate', () => {
    expect(canReportCompletion(leaf('ip'), claimed({ designState: 'review' }), 'hong/mbp/w1', NOW)).toMatchObject({ code: 'design_gate' })
  })
  it('리프는 단계 ip 에서만(Y2) — 부모·지워진 항목은 단계를 보지 않는다', () => {
    expect(canReportCompletion(leaf('ds'), claimed(), 'hong/mbp/w1', NOW)).toMatchObject({ code: 'design_gate' })
    expect(canReportCompletion(leaf('ip'), claimed(), 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion({ stage: 'as', isLeaf: false }, claimed(), 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion(null, claimed(), 'hong/mbp/w1', NOW)).toBeNull()
  })
  it('runner 가 다른 PC 면 30분이 지나도 409 runner_active(Y1) — 넘겨받기는 heartbeat·build-start 몫', () => {
    expect(canReportCompletion(leaf('ip'), claimed({ runnerSeenAt: ago(90) }), 'kim/pc2/w1', NOW)).toMatchObject({ code: 'runner_active' })
    expect(canReportCompletion(leaf('ip'), claimed({ runner: null }), 'kim/pc2/w1', NOW)).toBeNull()
    expect(canReportCompletion(leaf('ip'), claimed(), 'claude-mbp', NOW)).toBeNull()
  })
  it('다른 세션이 살아 있으면 409 runner_active(P16)', () => {
    const o = claimed({ heartbeatAgent: 'hong/mbp/w1', lastHeartbeatAt: ago(1), heartbeatPhase: 'build' })
    expect(canReportCompletion(leaf('ip'), o, 'claude-mbp', NOW)).toMatchObject({ code: 'runner_active' })
    expect(canReportCompletion(leaf('ip'), o, 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion(leaf('ip'), { ...o, lastHeartbeatAt: ago(6) }, 'claude-mbp', NOW)).toBeNull()
  })
})

describe('canRelease(D13)·canDesignDone', () => {
  it('설계 상태가 있거나 설계만 하던 주문이 ds·dd 면 409 design_gate', () => {
    expect(canRelease({ stage: 'dd' }, claimed({ designState: 'accepted' }))).toMatchObject({ code: 'design_gate' })
    expect(canRelease({ stage: 'ds' }, claimed({ claimScope: 'design' }))).toMatchObject({ code: 'design_gate' })
    expect(canRelease({ stage: 'as' }, claimed({ claimScope: 'design' }))).toBeNull()
    expect(canRelease(null, claimed({ claimScope: 'design' }))).toBeNull()
    expect(canRelease({ stage: 'ds' }, claimed({ claimScope: 'full' }))).toBeNull()
  })
  it('design-done 은 claimed ∧ 단계 ip 미만', () => {
    expect(canDesignDone({ stage: 'ds' }, claimed())).toBeNull()
    expect(canDesignDone({ stage: 'ip' }, claimed())).toMatchObject({ code: 'design_gate' })
    expect(canDesignDone({ stage: 'ds' }, order())).toMatchObject({ code: 'design_gate' })
  })
})

describe('designModeChangeBlock(4.1 설계 방식 변경)', () => {
  it('설계 상태가 있거나 claimed·reported·approved 주문이 있으면 사유를 낸다', () => {
    expect(designModeChangeBlock({ designState: 'accepted', orderStatuses: ['ready'] })).toMatch(/설계가/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['claimed'] })).toMatch(/에이전트가 작업 중/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['approved'] })).toMatch(/승인된 주문/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['ready', 'cancelled'] })).toBeNull()
  })
})

describe('designButtons(7절, P8)', () => {
  const s = (o: Partial<ScreenOrder>): ScreenOrder => ({
    status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, ...o,
  })
  it('설계 승인: claimed ∧ review ∧ dd', () => {
    expect(designButtons(item({ stage: 'dd', mode: 'review' }), s({ status: 'claimed', designState: 'review' }))).toEqual(['accept'])
    expect(designButtons(item({ stage: 'ds', mode: 'review' }), s({ status: 'claimed', designState: 'review' }))).toEqual([])
  })
  it('설계 확정: ready ∧ human ∧ 표식 ∧ 단계 as·ds·없음 ∧ 설계 상태 없음', () => {
    expect(designButtons(item({ mode: 'human' }), s({}))).toEqual(['confirm'])
    expect(designButtons(item({ mode: 'human', stage: null }), s({}))).toEqual(['confirm'])
    expect(designButtons(item({ mode: 'human', delegated: false }), s({}))).toEqual([])
    expect(designButtons(item({ mode: 'human', actualPct: 100 }), s({}))).toEqual([])
  })
  it('설계 되돌리기: accepted ∧ dd', () => {
    expect(designButtons(item({ stage: 'dd', mode: 'human' }), s({ designState: 'accepted' }))).toEqual(['reopen'])
    expect(designButtons(item({ stage: 'ip', mode: 'human' }), s({ status: 'claimed', designState: 'accepted' }))).toEqual([])
  })
  it('활성 주문이 없으면 버튼 없음', () => {
    expect(designButtons(item({ mode: 'human' }), null)).toEqual([])
  })
})

describe('designScreen — 3절 판정표(12절 L2·L14, P8)', () => {
  const s = (o: Partial<ScreenOrder>): ScreenOrder => ({
    status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, ...o,
  })
  const row = (i: Partial<ItemFacts>, o: Partial<ScreenOrder> | null, lastReview: 'approve' | 'reject' | null = null) =>
    designScreen({ item: item(i), active: o === null ? null : s(o), lastReview, nowMs: NOW })
  it.each([
    ['1', { stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'review', designNote: '절 누락' }, 1, '설계 검토 대기'],
    ['2 review', { stage: 'dd', mode: 'review', preds: 'ahead' }, { status: 'claimed', designState: 'accepted' }, 2, '선행 대기(설계 승인됨)'],
    ['2 human', { stage: 'dd', mode: 'human', preds: 'ahead' }, { designState: 'accepted' }, 2, '선행 대기(설계 확정됨)'],
    ['3', { stage: 'dd', mode: 'human' }, { designState: 'accepted' }, 3, '구현 대기(설계 확정됨)'],
    ['4 선행', { stage: 'dd', preds: 'ahead' }, { status: 'claimed' }, 4, '설계 완료·선행 대기'],
    ['4 구현', { stage: 'dd' }, { status: 'claimed' }, 4, '설계 완료·구현 대기'],
    ['12(L14)', { stage: 'ds', preds: 'blocked' }, { status: 'claimed' }, 12, '선행 대기(설계 중 멈춤)'],
    ['6', { mode: 'human' }, {}, 6, '사람 설계 대기'],
    ['6 단계 없음(P8)', { mode: 'human', stage: null }, {}, 6, '사람 설계 대기'],
    ['7', { mode: 'human', delegated: false }, null, 7, '사람 설계 대기(위임 안 됨)'],
    ['8', { stage: 'ip' }, {}, 8, '위임 보류(단계가 이미 진행됨)'],
    ['8 실적 100', { actualPct: 100 }, {}, 8, '위임 보류(단계가 이미 진행됨)'],
    ['9', { hasApprovedOrder: true, stage: 'im' }, null, 9, '위임 보류(승인된 주문 있음)'],
    ['10', { stage: 'ip' }, null, 10, '위임 보류(단계가 이미 진행됨)'],
    ['11', { mode: 'review', preds: 'blocked' }, {}, 11, '선행 대기'],
  ] as const)('%s행', (_n, i, o, wantRow, wantLabel) => {
    const r = row(i as Partial<ItemFacts>, o as Partial<ScreenOrder> | null)
    expect(r?.row).toBe(wantRow)
    expect(r?.label).toBe(wantLabel)
  })
  it('1행은 되돌림 사유를 note 로 싣고 「설계 승인」 버튼을 준다', () => {
    const r = row({ stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'review', designNote: '절 누락' })
    expect(r).toMatchObject({ note: '절 누락', buttons: ['accept'] })
  })
  it('3행은 다른 PC 가 돌면 라벨을 붙인다', () => {
    expect(row({ stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'accepted', runner: 'kim/pc2/w1' })?.label)
      .toBe('구현 대기(설계 승인됨) · kim/pc2/w1 가 도는 중')
  })
  it('5행 재작업 대기는 살아 있는 heartbeat 가 없을 때만(L2)', () => {
    expect(row({ stage: 'ip' }, { status: 'claimed' }, 'reject')?.row).toBe(5)
    expect(row({ stage: 'ip' }, { status: 'claimed', lastHeartbeatAt: ago(1), heartbeatPhase: 'build' }, 'reject')).toBeNull()
  })
  it('사람 설계 대기(6·7행)는 이미 진행된 항목에 걸리지 않는다', () => {
    expect(row({ mode: 'human', delegated: true, actualPct: 100 }, null)?.row).toBe(10)
  })
  it('정상 완료·첫 구현은 어느 행에도 걸리지 않는다', () => {
    expect(row({ stage: 'xx', hasApprovedOrder: true }, null)).toBeNull()
    expect(row({ stage: 'ip', mode: 'review' }, { status: 'claimed', designState: 'accepted' })).toBeNull()
  })
})

describe('designPushWarning(Y13)', () => {
  it('승인·확정된 설계로 구현 중이면 push 금지를 알린다', () => {
    expect(designPushWarning(item({ stage: 'ip', mode: 'review' }), { status: 'claimed', designState: 'accepted' })).toMatch(/push 하지 마세요/)
    expect(designPushWarning(item({ stage: 'dd', mode: 'review' }), { status: 'claimed', designState: 'accepted' })).toBeNull()
  })
})

describe('parseWpList·listFilterPass(poll.sh filter_ok 와 같은 규칙)', () => {
  it('WP 목록을 정규화하고 형식 오류는 invalid', () => {
    expect(parseWpList('WP-02,dict/WP-3')).toEqual(['WP-2', 'dict/WP-3'])
    expect(parseWpList('')).toBeNull()
    expect(parseWpList(null)).toBeNull()
    expect(parseWpList('WP-x')).toBe('invalid')
  })
  it('태그와 WP 로 거른다', () => {
    const it2 = { tags: ['agent'], externalRef: 'dict/TSK-02-05' }
    expect(listFilterPass(it2, { requireTag: 'agent', wp: null })).toBe(true)
    expect(listFilterPass(it2, { requireTag: 'other', wp: null })).toBe(false)
    expect(listFilterPass(it2, { requireTag: null, wp: ['WP-2'] })).toBe(true)
    expect(listFilterPass(it2, { requireTag: null, wp: ['dict/WP-2'] })).toBe(true)
    expect(listFilterPass(it2, { requireTag: null, wp: ['mes/WP-2'] })).toBe(false)
    expect(listFilterPass({ tags: null, externalRef: 'TSK-03-01' }, { requireTag: null, wp: ['WP-2'] })).toBe(false)
    expect(listFilterPass({ tags: null, externalRef: null }, { requireTag: null, wp: null })).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 본다**

Run: `npx vitest run tests/domain/design-gate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/designGate'`

- [ ] **Step 3: 모듈을 쓴다**

`src/lib/domain/designGate.ts`:

```ts
/**
 * 설계 상태·구현자동 — 규칙 원본(스펙 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 3·5절,
 * 12절이 본문보다 우선, 계획서 docs/superpowers/plans/2026-09-27-design-state-dev-auto.md P1~P16).
 * 관문(canClaim·canBuildStart·canReportCompletion·canRelease·canDesignDone)·판단(nextAgentAction·isMine)·PC 판정·
 * 화면 판정(designScreen·designButtons)을 여기 하나에 둔다(D7). 순수 함수만 — DB·요청을 모른다.
 * 라우트가 관문을 집행하고, 목록·상세·watch 가 판단을 싣고, 좌석·WBS·허브가 화면 판정을 쓴다.
 * 전이 RPC(0108 apply_workflow_event)는 원자 전이와 CAS 만 한다.
 */
import type { AgentOrderStatus } from './agentWork'
import { STALE_MS } from './seatState'

export const DESIGN_MODES = ['auto', 'review', 'human'] as const
export type DesignMode = (typeof DESIGN_MODES)[number]
export const DESIGN_STATES = ['review', 'accepted'] as const
export type DesignState = (typeof DESIGN_STATES)[number]
/** claim_scope 에 저장되는 값. 빈 값(0108 이전·2.9 앱의 claim)은 legacy 로 본다(D8). */
export const CLAIM_SCOPES = ['full', 'design', 'build', 'legacy'] as const
export type ClaimScope = (typeof CLAIM_SCOPES)[number]
/** claim 요청이 보낼 수 있는 범위 — 보내지 않으면 legacy. */
export const CLAIM_REQUEST_SCOPES = ['full', 'design', 'build'] as const
export const BUILD_SCOPES = ['full', 'build', 'rework', 'legacy'] as const
export type BuildScope = (typeof BUILD_SCOPES)[number]
export type AgentAction = 'full' | 'design' | 'build' | 'skip' | 'wait'

/** D25 — 도는 PC 가 이만큼 조용하면 다른 PC 가 이어받을 수 있다(긴 명령 하나가 heartbeat 없이 도는 시간보다 길게). */
export const RUNNER_STALE_MS = 30 * 60_000
/** Y12 — 질문(BLOCKED)한 워커를 살아 있다고 보는 상한: 팀장 TICK(기본 30분) 두 번. */
export const BLOCKED_MAX_AGE_MS = 2 * 30 * 60_000

const PROGRESSED: ReadonlySet<string> = new Set(['ip', 'im', 'xx'])
const WAIT_PHASES: ReadonlySet<string> = new Set(['wait_review', 'wait_pred'])

export const stageAtOrPastIp = (stage: string | null): boolean => stage !== null && PROGRESSED.has(stage)
export const toDesignMode = (v: unknown): DesignMode =>
  typeof v === 'string' && (DESIGN_MODES as readonly string[]).includes(v) ? (v as DesignMode) : 'auto'
export const toDesignState = (v: unknown): DesignState | null =>
  typeof v === 'string' && (DESIGN_STATES as readonly string[]).includes(v) ? (v as DesignState) : null
export const toClaimScope = (v: unknown): ClaimScope =>
  typeof v === 'string' && (CLAIM_SCOPES as readonly string[]).includes(v) ? (v as ClaimScope) : 'legacy'

/**
 * 에이전트 라벨의 PC(3절, P5). `<신원>/<host>/<슬롯>` 은 둘째 칸, 수동 세션 `claude-<host>` 는 접두어를 뗀 값(L1),
 * 그 밖의 옛 라벨은 라벨 전체다. dflow.sh 의 slug 가 이미 소문자지만 비교는 소문자로 맞춘다.
 */
export function pcOfLabel(label: string | null): string | null {
  const l = (label ?? '').trim()
  if (l === '') return null
  const parts = l.split('/')
  const pc = parts.length >= 2 ? parts[1] : l.startsWith('claude-') ? l.slice('claude-'.length) : l
  return pc === '' ? null : pc.toLowerCase()
}

/** 팀원 라벨(`…/w<n>`) — 팀장은 이 라벨이 점유한 claimed 주문만 이어받는다(Y9). */
export const isWorkerLabel = (label: string | null): boolean => /\/w[0-9]+$/.test(label ?? '')

/** met = 미충족 선행 없음, ahead = 미충족이 모두 dd·ip(설계 선행 가능, D15), blocked = 그 밖. */
export type PredsState = 'met' | 'ahead' | 'blocked'
export function predsState(unmet: ReadonlyArray<{ stage: string | null }>): PredsState {
  if (unmet.length === 0) return 'met'
  return unmet.every(d => d.stage === 'dd' || d.stage === 'ip') ? 'ahead' : 'blocked'
}

export type ItemFacts = {
  mode: DesignMode
  stage: string | null
  actualPct: number | null
  /** 위임 표식(tags 에 agent). */
  delegated: boolean
  /** 이 항목에 approved 주문이 있다(D26). */
  hasApprovedOrder: boolean
  preds: PredsState
}
export type OrderFacts = {
  status: AgentOrderStatus
  designState: DesignState | null
  /** toClaimScope 로 정규화한 값(빈 값은 legacy). */
  claimScope: ClaimScope
  runner: string | null
  runnerSeenAt: string | null
  lastHeartbeatAt: string | null
  heartbeatPhase: string | null
  heartbeatAgent: string | null
  claimedBy: string | null
  claimedByUserId: string | null
}

/** D26 — 이미 진행된 항목(단계 ip 이상·실적 100·approved 주문). 발행·claim 관문·판단 3행·화면 8·10행이 같은 식이다(L6). */
export function alreadyProgressed(i: Pick<ItemFacts, 'stage' | 'actualPct' | 'hasApprovedOrder'>): boolean {
  return stageAtOrPastIp(i.stage) || (typeof i.actualPct === 'number' && i.actualPct >= 100) || i.hasApprovedOrder
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN)

/**
 * 5.3 2행의 "워커가 살아 있음" — last_heartbeat_at 기준. 질문(blocked)은 2 TICK 까지(Y12), 그 밖은 좌석 ACTIVE 와 같은
 * 5분이다. 마지막 phase 가 대기(wait_review·wait_pred)면 워커가 멈추며 남긴 신호라 살아 있지 않다.
 */
export function workerAlive(o: Pick<OrderFacts, 'lastHeartbeatAt' | 'heartbeatPhase'>, nowMs: number): boolean {
  const t = ms(o.lastHeartbeatAt)
  if (Number.isNaN(t)) return false
  if (o.heartbeatPhase !== null && WAIT_PHASES.has(o.heartbeatPhase)) return false
  return nowMs - t <= (o.heartbeatPhase === 'blocked' ? BLOCKED_MAX_AGE_MS : STALE_MS)
}

/** D25 도는 PC 조건 — runner 가 없거나, 호출자와 같은 PC 거나, runner_seen_at 이 30분 넘게 지났다(모르면 지난 것으로 본다). */
export function runnerFree(o: Pick<OrderFacts, 'runner' | 'runnerSeenAt'>, callerLabel: string | null, nowMs: number): boolean {
  if (o.runner === null) return true
  const caller = pcOfLabel(callerLabel)
  if (caller !== null && pcOfLabel(o.runner) === caller) return true
  const seen = ms(o.runnerSeenAt)
  return Number.isNaN(seen) || nowMs - seen > RUNNER_STALE_MS
}

export type ActionResult = { action: AgentAction; reason: string; depsUnmet: boolean }
const act = (action: AgentAction, reason: string, depsUnmet = false): ActionResult => ({ action, reason, depsUnmet })

/**
 * 5.3 판단 — "지금 이 작업을 어떻게 하나". 위에서부터 처음 맞는 행을 쓴다. 9~12행은 ready 이면서 설계 상태가 없을 때만
 * 닿아 canClaim 과 늘 맞는다(tests/domain/design-gate-model.test.ts 가 도달 상태 전수로 확인한다).
 */
export function nextAgentAction(item: ItemFacts, order: OrderFacts, nowMs: number): ActionResult {
  const s = order.status
  if (s === 'reported' || s === 'approved' || s === 'cancelled') return act('skip', '검수·완료·취소')
  if (s === 'claimed' && (stageAtOrPastIp(item.stage) || workerAlive(order, nowMs))) return act('skip', '구현 중·재작업이거나 워커가 살아 있음')
  if (s === 'ready' && alreadyProgressed(item)) return act('skip', '단계 확인 필요(이미 진행된 항목)')
  if (order.designState === 'review') return act('wait', '설계 검토 대기')
  if (order.designState === 'accepted' && item.stage !== 'dd') return act('skip', '단계 확인 필요(승인된 설계인데 단계가 설계 완료가 아님)')
  if (order.designState === 'accepted' && item.preds !== 'met') return act('wait', '선행 대기')
  if (order.designState === 'accepted') return act('build', '승인·확정된 설계')
  if (s === 'claimed') {
    if (item.stage !== 'ds' && item.stage !== 'dd') return act('skip', '단계 확인 필요')
    if (order.claimScope === 'design') return item.preds === 'blocked' ? act('wait', '선행 대기') : act('design', '설계만(이어 감)')
    if (order.claimScope === 'full' || order.claimScope === 'legacy') {
      if ((item.stage === 'dd' && item.preds !== 'met') || item.preds === 'blocked') return act('wait', '선행 대기')
      return act('full', '처음부터 끝까지(이어 감)', item.preds !== 'met')
    }
    return act('skip', '구현부터 범위인데 설계가 승인되지 않음')
  }
  if (item.mode === 'human') return act('skip', '사람 설계 대기')
  if (item.preds === 'blocked') return act('wait', '선행 대기')
  if (item.mode === 'review') return act('design', '설계만')
  return act('full', '처음부터 끝까지', item.preds !== 'met')
}

export type MineRequest = {
  userId: string
  /** 요청 라벨(PC 판정) — dflow.sh 의 agent_id_default 또는 watcher 라벨. */
  label: string | null
  /** 팀장의 요청이면 claimed 주문에도 목록 거르기와 팀원 라벨을 요구한다(Y9). */
  lead: boolean
  /** 목록 거르기(프로젝트 바인딩·담당자·WP·태그)를 통과했는가 — 라우트가 계산한다. */
  filtersPass: boolean
}

/** 5.3 mine — ready 는 목록 거르기, claimed 는 같은 신원 ∧ runnerFree(build-start 원자 조건과 같은 식). */
export function isMine(
  order: Pick<OrderFacts, 'status' | 'claimedBy' | 'claimedByUserId' | 'runner' | 'runnerSeenAt'>, req: MineRequest, nowMs: number,
): boolean {
  if (order.status === 'ready') return req.filtersPass
  if (order.status !== 'claimed' || order.claimedByUserId !== req.userId) return false
  if (req.lead && (!req.filtersPass || !isWorkerLabel(order.claimedBy))) return false
  return runnerFree(order, req.label, nowMs)
}

export type GateCode = 'design_gate' | 'design_not_accepted' | 'runner_active' | 'dependency_not_met'
export type GateRefusal = { status: 403 | 409; code: GateCode; message: string; reason?: string }
const refuse = (status: 403 | 409, code: GateCode, message: string, reason?: string): GateRefusal =>
  ({ status, code, message, ...(reason ? { reason } : {}) })

/** 5.2 claim 관문. designFirst 는 요청의 design_first(full·legacy 에서만 뜻이 있다). */
export function canClaim(item: ItemFacts, designState: DesignState | null, scope: ClaimScope, designFirst: boolean): GateRefusal | null {
  if (alreadyProgressed(item)) {
    return refuse(409, 'design_gate', '이미 진행된 작업입니다(단계 작업 중 이상·실적 100·승인된 주문) — 단계를 되돌리거나 「재작업」을 쓰세요.')
  }
  let df = designFirst
  if (scope === 'full' || scope === 'legacy') {
    if (item.mode !== 'auto' || designState !== null) {
      return refuse(409, 'design_gate', '완전자동 작업이 아니거나 설계 상태가 있습니다 — 서버 판단(action)을 따르세요.')
    }
  } else if (scope === 'design') {
    if (item.mode === 'human' || designState !== null) {
      return refuse(409, 'design_gate', '설계만 할 수 있는 작업이 아닙니다(구현자동이거나 설계 상태가 있음).')
    }
    df = item.preds !== 'met'
  } else {
    if (item.mode !== 'human' || designState !== 'accepted' || item.stage !== 'dd') {
      return refuse(409, 'design_not_accepted', '확정된 사람 설계가 없습니다 — 「설계 확정」을 먼저 누르세요.')
    }
    df = false
  }
  if (item.preds === 'met') return null
  if (!df) return refuse(403, 'dependency_not_met', '선행 작업이 끝나지 않았습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).')
  if (item.preds === 'blocked') {
    return refuse(403, 'dependency_not_met', '설계 선행은 미충족 선행이 모두 설계 완료(dd)·작업 중(ip)일 때만 할 수 있습니다.', 'design_first_too_early')
  }
  return null
}

/** 5.2 build-start 관문. 검사 순서 runner → 설계 → 선행(P4). 취소된 주문은 라우트가 먼저 409 cancelled 로 돌려준다. */
export function canBuildStart(
  item: ItemFacts, order: OrderFacts, scope: BuildScope, callerLabel: string | null, nowMs: number,
): GateRefusal | null {
  if (order.status !== 'claimed') return refuse(409, 'design_gate', `구현을 시작할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
  if (!runnerFree(order, callerLabel, nowMs)) return refuse(409, 'runner_active', `다른 PC 가 이 작업을 돌리는 중입니다(${order.runner}).`)
  const ge = stageAtOrPastIp(item.stage)
  const eff: BuildScope = scope === 'legacy' && !ge ? 'full' : scope
  const ds = order.designState
  if (eff === 'full') {
    const scopeOk = order.claimScope === 'full' || order.claimScope === 'legacy'
    if (item.mode !== 'auto' || ds !== null || !scopeOk) {
      return refuse(409, 'design_gate', '처음부터 끝까지(full)로 구현을 시작할 수 없는 작업입니다 — 서버 claim_scope 를 따르세요.')
    }
    if (!ge && item.stage !== 'ds' && item.stage !== 'dd') return refuse(409, 'design_gate', '설계 단계(ds·dd)가 아닌 주문입니다.')
  } else if (eff === 'build') {
    if (ds !== 'accepted') return refuse(409, 'design_not_accepted', '승인·확정된 설계가 없습니다 — 「설계 승인」·「설계 확정」을 먼저 누르세요.')
    if (!ge && item.stage !== 'dd') return refuse(409, 'design_gate', '설계 완료(dd) 단계가 아닙니다.')
  } else if (eff === 'rework') {
    const approved = ds === 'accepted' || (item.mode === 'auto' && ds === null)
    if (item.stage !== 'ip' || !approved) {
      return refuse(409, 'design_gate', '재작업을 시작할 수 없는 상태입니다(단계가 작업 중이 아니거나 승인된 설계가 없음).')
    }
  } else if (ds === 'review') {
    return refuse(409, 'design_gate', '설계 검토 대기 중인 작업입니다.')
  }
  if (!ge && eff !== 'rework' && item.preds !== 'met') {
    return refuse(403, 'dependency_not_met', '선행 작업이 끝나지 않아 구현을 시작할 수 없습니다(검수 대기 이상도, 승인도, 실적 100% 도 아님).')
  }
  return null
}

/**
 * 완료 보고 관문 — 설계 검토 대기면 거부(W23), 리프는 단계 ip 에서만(Y2), runner 가 다른 PC 면 거부(Y1 — 30분이 지나도
 * 넘겨받지 않는다: 넘겨받기는 heartbeat·build-start 몫), 호출 라벨이 아닌 세션이 살아 있으면 거부(P16).
 * item 이 null 이거나 리프가 아니면(지워진 항목·부모) 단계는 보지 않는다.
 */
export function canReportCompletion(
  item: { stage: string | null; isLeaf: boolean } | null,
  order: Pick<OrderFacts, 'designState' | 'runner' | 'heartbeatAgent' | 'lastHeartbeatAt' | 'heartbeatPhase'>,
  callerLabel: string | null, nowMs: number,
): GateRefusal | null {
  if (order.designState === 'review') return refuse(409, 'design_gate', '설계 검토 대기 중에는 완료를 보고할 수 없습니다.')
  if (item !== null && item.isLeaf && item.stage !== 'ip') {
    return refuse(409, 'design_gate', `완료 보고는 작업 중(ip) 단계에서만 받습니다(현재: ${item.stage ?? '없음'}).`)
  }
  if (order.runner !== null && pcOfLabel(order.runner) !== pcOfLabel(callerLabel)) {
    return refuse(409, 'runner_active', `이 작업은 다른 PC(${order.runner})가 돌리고 있습니다 — 완료 보고는 도는 PC 에서만 받습니다.`)
  }
  if (order.heartbeatAgent !== null && order.heartbeatAgent !== callerLabel && workerAlive(order, nowMs)) {
    return refuse(409, 'runner_active', `다른 세션(${order.heartbeatAgent})이 이 작업을 돌리고 있습니다 — 그 세션이 끝난 뒤 보고하세요.`)
  }
  return null
}

/** D13 — 설계 상태가 있거나, 설계만 하던 주문(claim_scope design)이 ds·dd 에 있으면 반납하지 않는다(웹의 「중단」을 쓴다). */
export function canRelease(item: { stage: string | null } | null, order: Pick<OrderFacts, 'designState' | 'claimScope'>): GateRefusal | null {
  if (order.designState !== null) return refuse(409, 'design_gate', '설계 상태가 있는 작업은 반납하지 않습니다 — 웹에서 「중단」을 쓰세요.')
  if (order.claimScope === 'design' && item !== null && (item.stage === 'ds' || item.stage === 'dd')) {
    return refuse(409, 'design_gate', '설계만 하던 작업은 반납하지 않습니다 — 웹에서 「중단」을 쓰세요.')
  }
  return null
}

/** 4.1 design_done — claimed ∧ 단계 ip 미만. 부모·지워진 항목은 RPC 가 단계·실적만 건너뛴다. */
export function canDesignDone(item: { stage: string | null } | null, order: Pick<OrderFacts, 'status'>): GateRefusal | null {
  if (order.status !== 'claimed') return refuse(409, 'design_gate', `설계 완료를 기록할 수 있는 상태가 아닙니다(현재: ${order.status}).`)
  if (item !== null && stageAtOrPastIp(item.stage)) return refuse(409, 'design_gate', '구현이 시작된 작업은 설계 완료로 되돌릴 수 없습니다.')
  return null
}

/** 4.1 설계 방식 변경 — 설계 상태가 없고 claimed·reported·approved 주문이 없을 때만. 막히면 사람이 할 일을 담은 사유를 낸다. */
export function designModeChangeBlock(p: { designState: DesignState | null; orderStatuses: readonly string[] }): string | null {
  if (p.designState !== null) return '설계가 확정·검토 중입니다 — 「설계 되돌리기」나 「중단」 뒤에 바꾸세요.'
  if (p.orderStatuses.includes('claimed')) return '에이전트가 작업 중입니다 — 「중단」 뒤에 바꾸세요.'
  if (p.orderStatuses.some(s => s === 'reported' || s === 'approved')) return '완료 보고·승인된 주문이 있습니다 — 방식을 바꿀 수 없습니다.'
  return null
}

export type DesignButton = 'accept' | 'confirm' | 'reopen'
export type ScreenOrder = Pick<OrderFacts, 'status' | 'designState' | 'runner' | 'lastHeartbeatAt' | 'heartbeatPhase'> & { designNote: string | null }
const HUMAN_DRAFT_STAGES: ReadonlySet<string | null> = new Set([null, 'as', 'ds'])

/** 7절 버튼(서버 조건은 4.1 과 같다). active = 활성 주문(ready·claimed·reported, 0077 로 항목당 하나). */
export function designButtons(item: ItemFacts, active: Pick<ScreenOrder, 'status' | 'designState'> | null): DesignButton[] {
  if (active === null) return []
  const out: DesignButton[] = []
  if (active.status === 'claimed' && active.designState === 'review' && item.stage === 'dd') out.push('accept')
  if (active.status === 'ready' && item.mode === 'human' && item.delegated && HUMAN_DRAFT_STAGES.has(item.stage)
    && active.designState === null && !alreadyProgressed(item)) out.push('confirm')
  if (active.designState === 'accepted' && item.stage === 'dd') out.push('reopen')
  return out
}

export type DesignScreenRow = { row: number; label: string; note: string | null; hint: string | null; buttons: DesignButton[] }

/**
 * 3절 화면 판정 — 위에서부터 처음 맞는 행, 없으면 null(호출부가 지금의 단계 문구를 그대로 보인다). 좌석은 BLOCKED·신선한
 * heartbeat(ACTIVE)를 먼저 보고 그다음 이 판정을 본다. 12행은 L14 로 더한 「선행 대기(설계 중 멈춤)」다.
 */
export function designScreen(p: {
  item: ItemFacts; active: ScreenOrder | null; lastReview: 'approve' | 'reject' | null; nowMs: number
}): DesignScreenRow | null {
  const { item, active } = p
  const buttons = designButtons(item, active)
  const r = (row: number, label: string, hint: string | null, note: string | null = null): DesignScreenRow => ({ row, label, note, hint, buttons })
  const ds = active?.designState ?? null
  const which = item.mode === 'human' ? '확정' : '승인'
  if (active?.status === 'claimed' && ds === 'review') {
    return r(1, '설계 검토 대기', 'agent 브랜치의 <TASKS>/<TSK>/design.md 를 검토하고, 고쳤으면 push 한 뒤 「설계 승인」을 누르세요.', active.designNote)
  }
  if (ds === 'accepted' && item.stage === 'dd' && item.preds !== 'met') return r(2, `선행 대기(설계 ${which}됨)`, null)
  if (ds === 'accepted' && item.stage === 'dd') {
    const who = active?.runner ? ` · ${active.runner} 가 도는 중` : ''
    return r(3, `구현 대기(설계 ${which}됨)${who}`, '팀장이 떠 있으면 다음 TICK(기본 30분) 안에 구현을 시작합니다.')
  }
  const alive = active !== null && workerAlive(active, p.nowMs)
  if (active?.status === 'claimed' && ds === null && item.stage === 'dd') {
    return r(4, item.preds !== 'met' ? '설계 완료·선행 대기' : '설계 완료·구현 대기', null)
  }
  if (active?.status === 'claimed' && ds === null && item.stage === 'ds' && item.preds === 'blocked' && !alive) {
    return r(12, '선행 대기(설계 중 멈춤)', '선행 작업이 끝나면 팀장이 이어 갑니다.')
  }
  if (active?.status === 'claimed' && item.stage === 'ip' && p.lastReview === 'reject' && !alive) {
    return r(5, '재작업 대기', '사람이 /dflow-dev 로 재작업을 돌립니다(팀장은 가져가지 않습니다).')
  }
  const humanDraft = item.mode === 'human' && HUMAN_DRAFT_STAGES.has(item.stage) && ds === null && !alreadyProgressed(item)
  if (humanDraft && item.delegated && active?.status === 'ready') {
    return r(6, '사람 설계 대기', '개발 브랜치의 <TASKS>/<TSK>/design.md 에 필수 5개 절을 모두 쓰고 push 한 뒤 「설계 확정」을 누르세요.', active.designNote)
  }
  if (humanDraft) return r(7, '사람 설계 대기(위임 안 됨)', '위임 표식을 달고(프로젝트의 에이전트 위임이 켜져 있어야 합니다) 확정하세요.')
  if (item.delegated && active?.status === 'ready' && alreadyProgressed(item)) {
    return r(8, '위임 보류(단계가 이미 진행됨)', '위임을 해제하고 단계를 되돌린 뒤 다시 위임하세요.')
  }
  if (item.delegated && active === null && item.hasApprovedOrder && item.stage !== 'xx') {
    return r(9, '위임 보류(승인된 주문 있음)', '「재작업」을 쓰세요.')
  }
  if (item.delegated && active === null && !item.hasApprovedOrder && (stageAtOrPastIp(item.stage) || item.actualPct === 100)) {
    return r(10, '위임 보류(단계가 이미 진행됨)', '위임 표식을 떼고 단계를 되돌린 뒤 다시 위임하세요(표식이 있는 동안은 단계 변경이 잠깁니다).')
  }
  if (item.mode === 'review' && active?.status === 'ready' && ds === null && item.preds === 'blocked') return r(11, '선행 대기', null)
  return null
}

/** Y13 — 승인·확정된 설계로 구현 중이면 agent 브랜치 push 금지를 알린다. */
export function designPushWarning(item: Pick<ItemFacts, 'stage'>, active: Pick<ScreenOrder, 'status' | 'designState'> | null): string | null {
  if (active?.status === 'claimed' && active.designState === 'accepted' && stageAtOrPastIp(item.stage)) {
    return '구현 중에는 agent 브랜치에 push 하지 마세요 — 워커의 마감 push 가 충돌합니다. 고칠 것은 완료 보고 뒤 반려로 알리세요.'
  }
  return null
}

const WP_RE = /^([^/\s]+\/)?WP-([0-9]+)$/
/** "WP-02,dict/WP-3" → ['WP-2','dict/WP-3'](번호 앞 0 을 뗀다, poll.sh 와 같다). 빈 값은 null, 형식 오류는 'invalid'. */
export function parseWpList(raw: string | null): string[] | null | 'invalid' {
  const parts = (raw ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
  if (parts.length === 0) return null
  const out: string[] = []
  for (const p of parts) {
    const m = WP_RE.exec(p)
    if (!m) return 'invalid'
    out.push(`${m[1] ?? ''}WP-${String(Number.parseInt(m[2], 10))}`)
  }
  return out
}

/** 목록 거르기(poll.sh filter_ok 와 같은 규칙) — 태그가 있어야 하고, WP 는 external_ref 마지막 칸의 TSK 첫 번호로 가린다. */
export function listFilterPass(
  item: { tags: readonly string[] | null; externalRef: string | null },
  f: { requireTag: string | null; wp: readonly string[] | null },
): boolean {
  if (f.requireTag !== null && !(item.tags ?? []).includes(f.requireTag)) return false
  if (f.wp === null) return true
  const ref = item.externalRef ?? ''
  const last = ref.split('/').pop() ?? ''
  const m = /^TSK-([0-9]+)-/.exec(last)
  if (!m) return false
  const n = String(Number.parseInt(m[1], 10))
  const mod = ref.includes('/') ? ref.slice(0, ref.lastIndexOf('/')) : ''
  return f.wp.includes(`WP-${n}`) || (mod !== '' && f.wp.includes(`${mod}/WP-${n}`))
}
```

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx vitest run tests/domain/design-gate.test.ts`
Expected: PASS(모든 `it` 통과). 실패하면 스펙 5.2·5.3·3절 표와 대조해 코드를 고친다 — 테스트 기대값은 스펙 행에서 왔다.

- [ ] **Step 5: 타입 검사**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "designGate|design-gate" || echo OK`
Expected: `OK`

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/designGate.ts tests/domain/design-gate.test.ts
git commit -m "feat(design-state): 설계 상태 관문·판단·화면 판정을 순수 모듈 하나로 둔다

규칙 원본을 designGate.ts 한 곳에 모아 라우트·목록·화면이 같은 판정을 쓰게 한다(스펙 D7).
12절 대응(Y1·Y2·Y7·Y9·Y12·L1·L2·L6·L14)과 계획 P4·P5·P8·P16 을 표 테스트로 고정한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
## Task 2: 상태 공간 모델 이식 — 실제 designGate 함수로 불변식 전수 검사

**Files:**
- Modify: `docs/superpowers/specs/2026-09-26-design-state-model/model5.py`(P16 스위치)
- Create: `tests/domain/design-gate-model.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `canBuildStart`·`canClaim`·`canRelease`·`canReportCompletion`·`designButtons`·`designScreen`·`isMine`·`nextAgentAction`·`runnerFree`·`workerAlive`, 타입 `ClaimScope`·`ItemFacts`·`OrderFacts`·`PredsState`
- Produces: 없음(검사만). 이후 Task 가 designGate 를 고치면 이 테스트가 불변식을 다시 확인한다.

계획 단계에서 Python 모델로 이 설정을 먼저 돌렸다. 12절 수정안을 모두 켜고 P16 까지 더하면 전이 중 위반 0종, 두 구현자 0, 판단↔관문 어긋남 0, 도달 상태 340,206개(약 20초)였다. P16 이 없으면 "워커가 도는 중 사람이 `dflow.sh done` → 반려 → 재작업 워커" 경로로 두 구현자가 3,312 상태 나왔다.

- [ ] **Step 1: Python 모델에 P16 스위치를 더한다**

`docs/superpowers/specs/2026-09-26-design-state-model/model5.py` 에서 `FIX_CLAIM_PCT100=0,` 줄 바로 아래에 한 줄을 더한다:

```python
    FIX_DONE_NO_LIVE_OTHER=0, # 계획 P16: 완료 보고는 살아 있는 다른 세션(heartbeat_agent 가 다르고 5분 안)이 있으면 거부
```

같은 파일의 `if V['MANUAL_DONE'] and s.ord == 'claimed':` 블록을 아래처럼 바꾼다(둘째 줄 다음에 한 줄 추가):

```python
    if V['MANUAL_DONE'] and s.ord == 'claimed':
        r = s.dst != 'review' and (not V['FIX_DONE_AT_IP'] or s.stage == 'ip')
        if V['FIX_DONE_NO_LIVE_OTHER'] and (running(s.wA) or running(s.wB)): r = False
```

파일 머리 주석의 실행 예시 목록 끝에 한 줄을 더한다:

```python
#   python3 model5.py PASS=2 SLIM=0 QUIET=0 LEAD_MOVES=0 IMPORT=0 MANUAL_PCT=1 BLOCKED=0 RELEASE_STOPS_WORKER=1 MANUAL_DONE=1 FIX_DONE_AT_IP=1 FIX_HB_REPORT_RUNNER=1 FIX_CONFLICT_EXIT=1 FIX_CLAIM_PCT100=1 REOPEN_NONHUMAN_CLEARS_RUNNER=1 FIX_TAKE_ON_RESUME=1 FIX_DONE_NO_LIVE_OTHER=1 ASSIGN_SETS_AS=0 → 340,206 (구현 계획서 판 — 위반 0, 두 구현자 0. tests/domain/design-gate-model.test.ts 가 옮긴 판)
```

- [ ] **Step 2: Python 판이 위반 0 인지 다시 확인한다**

Run: `cd docs/superpowers/specs/2026-09-26-design-state-model && python3 model5.py PASS=2 SLIM=0 QUIET=0 LEAD_MOVES=0 IMPORT=0 MANUAL_PCT=1 BLOCKED=0 RELEASE_STOPS_WORKER=1 MANUAL_DONE=1 FIX_DONE_AT_IP=1 FIX_HB_REPORT_RUNNER=1 FIX_CONFLICT_EXIT=1 FIX_CLAIM_PCT100=1 REOPEN_NONHUMAN_CLEARS_RUNNER=1 FIX_TAKE_ON_RESUME=1 FIX_DONE_NO_LIVE_OTHER=1 ASSIGN_SETS_AS=0 | grep -E "도달 상태 수|전이 중 위반|두 워커|어긋남"`
Expected:
```
도달 상태 수: 340206
## 전이 중 위반 0 종
## ⑤ 두 워커가 같은 주문에서 build-start 뒤(구현 중): 0 상태
## ① 판단(5.3)·mine → 관문(5.2) 어긋남(정적, 도달 상태 × PC): 0
```

- [ ] **Step 3: TS 모델 테스트를 쓴다**

`tests/domain/design-gate-model.test.ts`:

```ts
// tests/domain/design-gate-model.test.ts — 설계 상태 상태 공간 모델(BFS).
// docs/superpowers/specs/2026-09-26-design-state-model/model5.py 를 옮겼다(그 파일 머리의 "구현 계획서 판" 실행 줄과 같은 틀).
// 켠 것: 스펙 12절 수정안(Y1 완료 보고·heartbeat 의 runner, Y2 완료 보고는 ip 에서만, Y7 claimed 아님은 워커 종료,
//   L5 사람 초안은 full 에도, L6 실적 100 관문, L9 되돌림은 runner 를 비움, Y11 fetch·push 실패는 일시 제외),
//   계획 P7(재개 때 build-start 로 runner 넘겨받기)·P16(살아 있는 다른 세션이 있으면 완료 보고 거부)·L8(위임은 단계를 건드리지 않음).
// 끈 것: 조용한 워커·BLOCKED·팀장 PC 이동·import. PC 둘, 동시 워커 둘, 사람의 수기 실적 100·수동 done 은 켠다.
// 관문·판단·mine·버튼·화면 판정은 실제 designGate 함수를 부르고, 전이(스펙 4.1 사건 표의 결과)는 이 파일이 따로 적는다 —
// 전이까지 designGate 에서 가져오면 자기 자신과 대조하는 셈이 된다.
// 위반이 나오면 먼저 Python 판과 같은 전이인지 대조한다. 옮김 오류가 아니면 designGate 를 고친다.
import { describe, expect, it } from 'vitest'
import {
  canBuildStart, canClaim, canRelease, canReportCompletion, designButtons, designScreen, isMine, nextAgentAction, runnerFree,
  workerAlive, type ClaimScope, type ItemFacts, type OrderFacts, type PredsState,
} from '@/lib/domain/designGate'

type Ord = 'none' | 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
type PC = 'A' | 'B'
type WScope = 'full' | 'design' | 'build' | 'rework' | 'legacy'
type Worker = { sc: WScope; step: 0 | 1; own: 'L' | 'H' } | null
type Res = null | 'diedL' | 'diedH' | 'result'
type S = {
  mode: 'auto' | 'review' | 'human'; tag: boolean; ord: Ord; dst: 'none' | 'review' | 'accepted'
  cs: null | 'legacy' | 'full' | 'design' | 'build'; stage: string; pct: number; rw: boolean
  hbph: null | 'work' | 'wait'; hbage: 0 | 1; runner: PC | null; rage: 0 | 1; preds: 'met' | 'ok' | 'no'; hd: boolean
  wA: Worker; wB: Worker; wtA: boolean; wtB: boolean; resA: Res; resB: Res; excl: null | 'temp' | 'perm'; pend: boolean
}

const NOW = Date.parse('2026-09-27T12:00:00Z')
const iso = (min: number) => new Date(NOW - min * 60_000).toISOString()
const AT1 = iso(1), AT10 = iso(10), AT31 = iso(31)
const PCS: readonly PC[] = ['A', 'B']
const LEAD: PC = 'A'
const MAXW = 2
const CRED: Record<string, number> = { as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 }
const ACTIVE: ReadonlySet<Ord> = new Set(['ready', 'claimed', 'reported'])
const geIp = (st: string) => st === 'ip' || st === 'im' || st === 'xx'
const workerLabel = (x: PC) => `u/pc${x.toLowerCase()}/w1`
const humanLabel = (x: PC) => `claude-pc${x.toLowerCase()}`
const w = (s: S, x: PC) => (x === 'A' ? s.wA : s.wB)
const wt = (s: S, x: PC) => (x === 'A' ? s.wtA : s.wtB)
const resOf = (s: S, x: PC) => (x === 'A' ? s.resA : s.resB)
const other = (x: PC): PC => (x === 'A' ? 'B' : 'A')
const mx = (p: number, k: string) => Math.max(p, CRED[k])

function setw(s: S, x: PC, p: { w?: Worker; wt?: boolean; res?: Res }): S {
  const t = { ...s }
  if (p.w !== undefined) { if (x === 'A') t.wA = p.w; else t.wB = p.w }
  if (p.wt !== undefined) { if (x === 'A') t.wtA = p.wt; else t.wtB = p.wt }
  if (p.res !== undefined) { if (x === 'A') t.resA = p.res; else t.resB = p.res }
  return t
}
const wk = (x: Worker) => (x === null ? '-' : `${x.sc}.${x.step}.${x.own}`)
const key = (s: S) => `${s.mode}|${+s.tag}|${s.ord}|${s.dst}|${s.cs ?? '-'}|${s.stage}|${s.pct}|${+s.rw}|${s.hbph ?? '-'}|${s.hbage}|`
  + `${s.runner ?? '-'}|${s.rage}|${s.preds}|${+s.hd}|${wk(s.wA)}|${wk(s.wB)}|${+s.wtA}|${+s.wtB}|${s.resA ?? '-'}|${s.resB ?? '-'}|${s.excl ?? '-'}|${+s.pend}`

// ---- 판단 재료(designGate 입력) ----
const PREDS: Record<S['preds'], PredsState> = { met: 'met', ok: 'ahead', no: 'blocked' }
const item = (s: S): ItemFacts => ({
  mode: s.mode, stage: s.stage, actualPct: s.pct, delegated: s.tag, hasApprovedOrder: s.ord === 'approved', preds: PREDS[s.preds],
})
function hbAgent(s: S): string | null {
  if (s.runner !== null && w(s, s.runner) !== null) return workerLabel(s.runner)
  if (s.wA !== null) return workerLabel('A')
  if (s.wB !== null) return workerLabel('B')
  return s.runner === null ? null : workerLabel(s.runner)
}
const order = (s: S): OrderFacts => ({
  status: s.ord === 'none' ? 'cancelled' : s.ord,
  designState: s.dst === 'none' ? null : s.dst,
  claimScope: (s.cs ?? 'legacy') as ClaimScope,
  runner: s.runner === null ? null : workerLabel(s.runner),
  runnerSeenAt: s.runner === null ? null : s.rage === 1 ? AT31 : AT10,
  lastHeartbeatAt: s.hbph === null ? null : s.hbage === 1 ? AT10 : AT1,
  heartbeatPhase: s.hbph === null ? null : s.hbph === 'wait' ? 'wait_review' : 'build',
  heartbeatAgent: s.hbph === null ? null : hbAgent(s),
  claimedBy: s.ord === 'claimed' ? workerLabel(s.runner ?? LEAD) : null,
  claimedByUserId: s.ord === 'claimed' ? 'u' : null,
})
const action = (s: S) => (s.ord === 'none' ? 'none' : nextAgentAction(item(s), order(s), NOW).action)
const mine = (s: S, x: PC, lead: boolean) => s.ord !== 'none'
  && isMine(order(s), { userId: 'u', label: lead ? workerLabel(x) : humanLabel(x), lead, filtersPass: lead ? s.tag : true }, NOW)
const activeOf = (s: S) => {
  if (!ACTIVE.has(s.ord)) return null
  const o = order(s)
  return { status: o.status, designState: o.designState, runner: o.runner, lastHeartbeatAt: o.lastHeartbeatAt, heartbeatPhase: o.heartbeatPhase, designNote: null }
}
const reportOk = (s: S, caller: string) => canReportCompletion({ stage: s.stage, isLeaf: true }, order(s), caller, NOW) === null
const unapproved = (s: S) => s.dst === 'review' || ((s.mode === 'review' || s.mode === 'human') && s.dst !== 'accepted')
const wscope = (s: S): WScope => (s.rw && s.stage === 'ip')
  ? 'rework' : ({ design: 'design', full: 'full', legacy: 'full', build: 'build' } as const)[s.cs ?? 'legacy']

// ---- 4.1 사건의 결과(전이) ----
function norm(s: S): S {  // 살아 있는 워커는 heartbeat 를 계속 보낸다(claimed 에서만 받는다)
  if (s.ord !== 'claimed') return s
  let t = s
  if (t.wA !== null || t.wB !== null) t = { ...t, hbph: 'work', hbage: 0 }
  if (t.runner !== null && w(t, t.runner) !== null) t = { ...t, rage: 0 }
  if (t.runner === null && t.rage !== 0) t = { ...t, rage: 0 }
  return t
}
function issue(t: S): S {  // D26 발행. 단계·실적은 건드리지 않는다(L8)
  if (ACTIVE.has(t.ord) || t.ord === 'approved' || geIp(t.stage) || t.pct >= 100) return t
  return { ...t, ord: 'ready', dst: 'none', cs: null, rw: false, hbph: null, hbage: 0, runner: null, rage: 0,
    wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, excl: null, pend: false }
}
function cancel(t: S): S {  // D14 — RPC cancel 사건
  if (t.ord !== 'ready' && t.ord !== 'claimed') return t
  const back = t.ord === 'claimed' || t.stage === 'dd'
  return { ...t, ord: 'cancelled', dst: 'none', cs: null, runner: null, rage: 0, stage: back ? 'as' : t.stage, pct: back ? 0 : t.pct,
    rw: false, hbph: null, hbage: 0, wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, pend: false }
}
function reopen(s: S): S | null {  // design_reopen — dd ∧ accepted 에서만, 방식과 관계없이 runner 를 비운다(L9)
  if (!(s.stage === 'dd' && s.dst === 'accepted')) return null
  if (s.mode === 'human') {
    const t: S = { ...s, stage: 'as', dst: 'none', pct: 0 }
    return s.ord === 'claimed' ? { ...t, ord: 'ready', cs: null, runner: null, rage: 0, hbph: null, hbage: 0, pend: false } : t
  }
  return { ...s, dst: 'review', runner: null, rage: 0 }
}
function designDone(s: S): S | null {
  if (s.ord !== 'claimed' || (s.stage !== 'ds' && s.stage !== 'dd')) return null
  const becameReview = s.dst === 'none' && (s.mode === 'review' || s.cs === 'design')
  const t: S = { ...s, stage: 'dd', dst: becameReview ? 'review' : s.dst, pct: mx(s.pct, 'dd'), hbph: 'wait', hbage: 0, pend: false }
  return becameReview ? { ...t, runner: null, rage: 0 } : t
}
function claim(s: S, sc: 'full' | 'design' | 'build', x: PC, own: 'L' | 'H'): S {
  const st = sc === 'build' ? 'dd' : 'ds'
  const t: S = { ...s, ord: 'claimed', cs: sc, stage: st, pct: mx(s.pct, st), runner: x, rage: 0, hbph: 'work', hbage: 0,
    rw: false, pend: false, excl: own === 'L' ? null : s.excl }
  return setw(t, x, { w: { sc, step: 0, own }, wt: true, res: null })
}
function resumeVariants(s: S, x: PC, own: 'L' | 'H'): S[] {
  const ws = wscope(s)
  const steps: (0 | 1)[] = geIp(s.stage) && ws !== 'rework' ? [0, 1] : [0]
  const free = runnerFree(order(s), own === 'L' ? workerLabel(x) : humanLabel(x), NOW)
  return steps.map(step => free
    ? { ...setw(s, x, { w: { sc: ws, step, own }, wt: true, res: null }), runner: x, rage: 0 as const }  // P7
    : setw(s, x, { res: 'result' }))                                                                   // exit 12
}
function endWorker(t: S, x: PC, res: Res, own: 'L' | 'H', p: { wt?: boolean; excl?: 'temp' | 'perm' } = {}): S {
  let u = setw(t, x, { w: null, res, ...(p.wt !== undefined ? { wt: p.wt } : {}) })
  if (own === 'L' && p.excl !== undefined && x === LEAD) u = { ...u, excl: p.excl }
  return u
}

const VIOL: string[] = []
const viol = (kind: string, s: S, lbl: string) => { if (VIOL.length < 50) VIOL.push(`${kind} — ${lbl} | ${key(s)}`) }

function transitions(s: S): S[] {
  const out: S[] = []
  const add = (t: S | null) => { if (t !== null) out.push(norm(t)) }
  // ---- 사람(웹) ----
  add(s.tag ? cancel({ ...s, tag: false }) : issue({ ...s, tag: true }))
  if (s.dst === 'none' && s.ord !== 'claimed' && s.ord !== 'reported' && s.ord !== 'approved') {
    for (const m of ['auto', 'review', 'human'] as const) if (m !== s.mode) add({ ...s, mode: m })
  }
  const btn = designButtons(item(s), activeOf(s))
  if (btn.includes('accept')) add({ ...s, dst: 'accepted', cs: 'build' })
  if (btn.includes('confirm')) {
    const t: S = { ...s, stage: 'dd', dst: 'accepted', pct: mx(s.pct, 'dd') }
    if (t.pct < s.pct) viol('I6 실적 역행', s, '설계 확정')
    add(t)
  }
  if (btn.includes('reopen')) add(reopen(s))
  if (s.ord === 'reported') {
    add({ ...s, ord: 'approved', stage: 'xx', pct: 100 })
    add({ ...s, ord: 'claimed', stage: 'ip', pct: CRED.rw, rw: true, hbph: 'work', hbage: 1, runner: null, rage: 0 })
  }
  if (s.ord === 'approved') {
    add({ ...s, ord: 'claimed', stage: 'ip', pct: CRED.rw, rw: true, hbph: 'work', hbage: 1, runner: null, rage: 0 })
    add({ ...s, ord: 'reported', stage: 'im', pct: 80 })
  }
  add({ ...s, hd: !s.hd })
  if (!s.tag && s.ord !== 'claimed' && s.ord !== 'reported') {  // 사람의 단계 지정(dd 는 없다)·수기 실적
    for (const st of ['as', 'ds', 'ip', 'im', 'xx']) add({ ...s, stage: st, pct: CRED[st] })
    if (s.pct !== 100) add({ ...s, pct: 100 })
  }
  // ---- 사람(CLI) ----
  if (s.ord === 'claimed' && canRelease({ stage: s.stage }, order(s)) === null) {
    add({ ...s, ord: 'ready', stage: 'as', pct: 0, cs: null, runner: null, rage: 0, hbph: null, hbage: 0, pend: false, rw: false, wA: null, wB: null })
  }
  const nlive = (s.wA !== null ? 1 : 0) + (s.wB !== null ? 1 : 0)
  for (const x of PCS) {
    if (w(s, x) !== null || nlive >= MAXW) continue
    if (s.ord === 'ready') {
      for (const sc of ['full', 'design', 'build'] as const) {
        if ((sc === 'design' || sc === 'full') && s.hd) continue   // 6.3·L5 claim 전 확인 → skipped
        if (sc === 'build' && !s.hd) continue
        if (canClaim(item(s), order(s).designState, sc, sc === 'full' && s.preds !== 'met') === null) add(claim(s, sc, x, 'H'))
      }
    } else if (s.ord === 'claimed' && mine(s, x, false)) {
      for (const t of resumeVariants(s, x, 'H')) add(t)
    }
  }
  if (s.ord === 'claimed') {
    for (const x of PCS) {
      if (!reportOk(s, humanLabel(x))) continue
      if (unapproved(s)) viol('I4 완료 보고(미승인 설계)', s, `수동 done@${x}`)
      if (s.wA?.step === 1 || s.wB?.step === 1) viol('I5 완료 보고(워커가 구현 중)', s, `수동 done@${x}`)
      add({ ...s, ord: 'reported', stage: 'im', pct: mx(s.pct, 'im'), runner: null, rage: 0, rw: false })
    }
  }
  // ---- 환경 ----
  for (const p of ['met', 'ok', 'no'] as const) if (p !== s.preds) add({ ...s, preds: p })
  if (s.ord === 'claimed') {
    const live = s.wA !== null || s.wB !== null
    if (!live && s.hbage === 0 && s.hbph !== null) add({ ...s, hbage: 1 })
    if (s.runner !== null && s.rage === 0 && w(s, s.runner) === null) add({ ...s, rage: 1, hbage: live ? s.hbage : 1 })
  }
  if (s.excl === 'temp') add({ ...s, excl: null })
  // ---- 팀장(PC A 고정) ----
  if (s.excl === null && w(s, LEAD) === null && nlive < MAXW) {
    const a = action(s)
    if (s.ord === 'ready' && (a === 'full' || a === 'design' || a === 'build') && mine(s, LEAD, true)) {
      if (a === 'build' && s.mode === 'human' && !s.hd) add(reopen(s))           // 6.2 띄우기 전 검사
      else if ((a === 'design' || a === 'full') && s.hd) add({ ...s, excl: 'temp' })  // 6.2·L5 사람 초안 → 멈춤(30분)
      else if (wt(s, LEAD)) add({ ...s, excl: 'perm' })                          // worktree add 실패
      else {
        const r = canClaim(item(s), order(s).designState, a, a === 'full' && s.preds !== 'met')
        if (r !== null) { viol('I1 claim 거부', s, `팀장 action=${a} → ${r.code}`); add({ ...s, excl: 'temp' }) }
        else add(claim(s, a, LEAD, 'L'))
      }
    } else if (s.ord === 'claimed' && mine(s, LEAD, true)) {
      if (a === 'skip') {
        const row2 = geIp(s.stage) || workerAlive(order(s), NOW)
        if (row2 && wt(s, LEAD) && resOf(s, LEAD) === 'diedL') for (const t of resumeVariants(s, LEAD, 'L')) add(t)
      } else if (a === 'full' || a === 'design' || a === 'build') {
        if (wscope(s) !== a) viol('I1 범위 불일치', s, `팀장 action=${a} 워커 ${wscope(s)}`)
        for (const t of resumeVariants(s, LEAD, 'L')) add(t)
      }
    }
  }
  if (s.pend && s.ord === 'claimed' && s.dst === 'none' && wt(s, LEAD) && w(s, LEAD) === null) {  // 6.3 끝나지 않은 멈춤 이어받기
    const t = designDone(s)
    if (t !== null) add(setw(t, LEAD, { wt: false }))
  }
  // ---- 워커 ----
  for (const x of PCS) {
    const wx = w(s, x)
    if (wx === null) continue
    const { sc, step, own } = wx
    if (s.ord === 'cancelled') { add(endWorker(s, x, 'result', own)); continue }                    // exit 10
    if (s.ord !== 'claimed') { add(endWorker(s, x, 'result', own, { wt: false })); continue }       // Y7
    add(endWorker(s, x, own === 'L' ? 'diedL' : 'diedH', own))                                        // 결과 없이 죽음
    if (!runnerFree(order(s), workerLabel(x), NOW)) { add(endWorker(s, x, 'result', own)); continue } // heartbeat 409 runner_active(Y1)
    if (sc === 'design') {
      if ((s.stage === 'ds' || s.stage === 'dd') && (s.dst === 'none' || s.dst === 'review')) {
        add(endWorker(designDone(s)!, x, 'result', own, { wt: false }))                                // 설계만 멈춤
        if (!s.pend) {
          add(endWorker(s, x, 'result', own, { excl: 'temp' }))                                        // push 실패 → skipped(Y11)
          add(endWorker({ ...s, pend: true }, x, 'result', own))                                       // design-done 네트워크 실패
        }
      }
      continue
    }
    if (step === 0) {
      if (sc === 'build' && s.stage === 'dd') {
        add(endWorker(s, x, 'result', own, { excl: 'temp' }))                                          // fetch 실패 → skipped(Y11)
        const ro = reopen(s)
        if (ro !== null && ((s.mode === 'human' && !s.hd) || (s.mode !== 'human' && s.dst === 'accepted'))) {
          add(endWorker(ro, x, 'result', own, { wt: false }))                                          // 게이트 불통·선행 계약 바뀜
        }
      }
      if ((sc === 'build' || sc === 'full' || sc === 'legacy') && geIp(s.stage)) add(endWorker(s, x, 'result', own, { excl: 'perm' }))
      const r = canBuildStart(item(s), order(s), sc, workerLabel(x), NOW)
      if (r === null) {
        let t: S = s
        if (s.stage === 'ds' || s.stage === 'dd') t = { ...t, stage: 'ip', pct: mx(s.pct, 'ip') }
        if (t.pct < s.pct) viol('I6 실적 역행', s, 'build-start')
        if (unapproved(s)) viol('I4 build-start 통과(미승인 설계)', s, `워커@${x} ${sc}`)
        if (w(s, other(x))?.step === 1) viol('I5 build-start 통과(다른 PC 워커가 구현 중)', s, `워커@${x} ${sc}`)
        add(setw({ ...t, runner: x, rage: 0 }, x, { w: { sc, step: 1, own } }))
      } else if (r.status === 403) add(endWorker(designDone(s) ?? s, x, 'result', own))              // 선행 대기 멈춤
      else add(endWorker(s, x, 'result', own, { excl: 'temp', wt: false }))                            // exit 11·12 → skipped
    } else {
      if (reportOk(s, workerLabel(x))) {
        if (unapproved(s)) viol('I4 완료 보고(미승인 설계)', s, `워커@${x} ${sc}`)
        if (w(s, other(x))?.step === 1) viol('I5 완료 보고(다른 PC 워커도 구현 중)', s, `워커@${x} ${sc}`)
        add(endWorker({ ...s, ord: 'reported', stage: 'im', pct: mx(s.pct, 'im'), runner: null, rage: 0, rw: false }, x, 'result', own))
      }
      add(endWorker(s, x, 'result', own, { excl: 'perm' }))                                            // 설계 변경 필요·게이트 불통
    }
  }
  return out
}

function explore() {
  const ids = new Map<string, number>()
  const states: S[] = []
  const succ: number[][] = []
  const intern = (s: S) => {
    const k = key(s)
    let id = ids.get(k)
    if (id === undefined) { id = states.length; ids.set(k, id); states.push(s); succ.push([]) }
    return id
  }
  for (const mode of ['auto', 'review', 'human'] as const) for (const ord of ['none', 'ready'] as const) {
    intern({ mode, tag: false, ord, dst: 'none', cs: null, stage: 'as', pct: 0, rw: false, hbph: null, hbage: 0, runner: null, rage: 0,
      preds: 'met', hd: false, wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, excl: null, pend: false })
  }
  for (let h = 0; h < states.length; h++) {
    const arr = succ[h]
    for (const t of transitions(states[h])) arr.push(intern(t))
  }
  return { states, succ }
}

/** ① 도달 상태마다 판단(action·mine)이 낸 범위를 관문이 받아 주는가(스펙 5.1 ①). */
function staticChecks(states: readonly S[]): string[] {
  const bad: string[] = []
  for (const s of states) {
    const a = action(s)
    if (a !== 'full' && a !== 'design' && a !== 'build') continue
    for (const x of PCS) {
      if (!mine(s, x, true)) continue
      if (s.ord === 'ready') {
        if ((a === 'build' && s.mode === 'human' && !s.hd) || ((a === 'design' || a === 'full') && s.hd)) continue
        const r = canClaim(item(s), order(s).designState, a, a === 'full' && s.preds !== 'met')
        if (r !== null) bad.push(`ready action=${a} → claim ${r.code} | ${key(s)}`)
      } else if (s.ord === 'claimed') {
        const ws = wscope(s)
        if (ws !== a) { bad.push(`claimed action=${a} ≠ 워커 범위 ${ws} | ${key(s)}`); continue }
        if (ws === 'design') { if (s.stage !== 'ds' && s.stage !== 'dd') bad.push(`claimed design 단계 ${s.stage} | ${key(s)}`); continue }
        const r = canBuildStart(item(s), order(s), ws, workerLabel(x), NOW)
        if (r !== null && !(r.status === 403 && a === 'full')) bad.push(`claimed action=${a} → build-start ${r.code} | ${key(s)}`)
      }
    }
  }
  return bad
}

/** ② 앞으로 갈 길 — 모든 전이를 허용했을 때 완료(approved)로 가지 못하는 상태(표식 없는 빈·취소 상태는 뺀다). */
function cannotFinish(states: readonly S[], succ: readonly number[][]): S[] {
  const n = states.length
  const start = new Int32Array(n + 1)
  for (const arr of succ) for (const t of arr) start[t + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const rev = new Int32Array(start[n])
  const fill = start.slice(0, n)
  for (let u = 0; u < n; u++) for (const t of succ[u]) rev[fill[t]++] = u
  const seen = new Uint8Array(n)
  const q: number[] = []
  for (let i = 0; i < n; i++) if (states[i].ord === 'approved') { seen[i] = 1; q.push(i) }
  for (let h = 0; h < q.length; h++) {
    const t = q[h]
    for (let j = start[t]; j < start[t + 1]; j++) { const u = rev[j]; if (!seen[u]) { seen[u] = 1; q.push(u) } }
  }
  return states.filter((s, i) => !seen[i] && !((s.ord === 'none' || s.ord === 'cancelled') && !s.tag))
}

/** ③ 화면 판정 탐침 — 6차 검토가 찾은 "화면 문구가 사실과 다른 도달 상태" 중 12절이 고친 넷. */
function screenProbes(states: readonly S[]): string[] {
  const bad: string[] = []
  for (const s of states) {
    const row = designScreen({ item: item(s), active: activeOf(s), lastReview: s.rw ? 'reject' : null, nowMs: NOW })?.row ?? 0
    const live = s.wA !== null || s.wB !== null
    const progressed = geIp(s.stage) || s.pct >= 100
    if (s.ord === 'ready' && s.tag && progressed && row === 0) bad.push(`8행 없음(진행된 항목의 ready) | ${key(s)}`)
    if (s.ord === 'claimed' && s.stage === 'ds' && s.dst === 'none' && s.preds === 'no' && !live && s.hbage === 1 && row !== 12) {
      bad.push(`L14 「선행 대기(설계 중 멈춤)」 없음 | ${key(s)}`)
    }
    if (row === 5 && live) bad.push(`L2 재작업 워커가 도는데 「재작업 대기」 | ${key(s)}`)
    if (row === 7 && s.tag && progressed) bad.push(`7행 「위임 안 됨」인데 표식·진행됨 | ${key(s)}`)
  }
  return bad
}

describe('설계 상태 모델 — 도달 상태 전수(스펙 5.1)', () => {
  it('판단↔관문 0 · 미승인 구현 0 · 두 구현자 0 · 실적 역행 0 · 완료로 가는 길 · 화면 문구', () => {
    const { states, succ } = explore()
    expect(states.length).toBeGreaterThan(100_000)
    expect(VIOL.slice(0, 5)).toEqual([])
    expect(staticChecks(states).slice(0, 5)).toEqual([])
    expect(cannotFinish(states, succ).slice(0, 5).map(key)).toEqual([])
    expect(screenProbes(states).slice(0, 5)).toEqual([])
    expect(states.filter(s => s.ord === 'claimed' && s.wA?.step === 1 && s.wB?.step === 1).length).toBe(0)
  }, 300_000)
})
```

- [ ] **Step 4: 모델 테스트를 돌린다**

Run: `npx vitest run tests/domain/design-gate-model.test.ts`
Expected: PASS(1 test). 도는 시간은 수십 초다. 실패하면 첫 위반 줄의 상태 키를 읽고, Step 2 의 Python 판에서 같은 전이가 어떻게 되는지 대조한다. 모델을 옮기다 생긴 차이면 이 파일을 고치고, 규칙 차이면 `designGate.ts` 를 고친 뒤 Task 1 표 테스트도 다시 돌린다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-09-26-design-state-model/model5.py tests/domain/design-gate-model.test.ts
git commit -m "test(design-state): 상태 공간 모델을 실제 designGate 함수로 옮겨 불변식을 전수 검사한다

판단↔관문 어긋남·미승인 구현·두 구현자·실적 역행이 도달 상태 전체에서 0 이고, 모든 상태가 완료로 갈 길이 있는지 본다.
계획 P16(살아 있는 다른 세션이 있으면 완료 보고 거부) 스위치를 Python 모델에도 더했다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 단계 `dd`·사람이 고를 수 있는 단계·크레딧 dd

**Files:**
- Modify: `src/lib/domain/stageLabels.ts`, `src/lib/domain/agentWork.ts:8-9`, `src/lib/domain/stageCredits.ts`
- Modify: `src/lib/i18n/dict/wbs.ts:235-240`, `src/lib/i18n/dict/wbs.en.ts:219-224`, `src/lib/i18n/dict/settings.ts:166-171`, `src/lib/i18n/dict/settings.en.ts:169-174`(그리고 두 settings 사전의 `settings.creditPvEvBuildStart` 옆)
- Modify: `src/components/settings/StageCreditSlider.tsx:24-60`, `src/components/wbs/shared.tsx:144-151`, `src/components/wbs/WbsAssigneeStagePanel.tsx:18-37`, `src/components/agent-hub/DelegationTable.tsx:458`, `src/components/agent-hub/labels.ts:79`, `src/app/actions/agentHub.ts:20,128,159`, `src/app/actions/wbsAssign.ts:9,340`, `src/lib/agent/wbsImport.ts:6,92`
- Test: `tests/domain/stage-labels.test.ts`, `tests/domain/stage-credits.test.ts`, `tests/domain/predecessor-reached.test.ts:26`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `STAGE_CODES = ['as','ds','dd','ip','im','xx']`, `STAGE_LABEL_KO.dd = '설계 완료'`
  - `HUMAN_STAGE_CODES = ['as','ds','ip','im','xx']`(사람의 set_stage·import 가 받는 단계 — dd 없음), `isHumanStageCode(v): v is HumanStageCode`
  - `STAGE_ORDER = ['as','ds','dd','ip','im','xx']`
  - `CREDIT_KEYS = ['as','ds','dd','ip','rw','im','xx']`, `DEFAULT_STAGE_CREDITS.default.dd = 20`, `creditForKey('dd', credits)` 는 표에 dd 가 없으면 `max(ds, min(20, ip-5))`
  - `EVENT_CREDIT` 에 `design_done: 'dd'`, `design_accept: 'dd'`

- [ ] **Step 1: 실패하는 테스트로 고친다**

`tests/domain/stage-labels.test.ts` 첫 `it` 과 i18n `it` 을 이렇게 바꾸고, 사람 단계 테스트를 더한다:

```ts
  it('코드는 as·ds·dd·ip·im·xx 여섯 — fp 없음, dd(설계 완료)는 ds 와 ip 사이(0108)', () => {
    expect([...STAGE_CODES]).toEqual(['as', 'ds', 'dd', 'ip', 'im', 'xx'])
    expect(isStageCode('dd')).toBe(true)
    expect(isStageCode('fp')).toBe(false)
    expect(isStageCode(null)).toBe(false)
  })
  it('i18n ko 사전과 같다', () => {
    expect(wbsKo['wbs.stageAs']).toBe(STAGE_LABEL_KO.as)
    expect(wbsKo['wbs.stageDs']).toBe(STAGE_LABEL_KO.ds)
    expect(wbsKo['wbs.stageDd']).toBe(STAGE_LABEL_KO.dd)
    expect(wbsKo['wbs.stageIp']).toBe(STAGE_LABEL_KO.ip)
    expect(wbsKo['wbs.stageIm']).toBe(STAGE_LABEL_KO.im)
    expect(wbsKo['wbs.stageXx']).toBe(STAGE_LABEL_KO.xx)
    expect(wbsKo['wbs.stageNoneOption']).toBe(STAGE_NONE_LABEL_KO)
  })
  it('사람이 고를 수 있는 단계에는 dd 가 없다 — dd 는 design_done·design_accept 로만 생긴다(스펙 7절)', () => {
    expect([...HUMAN_STAGE_CODES]).toEqual(['as', 'ds', 'ip', 'im', 'xx'])
    expect(isHumanStageCode('dd')).toBe(false)
    expect(isHumanStageCode('ds')).toBe(true)
    expect(stageLabelKo('dd')).toBe('설계 완료')
  })
```

import 줄에 `HUMAN_STAGE_CODES, isHumanStageCode` 를 더하고, 파일 끝 en 테스트에 `expect(wbsEn['wbs.stageDd']).toBe('Design done')` 을 더한다.

`tests/domain/predecessor-reached.test.ts:26` 을 `expect([...STAGE_ORDER]).toEqual(['as', 'ds', 'dd', 'ip', 'im', 'xx'])` 로 바꾼다.

`tests/domain/stage-credits.test.ts` 는 이렇게 고친다:
- 모든 표 리터럴에 `dd` 를 넣는다(예: `{ as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 }`).
- 키 순서 테스트: `expect([...CREDIT_KEYS]).toEqual(['as', 'ds', 'dd', 'ip', 'rw', 'im', 'xx'])`, 기본값 `{ as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 }`.
- "채운 ds 가 이웃 간격을 어기면 거부한다(ip 20 미만인 옛 표)" 테스트를 아래로 바꾼다(D18 — ds·dd 는 간격 규칙에서 빠진다):

```ts
  it('ds·dd 는 간격 규칙에서 빠진다 — ip 10 인 옛 표도 채운 값(ds 10·dd 10)으로 받는다(D18)', () => {
    expect(validateStageCredits({ default: { as: 0, ip: 10, rw: 50, im: 80, xx: 100 } }))
      .toEqual({ ok: true, credits: { default: { as: 0, ds: 10, dd: 10, ip: 10, rw: 50, im: 80, xx: 100 } } })
  })
  it('dd 가 없는 표는 min(20, ip-5) 로 채우되 ds 보다 작아지지 않는다(D18)', () => {
    expect(validateStageCredits({ default: { as: 0, ds: 10, ip: 30, rw: 50, im: 80, xx: 100 } }))
      .toEqual({ ok: true, credits: DEFAULT_STAGE_CREDITS })
    expect(validateStageCredits({ default: { as: 0, ds: 10, ip: 20, rw: 50, im: 80, xx: 100 } }))
      .toMatchObject({ ok: true, credits: { default: { dd: 15 } } })
    expect(validateStageCredits({ default: { as: 0, ds: 25, ip: 30, rw: 50, im: 80, xx: 100 } }))
      .toMatchObject({ ok: true, credits: { default: { dd: 25 } } })
  })
  it('as ≤ ds ≤ dd ≤ ip 를 어기면 거부한다', () => {
    expect(validateStageCredits({ default: { as: 0, ds: 20, dd: 15, ip: 30, rw: 50, im: 80, xx: 100 } })).toMatchObject({ ok: false })
    expect(validateStageCredits({ default: { as: 0, ds: 10, dd: 35, ip: 30, rw: 50, im: 80, xx: 100 } })).toMatchObject({ ok: false })
  })
```

- 거부 표 목록에서 `['ds 간격 10 미만', { as: 0, ds: 25, ip: 30, … }]` 행을 지운다(이제 유효하다). 나머지 행에는 `dd: 20` 을 넣는다(`'ds 가 정수 아님'` 행은 `dd: 20` 을 넣어도 ds 때문에 거부된다).
- 사건 매핑 테스트의 기대값에 `design_done: 'dd', design_accept: 'dd'` 를 더한다.
- `creditForKey` 에 dd 테스트를 더한다:

```ts
  it('dd 가 없는 옛 표에서 dd 는 max(ds, min(20, ip-5)) — RPC 채움과 같은 식(P12)', () => {
    const old = { default: { as: 0, ds: 10, ip: 40, rw: 50, im: 80, xx: 100 } } as unknown as Parameters<typeof creditForKey>[1]
    expect(creditForKey('dd', old)).toBe(20)
    expect(creditForKey('dd', { default: { as: 0, ds: 10, ip: 20, rw: 50, im: 80, xx: 100 } } as never)).toBe(15)
    expect(creditForKey('dd', null)).toBe(20)
  })
```

- `clampCredit` 테스트의 표를 `{ as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 }` 로 바꾸고 기대값을 새 규칙으로 고친다:

```ts
  it('5 단위로 스냅하고, 핵심 사슬(as·ip·rw·im·xx)은 10 간격, ds·dd 는 순서만 지킨다(D18)', () => {
    expect(clampCredit(42, 'ip', t)).toBe(40)   // rw(50) - 10
    expect(clampCredit(3, 'ip', t)).toBe(20)    // max(as+10, dd)
    expect(clampCredit(27, 'ds', t)).toBe(20)   // dd 이하
    expect(clampCredit(-3, 'ds', t)).toBe(0)    // as 이상(간격 없음)
    expect(clampCredit(40, 'dd', t)).toBe(30)   // ip 이하
    expect(clampCredit(5, 'dd', t)).toBe(10)    // ds 이상
    expect(clampCredit(18, 'as', t)).toBe(10)   // min(ds, ip-10)
    expect(clampCredit(95, 'im', t)).toBe(90)   // xx(100) - 10
  })
```

- `normalizeStageCredits` 테스트: ds·dd 둘 다 없으면 `{ as: 0, ds: 10, dd: 20, ip: 40, rw: 50, im: 80, xx: 100 }`, ds 만 있으면(15) dd 는 `max(15, min(20, 30-5))` = 20.

- [ ] **Step 2: 테스트가 실패하는지 본다**

Run: `npx vitest run tests/domain/stage-labels.test.ts tests/domain/stage-credits.test.ts tests/domain/predecessor-reached.test.ts`
Expected: FAIL(dd 없음, HUMAN_STAGE_CODES 없음 등)

- [ ] **Step 3: 도메인과 사전을 고친다**

`src/lib/domain/stageLabels.ts` 전체:

```ts
/**
 * 단계 코드·라벨 정본(스펙 2026-09-15 §3.2) — 한 벌만. fp 는 0096 에서 ip 로 이관돼 어휘에 없다.
 * ds(설계 중)는 0107, dd(설계 완료)는 0108 에서 들어왔다(설계 상태 스펙 D6) — 진행 중 단계(ds·ip) 뒤에 끝남·대기 단계(dd·im)가 짝을 이룬다.
 * i18n ko 사전(wbs.stage*)은 이 값과 같아야 한다(tests/domain/stage-labels.test.ts 가 고정).
 * 허브 표·대기 사유 문구처럼 i18n 을 쓰지 않는 서버 문구는 이 모듈을 쓴다.
 */
export const STAGE_CODES = ['as', 'ds', 'dd', 'ip', 'im', 'xx'] as const
export type StageCode = (typeof STAGE_CODES)[number]

/** 사람이 단계 선택(set_stage)·import 로 넣을 수 있는 단계 — dd 는 design_done·design_accept 로만 생긴다(스펙 7절). */
export const HUMAN_STAGE_CODES = ['as', 'ds', 'ip', 'im', 'xx'] as const
export type HumanStageCode = (typeof HUMAN_STAGE_CODES)[number]

export const STAGE_LABEL_KO: Readonly<Record<StageCode, string>> = {
  as: '할당됨', ds: '설계 중', dd: '설계 완료', ip: '작업 중', im: '검수 대기', xx: '완료',
}
export const STAGE_NONE_LABEL_KO = '미착수'

export function isStageCode(v: unknown): v is StageCode {
  return typeof v === 'string' && (STAGE_CODES as readonly string[]).includes(v)
}
export function isHumanStageCode(v: unknown): v is HumanStageCode {
  return typeof v === 'string' && (HUMAN_STAGE_CODES as readonly string[]).includes(v)
}

/** null → 미착수, 모르는 코드 → 코드 그대로(표시 = 로깅 — 감추면 "단계 없음"으로 위장한다). */
export function stageLabelKo(stage: string | null): string {
  if (stage === null) return STAGE_NONE_LABEL_KO
  return isStageCode(stage) ? STAGE_LABEL_KO[stage] : stage
}
```

`src/lib/domain/agentWork.ts:8-9`:

```ts
/** WBS Task 단계 순서(스펙 2026-09-15 §3.2) — fp 는 0096 에서 ip 로 이관됐다. ds(설계 중)는 0107, dd(설계 완료)는 0108 에서 as 와 ip 사이. */
export const STAGE_ORDER = ['as', 'ds', 'dd', 'ip', 'im', 'xx'] as const
```

`src/lib/domain/stageCredits.ts` 를 아래로 바꾼다(주석·함수 이름은 유지하고 dd·간격 규칙만 바뀐다):

```ts
/**
 * 실적 크레딧 표(스펙 2026-09-15 §3.3·§3.4) — 순수 함수. 값의 정본은 DB(project_settings.stage_credits)이고
 * 전이 때 실제 계산은 RPC apply_workflow_event 가 한다. 여기 기본값·규칙은 그 SQL 과 같아야 한다
 * (tests/migrations/0108-design-state.test.ts 가 SQL 상수와 비교한다).
 * ds(설계 중)는 0107, dd(설계 완료)는 0108 에서 들어왔다. ds·dd 는 간격 규칙에서 빠지고 as ≤ ds ≤ dd ≤ ip 만 지킨다(설계 상태 스펙 D18).
 */
export const CREDIT_KEYS = ['as', 'ds', 'dd', 'ip', 'rw', 'im', 'xx'] as const
export type CreditKey = (typeof CREDIT_KEYS)[number]
export type CreditTable = Record<CreditKey, number>
/**
 * 표는 `default` 하나뿐이다(2026-09-16 결정). 카테고리별 `if`·`doc` 표를 없앴다 — 쓰는 프로젝트가 거의 없는데
 * 설정 화면에는 모든 프로젝트에 슬라이더가 세 벌씩 쌓였다. 항목의 `credit_key`(0089) 는 남지만 전이 계산에 쓰지 않는다.
 */
export type StageCredits = { default: CreditTable }

export const DEFAULT_STAGE_CREDITS: StageCredits = {
  default: { as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 },
}
export const CREDIT_STEP = 5
export const CREDIT_GAP = 10
/** 10 간격을 지키는 핵심 사슬. ds·dd 는 여기서 빠진다(D18). */
const CORE_KEYS: readonly CreditKey[] = ['as', 'ip', 'rw', 'im', 'xx']

/**
 * 사건 → 크레딧 키(§3.4). 승인은 xx(=100 고정), 반려·재작업은 rw(결과 단계는 ip).
 * claim 은 종전(플래그 없음) 값이다 — 설계 선행·설계 범위 claim 은 ds, 구현부터(build) claim 은 dd 를 쓴다(0107·0108).
 * build_start 는 ds·dd 일 때만 ip 로 옮긴다(이미 ip 이상이면 무변경). design_done·design_accept(확정)는 dd.
 */
export type CreditEvent = 'assign' | 'claim' | 'build_start' | 'design_done' | 'design_accept' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release'
export const EVENT_CREDIT: Readonly<Record<CreditEvent, CreditKey>> = {
  assign: 'as', claim: 'ip', build_start: 'ip', design_done: 'dd', design_accept: 'dd', report_completion: 'im', approve: 'xx',
  unapprove: 'im', reject: 'rw', rework: 'rw', release: 'as',
}
/** 설계 선행 claim 의 크레딧 키. */
export const DESIGN_FIRST_CLAIM_CREDIT: CreditKey = 'ds'

/**
 * 0107·0108 이전에 저장된 표에는 ds·dd 가 없다. ds 는 기본값(10), dd 는 max(ds, min(20, ip-5)) 로 채운다(D18) —
 * RPC 가 표에 없는 키를 채우는 식과 같아 화면과 실제 전이가 어긋나지 않는다.
 */
function fillOptional(o: Record<string, unknown>): Record<string, unknown> {
  const t = { ...o }
  if (t.ds === undefined) t.ds = DEFAULT_STAGE_CREDITS.default.ds
  if (t.dd === undefined && typeof t.ds === 'number' && typeof t.ip === 'number') t.dd = Math.max(t.ds, Math.min(20, t.ip - 5))
  return t
}

type TableResult = { ok: true; table: CreditTable } | { ok: false; error: string }

function validateTable(name: string, raw: unknown): TableResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: `${name} 표는 객체여야 합니다.` }
  for (const k of Object.keys(raw)) {
    if (!(CREDIT_KEYS as readonly string[]).includes(k)) return { ok: false, error: `${name} 표에 모르는 키가 있습니다: ${k}` }
  }
  const o = fillOptional(raw as Record<string, unknown>)
  const t: Partial<CreditTable> = {}
  for (const k of CREDIT_KEYS) {
    const v = o[k]
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, error: `${name}.${k} 는 정수여야 합니다.` }
    if (v < 0 || v > 100) return { ok: false, error: `${name}.${k} 는 0~100 이어야 합니다.` }
    if (v % CREDIT_STEP !== 0) return { ok: false, error: `${name}.${k} 는 ${CREDIT_STEP} 단위여야 합니다.` }
    t[k] = v
  }
  const table = t as CreditTable
  if (table.xx !== 100) return { ok: false, error: `${name}.xx 는 100 이어야 합니다 — 완료는 WBS 완료 판정과 같다.` }
  for (let i = 1; i < CORE_KEYS.length; i++) {
    const prevKey = CORE_KEYS[i - 1], curKey = CORE_KEYS[i]
    if (table[curKey] - table[prevKey] < CREDIT_GAP) {
      return { ok: false, error: `${name}: ${prevKey} < ${curKey} 이고 간격이 ${CREDIT_GAP} 이상이어야 합니다.` }
    }
  }
  if (!(table.as <= table.ds && table.ds <= table.dd && table.dd <= table.ip)) {
    return { ok: false, error: `${name}: as ≤ ds ≤ dd ≤ ip 여야 합니다.` }
  }
  return { ok: true, table }
}

/** 저장 전 검증의 정본 — 서버 액션(updateStageCredits)과 슬라이더가 같이 쓴다. */
export function validateStageCredits(raw: unknown): { ok: true; credits: StageCredits } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: '크레딧 표는 객체여야 합니다.' }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (k !== 'default') return { ok: false, error: `모르는 카테고리입니다: ${k}` }
  }
  if (o.default === undefined) return { ok: false, error: 'default 표는 필수입니다.' }
  const v = validateTable('default', o.default)
  if (!v.ok) return v
  return { ok: true, credits: { default: v.table } }
}

/** credits null → 코드 기본값. xx 는 100 고정. 표에 없는 ds·dd 는 fillOptional 과 같은 식(RPC 와 같다). */
export function creditForKey(key: CreditKey, credits: StageCredits | null): number {
  if (key === 'xx') return 100
  const table = fillOptional({ ...((credits ?? DEFAULT_STAGE_CREDITS).default ?? DEFAULT_STAGE_CREDITS.default) })
  const v = table[key]
  return typeof v === 'number' ? v : DEFAULT_STAGE_CREDITS.default[key]
}

/**
 * 저장된 표(project_settings.stage_credits) 읽기 — 없는 선택 키(ds·dd)를 채운다. 검증은 하지 않는다
 * (값의 정본은 DB 이고 저장 때 검증했다). null 은 null(코드 기본값 사용).
 */
export function normalizeStageCredits(raw: StageCredits | null | undefined): StageCredits | null {
  if (!raw || typeof raw !== 'object' || !raw.default || typeof raw.default !== 'object') return raw ?? null
  return { ...raw, default: fillOptional(raw.default as unknown as Record<string, unknown>) as CreditTable }
}

/** 슬라이더 핸들 클램프 — 5 단위 스냅. 핵심 사슬은 이웃과 10 간격, ds·dd 는 as ≤ ds ≤ dd ≤ ip 만(D18). xx 는 100 고정. */
export function clampCredit(raw: number, key: CreditKey, table: CreditTable): number {
  if (key === 'xx') return 100
  const snapped = Number.isFinite(raw) ? Math.round(raw / CREDIT_STEP) * CREDIT_STEP : table[key]
  const bounds: Record<Exclude<CreditKey, 'xx'>, [number, number]> = {
    as: [0, Math.min(table.ds, table.ip - CREDIT_GAP)],
    ds: [table.as, table.dd],
    dd: [table.ds, table.ip],
    ip: [Math.max(table.as + CREDIT_GAP, table.dd), table.rw - CREDIT_GAP],
    rw: [table.ip + CREDIT_GAP, table.im - CREDIT_GAP],
    im: [table.rw + CREDIT_GAP, table.xx - CREDIT_GAP],
  }
  const [lo, hi] = bounds[key]
  return Math.max(lo, Math.min(snapped, hi))
}
```

`src/lib/i18n/dict/wbs.ts` 의 `'wbs.stageDs': '설계 중',` 다음 줄에 `'wbs.stageDd': '설계 완료',` 를, `wbs.en.ts` 의 `'wbs.stageDs': 'Designing',` 다음 줄에 `'wbs.stageDd': 'Design done',` 을 더한다.
`src/lib/i18n/dict/settings.ts` 의 `'settings.creditKey_ds': '설계 중',` 다음에 `'settings.creditKey_dd': '설계 완료',` 를, `settings.en.ts` 의 `'settings.creditKey_ds': 'Designing',` 다음에 `'settings.creditKey_dd': 'Design done',` 을 더한다. 두 settings 사전에서 `settings.creditPvEvBuildStart` 키를 찾아 그 앞 줄에 `'settings.creditPvEvDesignDone': '설계 완료(검토·확정 뒤 구현)',`(en: `'Design done (build after review or confirm)',`)를 더한다.

- [ ] **Step 4: 화면·액션의 단계 목록을 고친다**

`src/components/settings/StageCreditSlider.tsx` — `KEY_LABEL`·`DOT_CLS`·`RING_CLS` 에 dd 를 더하고 미리보기 흐름에 설계 완료를 끼운다:

```ts
const KEY_LABEL: Record<CreditKey, DictKey> = {
  as: 'settings.creditKey_as', ds: 'settings.creditKey_ds', dd: 'settings.creditKey_dd', ip: 'settings.creditKey_ip',
  rw: 'settings.creditKey_rw', im: 'settings.creditKey_im', xx: 'settings.creditKey_xx',
}
const DOT_CLS: Record<CreditKey, string> = {
  as: 'bg-pending', ds: 'bg-accent-secondary', dd: 'bg-accent-secondary/60', ip: 'bg-progress', rw: 'bg-delayed', im: 'bg-brand', xx: 'bg-done',
}
const RING_CLS: Record<CreditKey, string> = {
  as: 'border-pending', ds: 'border-accent-secondary', dd: 'border-accent-secondary/60', ip: 'border-progress', rw: 'border-delayed',
  im: 'border-brand', xx: 'border-done',
}
```

`FLOW` 배열의 `settings.creditPvEvClaim` 행 다음에 한 줄을 더한다:

```ts
  { ev: 'settings.creditPvEvDesignDone', order: 'claimed', stage: 'dd', cur: 'dd' },
```

`src/components/wbs/shared.tsx` 의 `STAGE_META` 에서 `ds:` 줄 다음에:

```ts
  // dd(설계 완료, 0108) — 설계 중과 같은 계열을 진하게. 끝남·대기 단계라 작업 중(ip)과 구별된다.
  dd: { key: 'wbs.stageDd', cls: 'bg-accent-secondary/30 text-accent-secondary' },
```

`src/components/wbs/WbsAssigneeStagePanel.tsx` — import 를 `import { HUMAN_STAGE_CODES, type StageCode } from '@/lib/domain/stageLabels'` 로 바꾸고, 선택지 목록을 `const STAGES: readonly Stage[] = HUMAN_STAGE_CODES` 로 바꾼다. 같은 파일의 `STAGE_KEYS`(단계 → 사전 키 표)에 `dd: 'wbs.stageDd'` 를 더한다(읽기 전용 표시는 dd 도 보여야 한다).

`src/components/agent-hub/labels.ts:79` 를 `export { STAGE_CODES, HUMAN_STAGE_CODES } from '@/lib/domain/stageLabels'` 로 바꾸고, `DelegationTable.tsx` 의 import 목록에 `HUMAN_STAGE_CODES` 를 더한 뒤 458행의 `STAGE_CODES.map(` 을 `HUMAN_STAGE_CODES.map(` 으로 바꾼다.

`src/app/actions/agentHub.ts` — 20행 import 를 `import { HUMAN_STAGE_CODES, type StageCode } from '@/lib/domain/stageLabels'`, 128행을 `const STAGE_CODES: ReadonlySet<string> = new Set(HUMAN_STAGE_CODES)` 로 바꾼다(허브의 단계 선택도 dd 를 받지 않는다).

`src/app/actions/wbsAssign.ts` — 9행 import 에 `isHumanStageCode` 를 더하고 340행을 바꾼다:

```ts
  if (stage !== null && !isHumanStageCode(stage)) return { ok: false, error: '허용되지 않는 단계입니다. 설계 완료(dd)는 「설계 확정」·「설계 승인」으로만 생깁니다.' }
```

`src/lib/agent/wbsImport.ts` — 6행 import 를 `HUMAN_STAGE_CODES` 로, 92행을 `const STAGES: ReadonlySet<string> = new Set(HUMAN_STAGE_CODES)` 로 바꾼다.

- [ ] **Step 5: 테스트와 타입 검사**

Run: `npx vitest run tests/domain/stage-labels.test.ts tests/domain/stage-credits.test.ts tests/domain/predecessor-reached.test.ts tests/components tests/ui tests/actions tests/agent && npx tsc --noEmit -p .`
Expected: PASS, 타입 오류 없음. `Record<CreditKey, …>`·`Record<StageCode, …>` 를 쓰는 곳이 더 있으면 tsc 가 알려 준다 — 그 표에 dd 항목을 더한다. `tests/migrations/0107-wbs-design-stage.test.ts` 의 "단계 CHECK 가 도메인 STAGE_CODES 와 같다"·"set_stage 허용 값" 두 테스트는 0107 파일이 dd 없이 고정돼 있어 이제 실패한다 — 두 테스트의 `STAGE_CODES` 를 0107 시점 목록 리터럴 `['as','ds','ip','im','xx']` 로 바꿔 0107 파일 자체를 고정하는 테스트로 남긴다(0108 대조는 Task 4 가 한다).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/stageLabels.ts src/lib/domain/agentWork.ts src/lib/domain/stageCredits.ts \
  src/lib/i18n/dict/wbs.ts src/lib/i18n/dict/wbs.en.ts src/lib/i18n/dict/settings.ts src/lib/i18n/dict/settings.en.ts \
  src/components/settings/StageCreditSlider.tsx src/components/wbs/shared.tsx src/components/wbs/WbsAssigneeStagePanel.tsx \
  src/components/agent-hub/labels.ts src/components/agent-hub/DelegationTable.tsx src/app/actions/agentHub.ts \
  src/app/actions/wbsAssign.ts src/lib/agent/wbsImport.ts \
  tests/domain/stage-labels.test.ts tests/domain/stage-credits.test.ts tests/domain/predecessor-reached.test.ts \
  tests/migrations/0107-wbs-design-stage.test.ts
git commit -m "feat(design-state): 단계 dd(설계 완료)와 크레딧 dd 를 더하고, 사람의 단계 선택에서는 dd 를 뺀다

dd 는 design_done·design_accept 로만 생긴다(스펙 7절). 크레딧 dd 는 20, 옛 표는 max(ds, min(20, ip-5)) 로 채우고
ds·dd 는 간격 규칙에서 빠진다(D18).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
