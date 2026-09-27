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
- **임시 파일:** 리허설 SQL·검사 출력은 실행하는 세션의 scratchpad 폴더에 둔다. 계획서는 그 폴더를 `<SCRATCH>` 로 적는다(리포 안에 두지 않는다).

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
## Task 4: 마이그레이션 0108 — 칸·단계 dd·전이 RPC·데이터 이전

**Files:**
- Create: `supabase/migrations/0108_design_state.sql`
- Create: `supabase/migrations/0108_design_state_rollback.sql`
- Test: `tests/migrations/0108-design-state.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `DESIGN_MODES`·`DESIGN_STATES`·`CLAIM_SCOPES`, Task 3 의 `STAGE_CODES`·`HUMAN_STAGE_CODES`·`DEFAULT_STAGE_CREDITS`
- Produces(Task 6 이후가 쓴다):
  - 칸: `wbs_items.design_mode text not null default 'auto'`(CHECK auto·review·human), `agent_work_orders.design_state`(null·review·accepted)·`claim_scope`(null·full·design·build·legacy)·`design_note`(500자)·`runner`·`runner_seen_at timestamptz`
  - RPC `apply_workflow_event(p_event, p_actor, p_item_id, p_order_id, p_stage, p_agent, p_agent_user_id, p_scope text, p_cas jsonb, p_note text, p_mode text, p_runner text)` — 새 사건 `design_done`·`design_accept`·`design_reopen`·`cancel`·`set_design_mode`. 새 실패 사유 `bad_scope`·`bad_mode`·`design_gate`·`design_mode_locked`. 응답에 `prev_status`·`design_state` 를 더한다.
  - `p_cas` 가 받는 키: `design_state`·`design_mode`·`claim_scope`·`runner`·`runner_seen_at`(값이 다르면 `conflict`)

**마이그레이션을 이 커밋 하나에만 담는다(코드와 섞지 않는다). 이 Task 는 파일을 쓰고 대조 테스트만 한다 — 스테이징 적용은 Task 5.**

- [ ] **Step 1: 실패하는 대조 테스트를 쓴다**

`tests/migrations/0108-design-state.test.ts`:

```ts
// tests/migrations/0108-design-state.test.ts — 설계 상태(스펙 2026-09-26-design-state-dev-auto-design.md, 계획 P1~P3·P12·P13).
// SQL 이 도메인(designGate·stageLabels·stageCredits)과 같은지, 전이 RPC 가 0107 본문에서 정해진 곳만 바뀌었는지 대조한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLAIM_SCOPES, DESIGN_MODES, DESIGN_STATES } from '@/lib/domain/designGate'
import { HUMAN_STAGE_CODES, STAGE_CODES } from '@/lib/domain/stageLabels'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const s = () => readFileSync('supabase/migrations/0108_design_state.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0108_design_state_rollback.sql', 'utf8')
const prev = () => readFileSync('supabase/migrations/0107_wbs_design_stage.sql', 'utf8')
const fnOf = (sql: string) => sql.split('create or replace function public.apply_workflow_event')[1]?.split('$$;')[0] ?? ''
const fn = () => fnOf(s())
const q = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(',')
const NEW_SIG = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text)'
const OLD_SIG = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)'

describe('0108 칸과 CHECK', () => {
  it('단계 CHECK 가 도메인 STAGE_CODES 와 같다(dd 포함)', () => {
    expect(s()).toContain(`add constraint wbs_items_stage_check check (stage in (${q(STAGE_CODES)}))`)
  })
  it('설계 방식·설계 상태·claim 범위 CHECK 가 designGate 상수와 같다', () => {
    expect(s()).toContain(`check (design_mode in (${q(DESIGN_MODES)}))`)
    expect(s()).toContain(`check (design_state is null or design_state in (${q(DESIGN_STATES)}))`)
    expect(s()).toContain(`check (claim_scope is null or claim_scope in (${q(CLAIM_SCOPES)}))`)
  })
  it('design_mode 는 NOT NULL DEFAULT auto(D17)', () => {
    expect(s()).toContain("add column if not exists design_mode text not null default 'auto'")
  })
})

describe('0108 전이 RPC', () => {
  it('옛 7인자 함수를 지우고 12인자로 만들며 service_role 만 실행한다(P2)', () => {
    const b = s()
    expect(b.indexOf(`drop function if exists ${OLD_SIG};`)).toBeGreaterThan(-1)
    expect(b.indexOf(`drop function if exists ${OLD_SIG};`)).toBeLessThan(b.indexOf('create or replace function public.apply_workflow_event'))
    expect(b).toContain(`revoke all on function ${NEW_SIG} from public, anon, authenticated;`)
    expect(b).toContain(`grant execute on function ${NEW_SIG} to service_role;`)
    expect(b).toContain("notify pgrst, 'reload schema';")
  })
  it('SQL 기본 크레딧 상수가 코드 기본값과 같다(dd 20)', () => {
    const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(fn())
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(DEFAULT_STAGE_CREDITS)
  })
  it('사건 목록에 새 사건 다섯이 있고, 주문 사건에 넷이 든다', () => {
    const f = fn()
    const flat = (x: string) => x.replace(/\s+/g, ' ')
    expect(f).toContain("'design_done','design_accept','design_reopen','cancel','set_design_mode'")
    expect(flat(f)).toContain("v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start', 'design_done','design_accept','design_reopen','cancel');")
  })
  it('완료 보고는 검토 대기면·리프가 ip 가 아니면 design_gate(Y2·W23), 반납은 D13 조건이면 design_gate', () => {
    const f = fn()
    expect(f).toContain("if p_event = 'report_completion' and (v_order_design_state = 'review'")
    expect(f).toContain("or (v_item_found and v_is_leaf and v_old_stage is distinct from 'ip')) then")
    expect(f).toContain("if p_event = 'release' and (v_order_design_state is not null")
    expect(f).toContain("or (v_order_claim_scope = 'design' and v_item_found and v_old_stage in ('ds','dd'))) then")
  })
  it('사람의 set_stage 는 dd 를 받지 않는다(HUMAN_STAGE_CODES)', () => {
    expect(fn()).toContain(`if p_stage is not null and p_stage not in (${q(HUMAN_STAGE_CODES)}) then`)
  })
  it('CAS 키 다섯(P1) — JSON null 은 "없음"과 비교된다', () => {
    const f = fn()
    for (const k of ['design_state', 'claim_scope', 'runner']) {
      expect(f).toContain(`(p_cas is not null and p_cas ? '${k}' and v_order_${k === 'runner' ? 'runner' : k} is distinct from (p_cas ->> '${k}'))`)
    }
    expect(f).toContain("(p_cas is not null and p_cas ? 'runner_seen_at' and v_order_runner_seen is distinct from (p_cas ->> 'runner_seen_at')::timestamptz)")
    expect(f).toContain("if v_is_order_event and p_cas is not null and p_cas ? 'design_mode' and v_item_found")
  })
  it('claim 은 범위로 단계를 정하고 claim_scope·runner 를 적는다(D8·D25)', () => {
    const f = fn()
    expect(f).toContain('claim_scope = v_scope, runner = coalesce(p_runner, p_agent), runner_seen_at = v_now')
    expect(f).toContain("if v_scope in ('full','design') then v_new_stage := 'ds'; v_credit_key := 'ds';")
    expect(f).toContain("elsif v_scope = 'build' then v_new_stage := 'dd'; v_credit_key := 'dd';")
    expect(f).toContain("else v_new_stage := case when p_stage = 'ds' then 'ds' else 'ip' end; v_credit_key := v_new_stage;")
  })
  it('build_start 는 ds·dd 에서만 ip, runner 를 호출자로 적는다', () => {
    const f = fn()
    expect(f).toContain("if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip'; v_keep_max := true;")
    expect(f).toContain('set runner = coalesce(p_runner, p_agent, runner), runner_seen_at = v_now, updated_at = v_now')
  })
  it('완료 보고·해제·취소는 runner 를 비운다', () => {
    const f = fn()
    expect(f).toContain("set status = 'reported', runner = null, runner_seen_at = null, updated_at = v_now")
    expect(f).toContain('claim_scope = null, runner = null, runner_seen_at = null,')
    expect(f).toContain("set status = 'cancelled', claimed_by = null, claimed_by_user_id = null, claimed_at = null,")
  })
  it('design_done — review 는 방식 review 이거나 claim_scope design 일 때, review 가 되면 runner 를 비운다', () => {
    const f = fn()
    expect(f).toContain("if v_order_design_state is null and (v_design_mode = 'review' or v_order_claim_scope = 'design') then v_new_design_state := 'review'; end if;")
    expect(f).toContain("heartbeat_phase = case when v_new_design_state = 'review' then 'wait_review' else 'wait_pred' end,")
  })
  it('design_accept ① claimed 는 claim_scope 를 build 로, ② ready 는 단계 dd·실적 dd', () => {
    const f = fn()
    expect(f).toContain("claim_scope = case when v_order_status = 'claimed' then 'build' else claim_scope end,")
    expect(f).toContain("if v_order_status = 'ready' then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true; end if;")
  })
  it('design_reopen — human 은 as·실적 as·claimed 면 ready 로, 그 밖은 review 로, 둘 다 runner 를 비운다(L9)', () => {
    const f = fn()
    expect(f).toContain("if v_design_mode = 'human' and v_order_design_state = 'accepted' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;")
    expect(f).toContain("set design_state = 'review', design_note = p_note, runner = null, runner_seen_at = null, updated_at = v_now")
  })
  it('cancel — claimed 이거나 단계 dd 면 as 로(D14), 직전 status 를 돌려준다(P3)', () => {
    const f = fn()
    expect(f).toContain("if v_order_status = 'claimed' or v_old_stage = 'dd' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;")
    expect(f).toContain("'prev_status', case when v_is_order_event then v_order_status end,")
  })
  it('set_design_mode — 주문 행을 먼저 잠그고 항목을 잠근다(P3), 설계 상태·진행 주문이 있으면 거부', () => {
    const f = fn()
    const lockOrders = f.indexOf('perform 1 from public.agent_work_orders where wbs_item_id = p_item_id order by id for update;')
    const lockItem = f.indexOf('select design_mode into v_design_mode from public.wbs_items where id = p_item_id for update;')
    expect(lockOrders).toBeGreaterThan(-1)
    expect(lockItem).toBeGreaterThan(lockOrders)
    expect(f).toContain("'reason', 'design_mode_locked'")
  })
  it('앞으로 가는 사건은 실적을 낮추지 않는다(D19·P13)', () => {
    expect(fn()).toContain('if v_keep_max and v_new_pct is not null and v_old_pct is not null and v_old_pct > v_new_pct then v_new_pct := v_old_pct; end if;')
    expect(fn()).toContain("v_keep_max := p_event in ('report_completion','approve');")
  })
  it('dd 크레딧 채움은 greatest(ds, least(20, ip-5))(D18·P12)', () => {
    expect(fn()).toContain('v_new_pct := greatest(v_ds, least(20, v_ip - 5));')
  })
  it('0107 의 나머지 규칙을 그대로 가진다 — stub 하위 제외 리프·스텁 잔존 거부·잠금·record 금지', () => {
    const f = fn()
    expect(f).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);')
    expect(f).toContain("'reason', 'stub_pending'")
    expect(f).toContain("'agent' = any(coalesce(v_tags, '{}'::text[]))")
    expect(f).toContain("'reason', 'locked'")
    expect(f).not.toMatch(/\s+record;/)
    expect(f.split('as $$')[0]).toContain('security invoker')
  })
})

describe('0108 데이터 이전(8절·L4·L12·D26)', () => {
  it('claimed·ds·wait_review 는 review·design·dd, wait_pred 는 dd 로(리프만)', () => {
    const b = s()
    expect(b).toContain("where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase in ('wait_review','wait_pred')")
    expect(b).toContain("set design_state = 'review', claim_scope = 'design', runner = null, runner_seen_at = null where id = r.order_id;")
  })
  it('나머지 claimed 는 claim_scope legacy, runner 는 heartbeat_agent 먼저(L12)', () => {
    expect(s()).toContain('runner = coalesce(runner, heartbeat_agent, claimed_by),')
    expect(s()).toContain("claim_scope = coalesce(claim_scope, 'legacy'),")
  })
  it('이미 진행된 항목의 ready 주문을 취소하고 이력을 남긴다(D26)', () => {
    expect(s()).toContain("'agent_order', 'ready', 'cancelled(0108 D26)'")
  })
  it('한 트랜잭션이다', () => {
    expect(s()).toMatch(/^begin;$/m)
    expect(s()).toMatch(/^commit;$/m)
  })
})

describe('0108 rollback', () => {
  it('dd 행을 ds 로 옮긴 뒤 CHECK 를 dd 없이 되돌린다', () => {
    const rb = r()
    const move = rb.indexOf("update public.wbs_items set stage = 'ds' where stage = 'dd';")
    const chk = rb.indexOf("add constraint wbs_items_stage_check check (stage in ('as','ds','ip','im','xx'))")
    expect(move).toBeGreaterThan(-1)
    expect(chk).toBeGreaterThan(move)
  })
  it('크레딧 표의 dd 키를 지운다', () => {
    expect(r()).toContain("(stage_credits -> 'default') - 'dd'")
  })
  it('새 12인자 함수를 지우고 0107 본문을 글자 그대로 되살린다', () => {
    expect(r()).toContain(`drop function if exists ${NEW_SIG};`)
    expect(fnOf(r())).toBe(fnOf(prev()))
    expect(r()).toContain(`grant execute on function ${OLD_SIG} to service_role;`)
  })
  it('새 칸을 지운다', () => {
    for (const c of ['design_mode', 'design_state', 'claim_scope', 'design_note', 'runner_seen_at']) expect(r()).toContain(`drop column if exists ${c}`)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 본다**

Run: `npx vitest run tests/migrations/0108-design-state.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'supabase/migrations/0108_design_state.sql'`

- [ ] **Step 3: 정방향 마이그레이션을 쓴다**

`supabase/migrations/0108_design_state.sql`:

```sql
-- supabase/migrations/0108_design_state.sql
-- 설계 상태·구현자동(docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md — 12절 우선,
-- 계획서 docs/superpowers/plans/2026-09-27-design-state-dev-auto.md P1~P3·P12·P13).
-- ① wbs_items.design_mode(auto·review·human, NOT NULL DEFAULT 'auto') — D1·D17.
-- ② agent_work_orders: design_state·claim_scope·design_note·runner·runner_seen_at — 3절·D8·D25.
-- ③ 단계 어휘에 dd(설계 완료)를 ds 와 ip 사이에(CHECK) — D6.
-- ④ 크레딧 기본값에 dd 20. 표에 dd 가 없으면 RPC 가 greatest(ds, least(20, ip-5)) 로 채운다 — D18·P12.
-- ⑤ apply_workflow_event 재정의 — 0107 본문 기준. 새 인자 p_scope·p_cas·p_note·p_mode·p_runner(모두 기본값 null) 때문에
--    옛 7인자 함수를 drop 하고 다시 만든다(오버로드가 남으면 PostgREST 이름 인자 호출이 모호해진다, P2). 2.9·2.10 앱은
--    새 인자를 보내지 않으므로 기본값으로 종전처럼 돈다(claim_scope 는 legacy, runner 는 p_agent).
--    관문 규칙은 라우트(src/lib/domain/designGate.ts)가 집행한다. 여기는 원자 전이와 CAS, 사건별 전제 재확인만 한다(D7).
-- ⑥ 데이터 이전(8절·L4·L12·W25·D26): 설계만 멈춤 잔재 → review·design·dd, 설계 선행 잔재(wait_pred) → dd,
--    나머지 claimed 의 claim_scope·runner 채움, 이미 진행된 항목의 ready 주문 취소.
-- 배포 순서: 이 마이그레이션이 코드보다 먼저다(새 칸·새 RPC 인자에 기본값이 있어 옛 앱이 그대로 돈다).
-- 사전·사후 건수: 계획서 Task 5 Step 3·6.
-- 적용: npm run db:apply -- supabase/migrations/0108_design_state.sql --target staging  (운영은 지시 뒤)
begin;

-- ① 설계 방식
alter table public.wbs_items add column if not exists design_mode text not null default 'auto';
alter table public.wbs_items drop constraint if exists wbs_items_design_mode_check;
alter table public.wbs_items
  add constraint wbs_items_design_mode_check check (design_mode in ('auto','review','human'));
comment on column public.wbs_items.design_mode is
  '설계 방식 — auto(완전자동)·review(설계 검토: 에이전트 설계 → 사람 승인)·human(구현자동: 사람 설계 → 확정). 설계 상태 스펙 D1';

-- ② 주문의 설계 상태·범위·도는 PC
alter table public.agent_work_orders
  add column if not exists design_state text,
  add column if not exists claim_scope text,
  add column if not exists design_note text,
  add column if not exists runner text,
  add column if not exists runner_seen_at timestamptz;
alter table public.agent_work_orders drop constraint if exists agent_work_orders_design_state_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_design_state_check check (design_state is null or design_state in ('review','accepted'));
alter table public.agent_work_orders drop constraint if exists agent_work_orders_claim_scope_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_claim_scope_check check (claim_scope is null or claim_scope in ('full','design','build','legacy'));
alter table public.agent_work_orders drop constraint if exists agent_work_orders_design_note_len;
alter table public.agent_work_orders
  add constraint agent_work_orders_design_note_len check (design_note is null or char_length(design_note) <= 500);
comment on column public.agent_work_orders.design_state is '설계 상태 — null(없음)·review(설계 검토 대기)·accepted(승인·확정). 단계 ip 이상에서는 취소 말고 바뀌지 않는다(D24)';
comment on column public.agent_work_orders.claim_scope is 'claim 범위 — null 은 legacy(2.9 앱·0108 이전 claim). 설계 승인(design_accept ①)이 build 로 바꾼다(D8)';
comment on column public.agent_work_orders.runner is '도는 PC 의 에이전트 라벨(D25). claim·build-start·heartbeat 가 적고 완료 보고·설계 검토 멈춤·해제·취소·되돌림이 비운다';

-- ③ 단계 dd
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','ds','dd','ip','im','xx'));

-- ④ 크레딧 설명
comment on column public.project_settings.stage_credits is
  '단계 전이 실적 크레딧 {default:{as,ds,dd,ip,rw,im,xx}} — null 이면 코드 기본값. ds 가 없으면 10, dd 가 없으면 greatest(ds, least(20, ip-5)). 규칙: 정수·5단위·핵심 사슬 as<ip<rw<im<xx 간격>=10·as<=ds<=dd<=ip·xx=100';

-- ⑤ 전이 RPC — 시그니처가 바뀌므로 옛 함수를 먼저 지운다.
drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid);

create or replace function public.apply_workflow_event(
  p_event         text,
  p_actor         uuid,
  p_item_id       uuid default null,   -- assign|unassign|set_stage|set_design_mode 필수. 주문 사건은 주문의 wbs_item_id 를 쓴다(주면 일치해야 한다)
  p_order_id      uuid default null,   -- 주문 사건 필수
  p_stage         text default null,   -- set_stage 의 목표 단계 / claim(legacy): null(종전 ip) 또는 'ds'(설계 선행, 0107)
  p_agent         text default null,   -- claim: 기록 / report_completion·release·build_start·design_done: 점유자 일치 조건
  p_agent_user_id uuid default null,   -- 위와 같다(PAT 계정)
  p_scope         text default null,   -- claim: full·design·build·legacy(null=legacy) / build_start: full·build·rework·legacy(0108)
  p_cas           jsonb default null,  -- 라우트가 읽은 값: design_state·design_mode·claim_scope·runner·runner_seen_at 키가 있으면 같아야 한다(0108, P1)
  p_note          text default null,   -- design_reopen 의 사유(0108)
  p_mode          text default null,   -- set_design_mode 의 목표 방식(0108)
  p_runner        text default null    -- claim·build_start·design_done 이 적을 호출 라벨(0108, D25)
) returns jsonb
language plpgsql
security invoker
as $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ds":10,"dd":20,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_order_design_state text;
  v_order_claim_scope text;
  v_order_runner text;
  v_order_runner_seen timestamptz;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_tags text[];
  v_design_mode text;
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_scope text;
  v_new_design_state text;
  v_apply boolean := false;
  v_keep_max boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_ds numeric;
  v_ip numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_stub_pending boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage','build_start',
                                        'design_done','design_accept','design_reopen','cancel','set_design_mode') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  -- claim 이 받는 p_stage 는 종전(null → ip)과 설계 선행(ds) 둘뿐이다(0107). 주문을 잠그기 전에 거부한다.
  if p_event = 'claim' and p_stage is not null and p_stage <> 'ds' then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;
  -- 범위·방식 값 검사(0108) — 모르는 값을 legacy 로 삼키지 않는다.
  if p_event = 'claim' and p_scope is not null and p_scope not in ('full','design','build','legacy') then
    return jsonb_build_object('ok', false, 'reason', 'bad_scope');
  end if;
  if p_event = 'build_start' and p_scope is not null and p_scope not in ('full','build','rework','legacy') then
    return jsonb_build_object('ok', false, 'reason', 'bad_scope');
  end if;
  if p_event = 'set_design_mode' and (p_mode is null or p_mode not in ('auto','review','human')) then
    return jsonb_build_object('ok', false, 'reason', 'bad_mode');
  end if;
  v_scope := coalesce(p_scope, 'legacy');

  -- 설계 방식 변경(4.1, P3) — claim 과 같은 잠금 순서(주문 → 항목)로 교착을 피한다.
  -- 조건은 designGate.designModeChangeBlock 과 같다: 설계 상태가 있거나 claimed·reported·approved 주문이 있으면 거부.
  if p_event = 'set_design_mode' then
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    perform 1 from public.agent_work_orders where wbs_item_id = p_item_id order by id for update;
    select design_mode into v_design_mode from public.wbs_items where id = p_item_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
    if exists (select 1 from public.agent_work_orders
                where wbs_item_id = p_item_id
                  and (status in ('claimed','reported','approved') or (status = 'ready' and design_state is not null))) then
      return jsonb_build_object('ok', false, 'reason', 'design_mode_locked');
    end if;
    if v_design_mode is distinct from p_mode then
      update public.wbs_items set design_mode = p_mode, updated_at = v_now where id = p_item_id;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, p_item_id, 'design_mode', v_design_mode, p_mode);
    end if;
    return jsonb_build_object('ok', true, 'design_mode', p_mode, 'design_mode_changed', v_design_mode is distinct from p_mode);
  end if;

  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start',
                                  'design_done','design_accept','design_reopen','cancel');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건·CAS 로 본다
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id, design_state, claim_scope, runner, runner_seen_at
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item,
           v_order_design_state, v_order_claim_scope, v_order_runner, v_order_runner_seen
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    -- design_accept·design_reopen·cancel 은 ready·claimed 둘 다 받는다(아래 조건에서 가른다).
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved'
      when 'build_start' then 'claimed'
      when 'design_done' then 'claimed'
      else v_order_status end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed'
      when 'cancel' then 'cancelled'
      else v_order_status end;
    if v_order_status <> v_expect
       or (p_event in ('design_accept','design_reopen','cancel') and v_order_status not in ('ready','claimed'))
       or (p_event in ('report_completion','release','build_start','design_done') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release','build_start','design_done') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
       or (p_cas is not null and p_cas ? 'design_state' and v_order_design_state is distinct from (p_cas ->> 'design_state'))
       or (p_cas is not null and p_cas ? 'claim_scope' and v_order_claim_scope is distinct from (p_cas ->> 'claim_scope'))
       or (p_cas is not null and p_cas ? 'runner' and v_order_runner is distinct from (p_cas ->> 'runner'))
       or (p_cas is not null and p_cas ? 'runner_seen_at' and v_order_runner_seen is distinct from (p_cas ->> 'runner_seen_at')::timestamptz)
    then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  else
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    v_item_id := p_item_id;
  end if;

  -- 항목 잠금. 주문 사건에서 항목이 지워진 주문이면 단계·실적만 건너뛴다(주문 전이는 한다).
  if v_item_id is not null then
    select project_id, stage, actual_pct, dev_workflow, tags, design_mode
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags, v_design_mode
      from public.wbs_items where id = v_item_id for update;
    v_item_found := found;
    if v_item_found then
      -- stub_for 하위(스텁 제거 Task)는 구조에 투명하다(스펙 F9) — 후행은 계속 리프다.
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);
    elsif not v_is_order_event then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
  elsif not v_is_order_event then
    return jsonb_build_object('ok', false, 'reason', 'item_required');
  end if;

  -- CAS(P1) — 라우트가 읽은 설계 방식과 같아야 한다(방식 변경과 claim 의 경합, 5차 W28).
  if v_is_order_event and p_cas is not null and p_cas ? 'design_mode' and v_item_found
     and v_design_mode is distinct from (p_cas ->> 'design_mode') then
    return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
  end if;

  -- 사건별 전제(0108) — 라우트·서버 액션의 관문과 같은 조건을 잠근 행으로 다시 본다. 판정과 쓰기 사이에 바뀌었으면 거부한다.
  if p_event = 'design_done' and v_item_found and v_is_leaf and v_old_stage in ('ip','im','xx') then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  if p_event = 'design_accept' then
    if v_order_status = 'claimed' then
      if v_order_design_state is distinct from 'review' or v_old_stage is distinct from 'dd' then
        return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
      end if;
    elsif v_design_mode is distinct from 'human' or not ('agent' = any(coalesce(v_tags, '{}'::text[])))
          or v_order_design_state is not null or coalesce(v_old_stage, 'as') not in ('as','ds')
          or coalesce(v_old_pct, 0) >= 100
          or exists (select 1 from public.agent_work_orders where wbs_item_id = v_item_id and status = 'approved') then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  end if;
  if p_event = 'design_reopen' and v_order_design_state is distinct from 'review'
     and (v_order_design_state is distinct from 'accepted' or v_old_stage is distinct from 'dd') then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  -- 완료 보고: 설계 검토 대기면 거부(W23), 리프는 단계 ip 에서만(Y2). 부모·지워진 항목은 단계를 보지 않는다.
  if p_event = 'report_completion' and (v_order_design_state = 'review'
       or (v_item_found and v_is_leaf and v_old_stage is distinct from 'ip')) then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  -- 반납(D13): 설계 상태가 있거나, 설계만 하던 주문(claim_scope design)이 ds·dd 면 거부 — 웹의 「중단」을 쓴다.
  if p_event = 'release' and (v_order_design_state is not null
       or (v_order_claim_scope = 'design' and v_item_found and v_old_stage in ('ds','dd'))) then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;

  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

  -- 주문 갱신
  if v_is_order_event then
    v_new_design_state := v_order_design_state;
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id, claimed_at = v_now,
             claim_scope = v_scope, runner = coalesce(p_runner, p_agent), runner_seen_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             claim_scope = null, runner = null, runner_seen_at = null,
             updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'build_start' then
      -- 주문 status 는 claimed 그대로다(0107). 도는 PC 를 호출자로 적는다(D25 — 라우트가 runner·runner_seen_at CAS 를 싣는다).
      update public.agent_work_orders
         set runner = coalesce(p_runner, p_agent, runner), runner_seen_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'report_completion' then
      update public.agent_work_orders
         set status = 'reported', runner = null, runner_seen_at = null, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'cancel' then
      -- D14 공용 취소 — 위임 해제·「중단」·개발 워크플로 끄기·스텁 제거·import 의 표식 제거(L7)가 모두 이 사건이다.
      v_new_design_state := null;
      update public.agent_work_orders
         set status = 'cancelled', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             design_state = null, claim_scope = null, runner = null, runner_seen_at = null, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_done' then
      -- 설계 상태: 없음 → review(방식 review 이거나 claim_scope design). accepted 는 그대로. review 가 되면 runner 를 비운다(D25).
      if v_order_design_state is null and (v_design_mode = 'review' or v_order_claim_scope = 'design') then v_new_design_state := 'review'; end if;
      update public.agent_work_orders
         set design_state = v_new_design_state,
             runner = case when v_new_design_state = 'review' then null else runner end,
             runner_seen_at = case when v_new_design_state = 'review' then null else runner_seen_at end,
             heartbeat_phase = case when v_new_design_state = 'review' then 'wait_review' else 'wait_pred' end,
             heartbeat_agent = coalesce(p_runner, p_agent, heartbeat_agent), last_heartbeat_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_accept' then
      -- ① 「설계 승인」(claimed·review·dd) 은 claim_scope 를 build 로(D8), ② 「설계 확정」(ready·human) 은 단계 dd 로(아래).
      v_new_design_state := 'accepted';
      update public.agent_work_orders
         set design_state = 'accepted', design_note = null,
             claim_scope = case when v_order_status = 'claimed' then 'build' else claim_scope end,
             updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_reopen' then
      if v_order_design_state = 'review' then
        -- 검토 대기 중이면 사유만 고친다(4.1).
        update public.agent_work_orders set design_note = p_note, updated_at = v_now where id = p_order_id;
      elsif v_design_mode = 'human' then
        v_new_design_state := null;
        if v_order_status = 'claimed' then
          -- 사람 설계 대기로 — 주문을 ready 로 되돌리고 점유·heartbeat·재개 요청·범위·도는 PC 를 release 처럼 비운다.
          v_next := 'ready';
          update public.agent_work_orders
             set status = 'ready', design_state = null, design_note = p_note,
                 claimed_by = null, claimed_by_user_id = null, claimed_at = null,
                 last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
                 resume_requested_at = null, resume_requested_by = null, resume_requested_host = null,
                 claim_scope = null, runner = null, runner_seen_at = null, updated_at = v_now
           where id = p_order_id;
        else
          update public.agent_work_orders set design_state = null, design_note = p_note, updated_at = v_now where id = p_order_id;
        end if;
      else
        -- review·auto 는 설계 검토 대기로. 방식과 관계없이 runner 를 비운다(L9 — 재승인 뒤 다른 PC 가 30분 기다리지 않게).
        v_new_design_state := 'review';
        update public.agent_work_orders
           set design_state = 'review', design_note = p_note, runner = null, runner_seen_at = null, updated_at = v_now
         where id = p_order_id;
      end if;
    else
      -- approve·reject·unapprove·rework — 종전과 같다.
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2, 0108 설계 상태 스펙 4.1)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif p_event = 'build_start' then
      -- 설계 끝 → 구현 시작. ds·dd 일 때만 옮긴다. 이미 ip 이상이면 아무것도 바꾸지 않는다(멱등).
      if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip'; v_keep_max := true;
      elsif v_old_stage is null or v_old_stage not in ('ip','im','xx') then v_skipped := 'stage';
      end if;
    elsif p_event = 'claim' then
      v_apply := true; v_keep_max := true;
      if v_scope in ('full','design') then v_new_stage := 'ds'; v_credit_key := 'ds';
      elsif v_scope = 'build' then v_new_stage := 'dd'; v_credit_key := 'dd';
      else v_new_stage := case when p_stage = 'ds' then 'ds' else 'ip' end; v_credit_key := v_new_stage;
      end if;
    elsif p_event = 'design_done' then
      if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true;
      else v_skipped := 'stage';
      end if;
    elsif p_event = 'design_accept' then
      if v_order_status = 'ready' then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true; end if;
    elsif p_event = 'design_reopen' then
      if v_design_mode = 'human' and v_order_design_state = 'accepted' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;
    elsif p_event = 'cancel' then
      -- D14: claimed 취소면 as(종전과 같다), ready 취소면 dd 만 as 로.
      if v_order_status = 'claimed' or v_old_stage = 'dd' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;
    elsif p_event = 'release' then
      v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'report_completion' then 'im' when 'approve' then 'xx' when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' end;
      v_credit_key := case p_event
        when 'report_completion' then 'im' when 'approve' then 'xx' when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' end;
      v_keep_max := p_event in ('report_completion','approve');
    end if;
  elsif p_event = 'assign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif v_old_stage is not null then v_skipped := 'stage';
    else v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    end if;
  elsif p_event = 'unassign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif v_old_stage is distinct from 'as' then v_skipped := 'stage';
    else v_apply := true; v_new_stage := null; v_credit_key := null;
    end if;
  else -- set_stage — 사람은 dd 를 고를 수 없다(dd 는 design_done·design_accept 로만 생긴다, 스펙 7절).
    if p_stage is not null and p_stage not in ('as','ds','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 잠금(위임됨 ∨ 에이전트가 주문을 쥠)이면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    -- ready 는 넣지 않는다: dev_workflow 리프마다 배정과 무관하게 상주한다. 조건은 agentWork.stageLockedForHuman 과 같다.
    if 'agent' = any(coalesce(v_tags, '{}'::text[]))
       or exists (select 1 from public.agent_work_orders
                   where wbs_item_id = v_item_id and status in ('claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      select stage_credits into v_credits from public.project_settings where project_id = v_project_id;
      v_credits := coalesce(v_credits, c_default);
      -- 표는 하나다(2026-09-16) — 항목 credit_key 로 고르지 않는다.
      v_table := coalesce(v_credits -> 'default', c_default -> 'default');
      if v_credit_key = 'dd' and not (v_table ? 'dd') then
        -- 0108 이전 표에는 dd 가 없다 — greatest(ds, least(20, ip-5)) 로 채운다(D18·P12, stageCredits.fillOptional 과 같은 식).
        v_ds := coalesce((v_table ->> 'ds')::numeric, (c_default -> 'default' ->> 'ds')::numeric);
        v_ip := coalesce((v_table ->> 'ip')::numeric, (c_default -> 'default' ->> 'ip')::numeric);
        v_new_pct := greatest(v_ds, least(20, v_ip - 5));
      else
        v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
      end if;
    end if;
    -- 앞으로 가는 사건은 실적을 낮추지 않는다(D19·P13).
    if v_keep_max and v_new_pct is not null and v_old_pct is not null and v_old_pct > v_new_pct then v_new_pct := v_old_pct; end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
    if v_stage_changed or v_actual_changed then
      update public.wbs_items
         set stage = case when v_stage_changed then v_new_stage else stage end,
             actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
             updated_at = v_now
       where id = v_item_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'prev_status', case when v_is_order_event then v_order_status end,
    'design_state', case when v_is_order_event then v_new_design_state end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text) to service_role;

-- ⑥-1 설계 멈춤 잔재(리프만): claimed ∧ ds ∧ heartbeat_phase wait_review(2.10 설계만, 스테이징) 또는 wait_pred(설계 선행, L4)
--     → 단계 dd·실적 max(현재, dd). wait_review 는 설계 상태 review·claim_scope design·runner 없음(8절, W25).
do $$
declare
  r record;
  v_dd numeric;
begin
  for r in
    select o.id as order_id, i.id as item_id, i.actual_pct as old_pct, i.project_id, o.heartbeat_phase as phase
      from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
     where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase in ('wait_review','wait_pred')
       and not exists (select 1 from public.wbs_items c where c.parent_id = i.id and c.stub_for is null)
  loop
    select coalesce((s.stage_credits -> 'default' ->> 'dd')::numeric,
                    greatest(coalesce((s.stage_credits -> 'default' ->> 'ds')::numeric, 10),
                             least(20, coalesce((s.stage_credits -> 'default' ->> 'ip')::numeric, 30) - 5)))
      into v_dd from public.project_settings s where s.project_id = r.project_id;
    v_dd := coalesce(v_dd, 20);
    update public.wbs_items set stage = 'dd', actual_pct = greatest(coalesce(actual_pct, 0), v_dd), updated_at = now() where id = r.item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value) values (null, r.item_id, 'stage', 'ds', 'dd');
    if coalesce(r.old_pct, 0) < v_dd then
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (null, r.item_id, 'actual_pct', r.old_pct::text, v_dd::text);
    end if;
    if r.phase = 'wait_review' then
      update public.agent_work_orders set design_state = 'review', claim_scope = 'design', runner = null, runner_seen_at = null where id = r.order_id;
    end if;
  end loop;
end $$;

-- ⑥-2 나머지 claimed 의 범위·도는 PC — runner 는 마지막 heartbeat 의 라벨 먼저(L12: 다른 PC 가 이어받은 주문), 없으면 점유 라벨.
update public.agent_work_orders
   set claim_scope = coalesce(claim_scope, 'legacy'),
       runner = coalesce(runner, heartbeat_agent, claimed_by),
       runner_seen_at = coalesce(runner_seen_at, last_heartbeat_at)
 where status = 'claimed' and design_state is null;

-- ⑥-3 이미 진행된 항목(단계 ip 이상·실적 100·approved 주문)의 ready 주문을 취소하고 이력을 남긴다(D26, 5차 W9).
do $$
declare
  r record;
begin
  for r in
    select o.id, o.wbs_item_id
      from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
     where o.status = 'ready'
       and (i.stage in ('ip','im','xx') or coalesce(i.actual_pct, 0) >= 100
            or exists (select 1 from public.agent_work_orders a where a.wbs_item_id = i.id and a.status = 'approved'))
  loop
    update public.agent_work_orders set status = 'cancelled', updated_at = now() where id = r.id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (null, r.wbs_item_id, 'agent_order', 'ready', 'cancelled(0108 D26)');
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 4: 되돌리기 파일을 쓴다**

`supabase/migrations/0108_design_state_rollback.sql` 을 아래 머리로 만든다:

```sql
-- supabase/migrations/0108_design_state_rollback.sql
-- 0108 되돌리기. 순서가 중요하다: dd 행을 ds 로 옮긴 뒤 CHECK 를 좁힌다(반대면 CHECK 재정의가 실패한다).
-- 크레딧 표의 dd 키도 지운다 — 되돌린 코드의 검증(validateStageCredits)이 모르는 키로 설정 저장을 거부한다.
-- 전이 RPC 는 12인자 함수를 지우고 0107 본문(7인자)으로 되살린다 — 새 사건을 부르는 코드를 먼저 되돌려야 한다(bad_event).
-- 되돌리지 않는 것: ⑥-3 이 취소한 ready 주문(취소는 종착이다 — 필요하면 위임을 껐다 켜 새 주문을 받는다)과 change_logs 기록.
-- 사전 확인: select count(*) from public.wbs_items where stage = 'dd';
begin;

update public.wbs_items set stage = 'ds' where stage = 'dd';
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','ds','ip','im','xx'));

update public.project_settings
   set stage_credits = jsonb_set(stage_credits, '{default}', (stage_credits -> 'default') - 'dd')
 where stage_credits is not null and (stage_credits -> 'default') ? 'dd';

comment on column public.project_settings.stage_credits is
  '단계 전이 실적 크레딧 {default:{as,ds,ip,rw,im,xx}} — null 이면 코드 기본값, ds 가 없으면 기본값(10). 규칙: 정수·5단위·as<ds<ip<rw<im<xx·간격>=10·xx=100';

drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text);

-- 전이 RPC 를 0107 본문으로 되살린다(아래 블록은 0107_wbs_design_stage.sql 에서 글자 그대로 옮긴다).
```

이어서 0107 의 함수 정의를 글자 그대로 붙인다(테스트가 `fnOf(rollback) === fnOf(0107)` 을 본다):

```bash
sed -n '/^create or replace function public.apply_workflow_event(/,/^\$\$;/p' supabase/migrations/0107_wbs_design_stage.sql >> supabase/migrations/0108_design_state_rollback.sql
```

그리고 꼬리를 붙인다:

```sql

revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role;

alter table public.agent_work_orders
  drop constraint if exists agent_work_orders_design_state_check,
  drop constraint if exists agent_work_orders_claim_scope_check,
  drop constraint if exists agent_work_orders_design_note_len;
alter table public.agent_work_orders
  drop column if exists design_state,
  drop column if exists claim_scope,
  drop column if exists design_note,
  drop column if exists runner,
  drop column if exists runner_seen_at;
alter table public.wbs_items drop constraint if exists wbs_items_design_mode_check;
alter table public.wbs_items drop column if exists design_mode;

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 5: 대조 테스트가 통과하는지 본다**

Run: `npx vitest run tests/migrations/0108-design-state.test.ts tests/migrations/0107-wbs-design-stage.test.ts`
Expected: PASS. 문자열 대조가 실패하면 SQL 의 공백·줄바꿈이 테스트의 기대 문자열과 같은지 먼저 본다(테스트는 Step 3 의 SQL 에서 줄을 그대로 옮겼다).

- [ ] **Step 6: 커밋(마이그레이션만 — 코드와 섞지 않는다)**

```bash
git add supabase/migrations/0108_design_state.sql supabase/migrations/0108_design_state_rollback.sql tests/migrations/0108-design-state.test.ts
git commit -m "feat(db): 0108 설계 상태 — design_mode·design_state·claim_scope·runner, 단계 dd, 전이 RPC 새 사건

설계 방식·설계 상태·도는 PC 를 서버에 두고, 전이 RPC 가 design_done·design_accept·design_reopen·cancel·set_design_mode 를
원자적으로 처리한다(관문은 라우트, RPC 는 CAS). 옛 7인자 함수를 지워 오버로드 모호성을 없애고, 새 인자는 기본값이 있어
2.9·2.10 앱이 그대로 돈다. 설계 멈춤 잔재·claimed 범위·진행된 항목의 ready 주문을 이전한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(스테이징 리허설 뒤 Task 5 가 이 커밋에 트레일러를 단다. 대조 테스트 파일은 SQL 을 읽는 테스트라 마이그레이션 커밋에 함께 넣는다 — G1 은 `src/**` 코드와의 혼합만 막는다.)

---

## Task 5: 스테이징 리허설 — 0108 을 스테이징 DB 에 먼저 적용

**Files:** 없음(스크래치 SQL 만. 결과는 커밋 트레일러와 사용자 보고로 남긴다)

**Interfaces:**
- Consumes: Task 4 의 `0108_design_state.sql`
- Produces: 스테이징 DB 에 0108 적용. `Staging-verified:` 트레일러가 붙은 마이그레이션 커밋. 전후 건수 표.

스테이징 DB 가 먼저 올라가도 지금 스테이징 앱(계약 2.10)은 그대로 돈다(새 칸 기본값·RPC 새 인자 기본값). 그래서 코드보다 먼저 한다.

- [ ] **Step 1: 스테이징에 살아 있는 팀장·2.10 잔재가 있는지 본다(Y6, sync 전)**

`<SCRATCH>/pre-sync.sql`:

```sql
select 'live_watchers' k, count(*)::text v from public.agent_watchers where last_seen_at > now() - interval '70 minutes'
union all select 'live_leases', count(*)::text from public.agent_lead_leases where expires_at > now()
union all select 'wait_review_orders', count(*)::text from public.agent_work_orders where status = 'claimed' and heartbeat_phase = 'wait_review'
union all select 'wait_review_list', coalesce(string_agg(left(id::text, 8), ','), '-') from public.agent_work_orders where status = 'claimed' and heartbeat_phase = 'wait_review';
```

```bash
mkdir -p "<SCRATCH>"
npm run db:apply -- <SCRATCH>/pre-sync.sql --target staging
```

Expected: 네 줄의 값. `live_watchers`·`live_leases` 가 0 이 아니면 스테이징에서 누가 팀장을 돌리는 중이다 — **멈추고 사용자에게 목록을 보여 준 뒤 지시를 받는다.** `wait_review_list` 는 2.10 "설계만" 잔재다. 다음 단계의 sync 가 지우므로(운영에는 2.10 이 없다) 목록만 보고에 남긴다.

- [ ] **Step 2: 사용자 확인을 받고 staging:sync 를 한다**

`staging:sync` 는 스테이징 데이터를 운영 복제로 덮는다(되돌릴 수 없다). **실행 직전에 사용자에게 "스테이징 데이터를 운영 복제로 덮어도 되는지"를 묻고 명시적 동의를 받는다.** 동의하면:

```bash
npm run staging:sync
```

Expected: 확인 프롬프트에 답하면 복제가 끝난다. 활성 접속 경고가 나오면 멈추고 사용자에게 알린다(`--yes` 로 우회하지 않는다).

- [ ] **Step 3: 적용 전 건수를 센다**

`<SCRATCH>/counts.sql`:

```sql
select 'a_claimed_ds_wait_review' k, count(*) v from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase = 'wait_review'
union all select 'b_claimed_ds_wait_pred', count(*) from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase = 'wait_pred'
union all select 'c_claimed', count(*) from public.agent_work_orders where status = 'claimed'
union all select 'd_ready_on_progressed', count(*) from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'ready' and (i.stage in ('ip','im','xx') or coalesce(i.actual_pct, 0) >= 100
    or exists (select 1 from public.agent_work_orders a where a.wbs_item_id = i.id and a.status = 'approved'))
union all select 'e_stage_dd', count(*) from public.wbs_items where stage = 'dd';
```

```bash
npm run db:apply -- <SCRATCH>/counts.sql --target staging
```

Expected: 다섯 줄. 이 숫자를 기록해 둔다(Step 6 과 사용자 보고에 쓴다). 이 단계는 0108 전이라 `e_stage_dd` 는 CHECK 때문에 0 이다.

- [ ] **Step 4: 0108 을 스테이징에 적용한다**

```bash
npm run db:apply -- supabase/migrations/0108_design_state.sql --target staging
```

Expected: 성공. 실패하면 오류 문장을 그대로 기록하고, SQL 을 고쳐 Task 4 Step 5 대조 테스트부터 다시 돈 뒤 이 Step 을 반복한다(스테이징은 트랜잭션이라 실패하면 아무것도 남지 않는다).

- [ ] **Step 5: RPC 를 한 트랜잭션에서 돌려 보고 되돌린다**

`<SCRATCH>/verify.sql` — 끝의 `raise exception` 이 모든 변경을 되돌린다(스테이징에 흔적이 남지 않는다):

```sql
do $$
declare
  v_order uuid; v_item uuid; v_actor uuid; r jsonb;
  v_stage text; v_pct numeric; v_ds text; v_scope text; v_runner text; v_phase text;
begin
  select o.id, o.wbs_item_id into v_order, v_item
    from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
   where o.status = 'ready' and coalesce(i.stage, 'as') = 'as' and coalesce(i.actual_pct, 0) < 100
     and not exists (select 1 from public.wbs_items c where c.parent_id = i.id and c.stub_for is null)
     and not exists (select 1 from public.agent_work_orders a where a.wbs_item_id = i.id and a.status = 'approved')
   limit 1;
  if v_order is null then raise exception 'VERIFY_SKIP 후보 ready 주문 없음'; end if;
  select id into v_actor from auth.users limit 1;
  update public.wbs_items set design_mode = 'review' where id = v_item;

  -- 1) claim(design) → ds·design·runner
  r := public.apply_workflow_event(p_event => 'claim', p_actor => v_actor, p_order_id => v_order, p_agent => 'verify/pca/w1',
         p_scope => 'design', p_cas => '{"design_state":null,"design_mode":"review"}'::jsonb, p_runner => 'verify/pca/w1');
  if (r ->> 'ok')::boolean is not true then raise exception 'VERIFY_FAIL claim %', r; end if;
  select stage into v_stage from public.wbs_items where id = v_item;
  select claim_scope, runner into v_scope, v_runner from public.agent_work_orders where id = v_order;
  if v_stage <> 'ds' or v_scope <> 'design' or v_runner <> 'verify/pca/w1' then raise exception 'VERIFY_FAIL claim 결과 % % %', v_stage, v_scope, v_runner; end if;

  -- 2) 방식 변경은 claimed 가 있으면 거부
  r := public.apply_workflow_event(p_event => 'set_design_mode', p_actor => v_actor, p_item_id => v_item, p_mode => 'human');
  if r ->> 'reason' is distinct from 'design_mode_locked' then raise exception 'VERIFY_FAIL set_design_mode %', r; end if;

  -- 3) CAS 불일치는 conflict
  r := public.apply_workflow_event(p_event => 'design_done', p_actor => v_actor, p_order_id => v_order, p_agent => 'verify/pca/w1',
         p_cas => '{"design_state":"accepted"}'::jsonb);
  if (r ->> 'conflict')::boolean is not true then raise exception 'VERIFY_FAIL cas %', r; end if;

  -- 4) design_done → dd·review·runner 없음·wait_review
  r := public.apply_workflow_event(p_event => 'design_done', p_actor => v_actor, p_order_id => v_order, p_agent => 'verify/pca/w1',
         p_runner => 'verify/pca/w1');
  select stage, actual_pct into v_stage, v_pct from public.wbs_items where id = v_item;
  select design_state, runner, heartbeat_phase into v_ds, v_runner, v_phase from public.agent_work_orders where id = v_order;
  if v_stage <> 'dd' or v_ds <> 'review' or v_runner is not null or v_phase <> 'wait_review' then
    raise exception 'VERIFY_FAIL design_done % % % %', v_stage, v_ds, v_runner, v_phase;
  end if;

  -- 5) 사람의 set_stage 는 dd 를 받지 않는다
  r := public.apply_workflow_event(p_event => 'set_stage', p_actor => v_actor, p_item_id => v_item, p_stage => 'dd');
  if r ->> 'reason' is distinct from 'bad_stage' then raise exception 'VERIFY_FAIL set_stage dd %', r; end if;

  -- 6) design_accept ① → accepted·build
  r := public.apply_workflow_event(p_event => 'design_accept', p_actor => v_actor, p_order_id => v_order,
         p_cas => '{"design_state":"review"}'::jsonb);
  select design_state, claim_scope into v_ds, v_scope from public.agent_work_orders where id = v_order;
  if v_ds <> 'accepted' or v_scope <> 'build' then raise exception 'VERIFY_FAIL design_accept % %', v_ds, v_scope; end if;

  -- 7) build_start(build) → ip·runner
  r := public.apply_workflow_event(p_event => 'build_start', p_actor => v_actor, p_order_id => v_order, p_agent => 'verify/pca/w1',
         p_scope => 'build', p_cas => '{"design_state":"accepted","runner":null}'::jsonb, p_runner => 'verify/pca/w1');
  select stage into v_stage from public.wbs_items where id = v_item;
  select runner into v_runner from public.agent_work_orders where id = v_order;
  if v_stage <> 'ip' or v_runner <> 'verify/pca/w1' then raise exception 'VERIFY_FAIL build_start % %', v_stage, v_runner; end if;

  -- 8) 완료 보고 → im·runner 없음
  r := public.apply_workflow_event(p_event => 'report_completion', p_actor => v_actor, p_order_id => v_order, p_agent => 'verify/pca/w1',
         p_cas => '{"runner":"verify/pca/w1"}'::jsonb);
  select stage into v_stage from public.wbs_items where id = v_item;
  select runner into v_runner from public.agent_work_orders where id = v_order;
  if v_stage <> 'im' or v_runner is not null then raise exception 'VERIFY_FAIL report % %', v_stage, v_runner; end if;

  raise exception 'VERIFY_OK 8/8 — 이 오류는 의도한 되돌림이다';
end $$;
```

```bash
npm run db:apply -- <SCRATCH>/verify.sql --target staging
```

Expected: 명령은 오류로 끝나고, 오류 문장에 `VERIFY_OK 8/8` 이 보인다(의도한 되돌림). `VERIFY_FAIL` 이면 그 줄의 값을 기록하고 Task 4 로 돌아가 SQL 을 고친다 — 스테이징에는 되돌리기 파일(`0108_design_state_rollback.sql`)을 먼저 적용한 뒤 다시 적용한다. `VERIFY_SKIP` 이면 후보가 없는 것이다 — 사용자에게 알리고, 검증은 Task 27 의 API E2E 로 넘긴다.

- [ ] **Step 6: 적용 뒤 건수를 다시 세고 표로 남긴다**

`<SCRATCH>/post.sql`:

```sql
select 'a_review_design_dd' k, count(*) v from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'claimed' and o.design_state = 'review' and o.claim_scope = 'design' and i.stage = 'dd'
union all select 'b_claimed_dd_wait_pred', count(*) from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'claimed' and i.stage = 'dd' and o.heartbeat_phase = 'wait_pred'
union all select 'c_claimed_without_scope', count(*) from public.agent_work_orders where status = 'claimed' and claim_scope is null
union all select 'c_claimed_without_runner', count(*) from public.agent_work_orders where status = 'claimed' and design_state is null and runner is null
union all select 'd_ready_on_progressed', count(*) from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'ready' and (i.stage in ('ip','im','xx') or coalesce(i.actual_pct, 0) >= 100
    or exists (select 1 from public.agent_work_orders a where a.wbs_item_id = i.id and a.status = 'approved'))
union all select 'd_cancelled_by_0108', count(*) from public.change_logs where new_value = 'cancelled(0108 D26)'
union all select 'f_design_mode_default', count(*) from public.wbs_items where design_mode <> 'auto';
```

```bash
npm run db:apply -- <SCRATCH>/post.sql --target staging
```

Expected(Step 3 값을 A·B·C·D 라 하면): `a_review_design_dd` = A, `b_claimed_dd_wait_pred` = B, `c_claimed_without_scope` = 0, `c_claimed_without_runner` = 0, `d_ready_on_progressed` = 0, `d_cancelled_by_0108` = D, `f_design_mode_default` = 0. 다르면 멈추고 사용자에게 두 표를 보여 준다.

- [ ] **Step 7: 마이그레이션 커밋에 트레일러를 단다**

Task 4 커밋 뒤에 다른 커밋이 없으면 amend, 있으면 빈 커밋으로 단다(범위 안 빈 커밋 트레일러도 G4 가 인정한다):

```bash
git log --oneline -1   # Task 4 커밋인지 본다
git commit --amend --no-edit --trailer "Staging-verified: $(date +%F) db 리허설 통과"
# 또는(뒤에 커밋이 있으면)
git commit --allow-empty -m "0108 스테이징 리허설" --trailer "Staging-verified: $(date +%F) db 리허설 통과"
```

- [ ] **Step 8: 사용자에게 건수 표를 보고한다**

Step 1·3·6 의 숫자를 한 표로 보고한다(스테이징 = 운영 복제이므로 운영에 적용될 때의 예상 건수다). 보고 문장은 완전한 한국어로 쓴다. 예: "운영 복제 기준으로 설계 선행 대기 주문 2건이 설계 완료(dd)로 옮겨지고, 작업 중 주문 5건에 도는 PC 가 채워지며, 이미 진행된 항목의 대기 주문 1건이 취소됩니다."

---
## Task 6: 전이 RPC 입구 — 새 사건·인자·사유

**Files:**
- Modify: `src/lib/agent/workflowEvent.ts`
- Test: `tests/agent/workflow-event.test.ts`

**Interfaces:**
- Consumes: Task 4 의 RPC 시그니처·응답(`prev_status`·`design_state`·`design_mode_changed`)
- Produces:
  - `WorkflowEvent` 에 `'design_done' | 'design_accept' | 'design_reopen' | 'cancel' | 'set_design_mode'`
  - `WorkflowEventArgs` 에 `scope?: string | null`, `cas?: Record<string, string | null> | null`, `note?: string | null`, `mode?: string | null`, `runner?: string | null`
  - `WorkflowEventOk` 에 `prevStatus: string | null`, `designState: string | null`, `designModeChanged: boolean`
  - `REASON_TEXT` 에 `bad_scope`·`bad_mode`·`design_gate`·`design_mode_locked`

새 인자는 **값이 있을 때만** RPC 에 싣는다. 옛 사건 호출은 종전과 같은 7개 인자라서, 0108 전 DB 에서도 그대로 돈다(되돌리기 대비).

- [ ] **Step 1: 실패하는 테스트를 더한다**

`tests/agent/workflow-event.test.ts` 의 describe 안에 더한다:

```ts
  it('새 인자는 값이 있을 때만 싣는다 — 옛 사건 호출은 7개 인자 그대로', async () => {
    const { client, rpc } = admin({ data: { ok: true, order_status: 'claimed', prev_status: 'ready', design_state: null, stage: 'ds', actual_pct: 10, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } })
    await applyWorkflowEvent(client, {
      event: 'claim', actorUserId: 'u1', orderId: O1, agent: 'a/b/w1', scope: 'design',
      cas: { design_state: null, design_mode: 'review' }, runner: 'a/b/w1',
    })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', {
      p_event: 'claim', p_actor: 'u1', p_item_id: null, p_order_id: O1, p_stage: null, p_agent: 'a/b/w1', p_agent_user_id: null,
      p_scope: 'design', p_cas: { design_state: null, design_mode: 'review' }, p_runner: 'a/b/w1',
    })
  })
  it('prev_status·design_state·design_mode_changed 를 돌려준다', async () => {
    const { client } = admin({ data: { ok: true, order_status: 'cancelled', prev_status: 'claimed', design_state: null, stage: 'as', actual_pct: 0, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } })
    expect(await applyWorkflowEvent(client, { event: 'cancel', actorUserId: 'u1', orderId: O1 }))
      .toMatchObject({ ok: true, orderStatus: 'cancelled', prevStatus: 'claimed', designState: null, designModeChanged: false })
    const { client: c2 } = admin({ data: { ok: true, design_mode: 'human', design_mode_changed: true } })
    expect(await applyWorkflowEvent(c2, { event: 'set_design_mode', actorUserId: 'u1', itemId: W1, mode: 'human' }))
      .toMatchObject({ ok: true, designModeChanged: true })
  })
  it('새 사유는 사람 문구로', async () => {
    for (const reason of ['design_gate', 'design_mode_locked', 'bad_scope', 'bad_mode']) {
      const { client } = admin({ data: { ok: false, reason } })
      const r = await applyWorkflowEvent(client, { event: 'design_done', actorUserId: 'u1', orderId: O1 })
      expect(r).toMatchObject({ ok: false, reason, error: REASON_TEXT[reason] })
      expect(REASON_TEXT[reason]).toBeTruthy()
    }
  })
```

첫 테스트(`인자를 p_* 로 넘기고…`)의 `toEqual` 기대값에 새 필드 세 개를 더한다: `prevStatus: null, designState: null, designModeChanged: false`.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/workflow-event.test.ts`
Expected: FAIL(새 필드·새 인자 없음)

- [ ] **Step 3: 구현**

`src/lib/agent/workflowEvent.ts` 의 타입과 함수를 이렇게 바꾼다(주석 머리·`notifyOnReached`·`SKIPPED_WARN` 은 그대로):

```ts
export type WorkflowEvent =
  | 'assign' | 'unassign' | 'claim' | 'report_completion' | 'approve' | 'unapprove' | 'reject' | 'rework' | 'release' | 'set_stage'
  /** 설계 끝 → 구현 시작(0107·0108) — ds·dd 일 때만 ip, ip 이상이면 무변경. 주문 status 는 claimed 그대로, runner 를 적는다. */
  | 'build_start'
  /** 설계 완료(0108) — ds → dd, review 방식·design 범위면 설계 상태 review 로 두고 runner 를 비운다. */
  | 'design_done'
  /** ① 「설계 승인」(claimed·review·dd → accepted, claim_scope build) ② 「설계 확정」(ready·human → dd·accepted). */
  | 'design_accept'
  /** 「설계 되돌리기」·워커의 되돌림 — human 은 사람 설계 대기(as), 그 밖은 review. 사유를 design_note 에. */
  | 'design_reopen'
  /** D14 공용 취소 — ready·claimed → cancelled. claimed 이거나 단계 dd 면 as 로. prev_status 를 돌려준다. */
  | 'cancel'
  /** 설계 방식 변경(항목 사건) — 설계 상태가 있거나 claimed·reported·approved 주문이 있으면 design_mode_locked. */
  | 'set_design_mode'

export type WorkflowEventArgs = {
  event: WorkflowEvent
  actorUserId: string
  /** assign·unassign·set_stage·set_design_mode 필수. 주문 사건은 생략한다(주문의 wbs_item_id 를 쓴다). */
  itemId?: string | null
  orderId?: string | null
  /** set_stage 의 목표 단계. claim(legacy)에서는 null(종전 ip) 또는 'ds'(설계 선행, 0107). */
  stage?: string | null
  /** claim 은 기록, report_completion·release·build_start·design_done 은 점유자 일치 조건. 사람 사건은 null. */
  agent?: string | null
  agentUserId?: string | null
  /** claim: full·design·build(없으면 legacy) / build_start: full·build·rework(없으면 legacy) — 0108. */
  scope?: string | null
  /** 라우트가 읽은 값 CAS(P1) — 키가 있으면 같아야 한다. null 값은 "없음". */
  cas?: Record<string, string | null> | null
  /** design_reopen 의 사유. */
  note?: string | null
  /** set_design_mode 의 목표 방식. */
  mode?: string | null
  /** claim·build_start·design_done 이 도는 PC 로 적을 호출 라벨(D25). */
  runner?: string | null
}

export type WorkflowSkipped = 'parent' | 'not_workflow' | 'stage' | 'no_item'
export type WorkflowEventOk = {
  ok: true; orderStatus: string | null; stage: string | null; actualPct: number | null
  stageChanged: boolean; actualChanged: boolean; reachedFirst: boolean; skipped: WorkflowSkipped | null
  /** 주문 사건의 직전 status(0108) — cancel 이 워커가 돌던 주문이었는지(claimed) 호출부가 본다. */
  prevStatus: string | null
  /** 주문 사건 뒤 설계 상태(0108). */
  designState: string | null
  /** set_design_mode 가 실제로 바꿨는가. */
  designModeChanged: boolean
}
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string }

/** RPC 실패 사유 → 사람 문구. 모르는 사유는 코드 그대로 드러낸다(표시 = 로깅). */
export const REASON_TEXT: Record<string, string> = {
  conflict: '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.',
  locked: '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.',
  not_workflow: '개발 워크플로 대상이 아닌 항목입니다.',
  parent: '하위 항목이 있습니다 — 개발 워크플로 단계는 최종단계에만 지정합니다.',
  item_required: '항목이 필요한 사건입니다.',
  item_not_found: '항목 없음',
  order_required: '주문이 필요한 사건입니다.',
  order_not_found: '주문 없음',
  order_item_mismatch: '주문의 항목이 다릅니다.',
  bad_event: '알 수 없는 사건입니다.',
  bad_stage: '허용되지 않는 단계입니다. 설계 완료(dd)는 「설계 확정」·「설계 승인」으로만 생깁니다.',
  bad_scope: '허용되지 않는 범위입니다.',
  bad_mode: '허용되지 않는 설계 방식입니다.',
  design_gate: '설계 상태 때문에 처리할 수 없습니다. 화면의 설계 상태 안내를 확인하세요.',
  design_mode_locked: '설계가 확정·검토 중이거나 에이전트가 작업 중이라 설계 방식을 바꿀 수 없습니다.',
  stub_pending: '스텁이 남아 있어 승인할 수 없습니다 — 스텁 제거 작업을 먼저 끝내세요.',
}

export async function applyWorkflowEvent(admin: AdminClient, args: WorkflowEventArgs): Promise<WorkflowEventOk | WorkflowEventFail> {
  const params: Record<string, unknown> = {
    p_event: args.event, p_actor: args.actorUserId,
    p_item_id: args.itemId ?? null, p_order_id: args.orderId ?? null, p_stage: args.stage ?? null,
    p_agent: args.agent ?? null, p_agent_user_id: args.agentUserId ?? null,
  }
  // 0108 인자는 값이 있을 때만 싣는다 — 옛 사건 호출이 0108 전 DB(7인자 함수)에서도 그대로 돈다.
  if (args.scope != null) params.p_scope = args.scope
  if (args.cas != null) params.p_cas = args.cas
  if (args.note != null) params.p_note = args.note
  if (args.mode != null) params.p_mode = args.mode
  if (args.runner != null) params.p_runner = args.runner
  const { data, error } = await admin.rpc('apply_workflow_event', params)
  if (error) return { ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: `전이 실패: ${error.message}` }
  const r = (data ?? {}) as Record<string, unknown>
  const orderStatus = typeof r.order_status === 'string' ? r.order_status : null
  if (r.ok !== true) {
    const conflict = r.conflict === true
    const reason = typeof r.reason === 'string' ? r.reason : conflict ? 'conflict' : 'unknown'
    return { ok: false, conflict, reason, orderStatus, error: REASON_TEXT[reason] ?? `전이 실패(${reason})` }
  }
  return {
    ok: true, orderStatus,
    stage: typeof r.stage === 'string' ? r.stage : null,
    actualPct: r.actual_pct == null ? null : Number(r.actual_pct),
    stageChanged: r.stage_changed === true,
    actualChanged: r.actual_changed === true,
    reachedFirst: r.reached_first === true,
    skipped: typeof r.skipped === 'string' ? (r.skipped as WorkflowSkipped) : null,
    prevStatus: typeof r.prev_status === 'string' ? r.prev_status : null,
    designState: typeof r.design_state === 'string' ? r.design_state : null,
    designModeChanged: r.design_mode_changed === true,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/workflow-event.test.ts && npx tsc --noEmit -p .`
Expected: PASS. tsc 가 `WorkflowEventOk` 를 리터럴로 만드는 다른 테스트 목(예: `RPC_OK` 상수)을 가리키면 그 목은 JSON(snake_case) 이라 영향이 없다. 영향을 받는 곳이 있으면 새 필드를 채운다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/workflowEvent.ts tests/agent/workflow-event.test.ts
git commit -m "feat(design-state): 전이 RPC 입구에 설계 사건·범위·CAS 인자를 더한다

새 인자는 값이 있을 때만 실어 옛 사건 호출이 0108 전 DB 에서도 그대로 돈다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 공용 취소(D14) — 네 경로를 cancel 사건 하나로, import 의 표식 제거(L7)

**Files:**
- Create: `src/lib/agent/cancelOrder.ts`
- Modify: `src/lib/agent/delegation.ts:145-191`, `src/app/actions/agentHub.ts:175-205`, `src/app/actions/wbsAssign.ts:549-559`, `src/lib/agent/forceProgress.ts:59-78`, `src/lib/agent/wbsImport.ts:212-300`, `src/app/api/v1/wbs/import/route.ts:85-86`
- Test: `tests/agent/cancel-order.test.ts`(새), 그리고 네 경로의 기존 테스트(`tests/actions/wbs-spec-delegation-right.test.ts`·`tests/actions/agent-hub-actions.test.ts`·`tests/actions/wbs-dev-workflow.test.ts`·`tests/domain/force-progress.test.ts` 등 — 아래 Step 5)

**Interfaces:**
- Consumes: Task 6 `applyWorkflowEvent({ event: 'cancel', orderId, actorUserId })` → `{ ok, prevStatus, actualChanged }`
- Produces: `cancelOrders(admin, { orderIds: string[]; actorUserId: string }): Promise<{ cancelled: Array<{ id: string; prevStatus: string }>; conflicts: string[]; failed: Array<{ id: string; error: string }>; actualChanged: boolean }>` — 한 건씩 RPC. 상태가 바뀐 주문(conflict)은 `conflicts` 에 담고 실패로 치지 않는다.

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/cancel-order.test.ts`:

```ts
// 공용 취소(D14) — 주문마다 cancel 사건 RPC. conflict 는 건너뛰고, 그 밖의 실패는 모은다.
import { describe, expect, it, vi } from 'vitest'
import { cancelOrders } from '@/lib/agent/cancelOrder'

const O1 = '22222222-2222-4222-8222-222222222222'
const O2 = '33333333-3333-4333-8333-333333333333'
function admin(replies: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const rpc = vi.fn(async () => { const r = replies.shift() ?? { data: null }; return { data: r.data ?? null, error: r.error ?? null } })
  return { client: { rpc } as never, rpc }
}
const ok = (prev: string, actualChanged = false) => ({ data: { ok: true, order_status: 'cancelled', prev_status: prev, stage: 'as', actual_pct: 0, stage_changed: actualChanged, actual_changed: actualChanged, reached_first: false, skipped: null } })

describe('cancelOrders', () => {
  it('주문마다 cancel 사건을 부르고 직전 status 를 모은다', async () => {
    const { client, rpc } = admin([ok('claimed', true), ok('ready')])
    const r = await cancelOrders(client, { orderIds: [O1, O2], actorUserId: 'u1' })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'cancel', p_order_id: O1, p_actor: 'u1' }))
    expect(r).toEqual({ cancelled: [{ id: O1, prevStatus: 'claimed' }, { id: O2, prevStatus: 'ready' }], conflicts: [], failed: [], actualChanged: true })
  })
  it('상태가 바뀐 주문은 conflicts, RPC 오류는 failed', async () => {
    const { client } = admin([{ data: { ok: false, conflict: true, order_status: 'reported' } }, { error: { message: 'boom' } }])
    const r = await cancelOrders(client, { orderIds: [O1, O2], actorUserId: 'u1' })
    expect(r.cancelled).toEqual([])
    expect(r.conflicts).toEqual([O1])
    expect(r.failed).toEqual([{ id: O2, error: '전이 실패: boom' }])
  })
  it('빈 목록이면 RPC 를 부르지 않는다', async () => {
    const { client, rpc } = admin([])
    expect(await cancelOrders(client, { orderIds: [], actorUserId: 'u1' })).toEqual({ cancelled: [], conflicts: [], failed: [], actualChanged: false })
    expect(rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/cancel-order.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 헬퍼를 쓴다**

`src/lib/agent/cancelOrder.ts`:

```ts
// 공용 취소(설계 상태 스펙 D14) — 위임 해제·「중단」·개발 워크플로 끄기·스텁 제거·import 의 표식 제거(L7)가 모두 이 함수를 쓴다.
// 주문마다 RPC cancel 사건 하나(0108): 주문 cancelled·점유·설계 상태·claim_scope·runner 를 지우고, claimed 이거나 단계 dd 면
// 단계·실적을 as 로 되돌린다. 종전의 "주문 UPDATE 뒤 set_stage as" 두 단계가 한 트랜잭션이 된다(태그 잠금에도 걸리지 않는다).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'

export type CancelOrdersResult = {
  cancelled: Array<{ id: string; prevStatus: string }>
  /** 판정과 쓰기 사이에 상태가 바뀐 주문(보고됨 등) — 실패가 아니라 "취소 대상이 아니게 됨". */
  conflicts: string[]
  failed: Array<{ id: string; error: string }>
  /** 단계·실적이 되돌아간 주문이 있으면 참 — 호출부가 진척 스냅샷을 남긴다. */
  actualChanged: boolean
}

export async function cancelOrders(admin: AdminClient, args: { orderIds: string[]; actorUserId: string }): Promise<CancelOrdersResult> {
  const out: CancelOrdersResult = { cancelled: [], conflicts: [], failed: [], actualChanged: false }
  for (const id of args.orderIds) {
    const r = await applyWorkflowEvent(admin, { event: 'cancel', actorUserId: args.actorUserId, orderId: id })
    if (r.ok) {
      out.cancelled.push({ id, prevStatus: r.prevStatus ?? 'unknown' })
      if (r.actualChanged) out.actualChanged = true
    } else if (r.conflict) {
      out.conflicts.push(id)
    } else {
      console.error('[cancelOrders] 취소 실패:', id, r.error)
      out.failed.push({ id, error: r.error })
    }
  }
  return out
}
```

- [ ] **Step 4: 네 경로를 헬퍼로 바꾼다**

① `src/lib/agent/delegation.ts` — import 에 `import { cancelOrders } from '@/lib/agent/cancelOrder'` 를 더하고, OFF 갈래(`// ready·claimed 는 체크 해제만으로 취소한다` 주석부터 `const extra = {` 직전까지)를 아래로 바꾼다. `applyWorkflowEvent` import 는 dev_workflow ON 갈래가 계속 쓰므로 둔다.

```ts
    // ready·claimed 는 체크 해제만으로 취소한다(2026-08-24 — 위임을 끄면 그 항목엔 에이전트를 더 안 쓰겠다는
    // 뜻이니 대기 중이든 작업 중이든 그대로 끝낸다). 허브·좌석의 "중단" 버튼(2026-09-19)도 이 경로를 탄다.
    // reported 는 이미 결과물이 올라온 상태라 취소로 지우지 않는다 — 승인·반려로만 정리한다.
    // 취소는 RPC cancel 사건(설계 상태 스펙 D14) — 설계 상태·범위·도는 PC 를 지우고, claimed 이거나 단계 dd 면 as 로 되돌린다.
    const { data: active, error: actErr } = await admin
      .from('agent_work_orders').select('id, status').eq('wbs_item_id', itemId)
      .in('status', ['ready', 'claimed', 'reported'])
    if (actErr) return { ok: false, error: `주문 조회 실패: ${actErr.message}` }
    const rows = (active ?? []) as Array<{ id: string; status: string }>
    const cancelIds = rows.filter(o => o.status === 'ready' || o.status === 'claimed').map(o => o.id)
    const c = await cancelOrders(admin, { orderIds: cancelIds, actorUserId })
    if (c.failed.length > 0) return { ok: false, error: `주문 취소 실패: ${c.failed.map(f => f.error).join(' / ')}` }
    // 실제로 취소된 주문 중 직전이 claimed 였던 것 — 워커가 돌던 주문이다(2026-09-19 중단 설계 §1).
    const cancelledClaimedIds = c.cancelled.filter(x => x.prevStatus === 'claimed').map(x => x.id)
    const actualChanged = c.actualChanged
    if (rows.some(o => o.status === 'reported') || c.conflicts.length > 0) {
      warnings.push('완료 보고가 이미 올라온 주문은 취소되지 않았습니다 — 진행 상황에서 승인·반려로 정리하세요.')
    }
```

(바로 뒤의 `const extra = {…}` 와 `return` 은 그대로 둔다 — `cancelledClaimedIds`·`actualChanged` 이름이 같다.)

② `src/app/actions/agentHub.ts` 의 `stopOrderByAdmin` — 항목이 지워진 주문 갈래(`} else {` 안의 `admin.from('agent_work_orders').update({ status: 'cancelled', …`)를 바꾼다:

```ts
  } else {
    const c = await cancelOrders(admin, { orderIds: [orderId], actorUserId })
    if (c.failed.length > 0) return { ok: false, error: `주문 취소 실패: ${c.failed[0].error}` }
    if (!c.cancelled.some(x => x.id === orderId && x.prevStatus === 'claimed')) {
      return { ok: false, error: '상태가 바뀌어 작업을 중단하지 못했습니다. 다시 시도하세요.' }
    }
  }
```

파일 머리 import 에 `import { cancelOrders } from '@/lib/agent/cancelOrder'` 를 더한다.

③ `src/app/actions/wbsAssign.ts` 의 dev_workflow OFF 갈래(`// OFF — 갱신된 항목들의 ready 주문만 일괄 취소` 블록)를 바꾼다:

```ts
  } else {
    // OFF — 갱신된 항목들의 ready 주문만 취소(claimed/reported 는 진행 중이라 건드리지 않음). RPC cancel 사건이
    // 단계 dd 의 확정 설계를 as 로 되돌린다(설계 상태 스펙 D14).
    const { data: readyRows, error: readyErr } = await admin
      .from('agent_work_orders').select('id').in('wbs_item_id', updatedIds).eq('status', 'ready')
    if (readyErr) {
      console.error('[wbsAssign] dev_workflow OFF 주문 조회 실패:', readyErr.message)
      cascadeFailed = true
    } else {
      const c = await cancelOrders(admin, { orderIds: ((readyRows ?? []) as Array<{ id: string }>).map(r => r.id), actorUserId: g.actor.userId })
      if (c.failed.length > 0) cascadeFailed = true
    }
  }
```

파일 머리 import 에 `cancelOrders` 를 더한다.

④ `src/lib/agent/forceProgress.ts` 의 스텁 제거(`if (list.length > 0) {` 블록)를 바꾼다:

```ts
  if (list.length > 0) {
    const c = await cancelOrders(admin, { orderIds: list.map(o => o.id), actorUserId: a.actorUserId })
    if (c.failed.length > 0) return { ok: false, error: `주문 취소 실패: ${c.failed[0].error}` }
    if (c.cancelled.length !== list.length) return { ok: false, error: '상태가 바뀌어 취소하지 못했습니다. 다시 시도하세요.' }
  }
```

파일 머리 import 에 `import { cancelOrders } from '@/lib/agent/cancelOrder'` 를 더한다.

⑤ `src/lib/agent/wbsImport.ts` — import 가 위임 표식을 떼면 그 항목의 ready·claimed 주문을 취소한다(L7, P15). `runWbsImport` 에서 `const stubConflicts = …` 검사 뒤, `import_wbs_upsert` 호출 **앞**에 표식이 빠질 항목을 구한다:

```ts
  // L7(설계 상태 스펙 12절) — 이번 업로드로 위임 표식(agent)이 빠지는 기존 항목. RPC 가 tags 를 덮어쓰므로 호출 전에 읽는다.
  const untagRefs = (rpcNodes as Array<{ external_ref: string; tags: string[] }>)
    .filter(n => !(n.tags ?? []).includes(AGENT_TAG)).map(n => n.external_ref)
  const losingIds: string[] = []
  for (const refChunk of chunked(untagRefs, IN_CHUNK)) {
    const { data, error } = await admin.from('wbs_items').select('id, tags')
      .eq('project_id', projectId).in('external_ref', refChunk)
    if (error) throw new Error(`표식 확인 조회 실패: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; tags: string[] | null }>) if ((r.tags ?? []).includes(AGENT_TAG)) losingIds.push(r.id)
  }
```

`applyAssigneesAndOrders(...)` 호출 **앞**(upsert 뒤)에 취소를 넣는다:

```ts
  // 표식이 빠진 항목의 ready·claimed 주문을 공용 취소로 끝낸다(L7) — 확정 설계가 표식 없이 떠 있지 않게.
  let delegationCancelled = 0
  if (losingIds.length > 0) {
    const act: string[] = []
    for (const idChunk of chunked(losingIds, IN_CHUNK)) {
      const { data, error } = await admin.from('agent_work_orders').select('id')
        .in('wbs_item_id', idChunk).in('status', ['ready', 'claimed'])
      if (error) throw new Error(`표식 제거 주문 조회 실패: ${error.message}`)
      act.push(...((data ?? []) as Array<{ id: string }>).map(r => r.id))
    }
    const c = await cancelOrders(admin, { orderIds: act, actorUserId })
    if (c.failed.length > 0) throw new Error(`표식 제거 주문 취소 실패: ${c.failed.map(f => f.error).join(' / ')}`)
    delegationCancelled = c.cancelled.length
  }
```

`RunWbsImportResult` 의 ok 갈래에 `delegationCancelled: number` 를 더하고 마지막 `return { ok: true, … }` 에 `delegationCancelled` 를 싣는다. 파일 머리 import 에 `import { AGENT_TAG } from '@/lib/domain/seatmap'` 와 `import { cancelOrders } from '@/lib/agent/cancelOrder'` 를 더한다(`chunked`·`IN_CHUNK` 는 같은 파일에 이미 있다 — 선언이 아래에 있으면 함수 호이스팅이 아닌 `const` 이므로, `IN_CHUNK` 선언을 `runWbsImport` 보다 위로 옮긴다).

- [ ] **Step 5: 기존 테스트를 새 경로에 맞춘다**

Run: `npx vitest run tests/agent/cancel-order.test.ts tests/actions tests/agent tests/domain/force-progress.test.ts`
Expected: 새 테스트 PASS. 기존 테스트는 셋을 고친다.

1. "주문 UPDATE status=cancelled" 나 "set_stage as" 호출을 단언하던 테스트는 `admin.rpc('apply_workflow_event', expect.objectContaining({ p_event: 'cancel', p_order_id: … }))` 를 단언하도록 바꾼다. 목에 `rpc` 가 없으면 `rpc: vi.fn(async () => ({ data: { ok: true, order_status: 'cancelled', prev_status: '<직전 status>', stage_changed: false, actual_changed: false, reached_first: false, skipped: null }, error: null }))` 를 더한다.
2. import 라우트 테스트(`tests/agent/wbs-import.test.ts`·`wbs-import-nlevel.test.ts`)는 표식 확인 조회가 upsert 전에 `wbs_items` 큐를 하나 먼저 소비한다. 노드의 `tags` 에 `agent` 가 없는 테스트마다 `wbs_items` 큐 맨 앞에 `{ data: [] }`(표식이 빠지는 기존 항목 없음)를 넣는다.
3. `src/app/api/v1/wbs/import/route.ts:85-86` 응답에 `delegation_cancelled: result.delegationCancelled,` 를 더한다(웹 업로드 액션 `src/app/actions/wbsMarkdown.ts:182` 은 결과를 그대로 넘기므로 고칠 것이 없다).

그리고 `tests/agent/wbs-import.test.ts` 의 `describe('POST /wbs/import'` 안에 L7 테스트를 더한다:

```ts
  it('업로드가 위임 표식을 떼면 그 항목의 ready·claimed 주문을 cancel 로 취소한다(L7)', async () => {
    const { token, row } = patRow()
    const body = { project_id: PROJECT_ID, module: 'MES', nodes: [NODE({ id: 'T-A' })] } // tags: [] — 표식 없음
    const admin = useAdmin({
      agent_runners: [{ data: row }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [{ role: 'admin' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_members: [{ data: [] }],
      wbs_items: [
        { data: [{ id: 'id-a', tags: ['agent'] }] },                              // L7 표식 확인 — 기존 항목은 표식이 있었다
        { data: [{ id: 'id-a', external_ref: 'MES/T-A', dev_workflow: true }] },  // 갭 후보 조회
      ],
      agent_work_orders: [
        { data: [{ id: 'order-a' }] },         // L7 — 표식이 빠진 항목의 ready·claimed 주문
        { data: [{ wbs_item_id: 'id-a' }] },   // 갭 판정 — 활성 주문으로 본다(취소 뒤 재발행은 이 테스트 범위 밖)
      ],
    }, [
      { data: { upserted: 1, skipped: 0, ids: { 'MES/T-A': 'id-a' }, new_refs: [] } },    // import_wbs_upsert
      { data: { ok: true, order_status: 'cancelled', prev_status: 'claimed', stage: 'as', actual_pct: 0,
        stage_changed: true, actual_changed: true, reached_first: false, skipped: null } }, // apply_workflow_event(cancel)
    ])
    const res = await importPOST(post(body, token))
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'cancel', p_order_id: 'order-a' }))
    expect(await res.json()).toMatchObject({ ok: true, delegation_cancelled: 1 })
  })
```

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/cancelOrder.ts src/lib/agent/delegation.ts src/app/actions/agentHub.ts src/app/actions/wbsAssign.ts \
  src/lib/agent/forceProgress.ts src/lib/agent/wbsImport.ts src/app/api/v1/wbs/import/route.ts tests/agent/cancel-order.test.ts
git add $(git diff --name-only -- tests)   # Step 5 에서 고친 기존 테스트(파일명을 확인하고 add 한다)
git commit -m "feat(design-state): 주문 취소 네 경로를 RPC cancel 사건 하나로 모으고, import 가 표식을 떼면 주문을 취소한다

취소가 설계 상태·범위·도는 PC 를 함께 지우고 claimed·dd 를 as 로 되돌린다(D14). 업로드가 위임 표식을 떼면
확정 설계가 표식 없이 남지 않게 ready·claimed 주문을 취소한다(L7).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git add $(git diff --name-only -- tests)` 는 이 Task 에서 고친 테스트만 올리는지 `git diff --name-only -- tests` 출력을 먼저 눈으로 확인한 뒤 쓴다.)

---

## Task 8: 발행 차단(D26) — 이미 진행된 항목에는 새 주문을 만들지 않는다

**Files:**
- Modify: `src/lib/agent/ensureOrder.ts:10-72`, `src/lib/agent/delegation.ts:141-144`
- Test: `tests/agent/ensure-order.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `ensureOrderForWorkflowLeaf` 의 `reason` 에 `'progressed'` — 단계 ip 이상·실적 100·approved 주문이 있으면 만들지 않는다(`alreadyProgressed` 와 같은 조건).

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/ensure-order.test.ts` 에 더한다(파일의 `MockAdminClient` 큐 관례: 등록 → 항목 → 하위 → approved → 활성 순으로 `maybeSingle` 이 소비한다):

```ts
  describe('D26 — 이미 진행된 항목에는 주문을 만들지 않는다', () => {
    it.each([
      ['단계 ip', { stage: 'ip', actual_pct: 30 }],
      ['단계 xx', { stage: 'xx', actual_pct: 100 }],
      ['실적 100', { stage: 'as', actual_pct: 100 }],
    ])('%s 면 progressed', async (_n, extra) => {
      const admin = new MockAdminClient()
      admin.enqueue({ data: { enabled: true }, error: null })
      admin.enqueue({ data: { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, ...extra }, error: null })
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'progressed' })
      expect(admin.lastInsertPayload).toBeNull()
    })
    it('approved 주문이 있으면 progressed', async () => {
      const admin = new MockAdminClient()
      admin.enqueue({ data: { enabled: true }, error: null })
      admin.enqueue({ data: { name: 't', priority: null, external_ref: null, assignee_member_id: null, dev_workflow: true, stage: 'im', actual_pct: 80 }, error: null })
      admin.enqueue({ data: null, error: null })          // 하위 없음
      admin.enqueue({ data: { id: 'o-old' }, error: null }) // approved 주문 있음
      const r = await ensureOrderForWorkflowLeaf(admin as unknown as AdminClient, { projectId: 'p', wbsItemId: 'w', actorUserId: 'u' })
      expect(r).toEqual({ ok: true, created: false, reason: 'progressed' })
    })
  })
```

(파일의 목에 큐 넣는 메서드 이름이 `enqueue` 가 아니면 그 이름을 쓴다. `lastInsertPayload` 는 이미 있다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/ensure-order.test.ts`
Expected: FAIL — 주문이 만들어진다(created true)

- [ ] **Step 3: 구현**

`src/lib/agent/ensureOrder.ts` — 반환 타입의 `reason` 에 `'progressed'` 를 더하고, 항목 조회 select 에 `stage, actual_pct` 를 더한 뒤 두 곳에 검사를 넣는다:

```ts
  | { ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' | 'not_workflow' | 'progressed' }
```

```ts
  const { data: item, error: itemErr } = await admin
    .from('wbs_items')
    .select('name, priority, external_ref, assignee_member_id, dev_workflow, stage, actual_pct')
    .eq('id', wbsItemId)
    .maybeSingle()
```

`row` 타입에 `stage: string | null; actual_pct: number | string | null` 를 더하고, `if (row.dev_workflow !== true) …` 바로 뒤에:

```ts
  // D26(설계 상태 스펙) — 이미 진행된 항목(단계 ip 이상·실적 100)에는 새 주문을 만들지 않는다. 완료 항목에 ready 가 생기면
  // 「재작업」이 0077 유니크 인덱스에 막히고, 재위임이 실적을 낮추던 결함도 여기서 닫는다.
  if (row.stage === 'ip' || row.stage === 'im' || row.stage === 'xx' || Number(row.actual_pct ?? 0) >= 100) {
    return { ok: true, created: false, reason: 'progressed' }
  }
```

리프 검증(Step 3) 뒤, 활성 주문 확인(Step 4) 앞에:

```ts
  // D26 — approved 주문이 있는 항목도 진행된 항목이다(「재작업」으로 다시 연다).
  const { data: approved, error: apprErr } = await admin
    .from('agent_work_orders').select('id').eq('wbs_item_id', wbsItemId).eq('status', 'approved').limit(1).maybeSingle()
  if (apprErr) return { ok: false, error: `승인 주문 확인 실패: ${apprErr.message}` }
  if (approved) return { ok: true, created: false, reason: 'progressed' }
```

`src/lib/agent/delegation.ts` 의 주문 보장 뒤(`if (!ord.created && ord.reason === 'not_leaf') …` 다음 줄)에 안내를 더한다:

```ts
      if (!ord.created && ord.reason === 'progressed') {
        warnings.push('이미 진행된 작업이라 새 주문을 만들지 않았습니다(단계 작업 중 이상·실적 100·승인된 주문) — 단계를 되돌리거나 「재작업」을 쓰세요.')
      }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/ensure-order.test.ts tests/agent tests/actions`
Expected: PASS. 기존 테스트 중 approved 조회가 새로 끼어 큐가 한 칸 밀리는 것은 그 자리에 `{ data: null, error: null }`(approved 없음)을 넣어 맞춘다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/ensureOrder.ts src/lib/agent/delegation.ts tests/agent/ensure-order.test.ts
git commit -m "feat(design-state): 이미 진행된 항목(ip 이상·실적 100·승인 주문)에는 새 주문을 만들지 않는다(D26)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 판단 재료 일괄 로더 `designFacts.ts`

**Files:**
- Create: `src/lib/agent/designFacts.ts`
- Test: `tests/agent/design-facts.test.ts`

**Interfaces:**
- Consumes: Task 1 `toDesignMode`·`toDesignState`·`toClaimScope`·`predsState`·`nextAgentAction`·`ItemFacts`·`OrderFacts`·`ActionResult`, `predecessorReached`(`src/lib/domain/agentWork.ts`)
- Produces:
  - `ORDER_FACT_COLUMNS = 'claimed_by, claimed_by_user_id, last_heartbeat_at, heartbeat_phase, heartbeat_agent, design_state, claim_scope, design_note, runner, runner_seen_at'` — `status` 는 넣지 않는다(호출부 select 가 이미 고른다. 같은 열을 두 번 고르지 않는다)
  - `ITEM_FACT_COLUMNS = 'id, project_id, external_ref, stage, actual_pct, tags, depends, depends_waived, design_mode'`
  - `type FactOrderRow`, `type FactItemRow`
  - `orderFactsOf(row: FactOrderRow): OrderFacts`
  - `loadItemFacts(admin, items: FactItemRow[]): Promise<Map<string, { facts: ItemFacts; depsUnmet: Array<{ external_ref: string; stage: string | null }> }>>` — 쿼리 셋(항목의 approved 주문, 선행 항목, 선행의 approved 주문). 조회 실패는 throw(호출부 500).
  - `hasApprovedOrder(admin, itemId): Promise<boolean>` — throw on error
  - `decide(item: ItemFacts | null, order: OrderFacts, nowMs): ActionResult` — 항목이 없으면 `skip`(사유 `항목이 지워진 주문`)
  - `designFieldsOf(row, action, mine)` — 응답에 실을 칸 `{ design_mode, design_state, design_note, claim_scope, runner, runner_seen_at, action, action_reason, deps_unmet, mine }`

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-facts.test.ts`:

```ts
// 판단 재료 일괄 로더 — 항목의 approved 주문·선행 도달을 배치로 구해 designGate 입력을 만든다.
import { describe, expect, it, vi } from 'vitest'
import { decide, designFieldsOf, hasApprovedOrder, loadItemFacts, orderFactsOf } from '@/lib/agent/designFacts'

type Resp = { data?: unknown; error?: { message: string } | null }
function useAdmin(queues: Record<string, Resp[]>) {
  const calls: Array<{ table: string; cols?: string }> = []
  return {
    calls,
    client: {
      from: vi.fn((table: string) => {
        const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
        const b: Record<string, unknown> = {}
        b.select = (cols: string) => { calls.push({ table, cols }); return b }
        for (const k of ['eq', 'in', 'limit', 'order']) b[k] = () => b
        b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
        return b
      }),
    } as never,
  }
}
const NOW = Date.parse('2026-09-27T12:00:00Z')

describe('orderFactsOf', () => {
  it('빈 값은 legacy·없음으로 정규화한다', () => {
    expect(orderFactsOf({ status: 'claimed', claimed_by: 'a/b/w1', claimed_by_user_id: 'u', last_heartbeat_at: null, heartbeat_phase: null,
      heartbeat_agent: null, design_state: null, claim_scope: null, runner: 'a/b/w1', runner_seen_at: null }))
      .toMatchObject({ status: 'claimed', claimScope: 'legacy', designState: null, runner: 'a/b/w1' })
  })
})

describe('loadItemFacts', () => {
  it('항목의 approved 주문과 선행 도달을 배치로 구한다', async () => {
    const { client } = useAdmin({
      agent_work_orders: [{ data: [{ wbs_item_id: 'w1' }] }, { data: [{ wbs_item_id: 'p2' }] }],
      wbs_items: [{ data: [
        { id: 'p1', project_id: 'P', external_ref: 'M/TSK-01-01', stage: 'ip', actual_pct: 30 },
        { id: 'p2', project_id: 'P', external_ref: 'M/TSK-01-02', stage: 'as', actual_pct: 0 },
      ] }],
    })
    const m = await loadItemFacts(client, [
      { id: 'w1', project_id: 'P', external_ref: 'M/TSK-01-03', stage: 'as', actual_pct: 0, tags: ['agent'], depends: ['M/TSK-01-01'], depends_waived: [], design_mode: 'review' },
      { id: 'w2', project_id: 'P', external_ref: 'M/TSK-01-04', stage: 'as', actual_pct: 0, tags: [], depends: ['M/TSK-01-02', 'M/TSK-01-09'], depends_waived: ['M/TSK-01-09'], design_mode: null },
    ])
    expect(m.get('w1')).toEqual({ facts: { mode: 'review', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: true, preds: 'ahead' }, depsUnmet: [{ external_ref: 'M/TSK-01-01', stage: 'ip' }] })
    // p2 는 approved 주문이 있어 도달, TSK-01-09 는 면제
    expect(m.get('w2')).toEqual({ facts: { mode: 'auto', stage: 'as', actualPct: 0, delegated: false, hasApprovedOrder: false, preds: 'met' }, depsUnmet: [] })
  })
  it('항목이 없으면 조회하지 않는다', async () => {
    const { client, calls } = useAdmin({})
    expect((await loadItemFacts(client, [])).size).toBe(0)
    expect(calls).toEqual([])
  })
  it('조회 실패는 throw(위장하지 않는다)', async () => {
    const { client } = useAdmin({ agent_work_orders: [{ error: { message: 'boom' } }] })
    await expect(loadItemFacts(client, [{ id: 'w1', project_id: 'P', external_ref: null, stage: 'as', actual_pct: 0, tags: [], depends: [], depends_waived: [], design_mode: 'auto' }]))
      .rejects.toThrow('boom')
  })
})

describe('decide·designFieldsOf·hasApprovedOrder', () => {
  it('항목이 지워진 주문은 skip', () => {
    const o = orderFactsOf({ status: 'ready', claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, runner: null, runner_seen_at: null })
    expect(decide(null, o, NOW)).toEqual({ action: 'skip', reason: '항목이 지워진 주문', depsUnmet: false })
  })
  it('응답 칸을 snake_case 로 싣는다', () => {
    expect(designFieldsOf(
      { design_state: 'review', claim_scope: 'design', design_note: 'x', runner: null, runner_seen_at: null },
      'review', { action: 'wait', reason: '설계 검토 대기', depsUnmet: false }, true,
    )).toEqual({ design_mode: 'review', design_state: 'review', design_note: 'x', claim_scope: 'design', runner: null, runner_seen_at: null,
      action: 'wait', action_reason: '설계 검토 대기', deps_unmet: false, mine: true })
  })
  it('hasApprovedOrder 는 한 건 조회', async () => {
    const { client } = useAdmin({ agent_work_orders: [{ data: { id: 'o' } }] })
    expect(await hasApprovedOrder(client, 'w1')).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-facts.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/lib/agent/designFacts.ts`:

```ts
// 판단 재료 일괄 로더(설계 상태 스펙 5.3·D22) — 목록·상세·watch·claim·build-start 가 designGate 에 넘길 재료를 모은다.
// 규칙은 여기 두지 않는다(src/lib/domain/designGate.ts 가 원본). 조회만 하고, 실패는 throw 해 호출부가 500 으로 답한다
// (게이트 재료를 "없음"으로 위장하면 막아야 할 claim 이 통과한다 — 에러 3원칙).
import type { AdminClient } from '@/lib/minutes/externalApi'
import { predecessorReached } from '@/lib/domain/agentWork'
import {
  nextAgentAction, predsState, toClaimScope, toDesignMode, toDesignState,
  type ActionResult, type DesignMode, type ItemFacts, type OrderFacts,
} from '@/lib/domain/designGate'
import type { AgentOrderStatus } from '@/lib/domain/agentWork'

/** 주문 select 에 덧붙이는 판단 재료 열 — status 는 호출부가 이미 고른다. */
export const ORDER_FACT_COLUMNS =
  'claimed_by, claimed_by_user_id, last_heartbeat_at, heartbeat_phase, heartbeat_agent, design_state, claim_scope, design_note, runner, runner_seen_at'
export const ITEM_FACT_COLUMNS = 'id, project_id, external_ref, stage, actual_pct, tags, depends, depends_waived, design_mode'
const IN_CHUNK = 200

export type FactOrderRow = {
  status: string; claimed_by: string | null; claimed_by_user_id: string | null
  last_heartbeat_at: string | null; heartbeat_phase: string | null; heartbeat_agent?: string | null
  design_state?: string | null; claim_scope?: string | null; design_note?: string | null
  runner?: string | null; runner_seen_at?: string | null
}
export type FactItemRow = {
  id: string; project_id: string; external_ref: string | null; stage: string | null; actual_pct: number | string | null
  tags: string[] | null; depends: string[] | null; depends_waived: string[] | null; design_mode: string | null
}

/** 주문 행 → designGate OrderFacts. 0108 전 행·목(열 없음)은 없음·legacy 로 본다. */
export function orderFactsOf(row: FactOrderRow): OrderFacts {
  return {
    status: row.status as AgentOrderStatus,
    designState: toDesignState(row.design_state ?? null),
    claimScope: toClaimScope(row.claim_scope ?? null),
    runner: row.runner ?? null,
    runnerSeenAt: row.runner_seen_at ?? null,
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    heartbeatPhase: row.heartbeat_phase ?? null,
    heartbeatAgent: row.heartbeat_agent ?? null,
    claimedBy: row.claimed_by ?? null,
    claimedByUserId: row.claimed_by_user_id ?? null,
  }
}

function chunked<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function approvedItemIds(admin: AdminClient, itemIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (const c of chunked(itemIds, IN_CHUNK)) {
    const { data, error } = await admin.from('agent_work_orders').select('wbs_item_id').in('wbs_item_id', c).eq('status', 'approved')
    if (error) throw new Error(`승인 주문 조회 실패: ${error.message}`)
    for (const r of (data ?? []) as Array<{ wbs_item_id: string | null }>) if (r.wbs_item_id) out.add(r.wbs_item_id)
  }
  return out
}

/** 한 항목의 approved 주문 여부(claim·build-start 라우트용). 조회 실패는 throw. */
export async function hasApprovedOrder(admin: AdminClient, itemId: string): Promise<boolean> {
  const { data, error } = await admin.from('agent_work_orders').select('id').eq('wbs_item_id', itemId).eq('status', 'approved').limit(1).maybeSingle()
  if (error) throw new Error(`승인 주문 조회 실패: ${error.message}`)
  return data !== null
}

/**
 * 항목들의 ItemFacts — approved 주문(D26)과 선행 도달(predecessorReached, 면제 포함)을 배치로 구한다.
 * 선행은 같은 프로젝트의 external_ref 로 찾는다. 프로젝트에 없는 ref 는 미충족(단계 null — fail-closed, claim 게이트와 같다).
 */
export async function loadItemFacts(
  admin: AdminClient, items: readonly FactItemRow[],
): Promise<Map<string, { facts: ItemFacts; depsUnmet: Array<{ external_ref: string; stage: string | null }> }>> {
  const out = new Map<string, { facts: ItemFacts; depsUnmet: Array<{ external_ref: string; stage: string | null }> }>()
  if (items.length === 0) return out
  const approved = await approvedItemIds(admin, items.map(i => i.id))
  const refs = [...new Set(items.flatMap(i => (i.depends ?? []).filter(r => !(i.depends_waived ?? []).includes(r))))]
  const projects = [...new Set(items.map(i => i.project_id))]
  const preds = new Map<string, { id: string; stage: string | null; actual_pct: number | string | null }>()
  if (refs.length > 0) {
    for (const c of chunked(refs, IN_CHUNK)) {
      const { data, error } = await admin.from('wbs_items').select('id, project_id, external_ref, stage, actual_pct')
        .in('project_id', projects).in('external_ref', c)
      if (error) throw new Error(`선행 항목 조회 실패: ${error.message}`)
      for (const p of (data ?? []) as Array<{ id: string; project_id: string; external_ref: string; stage: string | null; actual_pct: number | string | null }>) {
        preds.set(`${p.project_id}|${p.external_ref}`, p)
      }
    }
  }
  const predApproved = preds.size > 0 ? await approvedItemIds(admin, [...preds.values()].map(p => p.id)) : new Set<string>()
  for (const i of items) {
    const waived = i.depends_waived ?? []
    const depsUnmet: Array<{ external_ref: string; stage: string | null }> = []
    for (const ref of i.depends ?? []) {
      if (waived.includes(ref)) continue
      const p = preds.get(`${i.project_id}|${ref}`)
      if (!p) { depsUnmet.push({ external_ref: ref, stage: null }); continue }
      const reached = predecessorReached({ stage: p.stage, orderApproved: predApproved.has(p.id), actualPct: p.actual_pct == null ? null : Number(p.actual_pct) })
      if (!reached) depsUnmet.push({ external_ref: ref, stage: p.stage })
    }
    out.set(i.id, {
      facts: {
        mode: toDesignMode(i.design_mode), stage: i.stage, actualPct: i.actual_pct == null ? null : Number(i.actual_pct),
        delegated: (i.tags ?? []).includes('agent'), hasApprovedOrder: approved.has(i.id), preds: predsState(depsUnmet),
      },
      depsUnmet,
    })
  }
  return out
}

/** 항목이 지워진 주문은 판단하지 않는다(skip) — 그 밖은 designGate.nextAgentAction. */
export function decide(item: ItemFacts | null, order: OrderFacts, nowMs: number): ActionResult {
  if (item === null) return { action: 'skip', reason: '항목이 지워진 주문', depsUnmet: false }
  return nextAgentAction(item, order, nowMs)
}

/** 계약 2.11 응답 칸(목록·상세·watch 공통, PAT 응답에만). */
export function designFieldsOf(
  row: Pick<FactOrderRow, 'design_state' | 'claim_scope' | 'design_note' | 'runner' | 'runner_seen_at'>,
  mode: DesignMode | string | null, a: ActionResult, mine: boolean,
) {
  return {
    design_mode: toDesignMode(mode), design_state: toDesignState(row.design_state ?? null), design_note: row.design_note ?? null,
    claim_scope: row.claim_scope ?? null, runner: row.runner ?? null, runner_seen_at: row.runner_seen_at ?? null,
    action: a.action, action_reason: a.reason, deps_unmet: a.depsUnmet, mine,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/design-facts.test.ts && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/designFacts.ts tests/agent/design-facts.test.ts
git commit -m "feat(design-state): 목록·상세·watch 가 쓰는 판단 재료 일괄 로더

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
## Task 10: claim 라우트 — 범위와 설계 관문

**Files:**
- Modify: `src/lib/agent/routeShared.ts:24-46`(주문 행 열), `src/app/api/v1/agent/work/[id]/claim/route.ts`, `src/lib/agent/depends.ts:83-91`(설계 선행 판정 함수 삭제)
- Test: `tests/agent/design-state-claim.test.ts`(새), `tests/agent/design-first.test.ts`(문구·dd 허용 갱신)

**Interfaces:**
- Consumes: Task 1 `CLAIM_REQUEST_SCOPES`·`canClaim`·`predsState`·`toDesignMode`, Task 6 `applyWorkflowEvent`(scope·cas·runner), Task 9 `hasApprovedOrder`·`orderFactsOf`·`ORDER_FACT_COLUMNS`
- Produces:
  - 요청: `POST /work/{id}/claim` 본문 `scope?: 'full'|'design'|'build'`(없으면 legacy). 모르는 값은 400.
  - 거부: 409 `design_gate`·`design_not_accepted`(본문 `error`·`code`), 403 `dependency_not_met`(본문 `unmet`, 설계 선행이 너무 이르면 `reason: design_first_too_early`)
  - 응답(PAT 만): `claim_scope`
  - `routeShared` 의 `OrderRow` 에 `last_heartbeat_at`·`heartbeat_phase`·`heartbeat_agent`·`design_state`·`claim_scope`·`design_note`·`runner`·`runner_seen_at`(모두 선택, 없으면 null 로 본다)

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-state-claim.test.ts` — `tests/agent/design-first.test.ts` 의 목·요청 헬퍼(`mocks`·`useAdmin`·`post`·`ITEM_ROW`·`member`·`ctx`)를 그대로 복사해 머리에 두고 아래 테스트를 쓴다(헬퍼를 import 로 나누지 않는다 — 테스트 파일끼리 의존하지 않는 것이 이 리포 관례다):

```ts
describe('claim — 범위와 설계 관문(설계 상태 스펙 5.2)', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
  const claim = (extra: Record<string, unknown> = {}) =>
    claimPOST(post('claim', { user_email: USER.email, agent: 'hong/mbp/w1', ...extra }), ctx)

  it('scope design — review 방식이면 통과하고 RPC 에 범위·CAS·runner 를 싣는다', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],   // 주문 로드, 항목의 approved 주문 없음
      ...member(),
      wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'review' }) }],
    })
    const res = await claim({ scope: 'design' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_scope: 'design', p_runner: 'hong/mbp/w1',
      p_cas: { design_state: null, design_mode: 'review' },
    }))
  })
  it('scope 없음(legacy) + review 방식 → 409 design_gate, RPC 를 부르지 않는다(옛 킷은 일시 제외로 끝난다)', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'review' }) }] })
    const res = await claim()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('scope build — human·accepted·dd 가 아니면 409 design_not_accepted', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'human', stage: 'as' }) }] })
    const res = await claim({ scope: 'build' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_not_accepted' })
  })
  it('scope build — 확정된 사람 설계(ready·accepted·dd)면 통과', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...ORDER, design_state: 'accepted' } }, { data: null }],
      ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, design_mode: 'human', stage: 'dd' }) }],
    })
    const res = await claim({ scope: 'build' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_scope: 'build', p_cas: { design_state: 'accepted', design_mode: 'human' } }))
  })
  it('이미 진행된 항목(실적 100)은 409 design_gate(D26·L6)', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: null }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null, actual_pct: 100 }) }] })
    expect((await claim({ scope: 'full' })).status).toBe(409)
  })
  it('approved 주문이 있는 항목은 409 design_gate(D26)', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }, { data: { id: 'o-old' } }], ...member(), wbs_items: [{ data: ITEM_ROW({ depends: null }) }] })
    expect((await claim({ scope: 'full' })).status).toBe(409)
  })
  it('설계 선행 — 미충족 선행이 dd 여도 허용한다(D15)', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }, { data: null }],   // 주문, 선행 approved 없음, 항목 approved 없음
      ...member(), wbs_items: [{ data: ITEM_ROW() }, { data: [dep('dd', { actual_pct: 20 })] }],
    })
    const res = await claim({ design_first: true })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_stage: 'ds' }))
  })
  it('모르는 scope 는 400', async () => {
    useAdmin({})
    expect((await claim({ scope: 'weird' })).status).toBe(400)
  })
})
```

`ITEM_ROW` 복사본의 기본값에 `actual_pct: 0, design_mode: 'auto'` 를 더한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-state-claim.test.ts`
Expected: FAIL(scope 무시·design_gate 없음)

- [ ] **Step 3: 주문 행 열을 넓힌다**

`src/lib/agent/routeShared.ts` — `OrderRow` 와 `fetchOrderRow` 의 select 를 바꾼다:

```ts
type OrderRow = {
  id: string; project_id: string; status: string
  claimed_by: string | null; claimed_by_user_id: string | null; wbs_item_id: string | null
  /** 마지막 heartbeat 의 실행 모델(0100) — report 가 보고 행에 복사한다(0105). last_heartbeat_at 이 null 이면 무효. */
  heartbeat_model?: string | null; last_heartbeat_at?: string | null
  /** 설계 상태 재료(0108) — 0108 전 행·목에는 없다(없음·legacy 로 본다, designFacts.orderFactsOf). */
  heartbeat_phase?: string | null; heartbeat_agent?: string | null
  design_state?: string | null; claim_scope?: string | null; design_note?: string | null
  runner?: string | null; runner_seen_at?: string | null
}
```

```ts
  const { data: order, error } = await admin
    .from('agent_work_orders')
    .select(`id, project_id, status, wbs_item_id, heartbeat_model, ${ORDER_FACT_COLUMNS}`)
    .eq('id', id).maybeSingle()
```

파일 머리에 `import { ORDER_FACT_COLUMNS } from '@/lib/agent/designFacts'` 를 더한다(`ORDER_FACT_COLUMNS` 가 `claimed_by·claimed_by_user_id·last_heartbeat_at` 를 이미 담는다).

- [ ] **Step 4: claim 라우트를 고친다**

`src/app/api/v1/agent/work/[id]/claim/route.ts`:

1. import 를 바꾼다 — `designFirstTooEarly` 를 빼고 둘을 더한다:

```ts
import { ITEM_DETAIL_COLUMNS, loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { hasApprovedOrder, orderFactsOf } from '@/lib/agent/designFacts'
import { CLAIM_REQUEST_SCOPES, canClaim, predsState, toDesignMode, type ClaimScope } from '@/lib/domain/designGate'
```

2. `ItemDetail` 타입에 `stage?: string | null; tags?: string[] | null; actual_pct?: number | string | null; design_mode?: string | null` 를 더한다.

3. `const designFirst = designFirstRaw === true` 다음에 범위를 읽는다:

```ts
  // 범위(계약 2.11, 설계 상태 스펙 5.2·D21) — 없으면 legacy(옛 킷·수동 claim). 모르는 값은 조용히 legacy 로 삼키지 않는다.
  const scopeRaw = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).scope : undefined
  if (scopeRaw !== undefined && (typeof scopeRaw !== 'string' || !(CLAIM_REQUEST_SCOPES as readonly string[]).includes(scopeRaw))) {
    return apiBadRequest(`scope 는 ${CLAIM_REQUEST_SCOPES.join('|')} 중 하나여야 합니다.`)
  }
  const scope: ClaimScope = (scopeRaw as ClaimScope | undefined) ?? 'legacy'
```

4. 항목 조회 select 를 `` `${ITEM_DETAIL_COLUMNS}, actual_pct, design_mode` `` 로 바꾼다.

5. 선행 블록(`const depends = item?.depends ?? []` 부터 그 `if` 블록 끝까지)을 아래로 바꾼다 — 선행 거부는 이제 `canClaim` 이 낸다:

```ts
      const depends = item?.depends ?? []
      if (depends.length > 0) {
        dependsInfo = await loadDependsInfo(admin, { projectId: loaded.order.project_id, depends, waived: item?.depends_waived ?? [] })
        // 충족 판정은 depends_evidence 의 reached 하나다(predecessorReached — 스펙 2026-09-15 §3.7). 응답의 reached 와 같은
        // 값으로 막아야 스킬과 서버가 서로 다른 판정을 하지 않는다. 설계 선행은 미충족 선행이 모두 dd·ip 면 허용한다(설계 상태 스펙 D15).
        unmetOut = dependsInfo.filter((d) => !d.reached).map((d) => ({ external_ref: d.external_ref, stage: d.stage }))
      }
    }

    // 설계 관문(설계 상태 스펙 5.2 claim·D26) — 방식·설계 상태·진행 여부·선행을 designGate 하나로 판정한다.
    // 항목이 지워진 주문은 관문을 보지 않는다(종전처럼 claim 되고 RPC 가 단계·실적만 건너뛴다).
    const order = orderFactsOf(loaded.order)
    const mode = toDesignMode(item?.design_mode)
    if (item && loaded.order.wbs_item_id) {
      const refusal = canClaim({
        mode, stage: item.stage ?? null, actualPct: item.actual_pct == null ? null : Number(item.actual_pct),
        delegated: (item.tags ?? []).includes('agent'), hasApprovedOrder: await hasApprovedOrder(admin, loaded.order.wbs_item_id),
        preds: predsState(unmetOut),
      }, order.designState, scope, designFirst)
      if (refusal) {
        return NextResponse.json({
          error: refusal.message, code: refusal.code, ...(refusal.reason ? { reason: refusal.reason } : {}),
          ...(refusal.code === 'dependency_not_met' ? { unmet: unmetOut } : {}),
        }, { status: refusal.status })
      }
    }
```

(바깥 `if (loaded.order.wbs_item_id) {` 블록의 닫는 중괄호 위치를 맞춘다 — 담당자 확인까지는 그 블록 안, 관문은 블록 밖이다.)

6. 전이 호출을 바꾼다:

```ts
    const transition = await applyWorkflowEvent(admin, {
      event: 'claim', actorUserId: loaded.userId, orderId: id,
      // legacy 범위에서만 p_stage 가 뜻이 있다(0107 설계 선행). full·design·build 는 RPC 가 범위로 단계를 정한다.
      stage: scope === 'legacy' && designFirst ? 'ds' : null,
      scope: scope === 'legacy' ? null : scope,
      cas: { design_state: order.designState, ...(item ? { design_mode: mode } : {}) },
      agent: actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
```

7. 응답에 PAT 만 범위를 싣는다:

```ts
    return NextResponse.json({
      ok: true, status: 'claimed', item, depends_evidence: dependsInfo,
      ...(designFirst ? { design_first: true, unmet: unmetOut } : {}),
      ...(actor.principal.kind === 'pat' ? { claim_scope: scope } : {}),
    })
```

`src/lib/agent/depends.ts` 의 `DESIGN_FIRST_PRED_STAGE`·`designFirstTooEarly`(83~91행)를 지운다(쓰는 곳이 claim 라우트뿐이었고, 규칙은 `designGate.predsState` 로 옮겼다).

- [ ] **Step 5: 기존 설계 선행 테스트를 새 규칙에 맞춘다**

`tests/agent/design-first.test.ts`:
- `it.each` 의 거부 목록에서 `['ds(선행도 설계만 하는 중 — 한 단계 깊이까지만)', 'ds']` 는 그대로 거부, 새 행 `['dd(설계 완료)는 허용', 'dd']` 는 허용 목록으로 옮긴다.
- 거부 본문의 `error` 문구 단언이 있으면 `'설계 선행은 미충족 선행이 모두 설계 완료(dd)·작업 중(ip)일 때만 할 수 있습니다.'` 로 바꾼다.
- `agent_work_orders` 큐 끝에 항목 approved 조회가 한 칸 더 소비된다 — 큐가 비면 `{ data: null }` 이 돌아와 "approved 없음" 이므로 대부분 그대로 통과한다. 실패하는 테스트만 그 자리에 `{ data: null }` 을 넣는다.

Run: `npx vitest run tests/agent/design-state-claim.test.ts tests/agent/design-first.test.ts tests/agent/claim-routes.test.ts tests/agent/depends-gate.test.ts tests/agent/write-routes-pat.test.ts tests/agent/stage-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/agent/routeShared.ts src/app/api/v1/agent/work/\[id\]/claim/route.ts src/lib/agent/depends.ts \
  tests/agent/design-state-claim.test.ts tests/agent/design-first.test.ts
git add $(git diff --name-only -- tests/agent)   # Step 5 에서 고친 파일만인지 먼저 눈으로 확인한다
git commit -m "feat(design-state): claim 이 범위를 받고 설계 관문을 designGate 로 집행한다

review·human 작업의 옛 킷 claim 은 409 design_gate 로 끝나고(일시 제외), 이미 진행된 항목은 claim 되지 않으며(D26),
설계 선행은 미충족 선행이 dd 여도 허용한다(D15). RPC 에 범위·CAS·도는 PC 를 싣는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: build-start 라우트 — runner → 설계 → 선행

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/build-start/route.ts`(전체)
- Test: `tests/agent/design-state-build-start.test.ts`(새), `tests/agent/design-first.test.ts`(build-start 부분)

**Interfaces:**
- Consumes: Task 1 `BUILD_SCOPES`·`canBuildStart`·`predsState`·`runnerFree`·`toDesignMode`, Task 9 `orderFactsOf`
- Produces:
  - 요청: 본문 `scope?: 'full'|'build'|'rework'`(없으면 legacy)
  - 거부: 409 `runner_active`(본문 `runner`·`runner_seen_at`), 409 `design_gate`(주문이 claimed 가 아니거나 CAS 불일치면 `reason: 'order_changed'`, Y7), 409 `design_not_accepted`, 403 `dependency_not_met`(`unmet`)
  - 응답: `runner`(호출 라벨)

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-state-build-start.test.ts` — `design-first.test.ts` 의 목·헬퍼를 복사해 머리에 두고:

```ts
describe('build-start — 설계 상태 관문(5.2, P4, Y7)', () => {
  const CLAIMED = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1,
    runner: 'hong/mbp/w1', runner_seen_at: new Date().toISOString(), design_state: null, claim_scope: 'full' }
  const bs = (body: Record<string, unknown>, agent = 'hong/mbp/w1') =>
    buildStartPOST(post('build-start', { user_email: USER.email, agent, ...body }), ctx)
  const itemRow = (o: Record<string, unknown> = {}) => ({ depends: [], depends_waived: [], stage: 'ds', actual_pct: 10, tags: ['agent'], design_mode: 'auto', ...o })

  it('다른 PC 가 30분 안에 신호를 냈으면 409 runner_active — 본문에 runner', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claimed_by: 'hong/pc2/w1' } }], ...member(), wbs_items: [{ data: itemRow() }] })
    const res = await bs({ scope: 'full' }, 'hong/pc2/w1')
    // 호출자=점유자(hong/pc2/w1)지만 runner 는 mbp 가 신선하다
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/mbp/w1' })
  })
  it('claimed 가 아니면 409 design_gate·reason order_changed(Y7)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, status: 'ready' } }], ...member() })
    const res = await bs({ scope: 'build' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate', reason: 'order_changed' })
  })
  it('scope build — 설계가 승인되지 않았으면 409 design_not_accepted', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, design_state: 'review', claim_scope: 'design' } }], ...member(),
      wbs_items: [{ data: itemRow({ stage: 'dd', design_mode: 'review' }) }] })
    expect(await (await bs({ scope: 'build' })).json()).toMatchObject({ code: 'design_not_accepted' })
  })
  it('scope full — claim_scope design 이면 409 design_gate(설계만 하던 주문이 구현으로 새지 않는다)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, claim_scope: 'design' } }], ...member(), wbs_items: [{ data: itemRow({ design_mode: 'review' }) }] })
    expect(await (await bs({ scope: 'full' })).json()).toMatchObject({ code: 'design_gate' })
  })
  it('통과하면 RPC 에 범위·CAS(설계 상태·방식·runner·runner_seen_at·claim_scope)·runner 를 싣는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }] })
    const res = await bs({ scope: 'full' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'build_start', p_scope: 'full', p_runner: 'hong/mbp/w1',
      p_cas: { design_state: null, design_mode: 'auto', runner: 'hong/mbp/w1', runner_seen_at: CLAIMED.runner_seen_at, claim_scope: 'full' },
    }))
    expect(await res.json()).toMatchObject({ ok: true, runner: 'hong/mbp/w1' })
  })
  it('RPC CAS 불일치는 409 design_gate·reason order_changed(Y7)', async () => {
    useAdmin({ agent_work_orders: [{ data: CLAIMED }], ...member(), wbs_items: [{ data: itemRow() }], rpc: [{ data: { ok: false, conflict: true, order_status: 'claimed' } }] })
    expect(await (await bs({ scope: 'full' })).json()).toMatchObject({ code: 'design_gate', reason: 'order_changed' })
  })
  it('rework 는 단계 ip 에서 선행을 보지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...CLAIMED, runner: null } }], ...member(),
      wbs_items: [{ data: itemRow({ stage: 'ip', depends: ['MES/TSK-01-00'] }) }, { data: [dep('as')] }] })
    const res = await bs({ scope: 'rework' })
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_scope: 'rework' }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-state-build-start.test.ts`
Expected: FAIL

- [ ] **Step 3: 라우트를 다시 쓴다**

`src/app/api/v1/agent/work/[id]/build-start/route.ts` 전체:

```ts
import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { loadDependsInfo, type DependInfo } from '@/lib/agent/depends'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'
import { BUILD_SCOPES, canBuildStart, predsState, runnerFree, toDesignMode, type BuildScope } from '@/lib/domain/designGate'

export const dynamic = 'force-dynamic'

/**
 * 설계 끝 → 구현 시작(계약 v2.9·v2.11, 설계 상태 스펙 5.2). 범위(scope)로 관문을 본다 — 검사 순서 runner → 설계 → 선행(계획 P4).
 * 점유자 본인·claimed 여야 한다. 통과하면 RPC 가 ds·dd → ip 로 옮기고 도는 PC 를 호출자로 적는다(ip 이상이면 단계는 그대로 — 멱등).
 * 주문이 claimed 가 아니거나 판정과 쓰기 사이에 바뀌면 409 design_gate·reason order_changed 다(12절 Y7) — 워커는 설계 되돌림처럼
 * 끝내고 폴더를 지운다. 선행 미충족은 403 dependency_not_met(워커는 설계 선행 대기로 멈춘다).
 */
const orderChanged = (message: string) =>
  NextResponse.json({ error: message, code: 'design_gate', reason: 'order_changed' }, { status: 409 })

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  // 범위(계약 2.11, D21) — 없으면 legacy(옛 킷). legacy 는 보내는 값이 아니라 "안 보냄"이다.
  const requestScopes: readonly string[] = BUILD_SCOPES.filter(sc => sc !== 'legacy')
  const scopeRaw = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).scope : undefined
  if (scopeRaw !== undefined && (typeof scopeRaw !== 'string' || !requestScopes.includes(scopeRaw))) {
    return apiBadRequest(`scope 는 ${requestScopes.join('|')} 중 하나여야 합니다.`)
  }
  const scope: BuildScope = (scopeRaw as BuildScope | undefined) ?? 'legacy'
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res

    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const row = loaded.order
    // 사람이 중단한 주문은 전용 코드(report 와 같다) — 소유 판정보다 먼저 본다(중단은 점유 흔적을 지운다).
    if (row.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (row.status !== 'claimed') return orderChanged(`구현을 시작할 수 있는 상태가 아닙니다(현재: ${row.status}).`)

    // 소유 판정(§2.3) — 교차 소유는 양방향 모두 403 not_claim_owner(report·release 와 같다).
    if (actor.principal.kind === 'pat') {
      if (row.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (row.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (row.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }

    const order = orderFactsOf(row)
    const nowMs = Date.now()
    let dependsInfo: DependInfo[] = []
    let mode = toDesignMode(null)
    if (row.wbs_item_id) {
      const { data: itemRow, error: itemErr } = await admin
        .from('wbs_items').select('depends, depends_waived, stage, actual_pct, tags, design_mode').eq('id', row.wbs_item_id).maybeSingle()
      if (itemErr) {
        console.error('[agent-api] build-start 항목 조회 실패(거절):', itemErr.message) // fail-closed
        return apiInternalError()
      }
      const item = itemRow as { depends?: string[] | null; depends_waived?: string[] | null; stage?: string | null
        actual_pct?: number | string | null; tags?: string[] | null; design_mode?: string | null } | null
      if (item) {
        const depends = item.depends ?? []
        if (depends.length > 0) dependsInfo = await loadDependsInfo(admin, { projectId: row.project_id, depends, waived: item.depends_waived ?? [] })
        const unmet = dependsInfo.filter((d) => !d.reached)
        mode = toDesignMode(item.design_mode)
        const refusal = canBuildStart({
          mode, stage: item.stage ?? null, actualPct: item.actual_pct == null ? null : Number(item.actual_pct),
          delegated: (item.tags ?? []).includes('agent'), hasApprovedOrder: false, preds: predsState(unmet),
        }, order, scope, actor.agentLabel, nowMs)
        if (refusal) {
          if (refusal.code === 'runner_active') {
            return NextResponse.json({ error: refusal.message, code: 'runner_active', runner: order.runner, runner_seen_at: order.runnerSeenAt }, { status: 409 })
          }
          if (refusal.code === 'dependency_not_met') {
            return NextResponse.json({ error: refusal.message, code: 'dependency_not_met', unmet: unmet.map((d) => ({ external_ref: d.external_ref, stage: d.stage })) }, { status: 403 })
          }
          return NextResponse.json({ error: refusal.message, code: refusal.code, ...(refusal.reason ? { reason: refusal.reason } : {}) }, { status: refusal.status })
        }
      }
    }
    // 항목이 지워진 주문은 설계 관문을 보지 않는다(RPC 가 단계를 건너뛴다). 도는 PC 조건만 본다.
    if (!runnerFree(order, actor.agentLabel, nowMs)) {
      return NextResponse.json({ error: `다른 PC 가 이 작업을 돌리는 중입니다(${order.runner}).`, code: 'runner_active', runner: order.runner, runner_seen_at: order.runnerSeenAt }, { status: 409 })
    }

    // 원자 전이 — claimed·점유자·읽은 값(CAS)을 RPC 가 잠근 행으로 다시 본다. 판정과 쓰기 사이에 바뀌면 Y7.
    const transition = await applyWorkflowEvent(admin, {
      event: 'build_start', actorUserId: loaded.userId, orderId: id,
      scope: scope === 'legacy' ? null : scope,
      cas: { design_state: order.designState, design_mode: mode, runner: order.runner, runner_seen_at: order.runnerSeenAt, claim_scope: row.claim_scope ?? null },
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
    if (!transition.ok) {
      if (transition.conflict) return orderChanged('상태가 바뀌어 구현을 시작하지 못했습니다(설계가 되돌려졌거나 다른 PC 가 이어받음).')
      console.error('[agent-api] build-start 전이 실패:', transition.error)
      return apiInternalError()
    }
    // claim 라우트와 같은 후처리 — 실적이 바뀌었으면 화면 갱신·진척 스냅샷(실패는 로깅만).
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({
      ok: true, status: 'claimed', stage: transition.stage, stage_changed: transition.stageChanged,
      depends_evidence: dependsInfo, runner: actor.agentLabel,
    })
  } catch (e) {
    console.error('[agent-api] build-start 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```


- [ ] **Step 4: 기존 build-start 테스트를 맞춘다**

`tests/agent/design-first.test.ts` 의 build-start describe:
- "claimed 가 아니면 409 conflict" 단언은 `code: 'design_gate', reason: 'order_changed'` 로 바꾼다.
- 항목 조회 목 행(`{ depends: [...], depends_waived: [] }`)에 `stage: 'ds'` 를 더한다(없으면 단계 없음이라 full 관문이 design_gate 를 낸다).
- RPC 인자 단언은 `expect.objectContaining({ p_event: 'build_start' })` 처럼 느슨하게 둔 것은 그대로 통과한다.

Run: `npx vitest run tests/agent/design-state-build-start.test.ts tests/agent/design-first.test.ts tests/agent/write-routes-pat.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/\[id\]/build-start/route.ts tests/agent/design-state-build-start.test.ts tests/agent/design-first.test.ts
git commit -m "feat(design-state): build-start 가 도는 PC·설계·선행 순으로 관문을 보고 runner 를 넘겨받는다

주문이 claimed 가 아니거나 CAS 가 어긋나면 409 design_gate(order_changed)로 알려 워커가 되돌림처럼 끝나게 한다(Y7).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: heartbeat — 도는 PC 넘겨받기·runner_active(Y1·P6)

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/heartbeat/route.ts:94-117`
- Test: `tests/agent/heartbeat-route.test.ts`

**Interfaces:**
- Consumes: Task 1 `runnerFree`, Task 10 `OrderRow.runner`·`runner_seen_at`
- Produces: 워커 갈래가 runner 를 호출 라벨로 적고(`runner_seen_at` = 지금), 다른 PC 가 30분 안에 신호를 냈으면 409 `runner_active`(본문 `runner`·`runner_seen_at`). 팀장 merge_conflict 갈래는 그대로.

- [ ] **Step 1: 목에 `is` 를 더하고 실패하는 테스트를 쓴다**

`tests/agent/heartbeat-route.test.ts` 의 `useAdmin` 에서 `b.in = …` 다음 줄에 더한다:

```ts
      b.is = (...a: unknown[]) => { (calls[`${table}:is`] ??= []).push(a); return b }
```

describe 안에 더한다:

```ts
  it('runner 가 없으면 넘겨받는다 — runner·runner_seen_at 을 쓰고 runner 가 비었음을 CAS 로 건다(P6)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, runner: null, runner_seen_at: null } as typeof ORDER), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(200)
    const upd = calls.agent_work_orders?.[0] as Record<string, unknown>
    expect(upd.runner).toBe('hong/mbp/w1')
    expect(upd.runner_seen_at).toBe(upd.last_heartbeat_at)
    expect(calls['agent_work_orders:is']).toContainEqual(['runner', null])
  })
  it('다른 PC 가 30분 안에 신호를 냈으면 409 runner_active — 아무것도 쓰지 않는다(Y1)', async () => {
    const calls: Record<string, unknown[]> = {}
    const fresh = new Date(Date.now() - 60_000).toISOString()
    useAdmin(okQueues({ ...ORDER, runner: 'hong/pc2/w1', runner_seen_at: fresh } as typeof ORDER), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/pc2/w1', runner_seen_at: fresh })
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('다른 PC 가 30분 넘게 조용하면 넘겨받는다 — 읽은 runner 로 CAS', async () => {
    const calls: Record<string, unknown[]> = {}
    const stale = new Date(Date.now() - 31 * 60_000).toISOString()
    useAdmin(okQueues({ ...ORDER, runner: 'hong/pc2/w1', runner_seen_at: stale } as typeof ORDER), calls)
    expect((await post({ agent: 'hong/mbp/w1', phase: 'build' })).status).toBe(200)
    expect(calls['agent_work_orders:eq']).toContainEqual(['runner', 'hong/pc2/w1'])
  })
  it('같은 PC 의 다른 슬롯·수동 세션은 넘겨받는다', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString()
    useAdmin(okQueues({ ...ORDER, runner: 'hong/mbp/w2', runner_seen_at: fresh } as typeof ORDER))
    expect((await post({ agent: 'claude-mbp', phase: 'build' })).status).toBe(200)
  })
```

(`ORDER` 의 `claimed_by: 'pat-r-1'` 는 PAT 경로라 소유 판정이 `claimed_by_user_id` 로 된다 — 본문 agent 가 달라도 통과한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts`
Expected: FAIL(runner 칸 없음, 409 없음)

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/work/[id]/heartbeat/route.ts` — import 에 `import { runnerFree } from '@/lib/domain/designGate'` 를 더하고, `if (lead) return await writeLeadMark(...)` 다음부터 update 호출까지를 바꾼다:

```ts
    if (lead) return await writeLeadMark(admin, id, clear !== null, note)

    // 도는 PC(설계 상태 스펙 D25·12절 Y1, 계획 P6) — 같은 PC 이거나 runner 가 없거나 30분 넘게 조용하면 이 라벨이 넘겨받는다.
    // 아니면 409 runner_active: 새 훅이 이 워커를 멈춘다(옛 훅은 무시하고, 완료 보고가 서버에서 막힌다).
    const nowMs = Date.now()
    const curRunner = order.runner ?? null
    if (!runnerFree({ runner: curRunner, runnerSeenAt: order.runner_seen_at ?? null }, agent, nowMs)) {
      return NextResponse.json({
        error: `다른 PC(${curRunner})가 이 작업을 이어받았습니다. 더 진행하지 말고 멈추세요.`, code: 'runner_active',
        runner: curRunner, runner_seen_at: order.runner_seen_at ?? null,
      }, { status: 409 })
    }
    const now = new Date(nowMs).toISOString()
    // phase 를 생략하면 null — 사람이 답한 뒤 팀원의 다음 heartbeat 가 BLOCKED 를 푼다(훅은 항상 phase 를 보낸다).
    let q = admin
      .from('agent_work_orders')
      .update({
        last_heartbeat_at: now, updated_at: now, heartbeat_agent: agent,
        heartbeat_phase: phase, heartbeat_note: phase === 'blocked' && note ? note : null,
        // 재개 요청(0099)은 워커가 다시 숨을 쉬면 해소된다 — 사람이 따로 지우지 않아도
        // 좌석의 「재개 요청됨」 표시와 팀장 watch 목록에서 같이 사라진다.
        resume_requested_at: null, resume_requested_by: null, resume_requested_host: null,
        // 도는 PC(0108) — 넘겨받거나 신호 시각을 갱신한다. 판정과 쓰기 사이에 다른 PC 가 넘겨받았으면 CAS 가 막는다(0행 → 409).
        runner: agent, runner_seen_at: now,
        // 에이전트 보기 명찰(0100) — Phase 서브에이전트의 모델. 실린 때만 덮어쓴다.
        ...(model !== null ? { heartbeat_model: (model as string).trim() } : {}),
      })
      .eq('id', id).eq('status', 'claimed')
    q = curRunner === null ? q.is('runner', null) : q.eq('runner', curRunner)
    const { data: updated, error } = await q.select('id')
```

(그 뒤 `if (error) …`·`if (!updated || …length === 0) return apiFail(409, 'conflict', …)` 는 그대로 둔다.)

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/heartbeat-route.test.ts tests/agent/write-routes-pat.test.ts`
Expected: PASS. 다른 테스트 파일의 목에 `is` 가 없어 `q.is is not a function` 이 나면 그 목에 같은 한 줄(`b.is = () => b` 또는 호출 기록형)을 더한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/\[id\]/heartbeat/route.ts tests/agent/heartbeat-route.test.ts
git commit -m "feat(design-state): heartbeat 가 도는 PC 를 넘겨받거나 409 runner_active 로 워커를 멈추게 한다(Y1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: 완료 보고 — 도는 PC·살아 있는 다른 세션·단계 ip(Y1·Y2·W23·P16)

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/report/route.ts:93-138`
- Test: `tests/agent/design-state-report.test.ts`(새)

**Interfaces:**
- Consumes: Task 1 `canReportCompletion`, Task 9 `orderFactsOf`, Task 4 RPC 의 report_completion 전제(설계 검토 대기·리프 ip 아님 → `design_gate`)
- Produces: completion 보고의 거부 — 409 `runner_active`(본문 `runner`), 409 `design_gate`. progress 보고는 그대로.

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-state-report.test.ts` — `tests/agent/design-first.test.ts` 의 목·헬퍼(`mocks`·`vi.mock` 넷·`useAdmin`·`post`·`member`·`ctx`·상수)를 복사해 머리에 두고, 라우트를 `import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'` 로 불러 쓴다:

```ts
describe('completion — 설계 상태 관문(12절 Y1·Y2·W23, 계획 P16)', () => {
  const base = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1 }
  const done = (agent = 'hong/mbp/w1') => reportPOST(post('report', { user_email: USER.email, agent, kind: 'completion', percent: 100, summary: '완료' }), ctx)

  it('runner 가 다른 PC 면 409 runner_active — 보고 행을 넣지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, runner: 'hong/pc2/w1', runner_seen_at: new Date(Date.now() - 90 * 60_000).toISOString() } }], ...member() })
    const res = await done()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'runner_active', runner: 'hong/pc2/w1' })
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_reports')
  })
  it('살아 있는 다른 세션(heartbeat_agent 다름·5분 안)이 있으면 409 runner_active(P16)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, claimed_by: 'claude-mbp', runner: 'hong/mbp/w1', heartbeat_agent: 'hong/mbp/w1',
      last_heartbeat_at: new Date().toISOString(), heartbeat_phase: 'build' } }], ...member() })
    expect((await done('claude-mbp')).status).toBe(409)
  })
  it('설계 검토 대기면 409 design_gate(W23)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, design_state: 'review' } }], ...member() })
    expect(await (await done()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('RPC 가 design_gate(리프 단계가 ip 아님, Y2)를 주면 보고 행을 지우고 409 design_gate', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...base, runner: 'hong/mbp/w1' } }], ...member(),
      agent_work_reports: [{ data: [{ id: 'r-1' }] }, { data: null }],   // insert, cleanup delete
      rpc: [{ data: { ok: false, reason: 'design_gate', order_status: 'claimed' } }],
    })
    const res = await done()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'report_completion', p_cas: { runner: 'hong/mbp/w1', design_state: null } }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-state-report.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/work/[id]/report/route.ts` — import 에 `import { canReportCompletion } from '@/lib/domain/designGate'` 와 `import { orderFactsOf } from '@/lib/agent/designFacts'` 를 더한다. 소유 판정 블록 바로 뒤(`const appliedToWbs = false` 앞)에:

```ts
    // 완료 보고 관문(설계 상태 스펙 12절 Y1·W23, 계획 P16) — 도는 PC 가 아니거나 살아 있는 다른 세션이 있으면 받지 않는다.
    // 리프의 단계 ip 조건(Y2)은 RPC 가 잠근 행으로 본다(항목을 여기서 다시 읽지 않는다).
    const facts = orderFactsOf(order)
    if (kind === 'completion') {
      const refusal = canReportCompletion(null, facts, actor.agentLabel, Date.now())
      if (refusal) {
        return NextResponse.json({ error: refusal.message, code: refusal.code, ...(refusal.code === 'runner_active' ? { runner: facts.runner } : {}) }, { status: refusal.status })
      }
    }
```

completion 전이 호출에 CAS 를 싣고, 실패 분기에 design_gate 를 더한다:

```ts
      const transition = await applyWorkflowEvent(admin, {
        event: 'report_completion', actorUserId: loaded.userId, orderId: id,
        cas: { runner: facts.runner, design_state: facts.designState },
        agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
        agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      })
      if (!transition.ok) {
        const { error: cleanupErr } = await admin
          .from('agent_work_reports').delete().eq('id', reportId)
        if (cleanupErr) console.error('[agent-api] 보고 행 cleanup 실패(고아 행 남음):', cleanupErr.message)
        if (transition.reason === 'design_gate') {
          return apiFail(409, 'design_gate', '완료 보고는 작업 중(ip) 단계에서만 받습니다 — 설계 검토 대기이거나 구현을 시작하지 않은 작업입니다.')
        }
        if (transition.conflict) return apiFail(409, 'conflict', '완료 요청 가능한 상태가 아닙니다(다른 PC 가 이어받았을 수 있습니다).')
        console.error('[agent-api] completion 전이 실패:', transition.error)
        return apiInternalError()
      }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/design-state-report.test.ts tests/agent/report-route.test.ts tests/agent/report-decisions.test.ts tests/agent/write-routes-pat.test.ts tests/agent/stage-lifecycle.test.ts`
Expected: PASS. 기존 completion 테스트의 주문 행에는 runner 가 없어(null) 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/\[id\]/report/route.ts tests/agent/design-state-report.test.ts
git commit -m "feat(design-state): 완료 보고는 도는 PC 에서만, 살아 있는 다른 세션이 있으면 받지 않는다(Y1·P16·Y2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: release — 설계 상태가 있으면 반납하지 않는다(D13)

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/release/route.ts:74-87`
- Test: `tests/agent/claim-routes.test.ts`(release 부분) 또는 새 `tests/agent/design-state-release.test.ts`

**Interfaces:**
- Consumes: Task 1 `canRelease`, Task 9 `orderFactsOf`, Task 4 RPC release 전제
- Produces: 409 `design_gate` — 문구 "「중단」을 쓰세요"

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-state-release.test.ts` — `design-first.test.ts` 의 목·헬퍼를 복사하고 `import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'` 로:

```ts
describe('release — D13', () => {
  const base = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1 }
  const rel = () => releasePOST(post('release', { user_email: USER.email, agent: 'hong/mbp/w1' }), ctx)
  it('설계 상태가 있으면 409 design_gate, RPC 를 부르지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, design_state: 'accepted' } }], ...member() })
    const res = await rel()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'design_gate' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('RPC 가 design_gate(설계만 하던 주문이 ds·dd)를 주면 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...base, claim_scope: 'design' } }], ...member(), rpc: [{ data: { ok: false, reason: 'design_gate', order_status: 'claimed' } }] })
    expect(await (await rel()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('설계 상태가 없는 full 주문은 종전처럼 반납한다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...base, claim_scope: 'full' } }], ...member() })
    expect((await rel()).status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'release', p_cas: { design_state: null, claim_scope: 'full' } }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-state-release.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/work/[id]/release/route.ts` — import 에 `canRelease`(designGate)와 `orderFactsOf`(designFacts)를 더하고, 소유 판정 뒤·전이 앞에:

```ts
    // D13(설계 상태 스펙) — 설계 상태가 있거나 설계만 하던 주문이 ds·dd 면 반납하지 않는다. 반납은 ready+review 같은
    // 빠져나올 수 없는 상태를 만들거나, 다음 claim 이 검토 안 된 설계로 구현하게 한다. 단계 조건은 RPC 가 본다.
    const facts = orderFactsOf(order)
    const blocked = canRelease(null, facts)
    if (blocked) return apiFail(409, 'design_gate', blocked.message)
```

전이 호출에 `cas: { design_state: facts.designState, claim_scope: order.claim_scope ?? null },` 를 더하고, 실패 분기 첫 줄에:

```ts
      if (transition.reason === 'design_gate') return apiFail(409, 'design_gate', '설계만 하던 작업은 반납하지 않습니다 — 웹에서 「중단」을 쓰세요.')
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/design-state-release.test.ts tests/agent/claim-routes.test.ts tests/agent/write-routes-pat.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/work/\[id\]/release/route.ts tests/agent/design-state-release.test.ts
git commit -m "feat(design-state): 설계 상태가 있거나 설계만 하던 주문은 반납하지 않는다(D13)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: 새 동사 — design-done·design-reopen 라우트

**Files:**
- Create: `src/app/api/v1/agent/work/[id]/design-done/route.ts`, `src/app/api/v1/agent/work/[id]/design-reopen/route.ts`
- Test: `tests/agent/design-verbs.test.ts`(새)

**Interfaces:**
- Consumes: Task 1 `canDesignDone`, Task 6 `applyWorkflowEvent`, Task 9 `orderFactsOf`, `myMemberIds`(`src/lib/agent/assignee.ts`)
- Produces:
  - `POST /work/{id}/design-done` 본문 `{agent, user_email?}` → 200 `{ ok, status: 'claimed', stage, design_state }`. 거부: 409 `cancelled`·`design_gate`(claimed 아님·단계 ip 이상·CAS 불일치는 `reason: 'order_changed'`), 403 `not_claim_owner`
  - `POST /work/{id}/design-reopen` 본문 `{agent, reason(1~500자)}` → 200 `{ ok, status, stage, design_state }`. 부르는 쪽: claimed 면 점유자, ready 면 PAT 이고 담당자가 있으면 그 담당자 신원(claim 과 같은 규칙). 거부: 400·403·409 `design_gate`

- [ ] **Step 1: 실패하는 테스트**

`tests/agent/design-verbs.test.ts` — `design-first.test.ts` 의 목·헬퍼를 복사하고 두 라우트를 import:

```ts
import { POST as doneRoute } from '@/app/api/v1/agent/work/[id]/design-done/route'
import { POST as reopenRoute } from '@/app/api/v1/agent/work/[id]/design-reopen/route'

describe('design-done', () => {
  const CL = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1, design_state: null }
  const call = () => doneRoute(post('design-done', { user_email: USER.email, agent: 'hong/mbp/w1' }), ctx)
  it('점유자가 부르면 design_done 사건 — runner·CAS 를 싣는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member(),
      rpc: [{ data: { ok: true, order_status: 'claimed', prev_status: 'claimed', design_state: 'review', stage: 'dd', actual_pct: 20, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, stage: 'dd', design_state: 'review' })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_done', p_agent: 'hong/mbp/w1', p_runner: 'hong/mbp/w1', p_cas: { design_state: null } }))
  })
  it('중단된 주문은 409 cancelled, claimed 아님은 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'cancelled' } }], ...member() })
    expect(await (await call()).json()).toMatchObject({ code: 'cancelled' })
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'reported' } }], ...member() })
    expect(await (await call()).json()).toMatchObject({ code: 'design_gate' })
  })
  it('RPC design_gate(단계 ip 이상)는 409 design_gate', async () => {
    useAdmin({ agent_work_orders: [{ data: CL }], ...member(), rpc: [{ data: { ok: false, reason: 'design_gate' } }] })
    expect((await call()).status).toBe(409)
  })
})

describe('design-reopen', () => {
  const CL = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'hong/mbp/w1', claimed_by_user_id: null, wbs_item_id: W1, design_state: 'accepted' }
  const call = (body: Record<string, unknown> = { reason: '5절 중 테스트 계획 없음' }, bearer?: string) =>
    reopenRoute(post('design-reopen', { user_email: USER.email, agent: 'hong/mbp/w1', ...body }, bearer), ctx)
  it('reason 이 없거나 500자를 넘으면 400', async () => {
    useAdmin({})
    expect((await call({ reason: '' })).status).toBe(400)
    expect((await call({ reason: 'x'.repeat(501) })).status).toBe(400)
  })
  it('점유자가 부르면 design_reopen 사건 — 사유를 note 로', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: CL }], ...member(),
      rpc: [{ data: { ok: true, order_status: 'ready', prev_status: 'claimed', design_state: null, stage: 'as', actual_pct: 0, stage_changed: true, actual_changed: true, reached_first: false, skipped: null } }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_reopen', p_note: '5절 중 테스트 계획 없음', p_cas: { design_state: 'accepted' } }))
    expect(await res.json()).toMatchObject({ ok: true, status: 'ready', design_state: null })
  })
  it('ready 주문은 레거시 시크릿으로 되돌릴 수 없다(PAT 만 — 후보를 받는 에이전트)', async () => {
    useAdmin({ agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member() })
    expect((await call()).status).toBe(403)
  })
  it('ready 주문 — PAT 이고 담당자가 없으면 통과(팀장의 띄우기 전 검사)', async () => {
    const admin = useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_work_orders: [{ data: { ...CL, status: 'ready', claimed_by: null } }], ...member(),
      wbs_items: [{ data: { assignee_member_id: null } }],
    })
    const res = await call({ reason: 'design.md 없음' }, PAT.token)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'design_reopen' }))
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/design-verbs.test.ts`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: design-done 라우트**

`src/app/api/v1/agent/work/[id]/design-done/route.ts`:

```ts
import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'
import { canDesignDone } from '@/lib/domain/designGate'

export const dynamic = 'force-dynamic'

/**
 * 설계를 마치고 멈춘다(계약 2.11, 설계 상태 스펙 4.1 design_done·6.3). 워커가 design.md·state.json 을 push 한 뒤 부른다.
 * 서버가 단계 ds → dd·실적 dd 로 두고, review 방식이거나 claim_scope design 이면 설계 상태 review·heartbeat phase wait_review·
 * runner 없음으로 둔다(설계 검토 대기). 그 밖(auto 설계 선행)은 설계 상태 없이 phase wait_pred, runner 유지.
 * 점유자 본인만 부른다(build-start 와 같은 소유 판정). 단계 ip 이상이면 409 design_gate.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const row = loaded.order
    if (row.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    const facts = orderFactsOf(row)
    const g = canDesignDone(null, facts)
    if (g) return NextResponse.json({ error: g.message, code: g.code, reason: 'order_changed' }, { status: 409 })
    if (actor.principal.kind === 'pat') {
      if (row.claimed_by_user_id === null) return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
      if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    } else {
      if (row.claimed_by_user_id !== null) return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
      if (row.claimed_by !== actor.agentLabel) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
    }
    const transition = await applyWorkflowEvent(admin, {
      event: 'design_done', actorUserId: loaded.userId, orderId: id,
      cas: { design_state: facts.designState },
      agent: actor.principal.kind === 'pat' ? null : actor.agentLabel,
      agentUserId: actor.principal.kind === 'pat' ? (actor.userId as string) : null,
      runner: actor.agentLabel,
    })
    if (!transition.ok) {
      if (transition.reason === 'design_gate') return apiFail(409, 'design_gate', '구현이 시작된 작업은 설계 완료로 되돌릴 수 없습니다.')
      if (transition.conflict) return NextResponse.json({ error: '상태가 바뀌어 설계 완료를 기록하지 못했습니다.', code: 'design_gate', reason: 'order_changed' }, { status: 409 })
      console.error('[agent-api] design-done 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({ ok: true, status: 'claimed', stage: transition.stage, design_state: transition.designState })
  } catch (e) {
    console.error('[agent-api] design-done 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 4: design-reopen 라우트**

`src/app/api/v1/agent/work/[id]/design-reopen/route.ts`:

```ts
import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isUuidLike } from '@/lib/domain/agentWork'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { apiBadRequest, apiFail, apiInternalError, apiNotFound } from '@/lib/agent/externalApi'
import { loadGatedOrder, loadGatedOrderForUser, parseAgentActor, resolveWriteActor } from '@/lib/agent/routeShared'
import { myMemberIds } from '@/lib/agent/assignee'
import { applyWorkflowEvent } from '@/lib/agent/workflowEvent'
import { orderFactsOf } from '@/lib/agent/designFacts'

export const dynamic = 'force-dynamic'
const REASON_MAX = 500

/**
 * 설계를 사람에게 되돌린다(계약 2.11, 설계 상태 스펙 4.1 design_reopen·6.2 띄우기 전 검사·6.4). human 은 사람 설계 대기(as),
 * 그 밖은 설계 검토 대기(review)로 간다. 사유는 design_note 에 남아 화면이 보인다.
 * 부르는 쪽(8절): claimed 면 점유자, ready 면 그 주문을 후보로 받는 에이전트 PAT(담당자가 있으면 담당자 신원 — claim 과 같다).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!isUuidLike(id)) return apiBadRequest('경로 id 형식이 올바르지 않습니다.')
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason || reason.length > REASON_MAX) return apiBadRequest(`reason 은 1~${REASON_MAX}자여야 합니다(되돌리는 이유 — 화면에 보인다).`)
  try {
    const admin = createAdminClient()
    const actor = await resolveWriteActor(req, admin, raw, 'work:claim')
    if (!actor.ok) return actor.res
    const loaded = actor.principal.kind === 'pat'
      ? await loadGatedOrderForUser(admin, id, actor.userId as string, actor.principal.userEmail, actor.principal)
      : await loadGatedOrder(admin, id, (parseAgentActor(raw) as { userEmail: string }).userEmail)
    if (!loaded.ok) return loaded.res
    const row = loaded.order
    if (row.status === 'cancelled') return apiFail(409, 'cancelled', '작업이 중단되었습니다.')
    if (row.status === 'claimed') {
      if (actor.principal.kind === 'pat') {
        if (row.claimed_by_user_id !== actor.userId) return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 되돌릴 수 있습니다.')
      } else if (row.claimed_by_user_id !== null || row.claimed_by !== actor.agentLabel) {
        return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 되돌릴 수 있습니다.')
      }
    } else if (row.status === 'ready') {
      if (actor.principal.kind !== 'pat') return apiFail(403, 'not_claim_owner', '대기 주문은 PAT 로만 되돌릴 수 있습니다.')
      if (row.wbs_item_id) {
        const { data: item, error: itemErr } = await admin.from('wbs_items').select('assignee_member_id').eq('id', row.wbs_item_id).maybeSingle()
        if (itemErr) { console.error('[agent-api] design-reopen 담당자 조회 실패(거절):', itemErr.message); return apiInternalError() }
        const assignee = (item as { assignee_member_id: string | null } | null)?.assignee_member_id ?? null
        if (assignee) {
          const mine = await myMemberIds(admin, { userId: actor.userId as string, userEmail: actor.principal.userEmail, projectId: row.project_id })
          if (!mine.includes(assignee)) return apiFail(403, 'not_assignee', '담당자가 배정된 작업입니다. 담당자만 되돌릴 수 있습니다.')
        }
      }
    } else {
      return apiFail(409, 'design_gate', `되돌릴 수 있는 상태가 아닙니다(현재: ${row.status}).`)
    }
    const transition = await applyWorkflowEvent(admin, {
      event: 'design_reopen', actorUserId: loaded.userId, orderId: id, note: reason,
      cas: { design_state: orderFactsOf(row).designState },
    })
    if (!transition.ok) {
      if (transition.reason === 'design_gate') return apiFail(409, 'design_gate', '되돌릴 수 있는 설계가 없습니다(설계 완료 단계의 승인·확정된 설계만 되돌립니다).')
      if (transition.conflict) return NextResponse.json({ error: '상태가 바뀌어 되돌리지 못했습니다.', code: 'design_gate', reason: 'order_changed' }, { status: 409 })
      console.error('[agent-api] design-reopen 전이 실패:', transition.error)
      return apiInternalError()
    }
    if (transition.actualChanged) {
      revalidatePath(`/p/${row.project_id}`, 'layout')
      after(() => recordProgressSnapshot(row.project_id, admin as never))
    }
    return NextResponse.json({ ok: true, status: transition.orderStatus, stage: transition.stage, design_state: transition.designState })
  } catch (e) {
    console.error('[agent-api] design-reopen 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/agent/design-verbs.test.ts && npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/v1/agent/work/\[id\]/design-done/route.ts src/app/api/v1/agent/work/\[id\]/design-reopen/route.ts tests/agent/design-verbs.test.ts
git commit -m "feat(design-state): design-done·design-reopen 동사 — 설계 멈춤과 사람에게 되돌리기

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: 목록·상세·watch 가 판단을 싣는다(계약 2.11, D22, Y4·Y9·Y10)

**Files:**
- Modify: `src/app/api/v1/agent/work/mine/route.ts`, `src/app/api/v1/agent/work/[id]/route.ts`, `src/app/api/v1/agent/watch/route.ts`, `src/app/actions/agentHub.ts:238-262`(재개 요청 — review 거부)
- Test: `tests/agent/mine-route.test.ts`, `tests/agent/work-routes-pat.test.ts`, `tests/agent/watch-route.test.ts`, `tests/actions/agent-hub-actions.test.ts`

**Interfaces:**
- Consumes: Task 1 `isMine`·`listFilterPass`·`parseWpList`, Task 9 `loadItemFacts`·`orderFactsOf`·`decide`·`designFieldsOf`·`ORDER_FACT_COLUMNS`·`ITEM_FACT_COLUMNS`·`hasApprovedOrder`
- Produces:
  - `GET /work/mine` 새 쿼리: `agent`(요청 라벨), `require_tag`, `wp`(쉼표 목록, 형식 오류 400), `lead=1`. 각 주문에 `design_mode`·`design_state`·`design_note`·`claim_scope`·`runner`·`runner_seen_at`·`action`·`action_reason`·`deps_unmet`·`mine`·`claimed_by`
  - `GET /work/{id}`(PAT) 새 쿼리 `agent` — `order` 에 같은 칸
  - `POST /watch` 새 본문 `require_tag`·`wp` — 응답 `build_ready: Array<{ order_id, id8, code, name, status }> | null`(+ 실패면 `build_ready_error`), `resume_requests[]` 에 `mine`·`design_state`
  - `requestResumeOnOrder` 는 설계 상태 review 면 거부(Y10)

- [ ] **Step 1: 실패하는 테스트 — 목록**

`tests/agent/mine-route.test.ts` 에 더한다:

```ts
  it('판단 칸(action·mine·설계 상태)을 싣는다 — 팀장 요청(lead=1)은 거르기와 팀원 라벨을 본다(계약 2.11)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [
        { data: [
          { id: 'o-r', project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: 'w-r', created_at: '2026-08-01T00:00:00Z',
            claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, design_state: null, claim_scope: null, design_note: null, runner: null, runner_seen_at: null },
        ] },
        { data: [] },   // loadItemFacts — 항목의 approved 주문 없음
      ],
      wbs_items: [{ data: [{ id: 'w-r', project_id: P1, code: '1', name: 'r', planned_start: null, planned_end: null, external_ref: 'M/TSK-02-01',
        stage: 'as', actual_pct: 0, tags: ['agent'], depends: [], depends_waived: [], design_mode: 'review' }] }],
    })
    const res = await mineGET(get(`http://l/api/v1/agent/work/mine?agent=hong/mbp/lead&require_tag=agent&wp=WP-02&lead=1`, PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available[0]).toMatchObject({ design_mode: 'review', design_state: null, action: 'design', action_reason: '설계만', deps_unmet: false, mine: true })
  })
  it('wp 형식 오류는 400', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    expect((await mineGET(get('http://l/api/v1/agent/work/mine?wp=WP-x', PAT.token))).status).toBe(400)
  })
```

`tests/agent/watch-route.test.ts` 에 더한다:

```ts
  it('build_ready — 승인·확정된 주문 중 action build ∧ mine 만 싣는다(D22)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_watchers: [{ data: null }, { data: null }],
      agent_work_orders: [
        { data: [] },   // 재개 요청 없음
        { data: [{ id: '22222222-2222-4222-8222-222222222222', project_id: P1, wbs_item_id: 'w-1', status: 'ready',
          claimed_by: null, claimed_by_user_id: null, last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null,
          design_state: 'accepted', claim_scope: null, design_note: null, runner: null, runner_seen_at: null }] },
        { data: [] },   // loadItemFacts approved
      ],
      wbs_items: [{ data: [{ id: 'w-1', project_id: P1, code: '1.1', name: 'x', external_ref: 'M/TSK-01-01', stage: 'dd', actual_pct: 20,
        tags: ['agent'], depends: [], depends_waived: [], design_mode: 'human' }] }],
    })
    const res = await POST(post({ agent: 'hong/mbp/lead', project_id: P1, require_tag: 'agent' }))
    expect(res.status).toBe(200)
    expect((await res.json()).build_ready).toEqual([{ order_id: '22222222-2222-4222-8222-222222222222', id8: '22222222', code: '1.1', name: 'x', status: 'ready' }])
  })
```

(watch 목의 큐 순서는 그 파일의 기존 테스트 머리 주석을 따른다 — 위 순서가 다르면 기존 큐 순서에 맞춘다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/mine-route.test.ts tests/agent/watch-route.test.ts`
Expected: FAIL

- [ ] **Step 3: `/work/mine` 구현**

`src/app/api/v1/agent/work/mine/route.ts`:

1. import 를 더한다:

```ts
import { AGENT_NAME_RE } from '@/lib/domain/agentWork'
import { isMine, listFilterPass, parseWpList } from '@/lib/domain/designGate'
import { ITEM_FACT_COLUMNS, ORDER_FACT_COLUMNS, decide, designFieldsOf, loadItemFacts, orderFactsOf, type FactItemRow, type FactOrderRow } from '@/lib/agent/designFacts'
```

2. `limit` 검사 뒤에 새 쿼리를 읽는다:

```ts
  // 계약 2.11(설계 상태 스펙 5.3·Y4·Y9) — 요청 라벨(PC 판정)과 팀장 거르기. 모두 선택이다.
  const agentParam = req.nextUrl.searchParams.get('agent')
  if (agentParam !== null && !AGENT_NAME_RE.test(agentParam)) return apiBadRequest('agent 형식이 올바르지 않습니다.')
  const requireTag = req.nextUrl.searchParams.get('require_tag')
  if (requireTag !== null && (requireTag === '' || requireTag.length > 40)) return apiBadRequest('require_tag 는 1~40자여야 합니다.')
  const wp = parseWpList(req.nextUrl.searchParams.get('wp'))
  if (wp === 'invalid') return apiBadRequest('wp 형식 오류 — WP-02 또는 모듈/WP-02 를 쉼표로 잇는다.')
  const lead = req.nextUrl.searchParams.get('lead') === '1'
```

3. 세 select 문자열(claimed·assigned·available)의 주문 열 끝에 `, ${ORDER_FACT_COLUMNS}` 를 더한다(예: `` `id, project_id, status, priority, instructions, claimed_at, wbs_item_id, created_at, ${ORDER_FACT_COLUMNS}` ``).

4. 항목 조회 select 를 `` `code, name, planned_start, planned_end, ${ITEM_FACT_COLUMNS}` `` 로 바꾸고(`ITEM_FACT_COLUMNS` 가 `id`·`external_ref` 를 담는다), 그 뒤에 판단을 붙인다:

```ts
    // 판단(설계 상태 스펙 5.3) — 목록의 모든 주문에 action·mine 을 싣는다. 재료 조회 실패는 500(위장 금지).
    const facts = await loadItemFacts(admin, [...itemById.values()] as FactItemRow[])
    const nowMs = Date.now()
    const withItem = (rows: Row[]) => rows.map(o => {
      const it = o.wbs_item_id ? (itemById.get(o.wbs_item_id) as (FactItemRow & Record<string, unknown>) | undefined) ?? null : null
      const f = it ? facts.get(it.id) ?? null : null
      const order = orderFactsOf(o as unknown as FactOrderRow)
      const action = decide(f?.facts ?? null, order, nowMs)
      const filtersPass = it ? listFilterPass({ tags: it.tags, externalRef: it.external_ref }, { requireTag, wp }) : false
      const mine = isMine(order, { userId: principal.userId, label: agentParam, lead, filtersPass }, nowMs)
      return { ...o, item: it, ...designFieldsOf(o as unknown as FactOrderRow, it?.design_mode ?? null, action, mine) }
    })
```

(기존 `const withItem = …` 정의를 이것으로 바꾼다.)

- [ ] **Step 4: `/work/{id}` 상세(PAT) 구현**

`src/app/api/v1/agent/work/[id]/route.ts`:
- 주문 select 에 `heartbeat_agent, design_state, claim_scope, design_note, runner, runner_seen_at` 를 더한다.
- PAT 항목 열을 `` `${ITEM_DETAIL_COLUMNS}, actual_pct, design_mode` `` 로 바꾼다(레거시는 그대로 `LEGACY_ITEM_COLUMNS`).
- `extra` 를 만드는 PAT 블록 끝에 판단을 더한다:

```ts
      const agentParam = req.nextUrl.searchParams.get('agent')
      const it = item as ({ id: string; stage: string | null; actual_pct: number | string | null; tags: string[] | null; design_mode: string | null } | null)
      const order = orderFactsOf(full as unknown as FactOrderRow)
      const itemFacts = it ? {
        mode: toDesignMode(it.design_mode), stage: it.stage, actualPct: it.actual_pct == null ? null : Number(it.actual_pct),
        delegated: (it.tags ?? []).includes('agent'), hasApprovedOrder: await hasApprovedOrder(admin, it.id),
        preds: predsState(dependsInfo.filter(d => !d.reached)),
      } : null
      const nowMs = Date.now()
      const action = decide(itemFacts, order, nowMs)
      const mineNow = isMine(order, { userId: principal.userId, label: agentParam && AGENT_NAME_RE.test(agentParam) ? agentParam : null, lead: false, filtersPass: true }, nowMs)
      extra = { ...extra, ...designFieldsOf(full as unknown as FactOrderRow, it?.design_mode ?? null, action, mineNow) }
```

(`extra` 의 기존 `mine`(점유 사용자 일치)은 `designFieldsOf` 의 `mine`(5.3 정의)으로 덮인다 — 5.3 정의가 "같은 신원 ∧ 도는 PC" 라 종전 뜻을 포함한다. import 에 `AGENT_NAME_RE`·`isMine`·`predsState`·`toDesignMode`·`decide`·`designFieldsOf`·`hasApprovedOrder`·`orderFactsOf`·`type FactOrderRow` 를 더한다.)

- [ ] **Step 5: watch 구현**

`src/app/api/v1/agent/watch/route.ts`:

1. 본문에서 거르기를 읽는다(`holder` 검사 뒤):

```ts
  const requireTag = b.require_tag === undefined || b.require_tag === null ? null : b.require_tag
  if (requireTag !== null && (typeof requireTag !== 'string' || requireTag === '' || requireTag.length > 40)) return apiBadRequest('require_tag 는 1~40자여야 합니다.')
  const wpRaw = b.wp === undefined || b.wp === null ? null : Array.isArray(b.wp) ? (b.wp as unknown[]).join(',') : b.wp
  if (wpRaw !== null && typeof wpRaw !== 'string') return apiBadRequest('wp 는 문자열 또는 배열이어야 합니다.')
  const wp = parseWpList(wpRaw as string | null)
  if (wp === 'invalid') return apiBadRequest('wp 형식 오류 — WP-02 또는 모듈/WP-02.')
```

2. `loadResumeRequests` 가 고르는 열에 `claimed_by_user_id, runner, runner_seen_at, design_state` 를 더하고, 반환 항목에 `mine`·`design_state` 를 싣는다(함수에 `label: string` 인자를 더한다):

```ts
    const order = { status: 'claimed' as const, claimedBy: r.claimed_by, claimedByUserId: r.claimed_by_user_id, runner: r.runner ?? null, runnerSeenAt: r.runner_seen_at ?? null }
    return {
      ...기존 필드...,
      // Y10 — 재개 요청 ∧ mine 이면 팀장은 5.3 2행 skip 이어도 재개한다(사람의 명시 요청이라 목록 거르기는 보지 않는다).
      mine: isMine(order, { userId, label, lead: false, filtersPass: true }, Date.now()),
      design_state: r.design_state ?? null,
    }
```

3. 새 함수 `loadBuildReady` 를 같은 파일에 둔다:

```ts
/**
 * D22 — 이 신원·이 PC 가 띄울 action build 주문(승인·확정된 설계). 팀장은 이 목록에서 슬롯에 있는 id·제외한 id 를 빼고 남으면
 * TICK 을 건너뛰지 않는다. build 는 설계 상태 accepted 에서만 나오므로 그것만 읽는다. 실패는 null(위장 금지).
 */
async function loadBuildReady(
  admin: ReturnType<typeof createAdminClient>, userId: string, projectIds: string[] | null, label: string,
  filters: { requireTag: string | null; wp: string[] | null },
): Promise<Array<{ order_id: string; id8: string; code: string | null; name: string | null; status: string }> | null> {
  let q = admin.from('agent_work_orders')
    .select(`id, project_id, wbs_item_id, status, ${ORDER_FACT_COLUMNS}`)
    .in('status', ['ready', 'claimed']).eq('design_state', 'accepted')
  if (projectIds !== null) q = q.in('project_id', projectIds)
  const { data, error } = await q.limit(200)
  if (error) { console.error('[agent-api] build 목록 조회 실패:', error.message); return null }
  const rows = (data ?? []) as Array<FactOrderRow & { id: string; project_id: string; wbs_item_id: string | null }>
  const itemIds = [...new Set(rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null))]
  if (itemIds.length === 0) return []
  const { data: items, error: itemErr } = await admin.from('wbs_items').select(`code, name, ${ITEM_FACT_COLUMNS}`).in('id', itemIds)
  if (itemErr) { console.error('[agent-api] build 목록 항목 조회 실패:', itemErr.message); return null }
  const byId = new Map(((items ?? []) as Array<FactItemRow & { code: string; name: string }>).map(i => [i.id, i]))
  let facts: Awaited<ReturnType<typeof loadItemFacts>>
  try { facts = await loadItemFacts(admin, [...byId.values()]) } catch (e) {
    console.error('[agent-api] build 목록 판단 재료 실패:', e instanceof Error ? e.message : e); return null
  }
  const nowMs = Date.now()
  const out: Array<{ order_id: string; id8: string; code: string | null; name: string | null; status: string }> = []
  for (const r of rows) {
    const it = r.wbs_item_id ? byId.get(r.wbs_item_id) : undefined
    const f = it ? facts.get(it.id) : undefined
    if (!it || !f) continue
    const order = orderFactsOf(r)
    if (decide(f.facts, order, nowMs).action !== 'build') continue
    const filtersPass = listFilterPass({ tags: it.tags, externalRef: it.external_ref }, filters)
    if (!isMine(order, { userId, label, lead: true, filtersPass }, nowMs)) continue
    out.push({ order_id: r.id, id8: r.id.slice(0, 8), code: it.code ?? null, name: it.name ?? null, status: r.status })
  }
  return out
}
```

4. 응답 조립을 바꾼다 — 기존 `const resume = await loadResumeRequests(admin, principal.userId, projectId, holder)` 줄과 그 뒤 `return NextResponse.json({…})` 를 아래로 바꾼다:

```ts
    const leased = await leasedProjectIds(admin, principal.userId, holder)
    const resume = await loadResumeRequests(admin, principal.userId, projectId, leased, agent)
    const buildReady = leased === undefined ? null
      : await loadBuildReady(admin, principal.userId, leased ?? (projectId !== null ? [projectId] : null), agent, { requireTag: requireTag as string | null, wp })
    return NextResponse.json({
      ok: true,
      expires_at: new Date(now.getTime() + WATCHER_TTL_MS).toISOString(),
      resume_requests: resume,
      ...(resume === null ? { resume_requests_error: '재개 요청 조회에 실패했습니다.' } : {}),
      build_ready: buildReady,
      ...(buildReady === null ? { build_ready_error: '구현 대기 목록 조회에 실패했습니다.' } : {}),
    })
```

`leasedProjectIds` 는 `loadResumeRequests` 안의 lease 조회를 함수로 빼낸 것이다(조회 수는 종전과 같은 한 번):

```ts
/** 이 holder 로 쥔 살아 있는 lease 의 프로젝트(스펙 §9). holder 가 없으면 null(거르지 않음), 조회 실패는 undefined. */
async function leasedProjectIds(
  admin: ReturnType<typeof createAdminClient>, userId: string, holder: string | null,
): Promise<string[] | null | undefined> {
  if (holder === null) return null
  const { data, error } = await admin
    .from('agent_lead_leases').select('project_id')
    .eq('user_id', userId).eq('holder', holder).gt('expires_at', new Date().toISOString())
  if (error) { console.error('[agent-api] lease 조회 실패:', error.message); return undefined }
  return ((data ?? []) as Array<{ project_id: string }>).map(r => r.project_id)
}
```

`loadResumeRequests` 의 인자 `holder` 를 `leased: string[] | null | undefined` 로 바꾸고 함수 머리의 lease 조회 블록을 지운다 — `leased === undefined` 면 `return null`(조회 실패), `leased !== null && leased.length === 0` 이면 `return []`, 그 밖은 종전 본문 그대로(`leased` 가 배열이면 `.in('project_id', leased)` 와 in-memory 필터). 응답 조립은 `const leased = await leasedProjectIds(admin, principal.userId, holder)` 를 먼저 부르고 `loadResumeRequests(admin, principal.userId, projectId, leased, agent)` 로 넘긴다. `loadBuildReady` 에는 `leased === undefined` 면 `null`(실패) 을 그대로 쓰고, 아니면 `leased ?? (projectId !== null ? [projectId] : null)` 를 넘긴다(위 조립 코드의 `leasedIds` 두 줄을 이 규칙으로 쓴다). 파일 머리 import 에 `isMine`·`listFilterPass`·`parseWpList`(designGate)와 `ITEM_FACT_COLUMNS`·`ORDER_FACT_COLUMNS`·`decide`·`loadItemFacts`·`orderFactsOf`·`type FactItemRow`·`type FactOrderRow`(designFacts)를 더한다.

- [ ] **Step 6: 재개 요청은 설계 검토 대기면 거부(Y10)**

`src/app/actions/agentHub.ts` 의 `requestResumeOnOrder` — 주문 조회 select 에 `design_state` 를 더하고, 호스트 계산 앞에:

```ts
  // Y10(설계 상태 스펙 12절) — 설계 검토 대기(review)는 사람이 「설계 승인」을 누를 때까지 이어 갈 것이 없다. 그 밖은 재개한다.
  if ((order as { design_state?: string | null }).design_state === 'review') {
    return { ok: false, error: '설계 검토 대기 중인 작업입니다 — 「설계 승인」을 누르면 팀장이 다음 TICK 에 이어 갑니다.' }
  }
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/agent/mine-route.test.ts tests/agent/work-routes-pat.test.ts tests/agent/work-routes.test.ts tests/agent/watch-route.test.ts tests/actions/agent-hub-actions.test.ts && npx tsc --noEmit -p .`
Expected: PASS. 기존 테스트의 `agent_work_orders`·`wbs_items` 큐 끝에 판단 재료 조회가 더 끼지만 큐가 비면 `{ data: null }` 이 돌아와 "없음"으로 처리된다(`loadItemFacts` 는 `data ?? []` 로 받는다). 레거시 상세 응답(`work-routes.test.ts`)은 칸이 늘지 않아야 한다 — 늘었으면 PAT 분기 밖으로 새어 나간 것이다.

- [ ] **Step 8: 커밋**

```bash
git add src/app/api/v1/agent/work/mine/route.ts src/app/api/v1/agent/work/\[id\]/route.ts src/app/api/v1/agent/watch/route.ts src/app/actions/agentHub.ts \
  tests/agent/mine-route.test.ts tests/agent/watch-route.test.ts
git add $(git diff --name-only -- tests)   # 고친 기존 테스트(파일명 확인 뒤)
git commit -m "feat(design-state): 목록·상세·watch 가 서버 판단(action·mine)과 설계 상태를 싣는다

팀장 요청(lead=1)은 claimed 주문에도 거르기와 팀원 라벨을 본다(Y9). watch 는 이 PC 가 띄울 build 목록을 싣고(D22),
재개 요청에 mine 을 더한다(Y10). 설계 검토 대기는 좌석 재개 요청을 받지 않는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: 계약 2.11 — 버전과 계약 문서

**Files:**
- Modify: `src/lib/agent/externalApi.ts:121-125`, `.claude/skills/dflow-work/scripts/dflow.sh:9-15`, `.claude/skills/dflow-work/references/api-contract.md:1-12`(머리·새 절)·`:303-327`(에러 표·exit)
- Test: `tests/agent/me-route.test.ts:60`, `tests/skills/dflow-done-decisions.test.ts:214-221`, `tests/skills/dflow-heartbeat-merge-conflict.test.ts:79-87`, `tests/skills/dflow-force-progress.test.ts:86-92`

**Interfaces:**
- Consumes: Task 10~16 의 요청·응답 모양
- Produces: `AGENT_CONTRACT_VERSION = '2.11'`, `CONTRACT_VERSION=2.11`, 계약 문서 `# D'Flow Agent API 계약 v2.11`

다섯 곳이 서로 대조하므로 한 커밋에서 함께 바꾼다.

- [ ] **Step 1: 테스트의 기대 버전을 먼저 바꾼다(실패 확인용)**

- `tests/agent/me-route.test.ts:60` → `expect(body.contract_version).toBe('2.11')`
- `tests/skills/dflow-done-decisions.test.ts:218` → `expect(cli).toBe('2.11')`
- `tests/skills/dflow-heartbeat-merge-conflict.test.ts` 의 그 `it` → 이름 `'계약 버전은 2.11 이상(2.7 변경점 유지), …'`, `expect(src).toMatch(/^CONTRACT_VERSION=2\.11$/m)`, `expect(doc).toContain('# D\'Flow Agent API 계약 v2.11')`
- `tests/skills/dflow-force-progress.test.ts` 의 그 describe → 이름 `'계약 문서 v2.8(변경점 절 유지, 버전은 2.11)'`, `expect(sh).toMatch(/^CONTRACT_VERSION=2\.11$/m)`

Run: `npx vitest run tests/agent/me-route.test.ts tests/skills/dflow-done-decisions.test.ts tests/skills/dflow-heartbeat-merge-conflict.test.ts tests/skills/dflow-force-progress.test.ts`
Expected: FAIL(2.10)

- [ ] **Step 2: 버전을 올린다**

`src/lib/agent/externalApi.ts`:

```ts
// 2.10: heartbeat phase wait_review — 설계만 멈춤, 2026-09-26 설계 §14(dflow-dev-skill-router-design.md §14.5).
// 2.11: 설계 상태·구현자동 — 목록·상세·watch 의 action·mine·설계 상태, claim·build-start 의 scope, design-done·design-reopen,
//       409 design_gate·design_not_accepted·runner_active(docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 8절).
export const AGENT_CONTRACT_VERSION = '2.11'
```

`.claude/skills/dflow-work/scripts/dflow.sh` 머리 주석에 한 줄을 더하고 버전을 바꾼다:

```sh
# 2.11: 설계 상태·구현자동 — claim·build-start --scope, design-done·design-reopen, list 의 action·mine, exit 11(DESIGN_GATE)·12(RUNNER_ACTIVE).
CONTRACT_VERSION=2.11
```

- [ ] **Step 3: 계약 문서에 v2.11 절을 더한다**

`.claude/skills/dflow-work/references/api-contract.md`:
- 1행 → `# D'Flow Agent API 계약 v2.11`
- 3행의 `` `contract_version: "2.10"` `` → `` `contract_version: "2.11"` ``, 문장 끝에 `v2.11은 설계 상태(설계 방식·설계 검토·구현자동)와 도는 PC 를 더했다.` 를 붙인다.
- `## v2.10 변경점 (2026-09-26)` 바로 앞에 이 절을 넣는다:

```markdown
## v2.11 변경점 (2026-09-27)

설계 정본: wbs-web 리포 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md(12절 우선).

- **설계 방식**(`wbs_items.design_mode`): `auto`(완전자동, 기본)·`review`(설계 검토 — 에이전트 설계를 사람이 「설계 승인」)·
  `human`(구현자동 — 사람 설계를 「설계 확정」). 수동은 위임 표식 없음.
- **새 단계** `dd`(설계 완료, 실적 20). 사람의 단계 선택·import 는 `dd` 를 받지 않는다.
- **목록·상세·watch 응답**(PAT): 주문마다 `design_mode`·`design_state`(null·`review`·`accepted`)·`design_note`·`claim_scope`·
  `runner`·`runner_seen_at`·`action`(`full`·`design`·`build`·`skip`·`wait`)·`action_reason`·`deps_unmet`·`mine`.
  팀장·워커는 스스로 판정하지 않고 이 값을 따른다.
- **목록 요청**(`GET /work/mine`): `agent=<라벨>`(PC 판정), `require_tag=<태그>`, `wp=<WP 목록>`, `lead=1`(claimed 의 mine 에
  거르기·팀원 라벨 `/w<n>` 을 요구). 상세(`GET /work/{id}`)는 `agent` 만.
- **watch**: 본문 `require_tag`·`wp`. 응답 `build_ready`(이 신원·이 PC 가 띄울 build 주문, 실패면 null + `build_ready_error`),
  `resume_requests[].mine`·`.design_state`.
- **claim**: 본문 `scope`(`full`·`design`·`build`, 없으면 legacy). **build-start**: 본문 `scope`(`full`·`build`·`rework`).
- **새 동사**: `POST /work/{id}/design-done`(설계 멈춤 — 점유자), `POST /work/{id}/design-reopen` 본문 `reason`(되돌리기 —
  claimed 면 점유자, ready 면 그 주문을 후보로 받는 PAT).
- **새 409**: `design_gate`(설계 관문 — build-start 가 주문이 claimed 가 아니거나 CAS 가 어긋나면 `reason: order_changed`),
  `design_not_accepted`(승인·확정된 설계 없음), `runner_active`(다른 PC 가 도는 중 — 본문 `runner`·`runner_seen_at`).
  heartbeat 도 다른 PC 가 30분 안에 신호를 냈으면 `runner_active` 다. 완료 보고는 도는 PC 에서만, 살아 있는 다른 세션이
  없을 때만, 리프면 단계 `ip` 에서만 받는다. release 는 설계 상태가 있으면 `design_gate`(웹의 「중단」을 쓴다).
- **dflow.sh**: `design_gate`·`design_not_accepted` → exit 11(stderr `DESIGN_GATE <code> [reason]`), `runner_active` → exit 12
  (stderr `RUNNER_ACTIVE <runner>`). 옛 서버(2.11 미만)는 모든 작업을 auto 로 본다 — 스킬은 `contract-ge 2.11` 이 거짓이면
  design-done·design-reopen 을 부르지 않는다(`DESIGN_STATE_UNSUPPORTED`).
```

- 에러 코드 전수 표(`## 에러 코드` 절의 409 행들)에 세 행을 더한다:

```markdown
| 409 | `design_gate` | 설계 관문 거부(방식·설계 상태·단계). build-start 의 `reason: order_changed` 는 설계가 되돌려졌거나 다른 PC 가 이어받은 것 | exit 11 |
| 409 | `design_not_accepted` | 승인·확정된 설계가 없다 — 「설계 승인」·「설계 확정」을 먼저 | exit 11 |
| 409 | `runner_active` | 다른 PC 가 이 작업을 돌리는 중(본문 `runner`) | exit 12 |
```

(표의 칸 수가 다르면 그 표의 머리에 맞춘다.)

- 끝의 exit 문장을 `` - `dflow.sh` exit code: 0 성공 / 2 … / 10 중단됨(409 `code=cancelled`) / 11 설계 관문(409 `design_gate`·`design_not_accepted`) / 12 다른 PC 도는 중(409 `runner_active`). `` 로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/me-route.test.ts tests/skills/dflow-done-decisions.test.ts tests/skills/dflow-heartbeat-merge-conflict.test.ts tests/skills/dflow-force-progress.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/agent/externalApi.ts .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/references/api-contract.md \
  tests/agent/me-route.test.ts tests/skills/dflow-done-decisions.test.ts tests/skills/dflow-heartbeat-merge-conflict.test.ts tests/skills/dflow-force-progress.test.ts
git commit -m "feat(design-state): 계약 2.11 — 서버·CLI·계약 문서의 버전과 v2.11 변경점

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
## Task 18: dflow.sh — exit 11·12, claim·build-start 범위, design-done·design-reopen, list 의 action·mine

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh`(머리 exit 줄 5행, usage 25~67행, `api_raw` 181~187행, `print_list` 218~226행, `cmd_list` 258~288행, `cmd_show` 290~294행, `cmd_claim` 360~401행, `cmd_build_start` 408~428행, `cmd_watch` 572~607행, 디스패치 853~873행)
- Test: `tests/skills/dflow-design-state-cli.test.ts`(새)

**Interfaces:**
- Consumes: Task 10~17 의 서버 요청·응답
- Produces(스킬 문서·poll.sh·팀장이 쓴다):
  - exit 11: 409 `design_gate`·`design_not_accepted` — stderr 끝줄 `DESIGN_GATE <code>[ <reason>]`(예: `DESIGN_GATE design_gate order_changed`)
  - exit 12: 409 `runner_active` — stderr 끝줄 `RUNNER_ACTIVE <runner>`
  - `claim <ref> [--design-first] [--scope full|design|build]` — 성공 출력에 서버가 저장한 범위 `CLAIM_SCOPE <scope>` 한 줄(새 서버·PAT)
  - `build-start <ref> [--scope full|build|rework]`
  - `design-done <ref>` → `design-done <id8> <review|accepted|none>`; 404 이고 서버 계약 < 2.11 이면 stderr `DESIGN_STATE_UNSUPPORTED …` 에 exit 7
  - `design-reopen <ref> --reason "<이유>"` → `design-reopened <id8> <status> <design_state|none>`
  - `list [...] [--require-tag t] [--wp W] [--lead]` — 요청에 `agent=<agent_id_default>`, 출력 TSV 끝에 `action`·`mine`(1·0) 두 열. 옛 서버면 두 열이 빈 값
  - `show <ref>` — 요청에 `agent=<agent_id_default>`. Task 16 의 상세 라우트는 이 라벨의 PC 로 `mine` 을 계산한다. 라벨이 없으면 `runner` 가 찬 주문은 늘 `mine=false` 라, 이어받은 워커가 자기 작업을 "다른 PC 도는 중" 으로 잘못 알고 멈춘다(워커·팀장 문서가 `.order.mine` 을 본다)
  - `watch [...] [--require-tag t] [--wp W]` — 본문에 `require_tag`·`wp`. `--json` 이면 응답 그대로(`build_ready` 포함)

- [ ] **Step 1: 실패하는 테스트**

`tests/skills/dflow-design-state-cli.test.ts`:

```ts
// tests/skills/dflow-design-state-cli.test.ts — 설계 상태(계약 2.11)의 CLI 계약. dflow.sh 를 가짜 curl 로 실제 실행한다
// (dflow-design-first.test.ts 와 같은 방식). exit 11·12, 범위 인자, 새 동사, list 의 action·mine 열, 옛 서버 폴백을 고정한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// 가짜 curl — POST 본문은 BODY_FILE, 요청 URL 은 URL_FILE 에 한 줄씩 적는다. 응답은 FAKE_* 로 고른다.
function fakeCurlScript() {
  return `#!/bin/sh
out=''; data=''; url=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -X|-H|-w) shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -sS) shift ;;
    *) url="$1"; shift ;;
  esac
done
[ -n "$data" ] && printf '%s\\n' "$data" >> "$BODY_FILE"
printf '%s\\n' "$url" >> "$URL_FILE"
case "$url" in
  *"/agent/me") code=200; body="{\\"contract_version\\":\\"\${FAKE_ME:-2.11}\\"}" ;;
  *"/agent/work/mine"*)
    case "\${FAKE_LIST:-new}" in
      new) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"},"action":"design","mine":true}]}' ;;
      old) code=200; body='{"claimed":[],"assigned":[],"available":[{"id":"${WORK_ID}","project_id":"${PID}","status":"ready","priority":1,"item":{"name":"t"}}]}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/claim")
    case "\${FAKE_CLAIM:-ok}" in
      ok) code=200; body='{"ok":true,"status":"claimed","item":{},"depends_evidence":[],"claim_scope":"design"}' ;;
      gate) code=409; body='{"error":"x","code":"design_gate"}' ;;
      na) code=409; body='{"error":"x","code":"design_not_accepted"}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/build-start")
    case "\${FAKE_BS:-ok}" in
      ok) code=200; body='{"ok":true,"stage":"ip","runner":"hong/mbp/w1"}' ;;
      changed) code=409; body='{"error":"x","code":"design_gate","reason":"order_changed"}' ;;
      runner) code=409; body='{"error":"x","code":"runner_active","runner":"kim/pc2/w1"}' ;;
      conflict) code=409; body='{"error":"x","code":"conflict"}' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/design-done")
    case "\${FAKE_DD:-ok}" in
      ok) code=200; body='{"ok":true,"status":"claimed","stage":"dd","design_state":"review"}' ;;
      auto) code=200; body='{"ok":true,"status":"claimed","stage":"dd","design_state":null}' ;;
      old) code=404; body='<html>404</html>' ;;
    esac ;;
  *"/agent/work/${WORK_ID}/design-reopen") code=200; body='{"ok":true,"status":"ready","stage":"as","design_state":null}' ;;
  *"/agent/work/${WORK_ID}/heartbeat") code=409; body='{"error":"x","code":"runner_active","runner":"kim/pc2/w1"}' ;;
  *"/agent/work/${WORK_ID}"*) code=200; body='{"order":{"id":"${WORK_ID}","item":{}},"depends_evidence":[]}' ;;
  *"/agent/watch") code=200; body='{"ok":true,"expires_at":"x","resume_requests":[],"build_ready":[]}' ;;
  *) code=200; body='{}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string, repo: string, bodies: string, urls: string
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV, PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_ID: PID,
      BODY_FILE: bodies, URL_FILE: urls, ...env,
    },
  })
}
const sent = () => (existsSync(bodies) ? readFileSync(bodies, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const urlsSent = () => (existsSync(urls) ? readFileSync(urls, 'utf8').trim().split('\n') : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-ds-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurlScript(), { mode: 0o755 })
  bodies = join(tmp, 'bodies.jsonl'); urls = join(tmp, 'urls.log')
  repo = join(tmp, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w1\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('exit 11·12(계약 2.11)', () => {
  it('claim 이 409 design_gate·design_not_accepted 면 exit 11, stderr 끝줄 DESIGN_GATE <code>', () => {
    const a = run(['claim', WORK_ID, '--scope', 'full'], { FAKE_CLAIM: 'gate' })
    expect(a.status).toBe(11)
    expect(a.stderr.trim().split('\n').pop()).toBe('DESIGN_GATE design_gate')
    const b = run(['claim', WORK_ID, '--scope', 'build'], { FAKE_CLAIM: 'na' })
    expect(b.status).toBe(11)
    expect(b.stderr).toContain('DESIGN_GATE design_not_accepted')
  })
  it('build-start 의 order_changed 는 reason 까지 싣는다(Y7)', () => {
    const r = run(['build-start', WORK_ID, '--scope', 'build'], { FAKE_BS: 'changed' })
    expect(r.status).toBe(11)
    expect(r.stderr.trim().split('\n').pop()).toBe('DESIGN_GATE design_gate order_changed')
  })
  it('runner_active 는 exit 12, stderr 끝줄 RUNNER_ACTIVE <runner> — heartbeat 도 같다', () => {
    const r = run(['build-start', WORK_ID, '--scope', 'full'], { FAKE_BS: 'runner' })
    expect(r.status).toBe(12)
    expect(r.stderr.trim().split('\n').pop()).toBe('RUNNER_ACTIVE kim/pc2/w1')
    expect(run(['heartbeat', WORK_ID, '--phase', 'build']).status).toBe(12)
  })
  it('다른 409(conflict)는 종전대로 exit 4', () => {
    expect(run(['build-start', WORK_ID], { FAKE_BS: 'conflict' }).status).toBe(4)
  })
  it('사용법·파일 머리의 exit 표에 11·12 가 있다', () => {
    const r = spawnSync('sh', [DFLOW], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: join(tmp, 'home'), NODE_ENV: process.env.NODE_ENV, DFLOW_CONFIG_DIR: join(tmp, 'no-config') } })
    expect(r.stderr).toMatch(/11 설계 관문/)
    expect(r.stderr).toMatch(/12 다른 PC 도는 중/)
    expect(readFileSync(DFLOW, 'utf8').split('\n')[4]).toContain('11 설계 관문')
  })
})

describe('claim·build-start 범위(D21)', () => {
  it('claim --scope design 은 본문에 scope, 성공 출력에 서버 범위 CLAIM_SCOPE', () => {
    const r = run(['claim', WORK_ID, '--scope', 'design'])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'design' })
    expect(r.stdout).toContain('CLAIM_SCOPE design')
  })
  it('claim 은 --design-first 와 --scope 를 순서와 무관하게 받는다', () => {
    expect(run(['claim', WORK_ID, '--design-first', '--scope', 'full']).status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'full', design_first: true })
  })
  it('모르는 범위는 사용법(exit 2)', () => {
    expect(run(['claim', WORK_ID, '--scope', 'weird']).status).toBe(2)
    expect(run(['build-start', WORK_ID, '--scope', 'design']).status).toBe(2)
  })
  it('build-start --scope rework 는 본문에 scope', () => {
    expect(run(['build-start', WORK_ID, '--scope', 'rework']).status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', scope: 'rework' })
  })
})

describe('design-done·design-reopen', () => {
  it('design-done 은 설계 상태를 한 줄로 낸다', () => {
    const r = run(['design-done', WORK_ID])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('design-done 99999999 review')
    expect(run(['design-done', WORK_ID], { FAKE_DD: 'auto' }).stdout.trim()).toBe('design-done 99999999 none')
  })
  it('옛 서버(404, 계약 < 2.11)면 DESIGN_STATE_UNSUPPORTED 에 exit 7', () => {
    const r = run(['design-done', WORK_ID], { FAKE_DD: 'old', FAKE_ME: '2.9' })
    expect(r.status).toBe(7)
    expect(r.stderr).toContain('DESIGN_STATE_UNSUPPORTED')
  })
  it('design-reopen 은 --reason 이 없으면 exit 2, 있으면 본문에 reason', () => {
    expect(run(['design-reopen', WORK_ID]).status).toBe(2)
    const r = run(['design-reopen', WORK_ID, '--reason', '테스트 계획 절 없음'])
    expect(r.status).toBe(0)
    expect(sent().at(-1)).toEqual({ agent: 'hong/mbp/w1', reason: '테스트 계획 절 없음' })
    expect(r.stdout.trim()).toBe('design-reopened 99999999 ready none')
  })
})

describe('list·watch(Y4·D22)', () => {
  it('list 는 agent·거르기 쿼리를 싣고, 끝에 action·mine 열을 낸다', () => {
    const r = run(['list', '--scope', 'assigned', '--require-tag', 'agent', '--wp', 'WP-02', '--lead'])
    expect(r.status).toBe(0)
    const u = urlsSent().find(x => x.includes('/work/mine')) ?? ''
    expect(u).toContain('agent=hong%2Fmbp%2Fw1')
    expect(u).toContain('require_tag=agent')
    expect(u).toContain('wp=WP-02')
    expect(u).toContain('lead=1')
    expect(r.stdout.trim().split('\t')).toEqual(['1', 'RD', '1', '99999999', 't', 'design', '1'])
  })
  it('옛 서버 목록은 두 열이 빈 값 — 열 번호는 그대로', () => {
    const r = run(['list'], { FAKE_LIST: 'old' })
    expect(r.stdout.replace(/\n$/, '').split('\t')).toEqual(['1', 'RD', '1', '99999999', 't', '', ''])
  })
  it('watch 는 거르기를 본문에 싣는다', () => {
    expect(run(['watch', '--agent', 'hong/mbp/lead', '--require-tag', 'agent', '--wp', 'WP-02,dict/WP-3', '--json']).status).toBe(0)
    expect(sent().at(-1)).toMatchObject({ agent: 'hong/mbp/lead', require_tag: 'agent', wp: 'WP-02,dict/WP-3' })
  })
  it('show 는 요청 라벨(agent)을 싣는다 — 상세 응답의 mine 이 이 PC 로 계산된다', () => {
    expect(run(['show', WORK_ID]).status).toBe(0)
    expect(urlsSent().find(x => x.includes(`/agent/work/${WORK_ID}`)) ?? '').toContain(`/agent/work/${WORK_ID}?agent=hong%2Fmbp%2Fw1`)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-design-state-cli.test.ts`
Expected: FAIL

- [ ] **Step 3: exit 매핑과 사용법**

`dflow.sh` 5행(머리 exit 줄)을 바꾼다:

```sh
# exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버·로컬 환경 / 7 기능꺼짐 / 10 중단됨(409 code=cancelled) / 11 설계 관문(409 design_gate·design_not_accepted) / 12 다른 PC 도는 중(409 runner_active)
```

`api_raw` 의 409 갈래를 바꾼다:

```sh
    409)
      printf '%s\n' "$_body" >&2
      _c=$(printf '%s' "$_body" | jq -r '.code // empty' 2>/dev/null)
      case "$_c" in
        # 사람이 중단한 주문(2026-09-19)은 경합·상태 불일치와 처방이 다르다 — 재시도가 아니라 즉시 멈춤이다.
        cancelled) exit 10 ;;
        # 설계 관문(계약 2.11) — 선행 대기(exit 4)와 처방이 다르다: 서버 판단(action)을 다시 보거나 사람이 버튼을 누른다.
        design_gate|design_not_accepted)
          _r=$(printf '%s' "$_body" | jq -r '.reason // empty' 2>/dev/null)
          printf 'DESIGN_GATE %s%s\n' "$_c" "${_r:+ $_r}" >&2
          exit 11 ;;
        # 다른 PC 가 이 작업을 돌리는 중(설계 상태 스펙 D25) — 이 워커는 멈춘다.
        runner_active)
          printf 'RUNNER_ACTIVE %s\n' "$(printf '%s' "$_body" | jq -r '.runner // "-"' 2>/dev/null)" >&2
          exit 12 ;;
      esac
      exit 4 ;;
```

`usage` 의 명령 목록을 고친다 — `claim`·`build-start` 두 항목을 바꾸고 `design-done`·`design-reopen` 을 `build-start` 다음에 더하며 `list`·`watch` 옵션과 끝의 exit 두 줄을 바꾼다:

```text
  list [--all] [--scope available|claimed|assigned|all] [--any-project] [--require-tag t] [--wp WP-02,…] [--lead]
                         기본은 이 리포에 바인딩된 프로젝트의 주문만. 끝의 두 열은 서버 판단 action·mine(1/0) — 옛 서버면 빈 값(계약 2.11).
                         --require-tag·--wp 는 서버가 mine 을 계산할 거르기, --lead 는 팀장 요청(claimed 의 mine 에 팀원 라벨 요구)
  claim <ref> [--design-first] [--scope full|design|build]
                         주문의 프로젝트가 이 리포 바인딩 밖이면 거부(exit 2, PROJECT_MISMATCH).
                         --scope(계약 2.11): 없으면 legacy. 서버가 저장한 범위를 CLAIM_SCOPE <scope> 한 줄로 낸다(새 서버).
                         --design-first(계약 2.9): 선행이 구현 중이어도 설계부터 잡는다(단계 ds). 미충족 선행이 있으면
                         DESIGN_FIRST_UNMET <JSON 배열> 한 줄을 더 낸다. 너무 이른 선행이면 exit 4 + stderr DESIGN_FIRST_TOO_EARLY
  build-start <ref> [--scope full|build|rework]
                         설계를 마치고 구현으로 넘긴다(ds·dd→ip). 선행 미충족이면 exit 4, 설계 관문이면 exit 11, 다른 PC 가 돌면 exit 12.
                         404 는 서버 계약이 2.9 미만일 때만 stderr BUILD_START_UNSUPPORTED 에 exit 0, 2.9 이상이면 exit 7
  design-done <ref>      설계를 마치고 멈춘다(계약 2.11) — 출력 design-done <id8> <review|accepted|none>. 옛 서버는 DESIGN_STATE_UNSUPPORTED·exit 7
  design-reopen <ref> --reason "<이유>"
                         설계를 사람에게 되돌린다(계약 2.11) — 출력 design-reopened <id8> <status> <design_state|none>
  watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--holder h] [--require-tag t] [--wp W] [--json] [--stop]
                         감시자 존재 신호(좌석표 STANDBY). 기본 agent 는 <신원>/<host>/poll. --json 이면 build_ready·resume_requests 를 그대로
exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버·로컬 환경 / 7 기능꺼짐 / 10 중단됨 / 11 설계 관문 / 12 다른 PC 도는 중
      10 = 사람이 D'Flow 에서 작업을 중단했다(409 code=cancelled). 더 진행하지 말고 멈춘다
      11 = 설계 관문(409 design_gate·design_not_accepted). stderr 끝줄 DESIGN_GATE <code> [reason] — 서버 판단을 다시 보거나 사람이 버튼을 누른다
      12 = 다른 PC 가 이 작업을 돌리는 중(409 runner_active). stderr 끝줄 RUNNER_ACTIVE <runner> — 이 워커는 멈춘다
```

- [ ] **Step 4: list·print_list**

```sh
# ---- 출력: compact 1행/건 (순번 상태 우선순위 id8 이름40 action mine) -----
# action·mine 은 계약 2.11 서버 판단이다. 옛 서버는 두 칸이 빈 값이다 — 앞 다섯 칸의 번호는 그대로라 옛 파서가 깨지지 않는다.
print_list() { # stdin = 주문 배열 JSON
  jq -r 'to_entries[] | [
    (.key+1),
    ({ready:"RD",claimed:"CL",reported:"RP",approved:"AP",cancelled:"CX"}[.value.status] // "??"),
    .value.priority,
    (.value.id[0:8]),
    ((.value.item.name // .value.instructions // "-") | .[0:40]),
    (.value.action // ""),
    (if .value.mine == true then "1" elif .value.mine == false then "0" else "" end)
  ] | @tsv'
}
uri() { jq -rn --arg v "$1" '$v|@uri'; }
```

`cmd_list` 의 옵션 루프에 셋을 더하고, 두 `api_raw GET` 호출의 경로를 공통 쿼리로 바꾼다:

```sh
cmd_list() {
  _scope='available'; _all=''; _anyp=''; _tag=''; _wp=''; _lead=''
  while [ $# -gt 0 ]; do case "$1" in
    --all) _all=1 ;;
    --scope) _scope="$2"; shift ;;
    --any-project) _anyp=1 ;;
    --require-tag) _tag="${2:-}"; shift ;;
    --wp) _wp="${2:-}"; shift ;;
    --lead) _lead=1 ;;
    *) die 2 "알 수 없는 옵션: $1" ;;
  esac; shift; done
  # 요청 라벨(PC 판정)과 거르기(계약 2.11) — 서버가 mine 을 계산한다. 옛 서버는 모르는 쿼리를 무시한다.
  _q="scope=$_scope&limit=$MINE_LIMIT&agent=$(uri "$(agent_id_default)")"
  [ -z "$_tag" ] || _q="$_q&require_tag=$(uri "$_tag")"
  [ -z "$_wp" ] || _q="$_q&wp=$(uri "$_wp")"
  [ -z "$_lead" ] || _q="$_q&lead=1"
```

그리고 두 곳의 `"/api/v1/agent/work/mine?scope=$_scope&limit=$MINE_LIMIT"` 를 `"/api/v1/agent/work/mine?$_q"` 로 바꾼다.

`cmd_show` 도 요청 라벨을 싣는다(옛 서버는 모르는 쿼리를 무시한다). `cmd_claim` 안의 상세 조회(선행 evidence 용)는 `mine` 을 쓰지 않으므로 그대로 둔다:

```sh
cmd_show() {
  _id=$(resolve_ref "$1")
  # 요청 라벨(계약 2.11) — 서버가 이 라벨의 PC 로 mine 을 계산한다. 없으면 runner 가 찬 주문은 늘 mine=false 다.
  _body=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id?agent=$(uri "$(agent_id_default)")") || exit $?
  printf '%s' "$_body" | jq .
}
```

(테스트의 `agent=hong%2Fmbp%2Fw1` 은 `@uri` 가 `/` 를 `%2F` 로 바꾸기 때문이다.)

- [ ] **Step 5: claim·build-start·새 동사**

`cmd_claim` 을 아래로 바꾼다(두 갈래로 나뉘던 요청을 하나로 합친다 — 출력은 종전과 같고 `CLAIM_SCOPE` 한 줄이 더해질 뿐이다):

```sh
cmd_claim() {
  _ref="$1"; shift
  _df=''; _scope=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --design-first) _df=1; shift ;;
      --scope) case "${2:-}" in full|design|build) _scope="$2"; shift 2 ;; *) usage ;; esac ;;
      *) usage ;;
    esac
  done
  _id=$(resolve_ref "$_ref")
  check_project "$_id"
  # ① show 로 선행 evidence 를 먼저 받아 로컬 검사 — 통과 전에는 claim 자체를 하지 않는다(결정 C-②).
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  check_depends_local "$(printf '%s' "$_detail" | jq -c '.depends_evidence // []')"
  # 작업 폴더 이름도 claim 전에 검사한다 — 잡은 뒤에 거부하면 주문만 claimed 로 남는다.
  _tsk_from_ref "$_detail" >/dev/null || exit $?
  # 라벨 결정론(§3) — heartbeat(agent_id_default)와 신원을 맞춰야 좌석표가 claimed_by 와 heartbeat_agent 를 합친다.
  _label=$(agent_id_default)
  _json=$(jq -nc --arg a "$_label" --arg s "$_scope" --arg d "$_df" \
    '{agent:$a} + (if $s != "" then {scope:$s} else {} end) + (if $d != "" then {design_first:true} else {} end)')
  # 옛 서버는 scope·design_first 를 모르고 무시한다(계약 2.9 이전은 design_first 도 무시 — 선행 미충족이면 종전 403 → exit 4).
  _err="$CACHE_DIR/dflow_claim_err.$$"; mkdir -p "$CACHE_DIR"
  _resp=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/claim" "$_json" 2>"$_err"); _rc=$?
  cat "$_err" >&2
  if [ "$_rc" -ne 0 ]; then
    if [ "$_rc" -eq 4 ] && [ "$(jq -r '.reason // empty' "$_err" 2>/dev/null | head -1)" = design_first_too_early ]; then
      printf 'DESIGN_FIRST_TOO_EARLY %s\n' "$(jq -c '.unmet // []' "$_err" 2>/dev/null | head -1)" >&2
    fi
    rm -f "$_err"; exit "$_rc"
  fi
  rm -f "$_err"
  write_spec_cache "$_resp"
  printf 'claimed %s\n' "$(printf '%s' "$_id" | cut -c1-8)"
  # 서버가 저장한 범위(계약 2.11, D21) — 워커는 이 값으로 state.json scope 를 적는다. 옛 서버·레거시 응답에는 없다.
  _cs=$(printf '%s' "$_resp" | jq -r '.claim_scope // empty' 2>/dev/null)
  [ -z "$_cs" ] || printf 'CLAIM_SCOPE %s\n' "$_cs"
  # 미충족 선행이 있을 때만 알린다 — 없으면(선행 충족·옛 서버) 종전 claim 과 같은 출력이다.
  _unmet=$(printf '%s' "$_resp" | jq -c 'if .design_first == true then (.unmet // []) else [] end' 2>/dev/null) || _unmet='[]'
  [ "${_unmet:-[]}" = '[]' ] || printf 'DESIGN_FIRST_UNMET %s\n' "$_unmet"
}
```

`cmd_build_start` 머리에 옵션을 읽고 본문에 싣는다(404 폴백은 그대로):

```sh
cmd_build_start() {
  _ref="$1"; shift; _scope=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --scope) case "${2:-}" in full|build|rework) _scope="$2"; shift 2 ;; *) usage ;; esac ;;
      *) usage ;;
    esac
  done
  _id=$(resolve_ref "$_ref")
  _err="$CACHE_DIR/dflow_bs_err.$$"; mkdir -p "$CACHE_DIR"
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/build-start" \
    "$(jq -nc --arg a "$(agent_id_default)" --arg s "$_scope" '{agent:$a} + (if $s != "" then {scope:$s} else {} end)')" 2>"$_err"); _rc=$?
```

(그 아래 `if [ "$_rc" -eq 7 ]; then …` 부터 끝까지는 그대로.)

`cmd_build_start` 다음에 두 동사를 더한다:

```sh
# 옛 서버(계약 < 2.11)에는 두 동사가 없다 — 404 면 계약 버전을 보고 표식을 남긴 뒤 exit 7(기능 꺼짐).
# 스킬은 contract-ge 2.11 로 먼저 가르므로 여기 닿는 것은 판단이 어긋났을 때뿐이다(설계 상태 스펙 8절).
design_state_404() {
  _cv=$(server_contract_version); _vrc=$?
  if [ "$_vrc" -eq 0 ] && ! version_ge "$_cv" 2.11; then
    printf 'DESIGN_STATE_UNSUPPORTED 서버 계약 %s < 2.11 — 이 동사가 없다\n' "$_cv" >&2
  fi
  exit 7
}

# 설계를 마치고 멈춘다(계약 2.11, 설계 상태 스펙 6.3). 점유자 본인만. 서버가 단계 dd, 설계 상태(review 방식·design 범위면 review)를 둔다.
cmd_design_done() {
  _id=$(resolve_ref "$1")
  _err="$CACHE_DIR/dflow_dd_err.$$"; mkdir -p "$CACHE_DIR"
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/design-done" \
    "$(jq -nc --arg a "$(agent_id_default)" '{agent:$a}')" 2>"$_err"); _rc=$?
  cat "$_err" >&2; rm -f "$_err"
  [ "$_rc" -ne 7 ] || design_state_404
  [ "$_rc" -eq 0 ] || exit "$_rc"
  printf 'design-done %s %s\n' "$(printf '%s' "$_id" | cut -c1-8)" "$(printf '%s' "$_body" | jq -r '.design_state // "none"')"
}

# 설계를 사람에게 되돌린다(계약 2.11, 설계 상태 스펙 4.1 design_reopen). 사유는 화면에 보인다.
cmd_design_reopen() {
  _ref="$1"; shift; _reason=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason) _reason="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [ -n "$_reason" ] || die 2 "design-reopen 은 --reason \"<이유>\" 가 필요하다(화면에 보인다)"
  _id=$(resolve_ref "$_ref")
  _err="$CACHE_DIR/dflow_dr_err.$$"; mkdir -p "$CACHE_DIR"
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/design-reopen" \
    "$(jq -nc --arg a "$(agent_id_default)" --arg r "$_reason" '{agent:$a, reason:$r}')" 2>"$_err"); _rc=$?
  cat "$_err" >&2; rm -f "$_err"
  [ "$_rc" -ne 7 ] || design_state_404
  [ "$_rc" -eq 0 ] || exit "$_rc"
  printf 'design-reopened %s %s %s\n' "$(printf '%s' "$_id" | cut -c1-8)" \
    "$(printf '%s' "$_body" | jq -r '.status // "-"')" "$(printf '%s' "$_body" | jq -r '.design_state // "none"')"
}
```

- [ ] **Step 6: watch 거르기와 디스패치**

`cmd_watch` 의 옵션 루프에 두 줄을 더하고(`--holder` 다음), 본문 jq 에 두 칸을 더한다:

```sh
      --require-tag) _tag="${2:-}"; shift 2 || usage ;;
      --wp)      _wp="${2:-}";      shift 2 || usage ;;
```

변수 초기화 줄에 `_tag=''; _wp=''` 를 더하고, 본문 jq 인자에 `--arg tg "$_tag" --arg wp "$_wp"` 를, 식 끝에 `+ (if $tg != "" then {require_tag:$tg} else {} end) + (if $wp != "" then {wp:$wp} else {} end)` 를 더한다.

디스패치(`case "$CMD" in`)를 고친다:

```sh
       build-start) [ $# -ge 1 ] || usage; cmd_build_start "$@" ;;
       design-done) [ $# -eq 1 ] || usage; cmd_design_done "$@" ;;
       design-reopen) [ $# -ge 1 ] || usage; cmd_design_reopen "$@" ;;
```

- [ ] **Step 7: 통과 확인(옛 서버 폴백 포함)**

Run: `npx vitest run tests/skills/dflow-design-state-cli.test.ts tests/skills/dflow-design-first.test.ts tests/skills/dflow-exit-cancelled.test.ts tests/skills/dflow-list-limit.test.ts tests/skills/dflow-claim-identity.test.ts tests/skills/dflow-key-select.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS. `dflow-list-limit` 이 URL 을 글자 그대로 비교하면 `&agent=…` 가 붙은 새 URL 에 맞춘다. 상세 조회(`show`) URL 을 글자 그대로 비교하거나 `*"/agent/work/<id>")` 처럼 끝을 닫은 패턴으로 가짜 응답을 고르는 기존 테스트가 있으면 `?agent=…` 가 붙은 URL 에 맞춘다(`rtk proxy grep -rln 'agent/work/' tests/skills` 로 찾는다). `shell-syntax` 는 dash·bash 로 문법을 검사한다.

- [ ] **Step 8: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh tests/skills/dflow-design-state-cli.test.ts
git add $(git diff --name-only -- tests/skills)   # 고친 기존 테스트(파일명 확인 뒤)
git commit -m "feat(dflow.sh): 설계 관문 exit 11·다른 PC exit 12, 범위 인자, design-done·design-reopen, list 의 action·mine

옛 서버는 두 열이 빈 값이고 새 동사는 DESIGN_STATE_UNSUPPORTED·exit 7 로 끝나 계약 2.9 운영 API 에서도 그대로 돈다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: poll.sh — action·mine 으로 고른다(Y4)

**Files:**
- Modify: `.claude/skills/dflow-poll/scripts/poll.sh`(옵션 13~54행, 후보 선정 210~247행, 머리 주석 2~10행)
- Test: `tests/skills/dflow-poll-actions.test.ts`(새)

**Interfaces:**
- Consumes: Task 18 `dflow.sh list … --require-tag --wp --lead` 의 6·7열
- Produces:
  - 새 옵션 `--actions <목록>`(기본 `full,design,build`), `--lead`(list 에 넘김). `--require-tag`·`--wp` 는 list 에도 넘긴다.
  - ready 출력 줄 `순번<TAB>id8<TAB>이름<TAB>action`(4번째 칸은 새 서버만 — 옛 서버면 종전 세 칸 그대로). 새 서버 행은 `action ∈ --actions ∧ mine=1` 만. 옛 서버 행(6열이 빈 값)은 종전 규칙(show 로 태그·WP 거르기).

- [ ] **Step 1: 실패하는 테스트**

`tests/skills/dflow-poll-actions.test.ts`:

```ts
// tests/skills/dflow-poll-actions.test.ts — poll.sh 가 서버 판단(action·mine, 계약 2.11)으로 ready 를 고른다(설계 상태 스펙 12절 Y4).
// 가짜 dflow.sh 로 실제 poll.sh 를 돌린다(dflow-poll-exclude-wait.test.ts 와 같은 방식).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const POLL_SH = join(process.cwd(), '.claude/skills/dflow-poll/scripts/poll.sh')
const ENV = { PATH: process.env.PATH ?? '', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
let tmp: string, cfg: string, bin: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-poll-act-')))
  cfg = join(tmp, 'cfg'); bin = join(tmp, 'bin'); mkdirSync(cfg); mkdirSync(bin)
  writeFileSync(join(cfg, '.dflow'), 'api_base=https://p.test\nproject_id=11111111-1111-4111-8111-111111111111\nrelease_branch=main\n')
  writeFileSync(join(cfg, '.dflow.local'), 'pats=dflow_pat_TEST_token\ndev_branch=main\n')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

// list 는 받은 인자를 args 파일에 적고 rows 를 돌려준다. show 가 불리면 shows 에 적는다(새 서버 행은 불리면 안 된다).
function stub(rows: string[]) {
  const f = join(bin, 'dflow.sh')
  writeFileSync(f, `#!/bin/sh
case "$1" in
  list) printf '%s\\n' "$*" >> '${join(tmp, 'args')}'; printf '%s\\n' ${rows.map((r) => `'${r}'`).join(' ')} ;;
  show) echo "$2" >> '${join(tmp, 'shows')}'; printf '{"order":{"id":"x","item":{"tags":["agent"],"external_ref":"M/TSK-02-01"}}}' ;;
  *) exit 0 ;;
esac
`)
  chmodSync(f, 0o755)
  return f
}
function poll(args: string[], rows: string[]) {
  const r = spawnSync('sh', [POLL_SH, '--interval', '0', '--until', 'none', ...args], {
    cwd: cfg, encoding: 'utf8', timeout: 20000,
    env: { ...ENV, DFLOW_SH: stub(rows), DFLOW_WATCH: '0', DFLOW_CONFIG_DIR: cfg } as NodeJS.ProcessEnv,
  })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' }
}
const listArgs = () => readFileSync(join(tmp, 'args'), 'utf8')
const shows = () => (existsSync(join(tmp, 'shows')) ? readFileSync(join(tmp, 'shows'), 'utf8').trim().split('\n') : [])
const rowNew = (n: number, id8: string, action: string, mine: '1' | '0') => `${n}\tRD\tx\t${id8}\t작업${id8}\t${action}\t${mine}`
const rowOld = (n: number, id8: string) => `${n}\tRD\tx\t${id8}\t작업${id8}\t\t`

describe('poll.sh — 서버 판단으로 고른다(Y4)', { timeout: 30000 }, () => {
  it('새 서버: action ∈ full·design·build ∧ mine=1 인 RD 만, 4번째 칸에 action, show 를 부르지 않는다', () => {
    const r = poll(['--require-tag', 'agent'], [rowNew(1, 'aaaaaaaa', 'wait', '1'), rowNew(2, 'bbbbbbbb', 'design', '1'), rowNew(3, 'cccccccc', 'full', '0')])
    expect(r.code, r.err).toBe(0)
    expect(r.out).toBe('2\tbbbbbbbb\t작업bbbbbbbb\tdesign')
    expect(shows()).toEqual([])
  })
  it('--actions full 이면 design·build 는 고르지 않는다(/dflow-poll 단독)', () => {
    const r = poll(['--actions', 'full'], [rowNew(1, 'aaaaaaaa', 'design', '1'), rowNew(2, 'bbbbbbbb', 'full', '1')])
    expect(r.out).toBe('2\tbbbbbbbb\t작업bbbbbbbb\tfull')
  })
  it('옛 서버(6열 빈 값)는 종전대로 — show 로 거르고 3칸 줄을 낸다', () => {
    const r = poll(['--require-tag', 'agent'], [rowOld(1, 'aaaaaaaa')])
    expect(r.out).toBe('1\taaaaaaaa\t작업aaaaaaaa')
    expect(shows()).toEqual(['aaaaaaaa'])
  })
  it('거르기와 --lead 를 list 에 넘긴다(WP 는 정규화해서)', () => {
    poll(['--require-tag', 'agent', '--wp', 'WP-02', '--lead'], [rowNew(1, 'aaaaaaaa', 'full', '1')])
    expect(listArgs()).toContain('list --scope assigned --require-tag agent --wp WP-2 --lead')
  })
  it('--actions 에 모르는 값은 사용법(exit 2)', () => {
    expect(poll(['--actions', 'weird'], []).code).toBe(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-poll-actions.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

머리 주석 3행을 `# ready 발견 시 stdout 에 "순번<TAB>id8<TAB>이름<TAB>action" 을 줄 단위로 내고 종료한다(action 은 계약 2.11 서버 판단 — 옛 서버면 빈 값).` 로 바꾼다.

옵션 변수에 둘을 더한다(`WP=""` 블록 다음):

```sh
ACTIONS="full,design,build"  # 고를 서버 판단(계약 2.11). /dflow-poll 단독은 full 만 — review·human 은 팀장·사람 몫(설계 상태 스펙 7절).
LEAD=""           # 1 이면 list 에 --lead(팀장 요청: claimed 의 mine 에 팀원 라벨 요구). 팀장 아래에서 켠다.
```

usage 문자열 끝에 ` [--actions full,design,build] [--lead]` 를 더하고, 옵션 파싱에 두 줄을 더한다:

```sh
    --actions)        ACTIONS="${2:-}"; shift 2 || usage ;;
    --lead)           LEAD=1; shift ;;
```

`ACTIONS` 검사를 `case "$TAG_CACHE_CYCLES"` 줄 다음에 더한다:

```sh
for _a in $(printf '%s' "$ACTIONS" | tr ',' ' '); do case "$_a" in full|design|build) ;; *) usage ;; esac; done
```

210행의 list 호출을 바꾼다:

```sh
  set -- list --scope assigned
  [ -z "$REQUIRE_TAG" ] || set -- "$@" --require-tag "$REQUIRE_TAG"
  [ -z "$WP" ] || set -- "$@" --wp "$WP"
  [ -z "$LEAD" ] || set -- "$@" --lead
  out=$("$DFLOW" "$@" 2>&1); rc=$?
```

214~215행의 ready 선택을 바꾼다:

```sh
      # 새 서버(계약 2.11)는 6열 action·7열 mine 을 준다 — action ∈ ACTIONS ∧ mine=1 인 RD 만(Y4). 서버가 태그·WP 거르기를 이미
      # 반영했으므로 아래 show 거르기는 건너뛴다. 옛 서버(6열 빈 값)는 종전 규칙(show 로 거르기)을 그대로 탄다.
      ready=$(printf '%s\n' "$out" | awk -F'\t' -v ex=",$EXCLUDE,$EXCLUDE_TEMP,$EXCLUDE_WAIT," -v acts=",$ACTIONS," \
        '$2=="RD" && index(ex, ","$4",")==0 && ($6=="" || (index(acts, ","$6",") > 0 && $7=="1")) {l = $1"\t"$4"\t"$5; if ($6 != "") l = l"\t"$6; print l}')
```

그리고 show 거르기 루프 머리(`while IFS= read -r _line; do` 다음)에서 새 서버 행은 그대로 남긴다:

```sh
          # 새 서버 행(4번째 칸 action 이 있다)은 서버가 거르기를 반영했다 — show 없이 남긴다.
          if [ -n "$(printf '%s' "$_line" | cut -f4)" ]; then _kept="${_kept}${_line}
"; continue; fi
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/dflow-poll-actions.test.ts tests/skills/dflow-poll-exclude-wait.test.ts tests/skills/dflow-poll-tag-cache.test.ts tests/skills/dflow-poll-task-dirs.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS. 기존 poll 테스트의 가짜 행은 5칸이라 6열이 비어 옛 서버 규칙을 타고, 출력도 종전 세 칸 그대로다.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-poll/scripts/poll.sh tests/skills/dflow-poll-actions.test.ts
git add $(git diff --name-only -- tests/skills)   # 고친 기존 테스트(파일명 확인 뒤)
git commit -m "feat(poll): 서버 판단(action·mine)으로 ready 를 고른다 — 기다리는 작업 때문에 팀장이 끝없이 깨지 않게(Y4)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: heartbeat 훅 — 409 runner_active 면 워커를 멈춘다(Y1·P9)

**Files:**
- Modify: `kit/hooks/heartbeat.sh`(머리 주석 5~8행, 6번 전송 265~277행)
- Test: `tests/skills/heartbeat-hook.test.ts`

**Interfaces:**
- Consumes: Task 12 의 409 `runner_active` 본문(`runner`)
- Produces: 409 `runner_active` 면 `{continue:false, stopReason:"다른 PC(<runner>)가 이 작업을 이어받았습니다(<id8>)…"}` 를 내고, state.json 은 바꾸지 않으며, 절제 스탬프(`~/.dflow/hb/<order>`)를 지운다. 새 훅은 PC 마다 다시 설치해야 한다(`kit/install.sh --hooks`) — 이 계획의 반영(staging)과 별개로, 킷 배포 때 사람에게 알린다.

- [ ] **Step 1: 실패하는 테스트**

`tests/skills/heartbeat-hook.test.ts` 끝에 더한다:

```ts
describe('heartbeat.sh — 다른 PC 가 이어받음(409 runner_active, 설계 상태 스펙 12절 Y1·계획 P9)', () => {
  const ORDER = '22222222-2222-4222-8222-222222222222'
  const STATE = () => join(repo, 'docs/tasks/TSK-01/state.json')
  const RA = { FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"error":"x","code":"runner_active","runner":"kim/pc2/w1"}' }
  beforeEach(() => { writeFileSync(join(repo, '.dflow-agent'), 'hong/mbp/w2\n') })

  it('continue:false 로 세우고 이유에 runner 를 적는다 — state.json·중단 표식은 건드리지 않는다', () => {
    const j = JSON.parse(runOut(RA).trim())
    expect(j.continue).toBe(false)
    expect(j.stopReason).toContain('kim/pc2/w1')
    expect(j.stopReason).toContain('22222222')
    expect(JSON.parse(readFileSync(STATE(), 'utf8')).phase).toBe('build')
    expect(existsSync(join(home, `.dflow/hb/${ORDER}.cancelled`))).toBe(false)
  })
  it('절제 스탬프를 지워 다음 도구 호출도 다시 묻고 다시 세운다', () => {
    runOut(RA)
    expect(existsSync(join(home, `.dflow/hb/${ORDER}`))).toBe(false)
    expect(JSON.parse(runOut(RA).trim()).continue).toBe(false)
  })
  it('다음 heartbeat 가 200 이면 세우지 않는다(이 PC 가 정당하게 넘겨받음)', () => {
    runOut(RA)
    expect(runOut({ FAKE_HB_CODE: '200', FAKE_HB_BODY: '{"ok":true}' }).trim()).toBe('')
  })
  it('다른 409(conflict)는 종전대로 무시한다(fail-open)', () => {
    expect(runOut({ FAKE_HB_CODE: '409', FAKE_HB_BODY: '{"code":"conflict"}' }).trim()).toBe('')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts`
Expected: FAIL(새 describe — runner_active 를 무시한다)

- [ ] **Step 3: 구현**

머리 주석 8행 다음에 줄을 더한다:

```sh
# 예외 둘(설계 상태 스펙 12절 Y1): 다른 PC 가 이 작업을 이어받았으면(서버 409 code=runner_active) state.json 은 그대로 두고 세운다.
# 영속 표식을 남기지 않는 대신 절제 스탬프를 지워 다음 도구 호출이 다시 묻고 다시 세운다 — 나중에 이 PC 가 정당하게 넘겨받으면
# (다른 PC 가 30분 넘게 조용) heartbeat 가 200 이 되어 저절로 풀린다.
```

6번 전송 뒤(`[ "$_code" = 409 ] || exit 0` 부터 파일 끝까지)를 바꾼다:

```sh
[ "$_code" = 409 ] || exit 0
_resp=$(printf '%s\n' "$_out" | sed '$d')
_code=$(printf '%s' "$_resp" | "$JQ" -r '.code // empty' 2>/dev/null || :)
case "$_code" in
  cancelled)
    : > "$_hbdir/$_order.cancelled" 2>/dev/null || :
    stop_now "$_state" "$_order" ;;
  runner_active)
    rm -f "$_stamp" 2>/dev/null || :
    _rn=$(printf '%s' "$_resp" | "$JQ" -r '.runner // "-"' 2>/dev/null || :)
    _id8=$(printf '%s' "$_order" | cut -c1-8)
    "$JQ" -nc --arg r "다른 PC($_rn)가 이 작업을 이어받았습니다($_id8). 더 진행하지 말고 멈추세요. 결과는 skipped 다른 PC 도는 중으로 끝냅니다." \
      '{continue:false, stopReason:$r}'
    exit 0 ;;
esac
exit 0
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/skills/heartbeat-hook.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS(이 파일은 전체 실행 때 흔들리는 넷 중 하나다 — 단독 실행 결과로 판정한다)

- [ ] **Step 5: 커밋**

```bash
git add kit/hooks/heartbeat.sh tests/skills/heartbeat-hook.test.ts
git commit -m "feat(hook): 다른 PC 가 이어받은 워커를 heartbeat 409 runner_active 로 멈춘다(Y1)

state.json 을 바꾸지 않고 절제 스탬프만 지워, 이 PC 가 정당하게 넘겨받으면 저절로 풀린다. PC 마다 훅 재설치가 필요하다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: 워커 문서 — 서버 판단·범위·설계 받기·design-done(`/dflow-dev`·워커 프롬프트)

**Files:**
- Modify: `.claude/skills/dflow-dev/SKILL.md`(상태 모델의 `wait_review` 두 줄, exit 10 문단 끝, 「실행 범위 (--scope)」 본문)
- Modify: `.claude/skills/dflow-dev/references/orch/start.md`(「서버 판단」·「끝나지 않은 설계 멈춤 이어받기」 추가, 「설계 검토 대기」·「구현부터」 교체, 다음 단계)
- Modify: `.claude/skills/dflow-dev/references/orch/claim.md`·`design.md`·`design-first.md`·`rework.md`·`close.md`
- Modify: `.claude/skills/dflow-dev/references/worker-mode.md`(인자 파싱, 설계 선행, 새 「설계 상태의 결과 줄」)
- Modify: `.claude/skills/dflow-team/references/worker-prompt.md`(`{SCOPE_FLAG}` 행, 「5」, 「7」 표)
- Test: `tests/skills/dflow-dev-scope.test.ts`(다시 씀), `tests/skills/dflow-dev-worker.test.ts`(표지 블록 앵커 둘), `tests/skills/dflow-no-docker.test.ts`(주석 한 줄)

**Interfaces:**
- Consumes: Task 16 상세 응답 `.order` 의 `action`·`action_reason`·`mine`·`design_mode`·`design_state`·`claim_scope`·`runner`·`runner_seen_at`·`item.stage`(`mine` 은 Task 18 의 `show` 가 보내는 라벨로 계산), Task 18 의 `claim --scope`·`CLAIM_SCOPE` 줄·`build-start --scope`·`design-done`·`design-reopen`·exit 11(`DESIGN_GATE <code>[ <reason>]`)·exit 12(`RUNNER_ACTIVE <runner>`), Task 20 훅의 runner_active 멈춤
- Produces(Task 22 팀장이 처리한다): 워커 결과 줄 — 정본은 worker-mode.md 「설계 상태의 결과 줄」 표
  - `skipped`: `<action_reason>`·`다른 PC 도는 중(<runner>)`·`fetch 실패`·`push 실패`·`사람 설계 초안 있음`·`설계 관문(<code>)`
  - `design_review`: `-`·`design-done 미확인`·빠진 절·`선행 계약 바뀜: <파일…>`
  - `design_reopened`(새): 빠진 절·`선행 계약 바뀜: <파일…>`·`주문이 바뀜`
  - `design_waiting`: 종전 사유 + `design-done 미확인`
  - `failed`: `방식 확인 필요`·`브랜치 갈라짐 <로컬 sha> <origin sha>`·`design-done 거부(<code>)`·`설계 게이트 불통(구현 중)`·`설계 변경 필요 — <이유>`·`원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume`·`완료 보고 거부(<code>)`

**지키는 문서 불변식**(문서 테스트가 검사한다 — 어기면 다른 테스트가 깨진다):
- `SKILL.md` 는 9,000자를 넘지 않는다(`dflow-dev-split` 마지막 it). 지금 8,933자이고 이 Task 뒤 8,885자다. 그래서 규칙은 단계 파일에 두고 `SKILL.md` 는 가리키기만 한다.
- 분할 전 원문(`tests/skills/fixtures/dflow-dev.SKILL.presplit.md`)의 줄은 같은 순서로 남아야 한다. 이 Task 는 원문 줄을 고치지 않고 **더하기만** 한다. 교체하는 곳(start 「설계 검토 대기」 첫 줄·「구현부터」 머리 세 줄과 표지 블록, claim 15~16·58행, design 11~12행·「설계만 멈춤」, rework·start 의 「다음 단계」, `SKILL.md` 의 `wait_review`·「실행 범위」)은 모두 분할 뒤 2.10 작업이 더한 줄이라 `CHANGED_SPLIT` 을 고칠 일이 없다.
- 워커 표지 블록은 11개 그대로다(`dflow-no-docker`). 새 워커 결과는 새 블록을 만들지 않고 worker-mode.md 「그 밖의 워커 규칙」 아래 표 하나에 모은다(워커는 시작 때 `sections.sh … '그 밖의 워커 규칙'` 으로 하위 절까지 읽는다). 기존 블록 둘(start 「구현자동 착수」 끝, design 「설계만 멈춤」 끝)은 그 표를 가리키게 바꾼다.

**옛 서버 처리**(Global Constraints, 스펙 8절): 모든 새 동작은 `dflow.sh contract-ge 2.11` 이 참일 때만이다. 옛 서버에서는 모든 작업을 완전자동으로 보고 종전대로 돈다. 수동 `--scope design`·`build` 는 2.10 의 로컬 흐름(「옛 서버의 설계 검토 대기」·「옛 서버의 범위 build」·설계만 멈춤의 heartbeat `wait_review`)을 그대로 남긴다. 팀장은 옛 서버에서 범위를 넘기지 않으므로(poll 의 action 칸이 비어 `SCOPE=full`) 이 흐름은 워커 경로에 없다.

**계획 단계 검증**: 이 Task 의 수정안(아래 문구 그대로)을 scratchpad 의 리포 사본에 적용해 `dflow-dev-scope`·`dflow-dev-worker`·`dflow-dev-split`·`dflow-no-docker` 네 파일 84건이 통과했고(옛 서버 흐름을 남긴 판), `tests/skills` 전체에서 기준선에 없던 실패가 없었다(기준선 실패는 사본 환경의 시간 초과뿐).

**문구 옮기는 법**: 각 수정은 "찾을 원문"과 "바꿀·더할 문구"로 적었다. 원문은 그 파일에 정확히 한 번 있다. 코드 블록 안의 빈 줄과 줄바꿈 위치도 그대로 옮긴다(표지 블록 앵커가 줄 단위로 검사된다).

- [ ] **Step 1: 실패하는 테스트 — 문서 테스트를 새 규칙으로 바꾼다**

`tests/skills/dflow-dev-scope.test.ts` 를 통째로 아래로 바꾼다. 팀장 쪽 단언(`다른 스킬` 의 둘째·셋째 it)은 Task 22 가 팀장 문서와 함께 바꾸므로 지금 문구 그대로 둔다.

```ts
// tests/skills/dflow-dev-scope.test.ts — /dflow-dev 실행 범위(--scope)와 설계 상태(계약 2.11)의 워커 문서.
// 설계: docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 6절·12절(2.10 의 router 설계 §14 를 대신한다)
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devOrch, devRouter } from './_dflow-dev'
import { stripWorkerBlocks, workerBlocks } from './_preserve'

const flat = (s: string) => s.replace(/\s+/g, ' ')
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const WORKER_MODE = '.claude/skills/dflow-dev/references/worker-mode.md'

describe('안내 본문(SKILL.md)', () => {
  const router = flat(devRouter())
  it('범위는 가리키기만 하고, 정하는 규칙은 start 「서버 판단」 에 있다', () => {
    expect(router).toContain('[--scope design|build|full]')
    expect(router).toContain('`--only` 와 함께 오면 사용법을 알리고 멈춘다')
    expect(router).toContain('범위를 정하는 규칙(서버 판단·`claim_scope`·옛 서버)은 `orch/start.md` 「서버 판단」')
  })
  it('wait_review 는 서버 설계 상태가 이어 갈지 정하고, exit 12 는 state.json 을 바꾸지 않고 멈춘다', () => {
    expect(router).toContain('사람의 「설계 승인」을 기다리며 멈춘 상태다')
    expect(router).toContain('이어 갈지는 서버 설계 상태가 정한다')
    expect(router).toContain('exit 12(다른 PC 가 이어받음)도 그 자리에서 멈추되 state.json 은 바꾸지 않는다')
  })
  it('팀장 인자·2.10 결과 값이 워커 문서에 남지 않는다(D27)', () => {
    for (const t of [devRouter(), ...['start', 'claim', 'design', 'design-first', 'rework', 'close'].map(devOrch), read(WORKER_MODE)])
      expect(t).not.toMatch(/개발자동|구현부터|design_missing|design_invalid|failed diverged/)
  })
})

describe('착수 — 서버 판단(start.md)', () => {
  const s = flat(devOrch('start'))
  it('계약 2.11 이면 show 의 서버 판단으로 먼저 가르고, 옛 서버는 종전 로컬 흐름으로 돈다(스펙 8절)', () => {
    expect(s).toContain('**서버 판단(계약 2.11)** — `dflow.sh contract-ge 2.11` 이 exit 0 이면')
    expect(s).toContain('계약 2.11 이 아니면(옛 서버) 이 문단을 건너뛰고 종전대로 한다')
    expect(s).toContain('**옛 서버의 설계 검토 대기**(계약 < 2.11, 수동 실행)')
    expect(s).toContain('design.md 를 검토한 뒤 /dflow-dev {TSK} --scope build 로 이어 간다')
    expect(s).toContain('**옛 서버의 범위 build**(계약 < 2.11, 수동 실행)')
    expect(s).toContain('**빠진 절을 스스로 채우지 않는다**')
  })
  it('ready 는 --scope 또는 action 으로 범위를 정하고, wait·skip 이면 착수하지 않는다', () => {
    expect(s).toContain('`action` 이 `wait`·`skip` 이면 착수하지 않고 `"{TSK} 지금은 할 일이 없다 — <action_reason>"`')
  })
  it('claimed 는 mine 을 보고, 설계 검토 대기면 멈추며, claim_scope 가 수동 --scope 를 이긴다(Y1·D21)', () => {
    expect(s).toContain('`mine` 이 거짓이면 이어 가지 않는다')
    expect(s).toContain('"원래 PC 의 세션이 살아 있으면 먼저 끄세요"')
    expect(s).toContain('`"{TSK} 설계 검토 대기 — 「설계 승인」을 누르면 이어 간다"`')
    expect(s).toContain('claimed 의 범위는 서버 `claim_scope` 로 정한다')
    expect(s).toContain('수동 `--scope` 는 무시하고 그 사실을 한 줄 남긴다')
  })
  it('구현 중 재개는 build-start 로 도는 PC 를 넘겨받는다(P7)', () => {
    expect(s).toContain('그 단계로 가기 전에 `dflow.sh build-start <ref> --scope <범위>` 를 먼저 부른다')
  })
  it('끝나지 않은 설계 멈춤은 push 를 맞춘 뒤 design-done 을 마저 한다(6.3 W3·L4·Y6)', () => {
    expect(s).toContain('**끝나지 않은 설계 멈춤 이어받기(계약 2.11)**')
    expect(s).toContain('`wait_pred` 이고 서버 단계(`.order.item.stage`)가 `ds` 면')
    expect(s).toContain('로컬이 앞서 있으면 `git push origin <agent 브랜치>` 한다')
    expect(s).toContain('서버에 설계 검토 대기가 없습니다')
  })
  it('승인된 설계는 설계 받기로 이어 가고, 구현자동 착수는 claim 뒤 설계를 받는다', () => {
    expect(s).toContain('**승인된 설계 이어 가기(계약 2.11)**')
    expect(s).toContain('「3」 0 의 switch 뒤, 1 전에 `orch/design.md` 「설계 받기」 를 한다')
    expect(s).toContain('`## 선행 기준` 절이 있을 때만 한다')
    expect(s).toContain('### 구현자동 착수 (ready, 범위 `build`)')
  })
  it('워커는 알림 대신 결과 줄 표를 쓴다(표지 블록 안)', () => {
    const b = workerBlocks(devOrch('start')).map((x) => x.body).join('\n')
    expect(b).toContain('worker-mode.md 「설계 상태의 결과 줄」')
    expect(stripWorkerBlocks(devOrch('start'))).not.toContain('「설계 상태의 결과 줄」')
  })
})

describe('claim(claim.md)', () => {
  const c = flat(devOrch('claim'))
  it('범위 design·full 은 개발 브랜치의 사람 설계 초안을 확인한다(6.3·L5)', () => {
    expect(c).toContain('**사람 설계 초안 확인(계약 2.11, 범위 `design`·`full`)**')
    expect(c).toContain('`git cat-file -e origin/<기본브랜치>:<TASKS>/<TSK>/design.md`')
  })
  it('계약 2.11 이면 --scope 를 붙이고, CLAIM_SCOPE 를 state.json 에 적으며, exit 11 은 재시도하지 않는다', () => {
    expect(c).toContain('위 명령 끝에 `--scope <범위>`')
    expect(c).toContain('출력의 `CLAIM_SCOPE <범위>` 줄이 서버가 저장한 범위다')
    expect(c).toContain('설계 관문 거부다 — 아래 재시도를 하지 않고 원래 위치로 돌아가')
    expect(c).toContain('같은 쓰기에서 `scope` 를 적는다 — claim 출력의 `CLAIM_SCOPE` 값이고')
  })
  it('범위 build 의 설계 폴더는 격리하지 않는다', () => {
    expect(c).toContain('**범위 `build`(구현자동)의 설계 폴더도 예외다**')
  })
})

describe('Design(design.md)', () => {
  const d = flat(devOrch('design'))
  it('범위 build 는 설계를 받아 곧바로 게이트를 돌고, 불통이면 design-reopen 으로 되돌린다(6.4)', () => {
    expect(d).toContain('### 설계 받기 (범위 `build`, 계약 2.11)')
    expect(d).toContain('`git merge --ff-only origin/<그 브랜치>`')
    expect(d).toContain('`git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 받아 워크트리의 같은 파일에 덮어쓰고')
    expect(d).toContain('`dflow.sh design-reopen <ref> --reason "<빠진 절>"`')
    expect(d).toContain('빠진 절을 스스로 채우지 않는다')
  })
  it('build-start 에 범위를 붙이고, exit 11·12 행이 있다(Y7)', () => {
    expect(d).toContain('위 호출은 `dflow.sh build-start <ref> --scope <범위>` 다')
    expect(d).toContain('반려 재작업(`orch/rework.md`)이면 방식과 무관하게 `rework` 다')
    expect(d).toContain('| exit 11 + stderr 끝줄 `DESIGN_GATE design_gate order_changed` |')
    expect(d).toContain('| 그 밖의 exit 11(`DESIGN_GATE <code>`) |')
    expect(d).toContain('| exit 12(`RUNNER_ACTIVE <runner>`) |')
  })
  it('설계만 멈춤은 push 뒤 design-done 으로 끝난다(순서 고정)', () => {
    const sec = d.split('### 설계만 멈춤')[1]?.split('### 승인된 설계 고정')[0] ?? ''
    expect(sec).toContain('`build-start` 를 **부르지 않는다**')
    const order = ['design.md 커밋을 확인한다', 'state.json `phase` 를 `wait_review` 로 쓰고', '`progress 25 "설계 완료(검토 대기)"`',
      '`git push origin <agent 브랜치>`', '`dflow.sh design-done <ref>` 를 부른다', '「설계 승인」을 누르면 팀장이 이어 간다']
    const idx = order.map((o) => sec.indexOf(o))
    idx.forEach((i, k) => expect(i, order[k]).toBeGreaterThan(-1))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(sec).toContain('그 밖의 이유로 실패하면 4 를 하지 않고')
    expect(sec).toContain('`wait_pred` 를 쓰지 않는 이유')
    expect(sec).toContain('옛 서버면 `dflow.sh heartbeat <ref> --phase wait_review` 를 부른다')
  })
  it('승인된 설계는 ip 이상에서 고정이다(D24·L3)', () => {
    expect(d).toContain('### 승인된 설계 고정 (D24, 계약 2.11)')
    expect(d).toContain('`## 도커 금지로 생략한 검증`')
    expect(d).toContain('Design 으로 후퇴하려 하면 후퇴하지 않고')
  })
  it('워커는 알림 대신 결과 줄 표를 쓴다(표지 블록 안)', () => {
    const b = workerBlocks(devOrch('design')).map((x) => x.body).join('\n')
    expect(b).toContain('worker-mode.md 「설계 상태의 결과 줄」')
  })
})

describe('설계 선행·재작업·마감', () => {
  const f = flat(devOrch('design-first'))
  it('설계 선행 멈춤은 계약 2.11 에서 design-done 을 부른다(옛 서버는 heartbeat wait_pred)', () => {
    expect(f).toContain('`dflow.sh heartbeat <ref> --phase wait_pred`')
    expect(f).toContain('계약 2.11(`dflow.sh contract-ge 2.11` 이 exit 0)이면 heartbeat 대신 `dflow.sh design-done <ref>` 를 부른다')
    expect(f).toContain('그 밖의 이유로 실패하면 4·5 를 하지 않고')
  })
  it('선행 계약 출처에 개발 브랜치의 사람 설계, 계약이 바뀌면 방식별로 되돌린다(6.4)', () => {
    expect(f).toContain('`git cat-file -e origin/<기본브랜치>:<TASKS>/<선행TSK>/design.md`')
    expect(f).toContain('`dflow.sh design-reopen <ref> --reason "선행 계약 바뀜: <파일…>"`')
    expect(f).toContain('`human` 은 design.md 를 고치지 않고')
  })
  it('재작업은 claim_scope build 면 Design 없이 승인된 설계로, build-start 는 rework(6.5)', () => {
    const r = flat(devOrch('rework'))
    expect(r).toContain('서버 `claim_scope` 가 `build` 면')
    expect(r).toContain('`"{TSK} 설계 변경 필요 — <이유>"`')
    expect(r).toContain('재작업의 `build-start` 는 방식과 무관하게 `--scope rework` 다')
  })
  it('마감은 사람 커밋 충돌(Y13)과 done 의 exit 11·12 를 가른다', () => {
    const k = flat(devOrch('close'))
    expect(k).toContain('`"{TSK} 원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume 하세요"`')
    expect(k).toContain('done 이 exit 12(stderr 끝줄 `RUNNER_ACTIVE <runner>`)면')
    expect(k).toContain('exit 11(`DESIGN_GATE <code>`)이면 서버가 완료 보고를 거부했다')
  })
})

describe('워커 규칙(worker-mode.md·worker-prompt.md)', () => {
  const w = flat(read(WORKER_MODE))
  it('--scope 는 새 claim 의 범위이고, 잡힌 작업은 claim_scope 가 이긴다', () => {
    expect(w).toContain('팀장이 넘긴 `--scope` 는 새 claim 의 범위이고, 이미 잡힌 작업은 서버 `claim_scope` 가 이긴다')
  })
  it('결과 줄 표가 「그 밖의 워커 규칙」 아래에 있어 워커가 시작 때 함께 읽는다', () => {
    const r = spawnSync('bash', [join(process.cwd(), '.claude/skills/dflow-dev/scripts/sections.sh'), join(process.cwd(), WORKER_MODE), '그 밖의 워커 규칙'], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('### 설계 상태의 결과 줄(계약 2.11)')
  })
  it('결과 줄 표가 새 status·사유를 모두 싣는다', () => {
    for (const t of ['`<action_reason>`', '`다른 PC 도는 중(<runner>)`', '`방식 확인 필요`', '`design-done 미확인`',
      '`브랜치 갈라짐 <로컬 sha> <origin sha>`', '`fetch 실패`', '`push 실패`', '`사람 설계 초안 있음`', '`설계 관문(<code>)`',
      '`design_reopened`', '`주문이 바뀜`', '`design-done 거부(<code>)`', '`설계 게이트 불통(구현 중)`', '`설계 변경 필요 — <이유>`',
      '`원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume`', '`완료 보고 거부(<code>)`'])
      expect(w, t).toContain(t)
  })
  it('worker-prompt: SCOPE 는 늘 --scope 로 넘기고, 서버 쓰기 범위와 결과 표에 새 동사·status 가 있다', () => {
    const wp = flat(read('.claude/skills/dflow-team/references/worker-prompt.md'))
    expect(wp).toContain('| `{SCOPE_FLAG}` | `SCOPE` | 값이 있으면 늘 `--scope <SCOPE>`')
    expect(wp).toContain('`/dflow-dev {ID8} --worker {MODEL_FLAG} {SCOPE_FLAG}`')
    expect(wp).toContain('`design-done {ID8}`·`design-reopen {ID8} --reason …` 은 이 범위 안이다')
    expect(wp).toContain('| `design_reopened` |')
    expect(wp).not.toContain('design_missing')
  })
})

describe('다른 스킬', () => {
  it('승인 스윕은 wait_review 브랜치를 후보로 잡지 않는다(문서와 스크립트가 같은 필터)', () => {
    const f = 'select(.phase != "merged" and .phase != "wait_pred" and .phase != "wait_review")'
    expect(read('.claude/skills/dflow-merge/SKILL.md')).toContain(f)
    expect(read('.claude/skills/dflow-merge/scripts/sweep-check.sh')).toContain(f)
  })
  it('팀장: 인자로 범위를 정해 team.start·포인터로 넘기고, 워커가 --scope 로 바꾼다', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('"설계만"·"설계까지" → `design`, "구현부터"·"개발자동" → `build`, 없으면 `full`')
    expect(team).toContain('`team.start`(backend, slots, until, wp, scope)')
    expect(team).toContain('SCOPE=<full|design|build>')
    expect(team).toContain('| `design_review`(설계만 멈춤, `<SCOPE>`=`design`) | 해제 | 없음 |')
    expect(read('.claude/skills/dflow-team/scripts/lead-state.sh')).toContain('scope=\\($st.scope // "-")')
  })
  it('팀장: 범위 build 만 검토 대기 설계를 이어 가고, 좌석 「이어서 시작」 은 범위와 무관하게 build 로 띄운다', () => {
    const sc = flat(read('.claude/skills/dflow-team/references/scope.md'))
    expect(sc).toContain('select(.phase == "wait_review")')
    expect(sc).toContain('`full`·`design` 에서는 1 을 하지 않는다')
    expect(sc).toContain('요청 작업이 검토 대기면 포인터를 `SCOPE=build` 로 띄운다')
    expect(sc).toContain('git -C \'<MAIN>\' cat-file -e "origin/<개발브랜치>:<TASK_DIR>/design.md"')
    expect(flat(read('.claude/skills/dflow-team/references/restart.md'))).toContain('| 4-2 | `local_phase=wait_review` |')
  })
})
```

표지 블록 앵커와 주석을 고친다(`tests/skills/dflow-dev-worker.test.ts`, `tests/skills/dflow-no-docker.test.ts`):

**T2a** — 아래 원문을 바꾼다.

```text
    { prev: '   Design 단계에서는 Design 서브에이전트를 띄우지 않고 곧바로 Design 게이트를 돈다(`orch/design.md`).', tag: '`skipped design_missing`' },
```

바꿀 문구:

```text
    { prev: '   Design 단계에서는 Design 서브에이전트를 띄우지 않고 곧바로 Design 게이트를 돈다(`orch/design.md`).', tag: 'worker-mode.md 「설계 상태의 결과 줄」' },
```

**T2b** — 아래 원문을 바꾼다.

```text
    { prev: '재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.', tag: '- design_review` 를 쓰고 끝낸다' },
```

바꿀 문구:

```text
    { prev: '재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.', tag: 'worker-mode.md 「설계 상태의 결과 줄」' },
```

**T3** — 아래 원문을 바꾼다.

```text
    expect(workerBlocks(DEV)).toHaveLength(11) // 2026-09-26 분할: 「압축 뒤」 한 블록, 실행 범위(start 「구현부터」·design 「설계만 멈춤」) 두 블록
```

바꿀 문구:

```text
    expect(workerBlocks(DEV)).toHaveLength(11) // 2026-09-26 분할: 「압축 뒤」 한 블록, 실행 범위(start 「구현자동 착수」·design 「설계만 멈춤」) 두 블록
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-dev-worker.test.ts`
Expected: FAIL(새 문구가 아직 없다. 표지 블록 태그가 옛 문구와 다르다)

- [ ] **Step 3: `SKILL.md` — 상태 모델과 「실행 범위」**

**S1** — 아래 원문을 바꾼다.

```text
  `wait_review` 는 설계만(`--scope design`)으로 설계를 마치고 사람의 설계 검토를 기다리며 멈춘 상태다. 진행 중 phase 가 아니며
  heartbeat 훅도 보내지 않는다 — `--scope build` 로만 이어 간다(「실행 범위」). 선행 대기(`wait_pred`)와 달리 저절로 재개되지 않는다.
```

바꿀 문구:

```text
  `wait_review` 는 설계만(`--scope design`)으로 설계를 마치고 사람의 「설계 승인」을 기다리며 멈춘 상태다. 진행 중 phase 가 아니며
  heartbeat 훅도 보내지 않는다 — 이어 갈지는 서버 설계 상태가 정한다(옛 서버는 `--scope build`, `orch/start.md`). 저절로 재개되지 않는다.
```

**S2** — 아래 줄 바로 뒤에 더한다.

```text
  지운다. `cancelled` 는 진행 중 phase 가 아니다 — 스윕·재개 판정은 건너뛴다.
```

더할 문구:

```text
  exit 12(다른 PC 가 이어받음)도 그 자리에서 멈추되 state.json 은 바꾸지 않는다(`orch/start.md` 「서버 판단」).
```

**S3** — 아래 원문을 바꾼다.

```text
`--scope design|build|full`(없으면 state.json `scope`, 그것도 없으면 `full`)은 정식 실행의 시작점과 멈춤점만 바꾼다. 다른 값이거나
`--only` 와 함께 오면 사용법을 알리고 멈춘다. `design` 은 Design 게이트 뒤 `build-start` 없이 `wait_review` 로 멈추고(`orch/design.md`
「설계만 멈춤」), `build` 는 사람이 쓴 설계나 `wait_review` 의 설계에서 시작한다(`orch/start.md` 「구현부터」). `full` 이 아니면
state.json `prepare` 를 쓸 때 `scope` 를 함께 적는다(`orch/claim.md`).
```

바꿀 문구:

```text
`--scope design|build|full` 은 정식 실행의 시작점과 멈춤점만 바꾼다. 다른 값이거나 `--only` 와 함께 오면 사용법을 알리고 멈춘다.
범위를 정하는 규칙(서버 판단·`claim_scope`·옛 서버)은 `orch/start.md` 「서버 판단」, `design` 의 멈춤은 `orch/design.md` 「설계만 멈춤」,
`build` 의 시작은 같은 파일의 「설계 받기」 다.
```

글자 수를 확인한다:

```bash
node -e 'const s=require("fs").readFileSync(".claude/skills/dflow-dev/SKILL.md","utf8"); console.log([...s].length)'
```

Expected: `8885`(9,000 이하면 통과. 다르면 옮긴 문구를 다시 대조한다).

- [ ] **Step 4: `orch/start.md` — 서버 판단·이어받기·승인된 설계·구현자동 착수(옛 서버 흐름은 남긴다)**

A4 와 A4b 사이의 옛 「구현부터」 1~3 단계(“1. `git fetch origin` 뒤 …” 부터 “… 곧바로 Design 게이트를 돈다(`orch/design.md`).” 까지)는 그대로 둔다. A3 뒤의 옛 「설계 검토 대기」 둘째 줄부터 끝까지도 그대로다.

**A1** — 아래 줄 바로 뒤에 더한다.

```text
   이 머지도 `/dflow-merge` SKILL.md 4번 절차다 — Phase 01-가 가 `SWEEP_NONE` 으로 건너뛰어 아직 읽지 않았으면 먼저 읽는다.
```

더할 문구:

```text

   **서버 판단(계약 2.11)** — `dflow.sh contract-ge 2.11` 이 exit 0 이면 show 응답 `.order` 의 서버 판단으로 먼저 가른다. 칸은
   `action`(`full`·`design`·`build`·`wait`·`skip`)·`action_reason`·`mine`·`design_mode`·`design_state`(`review`·`accepted`·없음)·
   `claim_scope`·`runner`·`runner_seen_at` 이다. claimed 주문의 `mine` 은 "같은 신원이고 이 PC 가 돌려도 된다" 는 뜻이다(`dflow.sh show`
   가 이 세션의 라벨을 보낸다). 계약 2.11 이 아니면(옛 서버) 이 문단을 건너뛰고 종전대로 한다 — 모든 작업을 완전자동으로 보고, 수동
   `--scope design`·`build` 는 로컬 state.json 으로 돈다(아래 「옛 서버의 설계 검토 대기」·「옛 서버의 범위 build」).
   - ready: 범위는 `--scope` 가 있으면 그 값이다(팀장은 늘 넘긴다). 없으면 `action` 이 `full`·`design`·`build` 일 때 그 값이다.
     `action` 이 `wait`·`skip` 이면 착수하지 않고 `"{TSK} 지금은 할 일이 없다 — <action_reason>"` 으로 알리고 끝낸다. 범위가 작업과
     맞는지는 서버가 claim 때 다시 본다(exit 11 — `orch/claim.md`).
   - claimed: `mine` 이 거짓이면 이어 가지 않는다 — `"{TSK} 다른 PC 도는 중 — <runner>, 마지막 신호 <runner_seen_at>"` 으로 알리고
     끝낸다. 그 PC 가 30분 넘게 조용하면 `mine` 이 참이 되어 이어받을 수 있다. `mine` 이 참인데 `runner` 가 이 세션 라벨과 다른 PC 면
     "원래 PC 의 세션이 살아 있으면 먼저 끄세요" 를 한 줄 알리고 이어 간다. `design_state` 가 `review` 면 이어 가지 않는다 —
     `"{TSK} 설계 검토 대기 — 「설계 승인」을 누르면 이어 간다"` 로 알리고 끝낸다.
   - claimed 의 범위는 서버 `claim_scope` 로 정한다: `design` → `design`, `build` → `build`, 그 밖(`full`·`legacy`·없음) → `full`.
     수동 `--scope` 는 무시하고 그 사실을 한 줄 남긴다. state.json `scope` 가 다르면 이 값으로 고쳐 쓴다(다음 커밋에 실린다).
   - 재개하는 state.json `phase` 가 `build`·`verify`·`refactor` 면 그 단계로 가기 전에 `dflow.sh build-start <ref> --scope <범위>` 를 먼저
     부른다. 이미 구현 중이라 단계는 그대로이고, 도는 PC(`runner`)를 이 PC 로 넘겨받는다. 결과는 `orch/design.md` 「Design 게이트」 의
     표대로 가르고, exit 0 이면 그 단계로 이어 간다.
```

**A2** — 아래 줄 바로 뒤에 더한다.

```text
   반려면 `orch/rework.md` 를 읽고 그대로 한다.
```

더할 문구:

```text

   **끝나지 않은 설계 멈춤 이어받기(계약 2.11)** — 서버 `status=claimed`·`mine=true` 인데 이 작업의 agent 브랜치(아래 「설계 선행 재개」
   와 같은 곳) tip 의 state.json 이 `wait_review` 이고 서버 `design_state` 가 없거나, `wait_pred` 이고 서버 단계(`.order.item.stage`)가
   `ds` 면 멈춤이 서버에 닿지 않은 것이다(push 뒤 `design-done` 전에 끊겼다). claim·격리를 하지 않고 멈춤의 남은 두 걸음을 마저 한다.
   1. `git fetch origin` 뒤 로컬 agent 브랜치를 origin 과 견준다(로컬에 없으면 `orch/design-first.md` 「3」 0 처럼 origin 에서 만든다).
      로컬이 앞서 있으면 `git push origin <agent 브랜치>` 한다. origin 이 앞서거나 같으면 push 하지 않는다. 갈라졌으면 이어 가지 않고
      두 끝의 sha 를 적어 알리고 끝낸다. fetch·push 가 실패하면 그 사실을 알리고 끝낸다(다시 돌리면 여기부터 이어 간다).
   2. `dflow.sh design-done <ref>` 를 부른다. 실패하면(exit 6) 그 사실을 알리고 끝낸다(다시 돌리면 이어 간다). `wait_review` 였으면
      출력의 설계 상태가 `review` 일 때 위 「서버 판단」 의 설계 검토 대기처럼 알리고 끝낸다. `review` 가 아니면(2.10 설계만 잔재가
      완전자동 작업에 남았다) `"{TSK} 설계만으로 멈춘 작업인데 서버에 설계 검토 대기가 없습니다 — 작업의 설계 방식을 확인하세요"` 로
      알리고 끝낸다. `wait_pred` 였으면 아래 「설계 선행 재개」 로 간다.
```

**A3** — 아래 원문을 바꾼다.

```text
   **설계 검토 대기** — 위와 같은 조건에서 그 브랜치 tip 의 state.json 이 `phase=wait_review`(설계만으로 멈춤)면 claim·격리를 하지 않는다.
```

바꿀 문구:

```text
   **승인된 설계 이어 가기(계약 2.11)** — 서버 `claim_scope=build`(「설계 승인」 된 설계 검토 작업)이고 agent 브랜치 tip 의 state.json 이
   `wait_review` 면 claim·격리를 하지 않고 `orch/design-first.md` 「3」 재개를 그대로 타되 셋이 다르다. tip 이 `wait_pred` 인 승인된
   설계(구현을 시작할 때 선행이 되돌아가 멈춘 작업)는 위 「설계 선행 재개」 로 가되 아래 첫째를 같게 한다.
   - 「3」 0 의 switch 뒤, 1 전에 `orch/design.md` 「설계 받기」 를 한다 — 사람이 검토하며 고쳐 push 한 설계를 받아 오고 Design 게이트를
     다시 돈다. 게이트가 불통이면 그 절대로 끝난다.
   - state.json `scope` 를 `build` 로 바꾼다(다음 커밋에 실린다).
   - 「3」 5(선행 계약 재확인)는 design.md 에 `## 선행 기준` 절이 있을 때만 한다. 선행이 충족된 채 설계했으면 이 절이 없고, 그때는 바뀐
     파일이 없는 것으로 본다.

   **옛 서버의 설계 검토 대기**(계약 < 2.11, 수동 실행) — 「설계 선행 재개」 와 같은 조건에서 그 브랜치 tip 의 state.json 이 `phase=wait_review`(설계만으로 멈춤)면 claim·격리를 하지 않는다.
```

**A4** — 아래 원문을 바꾼다.

```text
### 구현부터 (`--scope build`)

ready 갈래에서 범위가 `build` 면 **claim 전에** 사람이 쓴 설계를 확인한다(개발자동 — 설계는 사람, 구현은 에이전트).
```

바꿀 문구:

```text
### 구현자동 착수 (ready, 범위 `build`)

ready 갈래에서 범위가 `build` 면 사람이 「설계 확정」 한 구현자동 작업이다(서버 `design_state=accepted`, 단계 `dd`). 착수 가능 판정과
claim 은 종전대로 `orch/base.md` → `orch/claim.md` 로 한다(claim 은 `--scope build`). agent 브랜치에 올라선 뒤 Design 단계에서는 Design
서브에이전트를 띄우지 않고 `orch/design.md` 「설계 받기」 로 개발 브랜치의 사람 설계를 받아 곧바로 Design 게이트를 돈다. 확정되지 않은
작업이면 서버가 claim 을 거부한다(exit 11 — `orch/claim.md`).

**옛 서버의 범위 build**(계약 < 2.11, 수동 실행) — ready 갈래에서 범위가 `build` 면 **claim 전에** 사람이 쓴 설계를 확인한다(설계는 사람, 구현은 에이전트).
```

**A4b** — 아래 원문을 바꾼다.

```text
<!-- worker:begin -->
`--worker` 면 보고 대신 `.result` 를 쓰고 끝낸다: 1 은 `skipped design_missing`, 2 는 `skipped design_invalid <빠진 절>`, 「설계 검토
대기」 에서 범위가 `build` 가 아니면 `design_review`, 갈라짐이면 `failed diverged <로컬 sha> <origin sha>`(형식 정본은 worker-prompt.md).
<!-- worker:end -->
```

바꿀 문구:

```text
<!-- worker:begin -->
`--worker` 면 이 파일에서 알리고 끝나는 자리(「서버 판단」·「끝나지 않은 설계 멈춤 이어받기」·「승인된 설계 이어 가기」)마다 알림 대신
worker-mode.md 「설계 상태의 결과 줄」 의 줄을 `.result` 에 쓰고 끝낸다(형식 정본은 worker-prompt.md). 팀장은 옛 서버에서 범위를 넘기지
않으므로(poll 의 action 칸이 비어 `SCOPE=full`) 옛 서버의 두 절은 워커 경로에 없다.
<!-- worker:end -->
```

**A5** — 아래 원문을 바꾼다.

```text
**다음 단계**: ready 는 `orch/base.md` → `orch/claim.md`, 반려는 `orch/rework.md`, 설계 선행 재개는 `orch/design-first.md` 「3」, 그 밖의 재개는 state.json `phase` 의 단계 지도 행.
```

바꿀 문구:

```text
**다음 단계**: ready 는 `orch/base.md` → `orch/claim.md`, 반려는 `orch/rework.md`, 설계 선행 재개·승인된 설계 이어 가기는 `orch/design-first.md` 「3」(범위 `build` 는 그 0 뒤 `orch/design.md` 「설계 받기」), 그 밖의 재개는 state.json `phase` 의 단계 지도 행(구현 중이면 먼저 `build-start` — 「서버 판단」).
```

- [ ] **Step 5: `orch/claim.md` — 사람 설계 초안 확인·범위·scope 기록**

**C1** — 아래 원문을 바꾼다.

```text
  **구현부터(`--scope build`)의 설계 폴더도 예외다** — 위 scaffold 예외의 「`state.json` 하나만」 조건과 무관하다. 사람이 쓴 design.md 가 든 폴더는 입력이다. 옮기지 않고, state.json 이 있으면
  `order`·`api_base` 를 이번 claim 값으로 덮어쓴다(없으면 `prepare` 쓰기에서 만든다).
```

바꿀 문구:

```text
  **범위 `build`(구현자동)의 설계 폴더도 예외다** — 위 scaffold 예외의 「`state.json` 하나만」 조건과 무관하다. 사람이 「설계 확정」 한
  design.md 가 든 폴더는 입력이다. 옮기지 않고, state.json 이 있으면 `order`·`api_base` 를 이번 claim 값으로 덮어쓴다(없으면 `prepare`
  쓰기에서 만든다).
```

**C2** — 아래 줄 바로 뒤에 더한다.

```text
     워커는 `.result` 에 `failed project <메시지>` 를 쓴다.
```

더할 문구:

```text
   - **사람 설계 초안 확인(계약 2.11, 범위 `design`·`full`)**: 기점 이동에서 받은 origin 으로
     `git cat-file -e origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 를 본다(`<TASKS>/<TSK>` 는 `dflow.sh taskdir <ref>`). exit 0 이면 개발
     브랜치에 사람이 쓴 설계 초안이 있다 — claim 하지 않고 원래 위치로 돌아가 `"{TSK} 사람 설계 초안 있음 — 방식을 구현자동으로 바꾸거나
     초안을 지우세요"` 로 알린다(에이전트 설계가 초안을 옮기거나 덮지 않게). 범위 `build` 는 이 확인을 하지 않는다 — 그 design.md 가 입력이다.
```

**C3** — 아래 줄 바로 뒤에 더한다.

```text
     착수하기 전에는 다시 해도 같다) — 원래 위치로 돌아가 "선행 <ref:stage…> 이 구현 전이라 설계 선행 불가" 로 보고한다.
```

더할 문구:

```text
   - **범위(계약 2.11)**: `dflow.sh contract-ge 2.11` 이 exit 0 이면 위 명령 끝에 `--scope <범위>`(`orch/start.md` 「서버 판단」)를
     붙인다. 출력의 `CLAIM_SCOPE <범위>` 줄이 서버가 저장한 범위다 — 아래 3번의 `prepare` 쓰기에서 state.json `scope` 로 적는다. exit 11
     (stderr 끝줄 `DESIGN_GATE <code>`)이면 설계 관문 거부다 — 아래 재시도를 하지 않고 원래 위치로 돌아가
     `"{TSK} 설계 관문 거부(<code>) — 작업의 설계 방식·상태를 확인하세요"` 로 알린다.
```

**C4** — 아래 원문을 바꾼다.

```text
   - 범위가 `full` 이 아니면(SKILL.md 「실행 범위」) 같은 쓰기에서 `scope`(`design`|`build`)를 함께 적는다.
```

바꿀 문구:

```text
   - 같은 쓰기에서 `scope` 를 적는다 — claim 출력의 `CLAIM_SCOPE` 값이고, 그 줄이 없으면(옛 서버) 범위(`orch/start.md` 「서버 판단」)다.
```

- [ ] **Step 6: `orch/design.md` — 설계 받기·범위·결과 표·설계만 멈춤·설계 고정**

**D1** — 아래 줄 바로 앞에 더한다.

```text
### Design 게이트
```

더할 문구:

```text
### 설계 받기 (범위 `build`, 계약 2.11)

범위가 `build` 면 Design 게이트 전에 승인·확정된 설계를 받아 온다. 먼저 `git fetch origin` 한다 — 실패하면 되돌리지 않고 그 사실을
알리고 끝낸다(다시 돌리면 이어 간다). 그다음 서버 `design_mode`(show 의 `.order.design_mode`)로 가른다.
- `review`(「설계 승인」): 사람이 검토하며 고친 설계는 원격 agent 브랜치에 있다. 로컬 agent 브랜치가 origin 의 조상이면
  `git merge --ff-only origin/<그 브랜치>` 로 맞추고, origin 이 로컬의 조상이면 그대로 둔다. 둘 다 아니면(갈라짐) 이어 가지 않고 두 끝의
  sha 를 적어 알리고 끝낸다. 원격 agent 브랜치가 없으면(승인 뒤 머지·정리됐다) 아래 `human` 처럼 개발 브랜치의 design.md 를 받는다.
- `human`(「설계 확정」): 설계 원본은 개발 브랜치다. `git show origin/<기본브랜치>:<TASKS>/<TSK>/design.md` 로 받아 워크트리의 같은 파일에
  덮어쓰고, 바뀌었으면 그 파일만 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 같은 주문의 옛 agent 브랜치에 남은 옛 사본으로 게이트가
  되풀이해 실패하지 않게 한다. 개발 브랜치에 그 파일이 없으면 아래 게이트 불통과 같게 다룬다(빠진 것은 `design.md 없음`).

받아 온 바로 뒤, 다른 것을 커밋하기 전에 아래 Design 게이트를 돈다. 불통이면 빠진 절을 적어
`dflow.sh design-reopen <ref> --reason "<빠진 절>"` 을 부르고 알린 뒤 끝낸다 — 서버가 review 는 설계 검토 대기로, human 은 사람 설계
대기로 되돌리고 사유를 화면에 보인다. 빠진 절을 스스로 채우지 않는다(설계는 사람이 고친다).

```

**D2** — 아래 원문을 바꾼다.

```text
범위가 `build` 면(`orch/start.md` 「구현부터」·「설계 검토 대기」) Design 서브에이전트를 띄우지 않는다 — 이미 있는 design.md 로 곧바로
Design 게이트를 돈다. 게이트가 통과하면 design.md 를 새로 커밋할 것은 없다(개발 브랜치나 agent 브랜치에 이미 있다).
```

바꿀 문구:

```text
범위가 `build` 면(`orch/start.md` 「구현자동 착수」·「승인된 설계 이어 가기」·옛 서버의 두 절, `orch/rework.md`) Design 서브에이전트를
띄우지 않는다. 계약 2.11 이면 위 「설계 받기」 로 승인·확정된 설계를 받고, 옛 서버면 이미 있는 design.md 로 곧바로 Design 게이트를 돈다.
게이트가 통과하면 design.md 를 새로 커밋할 것은 없다(human 의 덮어쓰기 커밋은 「설계 받기」 가 이미 했다).
```

**D3** — 아래 줄 바로 뒤에 더한다.

```text
     멈춤 절차는 「설계 선행」 2.
```

더할 문구:

```text
   - **범위를 붙인다(계약 2.11)**: `dflow.sh contract-ge 2.11` 이 exit 0 이면 위 호출은 `dflow.sh build-start <ref> --scope <범위>` 다.
     범위는 state.json `scope`(`full`·`build`)이고, 반려 재작업(`orch/rework.md`)이면 방식과 무관하게 `rework` 다. 범위 `design` 은
     build-start 를 부르지 않는다(아래 「설계만 멈춤」).
```

**D4** — 아래 줄 바로 앞에 더한다.

```text
   | 그 밖 | Build 로 가지 않고 중단·보고한다. `phase` 는 `design` 그대로라 재실행하면 Design 게이트 뒤에서 다시 부른다. 워커는 `failed build-start <exit>` |
```

더할 문구:

```text
   | exit 11 + stderr 끝줄 `DESIGN_GATE design_gate order_changed` | 그 사이 사람이 설계를 되돌렸거나 주문이 바뀌었다. Build 로 가지 않고 `"{TSK} 주문이 바뀌어 구현을 시작하지 않았습니다 — 다시 확정되면 새로 시작합니다"` 로 알리고 끝낸다 |
   | 그 밖의 exit 11(`DESIGN_GATE <code>`) | 설계 관문 거부다. Build 로 가지 않고 `"{TSK} 설계 관문 거부(<code>)"` 로 알리고 끝낸다(`phase` 는 그대로) |
   | exit 12(`RUNNER_ACTIVE <runner>`) | 다른 PC 가 이 작업을 돌리는 중이다. state.json 을 바꾸지 않고 push·done 없이 `"{TSK} 다른 PC 도는 중 — <runner>"` 로 알리고 끝낸다 |
```

**D5** — 아래 원문을 바꾼다.

```text
### 설계만 멈춤 (`--scope design`)

범위가 `design` 이면 Design 게이트가 통과한 뒤 `build-start` 를 **부르지 않는다**(부르면 서버 단계가 `ip` 로 넘어간다). 모듈 기준선도
재지 않는다. 대신 이 순서로 멈춘다.
1. design.md 커밋을 확인한다(없으면 파일명 명시 커밋).
2. state.json `phase` 를 `wait_review` 로 쓰고 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 그 다음 `progress 25 "설계 완료(검토 대기)"`
   를 보낸다.
3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(사람의 검토와 다른 PC·새 워크트리의 재개가 그 브랜치를 쓴다). 훅에 거부되면
   우회하지 않고 보고한다.
4. `dflow.sh heartbeat <ref> --phase wait_review` 를 부른다. 실패해도(계약 2.10 전 서버는 400) 멈춤을 계속한다 — 좌석 이름표만 틀리고,
   이어 갈지는 로컬 state.json 으로 판정한다.
5. supervised 는 `"{TSK} 설계 완료·검토 대기 — design.md 를 검토·수정한 뒤 /dflow-dev {TSK} --scope build 로 이어 간다"` 로 알리고 끝낸다.

design.md 의 `## 담당자 확인 필요 결정` 절은 이 멈춤에서 서버로 넘기지 않는다 — 사람이 검토하며 design.md 에서 바로 답하고, `--scope build`
로 이어 가 마감(`orch/close.md`)에서 `decisions.json` 으로 넘긴다. 미충족 선행이 있어도 같다(claim 이 설계 선행 모드였으면 `design_first.unmet` 이 이미 적혀 있다). 선행 판정은 `--scope build` 로 이어 갈
때 `orch/design-first.md` 「3」 이 한다. `wait_pred` 를 쓰지 않는 이유: 팀장은 선행이 풀린 `wait_pred` 워크트리를 자동으로 Build 로
재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.
<!-- worker:begin -->
`--worker` 면 5 대신 `.result` 에 `{TSK} {ID8} <branch> <head_sha> - design_review` 를 쓰고 끝낸다(형식 정본은 worker-prompt.md).
<!-- worker:end -->
```

바꿀 문구:

```text
### 설계만 멈춤 (`--scope design`)

범위가 `design` 이면 Design 게이트가 통과한 뒤 `build-start` 를 **부르지 않는다**(부르면 서버 단계가 `ip` 로 넘어간다). 모듈 기준선도
재지 않는다. 대신 이 순서로 멈춘다.
1. design.md 커밋을 확인한다(없으면 파일명 명시 커밋).
2. state.json `phase` 를 `wait_review` 로 쓰고 파일명을 명시해 커밋한다(`DFlow-Order` 트레일러). 그 다음 `progress 25 "설계 완료(검토 대기)"`
   를 보낸다.
3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(사람의 검토와 이어받기가 그 브랜치를 쓴다). 훅에 거부되면 우회하지 않고
   보고한다. 그 밖의 이유로 실패하면 4 를 하지 않고 그 사실을 알리고 끝낸다 — 다시 돌리면 이어 간다(계약 2.11 은 `orch/start.md`
   「끝나지 않은 설계 멈춤 이어받기」 가 마저 한다).
4. 계약 2.11(`dflow.sh contract-ge 2.11` 이 exit 0)이면 `dflow.sh design-done <ref>` 를 부른다. 서버가 단계를 `dd`, 설계 상태를 `review`
   로 두고 도는 PC 를 비운다(좌석은 「설계 검토 대기」). exit 6(네트워크)이면 멈춤을 계속한다(다시 돌리면 이어받기가 마저 한다). exit 11
   이면 서버가 거부한 것이다 — 그 코드를 적어 보고하고 끝낸다. 옛 서버면 `dflow.sh heartbeat <ref> --phase wait_review` 를 부른다. 실패해도
   (계약 2.10 전 서버는 400) 멈춤을 계속한다 — 좌석 이름표만 틀리고, 이어 갈지는 로컬 state.json 으로 판정한다.
5. supervised 는 계약 2.11 이면 `"{TSK} 설계 완료·검토 대기 — agent 브랜치의 design.md 를 검토·수정해 push 한 뒤 「설계 승인」을 누르면
   팀장이 이어 간다(팀장이 없으면 /dflow-dev {TSK})"`, 옛 서버면 `"{TSK} 설계 완료·검토 대기 — design.md 를 검토·수정한 뒤 /dflow-dev {TSK}
   --scope build 로 이어 간다"` 로 알리고 끝낸다.

design.md 의 `## 담당자 확인 필요 결정` 절은 이 멈춤에서 서버로 넘기지 않는다 — 사람이 검토하며 design.md 에서 바로 답하고, 이어 가
구현을 마치는 마감(`orch/close.md`)에서 `decisions.json` 으로 넘긴다. 미충족 선행이 있어도 같다(claim 이 설계 선행 모드였으면
`design_first.unmet` 이 이미 적혀 있다). 선행 판정은 이어 갈 때 `orch/design-first.md` 「3」 이 한다. `wait_pred` 를 쓰지 않는
이유: 팀장은 선행이 풀린 `wait_pred` 워크트리를 자동으로 Build 로
재개한다 — 사람이 검토하기 전에 구현이 시작되면 안 된다.
<!-- worker:begin -->
`--worker` 면 이 파일에서 알리고 끝나는 자리(「설계 받기」·「Design 게이트」 표의 exit 11·12·「설계만 멈춤」 3~5·「승인된 설계 고정」)마다
알림 대신 worker-mode.md 「설계 상태의 결과 줄」 의 줄을 `.result` 에 쓰고 끝낸다(형식 정본은 worker-prompt.md).
<!-- worker:end -->
```

**D6** — 아래 줄 바로 앞에 더한다.

```text
**다음 단계**: 범위 `design` 이면 여기서 끝난다. 아니면 `build-start` exit 0 이면 `orch/build.md`, exit 4 면 `orch/design-first.md` 「2」.
```

더할 문구:

```text
### 승인된 설계 고정 (D24, 계약 2.11)

서버 `design_state=accepted`(「설계 승인」·「설계 확정」)이고 단계가 `ip` 이상이면 설계는 고정이다. design.md 의 설계 내용을 고치지
않는다. 게이트가 적는 기록 절(`## 담당자 확인 필요 결정`·`## 도커 금지로 생략한 검증`)만 예외다. 재개 판정(SKILL.md 상태 모델의 산출물
교차 확인)이 design.md 가 없거나 5절이 모자라 Design 으로 후퇴하려 하면 후퇴하지 않고 `"{TSK} 설계 게이트 불통(구현 중) — 사람이 설계를
고친 뒤 --resume 하세요"` 로 알리고 끝낸다. 완전자동(설계 상태 없음)은 반려 재작업에서도 종전대로 설계부터 다시 판단한다.

```

- [ ] **Step 7: `orch/design-first.md`·`orch/rework.md`·`orch/close.md`**

F 는 `design-first.md`, R 은 `rework.md`, K 는 `close.md` 다.

**F1** — 아래 줄 바로 뒤에 더한다.

```text
        `git ls-tree --name-only <브랜치> <TASKS>/<선행TSK>/` 가 비지 않는 것의 이름과 tip sha 를 적는다.
```

더할 문구:

```text
        원격 agent 브랜치에 없으면 개발 브랜치를 본다 — `git cat-file -e origin/<기본브랜치>:<TASKS>/<선행TSK>/design.md` 가 exit 0 이면
        그 경로와 `origin/<기본브랜치>` tip sha 를 적는다(선행이 구현자동이면 사람 설계가 개발 브랜치에 있다).
```

**F2** — 아래 줄 바로 뒤에 더한다.

```text
   3. `git push origin <agent 브랜치>` 로 설계를 원격에 남긴다(다른 PC·새 워크트리가 이어받는다). 훅에 거부되면 우회하지 않고 보고한다.
```

더할 문구:

```text
      그 밖의 이유로 실패하면 4·5 를 하지 않고 그 사실을 알리고 끝낸다 — 다시 돌리면 이어 간다(계약 2.11 은 `orch/start.md` 「끝나지 않은
      설계 멈춤 이어받기」 가 마저 한다).
```

**F3** — 아래 줄 바로 뒤에 더한다.

```text
      보내지 않으므로 이 한 번이 좌석을 「선행 대기」 로 바꾼다. 2번 뒤에 부른다 — 앞이면 훅의 다음 신호가 `design` 으로 덮는다.
```

더할 문구:

```text
      계약 2.11(`dflow.sh contract-ge 2.11` 이 exit 0)이면 heartbeat 대신 `dflow.sh design-done <ref>` 를 부른다. 서버가 단계를 `dd`(설계
      완료)로 두고 좌석을 「선행 대기」 로 바꾼다(승인된 설계는 그대로다). exit 6(네트워크)이면 멈춤을 계속한다(다시 돌리면 이어받기가 마저
      한다). exit 11 이면 서버가 거부한 것이다 — 그 코드를 적어 보고하고 끝낸다.
```

**F4** — 아래 줄 바로 뒤에 더한다.

```text
      `## 선행 기준`·바뀐 파일의 `git diff <적힌 sha>..<새 기점> -- <파일>` 요지). 어긋난 절만 고치고 Design 게이트를 다시 돈다.
```

더할 문구:

```text
      계약 2.11 에서 서버 `design_state` 가 `accepted`(승인·확정된 설계)면 방식에 따라 다르다. `design_mode=review` 는 위처럼 고친 뒤 게이트를
      돌고 design.md 를 커밋·push 한 다음 Build 로 가지 않고 `dflow.sh design-reopen <ref> --reason "선행 계약 바뀜: <파일…>"` 을 부르고
      끝낸다 — 사람이 다시 검토해 「설계 승인」 한다. `human` 은 design.md 를 고치지 않고 같은 사유로 design-reopen 을 부른 뒤 끝낸다 —
      사람이 개발 브랜치의 설계를 고쳐 다시 「설계 확정」 한다. 완전자동(설계 상태 없음)만 위처럼 고친 뒤 이어 간다.
```

**R1** — 아래 줄 바로 뒤에 더한다.

```text
   - 재작업 완료 후 마감은 Phase 06 그대로(`done --auto-links`) — state 는 다시 `reported`.
```

더할 문구:

```text
   - **범위(계약 2.11)**: 서버 `claim_scope` 가 `build` 면(설계 검토·구현자동 — `orch/start.md` 「서버 판단」) Design 단계를 돌지 않고
     승인된 설계로 구현만 고친다. 설계는 `orch/design.md` 「설계 받기」 로 받는다(review 의 원격 agent 브랜치가 이미 머지·정리됐으면 개발
     브랜치의 design.md). 반려 사유가 설계를 바꿔야 풀리면 설계를 고치지 않고 `"{TSK} 설계 변경 필요 — <이유>"` 로 알리고 끝낸다(사람이
     설계를 고친 뒤 다시 돌린다 — review 는 agent 브랜치에 push, human 은 개발 브랜치). 완전자동은 위처럼 설계부터 다시 판단한다.
   - **구현 전환(계약 2.11)**: 재작업의 `build-start` 는 방식과 무관하게 `--scope rework` 다(`orch/design.md` 「Design 게이트」). 완료 보고가
     도는 PC 를 비워 두었으므로 어느 PC 에서 돌려도 이 PC 가 넘겨받는다.
```

**R2** — 아래 원문을 바꾼다.

```text
**다음 단계**: `orch/phase-common.md` → `orch/design.md`(설계부터 다시 판단한다). 새 `agent/` 브랜치를 따야 하면 `orch/claim.md` 3번 규칙대로 딴다.
```

바꿀 문구:

```text
**다음 단계**: `orch/phase-common.md` → `orch/design.md`(완전자동은 설계부터 다시 판단하고, 범위 `build` 는 「설계 받기」 와 게이트 뒤 Build 로 간다). 새 `agent/` 브랜치를 따야 하면 `orch/claim.md` 3번 규칙대로 딴다.
```

**K1** — 아래 줄 바로 뒤에 더한다.

```text
   push 가 훅(G1~G4)에 거부되면 SKIP_GUARD 금지 — 중단하고 사람에게 보고.
```

더할 문구:

```text
   push 가 non-fast-forward 로 거부되면(원격 agent 브랜치에 사람 커밋이 있다 — 화면이 구현 중 push 를 말린다) 받아 합치지 않고
   `"{TSK} 원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume 하세요"` 로 알리고 끝낸다. 네트워크로 실패하면 그 사실을 알리고 끝낸다(다시
   돌리면 이어 간다).
```

**K2** — 아래 줄 바로 뒤에 더한다.

```text
   접미사와 목록 건수가 어긋남)과 `서버가 결정 목록을 모릅니다(계약 < 2.6)`(옛 서버라 요약 접미사로만 전달)는 보고는 된 것이다.
```

더할 문구:

```text
   done 이 exit 12(stderr 끝줄 `RUNNER_ACTIVE <runner>`)면 다른 PC 가 이 작업을 넘겨받았다 — state.json 을 바꾸지 않고
   `"{TSK} 다른 PC 도는 중 — <runner>"` 로 알리고 끝낸다. exit 11(`DESIGN_GATE <code>`)이면 서버가 완료 보고를 거부했다(설계 검토 대기이거나
   단계가 작업 중이 아님) — 그 코드를 적어 보고하고 끝낸다.
```

- [ ] **Step 8: `worker-mode.md`·`worker-prompt.md` — 결과 줄 표와 서버 쓰기 범위**

W 는 `.claude/skills/dflow-dev/references/worker-mode.md`(W3 은 파일 끝에 더한다), P 는 `.claude/skills/dflow-team/references/worker-prompt.md` 다. P5 는 한 행을 두 행으로 바꾼다.

**W1** — 아래 원문을 바꾼다.

```text
- 인자 파싱: `$ARGUMENTS` 에 `--worker` 가 있으면 이 모드다. 참조는 id8 으로만 온다. `--scope` 는 팀장이 넘긴 그대로 따른다(SKILL.md
  「실행 범위」). 범위 때문에 끝나면 `.result` 는 `design_review`(설계만 멈춤)·`skipped design_missing`·`skipped design_invalid <빠진 절>`
  (구현부터인데 사람 설계가 없거나 모자람)이다.
```

바꿀 문구:

```text
- 인자 파싱: `$ARGUMENTS` 에 `--worker` 가 있으면 이 모드다. 참조는 id8 으로만 온다. 팀장이 넘긴 `--scope` 는 새 claim 의 범위이고, 이미
  잡힌 작업은 서버 `claim_scope` 가 이긴다(`orch/start.md` 「서버 판단」). 범위·설계 상태 때문에 끝나면 아래 「설계 상태의 결과 줄」 을 쓴다.
```

**W2** — 아래 줄 바로 뒤에 더한다.

```text
  PAT 사용자로 점유자를 가르므로 `build-start` 가 통한다.
```

더할 문구:

```text
  계약 2.11 의 도는 PC(`runner`)도 라벨의 PC 칸(`<신원>/<host>/w<n>` 의 `<host>`)으로 가르므로 같은 PC 의 다른 좌석은 막히지 않는다.
```

**W3** — 아래 줄 바로 뒤에 더한다.

```text
  무인 모드 규칙을 따르는 것이다.
```

더할 문구:

```text

### 설계 상태의 결과 줄(계약 2.11)

단계 파일에서 알리고 끝나는 자리마다 워커는 알림 대신 이 표의 줄을 `.result` 에 쓰고 끝낸다. 형식은
`{TSK} {ID8} <branch|-> <head_sha|-> <done_exit|-> <status> <사유>` 이고 정본은 worker-prompt.md 「7」 이다. `<head_sha>` 는 push 한
agent 브랜치 tip 이고, push 전에 끝났으면 로컬 tip, 브랜치가 없으면 `-` 다.

| 자리(단계 파일 「절」) | status | 사유 |
|---|---|---|
| start 「서버 판단」: ready 인데 `action` 이 `wait`·`skip` | `skipped` | `<action_reason>` |
| start 「서버 판단」 의 `mine` 거짓, design 「Design 게이트」 표·close 의 exit 12 | `skipped` | `다른 PC 도는 중(<runner>)` |
| start 「서버 판단」: 설계 상태 `review` | `design_review` | `-` |
| start 「끝나지 않은 설계 멈춤 이어받기」 2: 설계 상태 `review` | `design_review` | `-` |
| 같은 절 2: `wait_review` 인데 설계 상태가 `review` 가 아님 | `failed` | `방식 확인 필요` |
| 같은 절 2: design-done exit 6 | `design_review`(`wait_pred` 였으면 `design_waiting`) | `design-done 미확인` |
| 같은 절 1·design 「설계 받기」: 브랜치 갈라짐 | `failed` | `브랜치 갈라짐 <로컬 sha> <origin sha>` |
| fetch 실패(이어받기·「설계 받기」·rework) | `skipped` | `fetch 실패` |
| 훅 거부가 아닌 push 실패(이어받기·「설계만 멈춤」 3·design-first 멈춤 3·close) | `skipped` | `push 실패` |
| claim 「사람 설계 초안 확인」 | `skipped` | `사람 설계 초안 있음` |
| claim 「범위」 의 exit 11, design 표의 그 밖의 exit 11 | `skipped` | `설계 관문(<code>)` |
| design 「설계 받기」 게이트 불통(review), design-first 「3」 5 선행 계약 바뀜(review) | `design_review` | `<빠진 절>` 또는 `선행 계약 바뀜: <파일…>` |
| design 「설계 받기」 게이트 불통(human), design-first 「3」 5 선행 계약 바뀜(human) | `design_reopened` | 같은 사유 |
| design 표의 exit 11 + `order_changed` | `design_reopened` | `주문이 바뀜` |
| design 「설계만 멈춤」 5 | `design_review` | `-` |
| design 「설계만 멈춤」 4 의 exit 6 | `design_review` | `design-done 미확인` |
| design 「설계만 멈춤」 4·design-first 멈춤 4 의 exit 11 | `failed` | `design-done 거부(<code>)` |
| design-first 멈춤 4 의 exit 6(계약 2.11) | `design_waiting` | `design-done 미확인` |
| design 「승인된 설계 고정」 | `failed` | `설계 게이트 불통(구현 중)` |
| rework 「범위」: 설계 변경 필요 | `failed` | `설계 변경 필요 — <이유>` |
| close: push 가 non-fast-forward 로 거부 | `failed` | `원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume` |
| close: done 의 exit 11 | `failed` | `완료 보고 거부(<code>)` |

exit 12 로 끝날 때는 state.json 을 바꾸지 않는다(다른 PC 가 이어 간다). `design_reopened` 는 주문이 사람 설계 대기로 돌아갔거나(구현자동)
주문이 바뀐 것이다 — 팀장이 워크트리를 지운다(설계 원본은 개발 브랜치이거나 이미 push 돼 있다).
```

**P1** — 아래 원문을 바꾼다.

```text
| `{SCOPE_FLAG}` | `SCOPE` | `design` 이면 `--scope design`, `build` 면 `--scope build`, `full`·키 없음이면 빈 값(`/dflow-dev` SKILL.md 「실행 범위」) |
```

바꿀 문구:

```text
| `{SCOPE_FLAG}` | `SCOPE` | 값이 있으면 늘 `--scope <SCOPE>`(`full`·`design`·`build` — 팀장이 서버 판단 `action` 으로 정한다), 키가 없으면(옛 팀장) 빈 값. 이미 잡힌 작업은 서버 `claim_scope` 가 이긴다(`/dflow-dev` `orch/start.md` 「서버 판단」) |
```

**P2** — 아래 원문을 바꾼다.

```text
설계 선행(계약 2.9)의 `claim {ID8} --design-first`·`build-start {ID8}`·`heartbeat {ID8} --phase wait_pred` 와 설계만 멈춤(계약 2.10)의
`heartbeat {ID8} --phase wait_review` 는 이 범위 안이다.
```

바꿀 문구:

```text
설계 선행(계약 2.9)의 `claim {ID8} --design-first`·`build-start {ID8}`·`heartbeat {ID8} --phase wait_pred`, 설계만 멈춤(계약 2.10)의
`heartbeat {ID8} --phase wait_review`, 설계 상태(계약 2.11)의 `claim {ID8} … --scope <범위>`·`build-start {ID8} --scope <범위>`·
`design-done {ID8}`·`design-reopen {ID8} --reason …` 은 이 범위 안이다.
```

**P3** — 아래 원문을 바꾼다.

```text
| `skipped` | 착수 전에 멈춤. 팀장은 일시 제외로 다룬다 | `claim-exit-4`, `선행 미충족`, `선행 미승인`, `선행 승인 대기`, `선행을 모두 조상으로 갖는 기점 없음`, `spec 부재`, `design_missing`, `design_invalid <빠진 절>`(구현부터인데 사람 설계가 없거나 모자람) 중 하나. 설계 선행 claim 이 `DESIGN_FIRST_TOO_EARLY` 로 거부되면 `선행 미충족(설계 선행 불가: <ref…>)`(`<ref…>` 는 거부 본문 `unmet` 의 `external_ref` 를 공백으로 이은 것) |
```

바꿀 문구:

```text
| `skipped` | 착수 전에 멈춤. 팀장은 일시 제외로 다룬다 | `claim-exit-4`, `선행 미충족`, `선행 미승인`, `선행 승인 대기`, `선행을 모두 조상으로 갖는 기점 없음`, `spec 부재` 중 하나. 설계 선행 claim 이 `DESIGN_FIRST_TOO_EARLY` 로 거부되면 `선행 미충족(설계 선행 불가: <ref…>)`(`<ref…>` 는 거부 본문 `unmet` 의 `external_ref` 를 공백으로 이은 것). 설계 상태(계약 2.11)의 사유 — `설계 관문(<code>)`·`다른 PC 도는 중(<runner>)`·`사람 설계 초안 있음`·`fetch 실패`·`push 실패`·서버 판단의 `<action_reason>` — 은 `/dflow-dev` worker-mode.md 「설계 상태의 결과 줄」 이 정한다 |
```

**P4** — 아래 원문을 바꾼다.

```text
| `design_waiting` | 설계를 마치고 선행을 기다리며 멈춤(`/dflow-dev` 「설계 선행」 멈춤 절차 — design.md 커밋·state.json `wait_pred`·push·heartbeat `wait_pred` 뒤). 팀장은 실패로 보지 않고 워크트리를 남긴 채 좌석만 비운다 | 미충족 선행 ref 를 공백으로 이은 것. 재개했는데 기점을 정하지 못했으면 그 판정(예 `선행 승인 대기 <ref>`) |
```

바꿀 문구:

```text
| `design_waiting` | 설계를 마치고 선행을 기다리며 멈춤(`/dflow-dev` 「설계 선행」 멈춤 절차 — design.md 커밋·state.json `wait_pred`·push·heartbeat `wait_pred`(계약 2.11 은 design-done) 뒤). 팀장은 실패로 보지 않고 워크트리를 남긴 채 좌석만 비운다 | 미충족 선행 ref 를 공백으로 이은 것. 재개했는데 기점을 정하지 못했으면 그 판정(예 `선행 승인 대기 <ref>`). design-done 이 네트워크로 실패했으면 `design-done 미확인` |
```

**P5** — 아래 원문을 바꾼다.

```text
| `design_review` | 설계만(`--scope design`)으로 설계를 마치고 사람의 검토를 기다리며 멈춤(`/dflow-dev` `orch/design.md` 「설계만 멈춤」 — design.md 커밋·state.json `wait_review`·push·heartbeat `wait_review` 뒤). 또는 검토 대기 설계를 `build` 가 아닌 범위로 받았을 때 | 비운다(`-`) |
```

바꿀 문구:

```text
| `design_review` | 설계만(`--scope design`)으로 설계를 마치고 사람의 「설계 승인」을 기다리며 멈춤(`/dflow-dev` `orch/design.md` 「설계만 멈춤」 — design.md 커밋·state.json `wait_review`·push·design-done 뒤). 또는 설계 검토 대기 작업을 받았거나, 승인된 설계가 게이트·선행 계약 검사를 통과하지 못해 설계 검토 대기로 되돌렸을 때 | 비운다(`-`). design-done 이 네트워크로 실패했으면 `design-done 미확인`, 되돌렸으면 빠진 절이나 `선행 계약 바뀜: <파일…>` |
| `design_reopened` | 구현자동 작업의 사람 설계가 게이트·선행 계약 검사를 통과하지 못해 사람 설계 대기로 되돌렸거나(design-reopen), 구현을 시작할 때 주문이 바뀌었다(build-start `order_changed`). 팀장은 실패로 보지 않고 슬롯을 풀며 워크트리를 지운다 | 빠진 절, `선행 계약 바뀜: <파일…>`, `주문이 바뀜` |
```

**P6** — 아래 원문을 바꾼다.

```text
| `failed` | 그 밖의 중단(push 훅 거부, 게이트 실패, Build 게이트·Verify 재시도 소진, 부트스트랩 실패, 권한 거부) | 자유 문구. 팀장이 구분하는 값은 첫 낱말로 쓴다: `rate-limit`(사용량 한도·rate limit 오류로 멈춤, 재시도 가능), `not-isolated`(격리 실패, 파일로는 쓰지 않는다), `no-worker-flag`(옛 `/dflow-dev`), `deps`(의존성 설치 실패), `permission`(권한 거부, 뒤에 거부된 명령의 첫 낱말들), `project`(claim 이 `PROJECT_MISMATCH` 로 거부됨. 주문이 이 리포에 바인딩된 D'Flow 프로젝트 밖이다), `not-assignee`(claim 이 `not_assignee` 로 거부됨. 다른 멤버에게 배정된 작업이다) |
```

바꿀 문구:

```text
| `failed` | 그 밖의 중단(push 훅 거부, 게이트 실패, Build 게이트·Verify 재시도 소진, 부트스트랩 실패, 권한 거부) | 자유 문구. 팀장이 구분하는 값은 첫 낱말로 쓴다: `rate-limit`(사용량 한도·rate limit 오류로 멈춤, 재시도 가능), `not-isolated`(격리 실패, 파일로는 쓰지 않는다), `no-worker-flag`(옛 `/dflow-dev`), `deps`(의존성 설치 실패), `permission`(권한 거부, 뒤에 거부된 명령의 첫 낱말들), `project`(claim 이 `PROJECT_MISMATCH` 로 거부됨. 주문이 이 리포에 바인딩된 D'Flow 프로젝트 밖이다), `not-assignee`(claim 이 `not_assignee` 로 거부됨. 다른 멤버에게 배정된 작업이다). 설계 상태(계약 2.11)의 실패 — `브랜치 갈라짐 …`·`방식 확인 필요`·`design-done 거부(<code>)`·`설계 게이트 불통(구현 중)`·`설계 변경 필요 — <이유>`·`원격 agent 브랜치에 사람 커밋 — 받은 뒤 --resume`·`완료 보고 거부(<code>)` — 는 사람이 할 일이 사유에 있다(worker-mode.md 「설계 상태의 결과 줄」) |
```

- [ ] **Step 9: 통과 확인**

Run: `npx vitest run tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-dev-split.test.ts tests/skills/dflow-no-docker.test.ts`
Expected: PASS(84건)

Run: `npx vitest run tests/skills`
Expected: Task 0 기준선에 없던 실패가 없다. 전체 실행 때 흔들리는 넷(Global Constraints)이 실패하면 단독으로 다시 돌려 판정한다.

- [ ] **Step 10: 커밋**

```bash
git add .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-dev/references/orch/start.md .claude/skills/dflow-dev/references/orch/claim.md \
  .claude/skills/dflow-dev/references/orch/design.md .claude/skills/dflow-dev/references/orch/design-first.md \
  .claude/skills/dflow-dev/references/orch/rework.md .claude/skills/dflow-dev/references/orch/close.md \
  .claude/skills/dflow-dev/references/worker-mode.md .claude/skills/dflow-team/references/worker-prompt.md \
  tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-dev-worker.test.ts tests/skills/dflow-no-docker.test.ts
git commit -m "feat(dflow-dev): 워커가 서버 판단(action·mine·claim_scope)을 따르고 설계를 받아 구현한다(계약 2.11)

설계만 멈춤은 design-done 으로 서버에 닿고, 승인·확정된 설계는 설계 받기와 게이트 뒤 구현한다.
끝나지 않은 멈춤은 이어받아 마저 하고, 새 결과 줄은 worker-mode.md 표 하나에 모은다. 옛 서버는 종전대로 돌되 design·build 범위를 막는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 22a: 팀장 스크립트 — 제외 판정·자동 재시도·build_ready(`lead-state.sh`·`wake.sh`·`tick.sh`)

**Files:**
- Modify: `.claude/skills/dflow-team/scripts/lead-state.sh`(머리 주석 19·24행, `excl()` 90행, `LOST` 줄 114행 뒤)
- Modify: `.claude/skills/dflow-team/scripts/wake.sh`(머리 주석 13행, watch 요약 jq 56~60행)
- Modify: `.claude/skills/dflow-team/scripts/tick.sh`(`may_skip_now` 167행)
- Test: `tests/skills/dflow-team-lead-state.test.ts`·`tests/skills/dflow-team-tick.test.ts`(각각 끝에 describe 하나)

**Interfaces:**
- Consumes: Task 16 watch 응답의 `resume_requests[].mine`·`.design_state`, `build_ready`(없음 = 옛 서버, `null` = 조회 실패), Task 21 워커 결과 줄(`skipped fetch 실패`·`skipped push 실패`·`design_review`·`design_reopened`)
- Produces(Task 22b 팀장 문서가 쓴다):
  - `lead-state.sh`: `design_review`·`design_reopened` 는 제외 없음. 새 줄 `RETRY_DUE <id8> reason=<fetch|push> n=<연속 수>`(마지막이 fetch·push 실패 skipped 이고 30분 지남, 연속 3회 미만), `WARN_RETRY <id8> reason=<fetch|push> n=<연속 수>`(연속 3회 이상)
  - `wake.sh` 요약 JSON: 계약 2.11 서버면 `reqs[]` 원소에 `mine`·`design_state`, 끝에 `build`(`[{id8,code,status}]` 또는 조회 실패 `"NULL"`)와 `build_err`. 옛 서버면 종전과 글자 그대로 같다
  - `tick.sh`: `build` 가 `"NULL"` 이거나 claimed 원소가 있으면 TICK 을 건너뛰지 않는다(D22 — 승인은 poll 이 깨우지 않는다)

**정한 것:**
- `build_ready` 는 서버가 watch 의 `--holder`(팀장 lease 프로젝트)로 이미 좁힌다. 그래서 `wake.sh` 는 거르기 인자를 더 넘기지 않는다. 팀장의 WP 범위는 새 배정에만 쓰고 재개는 범위와 무관하다(SKILL.md 「1. 시작」 4번의 종전 규칙).
- ready 인 구현자동 확정 주문은 poll(`action=build`)이 팀장을 깨운다. `build` 로 TICK 을 붙잡는 것은 claimed 원소(「설계 승인」 된 작업 — poll 에 나오지 않는다)뿐이다.
- 조회 실패(`null`)를 빈 목록으로 읽지 않는다(에러 3원칙). 옛 서버는 칸이 없으므로 `has("build_ready")` 로 가른다.
- fetch·push 실패는 잡은 작업(claimed)에서만 난다(Task 21). poll 은 claimed 를 돌려주지 않으므로 30분 뒤 재시도는 팀장이 `RETRY_DUE` 로 한다(스펙 12절 Y11). 끝에서부터 연속한 수만 세고, 다른 결과가 끼면 다시 센다.

**계획 단계 검증**: 아래 문구를 Task 21 을 적용한 리포 사본에 적용해 두 파일 41건이 통과했다. 스크립트를 고치기 전에는 새 테스트 다섯 건이 실패했다.

- [ ] **Step 1: 실패하는 테스트**

**X1** — 파일 끝에 더한다.

```ts
describe('lead-state.sh — 설계 상태(계약 2.11)', () => {
  const nowTs = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  it('design_review·design_reopened 는 제외하지 않는다(설계 검토 대기·사람 설계 대기로 돌아간 작업)', () => {
    const out = run([start(), spawnE('1', 'aaaa0001'), result('1', 'aaaa0001', 'design_review', { reason: '-' }),
      spawnE('2', 'bbbb0002'), result('2', 'bbbb0002', 'design_reopened', { reason: '주문이 바뀜' })])
    expect(get(out, 'EXCLUDE_PERM')).toEqual(['EXCLUDE_PERM -'])
    expect(get(out, 'EXCLUDE_TEMP')).toEqual(['EXCLUDE_TEMP -'])
  })
  it('fetch·push 실패 skipped 는 처리한 지 30분이 지나면 RETRY_DUE, 30분 전이면 아직 아니다(Y11)', () => {
    const out = run([start(), spawnE('1', 'aaaa0001'), result('1', 'aaaa0001', 'skipped', { reason: 'push 실패' }),
      spawnE('2', 'bbbb0002'),
      line({ event: 'team.result', slot: '2', id8: 'bbbb0002', tsk: 'TSK-bbbb0002', worktree: WT('bbbb0002'), hash: 'h-b', status: 'skipped', reason: 'fetch 실패', ts: nowTs() })])
    expect(get(out, 'RETRY_DUE')).toEqual(['RETRY_DUE aaaa0001 reason=push n=1'])
    expect(get(out, 'WARN_RETRY')).toEqual([])
  })
  it('같은 계열 사유가 연속 3회면 RETRY_DUE 대신 WARN_RETRY — 다른 결과가 끼면 다시 센다', () => {
    const push = () => result('1', 'aaaa0001', 'skipped', { reason: 'push 실패' })
    const again = () => spawnE('1', 'aaaa0001', { spawn_kind: 'resume' })
    const out = run([start(), spawnE('1', 'aaaa0001'), push(), again(), result('1', 'aaaa0001', 'skipped', { reason: 'fetch 실패' }), again(), push()])
    expect(get(out, 'WARN_RETRY')).toEqual(['WARN_RETRY aaaa0001 reason=push n=3'])
    expect(get(out, 'RETRY_DUE')).toEqual([])
    const out2 = run([start(), spawnE('1', 'aaaa0001'), push(), again(), result('1', 'aaaa0001', 'skipped', { reason: '설계 관문(design_gate)' }), again(), push()])
    expect(get(out2, 'RETRY_DUE')).toEqual(['RETRY_DUE aaaa0001 reason=push n=1'])
  })
  it('다른 사유의 skipped 이거나 그 뒤에 다시 띄웠으면 내지 않는다', () => {
    const out = run([start(), spawnE('1', 'aaaa0001'), result('1', 'aaaa0001', 'skipped', { reason: '설계 관문(design_gate)' }),
      spawnE('2', 'bbbb0002'), result('2', 'bbbb0002', 'skipped', { reason: 'push 실패' }), spawnE('2', 'bbbb0002', { spawn_kind: 'resume' })])
    expect(get(out, 'RETRY_DUE')).toEqual([])
    expect(get(out, 'WARN_RETRY')).toEqual([])
  })
})
```

**X2** — 파일 끝에 더한다.

```ts
describe('tick.sh·wake.sh — 설계 상태(계약 2.11)', { timeout: 60000 }, () => {
  it('build_ready 조회 실패(null)이거나 claimed 승인 주문이 있으면 건너뛰지 않는다. 비었거나 ready 뿐이면 건너뛴다(D22)', async () => {
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [], build_ready: null, build_ready_error: 'db' }))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    lockOwner()
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [], build_ready: [{ order_id: 'o3', id8: 'cccc0003', code: '1.1', name: 'x', status: 'claimed' }] }))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim()).toBe('TICK')
    lockOwner()
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [], build_ready: [{ order_id: 'o4', id8: 'dddd0004', code: '1.2', name: 'y', status: 'ready' }] }))
    expect((await tick(['--new-tick', '--may-skip', ...baseArgs(), '--'])).out.trim().split('\n')[0]).toMatch(/^TICK_SKIPPED at=\d+ next=\d+$/)
  })
  it('wake.sh 요약: 새 서버면 reqs 에 mine·design_state, 끝에 build·build_err. 옛 서버(build_ready 없음)면 붙이지 않는다', () => {
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({
      resume_requests: [{ id8: 'aaaa0001', code: 'c', host: 'mbp', requested_at: 't', project_id: 'p1', mine: true, design_state: null }],
      build_ready: [{ order_id: 'o3', id8: 'cccc0003', code: '1.1', name: 'x', status: 'claimed' }],
    }))
    const r = spawnSync('bash', [WAKE, '--owner', OWNER, '--slots', '4', '--busy', '2', '--until-label', '09-21 06:00', '--pid', PID, '--no-events'], { cwd: repo, encoding: 'utf8', env: envFor() })
    expect(JSON.parse(r.stdout.split('\n')[1])).toEqual({
      n: 1, err: '-', reqs: [{ id8: 'aaaa0001', code: 'c', host: 'mbp', requested_at: 't', mine: true, design_state: null }], other_project: [],
      build: [{ id8: 'cccc0003', code: '1.1', status: 'claimed' }], build_err: '-',
    })
    writeFileSync(join(fake, 'watch.json'), JSON.stringify({ resume_requests: [], build_ready: null, build_ready_error: 'db' }))
    const r2 = spawnSync('bash', [WAKE, '--owner', OWNER, '--slots', '4', '--busy', '2', '--until-label', '09-21 06:00', '--pid', PID, '--no-events'], { cwd: repo, encoding: 'utf8', env: envFor() })
    expect(JSON.parse(r2.stdout.split('\n')[1])).toMatchObject({ build: 'NULL', build_err: 'db' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-lead-state.test.ts tests/skills/dflow-team-tick.test.ts`
Expected: FAIL 5건(새 describe 두 개의 다섯 it — 「다른 사유의 skipped …」 는 줄이 아예 없어 지금도 통과한다)

- [ ] **Step 3: `lead-state.sh`**

**L1** — 아래 원문을 바꾼다.

```text
#   EXCLUDE_PERM <id8,…|->                  영구 제외(진행 중·failed…·cancelled). failed rate-limit·design_waiting(설계 완료·선행 대기 — claimed 라 poll 에 안 나온다)은 넣지 않는다
```

바꿀 문구:

```text
#   EXCLUDE_PERM <id8,…|->                  영구 제외(진행 중·failed…·cancelled). failed rate-limit·design_waiting(설계 완료·선행 대기 — claimed 라 poll 에 안 나온다)·design_review(설계 검토 대기)·design_reopened(사람 설계 대기로 돌아감 — 다시 확정되면 poll 이 찾는다)은 넣지 않는다
```

**L2** — 아래 줄 바로 뒤에 더한다.

```text
#   LOST <id8> cause=<…> next=<…>          마지막이 team.lost 인 id8(영구 제외. 대기 상태는 restart.md 「이벤트로 본 상태」)
```

더할 문구:

```text
#   RETRY_DUE <id8> reason=<fetch|push> n=<연속 수>   마지막이 사유 「fetch 실패」·「push 실패」 인 skipped 이고 처리한 지 30분이 지났다
#       (설계 상태 스펙 12절 Y11 — 잡은 작업이라 poll 이 다시 찾지 않으므로 팀장이 「5-1」 로 다시 띄운다). 연속 3회부터는 내지 않는다
#   WARN_RETRY <id8> reason=<fetch|push> n=<연속 수>  같은 계열 사유가 끝에서부터 연속 3회 이상 — 자동 재시도를 멈추고 「멈춤」 표에 경고한다
```

**L3** — 아래 원문을 바꾼다.

```text
        | if $s == "done" or $s == "needs-merge" or $s == "resolved" or $s == "failed rate-limit" or $s == "design_waiting" then "none"
```

바꿀 문구:

```text
        | if $s == "done" or $s == "needs-merge" or $s == "resolved" or $s == "failed rate-limit" or $s == "design_waiting" or $s == "design_review" or $s == "design_reopened" then "none"
```

**L4** — 아래 줄 바로 뒤에 더한다.

```text
  ( $last | to_entries[] | .value | select(.event == "team.lost") | "LOST \(.id8) cause=\(.cause // "-") next=\(.next // "-")" ),
```

더할 문구:

```text
  # fetch·push 실패 skipped 의 자동 재시도(Y11): 같은 id8 의 team.result 를 끝에서부터 세어 연속 수를 정한다
  ( $last | to_entries[] | .value
    | select(.event == "team.result" and (.status // "") == "skipped" and ((.reason // "") | test("^(fetch|push) 실패")))
    | . as $e | (($e.reason // "") | capture("^(?<r>fetch|push) 실패").r) as $why
    | ([$w[] | select(.event == "team.result" and (.id8 // "") == $e.id8)] | reverse
       | reduce .[] as $r ({n: 0, stop: false};
           if .stop then . elif (($r.status // "") == "skipped" and (($r.reason // "") | test("^(fetch|push) 실패"))) then .n += 1 else .stop = true end)
       | .n) as $n
    | if $n >= 3 then "WARN_RETRY \($e.id8) reason=\($why) n=\($n)"
      elif ((($e.ts // "") | try fromdateiso8601 catch 0) <= (now - 1800)) then "RETRY_DUE \($e.id8) reason=\($why) n=\($n)"
      else empty end ),
```

- [ ] **Step 4: `wake.sh`·`tick.sh`**

K 는 `wake.sh`, T1 은 `tick.sh` 다.

**K1** — 아래 원문을 바꾼다.

```text
#   {"n":…,"err":…,"reqs":[…],"other_project":[…]}   watch 응답의 재개 요청 요약(LOCK_OK 다음 줄)
```

바꿀 문구:

```text
#   {"n":…,"err":…,"reqs":[…],"other_project":[…]}   watch 응답의 재개 요청 요약(LOCK_OK 다음 줄). 계약 2.11 서버면 reqs 원소에
#       mine·design_state 가 붙고, 끝에 "build":[{id8,code,status}…]|"NULL" 과 "build_err" 가 붙는다(build_ready 가 없는 옛 서버는 붙이지 않는다.
#       null 은 조회 실패라 "NULL" 로 낸다 — 빈 배열과 뭉개지 않는다)
```

**K2** — 아래 원문을 바꾼다.

```text
        && printf '%s' "$wr" | jq -c --arg ps "$ps" '($ps | split("\n")) as $ok
             | {n: (.resume_requests | if . == null then "NULL" else length end),
             err: (.resume_requests_error // "-"),
             reqs: [(.resume_requests // [])[] | select(.project_id as $p | $ok | index($p)) | {id8, code, host, requested_at}],
             other_project: [(.resume_requests // [])[] | select(.project_id as $p | ($ok | index($p)) | not) | .id8]}' \
```

바꿀 문구:

```text
        && printf '%s' "$wr" | jq -c --arg ps "$ps" '($ps | split("\n")) as $ok
             | {n: (.resume_requests | if . == null then "NULL" else length end),
             err: (.resume_requests_error // "-"),
             reqs: [(.resume_requests // [])[] | select(.project_id as $p | $ok | index($p))
                    | {id8, code, host, requested_at} + (if has("mine") then {mine} else {} end)
                      + (if has("design_state") then {design_state} else {} end)],
             other_project: [(.resume_requests // [])[] | select(.project_id as $p | ($ok | index($p)) | not) | .id8]}
             + (if has("build_ready") then {build: (if .build_ready == null then "NULL" else [.build_ready[] | {id8, code, status}] end),
                                           build_err: (.build_ready_error // "-")} else {} end)' \
```

**T1** — 아래 원문을 바꾼다.

```text
  printf '%s' "$j" | jq -e '(.n != "NULL") and ((.reqs // []) | length == 0)' >/dev/null 2>&1 || return 1
```

바꿀 문구:

```text
  # 승인된 설계(build_ready 의 claimed)는 poll 이 깨우지 않는다 — 있으면 건너뛰지 않는다(설계 상태 스펙 D22). 조회 실패("NULL")도 깨운다.
  # build 칸이 없으면 옛 서버다(종전과 같다).
  printf '%s' "$j" | jq -e '(.n != "NULL") and ((.reqs // []) | length == 0) and (.build != "NULL")
    and (((.build // []) | if type == "array" then . else [] end) | map(select(.status == "claimed")) | length == 0)' >/dev/null 2>&1 || return 1
```

- [ ] **Step 5: 통과 확인**

Run: `bash -n .claude/skills/dflow-team/scripts/lead-state.sh && bash -n .claude/skills/dflow-team/scripts/wake.sh && bash -n .claude/skills/dflow-team/scripts/tick.sh && npx vitest run tests/skills/dflow-team-lead-state.test.ts tests/skills/dflow-team-tick.test.ts tests/skills/shell-syntax.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-team/scripts/lead-state.sh .claude/skills/dflow-team/scripts/wake.sh .claude/skills/dflow-team/scripts/tick.sh \
  tests/skills/dflow-team-lead-state.test.ts tests/skills/dflow-team-tick.test.ts
git commit -m "feat(dflow-team): 설계 상태 결과의 제외 판정·fetch/push 실패 자동 재시도·build_ready 기상

design_review 가 영구 제외로 떨어지던 결함을 고치고, 잡은 작업의 fetch·push 실패는 30분 뒤 RETRY_DUE 로 다시 띄운다(3회 연속이면 경고).
build_ready 의 claimed 승인 주문이 있거나 조회가 실패하면 TICK 을 건너뛰지 않는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 22b: 팀장 문서 — 범위 인자 제거·서버 판단 확인·설계 사전 검사·결과 처리(`/dflow-team`)

**Files:**
- Modify: `.claude/skills/dflow-team/SKILL.md`(「참조」 표, 「인자」, 「팀장 상태」 보조·재구성 규칙·고아 스캔·「멈춤」 보고, 「1. 시작」 3·5번, 「2-1」 poll, 「2-3」 재개 요청·`build`·4번·poll exit 0·설계 사전 검사, 「3」 결과 표, 「5」 4번·끝, 「5-1」, 「금지」)
- Create: `.claude/skills/dflow-team/references/design-state.md`
- Modify: `.claude/skills/dflow-team/references/resume.md`·`design-ahead.md`·`restart.md`·`events.md`·`help.md`
- Delete: `.claude/skills/dflow-team/references/scope.md`
- Test: `tests/skills/dflow-dev-scope.test.ts`(「다른 스킬」 의 팀장 단언), `tests/skills/dflow-team-merge-conflict.test.ts`·`dflow-team-restart-flow.test.ts`(재spawn 예외 여섯·살아 있는 팀원 목록), `tests/skills/dflow-team.test.ts`(poll 첫 줄)

**Interfaces:**
- Consumes: Task 19 `poll.sh --lead` 와 넷째 칸 `action`, Task 22a `wake.sh` 의 `build`·`reqs[].mine`·`.design_state`, `lead-state.sh` 의 `RETRY_DUE`·`WARN_RETRY`, Task 21 워커 결과 줄, Task 18 `dflow.sh design-reopen`·`design-done`
- Produces: 팀장 규칙(사람과 팀장 세션이 읽는다). 새 참조 문서 `references/design-state.md`(1. 설계 사전 검사, 2. `build`, 3. 결과 보충), `references/resume.md` 「서버 판단 확인 (계약 2.11)」 표

**정한 것(스펙 6.1·6.2·6.6·6.7·9절, 12절 Y3·Y5·Y8·Y9·Y10·Y11·L5·L11):**
- 팀장 인자 "설계만"·"구현부터" 는 없다(D27). `team.start` 의 `scope` 는 늘 `server` 이고(events.md 가드의 필수 칸이라 칸은 남긴다), 포인터 `SCOPE` 는 작업마다 서버 판단 `action` 이다.
- 이어 갈지는 `resume.md` 「서버 판단 확인」 표 **한 곳**이 정한다. 5-1 재개·restart 재투입·고아 스캔·design-ahead 2·재개 요청·「1. 시작」 3번이 모두 이 표를 부른다. 표는 이미 있는 안전장치를 통과한 대상에만 쓰고 **막기만** 한다. 새로 여는 길은 「설계 승인」 된 claimed 주문(`build`)의 원격 재개 하나다(Y3).
- **옛 서버(계약 < 2.11)** 는 종전 판정 그대로다. 고아 스캔·restart.md 의 `same_host` jq(`claude-<host>`·`<신원>/<host>/w<n>`)는 옛 서버의 대체 판정으로 남긴다 — 2.9 의 `mine` 은 "같은 사용자"만 뜻하기 때문이다. 2.11 에서도 show 의 `mine` 은 팀원 라벨을 보지 않으므로(Task 16, `lead:false`) 표의 `수동 세션 점유` 행이 Y9 를 막는다.
- 재독 세트(압축 뒤 다시 읽는 「참조」~「인자」「팀장 상태」「2」「3」)는 5만 자 상한이 있다(`dflow-team.test.ts`). 그래서 긴 절차(설계 사전 검사·`build` 처리·결과 보충)는 새 `references/design-state.md` 에 두고 `SKILL.md` 는 가리키기만 한다(지운 `scope.md` 70줄을 이 문서가 대신한다). 이 Task 뒤 재독 세트는 49,646자다.
- 설계 사전 검사의 5절 판정은 스크립트가 아니라 팀장이 `## ` 제목 줄을 읽어 한다. 실제 design.md 는 제목에 번호를 붙이고("## 1. 접근 방식") 형식이 조금씩 달라, 워커의 Design 게이트처럼 판단으로 가른다.
- fetch·push 실패로 끝난 잡은 작업은 워크트리를 `parked` 로 남기고 `RETRY_DUE` 가 30분 뒤 고아 스캔으로 다시 띄운다. 3회 연속이면 `WARN_RETRY` 로 「멈춤」(Y11).
- 결과 줄 없이 `wait_review` 로 끝났는데 서버에 설계 상태가 없으면(멈춤이 서버에 닿지 않음) 팀장은 push 하지 않는다. `parked` + 「멈춤」(`설계 멈춤 미완료`)으로 두고 `--resume` 한 워커의 「끝나지 않은 설계 멈춤 이어받기」 가 마저 한다(팀장이 워커 워크트리에서 git 을 쓰지 않는다는 규칙을 지킨다).

**계획 단계 검증**: Task 21·22a 를 적용한 리포 사본에 아래 문구를 적용해, 팀장 관련 테스트 8개 파일 220건이 통과했고 `tests/skills` 전체에서 기준선에 없던 실패가 없었다. 테스트만 먼저 바꾸면 7건이 실패했다.

- [ ] **Step 1: 실패하는 테스트**

`tests/skills/dflow-dev-scope.test.ts`(Task 21 이 쓴 파일) — `existsSync` 를 import 하고 「다른 스킬」 의 팀장 단언 둘을 셋으로 바꾼다:

**Z0** — 아래 원문을 바꾼다.

```text
import { readFileSync } from 'node:fs'
```

바꿀 문구:

```text
import { existsSync, readFileSync } from 'node:fs'
```

**Z1** — 아래 원문을 바꾼다.

```text
  it('팀장: 인자로 범위를 정해 team.start·포인터로 넘기고, 워커가 --scope 로 바꾼다', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('"설계만"·"설계까지" → `design`, "구현부터"·"개발자동" → `build`, 없으면 `full`')
    expect(team).toContain('`team.start`(backend, slots, until, wp, scope)')
    expect(team).toContain('SCOPE=<full|design|build>')
    expect(team).toContain('| `design_review`(설계만 멈춤, `<SCOPE>`=`design`) | 해제 | 없음 |')
    expect(read('.claude/skills/dflow-team/scripts/lead-state.sh')).toContain('scope=\\($st.scope // "-")')
  })
  it('팀장: 범위 build 만 검토 대기 설계를 이어 가고, 좌석 「이어서 시작」 은 범위와 무관하게 build 로 띄운다', () => {
    const sc = flat(read('.claude/skills/dflow-team/references/scope.md'))
    expect(sc).toContain('select(.phase == "wait_review")')
    expect(sc).toContain('`full`·`design` 에서는 1 을 하지 않는다')
    expect(sc).toContain('요청 작업이 검토 대기면 포인터를 `SCOPE=build` 로 띄운다')
    expect(sc).toContain('git -C \'<MAIN>\' cat-file -e "origin/<개발브랜치>:<TASK_DIR>/design.md"')
    expect(flat(read('.claude/skills/dflow-team/references/restart.md'))).toContain('| 4-2 | `local_phase=wait_review` |')
  })
```

바꿀 문구:

```text
  it('팀장: 범위 인자를 받지 않고 작업마다 서버 판단(action)을 포인터 SCOPE 로 넘긴다(D27)', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('- **설계 방식은 인자가 아니다**(계약 2.11, 설계 상태 스펙 D27).')
    expect(team).not.toContain('"설계만"·"설계까지" → `design`')
    expect(team).toContain('`team.start`(backend, slots, until, wp, scope)')
    expect(team).toContain('`scope` 는 늘 `server` 다')
    expect(team).toContain('SCOPE=<full|design|build>')
    expect(team).toContain('`SCOPE` 는 그 주문의 서버 판단 `action` 이다(계약 2.11)')
    expect(team).toContain('--require-tag agent --lead --until')
    expect(team).not.toContain('scope.md')
    expect(existsSync(join(process.cwd(), '.claude/skills/dflow-team/references/scope.md'))).toBe(false)
    expect(read('.claude/skills/dflow-team/references/help.md')).not.toMatch(/설계만\|구현부터|개발자동/)
    expect(read('.claude/skills/dflow-team/scripts/lead-state.sh')).toContain('scope=\\($st.scope // "-")')
  })
  it('팀장: 결과 표·설계 사전 검사·build 목록·금지 예외 — 긴 절차는 design-state.md(6.2·6.7·Y11·L11)', () => {
    const team = flat(read('.claude/skills/dflow-team/SKILL.md'))
    expect(team).toContain('| `design_review`(설계 검토 대기로 멈춤) | 해제 | 없음 |')
    expect(team).toContain('| `design_reopened`(설계를 사람에게 되돌렸거나 주문이 바뀜, 계약 2.11) | 해제 | 없음 | 미커밋 변경이 있어도 지운다')
    expect(team).toContain('**설계 사전 검사**(계약 2.11)')
    expect(team).toContain('**`build`(계약 2.11)는 「설계 승인」 된 작업 목록이다.**')
    expect(team).toContain('`RETRY_DUE`')
    expect(team).toContain('예외 넷:')
    expect(team).toContain('| `references/design-state.md` |')
    const ds = flat(read('.claude/skills/dflow-team/references/design-state.md'))
    expect(ds).toContain('## 1. 설계 사전 검사')
    expect(ds).toContain('dflow.sh design-reopen <id8> --reason')
    expect(ds).toContain('`사람 설계 초안 있음 — 방식을 구현자동으로 바꾸거나 초안을 지우라`')
    expect(ds).toContain('「설계 승인」을 누르면 다음 TICK 에 팀장이 구현을 이어 간다')
    expect(ds).toContain('`WARN_RETRY`')
    expect(ds).toContain('`git worktree remove --force <워크트리>`')
  })
  it('팀장: 이어 가기는 resume.md 「서버 판단 확인」 한 곳이 막고, 원격 재개는 승인 대상뿐이다(Y3·Y5·Y8·Y9·Y10)', () => {
    const r = flat(read('.claude/skills/dflow-team/references/resume.md'))
    expect(r).toContain('## 서버 판단 확인 (계약 2.11)')
    expect(r).toContain('**띄우지 않게 막기만 한다**')
    expect(r).toContain('새로 여는 길은 **승인** 대상의 원격 재개 하나다')
    expect(r).toContain('`수동 세션 점유`')
    expect(r).toContain('- **승인**(계약 2.11)')
    expect(r).toContain('`-B` 로 덮지 않고 로컬 브랜치로 만든다')
    const rs = flat(read('.claude/skills/dflow-team/references/restart.md'))
    expect(rs).toContain('| 4-2 | `local_phase=wait_review` |')
    expect(rs).toContain('`설계 멈춤 미완료')
    expect(rs).not.toContain('scope.md')
    const da = flat(read('.claude/skills/dflow-team/references/design-ahead.md'))
    expect(da).toContain('서버가 claimed·`mine`·단계 `dd` 로 확인한 것만 센다')
    expect(da).toContain('`<id8> 선행 주문 없음: <ref>`')
  })
```

`tests/skills/dflow-team-merge-conflict.test.ts`:

**Z2** — 아래 원문을 바꾼다.

```text
    expect(TEAM).toContain('`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`·`design_waiting`·`design_review`)을 받지 않은 팀원이다')
```

바꿀 문구:

```text
    expect(TEAM).toContain('`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`·`design_waiting`·`design_review`·`design_reopened`)을 받지 않은 팀원이다')
```

**Z3** — 아래 원문을 바꾼다.

```text
    expect(TEAM).toContain('- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 다섯뿐이다.')
    expect(TEAM).toContain('같은 작업을 다시 띄우는 것은 다섯뿐이다(')
```

바꿀 문구:

```text
    expect(TEAM).toContain('- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 여섯뿐이다.')
    expect(TEAM).toContain('같은 작업을 다시 띄우는 것은 여섯뿐이다(')
```

**Z6** — 아래 원문을 바꾼다.

```text
  it('금지: heartbeat·--resolve 예외, 재spawn 예외는 다섯', () => {
```

바꿀 문구:

```text
  it('금지: heartbeat·--resolve 예외, 재spawn 예외는 여섯', () => {
```

`tests/skills/dflow-team-restart-flow.test.ts`:

**Z4** — 아래 원문을 바꾼다.

```text
    expect(S).toContain('같은 작업을 다시 띄우는 것은 다섯뿐이다(')
    expect(S).toContain('- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 다섯뿐이다.')
```

바꿀 문구:

```text
    expect(S).toContain('같은 작업을 다시 띄우는 것은 여섯뿐이다(')
    expect(S).toContain('- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 여섯뿐이다.')
```

**Z7** — 아래 원문을 바꾼다.

```text
  it('같은 작업 재spawn 예외가 넷이고 마감은 재시작 대기를 멈춤 표에 적는다', () => {
```

바꿀 문구:

```text
  it('같은 작업 재spawn 예외가 여섯이고 마감은 재시작 대기를 멈춤 표에 적는다', () => {
```

`tests/skills/dflow-team.test.ts`(poll 명령 첫 줄에 `--lead`):

**Z5** — 아래 원문을 바꾼다.

```text
    expect(s()).toContain('"<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until \'<UNTIL>\' --interval 180 --recheck-cycles 10 \\')
```

바꿀 문구:

```text
    expect(s()).toContain('"<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --lead --until \'<UNTIL>\' --interval 180 --recheck-cycles 10 \\')
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-team-merge-conflict.test.ts tests/skills/dflow-team-restart-flow.test.ts tests/skills/dflow-team.test.ts`
Expected: FAIL 7건

- [ ] **Step 3: `SKILL.md` — 「참조」·「인자」·「팀장 상태」·「1. 시작」**

**M0a** — 아래 원문을 바꾼다.

```text
| `references/resume.md` | 재개 spawn(「5-1」) 때 |
```

바꿀 문구:

```text
| `references/resume.md` | 재개 spawn(「5-1」) 때, 계약 2.11 에서 이어 갈지 가를 때(「서버 판단 확인」) |
```

**M0b** — 아래 원문을 바꾼다.

```text
| `references/scope.md` | 실행 범위(`<SCOPE>`)가 `full` 이 아닐 때의 후보 판정, `design_review` 결과, `wait_review` 재개 때 |
```

바꿀 문구:

```text
| `references/design-state.md` | 계약 2.11 에서 poll 후보의 설계 사전 검사, 「설계 승인」 된 작업(`build`), 설계 상태 결과 처리 때 |
```

**M1** — 아래 원문을 바꾼다.

```text
- **실행 범위**는 선택이다: "설계만"·"설계까지" → `design`, "구현부터"·"개발자동" → `build`, 없으면 `full`. 정한 값을
  `<SCOPE>` 로 기억하고 `team.start` 의 `scope` 에 남긴다(「1. 시작」 5번, 압축 뒤 `RUN` 의 `scope` 로 복원). 포인터에
  `SCOPE=<SCOPE>` 를 싣고 워커가 `/dflow-dev --scope` 로 넘긴다(정본 `/dflow-dev` SKILL.md 「실행 범위」). `design` 은 설계를 마치고
  사람의 검토를 기다리며 멈추고(`design_review`), `build` 는 사람이 쓴 설계(개발 브랜치 `<TASKS>/<TSK>/design.md`)나 검토 대기 설계에서
  구현한다. `full` 이 아니면 후보 판정·결과 처리에 `references/scope.md` 를 Bash `cat` 으로 읽어 더한다. 시작 보고에 범위를 한 줄 적는다.
```

바꿀 문구:

```text
- **설계 방식은 인자가 아니다**(계약 2.11, 설계 상태 스펙 D27). 사람이 WBS 작업 패널에서 작업마다 고르고, 팀장은 서버 판단 `action` 을
  포인터 `SCOPE` 로 넘긴다(「5」 4번). 옛 인자 "설계만"·"구현부터" 가 오면 쓰지 않고 그렇다고 한 줄 알린다.
```

**M2** — 아래 줄 바로 뒤에 더한다.

```text
  `claimed_by` 불일치)를 무시하고 진행하며, 띄우기 전에 무엇이 남아 있고 무엇을 잃는지 한 줄로 보고한다.
```

더할 문구:

```text
  계약 2.11 서버에서는 서버 `mine` 이 거짓이면(다른 PC 가 30분 안에 돌렸거나 다른 신원이 잡았다) 띄우지 않는다(`references/resume.md`
  「서버 판단 확인」).
```

**M3** — 아래 원문을 바꾼다.

```text
- `RUN` 의 `scope`(`team.start` 의 `scope`, 없는 옛 줄은 `-` = `full`)가 실행 범위 `<SCOPE>` 다.
```

바꿀 문구:

```text
- `RUN` 의 `scope` 는 옛 팀장 기록과의 호환 칸이다. 계약 2.11 팀장은 `server` 를 적고 이 값을 쓰지 않는다(범위는 작업마다 서버 판단).
```

**M4** — 아래 원문을 바꾼다.

```text
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`failed not-assignee`·`cancelled`·`blocked` 는 영구, `failed rate-limit`·`design_waiting`·`design_review` 은 제외
```

바꿀 문구:

```text
  `failed not-isolated`·`failed no-worker-flag`·`failed deps`·`failed not-assignee`·`cancelled`·`blocked` 는 영구, `failed rate-limit`·`design_waiting`·`design_review`·`design_reopened` 은 제외
```

**M5** — 아래 원문을 바꾼다.

```text
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`·`design_waiting`·`design_review`)을 받지 않은 팀원이다.
```

바꿀 문구:

```text
- "살아 있는 팀원" 은 spawn 했고 아직 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`·`design_waiting`·`design_review`·`design_reopened`)을 받지 않은 팀원이다.
```

**M6** — 아래 원문을 바꾼다.

```text
     거두고, 이어 가기는 `references/scope.md` 「2」 만 한다.
```

바꿀 문구:

```text
     거두고, 「설계 승인」 뒤에는 「2-3」 의 `build`(승인된 작업)가 이어 가기를 부른다.
```

**M7** — 아래 줄 바로 뒤에 더한다.

```text
     - `.result` 가 없거나, 있어도 status 가 최종 판정(`done`·`needs-merge`·`skipped`·`failed`·`cancelled`·`resolved`)이 아니다.
       최종 판정이 있으면 재개가 아니라 「3. 결과 처리」 의 몫이다.
```

더할 문구:

```text
       단 `RETRY_DUE`(`lead-state.sh` — fetch·push 실패 뒤 30분)인 `skipped` 는 최종 판정이 아니다(12절 Y11). `WARN_RETRY` 면 「멈춤」 이다.
```

**M8** — 아래 줄 바로 뒤에 더한다.

```text
       `claude-<host>` 와 같거나 팀원 라벨 `<신원>/<host>/w<슬롯>` 의 가운데 칸이 `<host>` 다(이 PC 가 claim 했다).
```

더할 문구:

```text
       계약 2.11 이면 `references/resume.md` 「서버 판단 확인」 도 통과한다(`same_host` 는 옛 서버의 대체 판정).
```

**M9** — 아래 원문을 바꾼다.

```text
  `rate-limit 대기(<HH:MM>)`·`중단 표식 불일치`·`중단 표식 삭제 실패`·`거두기 실패`·`살아 있는 팀원`·`서버 <status>`·`서버 조회 실패`(`references/restart.md`), 또는 결과 줄의
```

바꿀 문구:

```text
  `rate-limit 대기(<HH:MM>)`·`중단 표식 불일치`·`중단 표식 삭제 실패`·`거두기 실패`·`살아 있는 팀원`·`서버 <status>`·`서버 조회 실패`(`references/restart.md`),
  계약 2.11 의 `references/resume.md` 「서버 판단 확인」 사유·`사람 설계 초안 있음`·`fetch·push 3회 연속 실패`·`설계 멈춤 미완료`, 또는 결과 줄의
```

**M10** — 아래 줄 바로 뒤에 더한다.

```text
   상태 열이 `CL` 인 행만 센다(`--scope claimed` 는 승인 대기인 `RP` 행도 돌려준다).
```

더할 문구:

```text
   계약 2.11 이면 이 목록의 id8 마다 `references/resume.md` 「서버 판단 확인」 을 돌려 사유를 그 표의 것으로 적는다. 그 표가 띄우라고
   가르는 것은 「설계 승인」 된 작업(`action=build`)뿐이다 — 멈춤이 아니라 재개 대상으로 넘긴다(「5-1」 이 원격 agent 브랜치에서
   워크트리를 만든다. 설계 상태 스펙 12절 Y3 이 여는 유일한 새 길).
```

**M11** — 아래 원문을 바꾼다.

```text
5. `team.start`(backend, slots, until, wp, scope)를 기록한다. `until` 은 `<UNTIL>` 이다. `wp` 는 정규화한 WP 범위를 쉼표로 이은 값이며 없으면 `-` 다. `scope` 는 `<SCOPE>`(`full`·`design`·`build`)다. 3번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
```

바꿀 문구:

```text
5. `team.start`(backend, slots, until, wp, scope)를 기록한다. `until` 은 `<UNTIL>` 이다. `wp` 는 정규화한 WP 범위를 쉼표로 이은 값이며 없으면 `-` 다. `scope` 는 늘 `server` 다(설계 방식은 작업마다 서버 판단 — 「인자」). 3번에서 이어받은 것은 `team.start` 바로 뒤에 같은 필드로
```

- [ ] **Step 4: `SKILL.md` — 「2-1」·「2-3」**

**M12a** — 아래 원문을 바꾼다.

```text
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --until '<UNTIL>' --interval 180 --recheck-cycles 10 \
```

바꿀 문구:

```text
    "<MAIN>/.claude/skills/dflow-poll/scripts/poll.sh" --require-tag agent --lead --until '<UNTIL>' --interval 180 --recheck-cycles 10 \
```

**M12b** — 아래 줄 바로 뒤에 더한다.

```text
- `--wp` 에는 WP 범위(`team.start` 의 `wp`)를 공백 없는 쉼표 구분으로 넣는다. 범위가 전체(`-`)면 플래그를 생략한다.
  poll.sh 가 형식(`WP-<숫자>` 또는 `<모듈>/WP-<숫자>`)을 검사해 틀리면 exit 2 로 끝나며, 번호 앞의 0 은 무시한다.
```

더할 문구:

```text
- `--lead`(계약 2.11): 서버가 `mine` 을 팀장 기준으로 계산한다. 새 서버면 ready 줄에 넷째 칸 `action` 이 붙고 `action` 이
  `full`·`design`·`build` 이고 `mine` 인 것만 온다(12절 Y4). 옛 서버는 종전과 같다.
```

**M13a** — 아래 줄 바로 뒤에 더한다.

```text
  파생한 값이다. 팀장이 다시 계산하지 않는다). 다른 값이면 **"멈춤" 표에 사유 `다른 PC claim` 으로 적고 띄우지 않는다.**
```

더할 문구:

```text
  계약 2.11 이면 `host` 대신 요청의 `mine` 으로 가른다(거짓이면 「멈춤」 `다른 PC 도는 중`). `design_state` 가 `review` 면 띄우지 않고
  "「설계 승인」 뒤에 이어 갑니다" 를 한 줄 알린다. 그 밖에는 서버 판단이 `skip` 이어도 띄운다(12절 Y10).
```

**M13b** — 아래 원문을 지운다(그 줄을 통째로).

```text
- 요청 작업이 설계 검토 대기(`wait_review`)면 범위와 무관하게 포인터 `SCOPE=build` 로 띄운다(`references/scope.md` 「2」 2).
```

**M14** — 아래 줄 바로 뒤에 더한다.

```text
로 부르면 무필터로 전체 재개 요청이 온다)면 `beat` 는 이미 갱신됐으므로 잠금은 유효하고, 그 기상의 요청 처리만 건너뛴다.
```

더할 문구:

```text

**`build`(계약 2.11)는 「설계 승인」 된 작업 목록이다.** 기상 블록 요약 끝의 `build` 칸이며, 처리는 `references/design-state.md` 「2」 다
(claimed 원소를 재개 대상으로. `"NULL"` 은 조회 실패).
```

**M15** — 아래 줄 바로 뒤에 더한다.

```text
   새 작업보다 먼저다. rate-limit 보류 중에는 재개·새 작업 모두 띄우지 않는다(`RL_DUE` 슬롯 자신의 재투입만 예외).
```

더할 문구:

```text
   기상 블록 요약의 `build` 의 claimed 원소(「설계 승인」 된 작업, 계약 2.11)와 재구성의 `RETRY_DUE`(fetch·push 실패 재시도)도 재개
   대상이다 — 새 작업보다 먼저다.
```

**M16** — 아래 원문을 바꾼다.

```text
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름` 에서 순번은 버리고 id8 만 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다(겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌 수 있다). 일시 제외는 대조하지 않는다(poll.sh 가 10주기 뒤 풀어 돌려준 것을 그대로 다시 판정한다, 「2-1」). 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지와 선행 사전 검사(`deps_unmet`)만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. `deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)` 로 보고와 `team.result` 는 같게 하되, 일시 제외가 아니라 **선행 대기**에 넣는다(아래 「선행 사전 검사」). `deps_unmet` 이 비었고 `deps_nohead` 가 비어 있지 않으면 아래 「선행 반영 사전 검사」 를 거친다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다. `<SCOPE>` 가 `full` 이 아니면 이 판정에 `references/scope.md` 「1」 을 더한다 |
```

바꿀 문구:

```text
| poll exit 0 (ready N줄) | 각 줄 `순번<TAB>id8<TAB>이름[<TAB>action]` 에서 순번은 버리고 id8 과 `action`(계약 2.11, 없으면 `full`)을 쓴다. 먼저 후보를 영구 제외 목록과 슬롯 표에만 한 번 더 대조해 걸리는 것을 버린다(겹쳐 뜬 옛 poll 은 옛 제외 목록으로 돌 수 있다). 일시 제외는 대조하지 않는다(poll.sh 가 10주기 뒤 풀어 돌려준 것을 그대로 다시 판정한다, 「2-1」). 남은 후보마다 아래 show 필터로 `.order.item.spec` 이 비었는지와 선행 사전 검사(`deps_unmet`)만 본다(spec 본문을 컨텍스트에 싣지 않는다). 비었거나 `ref` 가 비면 일시 제외에 넣고 사유(spec 부재·TSK 없음)를 보고하며 `team.result`(slot `-`, status `skipped`)를 남긴다. `deps_unmet` 이 비어 있지 않으면 띄우지 않고 사유 `선행 미충족(사전 검사: <ref…>)` 로 보고와 `team.result` 는 같게 하되, 일시 제외가 아니라 **선행 대기**에 넣는다(아래 「선행 사전 검사」). `deps_unmet` 이 비었고 `deps_nohead` 가 비어 있지 않으면 아래 「선행 반영 사전 검사」 를 거친다. 남은 것을 빈 슬롯 수만큼 spawn 하고 나머지는 대기 큐 끝에 넣는다. 차단기가 걸려 있으면 spawn 하지 않고 대기 큐에 넣는다(시험 spawn 예외는 「2-1」 재기동 조건). 대기 큐를 잃어도 그 작업들은 아직 ready 이므로 다음 poll 이 다시 찾는다. `action` 이 `design` 이면 `deps_unmet` 이 있어도 선행 대기에 넣지 않는다(설계만 한다, 스펙 6.6). spawn 전에 아래 「설계 사전 검사」 를 거친다 |
```

**M17** — 아래 줄 바로 뒤에 더한다.

```text
- 모두 `REFLECTED` 면 그대로 spawn 한다.
```

더할 문구:

```text

**설계 사전 검사**(계약 2.11): `action` 이 있는 후보는 띄우기 전에 `references/design-state.md` 「1」 을 한다.
```

- [ ] **Step 5: `SKILL.md` — 「3」 결과 표·「5」·「5-1」·「금지」**

**M18a** — 아래 원문을 바꾼다.

```text
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고 |
```

바꿀 문구:

```text
| `skipped`(선행 미충족·선행 미승인·선행 승인 대기·claim exit 4·공통 기점 없음·spec 부재, 계약 2.11 의 `설계 관문(<code>)`·`사람 설계 초안 있음`·서버 판단 사유) | 해제 | 일시 제외 | branch 가 `-` 면 부트스트랩 실패 정리 규칙, 아니면 `done` 과 같다 | 사유 보고. `사람 설계 초안 있음` 은 「멈춤」 표에도 |
| `skipped`(`fetch 실패`·`push 실패`·`다른 PC 도는 중(<runner>)`, 계약 2.11) | 해제 | 일시 제외 | **지우지 않는다**. `parked` 로 | `references/design-state.md` 「3」 |
```

**M18b** — 아래 원문을 바꾼다.

```text
| `design_waiting`(설계 완료·선행 대기, 사유는 미충족 선행 ref) | 해제 | 없음 | **지우지 않는다**. `.dflow-agent` 를 `parked` 로 | 실패가 아니다(차단기 연속 수를 0 으로). 재개는 `references/design-ahead.md` 2·4번 |
```

바꿀 문구:

```text
| `design_waiting`(설계 완료·선행 대기, 사유는 미충족 선행 ref) | 해제 | 없음 | **지우지 않는다**. `.dflow-agent` 를 `parked` 로 | 실패가 아니다(차단기 연속 수를 0 으로). 재개는 `references/design-ahead.md` 2·4번. `design-done 미확인` 이면 `references/design-state.md` 「3」 먼저 |
```

**M18c** — 아래 원문을 바꾼다.

```text
| `design_review`(설계만 멈춤, `<SCOPE>`=`design`) | 해제 | 없음 | `done` 과 같다(설계는 agent 브랜치에 push 돼 있다) | 실패가 아니다(차단기 연속 수를 0 으로). 좌석은 「설계 검토 대기」. 이어 가기는 `references/scope.md` 「결과」 |
```

바꿀 문구:

```text
| `design_review`(설계 검토 대기로 멈춤) | 해제 | 없음 | `done` 과 같다(설계는 push 돼 있다) | 실패가 아니다(차단기 0). 보고·`design-done 미확인` 은 `references/design-state.md` 「3」 |
| `design_reopened`(설계를 사람에게 되돌렸거나 주문이 바뀜, 계약 2.11) | 해제 | 없음 | 미커밋 변경이 있어도 지운다(`references/design-state.md` 「3」) | 실패가 아니다(차단기 0) |
```

**M19** — 아래 원문을 바꾼다.

```text
   - `SCOPE` 는 「인자」 의 `<SCOPE>` 다. 재개(「5-1」)·재시작(restart.md 재투입)도 같은 값을 싣는다 — 단 `references/scope.md` 가
     정한 재개(검토 대기 설계를 구현으로 넘기기)는 `build` 다.
```

바꿀 문구:

```text
   - `SCOPE` 는 그 주문의 서버 판단 `action` 이다(계약 2.11). 새 작업은 poll 줄의 넷째 칸이고, 비었으면(옛 서버) `full` 이다. 재개(「5-1」)·
     재시작(restart.md 재투입)은 `references/resume.md` 「서버 판단 확인」 의 `action`(`full`·`design`·`build`, 그 밖은 `full`)이다 — 워커는
     잡힌 작업에서 서버 `claim_scope` 를 따른다.
```

**M20a** — 아래 원문을 바꾼다.

```text
같은 작업을 다시 띄우는 것은 다섯뿐이다(다섯째는 「5-2. 해소 spawn」 의 해소 워커다. 주문이 `reported`·`approved` 라 개발 재spawn 이 아니며 `resolve-decide.sh` 판정 안에서만 띄운다). poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`,
제외하지 않는 `failed rate-limit`), 고아 스캔이 "재개 가능" 으로 분류한 중단 작업, `--resume` 으로 사람이 지목한
작업, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업이다. 뒤의 셋은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다(워크트리를 새로 만들지 않고 claim 도
```

바꿀 문구:

```text
같은 작업을 다시 띄우는 것은 여섯뿐이다(다섯째는 「5-2. 해소 spawn」 의 해소 워커다. 주문이 `reported`·`approved` 라 개발 재spawn 이 아니며 `resolve-decide.sh` 판정 안에서만 띄운다). poll 이 그 작업을 다시 돌려준 경우(일시 제외가 풀린 `skipped`,
제외하지 않는 `failed rate-limit`), 고아 스캔이 "재개 가능" 으로 분류한 중단 작업, `--resume` 으로 사람이 지목한
작업, 자동 재시작(`references/restart.md`)이 다시 띄우는 작업, 여섯째로 「설계 승인」 된 작업의 이어 가기(계약 2.11, 「2-3」 의 `build`)다. 뒤의 넷은 이 절이 아니라 「5-1. 재개 spawn」 의 절차로 띄운다(워크트리를 새로 만들지 않고 claim 도
```

**M20b** — 아래 원문을 바꾼다.

```text
- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 다섯뿐이다. `blocked` 는 재spawn 하지 않는다.
```

바꿀 문구:

```text
- 같은 작업의 재spawn. 예외는 「5. 팀원 spawn」 끝의 여섯뿐이다. `blocked` 는 재spawn 하지 않는다.
```

**M21** — 아래 원문을 바꾼다.

```text
중단된 작업을 이어 띄운다. 새 작업 spawn 과 두 가지가 다르다. **워크트리를 새로 만들지 않고**(남아 있으면
그대로 쓴다) **claim 하지 않는다**. 대상은 넷이다: 고아 스캔의 "재개 가능"(**자동**, 대기 큐보다 먼저), 좌석표 「이어서 시작」
의 `resume_requests`(**요청**, 재시도 상한 무시), `references/restart.md` 「재투입」(**재시작**), `--resume <id8>`(**지목**,
자동 판정의 거부 사유 무시. 서버 status 가 `claimed` 일 때만 재개다). 띄울 때마다 `references/resume.md` 를 Bash `cat` 으로
읽고 그 0~9항 절차(입장 제어 → 손실 보고 → 다른 PC 경고 → 워크트리 확보 → `TASK_DIR`·`DOCKER` → 슬롯·`.dflow-agent` 되돌리기
→ 포인터 재작성 → 중단 표식 정리·띄우기 → 옛 `.result` 삭제 → `team.spawn`(`resume`))를 그대로 따른다.
```

바꿀 문구:

```text
중단된 작업을 이어 띄운다. 새 작업 spawn 과 두 가지가 다르다. **워크트리를 새로 만들지 않고**(남아 있으면
그대로 쓴다) **claim 하지 않는다**. 대상은 다섯이다: 고아 스캔의 "재개 가능"(**자동**, 대기 큐보다 먼저), 좌석표 「이어서 시작」
의 `resume_requests`(**요청**, 재시도 상한 무시), `references/restart.md` 「재투입」(**재시작**), `--resume <id8>`(**지목**,
자동 판정의 거부 사유 무시. 서버 status 가 `claimed` 일 때만 재개다), 「2-3」 의 `build` 의 claimed 원소(**승인**, 계약 2.11 — 워크트리가
없으면 원격 agent 브랜치에서 만든다). 띄울 때마다 `references/resume.md` 를 Bash `cat` 으로 읽고 「서버 판단 확인」(계약 2.11)과
그 0~9항 절차(입장 제어 → 손실 보고 → 다른 PC 경고 → 워크트리 확보 → `TASK_DIR`·`DOCKER` → 슬롯·`.dflow-agent` 되돌리기
→ 포인터 재작성 → 중단 표식 정리·띄우기 → 옛 `.result` 삭제 → `team.spawn`(`resume`))를 그대로 따른다.
```

**M22a** — 아래 원문을 바꾼다.

```text
  예외 둘: (1) 머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제, `references/merge-conflict.md`
  「3」)는 팀장이 한다. 주문 상태를 바꾸지 않고 표시 열만 쓴다. (2) 팀장이 띄운
  해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다. "스윕의 머지만 팀장이 한다" 의 유일한
  예외다. 경합은 두 쪽 모두 non-fast-forward 거부로 드러나고, force push 는 여전히 금지다.
```

바꿀 문구:

```text
  예외 넷: (1) 머지 충돌 표시 heartbeat(`merge_conflict` 설정·해제, `references/merge-conflict.md`
  「3」)는 팀장이 한다. 주문 상태를 바꾸지 않고 표시 열만 쓴다. (2) 팀장이 띄운
  해소 워커의 `/dflow-merge --resolve` 가 개발 브랜치에 한 건을 머지·push 한다. "스윕의 머지만 팀장이 한다" 의 유일한
  예외다. 경합은 두 쪽 모두 non-fast-forward 거부로 드러나고, force push 는 여전히 금지다. (3) 「2-3」 「설계 사전 검사」 의
  `design-reopen`(ready 인 구현자동 작업의 사람 설계를 되돌린다 — 주문의 설계 상태만 바꾼다). (4) 「3. 결과 처리」 의 설계 멈춤 이어받기
  에서 부르는 `design-done`(워커가 push 까지 마친 멈춤을 서버에 기록만 한다, 설계 상태 스펙 6.3).
```

재독 세트 크기를 확인한다:

```bash
sed -n '/^\*\*참조\*\*/,/^## 두 번째 팀장/p;/^## 2\. 기상과 감시/,/^## 4\. 승인 스윕/p' .claude/skills/dflow-team/SKILL.md | wc -m
```

Expected: `49646` 안팎(5만 미만이면 통과).

- [ ] **Step 6: `references/design-state.md`(새)·`resume.md`**

**Q2** — `references/design-state.md` 를 새로 만든다.

````markdown
# /dflow-team 설계 상태 (계약 2.11)

SKILL.md 「2-3」 의 poll exit 0·`build`, 「3. 결과 처리」 가 가리킬 때 Bash `cat` 으로 읽는다. 옛 서버(계약 < 2.11)에서는 읽지 않는다 —
모든 작업이 완전자동이다. 워커 쪽 정본은 `/dflow-dev` `references/orch/start.md` 「서버 판단」 과 worker-mode.md 「설계 상태의 결과 줄」 이고,
설계는 wbs-web 리포 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 6절·12절(킷에는 미동봉)이다.

## 1. 설계 사전 검사

poll 줄에 넷째 칸 `action` 이 있는 후보를 띄우기 전에 개발 브랜치의 설계 문서를 본다(스펙 6.2 「띄우기 전 검사」). 워커를 띄워 곧 되돌리는
낭비와, 사람 초안을 에이전트 설계가 옮기거나 덮는 일(12절 L5)을 막는다. `git fetch origin` 은 기상마다 한 번만 하고, 실패하면 이 기상에는
`action` 이 있는 후보를 하나도 띄우지 않는다(모르는 채 띄우지 않는다. 제외도 하지 않는다 — 다음 기상에 다시 본다). `<TASK_DIR>` 은 SKILL.md
「5. 팀원 spawn」 3번 블록으로 여기서 먼저 구하고, 「5」 는 그 값을 다시 쓴다.
```bash
git -C '<MAIN>' fetch -q origin || echo FETCH_FAIL
git -C '<MAIN>' show "origin/<개발브랜치>:<TASK_DIR>/design.md" 2>/dev/null | grep '^## ' || echo NO_DESIGN
```
- `action=build`(구현자동 — 사람이 「설계 확정」 했다): 제목 줄만 보고 Design 게이트의 최소 구조 5절(접근·변경 파일 목록·테스트 전략·수용
  기준 매핑·불변 규칙 — 번호와 덧붙인 말은 무시한다)이 모두 있는지 가린다. `NO_DESIGN` 이거나 절이 빠졌으면 띄우지 않고
  `.claude/skills/dflow-work/scripts/dflow.sh design-reopen <id8> --reason "<design.md 없음 | 빠진 절: …>"` 를 부른다. 서버가 사람 설계
  대기로 되돌리고 사유를 화면에 보인다(사람이 고쳐 다시 확정하면 poll 이 다시 준다). 제외는 하지 않는다. 보고 한 줄:
  `<TSK> 사람 설계를 되돌렸습니다 — <사유>`. design-reopen 이 실패하면 띄우지 않고 사유 `설계 되돌리기 실패(exit <n>)` 로 일시 제외에 넣고
  `team.result`(slot `-`, status `skipped`)를 남긴다.
- `action=design`·`full`: `NO_DESIGN` 이 아니면 사람이 쓴 설계 초안이 개발 브랜치에 있다. 띄우지 않고 「멈춤」 표에
  `사람 설계 초안 있음 — 방식을 구현자동으로 바꾸거나 초안을 지우라` 로 올리며, `team.result`(slot `-`, status `skipped`, 사유
  `사람 설계 초안 있음`)를 남겨 일시 제외한다(poll 이 30분 뒤 다시 준다, 12절 L11).
- 통과하면 그대로 spawn 한다. 포인터의 `SCOPE` 는 그 `action` 이다(SKILL.md 「5」 4번).

## 2. 「설계 승인」 된 작업(`build`)

기상 블록 요약 끝의 `build` 칸이다(옛 서버면 칸이 없다). 서버가 팀장 lease 의 프로젝트로 이미 좁혀 준 "이 신원·이 PC 가 띄울 build 주문"
이다.
- `"NULL"` 이면 조회 실패다. 그 기상에는 처리하지 않고 `build_err` 를 한 줄 보고한다(빈 목록과 뭉개지 않는다).
- 배열이면 `status` 가 `claimed` 인 원소(「설계 승인」 된 설계 검토 작업 — poll 에 나오지 않는다) 중 슬롯·영구 제외에 없는 것을 재개 대상에
  더한다(SKILL.md 「2-3」 4번의 순서, 「5-1」 의 **승인** 대상). 이 PC 에 워크트리가 있으면 그것을, 없으면 `references/resume.md` 3항이 원격
  agent 브랜치에서 만든다. 띄우기 전 확인은 resume.md 「서버 판단 확인」 이다.
- `ready` 원소(구현자동 확정)는 poll(`action=build`)이 가져오므로 여기서 띄우지 않는다.

## 3. 결과

SKILL.md 「3. 결과 처리」 표가 가리키는 보충이다.
- **`design_review`**: 실패가 아니다. 보고 한 줄: `<TSK> 설계 검토 대기(<branch>) — 「설계 승인」을 누르면 다음 TICK 에 팀장이 구현을
  이어 간다`.
- **`design-done 미확인`**(`design_review`·`design_waiting` 의 사유): 워커가 push 까지 마쳤는데 design-done 이 네트워크로 실패했다. 워크트리를
  지우기 전에 `.claude/skills/dflow-work/scripts/dflow.sh design-done <id8>` 를 부른다(설계 멈춤 이어받기, 스펙 6.3). 실패하면 워크트리를
  지우지 않고 `parked` 로 두며 다음 기상에 다시 부르고, 「멈춤」 표에 사유 `설계 멈춤 미완료` 로 올린다.
- **`skipped fetch 실패`·`skipped push 실패`**(잡은 작업): 워크트리를 지우지 않는다(push 하지 못한 커밋이 있을 수 있다). 30분 뒤 재구성의
  `RETRY_DUE` 로 고아 스캔이 다시 띄우고, 같은 계열이 3회 연속이면 `WARN_RETRY` 로 「멈춤」 표에 `fetch·push 3회 연속 실패` 를 올린다
  (12절 Y11 — 네트워크·권한을 사람이 확인한 뒤 `--resume`).
- **`skipped 다른 PC 도는 중(<runner>)`**: 워크트리를 지우지 않고 「멈춤」 표에 올린다(다른 PC 의 세션이 이어 간다).
- **`design_reopened`**(설계를 사람에게 되돌렸거나 주문이 바뀜): 실패가 아니다. 워크트리는 미커밋 변경이 있어도 지운다 — 설계 원본은 개발
  브랜치이거나 이미 push 돼 있다. `git worktree remove --force <워크트리>`(Orca 는 Orca 정리 명령에 `--force`) 뒤 backends.md
  「고아 정리 규칙」 5번의 생성 브랜치 정리. 보고 한 줄: `<TSK> 설계를 사람에게 되돌렸습니다 — <사유>. 다시 확정·승인되면 새로 띄웁니다`.
````

U 는 `references/resume.md` 다.

**U1** — 아래 원문을 바꾼다.

```text
대상은 넷이다.
```

바꿀 문구:

```text
대상은 다섯이다.
```

**U2** — 아래 줄 바로 뒤에 더한다.

```text
  한다.
```

더할 문구:

```text
- **승인**(계약 2.11): 기상 블록 요약의 `build` 에 든 claimed 주문(「설계 승인」 된 설계 검토 작업). 워크트리가 이 PC 에 없으면 3항이 원격
  agent 브랜치에서 만든다(설계 상태 스펙 12절 Y3 이 여는 유일한 새 길). 재시도 상한은 자동 갈래와 나눠 쓴다.
```

**U3** — 아래 줄 바로 앞에 더한다.

```text
절차:
```

더할 문구:

````text
## 서버 판단 확인 (계약 2.11)

`dflow.sh contract-ge 2.11` 이 exit 0 이면 대상마다 아래 절차 0항 전에 한 번 돈다(옛 서버는 건너뛴다 — 종전 판정 그대로). 이 표는 이미
있는 안전장치(살아 있는 슬롯·최종 결과·제외·재시도 상한·`PARKED`·선행 반영 검사)를 통과한 대상에만 쓰고, **띄우지 않게 막기만 한다**.
새로 여는 길은 **승인** 대상의 원격 재개 하나다(설계 상태 스펙 6.2·12절 Y3). 「1. 시작」 3번의 멈춤 사유도 이 표로 적는다.
```bash
(.claude/skills/dflow-work/scripts/dflow.sh show '<id8>') | jq -r '.order | [.status, (.mine | tostring), (.action // "-"), (.action_reason // "-"),
  (.design_state // "-"), (.runner // "-"), (.item.stage // "-"), (.claimed_by // "-")] | @tsv' || echo SHOW_FAILED
```
위에서부터 보고 처음 맞는 줄에서 멈춘다. `워크트리` 는 이 PC 에 그 id8 의 팀원 워크트리가 있는지다(`parked` 포함).

| 조건 | 처리 |
|---|---|
| `SHOW_FAILED`·빈 출력 | 이번 기상에 띄우지 않는다(「멈춤」 사유 `서버 조회 실패`는 두 기상 연속일 때만) |
| status 가 `claimed` 가 아님 | 위 대상별 규칙(지목의 `ready`·`reported`·`approved` 갈래). 자동·재시작·승인은 띄우지 않는다 |
| `mine` 이 거짓 | 띄우지 않는다. 「멈춤」 사유 `다른 PC 도는 중(<runner>)`(runner 가 있을 때) 또는 `다른 신원 점유` |
| `design_state` 가 `review` | 띄우지 않는다. 「멈춤」 에 올리지 않는다(사람의 「설계 승인」 을 기다린다 — 승인되면 **승인** 대상으로 온다) |
| 대상이 요청·지목 | 띄운다 — `action` 이 `skip`·`wait` 이어도(사람의 명시 요청, 12절 Y10·Y12. 선행이 아직이면 워커가 다시 보고 `design_waiting` 으로 곧 끝난다 — 한 번 누름에 한 번이다) |
| `action` 이 `wait` | 띄우지 않는다. 「멈춤」 에 올리지 않는다(선행 대기 — 설계 완료 대기는 `references/design-ahead.md` 2번이 선행이 풀린 뒤 본다) |
| 대상이 자동·재시작·승인이고 점유 라벨이 팀원 라벨(`<신원>/<host>/w<n>`)이 아님 | 띄우지 않는다. 「멈춤」 사유 `수동 세션 점유`(사람이 손으로 잡은 작업은 팀장이 이어받지 않는다, 12절 Y9) |
| `action` 이 `skip` 이고 워크트리 있음, 대상이 재시작·자동 | 띄운다(결과 없이 죽은 이 PC 의 팀원만 — 종전 재시작 규칙) |
| `action` 이 `skip` 이고 워크트리 없음, 단계가 `ip` 이상 | 띄우지 않는다. 「멈춤」 사유 `워크트리 없음 — 구현 중`(다른 PC 의 워크트리에 push 하지 않은 구현이 있을 수 있다) |
| `action` 이 `skip`(그 밖) | 띄우지 않는다. 「멈춤」 사유는 `<action_reason>` |
| `action` 이 `full`·`design` 이고 워크트리 없음 | 띄우지 않는다. 「멈춤」 사유 `워크트리 없음`(종전 — 사람이 `--resume` 으로 지목하면 띄운다) |
| 그 밖(`full`·`design`·`build`) | 띄운다. 포인터 `SCOPE` 는 그 `action` 이다. `action` 이 `full`·`build` 이고 선행 중 `reached` 인데 `head_sha` 가 없는 것이 있으면 SKILL.md 「2-3」 「선행 반영 사전 검사」 를 먼저 하고, `NOT_REFLECTED` 면 이번 기상에 띄우지 않는다(12절 Y5 — 다음 기상에 다시 본다) |

````

**U4** — 아래 줄 바로 뒤에 더한다.

```text
   `--resume` 으로만 오므로 사람이 지목한 것으로 보고 진행한다.
```

더할 문구:

```text
   계약 2.11 이면 이 경고 대신 「서버 판단 확인」 의 `mine`·`runner` 로 가른다. `mine` 이 참인데 `runner` 가 다른 PC 면 그 PC 가 30분 넘게
   조용하다는 뜻이므로 "원래 PC 의 세션이 살아 있으면 먼저 끄세요" 만 한 줄 적는다(12절 Y1).
```

**U5** — 아래 줄 바로 뒤에 더한다.

```text
     원격 agent 브랜치가 있으면 detach 하지 않고 그 브랜치로 만든다. 이어서 push 해야 하기 때문이다.
```

더할 문구:

```text
     로컬 agent 브랜치(`agent/<id8>-<slug>`)가 남아 있으면(지운 워크트리의 브랜치) 원격과 견준다(설계 상태 스펙 6.2). 로컬이 원격보다 앞서면
     (원격이 로컬의 조상) `-B` 로 덮지 않고 로컬 브랜치로 만든다(`git worktree add <MAIN>/.claude/worktrees/dflow-<id8> agent/<id8>-<slug>`).
     원격이 앞서거나 같으면 아래 명령 그대로다. 갈라졌으면 만들지 않고 「멈춤」(사유 `브랜치 갈라짐 <로컬 sha> <원격 sha>`)으로 보낸다.
```

- [ ] **Step 7: `design-ahead.md`·`restart.md`·`events.md`·`help.md`·`scope.md` 삭제**

D 는 `design-ahead.md`, S 는 `restart.md`, V1 은 `events.md`, H 는 `help.md`, Q1 은 `scope.md` 다(`git rm` 으로 지운다).

**D1** — 아래 줄 바로 뒤에 더한다.

```text
이 목록뿐이고 상한(아래 `DFLOW_DESIGN_AHEAD_MAX`)이 있어 조회가 적다.
```

더할 문구:

```text
0. 계약 2.11 이면 먼저 `references/resume.md` 「서버 판단 확인」 을 돈다. `action` 이 `wait` 면 아직이다(그대로 둔다). 표가 띄우지 않는다고
   가르면(다른 PC·다른 신원 등) 이 목록과 3번의 상한에서 빼고 「멈춤」 표에 그 사유로 올린다(설계 상태 스펙 12절 Y8).
```

**D2** — 아래 줄 바로 뒤에 더한다.

```text
이유: 빈 슬롯이 셋이면 한 기상에 셋을 띄워 상한을 넘긴 채 설계만 쌓인다.
```

더할 문구:

```text
계약 2.11 이면 설계 완료 대기의 수는 2번 0에서 서버가 claimed·`mine`·단계 `dd` 로 확인한 것만 센다(다른 PC 로 옮긴 옛 잔재가 한도를
차지하지 않게, 12절 Y8). 설계 검토(`review`) 작업의 설계 선행은 이 상한과 무관하다 — poll 이 `action=design` 으로 곧바로 준다(SKILL.md
「2-3」 poll exit 0). 구현자동(`human`)은 서버가 선행이 풀릴 때까지 `wait` 로 둬 후보에 오지 않는다(스펙 6.6).
```

**D3** — 아래 줄 바로 뒤에 더한다.

```text
`resolved` 결과가 올 때까지 다시 고르지 않는다(`TOO_EARLY`) — 안 그러면 30분 일시 제외가 풀릴 때마다 같은 거부를 되풀이한다.
```

더할 문구:

```text
후보의 show(`show-<id8>.json`)에서 미충족 선행의 `stage` 가 `as` 이거나 없으면(선행에 주문이 없다 — 위임되지 않았다) 설계 선행으로 주지
않고 시작·마감 보고에 `<id8> 선행 주문 없음: <ref>` 로 알린다. 서버가 늘 거부해 2시간마다 되풀이하기 때문이다(사람이 선행을 위임하거나
강제 진행한다, 스펙 6.6).
```
**S1** — 아래 원문을 바꾼다.

```text
  재개한다(「판정」 4-1). `wait_review`(설계만·검토 대기)도 재시작하지 않는다(「판정」 4-2, 이어 가기는 `references/scope.md` 「2」).
```

바꿀 문구:

```text
  재개한다(「판정」 4-1). `wait_review`(설계만·검토 대기)도 재시작하지 않는다(「판정」 4-2. 「설계 승인」 뒤에는 SKILL.md 「2-3」 의 `build` 가 이어 가기를 부른다).
```

**S2** — 아래 원문을 바꾼다.

```text
| 4-2 | `local_phase=wait_review` | 설계만 멈춤(멈춤 절차 뒤 결과 줄 없이 끝남) | 같다(오른쪽) | 거두기 → `team.result`(status `design_review`, hash `-`, 사유 `-`) → 슬롯 해제, 워크트리는 SKILL.md 「3. 결과 처리」 `design_review` 행대로. `team.lost` 를 쓰지 않고 재시작하지 않는다 — 이어 가기는 `references/scope.md` 「2」 |
```

바꿀 문구:

```text
| 4-2 | `local_phase=wait_review` | 설계만 멈춤(멈춤 절차 뒤 결과 줄 없이 끝남) | 같다(오른쪽) | 거두기 → `team.result`(status `design_review`, hash `-`, 사유 `-`) → 슬롯 해제, 워크트리는 SKILL.md 「3. 결과 처리」 `design_review` 행대로. `team.lost` 를 쓰지 않고 재시작하지 않는다 — 「설계 승인」 뒤에는 SKILL.md 「2-3」 의 `build` 가 이어 간다. 계약 2.11 이면 거두기 전에 `dflow.sh show <id8>` 의 `.order.design_state` 를 본다. 비어 있으면 멈춤이 서버에 닿지 않은 것이다 — `team.result` 를 쓰지 않고 워크트리를 `parked` 로 두며 「멈춤」(사유 `설계 멈춤 미완료 — /dflow-team <종료시각> --resume <id8> 이 마저 한다`)으로 보낸다(워커의 「끝나지 않은 설계 멈춤 이어받기」 가 push·design-done 을 한다) |
```

**S3** — 아래 줄 바로 뒤에 더한다.

```text
재투입하지 않고 「판정」 4-1·4-2 의 오른쪽 칸대로 처리한다 — 선행이 아직이면 "재개 → 미충족 → 멈춤 → 재개" 가 끝없이 돈다.
```

더할 문구:

```text
계약 2.11 이면 `REINJECT_OK` 뒤에 `references/resume.md` 「서버 판단 확인」 도 통과해야 띄운다(아래 `same_host` 는 옛 서버의 대체 판정으로 남는다).
```
**V1** — 아래 원문을 바꾼다.

```text
  문자열(예: `WP-2,dict/WP-3`)이며 전체면 `-` 다. 재구성이 이 값으로 poll 의 `--wp` 를 복원한다. `scope` 는 실행 범위
  `full`·`design`·`build` 다(SKILL.md 「인자」). 재구성이 `<SCOPE>` 를 복원한다.
```

바꿀 문구:

```text
  문자열(예: `WP-2,dict/WP-3`)이며 전체면 `-` 다. 재구성이 이 값으로 poll 의 `--wp` 를 복원한다. `scope` 는 계약 2.11 팀장이면 늘
  `server` 다(설계 방식은 작업마다 서버 판단, SKILL.md 「인자」). 옛 줄의 `full`·`design`·`build` 는 재구성이 쓰지 않는다.
```

**H1** — 아래 원문을 바꾼다.

```text
/dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…] [설계만|구현부터]
```

바꿀 문구:

```text
/dflow-team [인원] <종료시각|종료 요청 전까지> [모델] [effort] [WP-XX…]
```

**H2** — 아래 원문을 바꾼다.

```text
| 실행 범위 | 아니오 | `설계만` · `구현부터`(`개발자동`) | 설계만 하고 검토 대기로 멈추거나, 검토를 마친 설계·개발 브랜치의 사람 설계(`<작업 폴더>/design.md`)로 구현한다. 없으면 설계부터 마감까지 |
```

바꿀 문구:

```text
| 설계 방식 | — | (인자가 아니다) | 완전자동·설계 검토·구현자동은 D'Flow WBS 작업 패널에서 작업마다 고른다. 팀장은 작업마다 서버 판단을 따른다(옛 인자 `설계만`·`구현부터` 는 받지 않는다) |
```

**H3** — 아래 원문을 지운다(그 줄을 통째로).

```text
/dflow-team 18:00 설계만                설계까지만 하고 검토를 기다린다
/dflow-team 18:00 구현부터              검토를 마친 설계·사람이 쓴 설계로 구현
```

**Q1** — 파일을 지운다.

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-team-merge-conflict.test.ts tests/skills/dflow-team-restart-flow.test.ts tests/skills/dflow-team.test.ts tests/skills/dflow-team-design-ahead.test.ts tests/skills/dflow-team-restart-blocks.test.ts tests/skills/dflow-no-docker.test.ts tests/skills/dflow-key-select.test.ts`
Expected: PASS(220건)

Run: `npx vitest run tests/skills`
Expected: Task 0 기준선에 없던 실패가 없다.

- [ ] **Step 9: 커밋**

```bash
git rm -q .claude/skills/dflow-team/references/scope.md
git add .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/design-state.md .claude/skills/dflow-team/references/resume.md \
  .claude/skills/dflow-team/references/design-ahead.md .claude/skills/dflow-team/references/restart.md \
  .claude/skills/dflow-team/references/events.md .claude/skills/dflow-team/references/help.md \
  tests/skills/dflow-dev-scope.test.ts tests/skills/dflow-team-merge-conflict.test.ts tests/skills/dflow-team-restart-flow.test.ts tests/skills/dflow-team.test.ts
git commit -m "feat(dflow-team): 범위 인자를 없애고 작업마다 서버 판단을 따른다(계약 2.11)

이어 갈지는 resume.md 「서버 판단 확인」 표 한 곳이 막고, 새로 여는 길은 「설계 승인」 된 작업의 원격 재개 하나다.
설계 사전 검사·build 처리·결과 보충은 design-state.md 로 옮겨 재독 세트를 5만 자 안에 둔다. scope.md 는 지운다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
