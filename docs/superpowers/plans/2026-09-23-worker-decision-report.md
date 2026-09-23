# 워커 결정 보고 (과제 C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워커가 멈추지 않고 스스로 고른 결정을 완료 보고의 구조화 필드(`decisions`)로 실어, 승인 큐·Task 사이드바·오피스·결재 배지 네 곳에서 승인자에게 드러낸다.

**Architecture:** `agent_work_reports` 에 nullable jsonb `decisions` 와 생성 컬럼 `decision_count` 를 더한다(0102). 보고 라우트가 PAT completion 에서만 `decisions` 를 받아 순수 함수 `validateDecisions` 로 fail-loud 검증한 뒤 보고 행과 한 insert 로 저장하고, `dflow.sh done --decisions <file>` 이 같은 규칙으로 먼저 검사해 보낸다. 화면은 순수 파서 `parseDecisions` 와 표시 전용 `DecisionList` 를 공유하고, 좌석표·결재 배지는 본문 대신 `decision_count` 만 읽는다.

**Tech Stack:** Postgres(jsonb·stored generated column) · Next.js 15 route handler·server action · supabase-js · React(client component) · Tailwind v4 · POSIX sh + jq + curl · vitest(jsdom)

**Spec:** `docs/superpowers/specs/2026-09-23-worker-decision-report-design.md`

**미결 처리** (스펙 §14 — 스펙이 제시한 기본안, 가장 보수적인 쪽으로 정한다):
1. 알림 문구 — 별도 알림 유형을 만들지 않고 `work.reported` 의 detail 문구만 `… · 확인 필요 결정 N건` 으로 바꾼다(§4.1).
2. 승인 버튼 마찰 — 넣지 않는다. 펼친 목록과 칩만 둔다. 스테이징에서 본 뒤 따로 정한다.
3. 상한 값 — 스펙 값 그대로 쓴다: 20건 · question 300 · option 200 · rationale 1000 · on_reject 500자, 선택지 2~6개. 착수 때 재측정·조정하지 않는다.
4. supervised `[]` 규칙 — 스펙대로 supervised(플래그 없음) `/dflow-dev` 도 `--decisions` 에 `[]` 를 넘긴다. `null` 은 "구 도구" 한 뜻만 갖는다.

**스펙에서 바꾼 점 한 가지(명시):** §3.2 의 CHECK 식 `decisions is null or (jsonb_typeof(decisions) = 'array' and jsonb_array_length(decisions) <= 20 and kind = 'completion')` 는 Postgres 가 `AND` 의 평가 순서를 보장하지 않아, 배열이 아닌 값에서 `jsonb_array_length` 가 먼저 돌면 23514 대신 22023 이 난다. §3.2 가 생성 컬럼에서 피하려던 바로 그 문제다. 같은 뜻을 `CASE` 로 적어 평가 순서를 고정한다(Task 1).

## Global Constraints

- 반영은 **origin/staging 까지**다. main push·운영 DB(`--target prod`) 적용·dflow-kit 재빌드는 하지 않는다.
- 작업 위치는 워크트리 `/Users/jji/project/wbs-web-decision`(브랜치 `feat/worker-decision-report`, 기점 `origin/staging` a8eabc6d)다. 메인 체크아웃 `/Users/jji/project/wbs-web` 는 병렬 세션이 쓰므로 건드리지 않는다.
- `git add -A`·`git add .` 금지. 항상 파일명을 명시해 stage 한다.
- **마이그레이션 파일(`supabase/migrations/*`)과 코드·테스트는 다른 커밋**이다(G1). 마이그레이션 커밋에는 0102 두 파일만 넣는다.
- 새 마이그레이션에는 `_rollback.sql` 을 같이 만든다. 번호는 **0102 고정**(0103 은 강제 진행 과제 몫).
- 마이그레이션은 스테이징 리허설 후 트레일러 `Staging-verified:` 를 단 커밋을 남긴다(G4). 적용은 `npm run db:apply -- <sql파일> --target staging`(인자 순서 무관). `supabase db push` 는 쓰지 않는다. `npm run staging:sync` 는 돌리지 않는다(판단 근거는 Task 10).
- **반영 순서는 DB 먼저, 코드 나중**(스펙 D11·§9). 스테이징 DB 에 0102 를 적용하기 전에 코드를 origin/staging 에 push 하지 않는다 — 허브 조회가 없는 컬럼을 select 해 에이전트 화면 전체가 죽는다.
- 커밋 메시지는 한국어("무엇"보다 "왜"). 모든 커밋(빈 트레일러 커밋 포함) 끝에 다음 두 줄을 단다:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
  ```
- 권한 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/index.ts`(가드)에서만 한다. 새 액션은 기존 가드 `requireProjectMember(pid)` 만 부르고 역할 문자열을 적지 않는다.
- 에러 3원칙: 조회 실패를 "데이터 없음"으로 위장하지 않는다(표시 = 로깅), 쓰기 전 선행 조회 실패면 중단, 보안 가드는 fail-closed. **이 과제에서는 "모름을 0건으로 보이지 않는다"** — `null`(미제출)·형식 오류·조회 실패는 각각 다른 문구이고, 0건은 `[]` 가 명시될 때만이다.
- 결정 항목 상한(서버·CLI 공통, 스펙 §3.3): 배열 ≤ **20**건, `key` = `^D[1-9][0-9]?$`·보고 안에서 유일, `question` trim 뒤 **1~300**자, `options` **2~6**개·각 trim 뒤 **1~200**자, `chosen` 정수 `0 ≤ chosen < options.length`, `rationale` **1~1000**자, `on_reject` **1~500**자, 알 수 없는 필드는 400. 글자 수는 **코드포인트**로 센다(서버 `Array.from(s).length` = jq `length`).
- 계약 버전은 **2.5 → 2.6**(additive): `src/lib/agent/externalApi.ts` `AGENT_CONTRACT_VERSION`, `.claude/skills/dflow-work/scripts/dflow.sh` `CONTRACT_VERSION`, `.claude/skills/dflow-work/references/api-contract.md`.
- 화면의 에이전트 입력(결정 본문)은 React 텍스트 노드 + `whitespace-pre-wrap` 으로만 그린다. `dangerouslySetInnerHTML`·마크다운 렌더러 금지. 머리에 "에이전트가 적은 결정" 을 표기한다.
- `src/components/app/*`(`Sidebar.tsx`·`ShellStateProvider.tsx`)는 UI 위험 파일이다. 이 계획에서는 같은 feat 브랜치로 진행하고, staging 반영 전에 feat 브랜치를 origin 에 한 번 push 해 Preview 기록을 남긴다(G2 는 main 만 막으므로 staging push 는 통과한다). main 머지는 범위 밖이다.
- CSS 안전망 규칙: `group-hover:flex` 같은 상태 변형 display 유틸을 쓰지 않는다(`tests/css/breakpoint-safety-net.test.ts`).
- 셸은 POSIX sh(`dflow.sh` 는 `#!/bin/sh`). bash 전용 문법 금지. **토큰·PAT 값을 출력·로그·파일에 남기지 않는다** — 테스트 토큰은 가짜 문자열만 쓴다.
- 작업 폴더 표기: 이 기점(origin/staging a8eabc6d)의 문서는 `docs/tasks/{TSK}/`(worker-prompt)·`docs/tasks/<TSK>/`(dflow-dev)를 쓴다. 이 계획의 문서 수정도 그 표기를 따른다. Task 10 의 back-merge 에서 origin/staging 이 `{TASK_DIR}` 표기나 `**/tasks/*/.result` exclude 패턴으로 바뀌어 있으면, 이 과제가 더한 줄(`decisions.json` 경로·exclude 패턴)을 그 표기로 고쳐 맞춘다. 문서 테스트는 경로 전체가 아니라 `decisions.json`·`--decisions`·`[]` 규칙 문구만 단정하므로 표기가 바뀌어도 깨지지 않는다.
- 테스트 러너는 vitest(`npx vitest run <path>`), 린트 `npm run lint`, 타입 `npx tsc --noEmit -p .`(tsconfig 가 `tests/**` 도 포함한다 — 픽스처 타입도 맞춰야 한다).

## Review Focus

- **한국어 경계 길이**: `question` 이 한글 정확히 300자면 통과, 301자면 400 이어야 하고, CLI 선검사도 같은 경계에서 갈려야 한다(서버는 코드포인트, jq `length` 도 코드포인트). → Task 2 `validateDecisions` 경계 테스트, Task 8 CLI 경계 테스트.
- **공백만 있는 문자열**: `question: "   "` 은 trim 뒤 0자라 서버·CLI 모두 거부해야 한다(형식은 문자열이라 통과시키기 쉽다). → Task 2·Task 8 테스트.
- **에이전트가 적은 `<script>`·마크다운**: rationale 의 `<script>alert(1)</script>`·`**굵게**` 가 글자 그대로 보이고 요소가 생기지 않아야 한다. → Task 4 `DecisionList` 테스트.
- **반려 뒤 재작업한 주문**: 옛 completion(결정 3건, 반려됨)과 새 completion(결정 1건)이 같이 있으면 좌석 칩·결재 배지는 **최신 completion 의 1** 이어야 한다(합산 4 가 아니다). → Task 6 좌석표 테스트, Task 7 결재 수 테스트.
- **구 CLI 보고가 섞인 결재 대기**: 구 CLI 주문(`decision_count` null) 1건 + 결정 2건 주문 1건이면 툴팁은 `확인 필요 결정 2건 이상 · 일부 구버전 보고` 여야 한다(0 으로 세거나 "2건" 으로 단정하면 안 된다). → Task 7 결재 수·사이드바 테스트.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `supabase/migrations/0102_agent_report_decisions.sql` · `_rollback.sql` | `decisions` jsonb + CHECK + `decision_count` 생성 컬럼 | 1 |
| `tests/migrations/0102-agent-report-decisions.test.ts` | 마이그레이션 문안 검사 | 1 |
| `scripts/checks/0102_report_decisions_check.sql` | 스테이징 동작 검증(롤백되는 트랜잭션, 23514 단정) | 1 |
| `src/lib/domain/agentWork.ts` | 상한 상수·`AgentDecision`·`DecisionsParse`·`validateDecisions`·`parseDecisions` | 2 |
| `tests/domain/agent-work-decisions.test.ts` | 검증·파서 경계 | 2 |
| `src/app/api/v1/agent/work/[id]/report/route.ts` | `decisions` 수신·저장·응답·알림 문구 | 3 |
| `src/app/api/v1/agent/work/[id]/route.ts` | PAT `reports[].decisions` 노출 | 3 |
| `src/lib/agent/externalApi.ts` · `tests/agent/me-route.test.ts` | 계약 2.6 | 3 |
| `tests/agent/report-decisions.test.ts` · `tests/agent/work-routes-pat.test.ts` | 라우트 | 3 |
| `src/components/agent-hub/DecisionList.tsx` | 공통 표시 부품 | 4 |
| `src/lib/data/agentHub.ts` · `src/lib/domain/agentHub.ts` | 큐 항목에 결정 상태 | 4 |
| `src/components/agent-hub/ApprovalQueue.tsx` | 칩·목록·반려 안내 | 4 |
| `tests/components/decision-list.test.tsx` · `tests/domain/agent-hub.test.ts` · `tests/components/agent-hub-queue.test.tsx` | 화면·조립 | 4 |
| `src/app/actions/agentWork.ts` | `getAgentOrderForItem` select 확장 + 새 액션 `getReportDecisions` | 5 |
| `src/components/wbs/WbsSpecPanel.tsx` | 보고 이력의 결정(최신 펼침·옛 회차 접힘) | 5 |
| `tests/actions/agent-report-decisions.test.ts` · `tests/components/wbs-agent-order-decisions.test.tsx` | 액션·사이드바 | 5 |
| `src/lib/domain/seatmap.ts` · `src/lib/data/agentSeatmap.ts` | `decisionCount` | 6 |
| `src/components/agents/DecisionChip.tsx` · `Seat.tsx` · `LaneBoard.tsx` | 칩 | 6 |
| `src/components/agents/SeatDecisions.tsx` · `DetailPanel.tsx` | 상세 패널 목록(좁은 조회·재시도) | 6 |
| `tests/domain/seatmap-decisions.test.ts` · `tests/components/agents-decisions.test.tsx` · 기존 `agents-detail-panel`·`agents-seatmap-view` 테스트의 mock 한 줄 | 오피스 | 6 |
| `src/lib/data/agentApprovals.ts` · `src/app/api/shell/route.ts` | 결재 대기 결정 수 | 7 |
| `src/components/app/ShellStateProvider.tsx` · `src/components/app/Sidebar.tsx` | 툴팁·점(UI 위험 파일) | 7 |
| `tests/data/agent-approvals.test.ts` · `tests/ui/sidebar-approval-badge.test.tsx` | 결재 수·배지 | 7 |
| `.claude/skills/dflow-work/scripts/dflow.sh` | `done --decisions`·선검사·경고·계약 2.6 | 8 |
| `.claude/skills/dflow-work/references/api-contract.md` | 계약 문서 2.6 | 8 |
| `tests/skills/dflow-done-decisions.test.ts` | 가짜 curl 로 CLI 검증 | 8 |
| `.claude/skills/dflow-team/references/worker-prompt.md` · `.claude/skills/dflow-dev/SKILL.md` | 워커 규칙: D 번호·decisions.json·0건 `[]` | 9 |
| `.claude/skills/dflow-work/SKILL.md` · `README.md` · `references/troubleshooting.md` | `--decisions` 사용 예·경고 뜻 | 9 |
| `.claude/skills/dflow-team/SKILL.md` | `info/exclude` 에 `docs/tasks/*/decisions.json` | 9 |
| `tests/skills/worker-decide-and-notify.test.ts` · `tests/skills/dflow-team.test.ts` | 문서 검사 | 9 |

**Task 의존과 병렬:** 1(DB 문안)과 2(도메인)는 서로 독립이다. 3·4·7·8 은 2 의 이름(`validateDecisions`·`parseDecisions`·`DecisionsParse`·상한 상수)만 쓰므로 **2 뒤에 병렬 가능**하다(7 은 2 에도 기대지 않아 1 과 함께 언제든 가능). 5 는 4 의 `DecisionList` 를 쓰므로 4 뒤, 6 은 5 가 만드는 액션 `getReportDecisions` 를 쓰므로 **5 뒤**다(5·6 은 병렬 불가). 한 구현자가 순서대로 도는 기본 경로는 1→2→3→4→5→6→7→8→9→10 이다. 9 는 8 뒤(명령·경고 문구를 인용한다). 10 은 모두 끝난 뒤다.

---

### Task 0: 워크트리 확인 (컨트롤러가 직접)

- [ ] **Step 1: 위치·브랜치 확인**

```bash
cd /Users/jji/project/wbs-web-decision
git branch --show-current          # feat/worker-decision-report
git fetch -q origin
git merge-base --is-ancestor origin/staging HEAD && echo BASE_OK
ls node_modules >/dev/null 2>&1 || npm ci --silent
```

Expected: `feat/worker-decision-report`, `BASE_OK`.

- [ ] **Step 2: 기준선**

Run: `npx vitest run tests/agent tests/domain tests/data tests/skills tests/components tests/ui tests/actions tests/migrations 2>&1 | tail -5`
Expected: 실패 0. 실패가 있으면 이 과제 전의 것인지 기록해 두고 시작한다(뒤 Task 가 새로 깨뜨린 것과 구분하기 위해).

---

### Task 1: 마이그레이션 0102 — `decisions` 와 `decision_count`

**Files:**
- Create: `supabase/migrations/0102_agent_report_decisions.sql`
- Create: `supabase/migrations/0102_agent_report_decisions_rollback.sql`
- Create: `scripts/checks/0102_report_decisions_check.sql`
- Test: `tests/migrations/0102-agent-report-decisions.test.ts`

**Interfaces:**
- Produces (DB):
  - `public.agent_work_reports.decisions jsonb` — nullable. `null` = 제출 안 됨, `[]` = 0건 명시.
  - CHECK `agent_work_reports_decisions_shape` — `decisions` 가 null 이 아니면 배열·길이 ≤ 20·`kind = 'completion'`. 위반은 SQLSTATE 23514.
  - `public.agent_work_reports.decision_count int` — stored 생성 컬럼. 배열이면 길이, 아니면 null.
  - 권한: 0057 의 RLS `read_agent_work_reports` 와 table-level `grant select … to authenticated` 가 새 컬럼을 그대로 덮는다(새 정책·grant 없음).

- [ ] **Step 1: 실패하는 문안 테스트 작성**

`tests/migrations/0102-agent-report-decisions.test.ts`:

```ts
// 0102 — 워커가 고른 결정 목록(과제 C). 문안만 검사한다. 실제 CHECK·생성 컬럼 동작은
// scripts/checks/0102_report_decisions_check.sql 이 스테이징에서 검증한다(Task 10).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0102_agent_report_decisions.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0102_agent_report_decisions_rollback.sql'), 'utf8')

describe('0102 — agent_work_reports.decisions', () => {
  it('decisions 는 nullable jsonb 다 — default 를 두지 않는다(0건과 모름을 가르기 위해, 스펙 D2)', () => {
    const s = up()
    expect(s).toMatch(/add column if not exists decisions jsonb;/)
    expect(s).not.toMatch(/decisions jsonb[^;]*default/i)
    expect(s).not.toMatch(/decisions jsonb[^;]*not null/i)
  })
  it('CHECK 는 CASE 로 평가 순서를 고정한다 — 배열이 아닌 값이 22023 이 아니라 23514 로 거부되게', () => {
    const s = up()
    expect(s).toContain('add constraint agent_work_reports_decisions_shape check')
    expect(s).toMatch(/case when jsonb_typeof\(decisions\) = 'array'\s+then jsonb_array_length\(decisions\) <= 20 and kind = 'completion'\s+else false end/)
  })
  it('decision_count 는 jsonb_typeof 로 감싼 stored 생성 컬럼이다', () => {
    const s = up()
    expect(s).toMatch(/add column if not exists decision_count int\s+generated always as \(case when jsonb_typeof\(decisions\) = 'array' then jsonb_array_length\(decisions\) end\) stored/)
  })
  it('새 정책·grant 를 만들지 않는다 — 0057 의 RLS·table-level grant 가 덮는다', () => {
    const s = up()
    // 문(statement) 줄만 본다 — 머리 주석이 "grant select" 를 설명으로 인용한다.
    expect(s).not.toMatch(/^\s*create policy/im)
    expect(s).not.toMatch(/^\s*(grant|revoke)\b/im)
  })
  it('기존 행을 소급해 채우지 않는다(스펙 D8)', () => {
    expect(up()).not.toMatch(/update public\.agent_work_reports/i)
  })
  it('롤백은 생성 컬럼 → 제약 → 컬럼 순으로 지운다', () => {
    const s = down()
    const a = s.indexOf('drop column if exists decision_count')
    const b = s.indexOf('drop constraint if exists agent_work_reports_decisions_shape')
    const c = s.indexOf('drop column if exists decisions;')
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/migrations/0102-agent-report-decisions.test.ts`
Expected: FAIL (ENOENT — 파일 없음)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0102_agent_report_decisions.sql`:

```sql
-- 0102: agent_work_reports.decisions — 워커가 스스로 고른 결정 목록(과제 C,
-- docs/superpowers/specs/2026-09-23-worker-decision-report-design.md §3).
-- null = 제출 안 됨(구 CLI·구 서버·수동 보고), [] = 0건 명시. default 를 두지 않는다 — 두면 "0건" 과 "모름" 이 같아진다.
-- 항목 모양 검증은 앱(validateDecisions, src/lib/domain/agentWork.ts)이 한다(0073 evidence 와 같은 분담).
-- CHECK 는 CASE 로 쓴다: Postgres 는 AND 의 평가 순서를 보장하지 않아, 배열이 아닌 값에서 jsonb_array_length 가
-- 먼저 돌면 23514 대신 22023 으로 거부된다(스펙 §3.2 식에서 바꾼 점).
-- 권한: 0057 의 read_agent_work_reports 정책과 table-level grant select 가 새 컬럼을 그대로 덮는다. 쓰기는 service_role 뿐.
begin;
alter table public.agent_work_reports
  add column if not exists decisions jsonb;
alter table public.agent_work_reports
  drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports
  add constraint agent_work_reports_decisions_shape check (
    decisions is null
    or case when jsonb_typeof(decisions) = 'array'
         then jsonb_array_length(decisions) <= 20 and kind = 'completion'
         else false end
  );
-- 좌석표(주문 최대 2000건)·결재 배지는 수만 필요하다 — jsonb 본문을 끌어오지 않게 한다.
-- decisions 가 null 이면 decision_count 도 null 이라 "모름" 을 그대로 잇는다.
alter table public.agent_work_reports
  add column if not exists decision_count int
  generated always as (case when jsonb_typeof(decisions) = 'array' then jsonb_array_length(decisions) end) stored;
commit;
```

`supabase/migrations/0102_agent_report_decisions_rollback.sql`:

```sql
-- 0102 rollback — 생성 컬럼이 decisions 에 기대므로 먼저 지운다.
begin;
alter table public.agent_work_reports drop column if exists decision_count;
alter table public.agent_work_reports drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports drop column if exists decisions;
commit;
```

- [ ] **Step 4: 동작 검증 SQL 작성**

`scripts/checks/0102_report_decisions_check.sql` — 스테이징에서 돌려 실패하면 예외로 멈추고, 끝에 롤백해 흔적을 남기지 않는다. 기존 주문에 기대지 않고 트랜잭션 안에서 버릴 주문을 하나 만든다.

```sql
-- scripts/checks/0102_report_decisions_check.sql — 0102 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0102_report_decisions_check.sql --target staging
-- CHECK 위반은 check_violation(23514)만 잡는다. 그 밖의 SQLSTATE(예: 22023)는 그대로 올라가 검증 실패가 된다.
begin;
do $$
declare
  p uuid; o uuid; r uuid;
  d2 jsonb := '[{"key":"D1","question":"q","options":["a","b"],"chosen":0,"rationale":"r","on_reject":"x"},
                {"key":"D2","question":"q","options":["a","b"],"chosen":1,"rationale":"r","on_reject":"x"}]';
  d21 jsonb;
begin
  select id into p from public.projects order by created_at limit 1;
  assert p is not null, '검증용 프로젝트가 없다';
  -- status 는 기본값(ready)으로 둔다 — 보고 CHECK 는 주문 상태와 무관하고, claimed 로 만들면 점유 컬럼 제약에 걸릴 수 있다.
  insert into public.agent_work_orders (project_id) values (p) returning id into o;
  select jsonb_agg(jsonb_build_object('key', 'D' || g)) into d21 from generate_series(1, 21) as g;

  -- 1. 제출 안 됨(null) → decision_count null
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent)
    values (o, 'completion', 100, 's', 'chk-0102') returning id into r;
  assert (select decisions is null and decision_count is null from public.agent_work_reports where id = r),
    'null 행의 decision_count 가 null 이 아니다';
  -- 2. 0건 명시([]) → 0
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
    values (o, 'completion', 100, 's', 'chk-0102', '[]'::jsonb) returning id into r;
  assert (select decision_count = 0 from public.agent_work_reports where id = r), '[] 행의 decision_count 가 0 이 아니다';
  -- 3. 2건 → 2
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
    values (o, 'completion', 100, 's', 'chk-0102', d2) returning id into r;
  assert (select decision_count = 2 from public.agent_work_reports where id = r), '2건 행의 decision_count 가 2 가 아니다';
  -- 4. 객체 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', '{"a":1}'::jsonb);
    raise exception '객체 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 5. 스칼라 문자열 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', '"x"'::jsonb);
    raise exception '문자열 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 6. 21건 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', d21);
    raise exception '21건 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 7. progress 행의 decisions → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'progress', 10, 's', 'chk-0102', '[]'::jsonb);
    raise exception 'progress 행에 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 8. 세션 읽기 경로(Task 사이드바·오피스 상세)가 새 컬럼을 읽을 수 있다 — 0057 의 table-level grant 가 덮는다.
  assert has_column_privilege('authenticated', 'public.agent_work_reports', 'decisions', 'SELECT'), 'authenticated 가 decisions 를 못 읽는다';
  assert has_column_privilege('authenticated', 'public.agent_work_reports', 'decision_count', 'SELECT'), 'authenticated 가 decision_count 를 못 읽는다';
  raise notice 'REPORT_DECISIONS_CHECK_OK';
end $$;
rollback;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/0102-agent-report-decisions.test.ts && npx vitest run tests/migrations`
Expected: 새 파일 6건 PASS. `tests/migrations` 전체(롤백 파일 존재 강제 검사 포함)도 PASS.

- [ ] **Step 6: 커밋 (마이그레이션 단독 → 테스트·검증 SQL)**

```bash
git add supabase/migrations/0102_agent_report_decisions.sql supabase/migrations/0102_agent_report_decisions_rollback.sql
git commit -F - <<'MSG'
feat(db): 0102 완료 보고에 워커 결정 목록 컬럼을 더한다

워커가 멈추지 않고 고른 결정이 요약 문장 끝에 묻혀 승인자에게 닿지 않았다.
nullable jsonb 로 두어 "제출 안 됨(null)" 과 "0건([])" 을 가르고, 좌석표·결재 배지가
본문 없이 수만 읽도록 stored 생성 컬럼 decision_count 를 같이 둔다.
CHECK 는 CASE 로 평가 순서를 고정해 배열이 아닌 값이 23514 로 거부되게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
git add tests/migrations/0102-agent-report-decisions.test.ts scripts/checks/0102_report_decisions_check.sql
git commit -F - <<'MSG'
test(db): 0102 문안 검사와 스테이징 동작 검증 SQL 을 둔다

CHECK 위반이 22023 이 아니라 23514 로 나는지를 스테이징에서 단정한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 2: 도메인 — `validateDecisions` · `parseDecisions`

**Files:**
- Modify: `src/lib/domain/agentWork.ts` (끝의 `resumeHostFromClaimLabel` 뒤에 덧붙인다)
- Test: `tests/domain/agent-work-decisions.test.ts`

**Interfaces:**
- Produces (`@/lib/domain/agentWork`):
  - 상수 `AGENT_DECISIONS_MAX = 20`, `AGENT_DECISION_OPTIONS_MIN = 2`, `AGENT_DECISION_OPTIONS_MAX = 6`, `AGENT_DECISION_QUESTION_MAX = 300`, `AGENT_DECISION_OPTION_MAX = 200`, `AGENT_DECISION_RATIONALE_MAX = 1000`, `AGENT_DECISION_ON_REJECT_MAX = 500`
  - `interface AgentDecision { key: string; question: string; options: string[]; chosen: number; rationale: string; on_reject: string }`
  - `type DecisionsParse = { state: 'none' } | { state: 'ok'; items: AgentDecision[] } | { state: 'invalid' }`
  - `validateDecisions(raw: unknown): { ok: true; decisions: AgentDecision[] | null } | { ok: false; error: string }` — `undefined` → `{ ok: true, decisions: null }`. 그 밖(명시적 `null` 포함)은 배열이어야 한다. 성공 시 문자열은 trim 된 값.
  - `parseDecisions(raw: unknown): DecisionsParse` — `null`·`undefined` → `none`, 검증 통과 → `ok`, 그 밖 → `invalid`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/agent-work-decisions.test.ts`:

```ts
// 결정 목록 검증·파서(과제 C, 스펙 §3.3·§7). 서버 400 사유와 화면 상태가 여기서 정해진다.
import { describe, expect, it } from 'vitest'
import {
  AGENT_DECISIONS_MAX, AGENT_DECISION_QUESTION_MAX, parseDecisions, validateDecisions,
} from '@/lib/domain/agentWork'

const item = (over: Record<string, unknown> = {}) => ({
  key: 'D1', question: '판정 로직을 넣는가?', options: ['넣지 않는다', '넣는다'], chosen: 0,
  rationale: 'spec 이 넣지 않는다고 적었다.', on_reject: '판정 로직을 옮긴다.', ...over,
})
const err = (raw: unknown) => {
  const r = validateDecisions(raw)
  if (r.ok) throw new Error('통과하면 안 된다')
  return r.error
}

describe('validateDecisions — 모양', () => {
  it('필드가 없으면(undefined) 제출 안 됨 = null', () => {
    expect(validateDecisions(undefined)).toEqual({ ok: true, decisions: null })
  })
  it('[] 는 0건 명시로 통과한다', () => {
    expect(validateDecisions([])).toEqual({ ok: true, decisions: [] })
  })
  it('명시적 null·객체·문자열은 배열이 아니라 400', () => {
    expect(err(null)).toBe('decisions는 배열이어야 합니다.')
    expect(err({})).toBe('decisions는 배열이어야 합니다.')
    expect(err('D1')).toBe('decisions는 배열이어야 합니다.')
  })
  it('20건은 통과, 21건은 400', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item({ key: `D${i + 1}` }))
    expect(validateDecisions(many(AGENT_DECISIONS_MAX)).ok).toBe(true)
    expect(err(many(21))).toBe('decisions는 20건 이하여야 합니다.')
  })
  it('원소가 객체가 아니면 경로를 담은 400', () => {
    expect(err([item(), 'x'])).toBe('decisions[1]는 객체여야 합니다.')
    expect(err([[1]])).toBe('decisions[0]는 객체여야 합니다.')
  })
  it('알 수 없는 필드는 400(evidence 와 같은 규칙)', () => {
    expect(err([item({ note: 'x' })])).toBe('decisions[0]에 알 수 없는 필드: note')
  })
})

describe('validateDecisions — key', () => {
  it.each(['D1', 'D9', 'D10', 'D99'])('%s 는 통과', k => {
    expect(validateDecisions([item({ key: k })]).ok).toBe(true)
  })
  it.each(['D0', 'D100', 'd1', ' D1', '1', 'D01', 7])('%s 는 400', k => {
    expect(err([item({ key: k })])).toBe('decisions[0].key는 D1~D99 형식이어야 합니다.')
  })
  it('보고 안에서 중복되면 400', () => {
    expect(err([item(), item()])).toBe('decisions[1].key가 중복됩니다: D1')
  })
})

describe('validateDecisions — 글자 수·trim(코드포인트)', () => {
  it('한글 300자 question 은 통과, 301자는 400', () => {
    expect(validateDecisions([item({ question: '가'.repeat(AGENT_DECISION_QUESTION_MAX) })]).ok).toBe(true)
    expect(err([item({ question: '가'.repeat(301) })])).toBe('decisions[0].question은 1~300자여야 합니다.')
  })
  it('서로게이트 쌍(이모지)은 한 글자로 센다 — jq length 와 같은 축', () => {
    expect(validateDecisions([item({ question: '😀'.repeat(300) })]).ok).toBe(true)
  })
  it('공백만 있는 문자열은 trim 뒤 0자라 400', () => {
    expect(err([item({ question: '   ' })])).toBe('decisions[0].question은 1~300자여야 합니다.')
    expect(err([item({ rationale: '\n\t ' })])).toBe('decisions[0].rationale은 1~1000자여야 합니다.')
    expect(err([item({ on_reject: ' ' })])).toBe('decisions[0].on_reject는 1~500자여야 합니다.')
    expect(err([item({ options: ['a', ' '] })])).toBe('decisions[0].options[1]는 1~200자여야 합니다.')
  })
  it('rationale 1000·on_reject 500·option 200 경계', () => {
    expect(validateDecisions([item({ rationale: 'r'.repeat(1000), on_reject: 'o'.repeat(500), options: ['a'.repeat(200), 'b'] })]).ok).toBe(true)
    expect(err([item({ rationale: 'r'.repeat(1001) })])).toBe('decisions[0].rationale은 1~1000자여야 합니다.')
    expect(err([item({ on_reject: 'o'.repeat(501) })])).toBe('decisions[0].on_reject는 1~500자여야 합니다.')
    expect(err([item({ options: ['a'.repeat(201), 'b'] })])).toBe('decisions[0].options[0]는 1~200자여야 합니다.')
  })
  it('저장 값은 trim 된 문자열이다', () => {
    const r = validateDecisions([item({ question: '  질문  ', options: [' 가 ', '나 '], rationale: ' 근거 ', on_reject: ' 방향 ' })])
    expect(r).toEqual({ ok: true, decisions: [{ key: 'D1', question: '질문', options: ['가', '나'], chosen: 0, rationale: '근거', on_reject: '방향' }] })
  })
})

describe('validateDecisions — options·chosen', () => {
  it('선택지 1개·7개는 400, 2개·6개는 통과', () => {
    expect(err([item({ options: ['a'] })])).toBe('decisions[0].options는 2~6개여야 합니다.')
    expect(err([item({ options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })])).toBe('decisions[0].options는 2~6개여야 합니다.')
    expect(validateDecisions([item({ options: ['a', 'b', 'c', 'd', 'e', 'f'], chosen: 5 })]).ok).toBe(true)
    expect(err([item({ options: 'a,b' })])).toBe('decisions[0].options는 2~6개여야 합니다.')
  })
  it('chosen 은 정수 색인 — 문자열·소수는 400', () => {
    expect(err([item({ chosen: '넣지 않는다' })])).toBe('decisions[0].chosen은 정수여야 합니다.')
    expect(err([item({ chosen: 0.5 })])).toBe('decisions[0].chosen은 정수여야 합니다.')
  })
  it('chosen 이 범위 밖이면 400', () => {
    expect(err([item({ chosen: 2 })])).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(err([item({ chosen: -1 })])).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
  })
})

describe('parseDecisions — 화면 상태', () => {
  it('null·undefined 는 none(제출 안 됨)', () => {
    expect(parseDecisions(null)).toEqual({ state: 'none' })
    expect(parseDecisions(undefined)).toEqual({ state: 'none' })
  })
  it('유효한 배열은 ok, [] 도 ok(0건)', () => {
    expect(parseDecisions([])).toEqual({ state: 'ok', items: [] })
    expect(parseDecisions([item()])).toMatchObject({ state: 'ok', items: [{ key: 'D1', chosen: 0 }] })
  })
  it('깨진 항목·배열 아닌 값은 invalid(0건으로 위장하지 않는다)', () => {
    expect(parseDecisions([item({ chosen: 9 })])).toEqual({ state: 'invalid' })
    expect(parseDecisions({ a: 1 })).toEqual({ state: 'invalid' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/domain/agent-work-decisions.test.ts`
Expected: FAIL — `validateDecisions is not a function`(export 없음)

- [ ] **Step 3: 구현**

`src/lib/domain/agentWork.ts` 끝에 덧붙인다:

```ts
// ---- 워커 결정 목록(과제 C, 스펙 2026-09-23-worker-decision-report-design.md §3.3) ----
// 상한은 DB CHECK(0102, 20건)·CLI 선검사(dflow.sh DECISION* 변수)와 같다. 대조는 tests/skills/dflow-done-decisions.test.ts.
export const AGENT_DECISIONS_MAX = 20
export const AGENT_DECISION_OPTIONS_MIN = 2
export const AGENT_DECISION_OPTIONS_MAX = 6
export const AGENT_DECISION_QUESTION_MAX = 300
export const AGENT_DECISION_OPTION_MAX = 200
export const AGENT_DECISION_RATIONALE_MAX = 1000
export const AGENT_DECISION_ON_REJECT_MAX = 500
const DECISION_KEY_RE = /^D[1-9][0-9]?$/
const DECISION_FIELDS = new Set(['key', 'question', 'options', 'chosen', 'rationale', 'on_reject'])

/** 워커가 기본값 없는 분기에서 스스로 고른 결정 하나. chosen 은 options 의 색인이다(문구 일치 검증을 피한다, D4). */
export interface AgentDecision {
  key: string; question: string; options: string[]; chosen: number; rationale: string; on_reject: string
}
/** 화면용 상태 — none = 제출 안 됨(구 CLI·구 서버), ok = 형식 통과(0건 포함), invalid = 저장 값이 앱 규칙을 어김. */
export type DecisionsParse = { state: 'none' } | { state: 'ok'; items: AgentDecision[] } | { state: 'invalid' }

/** trim 뒤 코드포인트 1~max 자면 trim 값, 아니면 null. jq 의 length 와 같은 축으로 센다(CLI 선검사와 경계가 같아야 한다). */
function decisionText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  const n = Array.from(t).length
  return n >= 1 && n <= max ? t : null
}

/**
 * decisions 형식 검증 — 내용의 참·거짓은 판정하지 않는다(evidence §6 과 같은 입장). 실패 사유는 필드 경로를 담는다.
 * undefined = 필드 없음(제출 안 됨) → decisions:null. 명시적 null 은 배열이 아니므로 거부한다(fail-loud).
 */
export function validateDecisions(raw: unknown):
  { ok: true; decisions: AgentDecision[] | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, decisions: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'decisions는 배열이어야 합니다.' }
  if (raw.length > AGENT_DECISIONS_MAX) return { ok: false, error: `decisions는 ${AGENT_DECISIONS_MAX}건 이하여야 합니다.` }
  const out: AgentDecision[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const p = `decisions[${i}]`
    const d = raw[i]
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return { ok: false, error: `${p}는 객체여야 합니다.` }
    const r = d as Record<string, unknown>
    for (const k of Object.keys(r)) {
      if (!DECISION_FIELDS.has(k)) return { ok: false, error: `${p}에 알 수 없는 필드: ${k}` }
    }
    if (typeof r.key !== 'string' || !DECISION_KEY_RE.test(r.key)) return { ok: false, error: `${p}.key는 D1~D99 형식이어야 합니다.` }
    if (seen.has(r.key)) return { ok: false, error: `${p}.key가 중복됩니다: ${r.key}` }
    seen.add(r.key)
    const question = decisionText(r.question, AGENT_DECISION_QUESTION_MAX)
    if (question === null) return { ok: false, error: `${p}.question은 1~${AGENT_DECISION_QUESTION_MAX}자여야 합니다.` }
    if (!Array.isArray(r.options) || r.options.length < AGENT_DECISION_OPTIONS_MIN || r.options.length > AGENT_DECISION_OPTIONS_MAX) {
      return { ok: false, error: `${p}.options는 ${AGENT_DECISION_OPTIONS_MIN}~${AGENT_DECISION_OPTIONS_MAX}개여야 합니다.` }
    }
    const options: string[] = []
    for (let j = 0; j < r.options.length; j++) {
      const o = decisionText(r.options[j], AGENT_DECISION_OPTION_MAX)
      if (o === null) return { ok: false, error: `${p}.options[${j}]는 1~${AGENT_DECISION_OPTION_MAX}자여야 합니다.` }
      options.push(o)
    }
    if (typeof r.chosen !== 'number' || !Number.isInteger(r.chosen)) return { ok: false, error: `${p}.chosen은 정수여야 합니다.` }
    if (r.chosen < 0 || r.chosen >= options.length) return { ok: false, error: `${p}.chosen이 options 범위를 벗어났습니다.` }
    const rationale = decisionText(r.rationale, AGENT_DECISION_RATIONALE_MAX)
    if (rationale === null) return { ok: false, error: `${p}.rationale은 1~${AGENT_DECISION_RATIONALE_MAX}자여야 합니다.` }
    const onReject = decisionText(r.on_reject, AGENT_DECISION_ON_REJECT_MAX)
    if (onReject === null) return { ok: false, error: `${p}.on_reject는 1~${AGENT_DECISION_ON_REJECT_MAX}자여야 합니다.` }
    out.push({ key: r.key, question, options, chosen: r.chosen, rationale, on_reject: onReject })
  }
  return { ok: true, decisions: out }
}

/**
 * 저장된 decisions 를 화면 상태로. DB CHECK 가 배열만 보장하고 항목 모양은 앱 검증뿐이라 다시 본다.
 * null 을 0건으로 그리지 않는다(스펙 §10 "모름을 0건으로 보이지 않는다").
 */
export function parseDecisions(raw: unknown): DecisionsParse {
  if (raw === null || raw === undefined) return { state: 'none' }
  const v = validateDecisions(raw)
  return v.ok && v.decisions !== null ? { state: 'ok', items: v.decisions } : { state: 'invalid' }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/domain/agent-work-decisions.test.ts tests/domain/agent-work.test.ts`
Expected: PASS 전부(기존 `agent-work.test.ts` 회귀 없음).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/agentWork.ts tests/domain/agent-work-decisions.test.ts
git commit -F - <<'MSG'
feat(agent): 결정 목록 검증과 화면 상태 파서를 둔다

서버 400·CLI 선검사·화면이 같은 규칙과 상한을 보도록 순수 함수 한 곳에 모은다.
글자 수는 코드포인트로 세어 jq length 와 경계를 맞추고, null 은 0건이 아니라 "제출 안 됨" 으로 돌려준다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 3: 보고 API — `decisions` 수신·저장·노출, 계약 2.6

**Files:**
- Modify: `src/app/api/v1/agent/work/[id]/report/route.ts` (import 줄 5-7, 검증 44-47 뒤, `resolveWriteActor` 52 뒤, insert 90-96, 알림 detail 138, 응답 152-156)
- Modify: `src/app/api/v1/agent/work/[id]/route.ts:44-47` (`reportColumns`)
- Modify: `src/lib/agent/externalApi.ts:121` (`AGENT_CONTRACT_VERSION`)
- Modify: `tests/agent/me-route.test.ts:60` (`'2.5'` → `'2.6'`)
- Modify: `tests/agent/work-routes-pat.test.ts` (reports[].evidence describe 안에 두 단정 추가)
- Test: `tests/agent/report-decisions.test.ts` (새 파일)

**Interfaces:**
- Consumes: `validateDecisions(raw)` → `{ ok: true; decisions: AgentDecision[] | null } | { ok: false; error }` (Task 2)
- Produces (HTTP, 계약 2.6):
  - `POST /api/v1/agent/work/{id}/report` 본문 선택 필드 `decisions`. 판정 순서: ① `decisions` 가 있고 `kind !== 'completion'` → 400 `decisions는 완료 보고(kind=completion)에서만 받습니다.` ② 형식 위반 → 400(Task 2 의 사유) — ①② 모두 DB 접근(`createAdminClient`) 전 ③ `resolveWriteActor` 뒤 레거시면 400 `decisions는 PAT 호출에서만 받습니다.`
  - completion 응답 `{ ok: true, status: 'reported', decisions_recorded: number | null }` — 보내지 않았으면 `null`, 보냈으면 저장 건수. progress 응답은 불변.
  - 알림 `work.reported` 의 `payload.detail`: 결정 ≥ 1 이면 `완료 보고 — 승인 대기 · 확인 필요 결정 N건`, 아니면 `완료 보고 — 승인 대기`.
  - `GET /api/v1/agent/work/{id}` PAT 응답의 `reports[]` 에 `decisions`. 레거시 응답은 불변.

- [ ] **Step 1: 실패하는 라우트 테스트 작성**

`tests/agent/report-decisions.test.ts`:

```ts
// 완료 보고의 결정 목록(과제 C, 스펙 §4.1). PAT completion 에서만 받고, 형식 오류는 DB 접근 전 400.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  // 인자 타입을 적어 둔다 — mock.calls[0][0].payload 를 tsc 가 읽을 수 있게.
  emitNotification: vi.fn(async (_n: { payload: { detail: string } }) => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const RPC_OK = { ok: true, order_status: 'reported', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat' as const, owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read', 'work:claim'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
const CLAIMED = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: 'u-1', wbs_item_id: null }
const ctx = { params: Promise.resolve({ id: O1 }) }
const D = (key: string, over: Record<string, unknown> = {}) => ({
  key, question: ' 넣는가? ', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향', ...over,
})

function useAdmin(queues: Record<string, Resp[]>) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'delete', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: RPC_OK, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })),
        listUsers: vi.fn(async () => ({ data: { users: [{ id: 'u-1', email: 'dev@example.com', user_metadata: {} }] }, error: null })),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, inserts }
}
const patQueues = (): Record<string, Resp[]> => ({
  agent_runners: [{ data: RUNNER }, { data: null }],
  agent_work_orders: [{ data: CLAIMED }],
  agent_projects: [{ data: { enabled: true } }],
  memberships: [{ data: { is_superuser: false } }],
  project_roles: [{ data: [{ role: 'member' }] }, { data: [{ user_id: 'admin-1' }] }],
  agent_work_reports: [{ data: [{ id: 'r-1' }] }],
})
const post = (body: unknown, bearer = PAT.token) => new NextRequest(`http://l/api/v1/agent/work/${O1}/report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})
const COMPLETION = { agent: 'a', kind: 'completion', percent: 100, summary: '끝' }
const reportInsert = (inserts: Array<{ table: string; row: Record<string, unknown> }>) =>
  inserts.find(i => i.table === 'agent_work_reports')?.row

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST report — decisions', () => {
  it('필드가 없으면 insert 에 decisions 키가 없고 응답 decisions_recorded 는 null', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post(COMPLETION), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: null })
    expect(reportInsert(inserts)).not.toHaveProperty('decisions')
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기')
  })
  it('[] 는 0건 명시로 저장하고 응답은 0, 알림 문구는 종전 그대로', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [] }), ctx)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: 0 })
    expect(reportInsert(inserts)?.decisions).toEqual([])
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기')
  })
  it('2건은 trim 해 저장하고 응답 2, 알림에 결정 수를 싣는다', async () => {
    const { inserts } = useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [D('D1'), D('D2', { chosen: 1 })] }), ctx)
    expect(await res.json()).toEqual({ ok: true, status: 'reported', decisions_recorded: 2 })
    const saved = reportInsert(inserts)?.decisions as Array<Record<string, unknown>>
    expect(saved).toHaveLength(2)
    expect(saved[0].question).toBe('넣는가?')
    expect(saved[1].chosen).toBe(1)
    expect(mocks.emitNotification.mock.calls[0][0].payload.detail).toBe('완료 보고 — 승인 대기 · 확인 필요 결정 2건')
  })
  it('progress 에 decisions 가 실리면 400 — DB 에 가지 않는다(형식이 틀려도 이 사유가 먼저다)', async () => {
    useAdmin(patQueues())
    const res = await reportPOST(post({ agent: 'a', kind: 'progress', percent: 10, summary: 's', decisions: 'bad' }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('decisions는 완료 보고(kind=completion)에서만 받습니다.')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('형식 위반은 필드 경로를 담은 400 — DB 에 가지 않는다', async () => {
    useAdmin(patQueues())
    const res = await reportPOST(post({ ...COMPLETION, decisions: [D('D1', { chosen: 5 })] }), ctx)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('validation_failed')
    expect(j.error).toBe('decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('레거시(v1) 호출의 decisions 는 400 — 보고 행을 쓰지 않는다', async () => {
    const { inserts } = useAdmin({})
    const res = await reportPOST(post({ ...COMPLETION, user_email: 'dev@example.com', agent: 'cli-1', decisions: [] }, 'legacy-secret'), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('decisions는 PAT 호출에서만 받습니다.')
    expect(inserts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: GET·계약 버전 테스트 수정**

`tests/agent/work-routes-pat.test.ts` 의 `describe('GET /agent/work/[id] — reports[].evidence'` 안 두 테스트에 한 줄씩 더한다.

```ts
  it('PAT 응답은 evidence 컬럼을 요구한다', async () => {
    const selects: Record<string, string[]> = {}
    useAdmin(memberQueues(), selects)
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    expect(selects.agent_work_reports?.[0]).toContain('evidence')
    expect(selects.agent_work_reports?.[0]).toContain('decisions')
  })

  it('레거시 시크릿 응답은 evidence 를 요구하지 않는다(v1 회귀 기준선)', async () => {
    const selects: Record<string, string[]> = {}
    useAdmin({
      agent_work_orders: [ORDER_ROW],
      agent_projects: [{ data: { enabled: true } }],
      agent_work_reports: [{ data: [] }],
    }, selects)
    const res = await detail('legacy-secret')
    expect(res.status).toBe(200)
    expect(selects.agent_work_reports?.[0]).not.toContain('evidence')
    expect(selects.agent_work_reports?.[0]).not.toContain('decisions')
  })
```

`tests/agent/me-route.test.ts:60` 을 바꾼다:

```ts
    expect(body.contract_version).toBe('2.6')
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/agent/report-decisions.test.ts tests/agent/work-routes-pat.test.ts tests/agent/me-route.test.ts`
Expected: FAIL — 응답에 `decisions_recorded` 없음, select 에 `decisions` 없음, contract_version `'2.5'`.

- [ ] **Step 4: 보고 라우트 구현**

`src/app/api/v1/agent/work/[id]/report/route.ts` — import 를 바꾼다:

```ts
import {
  AGENT_LINKS_MAX, validateDecisions, validateEvidence, validateReport, isUuidLike, type AgentReportKind,
} from '@/lib/domain/agentWork'
```

`const ev = validateEvidence(b.evidence)` / `if (!ev.ok) return apiBadRequest(ev.error)` 바로 뒤에 넣는다:

```ts
  // 결정 목록(과제 C, 계약 2.6) — 승인자가 보는 것은 완료 보고라 completion 에서만 받는다(D6).
  // kind 를 먼저 본다: progress 에 실린 결정은 모양과 무관하게 받을 자리가 없다.
  if (b.decisions !== undefined && kind !== 'completion') {
    return apiBadRequest('decisions는 완료 보고(kind=completion)에서만 받습니다.')
  }
  const dec = validateDecisions(b.decisions)
  if (!dec.ok) return apiBadRequest(dec.error)
```

`if (!actor.ok) return actor.res` 바로 뒤에 넣는다:

```ts
    // v1 요청 형식은 불변(api-contract.md 머리말) — 레거시 경로는 결정을 받지 않는다.
    if (dec.decisions !== null && actor.principal.kind !== 'pat') {
      return apiBadRequest('decisions는 PAT 호출에서만 받습니다.')
    }
```

insert 를 바꾼다(필드가 없으면 키 자체를 넣지 않는다 — 행은 null = 제출 안 됨):

```ts
      .insert({
        work_order_id: id, kind, percent, summary, links, evidence: ev.evidence,
        agent: actor.agentLabel, actor_user_id: loaded.userId, applied_to_wbs: appliedToWbs,
        ...(dec.decisions !== null ? { decisions: dec.decisions } : {}),
      })
```

알림 `payload` 를 바꾼다:

```ts
      // 결정이 딸린 보고는 알림만 보고도 알 수 있게 한다(미결 1 — 별도 알림 유형은 두지 않는다).
      const decisionCount = dec.decisions?.length ?? 0
      emitNotification({
        type: 'work.reported', projectId: order.project_id, actorUserId: loaded.userId ?? null,
        entityType: 'agent_order', entityId: id,
        payload: {
          title: itemName,
          detail: decisionCount > 0 ? `완료 보고 — 승인 대기 · 확인 필요 결정 ${decisionCount}건` : '완료 보고 — 승인 대기',
          href: `/p/${order.project_id}/wbs`,
        },
        recipientUserIds: ((admins ?? []) as Array<{ user_id: string }>).map(a => a.user_id),
      }).catch(() => {
        // 알림 실패는 로깅만 하고 본 로직에 영향을 주지 않는다.
      })
```

응답을 바꾼다:

```ts
    // decisions_recorded: 보내지 않았으면 null, 보냈으면 저장 건수. CLI 는 이 키가 없으면 구 서버로 보고 경고한다(D9).
    return NextResponse.json(
      kind === 'completion'
        ? { ok: true, status: 'reported', decisions_recorded: dec.decisions === null ? null : dec.decisions.length }
        : { ok: true, status: 'claimed', applied_to_wbs: appliedToWbs },
    )
```

- [ ] **Step 5: GET 라우트·계약 버전 구현**

`src/app/api/v1/agent/work/[id]/route.ts` 의 `reportColumns` 를 바꾼다:

```ts
    // evidence·decisions 는 PAT 응답만 — depends_evidence 와 같은 규칙이다(레거시는 v1 회귀 기준선).
    // decisions 는 재작업하는 워커가 반려 사유(review_note)가 어느 결정(D2 등)을 가리키는지 볼 재료다(과제 C).
    const reportColumns = 'id, kind, percent, summary, links, agent, review_action, review_note, created_at'
      + (principal.kind === 'pat' ? ', evidence, decisions' : '')
```

`src/lib/agent/externalApi.ts:121`:

```ts
export const AGENT_CONTRACT_VERSION = '2.6'
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/agent`
Expected: PASS 전부(`report-route.test.ts`·`write-routes-pat.test.ts` 회귀 없음 — 기존 completion 응답 단정은 `status` 만 본다).

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/v1/agent/work/[id]/report/route.ts" "src/app/api/v1/agent/work/[id]/route.ts" src/lib/agent/externalApi.ts tests/agent/report-decisions.test.ts tests/agent/work-routes-pat.test.ts tests/agent/me-route.test.ts
git commit -F - <<'MSG'
feat(agent-api): 완료 보고가 결정 목록을 받아 저장한다(계약 2.6)

결정이 요약 문장에 섞여 승인 화면에서 골라 읽을 수 없었다. PAT completion 에서만 받고
형식 오류는 DB 접근 전 400 으로 끊어 반쪽 보고가 없게 한다. 응답의 decisions_recorded 로
구 서버에서 결정이 버려졌는지를 CLI 가 알 수 있게 하고, 재작업 워커는 GET 에서 결정을 다시 읽는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 4: 승인 큐 — `DecisionList` 와 허브 조립

**Files:**
- Create: `src/components/agent-hub/DecisionList.tsx`
- Modify: `src/lib/data/agentHub.ts:15` (`REPORT_COLS`)
- Modify: `src/lib/domain/agentHub.ts` (import 7행, `HubReportRow` 17-20, `HubQueueEntry` 51-58, 큐 조립 209-222)
- Modify: `src/components/agent-hub/ApprovalQueue.tsx`
- Test: `tests/components/decision-list.test.tsx` (새 파일)
- Modify(Test): `tests/domain/agent-hub.test.ts`, `tests/components/agent-hub-queue.test.tsx`

**Interfaces:**
- Consumes: `parseDecisions(raw)`, `DecisionsParse`, `AgentDecision` (Task 2)
- Produces:
  - `DecisionList({ decisions: DecisionsParse; compact?: boolean })` — `none` → `data-decisions="none"` 한 줄 `결정 목록 미제출(구버전 보고) — 요약을 확인하세요`, `invalid` → `data-decisions="invalid"` 한 줄 `결정 목록을 읽지 못했습니다 — 요약을 확인하세요` + `console.error`, `ok` 0건 → 아무것도 그리지 않음, `ok` N건 → `section[data-decisions="ok"]` 안에 결정마다 `li[data-decision=<key>]`, 택한 것 `[data-decision-chosen]`, 다른 선택지 `[data-decision-other]`.
  - 상수 `DECISIONS_NONE_TEXT`, `DECISIONS_INVALID_TEXT` (같은 파일 export — Task 5·6 테스트가 문구를 인용한다)
  - `HubReportRow.decisions?: unknown`, `HubQueueEntry.decisions: DecisionsParse`
  - 승인 큐 카드: 결정 ≥ 1 이면 머리에 칩 `[data-queue-decision-chip]` 텍스트 `결정 N`, 반려 textarea placeholder `반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)`.

- [ ] **Step 1: 실패하는 `DecisionList` 테스트 작성**

`tests/components/decision-list.test.tsx`:

```tsx
// @vitest-environment jsdom
// 결정 목록 표시 부품(과제 C, 스펙 §7). 에이전트 입력이므로 텍스트로만 그린다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DecisionList } from '@/components/agent-hub/DecisionList'
import type { AgentDecision } from '@/lib/domain/agentWork'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const D2: AgentDecision = {
  key: 'D2', question: '판정 로직을 이 Task 에서 넣는가?',
  options: ['넣지 않는다(spec 제약 우선)', '넣는다(선행 배정 우선)', '반만 넣는다'], chosen: 0,
  rationale: 'spec 본문이 넣지 않는다고 적었다.', on_reject: '판정 로직을 verdict.ts 로 옮긴다.',
}

let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('DecisionList', () => {
  it('결정마다 번호·질문·택한 것(굵게)·다른 선택지·근거·반려 시 방향을 보이고 머리에 출처를 적는다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [D2] }} />))
    expect(host.textContent).toContain('에이전트가 적은 결정 1건')
    const li = host.querySelector('[data-decision="D2"]')!
    expect(li.textContent).toContain('판정 로직을 이 Task 에서 넣는가?')
    expect(li.querySelector('[data-decision-chosen]')!.textContent).toBe('넣지 않는다(spec 제약 우선)')
    expect([...li.querySelectorAll('[data-decision-other]')].map(e => e.textContent)).toEqual(['넣는다(선행 배정 우선)', '반만 넣는다'])
    expect(li.textContent).toContain('spec 본문이 넣지 않는다고 적었다.')
    expect(li.textContent).toContain('판정 로직을 verdict.ts 로 옮긴다.')
  })
  it('에이전트가 적은 HTML·마크다운은 글자 그대로 보이고 요소가 생기지 않는다', () => {
    const evil = { ...D2, rationale: '<script>alert(1)</script> **굵게** <img src=x onerror=alert(1)>' }
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [evil] }} />))
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('strong')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script> **굵게** <img src=x onerror=alert(1)>')
  })
  it('0건([])은 아무것도 그리지 않는다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'ok', items: [] }} />))
    expect(host.innerHTML).toBe('')
  })
  it('미제출(null)은 0건이 아니라 따로 알린다', () => {
    act(() => root.render(<DecisionList decisions={{ state: 'none' }} />))
    expect(host.querySelector('[data-decisions="none"]')!.textContent).toBe('결정 목록 미제출(구버전 보고) — 요약을 확인하세요')
  })
  it('형식 오류는 따로 알리고 로그를 남긴다', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(<DecisionList decisions={{ state: 'invalid' }} />))
    expect(host.querySelector('[data-decisions="invalid"]')!.textContent).toBe('결정 목록을 읽지 못했습니다 — 요약을 확인하세요')
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/decision-list.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/agent-hub/DecisionList"`

- [ ] **Step 3: `DecisionList` 구현**

`src/components/agent-hub/DecisionList.tsx`:

```tsx
'use client'
// 워커가 스스로 고른 결정 목록(과제 C, 스펙 §7) — 승인 큐·Task 사이드바·오피스 상세가 같이 쓴다. 표시 전용.
// 본문은 에이전트 입력이다: React 텍스트 노드로만 그리고 마크다운·HTML 을 해석하지 않는다.
// 모름을 0건으로 보이지 않는다 — 미제출(null)·형식 오류는 각자 문구로, 0건([])만 아무것도 그리지 않는다.
import { Fragment, useEffect } from 'react'
import type { DecisionsParse } from '@/lib/domain/agentWork'

export const DECISIONS_NONE_TEXT = '결정 목록 미제출(구버전 보고) — 요약을 확인하세요'
export const DECISIONS_INVALID_TEXT = '결정 목록을 읽지 못했습니다 — 요약을 확인하세요'

export function DecisionList({ decisions, compact = false }: { decisions: DecisionsParse; compact?: boolean }) {
  useEffect(() => {
    if (decisions.state === 'invalid') console.error('[DecisionList] 결정 목록 형식 오류 — 저장 값이 앱 검증 규칙을 어긴다')
  }, [decisions.state])

  if (decisions.state === 'none') {
    return <p data-decisions="none" className="mt-1 text-[11px] text-ink-subtle">{DECISIONS_NONE_TEXT}</p>
  }
  if (decisions.state === 'invalid') {
    return <p data-decisions="invalid" className="mt-1 text-[11px] text-accent-warning">{DECISIONS_INVALID_TEXT}</p>
  }
  if (decisions.items.length === 0) return null
  return (
    <section data-decisions="ok" aria-label="에이전트가 적은 결정"
      className={`mt-2 rounded-md border border-line/70 p-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <p className="mb-1 text-[10px] font-semibold text-ink-subtle">에이전트가 적은 결정 {decisions.items.length}건</p>
      <ol className="space-y-2">
        {decisions.items.map(d => (
          <li key={d.key} data-decision={d.key}>
            <p className="text-ink">
              <span className="mr-1.5 font-mono font-semibold">{d.key}</span>
              <span className="whitespace-pre-wrap">{d.question}</span>
            </p>
            <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-6">
              <dt className="text-ink-subtle">택함</dt>
              <dd data-decision-chosen className="whitespace-pre-wrap font-semibold text-ink">{d.options[d.chosen]}</dd>
              {d.options.map((o, i) => i === d.chosen ? null : (
                <Fragment key={i}>
                  <dt className="text-ink-subtle">다른 선택지</dt>
                  <dd data-decision-other className="whitespace-pre-wrap text-ink-muted">{o}</dd>
                </Fragment>
              ))}
              <dt className="text-ink-subtle">근거</dt>
              <dd className="whitespace-pre-wrap text-ink">{d.rationale}</dd>
              <dt className="text-ink-subtle">반려 시</dt>
              <dd className="whitespace-pre-wrap text-ink">{d.on_reject}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}
```

Run: `npx vitest run tests/components/decision-list.test.tsx`
Expected: PASS 5건.

- [ ] **Step 4: 허브 조립·승인 큐 테스트 작성**

`tests/domain/agent-hub.test.ts` 의 `it('queue: reported 주문마다 최신 completion 보고 1건 …')` 바로 뒤에 추가한다:

```ts
  it('queue: 최신 completion 의 결정 상태를 싣는다 — none·ok·invalid 를 가른다', () => {
    const o1 = '11111111-aaaa-4aaa-8aaa-000000000001', o2 = '11111111-aaaa-4aaa-8aaa-000000000002', o3 = '11111111-aaaa-4aaa-8aaa-000000000003'
    const dec = { key: 'D1', question: 'q', options: ['a', 'b'], chosen: 1, rationale: 'r', on_reject: 'x' }
    const base = { percent: 100, summary: 's', links: [], agent: 'x', review_action: null, review_note: null }
    const hub = assembleAgentHub(rows({
      orders: [
        order({ id: o1, wbs_item_id: 'a1', status: 'reported', updated_at: ago(3000) }),
        order({ id: o2, wbs_item_id: 'a2', status: 'reported', updated_at: ago(2000) }),
        order({ id: o3, wbs_item_id: 'a1', status: 'reported', updated_at: ago(1000) }),
      ],
      reports: [
        { ...base, work_order_id: o1, created_at: ago(9000), decisions: [dec, { ...dec, key: 'D2' }, { ...dec, key: 'D3' }] }, // 옛 회차
        { ...base, work_order_id: o1, created_at: ago(3000), decisions: [dec] },                                               // 최신
        { ...base, work_order_id: o2, created_at: ago(2000), decisions: null },
        { ...base, work_order_id: o3, created_at: ago(1000), decisions: [{ ...dec, chosen: 7 }] },
      ],
    }), NOW, VIEWER)
    const by = new Map(hub.queue.map(q => [q.orderId, q.decisions]))
    expect(by.get(o1)).toEqual({ state: 'ok', items: [dec] })
    expect(by.get(o2)).toEqual({ state: 'none' })
    expect(by.get(o3)).toEqual({ state: 'invalid' })
  })
```

`tests/components/agent-hub-queue.test.tsx` — 픽스처 `Q` 에 `decisions` 를 더하고(0건: 기존 테스트는 결정 영역을 보지 않는다), 파일 끝에 describe 를 더한다.

```tsx
const Q: HubQueueEntry[] = [{ orderId: 'o1', itemId: 'i1', code: 'TSK-1', name: '화면', agent: 'hong/mbp', percent: 100, summary: '끝', links: [{ url: 'https://x/pr/1', label: 'PR' }], reportedAt: '2026-09-14T08:00:00Z', assigneeMine: false, canManage: false, decisions: { state: 'ok', items: [] } }]
```

```tsx
describe('ApprovalQueue — 결정 목록(과제 C)', () => {
  const DEC = { key: 'D2', question: '넣는가?', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향' }
  it('결정이 있으면 칩과 펼친 목록을 보이고 반려 안내가 결정 번호를 청한다', async () => {
    render({ queue: [{ ...Q[0], decisions: { state: 'ok', items: [DEC, { ...DEC, key: 'D3' }] } }] })
    expect(host.querySelector('[data-queue-decision-chip]')!.textContent).toBe('결정 2')
    expect(host.querySelectorAll('[data-decision]')).toHaveLength(2)
    await act(async () => { (host.querySelector('[data-queue-reject-open]') as HTMLButtonElement).click() })
    expect((host.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)')
  })
  it('0건이면 칩·목록이 없고 반려 안내는 종전 그대로', async () => {
    render()
    expect(host.querySelector('[data-queue-decision-chip]')).toBeNull()
    expect(host.querySelector('[data-decisions]')).toBeNull()
    await act(async () => { (host.querySelector('[data-queue-reject-open]') as HTMLButtonElement).click() })
    expect((host.querySelector('textarea') as HTMLTextAreaElement).placeholder).not.toContain('D2')
  })
  it('미제출(구 CLI)이면 칩 없이 미제출 문구를 보인다 — 0건으로 그리지 않는다', () => {
    render({ queue: [{ ...Q[0], decisions: { state: 'none' } }] })
    expect(host.querySelector('[data-queue-decision-chip]')).toBeNull()
    expect(host.querySelector('[data-decisions="none"]')).not.toBeNull()
  })
})
```

Run: `npx vitest run tests/domain/agent-hub.test.ts tests/components/agent-hub-queue.test.tsx`
Expected: FAIL — `decisions` 가 큐 항목에 없음, 칩 없음.

- [ ] **Step 5: 허브 조립 구현**

`src/lib/data/agentHub.ts:15`:

```ts
const REPORT_COLS = 'work_order_id, percent, summary, links, agent, review_action, review_note, created_at, decisions'
```

`src/lib/domain/agentHub.ts` — import 를 바꾼다:

```ts
import { parseDecisions, stageLockedForHuman, type DecisionsParse } from './agentWork'
```

`HubReportRow` 를 바꾼다:

```ts
export interface HubReportRow {
  work_order_id: string; percent: number; summary: string; links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
  /** 워커 결정 목록(0102). null = 제출 안 됨. 항목 모양은 parseDecisions 가 다시 본다. 옛 시험 픽스처는 비워 둘 수 있다. */
  decisions?: unknown
}
```

`HubQueueEntry` 의 `canManage: boolean` 뒤에 더한다:

```ts
  /** 최신 completion 보고의 결정 목록 상태(과제 C). 보고 행이 없으면 none. */
  decisions: DecisionsParse
```

큐 조립의 반환 객체에서 `canManage: …,` 뒤에 더한다:

```ts
        decisions: rep ? parseDecisions(rep.decisions) : { state: 'none' as const },
```

- [ ] **Step 6: 승인 큐 구현**

`src/components/agent-hub/ApprovalQueue.tsx` — import 에 더한다:

```tsx
import { DecisionList } from './DecisionList'
```

`const when = …` 아래에 둔다:

```tsx
/** 결정이 딸린 보고의 반려 안내 — 결정별 반려(스펙 §11)의 토대. 가드·동작은 바꾸지 않는다. */
const REJECT_DECISION_PLACEHOLDER = '반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)'
```

`QueueCard` 본문의 `return (` 바로 앞에 둔다:

```tsx
  const decisionN = q.decisions.state === 'ok' ? q.decisions.items.length : 0
```

카드 머리의 오른쪽 span 을 바꾼다:

```tsx
        <span className="flex items-center gap-1.5">
          {decisionN > 0 && (
            <span data-queue-decision-chip title="워커가 스스로 고른 결정 — 아래 목록을 확인하세요"
              className="rounded-full bg-accent-warning/15 px-1.5 text-[10px] font-semibold text-accent-warning">결정 {decisionN}</span>
          )}
          <span className="text-[11px] text-ink-subtle">{q.agent} · {when(q.reportedAt)} · {q.percent}%</span>
        </span>
```

요약 줄 바로 아래(링크 목록 앞)에 둔다 — 승인자의 일이 이것을 읽는 것이라 접지 않는다:

```tsx
      <DecisionList decisions={q.decisions} />
```

반려 textarea 의 placeholder 를 바꾼다:

```tsx
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder={decisionN > 0 ? REJECT_DECISION_PLACEHOLDER : NOTE_PLACEHOLDER.reject} className="app-input w-full text-xs" />
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/components/decision-list.test.tsx tests/domain/agent-hub.test.ts tests/components/agent-hub-queue.test.tsx tests/components/agent-hub-view.test.tsx tests/components/agent-hub-table.test.tsx tests/data/agent-hub.test.ts`
Expected: PASS 전부.

- [ ] **Step 8: 커밋**

```bash
git add src/components/agent-hub/DecisionList.tsx src/lib/data/agentHub.ts src/lib/domain/agentHub.ts src/components/agent-hub/ApprovalQueue.tsx tests/components/decision-list.test.tsx tests/domain/agent-hub.test.ts tests/components/agent-hub-queue.test.tsx
git commit -F - <<'MSG'
feat(agent-hub): 승인 큐 카드에 워커 결정 목록을 펼쳐 보인다

승인자가 요약 문장 끝에서 결정을 찾아 읽어야 했다. 카드 머리에 결정 수 칩을 달고
요약 아래에 목록을 펼친 채로 둔다. 미제출·형식 오류는 0건과 다른 문구로 알리고,
반려 안내는 결정 번호를 적게 해 결정별 반려의 토대를 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 5: Task 사이드바 — 보고 이력의 결정과 좁은 조회 액션

**Files:**
- Modify: `src/app/actions/agentWork.ts` (`AgentOrderReport` 310행, `getAgentOrderForItem` 보고 select 353행, 파일 끝에 새 액션)
- Modify: `src/components/wbs/WbsSpecPanel.tsx` (import 14-20행, `WbsAgentOrderStatus` 보고 이력 465-480행)
- Test: `tests/actions/agent-report-decisions.test.ts` (새 파일)
- Test: `tests/components/wbs-agent-order-decisions.test.tsx` (새 파일)

**Interfaces:**
- Consumes: `parseDecisions`, `DecisionList`, `DECISIONS_NONE_TEXT` (Task 2·4)
- Produces:
  - `AgentOrderReport.decisions?: unknown` — `getAgentOrderForItem` 이 보고마다 싣는다(세션 클라이언트, RLS 2차 방어선).
  - `getReportDecisions(orderId: string): Promise<{ ok: true; decisions: unknown } | { ok: false; error: string }>` — 세션 클라이언트 + `requireProjectMember`. 최신 completion 보고의 `decisions` 원본(null 포함)을 돌려준다. completion 이 없으면 `{ ok: false, error: '완료 보고가 없습니다.' }`. Task 6 의 오피스 상세 패널이 쓴다.
  - Task 사이드바: 주문이 `reported` 이고 마지막 completion 이면 `DecisionList compact` 를 펼친다. 옛 completion 은 `details[data-report-decisions-fold]` 로 접고 `summary` 에 `결정 N건`(미제출은 `결정 목록 미제출`, 형식 오류는 `결정 목록 오류`). 옛 completion 이 0건이면 아무것도 그리지 않는다.

- [ ] **Step 1: 실패하는 액션 테스트 작성**

`tests/actions/agent-report-decisions.test.ts`:

```ts
// 결정 목록 조회 액션(과제 C, 스펙 §7.2·§7.3·§8). 세션 클라이언트 + requireProjectMember — 새 service_role 경로를 만들지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: vi.fn() }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: vi.fn() }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: vi.fn(), isSubtreeManager: vi.fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => {}) }))
vi.mock('next/server', async orig => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: vi.fn() }))

import { getAgentOrderForItem, getReportDecisions } from '@/app/actions/agentWork'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
type R = { data: unknown; error: { message: string } | null }

/** 테이블별 응답 하나 + select·eq 인자 기록. maybeSingle 과 await(then) 둘 다 같은 응답을 준다. */
function session(byTable: Record<string, R>) {
  const selects: Record<string, string> = {}
  const eqs: Array<[string, string, unknown]> = []
  const sb = {
    from: vi.fn((table: string) => {
      const resp = byTable[table] ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = (cols: string) => { selects[table] = cols; return b }
      b.eq = (col: string, v: unknown) => { eqs.push([table, col, v]); return b }
      for (const k of ['order', 'limit', 'in']) b[k] = () => b
      b.maybeSingle = async () => resp
      b.then = (r: (v: unknown) => unknown) => Promise.resolve(resp).then(r)
      return b
    }),
  }
  mocks.createServerClient.mockResolvedValue(sb)
  return { selects, eqs }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'u-1' } })
})

describe('getReportDecisions', () => {
  it('비형식 id 는 거부', async () => {
    expect(await getReportDecisions('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('주문이 없으면 대상 없음', async () => {
    session({ agent_work_orders: { data: null, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
  })
  it('프로젝트 멤버가 아니면 가드의 사유로 거부 — 보고를 읽지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const { selects } = session({ agent_work_orders: { data: { project_id: P1 }, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '멤버 아님' })
    expect(mocks.requireProjectMember).toHaveBeenCalledWith(P1)
    expect(selects.agent_work_reports).toBeUndefined()
  })
  it('최신 completion 의 decisions 원본을 돌려준다(null 도 그대로)', async () => {
    const { eqs } = session({
      agent_work_orders: { data: { project_id: P1 }, error: null },
      agent_work_reports: { data: { decisions: null, created_at: '2026-09-23T00:00:00Z' }, error: null },
    })
    expect(await getReportDecisions(O1)).toEqual({ ok: true, decisions: null })
    expect(eqs).toContainEqual(['agent_work_reports', 'kind', 'completion'])
  })
  it('보고 조회 실패는 빈 목록이 아니라 오류로 올린다', async () => {
    session({
      agent_work_orders: { data: { project_id: P1 }, error: null },
      agent_work_reports: { data: null, error: { message: 'db down' } },
    })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '보고 조회 실패: db down' })
  })
  it('completion 이 없으면 없다고 말한다', async () => {
    session({ agent_work_orders: { data: { project_id: P1 }, error: null }, agent_work_reports: { data: null, error: null } })
    expect(await getReportDecisions(O1)).toEqual({ ok: false, error: '완료 보고가 없습니다.' })
  })
})

describe('getAgentOrderForItem — 보고 이력에 decisions', () => {
  it('보고 select 에 decisions 를 싣는다', async () => {
    const { selects } = session({
      wbs_items: { data: { project_id: P1 }, error: null },
      agent_work_orders: { data: [{ id: O1, status: 'reported', claimed_by: 'a', claimed_at: null, updated_at: '2026-09-23T00:00:00Z' }], error: null },
      agent_work_reports: { data: [], error: null },
    })
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    expect(selects.agent_work_reports).toContain('decisions')
  })
})
```

- [ ] **Step 2: 실패하는 사이드바 테스트 작성**

`tests/components/wbs-agent-order-decisions.test.tsx`:

```tsx
// @vitest-environment jsdom
// Task 사이드바 보고 이력의 결정 목록(과제 C, 스펙 §7.2) — 승인 대기 회차는 펼치고, 옛 회차는 접는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getAgentOrderForItem = vi.fn()
vi.mock('@/app/actions/wbsSpec', () => ({
  getWbsSpec: vi.fn().mockResolvedValue({
    category: null, domain: null, priority: null, model: null,
    tags: ['agent'], depends: [], prdRef: null, entryPoint: null,
    acceptance: [], spec: null, externalRef: 'mod/TSK-01-01', agentPrompt: null,
  }),
  setAgentDelegation: vi.fn(),
  updateAgentPrompt: vi.fn(),
  updateWbsSpec: vi.fn(),
  updateWbsSpecFields: vi.fn(),
}))
vi.mock('@/app/actions/agentWork', () => ({
  getAgentOrderForItem: (...a: unknown[]) => getAgentOrderForItem(...(a as [])),
  approveAgentCompletion: vi.fn(),
  rejectAgentCompletion: vi.fn(),
  unapproveAgentCompletion: vi.fn(),
  requestAgentRework: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))

import { WbsSpecPanel } from '@/components/wbs/WbsSpecPanel'

const DEC = (key: string) => ({ key, question: `${key} 질문`, options: ['가', '나'], chosen: 1, rationale: '근거', on_reject: '방향' })
const rep = (id: string, kind: 'progress' | 'completion', created_at: string, decisions: unknown, review_action: 'reject' | null = null) => ({
  id, kind, percent: kind === 'completion' ? 100 : 40, summary: `${id} 요약`, links: [], agent: 'hong/mbp/w1',
  review_action, review_note: review_action ? 'D2 는 선택지 2로' : null, created_at, decisions,
})
function reportedOrder(reports: unknown[]) {
  return {
    ok: true,
    order: { id: '22222222-2222-4222-8222-222222222222', status: 'reported', claimed_by: 'hong/mbp/w1', claimed_at: null, updated_at: '2026-09-23T03:00:00Z', reports },
    priorOrders: [], projectId: 'p1',
  }
}

describe('WbsSpecPanel 진행 상황 — 결정 목록', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    getAgentOrderForItem.mockReset()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  // 진행 상황은 명세 본문 밖에 있고, reported 면 스스로 펼쳐진다 — 토글을 누르지 않는다(누르면 닫힌다).
  async function render() {
    await act(async () => { root.render(<WbsSpecPanel itemId="item-1" editable />) })
    await act(async () => {})
  }

  it('승인 대기 회차(마지막 completion)는 펼치고, 반려된 옛 회차는 결정 수만 보이게 접는다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', [DEC('D1'), DEC('D2'), DEC('D3')], 'reject'),
      rep('r2', 'progress', '2026-09-23T02:00:00Z', null),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', [DEC('D1')]),
    ]))
    await render()
    const folds = container.querySelectorAll('details[data-report-decisions-fold]')
    expect(folds).toHaveLength(1)
    expect(folds[0].querySelector('summary')!.textContent).toBe('결정 3건')
    const open = [...container.querySelectorAll('[data-decisions="ok"]')].filter(e => !e.closest('details'))
    expect(open).toHaveLength(1)
    expect(open[0].querySelectorAll('[data-decision]')).toHaveLength(1)
  })
  it('progress 보고에는 결정 영역이 없다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([rep('r2', 'progress', '2026-09-23T02:00:00Z', null)]))
    await render()
    expect(container.querySelector('[data-decisions]')).toBeNull()
    expect(container.querySelector('details[data-report-decisions-fold]')).toBeNull()
  })
  it('구 CLI 보고(null)는 승인 대기 회차에서 미제출 문구, 옛 회차에서는 접힌 머리가 미제출', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', null, 'reject'),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', null),
    ]))
    await render()
    expect(container.querySelector('details[data-report-decisions-fold] summary')!.textContent).toBe('결정 목록 미제출')
    const none = [...container.querySelectorAll('[data-decisions="none"]')].filter(e => !e.closest('details'))
    expect(none).toHaveLength(1)
  })
  it('옛 회차가 0건([])이면 접힌 영역도 그리지 않는다', async () => {
    getAgentOrderForItem.mockResolvedValue(reportedOrder([
      rep('r1', 'completion', '2026-09-23T01:00:00Z', [], 'reject'),
      rep('r3', 'completion', '2026-09-23T03:00:00Z', [DEC('D1')]),
    ]))
    await render()
    expect(container.querySelector('details[data-report-decisions-fold]')).toBeNull()
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/actions/agent-report-decisions.test.ts tests/components/wbs-agent-order-decisions.test.tsx`
Expected: FAIL — `getReportDecisions` export 없음, 결정 영역 없음.

- [ ] **Step 4: 액션 구현**

`src/app/actions/agentWork.ts` — `AgentOrderReport` 를 바꾼다:

```ts
export type AgentOrderReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
  /** 워커 결정 목록(0102). null = 제출 안 됨. 화면은 parseDecisions 로 읽는다. */
  decisions?: unknown
}
```

`getAgentOrderForItem` 의 보고 select 를 바꾼다:

```ts
    .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at, decisions')
```

파일 끝에 더한다:

```ts
/**
 * 주문의 최신 completion 보고의 결정 목록(과제 C, 스펙 §7.3) — 오피스 상세 패널이 열릴 때 한 번 읽는다.
 * 좌석표는 수(decision_count)만 싣고 본문을 끌어오지 않으므로 여기서 좁게 읽는다.
 * 세션 클라이언트 + requireProjectMember — getAgentOrderForItem 과 같은 등급이고 RLS 가 2차 방어선이다.
 * 조회 실패를 빈 목록으로 위장하지 않는다(3원칙) — 호출부가 오류 문구와 재시도를 그린다.
 */
export async function getReportDecisions(orderId: string): Promise<
  | { ok: true; decisions: unknown }
  | { ok: false; error: string }
> {
  if (!isUuidLike(orderId)) return { ok: false, error: '잘못된 요청입니다.' }
  const sb = await createServerClient()
  const { data: order, error: orderErr } = await sb.from('agent_work_orders').select('project_id').eq('id', orderId).maybeSingle()
  if (orderErr) return { ok: false, error: `주문 조회 실패: ${orderErr.message}` }
  if (!order) return { ok: false, error: '대상을 찾을 수 없습니다.' }
  const g = await requireProjectMember((order as { project_id: string }).project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const { data: rep, error: repErr } = await sb
    .from('agent_work_reports')
    .select('decisions, created_at')
    .eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1)
    .maybeSingle()
  if (repErr) return { ok: false, error: `보고 조회 실패: ${repErr.message}` }
  if (!rep) return { ok: false, error: '완료 보고가 없습니다.' }
  return { ok: true, decisions: (rep as { decisions: unknown }).decisions ?? null }
}
```

- [ ] **Step 5: 사이드바 구현**

`src/components/wbs/WbsSpecPanel.tsx` — import 를 바꾼다:

```tsx
import { isClaimStale, parseDecisions } from '@/lib/domain/agentWork'
import { DecisionList } from '@/components/agent-hub/DecisionList'
```

`function WbsAgentOrderStatus(` 바로 위에 둔다:

```tsx
/**
 * 완료 보고 한 회차의 결정 목록(과제 C, 스펙 §7.2). 승인 대기 회차는 펼치고, 반려·재작업된 옛 회차는
 * 결정 수만 보이게 접는다 — 회차마다 무엇이 반려됐는지(review_note)와 나란히 읽힌다.
 */
function ReportDecisions({ raw, open }: { raw: unknown; open: boolean }) {
  const parsed = parseDecisions(raw)
  if (open) return <DecisionList decisions={parsed} compact />
  if (parsed.state === 'ok' && parsed.items.length === 0) return null
  const head = parsed.state === 'ok' ? `결정 ${parsed.items.length}건` : parsed.state === 'none' ? '결정 목록 미제출' : '결정 목록 오류'
  return (
    <details data-report-decisions-fold className="mt-1">
      <summary className="cursor-pointer text-[10px] text-ink-subtle">{head}</summary>
      <DecisionList decisions={parsed} compact />
    </details>
  )
}
```

`const lastReport = order.reports.at(-1)` 아래에 둔다:

```tsx
  // 승인 대기 회차 = 주문이 reported 일 때의 마지막 completion. 그 밖의 completion 은 옛 회차다.
  const pendingCompletionId = order.status === 'reported'
    ? ([...order.reports].reverse().find(r => r.kind === 'completion')?.id ?? null)
    : null
```

보고 이력 항목에서 링크 블록(`{r.links.length > 0 && (…)}`) 바로 뒤, `</li>` 앞에 넣는다:

```tsx
              {r.kind === 'completion' && <ReportDecisions raw={r.decisions} open={r.id === pendingCompletionId} />}
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/actions/agent-report-decisions.test.ts tests/components/wbs-agent-order-decisions.test.tsx tests/actions/agent-work-actions.test.ts tests/components/wbs-agent-order-actions.test.tsx tests/components/wbs-spec-collapsed-default.test.tsx tests/components/wbs-spec-debounced-save.test.tsx tests/components/wbs-spec-edit-toggle.test.tsx`
Expected: PASS 전부.

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/agentWork.ts src/components/wbs/WbsSpecPanel.tsx tests/actions/agent-report-decisions.test.ts tests/components/wbs-agent-order-decisions.test.tsx
git commit -F - <<'MSG'
feat(wbs): Task 사이드바 보고 이력에 결정 목록을 보인다

승인 대기 회차는 펼치고 반려된 옛 회차는 결정 수만 보이게 접어, 어느 회차에서 무엇이
반려됐는지 나란히 읽히게 한다. 오피스 상세가 본문을 좁게 읽을 액션 getReportDecisions 를
세션 클라이언트 + 프로젝트 멤버 가드로 같이 둔다(새 service_role 경로 없음).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 6: 오피스 — 좌석 칩과 상세 패널 목록

**Files:**
- Modify: `src/lib/domain/seatmap.ts` (`ReviewRow` 29행, `Seat` 55-83행, `toSeat` 185-225행)
- Modify: `src/lib/data/agentSeatmap.ts:61-62` (완료 보고 select)
- Create: `src/components/agents/DecisionChip.tsx`
- Create: `src/components/agents/SeatDecisions.tsx`
- Modify: `src/components/agents/Seat.tsx` (책상 머리 `deskTop`)
- Modify: `src/components/agents/LaneBoard.tsx` (카드 `cardMeta`)
- Modify: `src/components/agents/DetailPanel.tsx` (반려 사유 인용 뒤)
- Test: `tests/domain/seatmap-decisions.test.ts` (새 파일), `tests/components/agents-decisions.test.tsx` (새 파일)
- Modify(Test): `tests/components/agents-detail-panel.test.tsx`, `tests/components/agents-seatmap-view.test.tsx` (mock 한 줄)

**Interfaces:**
- Consumes: `getReportDecisions(orderId)` (Task 5), `parseDecisions`, `DecisionList` (Task 2·4)
- Produces:
  - `ReviewRow.decision_count?: number | null` — 좌석표 완료 보고 조회가 싣는다.
  - `Seat.decisionCount?: number | null` — 주문이 `reported` 일 때만 최신 completion 의 `decision_count`, 그 밖은 null. 옛 픽스처가 비워 둘 수 있게 선택 필드다(`model` 과 같은 관례).
  - `DecisionChip({ count })` — `count ≥ 1` 일 때만 `span[data-decision-chip=<N>]` 텍스트 `결정 N`.
  - `SeatDecisions({ orderId })` — 열릴 때 `getReportDecisions` 한 번. 성공 → `DecisionList`, 실패 → `[data-seat-decisions-error]` `결정 목록을 불러오지 못했습니다` + 재시도 버튼 `[data-seat-decisions-retry]`(빈 목록으로 그리지 않는다).
  - `DetailPanel`: `seat.state === 'WAIT' && (seat.decisionCount ?? 0) >= 1` 일 때만 `SeatDecisions` 를 그린다.

- [ ] **Step 1: 실패하는 좌석표 테스트 작성**

`tests/domain/seatmap-decisions.test.ts`:

```ts
// 좌석의 결정 수(과제 C, 스펙 §7.3) — reported 주문의 최신 completion 값만. 본문은 싣지 않는다.
import { describe, expect, it } from 'vitest'
import { assembleSeatmap, type OrderRow, type ReviewRow, type SeatmapRows } from '@/lib/domain/seatmap'

const NOW = Date.parse('2026-09-23T09:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const OID = '11111111-aaaa-4aaa-8aaa-000000000001'
const order = (over: Partial<OrderRow>): OrderRow => ({
  id: OID, project_id: 'p1', wbs_item_id: 'i1', status: 'reported',
  claimed_by: 'claude-mbp', claimed_by_user_id: 'u1', claimed_at: ago(3600_000), created_at: ago(7200_000),
  updated_at: ago(60_000), last_heartbeat_at: ago(1000), heartbeat_phase: 'reported', heartbeat_agent: 'hong/mbp/w1',
  heartbeat_note: null, ...over,
})
const rows = (orders: OrderRow[], reviews: ReviewRow[]): SeatmapRows => ({
  orders,
  items: [{ id: 'i1', project_id: 'p1', code: 'TSK-01', name: '화면', parent_id: null, actual_pct: 80, assignee_member_id: null, tags: ['agent'] }],
  parents: [], reviews, watchers: [], projects: [{ id: 'p1', name: 'mes-base' }], members: [], predecessors: [],
})
const seatOf = (r: SeatmapRows) => assembleSeatmap(r, NOW).floors[0].zones[0].seats[0]

describe('Seat.decisionCount', () => {
  it('reported 주문은 최신 completion 의 decision_count — 반려된 옛 회차와 합산하지 않는다', () => {
    const s = seatOf(rows([order({})], [
      { work_order_id: OID, review_action: 'reject', review_note: '다시', created_at: ago(9000), decision_count: 3 },
      { work_order_id: OID, review_action: null, review_note: null, created_at: ago(2000), decision_count: 1 },
    ]))
    expect(s.state).toBe('WAIT')
    expect(s.decisionCount).toBe(1)
  })
  it('구 CLI 보고(null)는 null — 0 으로 바꾸지 않는다', () => {
    const s = seatOf(rows([order({})], [{ work_order_id: OID, review_action: null, review_note: null, created_at: ago(2000), decision_count: null }]))
    expect(s.decisionCount).toBeNull()
  })
  it('reported 가 아니면(재작업 중 claimed) 옛 completion 의 값이 있어도 null', () => {
    const s = seatOf(rows([order({ status: 'claimed', heartbeat_phase: 'build' })], [
      { work_order_id: OID, review_action: 'reject', review_note: '다시', created_at: ago(9000), decision_count: 2 },
    ]))
    expect(s.decisionCount).toBeNull()
  })
})
```

Run: `npx vitest run tests/domain/seatmap-decisions.test.ts`
Expected: FAIL — `decisionCount` 가 `undefined`.

- [ ] **Step 2: 좌석표 구현**

`src/lib/domain/seatmap.ts` — `ReviewRow` 를 바꾼다:

```ts
export interface ReviewRow {
  work_order_id: string; review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
  /** 워커 결정 수(0102 생성 컬럼). null = 제출 안 됨. 옛 픽스처는 비워 둘 수 있다. */
  decision_count?: number | null
}
```

`Seat` 의 `agentOwnerName: string | null` 뒤에 더한다:

```ts
  /** 승인 대기(reported) 주문의 최신 completion 에 딸린 결정 수(과제 C). 그 밖의 상태·구 CLI 보고는 null.
   *  말풍선과 달리 승인될 때까지 칩으로 계속 보인다. 옛 시험 픽스처가 비워 둘 수 있게 선택 필드다. */
  decisionCount?: number | null
```

`toSeat` 반환 객체의 `agentMine: owner.mine, agentOwnerName: owner.name,` 뒤에 더한다:

```ts
    decisionCount: o.status === 'reported' ? (review?.decision_count ?? null) : null,
```

`src/lib/data/agentSeatmap.ts` 의 완료 보고 select 를 바꾼다(본문은 싣지 않는다 — 주문 최대 2000건):

```ts
    admin.from('agent_work_reports').select('work_order_id, review_action, review_note, created_at, decision_count')
```

Run: `npx vitest run tests/domain/seatmap-decisions.test.ts tests/domain/seatmap.test.ts tests/data/agent-seatmap.test.ts tests/data/agent-seatmap-project.test.ts`
Expected: PASS 전부.

- [ ] **Step 3: 실패하는 화면 테스트 작성**

`tests/components/agents-decisions.test.tsx`:

```tsx
// @vitest-environment jsdom
// 오피스의 결정 칩과 상세 패널 목록(과제 C, 스펙 §7.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const getReportDecisions = vi.fn()
vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: (...a: unknown[]) => getReportDecisions(...(a as [])) }))

import { SeatCard } from '@/components/agents/Seat'
import { LaneBoard } from '@/components/agents/LaneBoard'
import { DetailPanel } from '@/components/agents/DetailPanel'

const NOW = Date.parse('2026-09-23T09:00:00Z')
const seat = (over: Partial<Seat> = {}): Seat => ({
  orderId: '11111111-1111-4111-8111-111111111111', id8: '11111111', projectId: 'p1', itemId: 'i1',
  code: 'TSK-04-02', name: '주문 상세', state: 'WAIT', phase: 'reported', anim: 'idle_look', character: 'cat',
  agent: 'hong/mbp/w1', progress: 100, lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null,
  note: null, rejected: false, reviewNote: null, resumeRequestedAt: null, resumeRequestedHost: null, waitReason: null,
  canManage: true, assigneeMine: false, agentMine: false, agentOwnerName: null, ...over,
})
const map = (seats: Seat[]): Seatmap => ({
  floors: [{ id: 'p1', name: 'mes-base', seatCount: seats.length, doneCount: 0, watchers: [], leads: [],
    zones: [{ key: 'z1', code: 'WP-04', name: '주문 관리', summary: { work: 0, wait: 0, ready: 0, done: 0 }, seats }] }],
  counters: { active: 0, standby: 0, idle: 0, offline: 0 }, attention: [], fetchedAt: new Date(NOW).toISOString(), scope: 'all',
})
const OPS = { busy: false, note: null, opError: null, onOp: () => {}, onNoteChange: () => {}, onNoteConfirm: () => {}, onNoteCancel: () => {} } as const
const DEC = { key: 'D1', question: '넣는가?', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향' }

let host: HTMLDivElement, root: Root
beforeEach(() => { getReportDecisions.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('결정 칩', () => {
  it('좌석 책상에 결정 N 칩 — 1 이상일 때만', () => {
    act(() => root.render(<SeatCard seat={seat({ decisionCount: 2 })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
    expect(host.querySelector('[data-decision-chip="2"]')!.textContent).toBe('결정 2')
    for (const c of [0, null, undefined]) {
      act(() => root.render(<SeatCard seat={seat({ decisionCount: c })} side="left" selected={false} nowMs={NOW} busy={false} onSelect={() => {}} onOp={() => {}} />))
      expect(host.querySelector('[data-decision-chip]')).toBeNull()
    }
  })
  it('상태 레인 결재 대기 카드에도 칩', () => {
    act(() => root.render(<LaneBoard map={map([seat({ decisionCount: 3 })])} selectedId={null} nowMs={NOW} busyOrderId={null} showFloorName={false} onSelect={() => {}} onOp={() => {}} />))
    const card = host.querySelector('[data-lane="wait"]')!
    expect(card.querySelector('[data-decision-chip="3"]')).not.toBeNull()
  })
})

describe('상세 패널 결정 목록', () => {
  it('결재 대기 + 결정 ≥ 1 이면 열릴 때 한 번 읽어 목록을 그린다', async () => {
    getReportDecisions.mockResolvedValue({ ok: true, decisions: [DEC] })
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 1 })} nowMs={NOW} {...OPS} />) })
    expect(getReportDecisions).toHaveBeenCalledTimes(1)
    expect(getReportDecisions).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(host.querySelector('[data-decision="D1"]')).not.toBeNull()
  })
  it('조회 실패는 빈 목록이 아니라 오류 문구와 재시도 — 재시도하면 다시 읽는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getReportDecisions.mockResolvedValueOnce({ ok: false, error: 'db down' }).mockResolvedValueOnce({ ok: true, decisions: [DEC] })
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 1 })} nowMs={NOW} {...OPS} />) })
    expect(host.querySelector('[data-seat-decisions-error]')!.textContent).toContain('결정 목록을 불러오지 못했습니다')
    expect(host.querySelector('[data-decisions]')).toBeNull()
    await act(async () => { (host.querySelector('[data-seat-decisions-retry]') as HTMLButtonElement).click() })
    expect(getReportDecisions).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[data-decision="D1"]')).not.toBeNull()
  })
  it('결정이 없거나 결재 대기가 아니면 읽지 않는다', async () => {
    await act(async () => { root.render(<DetailPanel seat={seat({ decisionCount: 0 })} nowMs={NOW} {...OPS} />) })
    await act(async () => { root.render(<DetailPanel seat={seat({ state: 'ACTIVE', decisionCount: 2 })} nowMs={NOW} {...OPS} />) })
    expect(getReportDecisions).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run tests/components/agents-decisions.test.tsx`
Expected: FAIL — 칩·목록 없음.

- [ ] **Step 4: 칩 구현**

`src/components/agents/DecisionChip.tsx`:

```tsx
'use client'
// 결정 칩(과제 C, 스펙 §7.3) — 승인 대기 좌석에 워커가 스스로 고른 결정이 딸렸다는 신호.
// 말풍선(10분·2줄 클램프)과 달리 승인될 때까지 계속 보인다. 수는 좌석표의 decision_count 다(본문은 상세 패널이 읽는다).
export function DecisionChip({ count }: { count: number | null | undefined }) {
  if (count === null || count === undefined || count < 1) return null
  return (
    <span data-decision-chip={count} title={`확인 필요 결정 ${count}건 — 상세에서 목록을 확인하세요`}
      className="inline-flex shrink-0 items-center rounded-full bg-accent-warning/15 px-1.5 text-[10px] font-semibold text-accent-warning">
      결정 {count}
    </span>
  )
}
```

`src/components/agents/Seat.tsx` — import 에 더한다:

```tsx
import { DecisionChip } from './DecisionChip'
```

책상 머리를 바꾼다:

```tsx
          <span className={css.deskTop}>
            <span className={css.deskId}>{seat.code}</span>
            {owner && <OwnerTag owner={owner} />}
            <DecisionChip count={seat.decisionCount} />
            <SeatMark state={seat.state} anim={seat.anim} />
          </span>
```

`src/components/agents/LaneBoard.tsx` — import 에 더한다:

```tsx
import { DecisionChip } from './DecisionChip'
```

카드 메타 줄을 바꾼다:

```tsx
                      <span className={css.cardMeta}><PhaseBadge seat={seat} size="chip" /><DecisionChip count={seat.decisionCount} /><span className={css.deskMeta}>{seatMetaLine(seat, nowMs)}</span></span>
```

- [ ] **Step 5: 상세 패널 구현**

`src/components/agents/SeatDecisions.tsx`:

```tsx
'use client'
// 오피스 상세 패널의 결정 목록(과제 C, 스펙 §7.3) — 결재 대기 좌석이 열릴 때 좁은 조회를 한 번 한다.
// 실패는 빈 목록으로 그리지 않는다(3원칙) — 문구와 재시도를 보인다.
import { useEffect, useState } from 'react'
import { getReportDecisions } from '@/app/actions/agentWork'
import { parseDecisions, type DecisionsParse } from '@/lib/domain/agentWork'
import { DecisionList } from '@/components/agent-hub/DecisionList'

type Load = { kind: 'loading' } | { kind: 'ok'; parsed: DecisionsParse } | { kind: 'error' }

export function SeatDecisions({ orderId }: { orderId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setLoad({ kind: 'loading' })
    getReportDecisions(orderId)
      .then(r => {
        if (!alive) return
        if (r.ok) { setLoad({ kind: 'ok', parsed: parseDecisions(r.decisions) }); return }
        console.error('[SeatDecisions] 결정 목록 조회 실패:', r.error)
        setLoad({ kind: 'error' })
      })
      .catch((e: unknown) => {
        if (!alive) return
        console.error('[SeatDecisions] 결정 목록 조회 실패:', e instanceof Error ? e.message : e)
        setLoad({ kind: 'error' })
      })
    return () => { alive = false }
  }, [orderId, attempt])

  if (load.kind === 'loading') return <p data-seat-decisions-loading="" className="mt-2 text-[11px] text-ink-subtle">결정 목록을 불러오는 중…</p>
  if (load.kind === 'error') {
    return (
      <p data-seat-decisions-error="" className="mt-2 text-[11px] text-accent-warning">
        결정 목록을 불러오지 못했습니다{' '}
        <button type="button" data-seat-decisions-retry="" className="underline underline-offset-2" onClick={() => setAttempt(a => a + 1)}>다시 시도</button>
      </p>
    )
  }
  return <DecisionList decisions={load.parsed} compact />
}
```

`src/components/agents/DetailPanel.tsx` — import 에 더한다:

```tsx
import { SeatDecisions } from './SeatDecisions'
```

`{seat.rejected && <p className={css.quote}>반려 사유: …</p>}` 바로 뒤에 넣는다:

```tsx
      {/* 결정이 딸린 승인 대기 — 승인 전에 읽을 목록. 좌석표는 수만 실으므로 여기서 본문을 좁게 읽는다(과제 C). */}
      {seat.state === 'WAIT' && (seat.decisionCount ?? 0) >= 1 && <SeatDecisions key={seat.orderId} orderId={seat.orderId} />}
```

- [ ] **Step 6: 기존 오피스 테스트에 mock 한 줄**

`DetailPanel` 이 이제 `@/app/actions/agentWork` 를 import 한다(서버 액션 모듈 — 테스트에서는 목으로 바꾼다). 다음 명령으로 대상 파일을 확인한다:

```bash
grep -l "components/agents/DetailPanel\|components/agents/SeatmapView" tests -r
```

Expected: `tests/components/agents-detail-panel.test.tsx`, `tests/components/agents-seatmap-view.test.tsx`(그리고 이 Task 의 `agents-decisions.test.tsx`). 앞의 두 파일에서 `@/components/agents/…` import 보다 위에 다음 줄을 넣는다(`agents-detail-panel.test.tsx` 는 vitest import 에 `vi` 를 더한다):

```ts
vi.mock('@/app/actions/agentWork', () => ({ getReportDecisions: vi.fn(async () => ({ ok: true, decisions: [] })) }))
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/components/agents-decisions.test.tsx tests/components/agents-detail-panel.test.tsx tests/components/agents-seatmap-view.test.tsx tests/components/agents-seat.test.tsx tests/components/agents-owner.test.tsx tests/domain/seatmap-decisions.test.ts tests/domain/seatmap.test.ts`
Expected: PASS 전부.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/domain/seatmap.ts src/lib/data/agentSeatmap.ts src/components/agents/DecisionChip.tsx src/components/agents/SeatDecisions.tsx src/components/agents/Seat.tsx src/components/agents/LaneBoard.tsx src/components/agents/DetailPanel.tsx tests/domain/seatmap-decisions.test.ts tests/components/agents-decisions.test.tsx tests/components/agents-detail-panel.test.tsx tests/components/agents-seatmap-view.test.tsx
git commit -F - <<'MSG'
feat(agents): 오피스 결재 대기 좌석에 결정 칩과 상세 목록을 둔다

말풍선은 두 줄에서 잘리고 10분이 지나면 사라져 결정 접미사를 안정적으로 드러내지 못했다.
좌석표는 decision_count 만 실어 칩을 승인 때까지 보이고, 상세 패널이 열릴 때만 본문을
좁게 읽는다. 조회 실패는 빈 목록이 아니라 오류와 재시도로 보인다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 7: 결재 배지 — 확인 필요 결정 수 (UI 위험 파일 포함)

> 1·2 와 독립이라 **어느 때나 병렬 가능**하다(DB 컬럼 이름 `decision_count` 만 쓴다).

**Files:**
- Modify: `src/lib/data/agentApprovals.ts` (전면 교체)
- Modify: `src/app/api/shell/route.ts`
- Modify: `src/components/app/ShellStateProvider.tsx` — **UI 위험 파일**
- Modify: `src/components/app/Sidebar.tsx:119-126, 242-258` — **UI 위험 파일**
- Modify(Test): `tests/data/agent-approvals.test.ts` (목 확장 + describe 추가)
- Modify(Test): `tests/ui/sidebar-approval-badge.test.tsx` (describe 추가)
- Test: `tests/api/shell-route-decisions.test.ts` (새 파일)

**Interfaces:**
- Produces:
  - `pickApprovable<T extends { wbs_item_id: string | null }>(orders: readonly T[], items: readonly ItemRow[], viewer: { isAdmin: boolean; memberIds: readonly string[] }): T[]` — 종전 `countApprovable` 의 판정을 목록으로. `countApprovable` 은 `pickApprovable(...).length` 로 남는다.
  - `sumLatestDecisions(orderIds: readonly string[], reports: ReadonlyArray<{ work_order_id: string; decision_count: number | null; created_at: string }>): { known: number; partial: boolean }` — 주문마다 최신 completion 값만 더한다. 최신이 null 이거나 보고가 없으면 더하지 않고 `partial: true`.
  - `type PendingApprovals = { count: number; decisions: number | null; decisionsPartial: boolean }`
  - `getPendingApprovals(projectId: string): Promise<PendingApprovals>` — 수는 종전과 같다. 결정 수 조회만 실패하면 `decisions: null`(로그), 건수는 유지. 승인 가능 0건이면 보고 조회를 건너뛰고 `{ count: 0, decisions: 0, decisionsPartial: false }`.
  - `getPendingApprovalCount(projectId)` 는 `(await getPendingApprovals(projectId)).count` 로 남긴다(기존 시험 호환).
  - 셸 응답(`GET /api/shell`)에 `pendingDecisions: number | null`, `pendingDecisionsPartial: boolean`. 전체 실패는 종전처럼 `pendingApprovals: 0` + `pendingDecisions: null`.
  - `useShellState()` 에 `menuPendingDecisions: number | null`, `menuPendingDecisionsPartial: boolean`. 옛 응답(필드 없음)은 0 — 문구를 달지 않는다. 명시적 `null` 만 "조회 실패" 로 보인다.
  - 사이드바 에이전트 배지: 수는 그대로. title 은 `결재 대기 N건` + 접미사 — 결정 ≥ 1: ` · 확인 필요 결정 M건`, 일부 구버전: ` · 확인 필요 결정 M건 이상 · 일부 구버전 보고`, null: ` · 확인 필요 결정 수 조회 실패`. 결정 ≥ 1 이면 배지 오른쪽 위에 `[data-nav-decision-dot]`.

- [ ] **Step 1: 결재 수 테스트 — 목 확장과 새 describe**

`tests/data/agent-approvals.test.ts` 의 `m` 과 admin 목을 다음으로 바꾼다(보고 테이블 분기 추가, 나머지는 종전 그대로):

```ts
const m = vi.hoisted(() => ({
  actor: null as unknown,
  orders: [] as Array<{ id?: string; wbs_item_id: string | null }>,
  ordersError: null as { message: string } | null,
  items: [] as Array<{ id: string; parent_id: string | null; assignee_member_id: string | null }>,
  memberIds: [] as string[],
  itemReads: 0,
  reports: [] as Array<{ work_order_id: string; decision_count: number | null; created_at: string }>,
  reportsError: null as { message: string } | null,
  reportReads: 0,
  reportOrderIds: [] as string[],
}))

vi.mock('@/lib/authz', () => ({ getActorForView: async () => m.actor }))
vi.mock('@/lib/data/agentSeatmap', () => ({ viewerEmail: async () => 'me@x.com' }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: async () => m.memberIds }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'agent_work_reports') {
        m.reportReads++
        const rc = {
          select: () => rc,
          in: (_col: string, ids: string[]) => { m.reportOrderIds = ids; return rc },
          eq: async () => ({ data: m.reports, error: m.reportsError }),
        }
        return rc
      }
      const chain = {
        select: () => chain, eq: () => chain,
        limit: async () => ({ data: m.orders, error: m.ordersError }),
        then: (res: (v: unknown) => void) => { m.itemReads++; res({ data: m.items, error: null }) },
      }
      if (table !== 'agent_work_orders' && table !== 'wbs_items') throw new Error(`unexpected ${table}`)
      return chain
    },
  }),
}))

import { countApprovable, getPendingApprovalCount, getPendingApprovals, sumLatestDecisions } from '@/lib/data/agentApprovals'
```

`describe('getPendingApprovalCount'` 의 `beforeEach` 를 바꾼다:

```ts
  beforeEach(() => {
    m.actor = actor('admin'); m.orders = ORDERS; m.ordersError = null; m.items = ITEMS; m.memberIds = []; m.itemReads = 0
    m.reports = []; m.reportsError = null; m.reportReads = 0; m.reportOrderIds = []
  })
```

파일 끝에 더한다:

```ts
describe('sumLatestDecisions — 주문마다 최신 completion 만', () => {
  it('반려된 옛 회차는 합산하지 않는다', () => {
    expect(sumLatestDecisions(['o1'], [
      { work_order_id: 'o1', decision_count: 3, created_at: '2026-09-23T01:00:00Z' },
      { work_order_id: 'o1', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ])).toEqual({ known: 1, partial: false })
  })
  it('구 CLI(null)·보고 없음은 0 으로 세지 않고 partial 로 알린다', () => {
    expect(sumLatestDecisions(['o1', 'o2', 'o3'], [
      { work_order_id: 'o1', decision_count: null, created_at: '2026-09-23T01:00:00Z' },
      { work_order_id: 'o2', decision_count: 2, created_at: '2026-09-23T01:00:00Z' },
    ])).toEqual({ known: 2, partial: true })
  })
})

describe('getPendingApprovals — 확인 필요 결정 수', () => {
  const OIDS = [{ id: 'o1', wbs_item_id: 'leaf1' }, { id: 'o2', wbs_item_id: 'leaf2' }, { id: 'o3', wbs_item_id: 'leaf3' }]
  beforeEach(() => {
    m.actor = actor('admin'); m.orders = OIDS; m.ordersError = null; m.items = ITEMS; m.memberIds = []; m.itemReads = 0
    m.reports = []; m.reportsError = null; m.reportReads = 0; m.reportOrderIds = []
  })
  it('관리자 — 승인 가능 주문의 최신 completion 결정 수를 더한다', async () => {
    m.reports = [
      { work_order_id: 'o1', decision_count: 2, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: 0, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o3', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: 3, decisionsPartial: false })
  })
  it('구 CLI 보고가 섞이면 아는 수 + partial — "2건 이상 · 일부 구버전" 의 재료', async () => {
    m.reports = [
      { work_order_id: 'o1', decision_count: 2, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: null, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o3', decision_count: 0, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: 2, decisionsPartial: true })
  })
  it('서브트리 관리자는 자기 하위 주문의 결정만 센다 — 남의 서브트리 결정을 읽지 않는다', async () => {
    m.actor = actor('member'); m.memberIds = ['m-boss']
    m.reports = [
      { work_order_id: 'o1', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
      { work_order_id: 'o2', decision_count: 1, created_at: '2026-09-23T02:00:00Z' },
    ]
    expect(await getPendingApprovals(P)).toEqual({ count: 2, decisions: 2, decisionsPartial: false })
    expect(m.reportOrderIds).toEqual(['o1', 'o2'])
  })
  it('승인할 것이 없으면(리프 담당자 본인) 보고를 읽지 않는다', async () => {
    m.actor = actor('member'); m.memberIds = ['m-dev']
    expect(await getPendingApprovals(P)).toEqual({ count: 0, decisions: 0, decisionsPartial: false })
    expect(m.reportReads).toBe(0)
  })
  it('결정 수 조회만 실패하면 건수는 유지하고 decisions:null — 0 으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.reportsError = { message: 'boom' }
    expect(await getPendingApprovals(P)).toEqual({ count: 3, decisions: null, decisionsPartial: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

Run: `npx vitest run tests/data/agent-approvals.test.ts`
Expected: FAIL — `getPendingApprovals`·`sumLatestDecisions` export 없음.

- [ ] **Step 2: 결재 수 구현**

`src/lib/data/agentApprovals.ts` 를 다음으로 교체한다:

```ts
// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18 사용자 요청) — 서버 전용.
// "승인할 것이 있으면 왼쪽 에이전트 아이콘에 표시가 있어야 사람이 알 수 있다."
//
// 셸 조회(/api/shell)는 내비게이션마다 부르므로 허브 조회(getAgentHub, 8건)를 쓰지 않고 좁게 읽는다:
// 승인 대기(reported) 주문 → 0건이면 끝. 관리자는 그 수 그대로, 아니면 로스터 + 항목 트리를 읽어
// 서브트리 관리자로서 승인할 수 있는 것만 센다(seatOps.ts: 승인은 관리자·서브트리 관리자만).
// service_role 로 읽으므로 RLS 가 없다 — 판정은 여기서 세션 actor 로 직접 한다. 셸 라우트에 가드가 없어
// 임의의 menu=<uuid> 가 들어올 수 있으니, 관리자가 아니면 로스터에 내가 없을 때 0 이다(남의 프로젝트 수를 흘리지 않는다).
//
// 확인 필요 결정 수(과제 C, 스펙 §7.4) — 이미 고른 승인 가능 주문의 completion 보고에서만 센다(같은 성질을 잇는다).
// 주문마다 최신 completion 의 decision_count 만 더한다(반려된 옛 회차와 합산하지 않는다). null(구 CLI)은 0 으로 세지
// 않고 partial 로 알린다. 결정 수 조회만 실패하면 건수는 두고 decisions:null — 모름을 0 으로 위장하지 않는다.
import { createAdminClient } from '@/lib/supabase/admin'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { isSubtreeManagerOf } from '@/lib/domain/seatmap'
import { myMemberIds } from '@/lib/agent/assignee'
import { viewerEmail } from '@/lib/data/agentSeatmap'

type ItemRow = { id: string; parent_id: string | null; assignee_member_id: string | null }
type OrderRow = { id: string; wbs_item_id: string | null }
type DecisionReportRow = { work_order_id: string; decision_count: number | null; created_at: string }

/** 순수 판정 — 관리자면 전부, 아니면 내가 조상 담당자인(서브트리 관리자) 항목의 주문만. */
export function pickApprovable<T extends { wbs_item_id: string | null }>(
  orders: readonly T[],
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[] },
): T[] {
  if (viewer.isAdmin) return [...orders]
  if (viewer.memberIds.length === 0) return []
  const itemById = new Map(items.map(i => [i.id, i]))
  const mine = new Set(viewer.memberIds)
  return orders.filter(o => o.wbs_item_id !== null && isSubtreeManagerOf(o.wbs_item_id, itemById, mine))
}

export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[] },
): number {
  return pickApprovable(orders, items, viewer).length
}

/** 주문마다 최신 completion 의 결정 수 합. 최신이 null(구 CLI)이거나 보고가 없으면 더하지 않고 partial. */
export function sumLatestDecisions(orderIds: readonly string[], reports: ReadonlyArray<DecisionReportRow>): { known: number; partial: boolean } {
  const latest = new Map<string, DecisionReportRow>()
  for (const r of reports) {
    const cur = latest.get(r.work_order_id)
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latest.set(r.work_order_id, r)
  }
  let known = 0
  let partial = false
  for (const id of orderIds) {
    const n = latest.get(id)?.decision_count
    if (typeof n === 'number') known += n
    else partial = true
  }
  return { known, partial }
}

export type PendingApprovals = { count: number; decisions: number | null; decisionsPartial: boolean }
const NONE: PendingApprovals = { count: 0, decisions: 0, decisionsPartial: false }

/** 이 프로젝트에서 내가 승인할 수 있는 결재 대기 수와 거기 딸린 확인 필요 결정 수. 주문 조회 실패는 throw(호출부가 로깅). */
export async function getPendingApprovals(projectId: string): Promise<PendingApprovals> {
  if (!isUuidLike(projectId)) return NONE
  const actor = await getActorForView()
  if (!actor) return NONE
  const admin = createAdminClient()
  const { data: orders, error } = await admin.from('agent_work_orders')
    .select('id, wbs_item_id').eq('project_id', projectId).eq('status', 'reported').limit(500)
  if (error) throw new Error(`[approvals] 결재 대기 조회 실패: ${error.message}`)
  const rows = (orders ?? []) as OrderRow[]
  if (rows.length === 0) return NONE
  let approvable: OrderRow[]
  if (isProjectAdmin(actor, projectId)) {
    approvable = rows
  } else {
    const email = await viewerEmail(admin, actor.userId)
    const memberIds = await myMemberIds(admin, { userId: actor.userId, userEmail: email ?? '', projectId })
    if (memberIds.length === 0) return NONE
    const { data: items, error: itemErr } = await admin.from('wbs_items')
      .select('id, parent_id, assignee_member_id').eq('project_id', projectId)
    if (itemErr) throw new Error(`[approvals] 항목 트리 조회 실패: ${itemErr.message}`)
    approvable = pickApprovable(rows, (items ?? []) as ItemRow[], { isAdmin: false, memberIds })
  }
  if (approvable.length === 0) return NONE
  const ids = approvable.map(o => o.id)
  const { data: reps, error: repErr } = await admin.from('agent_work_reports')
    .select('work_order_id, decision_count, created_at').in('work_order_id', ids).eq('kind', 'completion')
  if (repErr) {
    console.error('[approvals] 확인 필요 결정 수 조회 실패:', repErr.message)
    return { count: approvable.length, decisions: null, decisionsPartial: false }
  }
  const s = sumLatestDecisions(ids, (reps ?? []) as DecisionReportRow[])
  return { count: approvable.length, decisions: s.known, decisionsPartial: s.partial }
}

/** 수만 필요한 호출부용(종전 이름). */
export async function getPendingApprovalCount(projectId: string): Promise<number> {
  return (await getPendingApprovals(projectId)).count
}
```

Run: `npx vitest run tests/data/agent-approvals.test.ts`
Expected: PASS 전부(종전 `countApprovable`·`getPendingApprovalCount` 시험 포함).

- [ ] **Step 3: 셸 라우트 테스트 작성**

`tests/api/shell-route-decisions.test.ts`:

```ts
// 셸 응답의 확인 필요 결정 수(과제 C, 스펙 §7.4·§10) — 배지 하나 때문에 셸을 죽이지 않되 0 으로 위장하지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const pa = vi.fn()
vi.mock('@/app/actions/inbox', () => ({ getInboxFeed: async () => ({ items: [], unseen: 0 }) }))
vi.mock('@/app/actions/notifications', () => ({ getNotifications: async () => null }))
vi.mock('@/app/actions/announcements', () => ({ getHeaderAnnouncements: async () => [], getUnreadAnnouncementCount: async () => 0 }))
vi.mock('@/lib/data/agentApprovals', () => ({ getPendingApprovals: (...a: unknown[]) => pa(...(a as [])) }))

import { GET } from '@/app/api/shell/route'

const MENU = '11111111-1111-4111-8111-111111111111'
const get = (qs: string) => GET(new NextRequest(`http://l/api/shell${qs}`))

beforeEach(() => { pa.mockReset() })

describe('GET /api/shell — 결재 대기와 결정 수', () => {
  it('메뉴 프로젝트의 수·결정 수·partial 을 싣는다', async () => {
    pa.mockResolvedValue({ count: 3, decisions: 2, decisionsPartial: true })
    const j = await (await get(`?menu=${MENU}`)).json()
    expect(j).toMatchObject({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: true })
    expect(pa).toHaveBeenCalledWith(MENU)
  })
  it('조회가 통째로 실패하면 건수 0·결정 수 null — 셸은 살린다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pa.mockRejectedValue(new Error('boom'))
    const res = await get(`?menu=${MENU}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ pendingApprovals: 0, pendingDecisions: null, pendingDecisionsPartial: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('메뉴 문맥이 없으면 부르지 않고 0', async () => {
    const j = await (await get('')).json()
    expect(j).toMatchObject({ pendingApprovals: 0, pendingDecisions: 0, pendingDecisionsPartial: false })
    expect(pa).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run tests/api/shell-route-decisions.test.ts`
Expected: FAIL — `pendingDecisions` 없음(그리고 `getPendingApprovals` 를 부르지 않음).

- [ ] **Step 4: 셸 라우트 구현**

`src/app/api/shell/route.ts` — import 를 바꾼다:

```ts
import { getPendingApprovals, type PendingApprovals } from '@/lib/data/agentApprovals'
```

`Promise.all` 의 다섯째 항목과 응답을 바꾼다:

```ts
  const [inbox, notifications, unreadAnnouncements, headerAnnouncements, approvals] = await Promise.all([
    getInboxFeed(),
    // 파생 알림은 실패해도 벨 전체를 죽이지 않는다(기존 HeaderChrome catch(() => {}) 시맨틱).
    route ? getNotifications(route).catch(() => null) : Promise.resolve(null),
    menu ? getUnreadAnnouncementCount(menu).catch(() => 0) : Promise.resolve(0),
    route ? getHeaderAnnouncements(route).catch(() => [] as Awaited<ReturnType<typeof getHeaderAnnouncements>>) : Promise.resolve([]),
    // 에이전트 메뉴의 결재 대기 배지 — 공지 배지처럼 메뉴 문맥 기준. 배지 하나 때문에 셸 전체를 죽이지 않되 로그는 남긴다.
    // 확인 필요 결정 수(과제 C)는 실패 시 null — 수는 종전처럼 0 으로 두지만 결정 수까지 0 으로 위장하지 않는다.
    menu ? getPendingApprovals(menu).catch((e: unknown): PendingApprovals => {
      console.error('[shell] 결재 대기 수 조회 실패:', e instanceof Error ? e.message : e)
      return { count: 0, decisions: null, decisionsPartial: false }
    }) : Promise.resolve<PendingApprovals>({ count: 0, decisions: 0, decisionsPartial: false }),
  ])

  return NextResponse.json(
    {
      inbox, notifications, unreadAnnouncements, headerAnnouncements,
      pendingApprovals: approvals.count,
      pendingDecisions: approvals.decisions,
      pendingDecisionsPartial: approvals.decisionsPartial,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
```

Run: `npx vitest run tests/api/shell-route-decisions.test.ts`
Expected: PASS 3건.

- [ ] **Step 5: 사이드바 테스트 작성**

`tests/ui/sidebar-approval-badge.test.tsx` 끝에 더한다(파일의 mock·import·`projects` 를 그대로 쓴다):

```tsx
function stubShellWith(extra: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      inbox: { items: [], unseen: 0 },
      notifications: { items: [], count: 0 },
      unreadAnnouncements: 0,
      headerAnnouncements: [],
      ...extra,
    }),
  })))
}

describe('Sidebar 결재 대기 배지 — 확인 필요 결정(과제 C)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/p/p1/dashboard'
    localStorage.removeItem('dflow-sidebar')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => {
      root.render(
        <ProjectNavigationProvider projects={projects} initialLastProjectId="p1">
          <ShellStateProvider>
            <Sidebar projects={projects} />
          </ShellStateProvider>
        </ProjectNavigationProvider>,
      )
    })
    await act(async () => {})
  }
  const badge = () => container.querySelector('a[href="/p/p1/agents/office"] [data-nav-badge="nav.projectAgents"]')

  it('결정이 딸리면 수는 그대로, title 에 결정 수, 배지에 점', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.textContent).toBe('3')
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 2건')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).not.toBeNull()
  })
  it('구 CLI 보고가 섞이면 "이상 · 일부 구버전 보고"', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 2, pendingDecisionsPartial: true })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 2건 이상 · 일부 구버전 보고')
  })
  it('결정 수 조회 실패(null)는 실패라고 말하고 점을 달지 않는다', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: null, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건 · 확인 필요 결정 수 조회 실패')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).toBeNull()
  })
  it('결정 0건이면 종전 그대로', async () => {
    stubShellWith({ pendingApprovals: 3, pendingDecisions: 0, pendingDecisionsPartial: false })
    await render()
    expect(badge()?.getAttribute('title')).toBe('결재 대기 3건')
    expect(badge()?.querySelector('[data-nav-decision-dot]')).toBeNull()
  })
})
```

Run: `npx vitest run tests/ui/sidebar-approval-badge.test.tsx`
Expected: 새 describe 의 첫 셋 FAIL(title 이 `결재 대기 3건` 그대로·점 없음). 종전 describe 는 PASS.

- [ ] **Step 6: 셸 상태·사이드바 구현**

`src/components/app/ShellStateProvider.tsx` — `ShellPayload` 의 `pendingApprovals?: number` 뒤에 더한다:

```ts
  /** 그 결재 대기에 딸린 확인 필요 결정 수(과제 C). null = 서버에서 조회 실패. 옛 응답(필드 없음)은 0 으로 본다. */
  pendingDecisions?: number | null
  /** 구 CLI 보고가 섞여 결정 수가 하한일 뿐인가. */
  pendingDecisionsPartial?: boolean
```

`ShellState` 의 `menuPendingApprovals: number` 뒤에 더한다:

```ts
  /** 메뉴 문맥 프로젝트의 결재 대기에 딸린 확인 필요 결정 수. null = 조회 실패(0 으로 위장하지 않는다). */
  menuPendingDecisions: number | null
  menuPendingDecisionsPartial: boolean
```

상태 선언(`const [menuPendingApprovals, …]` 아래)에 더한다:

```ts
  const [menuPendingDecisions, setMenuPendingDecisions] = useState<number | null>(0)
  const [menuPendingDecisionsPartial, setMenuPendingDecisionsPartial] = useState(false)
```

메뉴 문맥이 없을 때 초기화 줄을 바꾼다:

```ts
    if (!menuProjectId) {
      setMenuUnreadAnnouncements(0); setMenuPendingApprovals(0)
      setMenuPendingDecisions(0); setMenuPendingDecisionsPartial(false)
    }
```

응답 반영(`if (menuProjectId) { … }`)을 바꾼다:

```ts
      if (menuProjectId) {
        setMenuUnreadAnnouncements(data.unreadAnnouncements)
        setMenuPendingApprovals(data.pendingApprovals ?? 0)
        // 필드 없음(옛 응답) = 문구 없음(0), 명시적 null = 서버 조회 실패.
        setMenuPendingDecisions(data.pendingDecisions === undefined ? 0 : data.pendingDecisions)
        setMenuPendingDecisionsPartial(data.pendingDecisionsPartial === true)
      }
```

Provider value 에 두 값을 더한다:

```tsx
        menuUnreadAnnouncements, menuPendingApprovals, menuPendingDecisions, menuPendingDecisionsPartial,
        headerAnnouncements, refresh,
```

`src/components/app/Sidebar.tsx` — 컴포넌트 함수 밖(파일 상단 import 아래)에 둔다:

```tsx
/** 결재 대기 배지 title 접미사(과제 C) — 수는 바꾸지 않고 결정이 딸렸다는 신호만 준다. 모름은 0 으로 위장하지 않는다. */
function approvalDecisionSuffix(decisions: number | null, partial: boolean): string {
  if (decisions === null) return ' · 확인 필요 결정 수 조회 실패'
  if (decisions < 1) return ''
  return partial ? ` · 확인 필요 결정 ${decisions}건 이상 · 일부 구버전 보고` : ` · 확인 필요 결정 ${decisions}건`
}
```

배지 재료(119-126행)를 바꾼다:

```tsx
  const { menuUnreadAnnouncements, menuPendingApprovals, menuPendingDecisions, menuPendingDecisionsPartial } = useShellState()
  const unread = menuProjectId ? menuUnreadAnnouncements : 0
  // 에이전트 메뉴 결재 대기 배지(2026-09-18) — 내가 승인할 수 있는 완료 보고 수. 허브에 들어가지 않아도 알 수 있게.
  const pending = menuProjectId ? menuPendingApprovals : 0
  // 그 결재에 딸린 확인 필요 결정(과제 C) — 수는 그대로 두고 title·점으로만 알린다.
  const decisions = menuProjectId ? menuPendingDecisions : 0
  const decisionSuffix = pending > 0 ? approvalDecisionSuffix(decisions, menuPendingDecisionsPartial) : ''
  const badges: Partial<Record<DictKey, { count: number; tip: string; bg: string; suffix?: string; decisionDot?: boolean }>> = {
    'nav.announcements': { count: unread, tip: '', bg: 'bg-accent-secondary' },
    'nav.projectAgents': { count: pending, tip: '결재 대기 ', bg: 'bg-amber-500', suffix: decisionSuffix, decisionDot: pending > 0 && (decisions ?? 0) >= 1 },
  }
```

접힌 툴팁과 배지를 바꾼다:

```tsx
                  const tip = collapsed && badge && n
                    ? `${projectPrefix}${label} · ${badge.tip}${n}${badge.suffix ?? ''}`
                    : `${projectPrefix}${label}`
```

```tsx
                        {!collapsed && badge && n && (
                          <span data-nav-badge={item.labelKey} title={badge.tip ? `${badge.tip}${n}건${badge.suffix ?? ''}` : undefined}
                            className={`relative flex h-5 min-w-5 items-center justify-center rounded-full ${badge.bg} px-1.5 text-[10px] font-bold tabular-nums text-white`}>
                            {n}
                            {badge.decisionDot && (
                              <span aria-hidden data-nav-decision-dot className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-delayed ring-2 ring-sidebar" />
                            )}
                          </span>
                        )}
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/ui tests/data/agent-approvals.test.ts tests/api/shell-route-decisions.test.ts tests/css`
Expected: PASS 전부(`tests/css` 는 반응형 안전망 규칙 — 상태 변형 display 유틸을 쓰지 않았음을 본다).

- [ ] **Step 8: 커밋 (데이터·라우트 → UI 위험 파일 분리)**

UI 위험 파일은 따로 커밋해 되돌리기 쉽게 한다.

```bash
git add src/lib/data/agentApprovals.ts src/app/api/shell/route.ts tests/data/agent-approvals.test.ts tests/api/shell-route-decisions.test.ts
git commit -F - <<'MSG'
feat(agent): 결재 대기 수에 확인 필요 결정 수를 곁들인다

사이드바 배지만 보고는 결정이 딸린 결재인지 몰랐다. 이미 고른 승인 가능 주문의
최신 completion 에서만 결정 수를 세어 남의 서브트리 수를 흘리지 않는다. 구 CLI 보고는
0 으로 세지 않고 partial 로, 결정 수 조회 실패는 null 로 올린다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
git add src/components/app/ShellStateProvider.tsx src/components/app/Sidebar.tsx tests/ui/sidebar-approval-badge.test.tsx
git commit -F - <<'MSG'
feat(sidebar): 결재 대기 배지에 확인 필요 결정 수와 점을 단다

수는 그대로 두고 title 과 작은 점으로만 결정이 딸린 결재가 있음을 알린다.
결정 수를 모를 때(조회 실패)는 실패라고 적고, 옛 응답은 문구를 달지 않는다.
UI 위험 파일이다 — staging 반영 전 feat 브랜치를 origin 에 올려 Preview 를 남긴다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 8: CLI — `dflow.sh done --decisions`, 계약 문서 2.6

> Task 2 의 상수에만 기댄다(대조 시험). 3·4·7 과 **병렬 가능**.

**Files:**
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (`CONTRACT_VERSION` 11행, usage 36행, `cmd_done` 392-421행 앞에 결정 목록 절 추가)
- Modify: `.claude/skills/dflow-work/references/api-contract.md` (머리말 1-3행, 「v2.6 변경점」 절 신설, 엔드포인트 표 95행)
- Test: `tests/skills/dflow-done-decisions.test.ts` (새 파일)

**Interfaces:**
- Consumes: `AGENT_DECISIONS_MAX` 등 상한 상수(Task 2) — 시험이 셸 변수와 대조한다. 서버 응답의 `decisions_recorded`(Task 3).
- Produces (CLI):
  - `dflow.sh done <ref> <요약> [--auto-links] [--decisions <file>]` — 요약 뒤 플래그는 순서 무관, 모르는 플래그는 usage(exit 2). 구 호출 `done <ref> <요약> --auto-links` 는 그대로.
  - `--decisions` 선검사(push 확인·네트워크보다 먼저): 파일 없음 → exit 2 `DECISIONS_FILE …`, JSON 값이 정확히 하나가 아님 → exit 2 `DECISIONS_JSON …`, 규칙 위반 → exit 2 `DECISIONS_INVALID <서버와 같은 사유 문구>`.
  - 경고(stderr, 보고는 계속): `DECISIONS_COUNT_MISMATCH …`(요약 `확인 필요 결정 N건` 의 N ≠ 배열 길이), `DECISIONS_SUFFIX_MISSING …`(배열 ≥ 1 인데 접미사 없음), `서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.`(응답에 `decisions_recorded` 없음, exit 0).
  - `--decisions` 가 없으면 본문에 `decisions` 키가 없다(= 서버 null, 제출 안 됨).
  - 셸 상한 변수 `DECISIONS_MAX` `DECISION_OPTIONS_MIN` `DECISION_OPTIONS_MAX` `DECISION_QUESTION_MAX` `DECISION_OPTION_MAX` `DECISION_RATIONALE_MAX` `DECISION_ON_REJECT_MAX`.

- [ ] **Step 1: 실패하는 CLI 테스트 작성**

`tests/skills/dflow-done-decisions.test.ts`:

```ts
// dflow.sh done --decisions(과제 C, 스펙 §5). dflow.sh 를 가짜 curl 로 실제 실행해 본문·호출·경고를 본다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_DECISIONS_MAX, AGENT_DECISION_ON_REJECT_MAX, AGENT_DECISION_OPTION_MAX, AGENT_DECISION_OPTIONS_MAX,
  AGENT_DECISION_OPTIONS_MIN, AGENT_DECISION_QUESTION_MAX, AGENT_DECISION_RATIONALE_MAX,
} from '@/lib/domain/agentWork'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}`
const PID = '11111111-1111-4111-8111-111111111111'
const WORK_ID = '99999999-9999-4999-8999-999999999999'

// 가짜 curl: api_raw 의 호출 꼴(-sS -o file -w fmt -X M -H … [--data json] url)을 흉내 낸다.
// 모든 호출 URL 을 CALLS_FILE 에, report 본문을 BODY_FILE 에 남긴다. report 응답은 FAKE_REPORT_BODY 로 바꾼다.
function fakeCurl() {
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
printf '%s\\n' "$url" >> "$CALLS_FILE"
code=200; body='{}'
case "$url" in
  *"/agent/work/${WORK_ID}/report")
    printf '%s' "$data" > "$BODY_FILE"
    body="\${FAKE_REPORT_BODY:-}"
    [ -n "$body" ] || body='{"ok":true,"status":"reported","decisions_recorded":0}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`
}

let tmp: string, repo: string
const callsFile = () => join(tmp, 'calls.txt')
const bodyFile = () => join(tmp, 'body.json')

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], {
    encoding: 'utf8', cwd: repo,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(tmp, 'home'), XDG_CACHE_HOME: join(tmp, 'cache'),
      DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
      DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_ID: PID,
      CALLS_FILE: callsFile(), BODY_FILE: bodyFile(),
      ...env,
    },
  })
}
const sentBody = () => JSON.parse(readFileSync(bodyFile(), 'utf8')) as Record<string, unknown>
const D = (key: string, over: Record<string, unknown> = {}) => ({
  key, question: '넣는가?', options: ['아니오', '예'], chosen: 0, rationale: '근거', on_reject: '방향', ...over,
})
function decisionsFile(v: unknown, raw?: string) {
  const f = join(tmp, 'decisions.json')
  writeFileSync(f, raw ?? JSON.stringify(v))
  return f
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-done-dec-'))
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home'))
  writeFileSync(join(tmp, 'bin/curl'), fakeCurl(), { mode: 0o755 })
  // cmd_done 은 실제 git 으로 브랜치·push 도달을 확인한다 — 로컬 저장소 + 로컬 bare 원격.
  repo = join(tmp, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@test.local'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo })
  writeFileSync(join(repo, 'f.txt'), 'x')
  execFileSync('git', ['add', 'f.txt'], { cwd: repo })
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
  const bare = join(tmp, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', bare])
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('done --decisions — 본문', () => {
  it('플래그 순서와 무관하게 결정 목록을 trim 해 싣는다', () => {
    const f = decisionsFile([D('D1', { question: '  넣는가?  ' }), D('D2', { chosen: 1 })])
    const sum = '끝 — 확인 필요 결정 2건: 넣는가; 넣는가'
    for (const args of [['--decisions', f, '--auto-links'], ['--auto-links', '--decisions', f]]) {
      const r = run(['done', WORK_ID, sum, ...args], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported","decisions_recorded":2}' })
      expect(r.status, r.stderr).toBe(0)
      const b = sentBody()
      expect((b.decisions as unknown[]).length).toBe(2)
      expect((b.decisions as Array<Record<string, unknown>>)[0].question).toBe('넣는가?')
      expect(b.evidence).toHaveProperty('head_sha')
      expect(r.stderr).not.toContain('DECISIONS_')
      expect(r.stderr).not.toContain('서버가 결정 목록')
    }
  })
  it('--decisions 가 없으면 본문에 decisions 키가 없다(제출 안 됨)', () => {
    expect(run(['done', WORK_ID, '끝', '--auto-links']).status).toBe(0)
    expect(sentBody()).not.toHaveProperty('decisions')
    expect(run(['done', WORK_ID, '끝']).status).toBe(0)
    expect(sentBody()).not.toHaveProperty('decisions')
  })
  it('[] 는 0건 명시로 싣고 접미사가 없어도 경고하지 않는다', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])])
    expect(r.status).toBe(0)
    expect(sentBody().decisions).toEqual([])
    expect(r.stderr).not.toContain('DECISIONS_')
    expect(r.stderr).not.toContain('서버가 결정 목록')
  })
  it('모르는 플래그는 usage(exit 2) — 보고하지 않는다', () => {
    const r = run(['done', WORK_ID, '끝', '--decision', 'x'])
    expect(r.status).toBe(2)
    expect(existsSync(callsFile())).toBe(false)
  })
})

describe('done --decisions — 선검사는 push 확인·네트워크보다 먼저', () => {
  it('형식 위반은 exit 2 와 서버와 같은 사유 — push 되지 않은 HEAD 에서도 push 오류보다 먼저, curl 호출 없음', () => {
    writeFileSync(join(repo, 'g.txt'), 'y')
    execFileSync('git', ['add', 'g.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'unpushed'], { cwd: repo })
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([D('D1', { chosen: 2 })])])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('DECISIONS_INVALID decisions[0].chosen이 options 범위를 벗어났습니다.')
    expect(r.stderr).not.toContain('git push')
    expect(existsSync(callsFile())).toBe(false)
  })
  it('형식이 맞아도 push 확인은 그대로 한다', () => {
    writeFileSync(join(repo, 'g.txt'), 'y')
    execFileSync('git', ['add', 'g.txt'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'unpushed'], { cwd: repo })
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('git push')
    expect(existsSync(callsFile())).toBe(false)
  })
  it('파일 없음·JSON 아님·빈 파일은 exit 2', () => {
    expect(run(['done', WORK_ID, '끝', '--decisions', join(tmp, 'nope.json')]).stderr).toContain('DECISIONS_FILE')
    expect(run(['done', WORK_ID, '끝', '--decisions', decisionsFile(null, '[{')]).stderr).toContain('DECISIONS_JSON')
    const empty = run(['done', WORK_ID, '끝', '--decisions', decisionsFile(null, '')])
    expect(empty.status).toBe(2)
    expect(empty.stderr).toContain('DECISIONS_JSON')
    expect(existsSync(callsFile())).toBe(false)
  })
  it.each([
    ['배열 아님', { a: 1 }, 'decisions는 배열이어야 합니다.'],
    ['21건', Array.from({ length: 21 }, (_, i) => D(`D${i + 1}`)), 'decisions는 20건 이하여야 합니다.'],
    ['알 수 없는 필드', [D('D1', { note: 'x' })], 'decisions[0]에 알 수 없는 필드: note'],
    ['key 형식', [D('D0')], 'decisions[0].key는 D1~D99 형식이어야 합니다.'],
    ['key 중복', [D('D1'), D('D1')], 'decisions[1].key가 중복됩니다: D1'],
    ['공백만 있는 question', [D('D1', { question: '   ' })], 'decisions[0].question은 1~300자여야 합니다.'],
    ['한글 301자 question', [D('D1', { question: '가'.repeat(301) })], 'decisions[0].question은 1~300자여야 합니다.'],
    ['선택지 1개', [D('D1', { options: ['a'] })], 'decisions[0].options는 2~6개여야 합니다.'],
    ['공백 선택지', [D('D1', { options: ['a', ' '] })], 'decisions[0].options[1]는 1~200자여야 합니다.'],
    ['chosen 문자열', [D('D1', { chosen: '아니오' })], 'decisions[0].chosen은 정수여야 합니다.'],
    ['on_reject 없음', [{ key: 'D1', question: 'q', options: ['a', 'b'], chosen: 0, rationale: 'r' }], 'decisions[0].on_reject는 1~500자여야 합니다.'],
  ])('%s → exit 2', (_n, v, msg) => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile(v)])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(`DECISIONS_INVALID ${msg}`)
  })
  it('한글 300자·이모지 300자 question 은 통과 — 서버와 같은 코드포인트 경계', () => {
    for (const q of ['가'.repeat(300), '😀'.repeat(300)]) {
      const r = run(['done', WORK_ID, '끝 — 확인 필요 결정 1건: q', '--decisions', decisionsFile([D('D1', { question: q })])])
      expect(r.status, r.stderr).toBe(0)
    }
  })
})

describe('done --decisions — 경고(보고는 계속)', () => {
  it('요약의 N 과 목록 건수가 다르면 DECISIONS_COUNT_MISMATCH', () => {
    const r = run(['done', WORK_ID, '끝 — 확인 필요 결정 3건: a; b; c', '--decisions', decisionsFile([D('D1'), D('D2')])])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('DECISIONS_COUNT_MISMATCH 요약은 3건, 목록은 2건')
  })
  it('목록이 있는데 접미사가 없으면 DECISIONS_SUFFIX_MISSING', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([D('D1')])])
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('DECISIONS_SUFFIX_MISSING')
  })
  it('구 서버(응답에 decisions_recorded 없음)면 경고하고 exit 0', () => {
    const r = run(['done', WORK_ID, '끝', '--decisions', decisionsFile([])], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported"}' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.')
  })
  it('--decisions 없이 구 서버에 보고하면 그 경고를 내지 않는다', () => {
    const r = run(['done', WORK_ID, '끝'], { FAKE_REPORT_BODY: '{"ok":true,"status":"reported"}' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('서버가 결정 목록을 모릅니다')
  })
})

describe('상한·계약 버전 — 서버 상수와 같다', () => {
  const src = readFileSync(DFLOW, 'utf8')
  const v = (name: string) => Number((src.match(new RegExp(`^${name}=(\\d+)$`, 'm')) ?? [])[1])
  it('셸 상한 변수 = agentWork.ts 상수', () => {
    expect(v('DECISIONS_MAX')).toBe(AGENT_DECISIONS_MAX)
    expect(v('DECISION_OPTIONS_MIN')).toBe(AGENT_DECISION_OPTIONS_MIN)
    expect(v('DECISION_OPTIONS_MAX')).toBe(AGENT_DECISION_OPTIONS_MAX)
    expect(v('DECISION_QUESTION_MAX')).toBe(AGENT_DECISION_QUESTION_MAX)
    expect(v('DECISION_OPTION_MAX')).toBe(AGENT_DECISION_OPTION_MAX)
    expect(v('DECISION_RATIONALE_MAX')).toBe(AGENT_DECISION_RATIONALE_MAX)
    expect(v('DECISION_ON_REJECT_MAX')).toBe(AGENT_DECISION_ON_REJECT_MAX)
  })
  it('CONTRACT_VERSION = 서버 AGENT_CONTRACT_VERSION = 계약 문서 머리말', () => {
    const cli = (src.match(/^CONTRACT_VERSION=([\d.]+)$/m) ?? [])[1]
    const server = (readFileSync(join(ROOT, 'src/lib/agent/externalApi.ts'), 'utf8').match(/AGENT_CONTRACT_VERSION = '([\d.]+)'/) ?? [])[1]
    const doc = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/api-contract.md'), 'utf8')
    expect(cli).toBe('2.6')
    expect(server).toBe(cli)
    expect(doc).toContain(`# D'Flow Agent API 계약 v${cli}`)
    expect(doc).toContain('## v2.6 변경점')
  })
  it('usage 가 --decisions 를 안내한다', () => {
    expect(src).toContain('done <ref> <요약> [--auto-links] [--decisions <file>]')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-done-decisions.test.ts`
Expected: FAIL — `--decisions` 가 무시되고(본문에 없음) usage·상한 변수·계약 2.6 없음.

- [ ] **Step 3: `dflow.sh` 구현**

`CONTRACT_VERSION=2.5` 를 바꾼다:

```sh
CONTRACT_VERSION=2.6
```

usage 의 `done` 줄을 바꾼다:

```
  done <ref> <요약> [--auto-links] [--decisions <file>]
                         --decisions: 확인 필요 결정 목록(JSON 배열). 형식 오류는 push 확인·전송 전에 exit 2
```

`cmd_done() {` 바로 위에 결정 목록 절을 넣는다:

```sh
# ---- 결정 목록(과제 C, 계약 2.6) ------------------------------------------
# 상한은 src/lib/domain/agentWork.ts 의 AGENT_DECISION* 상수와 같다(tests/skills/dflow-done-decisions.test.ts 가 대조).
DECISIONS_MAX=20
DECISION_OPTIONS_MIN=2
DECISION_OPTIONS_MAX=6
DECISION_QUESTION_MAX=300
DECISION_OPTION_MAX=200
DECISION_RATIONALE_MAX=1000
DECISION_ON_REJECT_MAX=500
# 서버 validateDecisions 와 같은 규칙·같은 사유 문구. 위반이면 첫 사유 한 줄, 통과면 빈 출력.
# 글자 수는 trim 뒤 코드포인트(jq length) — 서버 Array.from(s.trim()).length 와 같은 축이다.
DECISIONS_JQ='
def tr: gsub("^[[:space:]]+|[[:space:]]+$"; "");
def txt($m): if type == "string" then (tr | length) as $n | ($n >= 1 and $n <= $m) else false end;
def fields: ["key", "question", "options", "chosen", "rationale", "on_reject"];
def badopt: [ .options | to_entries[] | select(.value | txt($opmax) | not) | .key ] | .[0];
if type != "array" then "decisions는 배열이어야 합니다."
elif length > $max then "decisions는 \($max)건 이하여야 합니다."
else
  . as $all
  | [ to_entries[] | .key as $i | .value as $d | "decisions[\($i)]" as $p
      | if ($d | type) != "object" then "\($p)는 객체여야 합니다."
        elif ([ $d | keys[] | select(. as $k | fields | index([$k]) | not) ] | length) > 0
          then "\($p)에 알 수 없는 필드: \([ $d | keys[] | select(. as $k | fields | index([$k]) | not) ][0])"
        elif ($d | .key | (type != "string") or (test("^D[1-9][0-9]?$") | not)) then "\($p).key는 D1~D99 형식이어야 합니다."
        elif any($all[0:$i][]; (type == "object") and (.key == ($d | .key))) then "\($p).key가 중복됩니다: \($d | .key)"
        elif ($d | .question | txt($qmax) | not) then "\($p).question은 1~\($qmax)자여야 합니다."
        elif ($d | .options | (type != "array") or (length < $omin) or (length > $omax)) then "\($p).options는 \($omin)~\($omax)개여야 합니다."
        elif ($d | badopt) != null then "\($p).options[\($d | badopt)]는 1~\($opmax)자여야 합니다."
        elif ($d | .chosen | (type != "number") or (. != floor)) then "\($p).chosen은 정수여야 합니다."
        elif ($d | .chosen < 0 or .chosen >= (.options | length)) then "\($p).chosen이 options 범위를 벗어났습니다."
        elif ($d | .rationale | txt($rmax) | not) then "\($p).rationale은 1~\($rmax)자여야 합니다."
        elif ($d | .on_reject | txt($jmax) | not) then "\($p).on_reject는 1~\($jmax)자여야 합니다."
        else empty end ]
  | .[0] // empty
end'

check_decisions() { # $1=파일 → stdout: trim 한 압축 JSON 배열. 위반이면 exit 2(보고하지 않는다)
  [ -f "$1" ] || die 2 "DECISIONS_FILE 파일이 없습니다: $1"
  # JSON 값이 정확히 하나여야 한다 — 빈 파일은 입력 0개라 검사가 조용히 통과하고 "제출 안 됨" 이 돼 버린다.
  _ndoc=$(jq -s 'length' "$1" 2>/dev/null) || die 2 "DECISIONS_JSON JSON 이 아닙니다: $1"
  [ "$_ndoc" = 1 ] || die 2 "DECISIONS_JSON JSON 값이 하나여야 합니다(현재 $_ndoc개): $1"
  _derr=$(jq -r --argjson max "$DECISIONS_MAX" --argjson omin "$DECISION_OPTIONS_MIN" --argjson omax "$DECISION_OPTIONS_MAX" \
    --argjson qmax "$DECISION_QUESTION_MAX" --argjson opmax "$DECISION_OPTION_MAX" \
    --argjson rmax "$DECISION_RATIONALE_MAX" --argjson jmax "$DECISION_ON_REJECT_MAX" \
    "$DECISIONS_JQ" "$1") || die 2 "DECISIONS_JSON 검사 실패: $1"
  [ -z "$_derr" ] || die 2 "DECISIONS_INVALID $_derr"
  jq -c 'def tr: gsub("^[[:space:]]+|[[:space:]]+$"; "");
    map({key, question: (.question | tr), options: (.options | map(tr)), chosen,
         rationale: (.rationale | tr), on_reject: (.on_reject | tr)})' "$1" || die 2 "DECISIONS_JSON 변환 실패: $1"
}

decisions_suffix_warn() { # $1=요약 $2=결정 JSON 배열 — 요약 접미사와 건수가 어긋나면 stderr 경고만(보고는 계속)
  _dn=$(printf '%s' "$2" | jq 'length')
  _sn=$(printf '%s' "$1" | LC_ALL=C sed -n 's/.*확인 필요 결정 \([0-9][0-9]*\)건.*/\1/p' | head -n 1)
  if [ -n "$_sn" ] && [ "$_sn" != "$_dn" ]; then
    printf 'DECISIONS_COUNT_MISMATCH 요약은 %s건, 목록은 %s건 — design.md 절과 decisions.json 을 대조하세요(보고는 계속).\n' "$_sn" "$_dn" >&2
  elif [ -z "$_sn" ] && [ "$_dn" -gt 0 ]; then
    printf 'DECISIONS_SUFFIX_MISSING 목록은 %s건인데 요약에 「확인 필요 결정 N건」 접미사가 없습니다(보고는 계속).\n' "$_dn" >&2
  fi
}
```

`cmd_done` 을 다음으로 교체한다(push 확인·auto-links 수집 본문은 종전과 같다):

```sh
cmd_done() {
  _ref="$1"; _sum="$2"; shift 2
  _auto=''; _dfile=''
  # 요약 뒤 인자는 순서 무관 플래그다(종전에는 셋째 위치 인자만 --auto-links 로 봤다).
  while [ $# -gt 0 ]; do
    case "$1" in
      --auto-links) _auto=1; shift ;;
      --decisions)  [ $# -ge 2 ] || usage; _dfile="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  # 결정 목록 선검사 — push 확인·네트워크보다 먼저 한다. 형식 오류로 보고가 반쯤 나가는 일이 없다(스펙 §5.2).
  _decisions=''
  if [ -n "$_dfile" ]; then
    _decisions=$(check_decisions "$_dfile") || exit $?
    decisions_suffix_warn "$_sum" "$_decisions"
  fi
  _id=$(resolve_ref "$_ref")
  # 완료 = push 완료(결정 C-③) — 현재 브랜치 tip 이 원격에 도달했는지 확인, 미도달이면 보고 거부.
  _branch=$(git branch --show-current 2>/dev/null)
  [ -n "$_branch" ] || die 2 "git 브랜치를 확인할 수 없습니다 — 리포 안에서 실행하세요."
  _local=$(git rev-parse HEAD 2>/dev/null)
  _remote=$(git ls-remote origin "refs/heads/$_branch" 2>/dev/null | cut -f1)
  [ -n "$_remote" ] || die 2 "원격에 브랜치 $_branch 가 없습니다 — git push 후 다시 시도하세요."
  [ "$_remote" = "$_local" ] || die 2 "로컬 HEAD 가 원격에 반영되지 않았습니다 — git push 후 다시 시도하세요."
  _links='[]'; _evidence='{}'
  if [ -n "$_auto" ]; then
    _sha=$(git rev-parse HEAD 2>/dev/null || printf '')
    _branch=$(git branch --show-current 2>/dev/null || printf '')
    _remote=$(git remote get-url origin 2>/dev/null || printf '')
    _pr=$(command -v gh >/dev/null 2>&1 && gh pr view --json url -q .url 2>/dev/null || printf '')
    _links=$(jq -nc --arg r "$_remote" --arg p "$_pr" \
      '[ (if $r|startswith("http") then {label:"repo", url:$r} else empty end),
         (if $p != "" then {label:"pr", url:$p} else empty end) ]') || die 2 "링크 JSON 생성 실패"
    _evidence=$(jq -nc --arg b "$_branch" --arg h "$_sha" --arg r "$_remote" --arg p "$_pr" \
      '{branch:$b, head_sha:$h}
       + (if $r|startswith("http") then {repo_url:$r} else {} end)
       + (if $p != "" then {pr_url:$p} else {} end)') || die 2 "증적 JSON 생성 실패"
  fi
  # claim·progress 와 같은 신원 산출 — 완료 보고도 heartbeat_agent 와 귀속을 맞춘다.
  _json=$(jq -nc --arg a "$(agent_id_default)" --arg s "$_sum" \
     --argjson l "$_links" --argjson e "$_evidence" \
     '{agent:$a, kind:"completion", percent:100, summary:$s, links:$l, evidence:$e}') || die 2 "보고 JSON 생성 실패"
  # --decisions 가 없으면 키를 넣지 않는다 — 서버 행은 null(제출 안 됨). [] 는 0건 명시다.
  if [ -n "$_decisions" ]; then
    _json=$(printf '%s' "$_json" | jq -c --argjson d "$_decisions" '. + {decisions: $d}') || die 2 "보고 JSON 생성 실패"
  fi
  _body=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" "$_json") || exit $?
  # 구 서버(계약 < 2.6)는 모르는 필드를 조용히 버린다 — 응답에 decisions_recorded 가 없으면 알린다.
  # 보고 자체는 이미 됐으므로 실패로 만들지 않는다(스펙 D9).
  if [ -n "$_decisions" ] && ! printf '%s' "$_body" | jq -e 'has("decisions_recorded")' >/dev/null 2>&1; then
    printf '%s\n' '서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.' >&2
  fi
  printf '%s' "$_body" | jq -r '"reported(승인 대기) — PM 승인은 웹에서"'
}
```

- [ ] **Step 4: 계약 문서 2.6**

`.claude/skills/dflow-work/references/api-contract.md` — 1행을 바꾼다:

```markdown
# D'Flow Agent API 계약 v2.6
```

3행(`contract_version: "2.5"` 로 시작하는 줄)을 바꾼다 — 끝에 v2.6 한 문장을 더한다:

```markdown
`contract_version: "2.6"` — v1(전역 시크릿) 계약은 불변 유지, v2는 PAT 축 추가. v2.1은 stage 워크플로 재설계(0082) 반영, v2.2는 그 뒤 버전을 안 올린 채 넓혀온 세 필드를 뒤늦게 반영. v2.3은 단계 전이 원자화(0096)·실적 크레딧·선행 충족 세 축을 반영. v2.4는 `/me` 에 토큰 이름·prefix 를 더했다. v2.5는 팀장 lease 를 더했다. v2.6은 완료 보고의 결정 목록(`decisions`)을 더했다.
```

(3행의 v2.4 문장이 위와 다르면 v2.4·v2.5 문장은 원문 그대로 두고 `contract_version: "2.6"` 과 마지막 v2.6 문장만 바꾼다.)

`## v2.5 변경점 (2026-09-23)` 바로 위에 절을 넣는다:

```markdown
## v2.6 변경점 (2026-09-23)

전부 **additive** 다 — `decisions` 를 보내지 않는 요청은 응답의 새 키 하나(`decisions_recorded: null`) 말고는 그대로다.

- `POST /api/v1/agent/work/{id}/report` 에 선택 필드 `decisions` — 워커가 기본값 없는 분기에서 스스로 고른 결정 목록(0102).
  - **PAT + `kind=completion` 에서만** 받는다. progress 에 실리면 400 `decisions는 완료 보고(kind=completion)에서만 받습니다.`, 레거시(v1) 호출이면 400 `decisions는 PAT 호출에서만 받습니다.`
  - 배열 0~20건. 항목 `{key, question, options, chosen, rationale, on_reject}` — `key` `^D[1-9][0-9]?$`(보고 안에서 유일), `question` 1~300자, `options` 2~6개·각 1~200자, `chosen` = 택한 선택지의 **0부터 센 정수 색인**(문구가 아니다), `rationale` 1~1000자, `on_reject` 1~500자. 글자 수는 trim 뒤 코드포인트. 알 수 없는 필드는 400. 사유는 필드 경로를 담는다(예 `decisions[2].chosen이 options 범위를 벗어났습니다.`).
  - `[]` 는 "0건" 명시로 저장한다. 필드를 빼면 행은 `null` = "제출 안 됨"(화면은 "결정 목록 미제출").
  - completion 응답에 `decisions_recorded` — 보내지 않았으면 `null`, 보냈으면 저장 건수. **이 키가 없으면 서버가 2.6 미만**이라 결정이 버려진 것이다(요약 접미사 `확인 필요 결정 N건: …` 으로만 전달됨).
- `GET /api/v1/agent/work/{id}` PAT 응답의 `reports[]` 에 `decisions`(evidence 와 같은 규칙, 레거시 불변).
- CLI: `dflow.sh done <ref> <요약> [--auto-links] [--decisions <file>]` — 파일을 서버와 같은 규칙으로 **push 확인·전송 전에** 검사해 위반이면 exit 2(`DECISIONS_FILE`·`DECISIONS_JSON`·`DECISIONS_INVALID <사유>`). 요약 접미사 N 과 건수가 다르면 `DECISIONS_COUNT_MISMATCH`, 목록이 있는데 접미사가 없으면 `DECISIONS_SUFFIX_MISSING`, 구 서버면 `서버가 결정 목록을 모릅니다(계약 < 2.6) …` 경고(셋 다 exit 0).
```

엔드포인트 표의 report 행을 바꾼다:

```markdown
| POST `/api/v1/agent/work/{id}/report` | legacy·pat | 위와 같음 + PAT는 `evidence` 객체 허용 · PAT completion 은 `decisions` 배열 허용(v2.6) |
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/skills/dflow-done-decisions.test.ts tests/skills/dflow-claim-identity.test.ts tests/skills/shell-syntax.test.ts tests/skills/dflow-key-select.test.ts`
Expected: PASS 전부(`dflow-claim-identity` 의 `done` 두 형태 회귀 없음, `sh -n` 통과).

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/references/api-contract.md tests/skills/dflow-done-decisions.test.ts
git commit -F - <<'MSG'
feat(dflow-work): done --decisions 로 결정 목록을 보낸다(계약 2.6)

design.md 절을 셸에서 파싱하면 모양이 조금만 바뀌어도 조용히 덜 읽는다 — 이 과제가 없애려는
"결정이 승인자에게 안 닿는" 사고 그 자체다. 워커가 만든 JSON 을 서버와 같은 규칙으로
push 확인 전에 검사해 크게 실패하게 하고, 구 서버에서 결정이 버려지면 경고로 알린다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 9: 워커 규칙·스킬 문서

> Task 8 의 명령·경고 문구를 인용하므로 8 뒤.

**Files:**
- Modify: `.claude/skills/dflow-team/references/worker-prompt.md` (「6. 판단 규칙」 131-140행, 7번 결과 표 `done` 행 183행)
- Modify: `.claude/skills/dflow-dev/SKILL.md` (Phase 06 3번 272-273행, 워커 모드 표 D행 297행)
- Modify: `.claude/skills/dflow-work/SKILL.md:144-150`, `.claude/skills/dflow-work/README.md:119-125, 144`, `.claude/skills/dflow-work/references/troubleshooting.md` (exit 2 절)
- Modify: `.claude/skills/dflow-team/SKILL.md:448, 634` (`info/exclude` 패턴과 설명)
- Modify(Test): `tests/skills/worker-decide-and-notify.test.ts`, `tests/skills/dflow-team.test.ts`, `tests/skills/dflow-dev-worker.test.ts`(원문 보존 목록 `CHANGED` 에 한 줄)

**Interfaces:**
- Consumes: `dflow.sh done … --decisions <file>` 와 경고 코드 `DECISIONS_COUNT_MISMATCH`·`DECISIONS_SUFFIX_MISSING`·`서버가 결정 목록을 모릅니다(계약 < 2.6)` (Task 8), 결정 항목 여섯 필드(Task 2)
- Produces: 워커·supervised 모두 Phase 06 에서 `docs/tasks/<TSK>/decisions.json`(0건이면 `[]`)을 만들어 `done --decisions` 로 넘기고, 성공하면 지운다. 팀장 부트스트랩의 공유 `info/exclude` 에 `docs/tasks/*/decisions.json`.

- [ ] **Step 1: 실패하는 문서 테스트 작성**

`tests/skills/worker-decide-and-notify.test.ts` 의 describe 끝에 더한다(경로 표기가 `{TASK_DIR}` 로 바뀌어도 깨지지 않게 파일명·플래그·규칙 문구만 본다):

```ts
  it('Phase 06 은 결정 목록을 decisions.json 으로 옮겨 done --decisions 로 넘기고, 0건이면 [] 를 쓴다(과제 C)', () => {
    for (const doc of [prompt, dev]) {
      expect(doc).toContain('decisions.json')
      expect(doc).toContain('--decisions')
    }
    expect(prompt).toContain('**0건이면 `[]` 를 써서 넘긴다**')
    expect(prompt).toContain('`done --auto-links --decisions …`')
    expect(prompt).toContain('`chosen`(택한 선택지의 0부터 센 색인 — 문구가 아니다)')
    expect(dev).toContain('supervised 모드(플래그 없음)도 넘긴다')
    expect(dev).toContain('done 이 exit 0 이면 지우고')
  })
  it('dflow-work 문서가 --decisions 와 경고 코드의 뜻을 안내한다', () => {
    const skill = readFileSync(join(ROOT, '.claude/skills/dflow-work/SKILL.md'), 'utf8')
    const trouble = readFileSync(join(ROOT, '.claude/skills/dflow-work/references/troubleshooting.md'), 'utf8')
    expect(skill).toContain('--decisions')
    for (const code of ['DECISIONS_INVALID', 'DECISIONS_COUNT_MISMATCH', 'DECISIONS_SUFFIX_MISSING', '서버가 결정 목록을 모릅니다']) {
      expect(trouble).toContain(code)
    }
  })
```

`tests/skills/dflow-team.test.ts` 의 `it('전제 검사: …')` 안, exclude 패턴 `for` 루프 바로 뒤에 더한다:

```ts
    // 결정 목록 전송 파일(과제 C) — 커밋하지 않는 워커 부산물이라 .result 와 같은 자리에서 뺀다.
    expect(s()).toMatch(/'[^']*tasks\/\*\/decisions\.json'/)
```

`tests/skills/dflow-dev-worker.test.ts` 는 `dflow-dev/SKILL.md` 의 표지 블록 밖 원문 줄이 fixture 순서대로 남아 있는지 본다. Step 3 이 Phase 06 3번의 원문 줄 ``   `dflow.sh done <ref> "<요약>" --auto-links`.`` 를 바꾸므로, 그 파일 머리 주석의 절차(3번)대로 `CHANGED` 배열 끝(`'## Phase 5 — 마감 (오케스트레이터 본인)',` 뒤)에 이유 주석과 함께 더한다(fixture 는 손대지 않는다):

```ts
  // 10. Phase 06 3번: 결정 목록을 done --decisions 로 넘긴다(과제 C, docs/superpowers/specs/2026-09-23-worker-decision-report-design.md §6)
  '   `dflow.sh done <ref> "<요약>" --auto-links`.',
```

Run: `npx vitest run tests/skills/worker-decide-and-notify.test.ts tests/skills/dflow-team.test.ts tests/skills/dflow-dev-worker.test.ts`
Expected: 새 단정 FAIL, 그리고 `dflow-dev-worker` 의 「CHANGED 줄은 현재 파일에 남아 있지 않다」 가 FAIL(아직 원문 줄이 있다) — Step 3 뒤에 통과한다.

- [ ] **Step 2: `worker-prompt.md` 수정**

「6. 판단 규칙」 에서 `- 이 결정들은 Phase 06 의 `done` 요약 끝에 …` 항목(끝이 `0건이면 붙이지 않는다.`) 바로 뒤에 항목을 넣는다:

```markdown
- 절의 결정마다 번호 `D1`, `D2` … 를 붙인다. 반려 사유와 D'Flow 화면이 이 번호로 결정을 가리킨다.
  Phase 06 에서 그 절을 `docs/tasks/{TSK}/decisions.json` 으로 옮기고
  `done {ID8} "<요약>" --auto-links --decisions docs/tasks/{TSK}/decisions.json` 으로 넘긴다. 파일은 결정 항목의 JSON
  배열이고 항목은 여섯 필드다: `key`(절의 번호), `question`, `options`(2~6개), `chosen`(택한 선택지의 0부터 센 색인 — 문구가 아니다),
  `rationale`(근거와 그 강약 순위), `on_reject`(반려되면 재작업할 방향). 예:
  `[{"key":"D1","question":"판정 로직을 이 Task 에서 넣는가?","options":["넣지 않는다(spec 제약 우선)","넣는다"],"chosen":0,"rationale":"spec 본문이 넣지 않는다고 적었다. spec > 미승인 선행.","on_reject":"판정 로직을 verdict.ts 로 옮긴다."}]`
  **0건이면 `[]` 를 써서 넘긴다** — 파일을 넘기지 않으면 서버는 "결정 목록 미제출" 로 보고 0건과 가르지 못한다.
  이 파일은 커밋하지 않는다(정본은 design.md 절과 서버의 보고 행이다). `done` 이 `DECISIONS_INVALID …` 로 exit 2 면
  파일을 고쳐 다시 부른다. 요약 끝의 `확인 필요 결정 N건: …` 과 `.result` 의 `(결정 N건)` 은 그대로 둔다 —
  구 서버에서 결정이 남는 유일한 자리이고, 팀장은 `.result` 를 읽는다.
```

7번 결과 표의 `done` 행을 바꾼다:

```markdown
| `done` | Phase 06 까지 마치고 `done --auto-links --decisions …` 가 exit 0 | 한 줄 요약. 6번의 확인 필요 결정이 있으면 끝에 `(결정 N건)` |
```

- [ ] **Step 3: `dflow-dev/SKILL.md` 수정**

Phase 06 의 3번 항목을 바꾼다:

```markdown
3. `dflow.sh show <ref>` 로 spec 개정 여부 최종 확인(낡은 명세로 done 방지) →
   `docs/tasks/<TSK>/decisions.json` 작성 →
   `dflow.sh done <ref> "<요약>" --auto-links --decisions docs/tasks/<TSK>/decisions.json`.
   decisions.json 은 design.md `## 담당자 확인 필요 결정` 절의 결정 목록이다 — JSON 배열, 항목은 `key`(절의 번호 `D1`…)·
   `question`·`options`(2~6개)·`chosen`(택한 선택지의 0부터 센 색인)·`rationale`·`on_reject`. 절이 없거나 0건이면 `[]` 를 쓴다.
   supervised 모드(플래그 없음)도 넘긴다 — 사람과 대화로 정한 결정은 확인이 끝났으므로 `[]` 다. 이렇게 해야 서버의
   `null` 이 "구 도구" 한 가지 뜻만 갖는다. 이 파일은 커밋하지 않는다. done 이 exit 0 이면 지우고, 실패하면 남겨 재시도
   재료로 쓴다. `DECISIONS_INVALID …`(exit 2)는 파일 형식 오류다 — 고쳐 다시 부른다. stderr 경고
   `DECISIONS_COUNT_MISMATCH`·`DECISIONS_SUFFIX_MISSING` 은 요약 접미사와 목록 건수가 어긋났다는 뜻이고,
   `서버가 결정 목록을 모릅니다(계약 < 2.6)` 는 서버가 옛 버전이라 결정이 요약 접미사로만 전달됐다는 뜻이다(둘 다 보고는 됐다).
```

워커 모드 표 D행의 `--worker` 칸에서 `Phase 06 `done` 요약 끝에 `확인 필요 결정 N건: …` 을 싣는다.` 바로 뒤에 한 문장을 더한다(기존 문장은 그대로 둔다 — 시험이 인용한다):

```markdown
결정마다 `D` 번호를 붙이고, Phase 06 에서 그 절을 `docs/tasks/<TSK>/decisions.json` 으로 옮겨 `done --decisions` 로 넘긴다(0건이면 `[]`).
```

- [ ] **Step 4: `dflow-work` 문서 수정**

`.claude/skills/dflow-work/SKILL.md` 「완료 보고」 의 코드 블록과 설명을 바꾼다:

````markdown
```bash
git push origin agent/<주문id 8자>-<slug>
dflow.sh done <순번> "<요약>" --auto-links --decisions docs/tasks/<TSK>/decisions.json
```

`--auto-links` 옵션: git 정보(브랜치, SHA, PR URL)를 자동 수집해 서버 보고.
`--decisions <file>` 옵션(계약 2.6): 스스로 고른 확인 필요 결정 목록(JSON 배열)을 보고 필드로 싣는다. 0건이면 `[]` 를 넘긴다.
형식이 틀리면 push 확인·전송 전에 exit 2 로 멈춘다. 경고의 뜻은 `references/troubleshooting.md` exit 2 절.
````

`.claude/skills/dflow-work/README.md` 「완료 보고」 블록과 워크플로 6번을 바꾼다:

````markdown
```bash
git push origin agent/12345678-task-slug
dflow.sh done 1 "완료·테스트 통과·PR 병합됨" --auto-links --decisions docs/tasks/TSK-01-01/decisions.json
```

**중요**: push 후에 done 호출. push 없이는 exit 2 오류. `--decisions` 파일은 확인 필요 결정 목록(0건이면 `[]`)이다.
````

```
6. dflow.sh done <순번> "<요약>" --auto-links --decisions <decisions.json>
```

`.claude/skills/dflow-work/references/troubleshooting.md` exit 2 절의 **원인들** 목록 끝에 한 줄을 더한다:

```markdown
- `done --decisions` 파일의 형식 오류(`DECISIONS_FILE`·`DECISIONS_JSON`·`DECISIONS_INVALID <사유>`)
```

같은 절 **해결** 4번 항목 뒤에 5번을 더한다:

````markdown
5. `done --decisions` 경고·오류의 뜻(계약 2.6):
   - `DECISIONS_FILE …` — 파일이 없다. `DECISIONS_JSON …` — JSON 이 아니거나 값이 하나가 아니다(빈 파일 포함).
   - `DECISIONS_INVALID <사유>` — 서버와 같은 규칙 위반(사유는 필드 경로를 담는다, 예 `decisions[0].chosen이 options 범위를 벗어났습니다.`).
     보고는 나가지 않았다. 파일을 고쳐 다시 부른다. `chosen` 은 선택지 문구가 아니라 0부터 센 색인이다.
   - `DECISIONS_COUNT_MISMATCH …` / `DECISIONS_SUFFIX_MISSING …` — 요약의 `확인 필요 결정 N건` 과 목록 건수가 어긋났다.
     **보고는 됐다**(exit 0). design.md 절과 decisions.json 을 대조해 다음 보고부터 맞춘다.
   - `서버가 결정 목록을 모릅니다(계약 < 2.6) — 요약 접미사로만 전달됐습니다.` — 서버가 옛 버전이라 결정이 버려졌다.
     **보고는 됐다**(exit 0). 승인자는 요약 접미사로만 본다.
   ```bash
   dflow.sh done <순번> "<요약> — 확인 필요 결정 2건: …" --auto-links --decisions docs/tasks/<TSK>/decisions.json
   ```
````

- [ ] **Step 5: `dflow-team/SKILL.md` 수정**

팀장 부트스트랩의 exclude 패턴 루프(448행)를 바꾼다:

```sh
   for p in '**/.claude/worktrees/' '/dflow-*/' '.vitest/' '/.dflow-agent' '/.dflow-prompt' '/.dflow-pane' '/.dflow-run' '/.dflow.local' 'docs/tasks/*/.result' 'docs/tasks/*/decisions.json'; do
```

설명(634행 부근)의 `` `docs/tasks/*/.result` 는 워커가 쓰는 미추적 파일`` 을 바꾼다:

```markdown
     `docs/tasks/*/.result`·`docs/tasks/*/decisions.json` 은 워커가 쓰는 미추적 파일(decisions.json 은 `done --decisions` 의 전송용으로, 커밋하지 않는다), `/.dflow-prompt`·`/.dflow-pane`·`/.dflow-run` 은
```

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 전부(`dflow-team-shell-blocks.test.ts` 의 sh·bash·zsh 문법 검사 포함 — 바꾼 루프 줄도 통과해야 한다).

- [ ] **Step 7: 커밋**

```bash
git add .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-dev/SKILL.md .claude/skills/dflow-work/SKILL.md .claude/skills/dflow-work/README.md .claude/skills/dflow-work/references/troubleshooting.md .claude/skills/dflow-team/SKILL.md tests/skills/worker-decide-and-notify.test.ts tests/skills/dflow-team.test.ts tests/skills/dflow-dev-worker.test.ts
git commit -F - <<'MSG'
docs(dflow): 워커가 결정 목록을 decisions.json 으로 넘기게 한다

design.md 절의 결정마다 D 번호를 붙이고 Phase 06 에서 JSON 으로 옮겨 done --decisions 로 보낸다.
0건도 [] 로 명시해 서버의 null 이 "구 도구" 한 뜻만 갖게 하고, 전송 파일은 커밋하지 않도록
팀장의 공유 exclude 에 넣는다. 요약 접미사와 .result 의 (결정 N건)은 구 서버 호환을 위해 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

---

### Task 10: 통합·스테이징 리허설·반영 (컨트롤러가 직접)

- [ ] **Step 1: 전체 검증**

Run: `npx vitest run 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: 실패 0(Task 0 에서 기록한 기존 실패는 예외로 대조). 타입 오류가 테스트 픽스처에서 나면(예: 새 필수 필드) 그 픽스처에 필드를 채워 고치고 해당 Task 커밋 형식으로 따로 커밋한다.

- [ ] **Step 2: back-merge**

```bash
cd /Users/jji/project/wbs-web-decision
git fetch -q origin
git merge --no-edit origin/main
git merge --no-edit origin/staging
```

충돌이 나면 양쪽 의도를 모두 살려 푼다(force·reset 금지). 이어서 작업 폴더 표기 변화를 확인한다:

```bash
grep -n "TASK_DIR" .claude/skills/dflow-team/references/worker-prompt.md .claude/skills/dflow-dev/SKILL.md | head -5
grep -n "tasks/\*/.result" .claude/skills/dflow-team/SKILL.md | head -3
```

Expected: 둘 다 비어 있거나 기존 `docs/tasks/…` 표기. **`{TASK_DIR}` 표기가 들어와 있으면** Task 9 에서 더한 줄의 `docs/tasks/{TSK}/decisions.json`·`docs/tasks/<TSK>/decisions.json` 을 `{TASK_DIR}/decisions.json` 으로, exclude 패턴 `'docs/tasks/*/decisions.json'` 을 그 파일의 `.result` 패턴과 같은 접두(예 `'**/tasks/*/decisions.json'`)로 고치고 따로 커밋한다(`docs(dflow): 결정 목록 파일 경로를 작업 폴더 표기에 맞춘다` + 두 트레일러 줄). 그 뒤:

Run: `npx vitest run 2>&1 | tail -5`
Expected: 실패 0.

- [ ] **Step 3: 스테이징 DB 적용·검증·롤백 왕복**

`staging:sync` 는 돌리지 않는다. 판단: 0102 는 nullable 컬럼·CHECK·생성 컬럼만 더하고 기존 데이터에 기대지 않는다(기존 행은 전부 null 로 CHECK 를 통과). sync 는 스테이징 데이터를 운영 데이터로 덮어 병렬 세션의 검증 데이터를 지운다.

```bash
time npm run db:apply -- supabase/migrations/0102_agent_report_decisions.sql --target staging
npm run db:apply -- scripts/checks/0102_report_decisions_check.sql --target staging
npm run db:apply -- supabase/migrations/0102_agent_report_decisions_rollback.sql --target staging
cat > "${TMPDIR:-/tmp}/0102_absent_check.sql" <<'SQL'
do $$ begin
  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_work_reports' and column_name in ('decisions', 'decision_count')
  ), '롤백 뒤에도 컬럼이 남았다';
  assert not exists (select 1 from pg_constraint where conname = 'agent_work_reports_decisions_shape'), '롤백 뒤에도 제약이 남았다';
  raise notice 'REPORT_DECISIONS_ABSENT_OK';
end $$;
SQL
npm run db:apply -- "${TMPDIR:-/tmp}/0102_absent_check.sql" --target staging
npm run db:apply -- supabase/migrations/0102_agent_report_decisions.sql --target staging
npm run db:apply -- scripts/checks/0102_report_decisions_check.sql --target staging
```

Expected: 적용 두 번 성공, 검증 SQL 두 번 모두 assert 예외 없이 끝남(롤백되어 행이 남지 않는다), 부재 검사 통과. 첫 적용의 `time` 소요(생성 컬럼 추가가 테이블을 다시 쓴다)를 다음 커밋 본문에 적는다. **어느 하나라도 실패하면 여기서 멈추고** 코드를 push 하지 않는다(D11).

- [ ] **Step 4: 스테이징 검증 트레일러 커밋**

`<소요>` 자리에 Step 3 의 `time` 실측(예 `real 0m2.1s`)을 적는다.

```bash
git commit --allow-empty -F - <<MSG
chore(db): 0102 스테이징 리허설 통과를 기록한다

스테이징에 0102 를 적용하고 검증 SQL(CHECK 위반 23514 단정, decision_count null/0/2)과
롤백 → 부재 확인 → 재적용 → 재검증 왕복을 마쳤다. 첫 적용 소요: <소요>.
staging:sync 는 돌리지 않았다 — 기존 데이터에 기대지 않는 추가형 마이그레이션이다.

Staging-verified: $(date +%F) 0102 적용·검증 SQL·롤백 왕복 통과
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017pRK3o5uZ8iXqojbCNKPCA
MSG
```

- [ ] **Step 5: Preview 기록 후 staging 반영**

`src/components/app/*` 커밋이 있으므로 feat 브랜치를 먼저 origin 에 올려 Preview 기록을 남긴다(나중 main 머지 때 G2 통과 근거). 그 다음 staging 에 올린다. force push 금지.

```bash
git push -u origin HEAD
git push origin HEAD:staging
```

Expected: 두 push 모두 성공(pre-push 훅 G1~G4 통과). G4 가 막으면 Step 4 트레일러 커밋이 이번 push 범위에 들었는지 `git log --format='%h %s%n%(trailers)' origin/staging..HEAD | grep -n Staging-verified` 로 확인한다. staging push 가 non-fast-forward 로 거부되면 Step 2 부터 다시 한다.

- [ ] **Step 6: 스테이징 배포 확인**

```bash
DFLOW_API_BASE=https://dflow-staging.vercel.app .claude/skills/dflow-work/scripts/dflow.sh doctor
```

Expected: `프로필 1: … (계약 2.6, …)`. `2.5` 면 배포가 덜 끝난 것이다 — 1분 뒤 다시 본다. 토큰 값은 출력되지 않는다(prefix 만).
이 워크트리에서 doctor 가 인증하지 못하거나(PAT 설정 없음) `.dflow` 의 api_base 가 환경변수보다 우선해 운영을 가리키면, 이 확인은 건너뛰고 Step 7 의 허브 승인 큐 카드에 `결정 2` 칩이 보이는 것을 배포 완료 신호로 삼는다(재료 주입 뒤 새로 고침).

- [ ] **Step 7: 스테이징 E2E (ego-browser)**

E2E 재료를 스테이징 DB 에 넣는다 — 표식 `agent = 'e2e-0102'` 로 나중에 지운다.

```bash
cat > "${TMPDIR:-/tmp}/0102_e2e_seed.sql" <<'SQL'
-- agent 태그 항목의 reported 주문 하나에 결정 2건 completion 을 더한다(최신 completion 이 되므로 화면이 이 행을 읽는다).
with o as (
  select o.id from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
  where o.status = 'reported' and 'agent' = any(i.tags)
  order by o.updated_at desc limit 1
)
insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
select id, 'completion', 100, 'E2E 결정 보고 — 확인 필요 결정 2건: 판정 로직; 캐시 위치', 'e2e-0102',
  '[{"key":"D1","question":"판정 로직을 이 Task 에서 넣는가?","options":["넣지 않는다(spec 제약 우선)","넣는다(선행 배정 우선)"],"chosen":0,"rationale":"spec 본문이 넣지 않는다고 적었다. spec > 미승인 선행.","on_reject":"판정 로직을 verdict.ts 로 옮기고 라우트 1개를 더한다."},
    {"key":"D2","question":"캐시를 어디에 두는가?","options":["메모리","디스크"],"chosen":1,"rationale":"재시작 뒤에도 남아야 한다.","on_reject":"메모리 캐시로 바꾼다."}]'::jsonb
from o
returning work_order_id;
SQL
npm run db:apply -- "${TMPDIR:-/tmp}/0102_e2e_seed.sql" --target staging
```

Expected: 응답에 `work_order_id` 한 행. 빈 결과면 agent 태그 reported 주문이 없는 것이다 — 아래를 먼저 돌려 claimed 주문 하나를 reported 로 옮기고, 출력된 `id` 를 적어 둔 뒤 seed 를 다시 돌린다(정리 때 되돌린다).

```bash
cat > "${TMPDIR:-/tmp}/0102_e2e_flip.sql" <<'SQL'
update public.agent_work_orders set status = 'reported', updated_at = now()
where id = (select o.id from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
            where o.status = 'claimed' and 'agent' = any(i.tags) order by o.updated_at desc limit 1)
returning id, project_id;
SQL
npm run db:apply -- "${TMPDIR:-/tmp}/0102_e2e_flip.sql" --target staging
```

ego-browser 스킬로 `https://dflow-staging.vercel.app` 에 관리자 계정으로 로그인해 그 주문의 프로젝트에서 확인한다:
1. 허브 `/p/<project>/agents` 승인 대기 카드 — 머리에 `결정 2` 칩, 요약 아래 D1·D2 목록(택함 굵게·다른 선택지 흐리게·근거·반려 시), 반려를 열면 placeholder 가 `반려 사유 — 특정 결정이면 번호를 적어 주세요(예: D2 는 선택지 2로)`. 결정 없는 다른 승인 대기 카드(0102 전 보고)는 `결정 목록 미제출(구버전 보고) — 요약을 확인하세요`.
2. WBS `/p/<project>/wbs` 에서 그 항목 사이드바 「진행 상황」 — 최신 completion 아래 목록이 펼쳐져 있다.
3. 오피스 `/p/<project>/agents/office` — 그 좌석 책상과 상태 레인 「결재 대기」 카드에 `결정 2` 칩, 좌석을 누르면 상세 패널에 목록.
4. 왼쪽 사이드바 「에이전트」 배지의 title 이 `결재 대기 N건 · 확인 필요 결정 2건`(구버전 보고가 섞였으면 `… 2건 이상 · 일부 구버전 보고`)이고 배지 오른쪽 위에 점.
각 화면을 스크린샷으로 남긴다.

정리:

```bash
cat > "${TMPDIR:-/tmp}/0102_e2e_cleanup.sql" <<'SQL'
delete from public.agent_work_reports where agent = 'e2e-0102' returning work_order_id;
SQL
npm run db:apply -- "${TMPDIR:-/tmp}/0102_e2e_cleanup.sql" --target staging
```

flip 을 썼으면 적어 둔 주문을 되돌린다 — `update public.agent_work_orders set status = 'claimed', updated_at = now() where id = '<적어 둔 id>';` 를 같은 방식으로 스크래치 파일에 써서 `--target staging` 으로 돌린다.

- [ ] **Step 8: 보고**

staging 반영 커밋(`git rev-parse --short HEAD`), 스테이징 DB 0102 적용 사실, E2E 결과(화면 네 곳)를 보고한다. main 머지·운영 DB 적용·dflow-kit 재빌드는 범위 밖이다. 나중에 운영에 올릴 때는 **`db:apply --target prod` 먼저, main 머지 나중**(역순이면 허브 조회가 없는 컬럼을 select 해 에이전트 화면 전체가 죽고, 모든 completion 이 500 이 난다), 그 뒤 킷 재빌드다. 워크트리·브랜치는 main 반영 때까지 둔다.
