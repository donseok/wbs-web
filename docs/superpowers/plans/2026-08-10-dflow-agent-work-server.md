# D'Flow Agent Work Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Claude Code가 D'Flow 작업을 PAT 신원으로 조회→착수→진행보고→완료(승인 대기)까지 처리할 수 있도록, wbs-web에 PAT 인증축·"내 작업" API·WBS 담당자/단계/업로드·배정 기반 자동 발행·클라이언트 스킬을 구현한다.

**Architecture:** 기존 v1 agent work API(5개 라우트, 전역 시크릿)는 계약 불변으로 유지하고, 인증 게이트를 `resolveAgentPrincipal` 리졸버로 교체해 레거시 시크릿과 PAT(`agent_runners` 테이블)가 공존한다. 점유 소유권은 PAT 경로에서만 `claimed_by_user_id`로 이관한다. **WBS 정본은 D'Flow DB다(결정 A)** — `wbs.md`는 최초 작성·import 부트스트랩 전용이고, import 후 로컬 `/dev` 계열은 DB를 읽는다(claim 시 `dflow.sh`가 명세를 받아 `docs/tasks/<TSK>/spec.md` 로컬 캐시 생성). `wbs_items`에는 stage·담당자·external_ref에 더해 category/domain/priority/model/tags/depends/prd_ref/entry_point/acceptance/spec 확장 컬럼(결정 B)을 두고 `wbs-parse --export` JSON v2를 upsert 업로드한다. 담당자 배정 리프는 주문 자동 발행, claim은 선행(depends) stage 게이트로 하드 차단(결정 C). 클라이언트는 리포 정본 스킬 + `dflow.sh`(curl 래퍼)이며, 선행 커밋 미반영·push 미완료를 로컬 git으로 하드 차단한다.

**Tech Stack:** Next.js 15 App Router(route handlers + server actions) · Supabase(Postgres 17, service_role admin client) · vitest · POSIX sh + curl + jq(클라이언트)

**정본 스펙:** `docs/superpowers/specs/2026-08-10-claude-code-work-integration-review-appendix.md` (이하 "부록"). 이 계획의 모든 §번호는 부록 절 번호다.

## Global Constraints

- **마이그레이션과 코드는 별도 커밋**(pre-push G1). `git add -A` 금지 — 모든 커밋 스텝은 파일명 명시.
- 모든 마이그레이션에 `_rollback.sql` 동반. 적용은 Supabase Management API 경유(`supabase db push` 금지). 번호는 **0069·0071·0072·0073**(0070은 `project_member_email_identity`가 선점 — 사용 금지).
- **운영 D-CUBE 무훼손**: 신규 컬럼 전부 nullable/additive. `agent_projects`에 운영 프로젝트 등록은 이 계획 범위 밖(부록 미결 ⑤ — 별도 승인). 쓰기 검증은 테스트 Supabase 프로젝트(TSK-00-02 산출물: 테스트 호스트·시크릿·샘플 project_id·리프 UUID·테스트 사용자 A/B)에서만.
- **보안 fail-closed**: 가드 조회 실패 = 거부. 미등록 프로젝트·비멤버는 404(존재 은닉 관례). deprecated `memberships.role`은 읽지 않는다(전역 등급 `is_superuser`, 프로젝트 역할 `project_roles`).
- **PAT 평문은 발급 응답 1회만.** DB에는 `sha256(전체 토큰)` hex만. 토큰을 로그·에러 메시지·테스트 스냅샷에 남기지 않는다.
- **멤버십 게이트(Task 5)는 PAT 발급 액션(Task 8)보다 앞 커밋** — 같은 배포에 포함되지 않으면 토큰 하나로 enabled 전 프로젝트가 샌다(§2.2).
- 킬스위치는 `AGENT_API_ENABLED` 단독(§2.1). 토큰 발급 액션도 이 플래그 뒤.
- UI 신규 코드는 `src/components/agent/*`·`src/components/wbs/*`에만. `src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`(pre-push G2 대상)은 건드리지 않는다.
- 기존 테스트 8개(`tests/agent/` 5 + `tests/domain/agent-work.test.ts` + `tests/actions/agent-work-actions.test.ts` + `tests/migrations/agent-work-loop.test.ts`)는 항상 초록. 의도적 계약 변경은 단 1건 — `agentApiEnabled()`의 시크릿 요건 제거(Task 4에 명시, 해당 테스트 1개 수정).
- 테스트 실행: `npx vitest run <파일>` (단건) / `npm run test` (전체). 커밋 전 해당 태스크 테스트 + `npm run lint` 통과.
- 커밋 메시지는 한국어, "무엇"보다 "왜".
- **미결 항목은 권고안 기준으로 구현하고 코드 주석에 `미결 ①` 형식으로 표기한다**: ① 발급 권한(본인 자율=읽기 스코프 한정, `work:report`는 관리자 발급만 — 이 계획은 본인 자율 발급까지만 구현) · ③ progress 즉시 반영 유지(v1 동작) · ⑪ 잔여(claim 시 `as`→`ip` 자동 전이 — **구현하지 않음**, TSK-01-01에서 확정 후 후속) · ⑫ 필드 소유권(구조·일정=파일, stage·담당·실적=웹 — 권고안대로 구현).

**확정 결정 (2026-08-10 사용자, 부록보다 우선):**
- **A. WBS 중앙관리(DB 정본)** — wbs.md는 부트스트랩 전용. 설계서·분석서 실물은 로컬 git, DB엔 `prd_ref`·`entry_point` 문자열 참조만. claim 시 클라이언트가 `docs/tasks/<TSK>/spec.md` 캐시 생성.
- **B. 0073 확장 DDL** — `category·domain·priority(text 라벨)·model·tags text[]·depends text[]·prd_ref·entry_point·acceptance jsonb·spec text` 추가. spec은 마크다운 본문(뷰어에서 렌더+편집 — Task 12A).
- **C. 선행 하드 차단** — 서버: claim 시 depends 선행 stage < `im` → 403 `dependency_not_met`. 클라이언트: 선행 evidence(branch·head_sha)의 로컬 도달 검사 실패 시 실행 거부(경고 아님), done은 push 미완료 시 보고 거부. **완료 = push 완료.**
- **D. /account 페이지 신설** — PAT UI는 처음부터 `/account`(프로필+비밀번호 변경+PAT 관리). `HeaderChrome.tsx`(G2 위험군) 1줄 교체는 브랜치 경유.
- **E. export/import 계약 v2** — 노드에 `model·tags[]·prd_ref·entry_point·spec_sections` 추가, `acceptance[]` 최상위 유지. priority는 문자열 라벨(critical/high/medium/low), 주문 정수 매핑 100/50/10/0.

**선행 게이트(코드 착수 전 확인):** 부록 미결 ⓪①②가 결정돼 `decisions.md`에 기록돼 있어야 한다(TSK-00-01). 테스트 환경 실측(TSK-00-02)은 Task 9 이후의 실배포 검증에만 필요 — Task 1~8은 vitest 단위로 진행 가능.

---

### Task 1: 계약 동결 — api-contract.md

**Files:**
- Create: `docs/agent/claude-skill/dflow-work/references/api-contract.md`

**Interfaces:**
- Consumes: 부록 §2.1~§2.8·§3·§7.2
- Produces: 서버(Task 2~15)·클라이언트(Task 16~17)·dev 플러그인(DEV-01~03)이 이 문서만 보고 착수할 수 있는 계약. 이후 태스크의 타입·에러코드·스키마는 전부 이 문서와 일치해야 한다.

- [ ] **Step 1: 계약 문서 작성**

아래 내용을 그대로 저장한다(코드 구현과 어긋나면 이 문서가 정본이고 코드를 고친다):

````markdown
# D'Flow Agent API 계약 v2.0

`contract_version: "2.0"` — v1(전역 시크릿) 계약은 불변 유지, v2는 PAT 축 추가.

## 인증

- `Authorization: Bearer <값>`. 값이 `AGENT_API_SECRET`과 일치 → legacy principal.
  값이 `dflow_pat_` 접두 → PAT principal. 그 외 401.
- PAT 형식: `dflow_pat_<prefix 12자 영숫자>_<secret base64url 43자>`. DB에는 sha256(전체) hex만.
- 킬스위치: `AGENT_API_ENABLED !== 'true'` → 전 라우트 404. 시크릿 미설정 → legacy 분기만 닫힘.
- PAT 검사 순서: enabled → revoked_at → expires_at → hash(상수시간).
- PAT 요청 body의 `user_email`: 없으면 무시, 있는데 소유자와 다르면 400 `identity_mismatch`.
- 스코프: `work:read`(조회) · `work:claim`(claim/release) · `work:report`(report). 부족 시 403 `insufficient_scope`. legacy는 스코프 개념 없음(v1 동작).
- PAT는 `project_id` 지정 시 그 프로젝트만. 멤버십: PAT principal은 모든 조회·쓰기에서 `is_superuser` 또는 `project_roles` 보유 필요, 아니면 404.

## 엔드포인트 (v1 5개 불변 + 신규 3개)

| 메서드·경로 | 신원 | 요지 |
|---|---|---|
| GET `/api/v1/agent/work?project_id=` | legacy·pat | v1 계약 그대로. PAT는 멤버십·스코프 강제 |
| GET `/api/v1/agent/work/{id}` | legacy·pat | v1 + PAT 호출 시 `mine:boolean`·`claimed_by_user_email` 추가 |
| POST `/api/v1/agent/work/{id}/claim` | legacy·pat | PAT: `claimed_by_user_id` 서버 유도 기록. 배정 항목은 담당자만(403 `not_assignee`) |
| POST `/api/v1/agent/work/{id}/release` | legacy·pat | 소유 판정: PAT=claimed_by_user_id, legacy=claimed_by 라벨. 교차 403 `not_claim_owner` |
| POST `/api/v1/agent/work/{id}/report` | legacy·pat | 위와 같음 + PAT는 `evidence` 객체 허용 |
| GET `/api/v1/agent/me` | **pat 전용** | legacy 호출 400 `identity_required` |
| GET `/api/v1/agent/work/mine?scope=&limit=` | **pat 전용** | scope: `available`(기본)·`claimed`·`all`·`assigned` |
| POST `/api/v1/wbs/import` | **pat 전용** | export JSON upsert. 스코프 `work:report` 필요 |

## 응답 셰이프 (신규분)

`GET /agent/me` 200:
```json
{ "ok": true, "user_email": "a@b.c", "scopes": ["work:read"], "kind": "user_pat",
  "token_expires_at": "2026-11-08T00:00:00Z", "contract_version": "2.0",
  "projects": [{ "id": "<uuid>", "name": "…", "role": "admin|member|superuser" }] }
```
`projects`는 `agent_projects.enabled=true` ∩ 내가 멤버인 프로젝트만(미등록은 목록에서도 은닉).

`GET /agent/work/mine` 200:
```json
{ "ok": true, "scope": "all",
  "claimed": [ { "id": "…", "project_id": "…", "status": "claimed", "priority": 0,
                 "instructions": "…", "claimed_at": "…", "item": { "id": "…", "code": "…", "name": "…" } } ],
  "available": [ …같은 셰이프… ], "assigned": [ …같은 셰이프… ] }
```
요청 scope에 해당하는 구획만 채운다(`available`이면 `available`만). 정렬은 구획 내 `priority desc, created_at asc`. `limit` 기본 20 최대 100(구획별 적용). 미지원 scope → 400 `unsupported_scope`.

`POST /wbs/import` 요청( `wbs-parse.py --export` 출력 v2 + 2필드) — **계약 v2 확장(결정 E, 두 리포 공통·고정)**:
```json
{ "project_id": "<uuid>", "module": "MES",
  "nodes": [ { "id": "TSK-01-01", "parent_id": "WP-01", "kind": "task|wp|act|phase",
               "title": "…", "stage": "todo|as|fp|ip|im|xx", "category": "dev",
               "domain": "fullstack", "assignee": "a@b.c", "schedule": "2026-08-11 ~ 2026-08-14",
               "depends": ["TSK-01-00"], "acceptance": ["…"],
               "priority": "critical|high|medium|low",
               "model": "opus", "tags": ["contract"],
               "prd_ref": "docs/prd.md#3.2", "entry_point": "src/app/(app)/wbs/page.tsx",
               "spec_sections": { "requirements": ["…"], "test_criteria": ["…"],
                 "constraints": ["…"], "api_spec": "…|null", "data_model": "…|null",
                 "description": "…|null" } } ] }
```
`external_ref` = `<module>/<id>` (예: `MES/TSK-01-01`).
- **priority는 문자열 라벨.** 주문 정수 priority 매핑(계약 고정): `critical=100 · high=50 · medium=10 · low=0` (미기재·미지 라벨=0).
- **spec 조립**: import가 `spec_sections`를 고정 섹션 순서 — 머리말(description, 헤딩 없음) → `## 요구사항` → `## 제약` → `## 테스트 기준` → `## API 스펙` → `## 데이터 모델` — 의 마크다운으로 조립해 `wbs_items.spec`(text)에 저장한다. 빈 섹션은 생략. `acceptance[]`는 최상위 그대로 `acceptance jsonb`로.
- `depends[]`는 같은 모듈 내 노드 id — DB에는 external_ref 배열로 저장(선행 판정 키).

응답:
```json
{ "ok": true, "upserted": 12, "skipped": 3,
  "unmatched_assignees": [{ "id": "TSK-01-02", "assignee": "x@y.z" }],
  "non_leaf_skipped": [], "orders_created": 4 }
```
멱등: 같은 payload 재업로드 시 upsert 0건 갱신·주문 중복 0건. 삭제는 하지 않는다.
필드 소유권(미결 ⑫ 권고안): 신규 행 = 파일 값 전부 시드 / 기존 행 = 구조·명세(title·schedule·parent·depends·acceptance·priority·category·domain·model·tags·prd_ref·entry_point·spec)만 갱신, **stage·assignee·actual_pct는 보존**.

## claim·show 응답 확장과 선행 게이트 (결정 A·C)

- `GET /work/{id}`(PAT)와 `POST /work/{id}/claim` 200 응답의 `item`에 확장 필드를 포함한다:
  `external_ref·category·domain·priority·model·tags·depends·prd_ref·entry_point·acceptance·spec·stage`.
  클라이언트는 claim 성공 시 이걸로 `docs/tasks/<TSK-ID>/spec.md` 로컬 캐시를 만든다(TSK-ID = external_ref의 `/` 뒤).
- 두 응답 모두 `depends_evidence: [{ external_ref, stage, branch|null, head_sha|null }]` 포함 —
  각 선행 항목의 **최근 approved 주문의 completion 보고 evidence**에서 추출(없으면 null).
- **서버 선행 게이트**: claim 시 depends의 선행 항목 중 `stage`가 `im` 이상(`im`·`xx`)이 아닌 것이 하나라도 있으면
  403 `dependency_not_met` + `unmet: [{external_ref, stage}]`. 선행 external_ref가 프로젝트에 없거나 stage가 null이면 미충족(fail-closed).
- **클라이언트 하드 차단**: ① claim 전 `show`의 depends_evidence로 `git cat-file -e <sha>` + `git merge-base --is-ancestor <sha> HEAD` 검사 — 미도달이면 메시지 출력 후 **실행 거부(exit 4)**. ② `done`은 `git ls-remote`로 현재 브랜치 tip이 원격에 도달했는지 확인 — 미도달이면 **보고 거부(exit 2)**. "완료 = push 완료"가 클라이언트 계약이다.

## 상태 어휘 매핑 (§7.2-2)

파일 `[ ]`/`[as]`/`[fp]`/`[ip]`/`[im]`/`[xx]` ↔ DB `stage` `todo/as/fp/ip/im/xx` ↔ 진척 환산 0/0/0/20/60/100(산식 정본은 D'Flow, 미결 ③ 승인 전 환산 미적용).
전이 권한: 사람 전용 = assign/unassign/force/unforce/accept · 에이전트 = cycle.start/*.ok/*.fail/bypass. 에이전트 API에 사람 전용 이벤트 없음(도입 시 403 `human_gate`). claim 시 `as`→`ip` 자동 전이는 미결 ⑪ 잔여 — v2.0에서는 전이 없음.

## 에러코드 전수

| HTTP | code | 의미 |
|---|---|---|
| 400 | `validation_failed` | 형식 오류(v1 관례) |
| 400 | `identity_mismatch` | PAT 소유자 ≠ body user_email |
| 400 | `identity_required` | PAT 전용 엔드포인트에 legacy 호출 |
| 400 | `unsupported_scope` | mine의 미지원 scope |
| 401 | `unauthorized` | 시크릿·PAT 불일치/만료/폐기 |
| 403 | `forbidden_role` | 멤버 아님(쓰기 경로 v1 관례) |
| 403 | `not_claim_owner` | 점유 소유자 아님(교차 소유 포함) |
| 403 | `insufficient_scope` | PAT 스코프 부족 |
| 403 | `not_assignee` | 배정 항목을 타인이 claim |
| 403 | `dependency_not_met` | 선행(depends) stage 미충족 claim (결정 C — `unmet[]` 동반) |
| 404 | — | 꺼짐/미등록/비멤버/없음(의도적 비구분) |
| 409 | `conflict` | CAS 충돌·상태 불일치 |
| 409 | `apply_failed` | WBS 반영 실패 |
| 409 | `wbs_item_missing` | 항목 삭제된 주문 |

## 로컬 클라이언트 계약

- env: `DFLOW_API_BASE`(기본값 없음 — 미설정 시 즉시 실패) · `DFLOW_PATS`(쉼표 구분 1~N개) · `DFLOW_PAT`(단일, PATS 미설정 시 폴백).
- `dflow.sh` exit code: 0 성공 / 2 사용법·설정·push 미완료 / 3 인증(401) / 4 상태 충돌(409)·선행 미반영 로컬 차단 / 5 권한(403) / 6 네트워크·서버(5xx) / 7 기능 꺼짐(404).
- 신원 해석: 토큰별 `GET /agent/me` 1회 → `~/.cache/dflow/profiles.json` 캐시. `--as <이름|email>` 프로필 선택.
- evidence 자동 조립: `git rev-parse HEAD`·`git remote get-url origin`·`git branch --show-current`·(`gh` 있으면) PR URL.
````

- [ ] **Step 2: 부록과 대조**

Run: `grep -c "identity_mismatch\|not_assignee\|unsupported_scope\|insufficient_scope" docs/agent/claude-skill/dflow-work/references/api-contract.md`
Expected: 4개 코드 전부 존재(0이 아님). 부록 §2.4의 mine 정의(배정∪점유∪ready 풀)와 scope 값 일치 확인.

- [ ] **Step 3: Commit**

```bash
git add docs/agent/claude-skill/dflow-work/references/api-contract.md
git commit -m "docs(agent): PAT 인증축 계약 v2.0 동결 — 서버·클라이언트·dev 플러그인 병렬 착수 기준"
```

---

### Task 2: 0069 agent_runners 마이그레이션

**Files:**
- Create: `supabase/migrations/0069_agent_runners.sql`
- Create: `supabase/migrations/0069_agent_runners_rollback.sql`
- Test: `tests/migrations/agent-runners.test.ts`

**Interfaces:**
- Consumes: 없음(첫 DB 태스크)
- Produces: `public.agent_runners` 테이블 — Task 3~8·10이 의존. 컬럼: `id·name·kind·owner_user_id·token_prefix·token_hash·project_id·scopes·enabled·revoked_at·expires_at·last_seen_at·created_by·created_at`

- [ ] **Step 1: 실패 테스트 작성**

`tests/migrations/agent-work-loop.test.ts` 관례(SQL 파일 정적 검증)를 따른다:

```typescript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = () => readFileSync('supabase/migrations/0069_agent_runners.sql', 'utf8')
const rollback = () => readFileSync('supabase/migrations/0069_agent_runners_rollback.sql', 'utf8')

describe('0069 agent_runners', () => {
  it('테이블·핵심 컬럼·제약이 선언된다', () => {
    const s = sql()
    expect(s).toContain('create table if not exists public.agent_runners')
    expect(s).toMatch(/kind text not null default 'user_pat'\s+check \(kind in \('user_pat','runner'\)\)/)
    expect(s).toContain('owner_user_id uuid not null references auth.users(id) on delete cascade')
    expect(s).toContain('token_prefix text not null unique')
    expect(s).toContain('token_hash text not null')
    expect(s).toMatch(/scopes text\[\] not null default '\{work:read\}'/)
    expect(s).toContain('expires_at timestamptz not null')
    expect(s).toContain('unique (owner_user_id, name)')
  })
  it('RLS 켜고 authenticated 접근을 전면 차단한다(token_hash 비노출)', () => {
    const s = sql()
    expect(s).toContain('alter table public.agent_runners enable row level security')
    expect(s).not.toMatch(/create policy .* on public\.agent_runners/)
    expect(s).toContain('revoke all on table public.agent_runners from public, anon, authenticated')
    expect(s).toContain('grant all on table public.agent_runners to service_role')
    expect(s).not.toContain('grant select on table public.agent_runners to authenticated')
  })
  it('rollback이 테이블을 제거한다', () => {
    expect(rollback()).toContain('drop table if exists public.agent_runners')
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/migrations/agent-runners.test.ts`
Expected: FAIL — `ENOENT ... 0069_agent_runners.sql`

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0069_agent_runners.sql`:

```sql
-- 0069: agent_runners — 사용자 PAT(user_pat)·머신 러너(runner) 겸용 자격증명 테이블.
-- 코퍼스 docs/design/agent-coding-platform/21-multi-client-model.md 초안에 합류하되 두 곳 수정:
--   ① name 전역 unique → unique(owner_user_id, name): 사용자별 PAT 공존 시 이름 선점 충돌 방지.
--   ② owner_user_id on delete cascade 유지: 소유자 소멸 = 자격증명 즉시 소멸(잔존 행 = 고아 credential).
--      에이전트 활동 감사는 토큰 행이 아니라 usage 이벤트 몫.
-- token_hash 는 sha256(전체 토큰) hex. 평문은 발급 응답 1회만 존재한다.
-- 멱등: 반복 실행 안전(0057 관례).

begin;

set search_path = public, extensions;

create table if not exists public.agent_runners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'user_pat'
    check (kind in ('user_pat','runner')),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_prefix text not null unique,
  token_hash text not null,
  -- null = 전 프로젝트(멤버십 게이트는 별도). 슈퍼유저 PAT 는 발급 규칙으로 지정 강제(§2.2).
  project_id uuid references public.projects(id) on delete cascade,
  scopes text[] not null default '{work:read}',
  enabled boolean not null default true,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create index if not exists agent_runners_owner_idx on public.agent_runners (owner_user_id);

-- RLS: 정책 0개 — authenticated 는 이 테이블을 어떤 경로로도 읽지 못한다(token_hash 비노출).
-- 발급·목록·폐기는 전부 세션 가드를 통과한 서버 액션이 service_role 로 수행한다.
alter table public.agent_runners enable row level security;

revoke all on table public.agent_runners from public, anon, authenticated;
grant all on table public.agent_runners to service_role;

reset search_path;

commit;
```

`supabase/migrations/0069_agent_runners_rollback.sql`:

```sql
-- 0069 rollback: agent_runners 제거. PAT 발급분은 전부 소멸한다(재발급으로 복구).
begin;
drop table if exists public.agent_runners;
commit;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/agent-runners.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 마이그레이션 단독 커밋 (테스트 파일은 다음 코드 커밋에)**

```bash
git add supabase/migrations/0069_agent_runners.sql supabase/migrations/0069_agent_runners_rollback.sql
git commit -m "feat(db): 0069 agent_runners — PAT·러너 겸용 자격증명 테이블 (kind 컬럼으로 코퍼스 초안 합류)"
```

주의: `tests/migrations/agent-runners.test.ts`는 이 커밋에 넣지 않는다(G1 — 마이그레이션 단독). Task 3 커밋에 포함한다.

- [ ] **Step 6: 테스트 DB 적용 (TSK-00-02 산출물 확보 후)**

Supabase Management API로 테스트 프로젝트에 적용:
`https://api.supabase.com/v1/projects/{테스트 ref}/database/query` POST body에 0069 SQL 전문. 적용 후 `select count(*) from agent_runners;` 가 0을 반환하면 성공. **운영(rglfgrwwwwdqejohdnty)에는 이 시점에 적용하지 않는다** — 운영 적용은 WP-06 통과 후 별도 결정.

---

### Task 3: 토큰 도메인·발급 라이브러리

**Files:**
- Create: `src/lib/domain/agentToken.ts`
- Create: `src/lib/agent/token.ts`
- Test: `tests/domain/agent-token.test.ts`
- (같은 커밋에 포함: `tests/migrations/agent-runners.test.ts` — Task 2에서 작성)

**Interfaces:**
- Consumes: 없음(순수 + node:crypto)
- Produces:
  - `PAT_RE: RegExp` · `parsePatPrefix(token: string): string | null` · `isPatFormat(token: string): boolean`
  - `tokenUsable(row: { enabled: boolean; revoked_at: string | null; expires_at: string }, now?: Date): { ok: true } | { ok: false; reason: 'disabled' | 'revoked' | 'expired' }`
  - `generateAgentToken(): { token: string; prefix: string; hash: string }`
  - `hashToken(token: string): string` · `hashMatches(provided: string, storedHash: string): boolean`(상수시간)

- [ ] **Step 1: 실패 테스트 작성**

`tests/domain/agent-token.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { isPatFormat, parsePatPrefix, tokenUsable } from '@/lib/domain/agentToken'
import { generateAgentToken, hashMatches, hashToken } from '@/lib/agent/token'

describe('agentToken 도메인', () => {
  it('PAT 형식 판정·prefix 추출', () => {
    const { token, prefix } = generateAgentToken()
    expect(isPatFormat(token)).toBe(true)
    expect(parsePatPrefix(token)).toBe(prefix)
    expect(prefix).toHaveLength(12)
    expect(parsePatPrefix('dflow_pat_short')).toBeNull()
    expect(parsePatPrefix('Bearer abc')).toBeNull()
    expect(isPatFormat('dflow_pat_ABCDEFGHIJKL_')).toBe(false) // secret 없음
  })
  it('발급마다 토큰·prefix가 다르고 hash는 sha256 hex 64자', () => {
    const a = generateAgentToken()
    const b = generateAgentToken()
    expect(a.token).not.toBe(b.token)
    expect(a.prefix).not.toBe(b.prefix)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).toBe(hashToken(a.token))
  })
  it('hashMatches — 일치 true, 불일치 false', () => {
    const { token, hash } = generateAgentToken()
    expect(hashMatches(token, hash)).toBe(true)
    expect(hashMatches(token + 'x', hash)).toBe(false)
  })
  it('tokenUsable — enabled → revoked → expired 순서 판정', () => {
    const now = new Date('2026-08-10T00:00:00Z')
    const base = { enabled: true, revoked_at: null, expires_at: '2026-12-31T00:00:00Z' }
    expect(tokenUsable(base, now)).toEqual({ ok: true })
    expect(tokenUsable({ ...base, enabled: false }, now)).toEqual({ ok: false, reason: 'disabled' })
    expect(tokenUsable({ ...base, revoked_at: '2026-08-01T00:00:00Z' }, now)).toEqual({ ok: false, reason: 'revoked' })
    expect(tokenUsable({ ...base, expires_at: '2026-08-09T00:00:00Z' }, now)).toEqual({ ok: false, reason: 'expired' })
    // revoked 이면서 expired 면 revoked 가 먼저(검사 순서 §2.1)
    expect(tokenUsable({ ...base, revoked_at: '2026-08-01T00:00:00Z', expires_at: '2026-08-02T00:00:00Z' }, now))
      .toEqual({ ok: false, reason: 'revoked' })
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/domain/agent-token.test.ts`
Expected: FAIL — `Cannot find module '@/lib/domain/agentToken'`

- [ ] **Step 3: 구현**

`src/lib/domain/agentToken.ts` (순수 — DB·요청 컨텍스트를 모른다, `domain/agentWork.ts` 관례):

```typescript
/**
 * PAT 토큰 도메인 — 계약 v2.0 (api-contract.md).
 * 형식: dflow_pat_<prefix 12자 영숫자>_<secret base64url>. prefix 는 비밀이 아니라 조회 키다.
 */
export const PAT_RE = /^dflow_pat_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{20,})$/

export function isPatFormat(token: string): boolean {
  return PAT_RE.test(token)
}

export function parsePatPrefix(token: string): string | null {
  const m = PAT_RE.exec(token)
  return m ? m[1] : null
}

export type TokenRowState = { enabled: boolean; revoked_at: string | null; expires_at: string }

/** 검사 순서는 계약 고정: enabled → revoked → expires. hash 비교는 이 뒤(호출부). */
export function tokenUsable(
  row: TokenRowState, now: Date = new Date(),
): { ok: true } | { ok: false; reason: 'disabled' | 'revoked' | 'expired' } {
  if (!row.enabled) return { ok: false, reason: 'disabled' }
  if (row.revoked_at) return { ok: false, reason: 'revoked' }
  const exp = Date.parse(row.expires_at)
  if (Number.isNaN(exp) || exp <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true }
}
```

`src/lib/agent/token.ts`:

```typescript
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** PAT 발급·검증 — 평문은 호출부의 발급 응답 1회만 존재한다. DB 에는 hash 만 저장. */
export function generateAgentToken(): { token: string; prefix: string; hash: string } {
  // prefix 12자 영숫자 — base64url 에서 -,_ 를 걸러 12자를 채운다(조회 키, 충돌 시 재생성은 호출부 unique 위반 처리).
  let prefix = ''
  while (prefix.length < 12) {
    prefix += randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '')
  }
  prefix = prefix.slice(0, 12)
  const secret = randomBytes(32).toString('base64url') // 43자
  const token = `dflow_pat_${prefix}_${secret}`
  return { token, prefix, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 저장 hash 와 제공 토큰의 상수시간 비교 — 길이 노출 방지 위해 해시끼리 비교한다. */
export function hashMatches(providedToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(providedToken), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/agent-token.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/agentToken.ts src/lib/agent/token.ts tests/domain/agent-token.test.ts tests/migrations/agent-runners.test.ts
git commit -m "feat(agent): PAT 토큰 도메인·발급 라이브러리 — 평문 1회·sha256 저장·상수시간 비교"
```

---

### Task 4: resolveAgentPrincipal 리졸버

**Files:**
- Modify: `src/lib/agent/externalApi.ts:10-40` (`agentApiEnabled`·`gateAgentApi` 리팩터 + 리졸버 신설)
- Modify: `tests/agent/external-api.test.ts:23-28` (의도적 계약 변경 1건 반영)
- Test: `tests/agent/resolve-principal.test.ts`

**Interfaces:**
- Consumes: Task 3의 `parsePatPrefix`·`tokenUsable`·`hashMatches`
- Produces (이후 모든 라우트 태스크가 사용):
  ```typescript
  export type AgentPrincipal =
    | { kind: 'legacy' }
    | { kind: 'pat'; runnerId: string; userId: string; userEmail: string
        scopes: string[]; projectId: string | null; runnerKind: 'user_pat' | 'runner'
        tokenExpiresAt: string }
  export async function resolveAgentPrincipal(req: Request, admin: AdminClient): Promise<AgentPrincipal | NextResponse>
  export function requireScope(p: AgentPrincipal, scope: 'work:read' | 'work:claim' | 'work:report'): NextResponse | null
  export function patProjectAllowed(p: AgentPrincipal, projectId: string): boolean
  export const AGENT_CONTRACT_VERSION = '2.0'
  ```
  `gateAgentApi`(레거시 전용 게이트)는 시그니처 불변으로 유지 — 쓰기 라우트가 Task 10 전까지 계속 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/resolve-principal.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const OLD = { ...process.env }
beforeEach(() => { vi.resetModules() })
afterEach(() => { process.env = { ...OLD } })

function req(auth?: string) {
  return new Request('http://l/api/v1/agent/work', { headers: auth ? { Authorization: auth } : {} })
}
// agent_runners 1행 + auth.admin.getUserById 를 흉내내는 admin 목
function adminWith(row: unknown, user = { id: 'u-1', email: 'dev@example.com' }) {
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update']) b[k] = () => b
  b.maybeSingle = async () => ({ data: row, error: null })
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: row, error: null }).then(r)
  return {
    from: () => b,
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error: null })) } },
  }
}
async function load() { return await import('@/lib/agent/externalApi') }

describe('resolveAgentPrincipal', () => {
  it('킬스위치: ENABLED 아니면 404 — 시크릿 존재와 무관', async () => {
    delete process.env.AGENT_API_ENABLED
    process.env.AGENT_API_SECRET = 's'
    const m = await load()
    const r = await m.resolveAgentPrincipal(req('Bearer s'), adminWith(null) as never)
    expect((r as NextResponse).status).toBe(404)
  })
  it('시크릿 일치 → legacy principal. 시크릿 미설정이면 레거시 분기 자체가 없음(401)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    expect(await m.resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)).toEqual({ kind: 'legacy' })
    delete process.env.AGENT_API_SECRET
    vi.resetModules()
    const m2 = await load()
    const r = await m2.resolveAgentPrincipal(req('Bearer s3cret'), adminWith(null) as never)
    expect((r as NextResponse).status).toBe(401)
  })
  it('PAT 정상 → pat principal(스코프·프로젝트 한정 재료 포함)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const { token, prefix, hash } = generateAgentToken()
    const row = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    const p = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
    expect(p).toMatchObject({ kind: 'pat', userId: 'u-1', userEmail: 'dev@example.com', scopes: ['work:read'] })
  })
  it('PAT 폐기·만료·비활성·해시 불일치 → 전부 401', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    const { token, prefix, hash } = generateAgentToken()
    const base = {
      id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: prefix, token_hash: hash,
      project_id: null, scopes: ['work:read'], enabled: true, revoked_at: null,
      expires_at: '2099-01-01T00:00:00Z',
    }
    const m = await load()
    for (const row of [
      { ...base, enabled: false },
      { ...base, revoked_at: '2026-01-01T00:00:00Z' },
      { ...base, expires_at: '2020-01-01T00:00:00Z' },
      { ...base, token_hash: 'f'.repeat(64) },
      null, // prefix 미존재
    ]) {
      const r = await m.resolveAgentPrincipal(req(`Bearer ${token}`), adminWith(row) as never)
      expect((r as NextResponse).status).toBe(401)
    }
  })
  it('requireScope — pat 부족 403 insufficient_scope, legacy 통과', async () => {
    const m = await load()
    const pat = {
      kind: 'pat', runnerId: 'r', userId: 'u', userEmail: 'e', scopes: ['work:read'],
      projectId: null, runnerKind: 'user_pat', tokenExpiresAt: '2099-01-01T00:00:00Z',
    } as const
    expect(m.requireScope({ kind: 'legacy' }, 'work:report')).toBeNull()
    expect(m.requireScope(pat, 'work:read')).toBeNull()
    expect(m.requireScope(pat, 'work:report')?.status).toBe(403)
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/agent/resolve-principal.test.ts`
Expected: FAIL — `resolveAgentPrincipal is not a function`

- [ ] **Step 3: 구현**

`src/lib/agent/externalApi.ts` 수정:

① `agentApiEnabled()` (기존 :10-12) 교체 — **킬스위치 단독 판정**(계약 변경 1건):

```typescript
/** 킬스위치는 AGENT_API_ENABLED 단독(계약 v2.0 §인증). 시크릿 존재는 레거시 분기 조건일 뿐이다. */
export function agentApiEnabled(): boolean {
  return process.env.AGENT_API_ENABLED === 'true'
}
```

② 파일 하단에 리졸버 추가:

```typescript
import { parsePatPrefix, tokenUsable } from '@/lib/domain/agentToken'
import { hashMatches } from '@/lib/agent/token'

export const AGENT_CONTRACT_VERSION = '2.0'

export type AgentPrincipal =
  | { kind: 'legacy' }
  | {
      kind: 'pat'; runnerId: string; userId: string; userEmail: string
      scopes: string[]; projectId: string | null; runnerKind: 'user_pat' | 'runner'
      tokenExpiresAt: string
    }

type RunnerRow = {
  id: string; kind: 'user_pat' | 'runner'; owner_user_id: string
  token_prefix: string; token_hash: string; project_id: string | null
  scopes: string[]; enabled: boolean; revoked_at: string | null; expires_at: string
}

/**
 * 인증 리졸버 — 계약 v2.0 §인증. 반환이 NextResponse 면 그대로 응답한다.
 * 검사 순서(enabled→revoked→expires→hash)는 계약 고정. 실패 사유는 응답에서 구분하지 않는다(전부 401).
 */
export async function resolveAgentPrincipal(
  req: Request, admin: AdminClient,
): Promise<AgentPrincipal | NextResponse> {
  if (!agentApiEnabled()) return apiNotFound()
  const header = req.headers.get('authorization')
  const bearer = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!bearer) return apiUnauthorized()

  const secret = process.env.AGENT_API_SECRET
  if (secret && secretMatches(bearer, secret)) return { kind: 'legacy' }

  const prefix = parsePatPrefix(bearer)
  if (!prefix) return apiUnauthorized()
  const { data, error } = await admin
    .from('agent_runners')
    .select('id, kind, owner_user_id, token_prefix, token_hash, project_id, scopes, enabled, revoked_at, expires_at')
    .eq('token_prefix', prefix).maybeSingle()
  if (error) {
    // 보안 가드 조회 실패 = 거부(fail-closed). 위장하지 않고 로깅.
    console.error('[agent-api] PAT 조회 실패(거절):', error.message)
    return apiUnauthorized()
  }
  if (!data) return apiUnauthorized()
  const row = data as RunnerRow
  if (!tokenUsable(row).ok) return apiUnauthorized()
  if (!hashMatches(bearer, row.token_hash)) return apiUnauthorized()

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(row.owner_user_id)
  if (userErr || !userData?.user?.email) {
    console.error('[agent-api] PAT 소유자 조회 실패(거절):', userErr?.message ?? '이메일 없음')
    return apiUnauthorized()
  }
  // last_seen_at 은 best-effort — 실패해도 요청은 통과시키되 로깅.
  const { error: seenErr } = await admin
    .from('agent_runners').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id)
  if (seenErr) console.error('[agent-api] last_seen_at 갱신 실패:', seenErr.message)

  return {
    kind: 'pat', runnerId: row.id, userId: row.owner_user_id,
    userEmail: userData.user.email.toLowerCase(), scopes: row.scopes ?? [],
    projectId: row.project_id, runnerKind: row.kind, tokenExpiresAt: row.expires_at,
  }
}

/** 스코프 강제 — legacy 는 스코프 개념이 없다(v1 동작). 부족 시 403 insufficient_scope. */
export function requireScope(
  p: AgentPrincipal, scope: 'work:read' | 'work:claim' | 'work:report',
): NextResponse | null {
  if (p.kind === 'legacy') return null
  if (p.scopes.includes(scope)) return null
  return apiFail(403, 'insufficient_scope', `이 작업에는 ${scope} 스코프가 필요합니다.`)
}

/** PAT 의 project_id 한정 — null 이면 전 프로젝트(멤버십 게이트는 별도). */
export function patProjectAllowed(p: AgentPrincipal, projectId: string): boolean {
  if (p.kind === 'legacy') return true
  return p.projectId === null || p.projectId === projectId
}
```

③ `tests/agent/external-api.test.ts:23-28`의 `'ENABLED=true 여도 SECRET 없으면 닫힘'` 테스트를 계약 v2.0에 맞게 교체:

```typescript
  it('ENABLED=true 면 SECRET 없어도 API 는 열림 — 레거시 분기만 닫힘(계약 v2.0)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(true)
    expect(m.gateAgentApi(req('Bearer anything'))?.status).toBe(401)
  })
```

`gateAgentApi`(기존 :34-40)는 시크릿 미설정 시 401을 반환하도록 한 줄만 보강한다(`if (!process.env.AGENT_API_SECRET) return apiUnauthorized()` 를 enabled 검사 직후에):

```typescript
export function gateAgentApi(req: Request): NextResponse | null {
  if (!agentApiEnabled()) return apiNotFound()
  if (!process.env.AGENT_API_SECRET) return apiUnauthorized() // 레거시 분기 없음 — PAT 는 리졸버 라우트만
  const header = req.headers.get('authorization')
  const provided = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!secretMatches(provided, process.env.AGENT_API_SECRET)) return apiUnauthorized()
  return null
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/resolve-principal.test.ts tests/agent/external-api.test.ts`
Expected: PASS 전부. 이어서 `npx vitest run tests/agent` 로 기존 라우트 테스트 회귀 없음 확인.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/externalApi.ts tests/agent/resolve-principal.test.ts tests/agent/external-api.test.ts
git commit -m "feat(agent): resolveAgentPrincipal — 레거시 시크릿·PAT 공존 리졸버, 킬스위치를 AGENT_API_ENABLED 단독으로"
```

---

### Task 5: 읽기 라우트 전환 + PAT 멤버십 게이트

**Files:**
- Modify: `src/app/api/v1/agent/work/route.ts:11-18` (게이트 교체 + PAT 멤버십·스코프·프로젝트 한정)
- Modify: `src/app/api/v1/agent/work/[id]/route.ts:11-29` (동일 + `mine`·`claimed_by_user_email` 필드는 Task 10에서)
- Test: `tests/agent/work-routes-pat.test.ts`

**Interfaces:**
- Consumes: Task 4의 `resolveAgentPrincipal`·`requireScope`·`patProjectAllowed`, 기존 `isAgentProjectMember`
- Produces: 레거시 응답 바이트 동일(기존 `tests/agent/work-routes.test.ts` 초록 유지), PAT 경로는 멤버십 미보유 시 404

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/work-routes-pat.test.ts` — `tests/agent/claim-routes.test.ts`의 목 관례(vi.hoisted + 테이블별 응답 큐)를 그대로 쓴다:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'

const P1 = '11111111-1111-4111-8111-111111111111'
type Resp = { data?: unknown; error?: { message: string } | null }

const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/work — PAT 멤버십 게이트', () => {
  it('PAT + 멤버 → 200 (agent_runners → last_seen → agent_projects → 멤버십 → 주문)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }], // 조회, last_seen update
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(200)
  })
  it('PAT + 비멤버 → 404 (존재 은닉)', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('PAT project_id 한정 위반 → 404', async () => {
    useAdmin({
      agent_runners: [{ data: { ...RUNNER, project_id: '99999999-9999-4999-8999-999999999999' } }, { data: null }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('레거시 시크릿 → 멤버십 검사 없이 v1 동작(회귀 기준선)', async () => {
    useAdmin({
      agent_projects: [{ data: { enabled: true } }],
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, 'legacy-secret'))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/agent/work-routes-pat.test.ts`
Expected: FAIL — PAT 요청이 401(현행 gateAgentApi 가 시크릿 비교만 하므로)

- [ ] **Step 3: 구현**

`work/route.ts`의 게이트부(:12-18)를 교체한다:

```typescript
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id') ?? ''
  if (!projectId || !isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'pat') {
      const scopeErr = requireScope(principal, 'work:read')
      if (scopeErr) return scopeErr
      if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    }
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    if (principal.kind === 'pat' && !(await isAgentProjectMember(admin, principal.userId, projectId))) {
      return apiNotFound() // 비멤버 404 — 존재 은닉 관례(§2.2)
    }
    // …이하 기존 주문 조회 로직 무변경…
```

import 를 `resolveAgentPrincipal, requireScope, patProjectAllowed, isAgentProjectMember` 로 갱신하고 `gateAgentApi` import 는 제거. `[id]/route.ts`(:12-29)도 같은 패턴 — `projectId` 는 주문 로드 후의 `row.project_id` 로 검사한다(`requireAgentProject` 호출 직후에 PAT 멤버십·`patProjectAllowed` 검사 삽입, 실패 시 404).

주의: 게이트가 async 가 되므로 `gateAgentApi` 동기 호출부를 제거하고 위 순서(파라미터 검증 → resolve)로 재배치한다. 레거시 principal 경로는 기존과 동일한 쿼리 순서를 유지해 `tests/agent/work-routes.test.ts` 가 그대로 초록이어야 한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/work-routes-pat.test.ts tests/agent/work-routes.test.ts`
Expected: PASS 전부(신규 4 + 기존 회귀)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/agent/work/route.ts "src/app/api/v1/agent/work/[id]/route.ts" tests/agent/work-routes-pat.test.ts
git commit -m "feat(agent): 읽기 라우트 PAT 멤버십 게이트 — 토큰 하나로 전 프로젝트가 새는 경로 차단(발급보다 선행)"
```

---

### Task 6: GET /api/v1/agent/me

**Files:**
- Create: `src/app/api/v1/agent/me/route.ts`
- Test: `tests/agent/me-route.test.ts`

**Interfaces:**
- Consumes: Task 4의 `resolveAgentPrincipal`·`AGENT_CONTRACT_VERSION`, 기존 `isAgentProjectMember`
- Produces: 계약 v2.0의 `/agent/me` 응답 셰이프(Task 1). 클라이언트 `dflow.sh doctor`(Task 16)·프로필 해석(§2.7)의 유일한 진단 창구

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/me-route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as meGET } from '@/app/api/v1/agent/me/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix,
  token_hash: PAT.hash, project_id: null, scopes: ['work:read'], enabled: true,
  revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}
function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (bearer: string) => new NextRequest('http://l/api/v1/agent/me', { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('GET /agent/me', () => {
  it('PAT → 소유자·스코프·contract_version + 멤버인 enabled 프로젝트만', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      // enabled 프로젝트 2건 중 멤버는 P1 만
      agent_projects: [{ data: [{ project_id: P1 }, { project_id: P2 }] }],
      projects: [{ data: [{ id: P1, name: '테스트' }, { id: P2, name: '남의것' }] }],
      memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'admin' }] }, { data: [] }],
    })
    const res = await meGET(get(PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_email).toBe('dev@example.com')
    expect(body.contract_version).toBe('2.0')
    expect(body.projects).toHaveLength(1)
    expect(body.projects[0]).toMatchObject({ id: P1, role: 'admin' })
  })
  it('legacy 시크릿 호출 → 400 identity_required', async () => {
    useAdmin({})
    const res = await meGET(get('legacy-secret'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/agent/me-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/agent/me/route'`

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/me/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  AGENT_CONTRACT_VERSION, apiFail, apiInternalError, isAgentProjectMember,
  patProjectAllowed, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/me — whoami. 404 존재 은닉 아래의 유일한 진단 창구(계약 v2.0). PAT 전용. */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') {
      return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    }

    const { data: regs, error: regErr } = await admin
      .from('agent_projects').select('project_id').eq('enabled', true)
    if (regErr) {
      console.error('[agent-api] enabled 프로젝트 조회 실패:', regErr.message)
      return apiInternalError()
    }
    const candidateIds = ((regs ?? []) as Array<{ project_id: string }>)
      .map(r => r.project_id)
      .filter(pid => patProjectAllowed(principal, pid))

    const nameById = new Map<string, string>()
    if (candidateIds.length > 0) {
      const { data: projs, error: projErr } = await admin
        .from('projects').select('id, name').in('id', candidateIds)
      if (projErr) {
        console.error('[agent-api] 프로젝트 이름 조회 실패:', projErr.message)
        return apiInternalError()
      }
      for (const p of (projs ?? []) as Array<{ id: string; name: string }>) nameById.set(p.id, p.name)
    }

    const projects: Array<{ id: string; name: string; role: string }> = []
    for (const pid of candidateIds) {
      // 프로젝트별 멤버십 판정 — enabled 프로젝트 수는 소수라 순회 비용 무시 가능.
      if (await isAgentProjectMember(admin, principal.userId, pid)) {
        projects.push({ id: pid, name: nameById.get(pid) ?? '', role: 'member' })
      }
    }
    return NextResponse.json({
      ok: true, user_email: principal.userEmail, scopes: principal.scopes,
      kind: principal.runnerKind, token_expires_at: principal.tokenExpiresAt,
      contract_version: AGENT_CONTRACT_VERSION, projects,
    })
  } catch (e) {
    console.error('[agent-api] me 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = POST
export const DELETE = POST
export const PATCH = POST
export const OPTIONS = POST
```

`role` 세분(admin/member/superuser)은 `isAgentProjectMember` 가 boolean 만 주므로 MVP 는 `member` 고정으로 시작하되, 테스트가 `role: 'admin'` 을 요구한다 — `project_roles.role` 을 직접 읽어 채우는 헬퍼를 추가한다:

```typescript
async function memberRole(admin: AdminClient, userId: string, projectId: string): Promise<string | null> {
  const { data: mem } = await admin.from('memberships').select('is_superuser').eq('user_id', userId).maybeSingle()
  if ((mem as { is_superuser?: boolean } | null)?.is_superuser) return 'superuser'
  const { data: roles, error } = await admin
    .from('project_roles').select('role').eq('user_id', userId).eq('project_id', projectId).limit(1)
  if (error || !roles || roles.length === 0) return null // fail-closed
  return (roles[0] as { role: string }).role
}
```

순회부를 `const role = await memberRole(admin, principal.userId, pid); if (role) projects.push({ id: pid, name: …, role })` 로 바꾼다(`isAgentProjectMember` 호출 대체 — 같은 fail-closed 성질 유지).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/me-route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/agent/me/route.ts tests/agent/me-route.test.ts
git commit -m "feat(agent): GET /agent/me — 404 존재 은닉 아래의 유일한 whoami·진단 창구"
```

---

### Task 7: GET /api/v1/agent/work/mine (scope=available)

**Files:**
- Create: `src/app/api/v1/agent/work/mine/route.ts`
- Test: `tests/agent/mine-route.test.ts`

**Interfaces:**
- Consumes: Task 4 리졸버 + Task 6과 같은 접근 가능 프로젝트 산출 로직
- Produces: 계약 v2.0 `/work/mine` 응답(구획 `available`). Task 10에서 `claimed`·`all`, Task 15에서 `assigned` 확장. 정적 세그먼트 `mine`은 `[id]`보다 우선하므로 라우팅 충돌 없음(`[id]`는 `isUuidLike`로 비-UUID 거부 — 이중 안전).

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/mine-route.test.ts` (목 관례 동일 — RUNNER·useAdmin 정의는 Task 6 테스트와 같은 형태로 파일 안에 복제):

```typescript
// …Task 6 테스트와 동일한 mocks/useAdmin/RUNNER/PAT 보일러플레이트…
import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'

describe('GET /agent/work/mine', () => {
  it('scope 기본(available) — 멤버 프로젝트의 ready 주문만, priority desc 정렬', async () => {
    useAdmin({
      agent_runners: [{ data: RUNNER }, { data: null }],
      agent_projects: [{ data: [{ project_id: P1 }] }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('available')
    expect(body.available).toHaveLength(1)
    expect(body.claimed).toBeUndefined()
  })
  it('scope=claimed 는 Phase 1 에서 400 unsupported_scope', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed', PAT.token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unsupported_scope')
  })
  it('legacy 호출 400 identity_required', async () => {
    useAdmin({})
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', 'legacy-secret'))
    expect(res.status).toBe(400)
  })
  it('limit 상한 100 초과 → 400', async () => {
    useAdmin({ agent_runners: [{ data: RUNNER }, { data: null }] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?limit=999', PAT.token))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/agent/mine-route.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/work/mine/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdminClient } from '@/lib/minutes/externalApi'
import {
  apiBadRequest, apiFail, apiInternalError, isAgentProjectMember,
  patProjectAllowed, requireScope, resolveAgentPrincipal, type AgentPrincipal,
} from '@/lib/agent/externalApi'

/** GET /api/v1/agent/work/mine — 크로스 프로젝트 "내 작업". PAT 전용(계약 v2.0). */
export const dynamic = 'force-dynamic'

const SUPPORTED_SCOPES = ['available'] as const // Task 10: +claimed,all · Task 15: +assigned

export async function accessibleProjectIds(admin: AdminClient, principal: Extract<AgentPrincipal, { kind: 'pat' }>): Promise<string[]> {
  const { data: regs, error } = await admin.from('agent_projects').select('project_id').eq('enabled', true)
  if (error) throw new Error(`enabled 프로젝트 조회 실패: ${error.message}`)
  const out: string[] = []
  for (const r of (regs ?? []) as Array<{ project_id: string }>) {
    if (!patProjectAllowed(principal, r.project_id)) continue
    if (await isAgentProjectMember(admin, principal.userId, r.project_id)) out.push(r.project_id)
  }
  return out
}

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get('scope') ?? 'available'
  const limitRaw = req.nextUrl.searchParams.get('limit')
  const limit = limitRaw === null ? 20 : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return apiBadRequest('limit은 1~100 정수입니다.')
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:read')
    if (scopeErr) return scopeErr
    if (!(SUPPORTED_SCOPES as readonly string[]).includes(scope)) {
      return apiFail(400, 'unsupported_scope', `지원하지 않는 scope 입니다: ${scope}`)
    }

    const projectIds = await accessibleProjectIds(admin, principal)
    if (projectIds.length === 0) return NextResponse.json({ ok: true, scope, available: [] })

    const { data: orders, error } = await admin
      .from('agent_work_orders')
      .select('id, project_id, status, priority, instructions, claimed_at, wbs_item_id, created_at')
      .in('project_id', projectIds).eq('status', 'ready')
      .order('priority', { ascending: false }).order('created_at', { ascending: true })
      .limit(limit)
    if (error) {
      console.error('[agent-api] mine 목록 조회 실패:', error.message)
      return apiInternalError()
    }
    const rows = (orders ?? []) as Array<{ wbs_item_id: string | null } & Record<string, unknown>>
    const itemIds = [...new Set(rows.map(o => o.wbs_item_id).filter((v): v is string => !!v))]
    const itemById = new Map<string, unknown>()
    if (itemIds.length > 0) {
      const { data: items, error: itemErr } = await admin
        .from('wbs_items').select('id, code, name, planned_start, planned_end').in('id', itemIds)
      if (itemErr) {
        console.error('[agent-api] mine 항목 컨텍스트 조회 실패:', itemErr.message)
        return apiInternalError()
      }
      for (const it of (items ?? []) as Array<{ id: string }>) itemById.set(it.id, it)
    }
    return NextResponse.json({
      ok: true, scope,
      available: rows.map(o => ({ ...o, item: o.wbs_item_id ? itemById.get(o.wbs_item_id) ?? null : null })),
    })
  } catch (e) {
    console.error('[agent-api] mine 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = POST
export const DELETE = POST
export const PATCH = POST
export const OPTIONS = POST
```

참고: `accessibleProjectIds` 는 route 파일에서 export 하면 App Router 빌드가 거부한다 — **실제 위치는 `src/lib/agent/mineShared.ts` 신설**로 하고 route 는 import 만 한다(`routeShared.ts` 관례와 같은 이유). Task 10·15 가 재사용한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/mine-route.test.ts`
Expected: PASS (4 tests). `npm run build` 로 라우트 export 위반 없는지 확인.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/agent/work/mine/route.ts src/lib/agent/mineShared.ts tests/agent/mine-route.test.ts
git commit -m "feat(agent): GET /work/mine — 크로스 프로젝트 내 작업 목록(Phase 1: available 구획)"
```

---

### Task 8: PAT 발급·관리 액션 + /account 페이지 (결정 D)

**Files:**
- Create: `src/app/actions/agentTokens.ts`
- Create: `src/app/(app)/account/page.tsx`
- Create: `src/components/account/AccountView.tsx`
- Create: `src/components/account/MyTokensSection.tsx`
- Modify: `src/components/app/HeaderChrome.tsx:215` (드롭다운 '비밀번호 변경' → '내 계정' 링크 1줄 — **G2 위험군**)
- Test: `tests/actions/agent-tokens.test.ts`

⚠️ **브랜치 경유 필수**: `HeaderChrome.tsx`는 pre-push G2 대상(`src/components/app/*`)이다. 이 태스크는 `git switch -c ui/account`에서 작업하고 `git push -u origin HEAD` 후 main에 머지한다(Preview는 로그인 뒤 화면이라 검증 한계 — CLAUDE.md의 G2 규칙 절차 그대로).

**Interfaces:**
- Consumes: Task 3 `generateAgentToken`, Task 2 `agent_runners`, 기존 `requireProjectAdmin`(대리 발급은 미결 ① — 이 태스크는 본인 자율만), `createServerClient`(세션)
- Produces:
  ```typescript
  export async function createAgentToken(input: { name: string; projectId: string | null; scopes: string[]; expiresDays: number }):
    Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }>
  export async function revokeAgentToken(runnerId: string): Promise<{ ok: boolean; error?: string }>
  export async function listMyAgentTokens(): Promise<{ ok: true; tokens: Array<{ id: string; name: string; token_prefix: string; scopes: string[]; project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null }> } | { ok: false; error: string }>
  ```

- [ ] **Step 1: 실패 테스트 작성**

`tests/actions/agent-tokens.test.ts` — `tests/actions/agent-work-actions.test.ts` 관례(세션·admin 목)를 따른다. 핵심 검증 4건:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const OLD = { ...process.env }
beforeEach(() => { process.env.AGENT_API_ENABLED = 'true'; vi.clearAllMocks() })
afterEach(() => { process.env = { ...OLD } })

function useSession(user: { id: string } | null) {
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
  })
}
function useAdmin(insertResult: { data?: unknown; error?: { message: string } | null }) {
  const inserted: unknown[] = []
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update', 'order', 'is']) b[k] = () => b
  b.insert = (row: unknown) => { inserted.push(row); return b }
  b.maybeSingle = async () => ({ data: insertResult.data ?? null, error: insertResult.error ?? null })
  b.then = (r: (v: unknown) => unknown) =>
    Promise.resolve({ data: insertResult.data ?? null, error: insertResult.error ?? null }).then(r)
  mocks.createAdminClient.mockReturnValue({ from: () => b })
  return inserted
}

describe('createAgentToken', () => {
  it('발급 성공 — 평문은 응답 1회, DB 행에는 hash 만', async () => {
    useSession({ id: 'u-1' })
    const inserted = useAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'laptop', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.token).toMatch(/^dflow_pat_/)
    const row = inserted[0] as Record<string, unknown>
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain((r as { token: string }).token)
  })
  it('AGENT_API_ENABLED 미설정이면 발급 거부', async () => {
    delete process.env.AGENT_API_ENABLED
    useSession({ id: 'u-1' })
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('work:report 자율 발급 거부(미결 ① — 관리자 발급 경로 도입 전까지)', async () => {
    useSession({ id: 'u-1' })
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read', 'work:report'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('비로그인 거부', async () => {
    useSession(null)
    useAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/actions/agent-tokens.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`src/app/actions/agentTokens.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { agentApiEnabled } from '@/lib/agent/externalApi'
import { generateAgentToken } from '@/lib/agent/token'
import { isUuidLike } from '@/lib/domain/agentWork'

/**
 * PAT 발급·관리 — 계약 v2.0. 발급도 킬스위치(AGENT_API_ENABLED) 뒤(§2.1).
 * 자율 발급은 읽기·claim 스코프 한정 — work:report 는 관리자 발급 경로(미결 ①) 도입 전까지 거부.
 * agent_runners 는 RLS 정책 0 — 이 액션이 유일한 관문이다(fail-closed).
 */

const SELF_ISSUE_SCOPES = new Set(['work:read', 'work:claim'])
const MAX_EXPIRES_DAYS = 180
const NAME_RE = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣 ._-]{0,63}$/

async function sessionUserId(): Promise<string | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.auth.getUser()
  if (error || !data?.user) return null
  return data.user.id
}

export async function createAgentToken(input: {
  name: string; projectId: string | null; scopes: string[]; expiresDays: number
}): Promise<{ ok: true; token: string; prefix: string } | { ok: false; error: string }> {
  if (!agentApiEnabled()) return { ok: false, error: '에이전트 API가 꺼져 있어 발급할 수 없습니다.' }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const name = input.name.trim()
  if (!NAME_RE.test(name)) return { ok: false, error: '이름 형식이 올바르지 않습니다(64자 이내).' }
  if (input.projectId !== null && !isUuidLike(input.projectId)) return { ok: false, error: '잘못된 프로젝트입니다.' }
  if (input.scopes.length === 0) return { ok: false, error: '스코프를 1개 이상 선택하세요.' }
  for (const s of input.scopes) {
    if (!SELF_ISSUE_SCOPES.has(s)) {
      return { ok: false, error: `${s} 스코프는 자율 발급할 수 없습니다(관리자 발급 대상 — 미결 ①).` }
    }
  }
  const days = Math.trunc(input.expiresDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    return { ok: false, error: `만료는 1~${MAX_EXPIRES_DAYS}일입니다.` }
  }

  const { token, prefix, hash } = generateAgentToken()
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_runners').insert({
    name, kind: 'user_pat', owner_user_id: uid, token_prefix: prefix, token_hash: hash,
    project_id: input.projectId, scopes: input.scopes,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(), created_by: uid,
  }).select('id')
  if (error) {
    // unique(owner_user_id, name) 충돌 등 — DB 메시지를 위장하지 않는다(표시=로깅).
    return { ok: false, error: `발급 실패: ${error.message}` }
  }
  if (!data || data.length === 0) return { ok: false, error: '발급 실패(0행)' }
  revalidatePath('/agent-ops')
  return { ok: true, token, prefix } // 평문은 이 응답이 유일하다 — 저장·로깅 금지.
}

export async function revokeAgentToken(runnerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(runnerId)) return { ok: false, error: '잘못된 요청입니다.' }
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('agent_runners')
    .update({ revoked_at: new Date().toISOString(), enabled: false })
    .eq('id', runnerId).eq('owner_user_id', uid) // 본인 소유만 — 소유자 한정이 곧 권한 판정
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!data || data.length === 0) return { ok: false, error: '대상 토큰이 없습니다.' }
  revalidatePath('/agent-ops')
  return { ok: true }
}

export async function listMyAgentTokens(): Promise<
  | { ok: true; tokens: Array<{ id: string; name: string; token_prefix: string; scopes: string[]; project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null }> }
  | { ok: false; error: string }
> {
  const uid = await sessionUserId()
  if (!uid) return { ok: false, error: '로그인이 필요합니다.' }
  const admin = createAdminClient()
  // token_hash 는 어떤 경로로도 반환하지 않는다.
  const { data, error } = await admin.from('agent_runners')
    .select('id, name, token_prefix, scopes, project_id, expires_at, revoked_at, last_seen_at')
    .eq('owner_user_id', uid).order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, tokens: (data ?? []) as never }
}
```

UI(결정 D — `/agent-ops` 임시 배치 없이 처음부터 `/account`):
- `src/app/(app)/account/page.tsx` — 로그인 세션 필수(비로그인 리다이렉트는 `(app)` 레이아웃 관례 그대로), `<AccountView />` 렌더.
- `src/components/account/AccountView.tsx` — 3구획: ① 프로필 정보(이름·이메일 표시) ② 비밀번호 변경 — 기존 `src/components/account/ChangePasswordModal.tsx` 로직 재사용(모달 열기 버튼) ③ `<MyTokensSection />`.
- `src/components/account/MyTokensSection.tsx` — 토큰 목록 테이블(prefix·이름·스코프·만료·last_seen·폐기 버튼) + 발급 폼(이름·프로젝트 select·스코프 체크박스 read/claim·만료일) + 발급 직후 평문 1회 표시 박스("이 창을 닫으면 다시 볼 수 없습니다" + 복사 버튼).
- `HeaderChrome.tsx:215` — 드롭다운 항목을 '내 계정'(`/account` 링크)으로 교체(비밀번호 변경 진입은 /account 안으로 이동). **이 1줄 외 다른 줄은 건드리지 않는다.**

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/agent-tokens.test.ts`
Expected: PASS (4 tests). `npm run build` 통과.

- [ ] **Step 5: Commit**

```bash
git switch -c ui/account   # G2 — HeaderChrome.tsx 포함이므로 브랜치 경유
git add src/app/actions/agentTokens.ts "src/app/(app)/account/page.tsx" src/components/account/AccountView.tsx src/components/account/MyTokensSection.tsx src/components/app/HeaderChrome.tsx tests/actions/agent-tokens.test.ts
git commit -m "feat(account): /account 신설 — 프로필·비밀번호 변경·PAT 발급(평문 1회, work:report 자율 발급 차단)"
git push -u origin HEAD    # Preview 확인(로그인 화면 한계는 알고 통과) 후:
git switch main && git merge ui/account
```

**WP-02 수용 기준 확인(이 시점):** (a) `/me` 는 미등록 프로젝트를 목록에서 은닉 (b) `AGENT_API_ENABLED` 미설정 시 `/me`·`/mine` 404 + 발급 거부 (c) 레거시 8개 테스트 초록 (d) A PAT 로 B 전용 프로젝트 미노출 (e) `scope=claimed` 400. 전부 위 태스크의 테스트로 검증됨.

---

### Task 9: 0071·0072 마이그레이션 (점유 소유자·evidence)

**Files:**
- Create: `supabase/migrations/0071_agent_order_claim_owner.sql` + `supabase/migrations/0071_agent_order_claim_owner_rollback.sql`
- Create: `supabase/migrations/0072_agent_report_evidence.sql` + `supabase/migrations/0072_agent_report_evidence_rollback.sql`
- Test: `tests/migrations/agent-claim-owner.test.ts`

**Interfaces:**
- Consumes: 0057의 `agent_work_orders`·`agent_work_reports`
- Produces: `agent_work_orders.claimed_by_user_id uuid` · `agent_work_reports.evidence jsonb` — Task 10이 의존

- [ ] **Step 1: 실패 테스트 작성**

`tests/migrations/agent-claim-owner.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('0071 claimed_by_user_id', () => {
  const s = () => readFileSync('supabase/migrations/0071_agent_order_claim_owner.sql', 'utf8')
  it('컬럼·인덱스 선언', () => {
    expect(s()).toContain("add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null")
    expect(s()).toMatch(/create index if not exists agent_work_orders_claim_owner_idx/)
  })
  it('rollback 이 컬럼을 제거', () => {
    expect(readFileSync('supabase/migrations/0071_agent_order_claim_owner_rollback.sql', 'utf8'))
      .toContain('drop column if exists claimed_by_user_id')
  })
})
describe('0072 evidence', () => {
  const s = () => readFileSync('supabase/migrations/0072_agent_report_evidence.sql', 'utf8')
  it('jsonb not null default 로 백필 불필요', () => {
    expect(s()).toContain("add column if not exists evidence jsonb not null default '{}'::jsonb")
  })
  it('rollback 이 컬럼을 제거', () => {
    expect(readFileSync('supabase/migrations/0072_agent_report_evidence_rollback.sql', 'utf8'))
      .toContain('drop column if exists evidence')
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/migrations/agent-claim-owner.test.ts` → FAIL (ENOENT)

- [ ] **Step 3: 마이그레이션 작성**

`0071_agent_order_claim_owner.sql`:

```sql
-- 0071: agent_work_orders.claimed_by_user_id — 점유 소유권을 자유 문자열 라벨(claimed_by)에서
-- 사용자 귀속으로 이관(계약 v2.0 §2.3). PAT 경로에서만 기록·판정하며 레거시 경로는 라벨 그대로.
-- v1 원칙 "기존 테이블 ALTER 0건"과 충돌해 보이나 대상은 v1 이 만든 에이전트 전용 테이블이고
-- D-CUBE 핵심 테이블은 무변경 — nullable 추가라 기존 행·레거시 경로 무영향.
-- on delete set null: 사용자 소멸 후에도 주문은 감사 기록으로 남긴다(wbs_item_id 와 같은 정책).
begin;
alter table public.agent_work_orders
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null;
create index if not exists agent_work_orders_claim_owner_idx
  on public.agent_work_orders (claimed_by_user_id, status)
  where claimed_by_user_id is not null;
commit;
```

`0071_..._rollback.sql`:

```sql
begin;
drop index if exists public.agent_work_orders_claim_owner_idx;
alter table public.agent_work_orders drop column if exists claimed_by_user_id;
commit;
```

`0072_agent_report_evidence.sql`:

```sql
-- 0072: agent_work_reports.evidence — 완료 보고의 git 증적(branch·SHA·PR·checks).
-- 형식 검증만 하며 서버는 실재를 독립 확인하지 않는다(§6 — UI 에 '에이전트 제출 주장' 표기).
begin;
alter table public.agent_work_reports
  add column if not exists evidence jsonb not null default '{}'::jsonb;
commit;
```

`0072_..._rollback.sql`:

```sql
begin;
alter table public.agent_work_reports drop column if exists evidence;
commit;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/agent-claim-owner.test.ts` → PASS

- [ ] **Step 5: 마이그레이션 단독 커밋 + 테스트 DB 적용**

```bash
git add supabase/migrations/0071_agent_order_claim_owner.sql supabase/migrations/0071_agent_order_claim_owner_rollback.sql supabase/migrations/0072_agent_report_evidence.sql supabase/migrations/0072_agent_report_evidence_rollback.sql
git commit -m "feat(db): 0071·0072 — 점유 소유 사용자 귀속·완료 증적 컬럼 (PAT 쓰기 루프의 기반)"
```

테스트 DB에 Management API로 적용(Task 2 Step 6과 동일 절차). 테스트 파일은 Task 10 커밋에 포함.

---

### Task 10: 쓰기 라우트 PAT 소유 판정·스코프·evidence

**Files:**
- Modify: `src/lib/agent/routeShared.ts` (principal 기반 선행부 신설)
- Modify: `src/app/api/v1/agent/work/[id]/claim/route.ts:9-51`
- Modify: `src/app/api/v1/agent/work/[id]/release/route.ts:9-43`
- Modify: `src/app/api/v1/agent/work/[id]/report/route.ts:28-129`
- Modify: `src/app/api/v1/agent/work/[id]/route.ts` (PAT 호출 시 `mine`·`claimed_by_user_email` 추가)
- Modify: `src/app/api/v1/agent/work/mine/route.ts` + `src/lib/agent/mineShared.ts` (`scope=claimed|all`)
- Modify: `src/lib/domain/agentWork.ts` (evidence 형식 검증 순수 함수)
- Test: `tests/agent/write-routes-pat.test.ts`, `tests/domain/agent-work.test.ts`(evidence 케이스 추가)

**Interfaces:**
- Consumes: Task 4 리졸버, 0071·0072 컬럼
- Produces:
  - `routeShared.ts`: `resolveWriteActor(req, admin, raw): Promise<{ ok: true; principal: AgentPrincipal; userId: string; userEmail: string; agentLabel: string } | { ok: false; res: NextResponse }>` — 레거시는 기존 `parseAgentActor`+`resolveUserByEmail` 경로, PAT는 principal에서 직접. PAT + body `user_email` 불일치 → 400 `identity_mismatch`. PAT의 `agentLabel`은 body `agent` 있으면 그 값, 없으면 `pat:<prefix>`
  - `domain/agentWork.ts`: `validateEvidence(raw: unknown): { ok: true; evidence: Record<string, unknown> } | { ok: false; error: string }` — `{branch?, base_sha?, head_sha?, repo_url?, pr_url?, checks?}` 만 허용, SHA는 40자 hex, URL은 `^https?://`
  - 소유 판정 규칙(교차 양방향 403 `not_claim_owner`): PAT 보고/반납 = `claimed_by_user_id === principal.userId` 필수(레거시 점유 = null 이면 403) + CAS `.eq('claimed_by_user_id', …)` / 레거시 보고/반납 = `claimed_by_user_id` 가 **null 인 주문만** 라벨 비교(v1 그대로), not null 이면 403. **하나의 UPDATE에 OR 금지**(§2.3)

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/write-routes-pat.test.ts` — 목 관례 동일. 케이스 최소 8건:

```typescript
// …mocks/useAdmin/PAT/RUNNER 보일러플레이트(claim-routes.test.ts 관례)…
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'

const CLAIM_SCOPES = { ...RUNNER, scopes: ['work:read', 'work:claim'] }
const REPORT_SCOPES = { ...RUNNER, scopes: ['work:read', 'work:claim', 'work:report'] }
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: null }
// useAdmin 은 claim-routes.test.ts 관례에 update payload 캡처를 더해 { admin, captured } 를 반환한다:
//   b.update = (p: unknown) => { captured.push(p); return b }
// post 헬퍼는 bearer 를 인자로 받는 3-인자 판: post(url, body, bearer) — PAT 와 legacy-secret 을 오간다.
// 멤버십 통과 큐(공통): agent_projects [{enabled:true}] · memberships [{is_superuser:false}] · project_roles [[{role:'member'}]]

describe('PAT 쓰기 루프', () => {
  it('PAT claim 성공 → claimed_by_user_id 서버 유도 기록 (body 값 아님)', async () => {
    const { captured } = useAdmin({
      agent_runners: [{ data: CLAIM_SCOPES }, { data: null }], // 조회, last_seen
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
      wbs_items: [{ data: null }], // 배정 확인(무배정) — Task 15 이후에도 이 큐가 유효
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'claude-pc1', claimed_by_user_id: 'attacker' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const cas = captured.find(p => (p as Record<string, unknown>).status === 'claimed') as Record<string, unknown>
    expect(cas.claimed_by_user_id).toBe('u-1') // principal 유도값 — body 의 'attacker' 무시
  })
  it('PAT + body user_email 불일치 → 400 identity_mismatch', async () => {
    useAdmin({ agent_runners: [{ data: CLAIM_SCOPES }, { data: null }] })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a', user_email: 'other@example.com' }, PAT.token), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_mismatch')
  })
  it('PAT 가 레거시 점유(claimed_by_user_id=null) 주문 report → 403 not_claim_owner', async () => {
    useAdmin({
      agent_runners: [{ data: REPORT_SCOPES }, { data: null }],
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'legacy-cli', claimed_by_user_id: null } }],
      agent_projects: [{ data: { enabled: true } }],
      memberships: [{ data: { is_superuser: false } }],
      project_roles: [{ data: [{ role: 'member' }] }],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  // 아래 5건은 위와 같은 큐 구성으로 조건만 바꾼다(각 케이스의 큐 차이를 명시):
  it('PAT + work:claim 스코프 없음 → 403 insufficient_scope', async () => {
    // agent_runners 큐에 RUNNER(scopes:['work:read'] 만) — claim 호출 → 403 + code 단언
  })
  it('레거시가 PAT 점유 주문 report → 403 not_claim_owner', async () => {
    // Authorization: legacy-secret. 주문 큐: { status:'claimed', claimed_by:'x', claimed_by_user_id:'u-1' } → 403
  })
  it('PAT 본인 점유 report(progress) → 200 + applied_to_wbs', async () => {
    // 주문 큐: { status:'claimed', claimed_by_user_id:'u-1', wbs_item_id: W1 } + wbs_items 조회·자식 없음·update 큐 → 200, body.applied_to_wbs === true
  })
  it('completion + evidence 형식 위반(head_sha 39자) → 400', async () => {
    // body: { kind:'completion', percent:100, summary:'s', evidence:{ head_sha: 'a'.repeat(39) } } → 400 (validation_failed)
  })
  it('PAT release — 타 사용자 점유 403, 본인 점유 200', async () => {
    // 주문 큐 1회차: { claimed_by_user_id:'u-2' } → 403 / 2회차 테스트: { claimed_by_user_id:'u-1' } + CAS 1행 → 200
  })
})
```

주석으로 남긴 5건도 **구현 시 전부 실제 큐 코드로 채운다** — 채울 내용(큐 구성·단언)은 각 주석에 이미 명시돼 있고, 보일러플레이트는 위 3건과 동일하다.

`tests/domain/agent-work.test.ts` 에 추가:

```typescript
describe('validateEvidence', () => {
  it('정상 evidence 통과', () => {
    const r = validateEvidence({ branch: 'agent/abc-fix', head_sha: 'a'.repeat(40), repo_url: 'https://github.com/x/y', checks: [{ name: 'ci', status: 'pass' }] })
    expect(r.ok).toBe(true)
  })
  it('SHA 형식 위반·비 http URL·미지 필드 거부', () => {
    expect(validateEvidence({ head_sha: 'zzz' }).ok).toBe(false)
    expect(validateEvidence({ repo_url: 'ftp://x' }).ok).toBe(false)
    expect(validateEvidence({ unknown_field: 1 }).ok).toBe(false)
  })
  it('undefined 는 빈 evidence 로 통과(선택 필드)', () => {
    expect(validateEvidence(undefined)).toEqual({ ok: true, evidence: {} })
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/agent/write-routes-pat.test.ts tests/domain/agent-work.test.ts` → FAIL

- [ ] **Step 3: 구현**

① `domain/agentWork.ts` 에 `validateEvidence` 추가:

```typescript
const SHA_RE = /^[0-9a-f]{40}$/i
const EVIDENCE_KEYS = new Set(['branch', 'base_sha', 'head_sha', 'repo_url', 'pr_url', 'checks'])

/** evidence 는 형식 검증만 — 실재·일치는 서버가 확인하지 않는다(§6). */
export function validateEvidence(raw: unknown):
  { ok: true; evidence: Record<string, unknown> } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, evidence: {} }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'evidence는 객체여야 합니다.' }
  const e = raw as Record<string, unknown>
  for (const k of Object.keys(e)) {
    if (!EVIDENCE_KEYS.has(k)) return { ok: false, error: `evidence에 알 수 없는 필드: ${k}` }
  }
  for (const k of ['base_sha', 'head_sha'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'string' || !SHA_RE.test(e[k] as string))) {
      return { ok: false, error: `${k}는 40자 hex여야 합니다.` }
    }
  }
  for (const k of ['repo_url', 'pr_url'] as const) {
    if (e[k] !== undefined && (typeof e[k] !== 'string' || !/^https?:\/\//.test(e[k] as string))) {
      return { ok: false, error: `${k}는 http(s) URL이어야 합니다.` }
    }
  }
  if (e.branch !== undefined && typeof e.branch !== 'string') return { ok: false, error: 'branch는 문자열이어야 합니다.' }
  if (e.checks !== undefined) {
    if (!Array.isArray(e.checks)) return { ok: false, error: 'checks는 배열이어야 합니다.' }
    for (const c of e.checks) {
      if (typeof c !== 'object' || c === null) return { ok: false, error: 'checks 원소는 객체여야 합니다.' }
      const cc = c as Record<string, unknown>
      if (typeof cc.name !== 'string' || typeof cc.status !== 'string') return { ok: false, error: 'checks 원소는 {name,status} 문자열 필드가 필요합니다.' }
    }
  }
  return { ok: true, evidence: e }
}
```

② `routeShared.ts` 에 `resolveWriteActor` 신설(기존 `parseAgentActor`·`loadGatedOrder` 유지 — 레거시 경로가 그대로 쓴다):

```typescript
import { AGENT_NAME_RE } from '@/lib/domain/agentWork'
import {
  apiBadRequest, apiFail, requireScope, resolveAgentPrincipal, type AgentPrincipal,
} from '@/lib/agent/externalApi'

/**
 * 쓰기 라우트 공통 신원 해석 — 계약 v2.0.
 * legacy: body user_email 을 resolveUserByEmail 로 해석(v1 그대로).
 * pat: principal 이 신원. body user_email 이 있는데 다르면 400 identity_mismatch(사칭 신호 — 조용히 무시 금지).
 */
export async function resolveWriteActor(
  req: Request, admin: AdminClient, raw: unknown,
  scope: 'work:claim' | 'work:report',
): Promise<
  | { ok: true; principal: AgentPrincipal; userId: string | null; agentLabel: string }
  | { ok: false; res: NextResponse }
> {
  const principal = await resolveAgentPrincipal(req, admin)
  if (principal instanceof NextResponse) return { ok: false, res: principal }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (principal.kind === 'pat') {
    const scopeErr = requireScope(principal, scope)
    if (scopeErr) return { ok: false, res: scopeErr }
    const bodyEmail = typeof b.user_email === 'string' ? b.user_email.trim().toLowerCase() : ''
    if (bodyEmail && bodyEmail !== principal.userEmail) {
      return { ok: false, res: apiFail(400, 'identity_mismatch', 'user_email이 토큰 소유자와 다릅니다.') }
    }
    const agent = typeof b.agent === 'string' && AGENT_NAME_RE.test(b.agent.trim())
      ? b.agent.trim() : `pat-${principal.runnerId.slice(0, 8)}`
    return { ok: true, principal, userId: principal.userId, agentLabel: agent }
  }
  // legacy — v1 파서 그대로(형식 오류 메시지도 동일해야 기존 테스트가 초록).
  const actor = parseAgentActor(raw)
  if ('error' in actor) return { ok: false, res: apiBadRequest(actor.error) }
  return { ok: true, principal, userId: null, agentLabel: actor.agent } // legacy 의 userId 는 loadGatedOrder 가 해석
}
```

③ `claim/route.ts` — `gateAgentApi`+`parseAgentActor` 를 `resolveWriteActor(req, admin, raw, 'work:claim')` 로 교체. 주문 로드는:
- legacy: 기존 `loadGatedOrder(admin, id, body.user_email)` 그대로(응답 바이트 동일 유지).
- pat: `loadGatedOrder` 의 변형 `loadGatedOrderForUser(admin, id, userId, userEmail)` 를 `routeShared.ts` 에 추가 — `resolveUserByEmail` 스캔 없이 principal 의 userId 로 `isAgentProjectMember` 검사(§2.1 부수 효과). select 에 `claimed_by_user_id` 포함.
- CAS: pat 는 `update({ status:'claimed', claimed_by: agentLabel, claimed_by_user_id: userId, … }).eq('id', id).eq('status','ready')`. **`claimed_by_user_id` 는 서버 유도값 — body 에서 받지 않는다.**

④ `release/route.ts`·`report/route.ts` 소유 판정 교체(§2.3):

```typescript
// PAT 경로
if (order.claimed_by_user_id === null) {
  return apiFail(403, 'not_claim_owner', '레거시 세션이 점유한 주문입니다.')
}
if (order.claimed_by_user_id !== actor.userId) {
  return apiFail(403, 'not_claim_owner', '본인이 점유한 주문만 처리할 수 있습니다.')
}
// CAS 도 같은 축: .eq('status','claimed').eq('claimed_by_user_id', actor.userId)

// legacy 경로 — PAT 점유 주문 차단 한 줄만 추가, 나머지 v1 그대로
if (order.claimed_by_user_id !== null) {
  return apiFail(403, 'not_claim_owner', 'PAT 사용자가 점유한 주문입니다.')
}
if (order.claimed_by !== actor.agentLabel) { /* v1 403 그대로 */ }
```

`report/route.ts` 는 `validateEvidence(b.evidence)` 를 links 파싱 직후에 호출하고, 보고 insert 에 `evidence: ev.evidence` 를 추가한다(0072). release 시 `claimed_by_user_id: null` 도 함께 초기화.

⑤ `[id]/route.ts` — PAT 호출 시 응답 order 에 `mine: order.claimed_by_user_id === principal.userId` 와 `claimed_by_user_email`(점유자 email — `auth.admin.getUserById` 1회, 실패 시 null·로깅) 추가. 레거시 호출 응답은 무변경.

⑥ `mineShared.ts`·`mine/route.ts` — `SUPPORTED_SCOPES = ['available','claimed','all']`. `claimed` 구획: `.in('project_id', projectIds).eq('claimed_by_user_id', principal.userId).in('status', ['claimed','reported'])`. `all` 응답은 **claimed 구획 먼저, 그다음 available**(§2.4 — 정렬 붕괴 방지).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent` && `npx vitest run tests/domain/agent-work.test.ts`
Expected: 신규 전부 PASS + 기존 claim/report/release/work 라우트 테스트 회귀 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/routeShared.ts src/lib/agent/mineShared.ts src/lib/domain/agentWork.ts "src/app/api/v1/agent/work/[id]/claim/route.ts" "src/app/api/v1/agent/work/[id]/release/route.ts" "src/app/api/v1/agent/work/[id]/report/route.ts" "src/app/api/v1/agent/work/[id]/route.ts" src/app/api/v1/agent/work/mine/route.ts tests/agent/write-routes-pat.test.ts tests/domain/agent-work.test.ts tests/migrations/agent-claim-owner.test.ts
git commit -m "feat(agent): 쓰기 루프 PAT 소유 판정 — claimed_by_user_id 축 전환, 교차 소유 양방향 403, evidence 수용"
```

**WP-03 수용 기준:** 테스트 프로젝트에서 조회→claim→progress→completion→PM 승인 통과, PC A claim → PC B report 성공(같은 PAT), 운영 D-CUBE 행 변화 0. (실기기 확인은 Task 18에서.)

---

### Task 11: 0073 WBS 담당자·단계·external_ref + upsert RPC

**Files:**
- Create: `supabase/migrations/0073_wbs_assignee_stage.sql` + `supabase/migrations/0073_wbs_assignee_stage_rollback.sql`
- Test: `tests/migrations/wbs-assignee-stage.test.ts`

**Interfaces:**
- Consumes: `project_members_id_project_uidx`(0041/0042 — `(id, project_id)` 복합 유니크 실재 확인됨), `wbs_items`(14컬럼: id·project_id·parent_id·code·sort_order·name·biz·deliverable·planned_start·planned_end·weight·actual_pct·is_owner_split·updated_at)
- Produces:
  - `wbs_items.assignee_member_id`(로스터 복합 FK)·`stage`·`external_ref` + 부분 유니크 `(project_id, external_ref)`
  - 활성 주문 부분 유니크 `agent_work_orders_active_per_item_uidx`(자동 발행 멱등의 DB 보증)
  - RPC `import_wbs_upsert(p_project_id uuid, p_nodes jsonb) returns jsonb` — Task 14가 호출

- [ ] **Step 1: 실패 테스트 작성**

`tests/migrations/wbs-assignee-stage.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const s = () => readFileSync('supabase/migrations/0073_wbs_assignee_stage.sql', 'utf8')

describe('0073 wbs 담당자·단계·external_ref·확장 명세(결정 B)', () => {
  it('컬럼 전부 nullable/additive 추가', () => {
    expect(s()).toContain('add column if not exists assignee_member_id uuid')
    expect(s()).toMatch(/add column if not exists stage text\s+check \(stage in \('todo','as','fp','ip','im','xx'\)\)/)
    expect(s()).toContain('add column if not exists external_ref text')
    for (const col of [
      'category text', 'domain text', 'model text', 'prd_ref text', 'entry_point text', 'spec text',
    ]) expect(s()).toContain(`add column if not exists ${col}`)
    expect(s()).toMatch(/add column if not exists priority text\s+check \(priority in \('critical','high','medium','low'\)\)/)
    expect(s()).toContain('add column if not exists tags text[]')
    expect(s()).toContain('add column if not exists depends text[]')
    expect(s()).toContain("add column if not exists acceptance jsonb not null default '[]'::jsonb")
  })
  it('로스터 복합 FK — set null 대상은 assignee 컬럼만(project_id 보호)', () => {
    expect(s()).toContain('references public.project_members (id, project_id)')
    expect(s()).toContain('on delete set null (assignee_member_id)')
  })
  it('external_ref 부분 유니크 + 활성 주문 부분 유니크', () => {
    expect(s()).toMatch(/wbs_items_project_external_ref_uidx[\s\S]*where external_ref is not null/)
    expect(s()).toMatch(/agent_work_orders_active_per_item_uidx[\s\S]*where status in \('ready','claimed','reported'\)/)
  })
  it('upsert RPC — 갱신 시 stage·assignee·actual_pct 를 덮지 않는다(필드 소유권 ⑫)', () => {
    expect(s()).toContain('create or replace function public.import_wbs_upsert')
    expect(s()).toMatch(/on conflict \(project_id, external_ref\) where external_ref is not null/)
    const updateClause = s().split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })
  it('rollback 이 컬럼·인덱스·RPC 를 제거', () => {
    const r = readFileSync('supabase/migrations/0073_wbs_assignee_stage_rollback.sql', 'utf8')
    expect(r).toContain('drop function if exists public.import_wbs_upsert')
    expect(r).toContain('drop column if exists external_ref')
  })
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/migrations/wbs-assignee-stage.test.ts` → FAIL

- [ ] **Step 3: 마이그레이션 작성**

`0073_wbs_assignee_stage.sql`:

```sql
-- 0073: WBS 전 계층 담당자(로스터 축)·Task 단계(stage)·업로드 매칭 키(external_ref).
-- v1 원칙("에이전트 기능은 기존 테이블 ALTER 0건")의 첫 의도적 예외 — 에이전트 전용이 아니라
-- WBS 제품 기능이다(§2.5). 전 컬럼 nullable/additive — 기존 행·기존 프로젝트 무영향.
-- 담당자 축은 auth 가 아니라 로스터: issue_assignees(0042) 관례의 복합 FK 로
-- "담당자의 프로젝트 = 항목의 프로젝트"를 DB 가 보장한다. 컬럼명은 status 가 아니라 stage —
-- 파생 Status(statusOf) 와의 충돌 회피.

begin;

set search_path = public, extensions;

alter table public.wbs_items
  add column if not exists assignee_member_id uuid,
  add column if not exists stage text
    check (stage in ('todo','as','fp','ip','im','xx')),
  add column if not exists external_ref text,
  -- 결정 B — WBS 중앙관리 확장 명세. 실물 문서는 로컬 git, DB 에는 참조 문자열(prd_ref·entry_point)과
  -- 조립된 마크다운 본문(spec)만 둔다. priority 는 라벨(주문 정수 매핑은 코드 몫 — 계약 v2.0).
  add column if not exists category text,
  add column if not exists domain text,
  add column if not exists priority text
    check (priority in ('critical','high','medium','low')),
  add column if not exists model text,
  add column if not exists tags text[],
  add column if not exists depends text[],   -- 선행 external_ref 배열(결정 C 게이트 키)
  add column if not exists prd_ref text,
  add column if not exists entry_point text,
  add column if not exists acceptance jsonb not null default '[]'::jsonb,
  add column if not exists spec text;

-- 복합 FK: on delete set null 의 대상 컬럼을 명시(PG15+) — 명시하지 않으면 project_id 까지 null 이 된다.
alter table public.wbs_items
  drop constraint if exists wbs_items_assignee_member_fk;
alter table public.wbs_items
  add constraint wbs_items_assignee_member_fk
  foreign key (assignee_member_id, project_id)
  references public.project_members (id, project_id)
  on delete set null (assignee_member_id);

create unique index if not exists wbs_items_project_external_ref_uidx
  on public.wbs_items (project_id, external_ref) where external_ref is not null;

-- 배정 기반 자동 발행의 멱등 보증 — 리프당 활성 주문 1개(§2.8).
-- 사전 확인: 중복 활성 주문이 있으면 인덱스 생성이 실패한다. 적용 전
--   select wbs_item_id, count(*) from agent_work_orders
--   where status in ('ready','claimed','reported') and wbs_item_id is not null
--   group by 1 having count(*) > 1;
-- 이 0행임을 확인하고, 있으면 사람이 취소로 정리한 뒤 적용한다(자동 정리 금지 — 점유 중 작업 보호).
create unique index if not exists agent_work_orders_active_per_item_uidx
  on public.agent_work_orders (wbs_item_id)
  where status in ('ready','claimed','reported') and wbs_item_id is not null;

-- upsert RPC — 마법사 전용 import_wbs(append)/replace_wbs(전삭제) 와 다른 제3의 경로(§2.6).
-- 매칭 키 external_ref. 삭제 없음. 필드 소유권(미결 ⑫ 권고안):
--   신규 행 = 파일 값 전부 시드 / 기존 행 = 구조·일정만 갱신, stage·assignee_member_id·actual_pct 보존.
-- security invoker — 호출은 service_role(라우트 가드가 유일 관문). 부모는 같은 배치의 앞 원소 또는 기존 행.
create or replace function public.import_wbs_upsert(
  p_project_id uuid,
  p_nodes jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_node jsonb;
  v_ref text;
  v_parent_ref text;
  v_parent_id uuid;
  v_existing uuid;
  v_upserted int := 0;
  v_skipped int := 0;
  v_ids jsonb := '{}'::jsonb;  -- external_ref → wbs_items.id
  v_new jsonb := '[]'::jsonb;  -- 신규 삽입된 external_ref 목록(호출부의 배정·발행 대상)
  v_id uuid;
  v_start date;
  v_end date;
begin
  for v_node in select * from jsonb_array_elements(p_nodes) loop
    v_ref := v_node->>'external_ref';
    if v_ref is null or v_ref = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_parent_ref := nullif(v_node->>'parent_external_ref', '');
    v_parent_id := null;
    if v_parent_ref is not null then
      -- 같은 배치 앞 원소 우선, 없으면 기존 행에서 해석. 둘 다 없으면 루트로 들어가지 않고 skip.
      if v_ids ? v_parent_ref then
        v_parent_id := (v_ids->>v_parent_ref)::uuid;
      else
        select id into v_parent_id from public.wbs_items
          where project_id = p_project_id and external_ref = v_parent_ref;
        if v_parent_id is null then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;
    end if;
    v_start := nullif(v_node->>'planned_start', '')::date;
    v_end := nullif(v_node->>'planned_end', '')::date;

    select id into v_existing from public.wbs_items
      where project_id = p_project_id and external_ref = v_ref;

    insert into public.wbs_items
      (project_id, parent_id, code, sort_order, name, biz, deliverable,
       planned_start, planned_end, stage, external_ref,
       category, domain, priority, model, tags, depends,
       prd_ref, entry_point, acceptance, spec)
    values
      (p_project_id, v_parent_id, coalesce(nullif(v_node->>'code',''), v_ref),
       coalesce((v_node->>'sort_order')::int, 0), v_node->>'title',
       nullif(v_node->>'biz',''), nullif(v_node->>'deliverable',''),
       v_start, v_end, nullif(v_node->>'stage',''), v_ref,
       nullif(v_node->>'category',''), nullif(v_node->>'domain',''),
       nullif(v_node->>'priority',''), nullif(v_node->>'model',''),
       array(select jsonb_array_elements_text(coalesce(v_node->'tags', '[]'::jsonb))),
       array(select jsonb_array_elements_text(coalesce(v_node->'depends', '[]'::jsonb))),
       nullif(v_node->>'prd_ref',''), nullif(v_node->>'entry_point',''),
       coalesce(v_node->'acceptance', '[]'::jsonb), nullif(v_node->>'spec',''))
    on conflict (project_id, external_ref) where external_ref is not null
    do update set
      parent_id = excluded.parent_id,
      code = excluded.code,
      sort_order = excluded.sort_order,
      name = excluded.name,
      biz = excluded.biz,
      deliverable = excluded.deliverable,
      planned_start = excluded.planned_start,
      planned_end = excluded.planned_end,
      -- 결정 B/E — 파일 소유 명세 필드는 재업로드가 갱신한다(⑫: stage·assignee·actual_pct 만 웹 보존).
      category = excluded.category,
      domain = excluded.domain,
      priority = excluded.priority,
      model = excluded.model,
      tags = excluded.tags,
      depends = excluded.depends,
      prd_ref = excluded.prd_ref,
      entry_point = excluded.entry_point,
      acceptance = excluded.acceptance,
      spec = excluded.spec,
      updated_at = now()
    returning id into v_id;

    v_ids := jsonb_set(v_ids, array[v_ref], to_jsonb(v_id::text));
    if v_existing is null then
      v_new := v_new || to_jsonb(v_ref);
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  return jsonb_build_object(
    'upserted', v_upserted, 'skipped', v_skipped, 'ids', v_ids, 'new_refs', v_new);
end;
$$;

reset search_path;

commit;
```

`0073_..._rollback.sql`:

```sql
-- 0073 rollback: 컬럼 3개·인덱스 2개·RPC 제거. 담당자·단계·external_ref 데이터는 소멸한다.
begin;
drop function if exists public.import_wbs_upsert(uuid, jsonb);
drop index if exists public.agent_work_orders_active_per_item_uidx;
drop index if exists public.wbs_items_project_external_ref_uidx;
alter table public.wbs_items drop constraint if exists wbs_items_assignee_member_fk;
alter table public.wbs_items
  drop column if exists spec,
  drop column if exists acceptance,
  drop column if exists entry_point,
  drop column if exists prd_ref,
  drop column if exists depends,
  drop column if exists tags,
  drop column if exists model,
  drop column if exists priority,
  drop column if exists domain,
  drop column if exists category,
  drop column if exists external_ref,
  drop column if exists stage,
  drop column if exists assignee_member_id;
commit;
```

주의: RPC 의 `stage` 는 **insert 값에만** 있고 `do update set` 에 없다 — 필드 소유권(⑫)의 DB 강제. `assignee_member_id`·주문 발행은 RPC 밖(호출부 TS — email 매칭이 필요해서다, Task 14).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/wbs-assignee-stage.test.ts` → PASS (5 tests)

- [ ] **Step 5: 마이그레이션 단독 커밋 + 테스트 DB 적용·실검증**

```bash
git add supabase/migrations/0073_wbs_assignee_stage.sql supabase/migrations/0073_wbs_assignee_stage_rollback.sql
git commit -m "feat(db): 0073 — WBS 로스터 담당자·6상태 stage·external_ref·upsert RPC·활성 주문 유니크"
```

테스트 DB 적용 후 SQL 콘솔에서 실검증(정적 테스트가 못 잡는 것):
1. `on delete set null (assignee_member_id)` 문법 수용 확인(PG17 — 실패 시 트리거 대안으로 전환하고 이 계획을 갱신한다)
2. 같은 payload 로 `import_wbs_upsert` 2회 호출 → 2회차 `upserted` 동일·행 수 불변·`new_refs` 빈 배열
3. 활성 주문 2건 강제 insert → 2건째가 unique violation 으로 실패

테스트 파일은 Task 12 커밋에 포함.

---

### Task 12: 배정·단계 서버 액션 + WBS 시트 편집기

**Files:**
- Create: `src/app/actions/wbsAssign.ts`
- Create: `src/components/wbs/WbsAssigneeStagePanel.tsx`
- Modify: `src/components/wbs/WbsGanttSheet.tsx` (행 선택 시 패널 노출 — 파일이 크므로 기존 패널/모달 노출 관례를 그대로 따라 최소 삽입)
- Test: `tests/actions/wbs-assign.test.ts`

**Interfaces:**
- Consumes: 0073 컬럼, 기존 `requireProjectAdmin`·`resolveProjectId`(`src/lib/authz/index.ts:154`), `IssueAssigneePicker`(`src/components/issues/IssueAssigneePicker.tsx`) 관례
- Produces:
  ```typescript
  export async function setWbsAssignee(itemId: string, memberId: string | null): Promise<{ ok: boolean; error?: string; orderCreated?: boolean }>
  export async function setWbsStage(itemId: string, stage: 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx' | null): Promise<{ ok: boolean; error?: string }>
  ```
  `orderCreated` 는 Task 13 연결 후 채워진다(이 태스크에서는 항상 undefined).

- [ ] **Step 1: 실패 테스트 작성**

`tests/actions/wbs-assign.test.ts` — `tests/actions/agent-work-actions.test.ts` 목 관례. 케이스:

```typescript
// vi.mock('@/lib/authz', ...) 로 requireProjectAdmin 을 목으로 대체:
//   ok 케이스 → { ok: true, actor: { userId: 'admin-1' } } / 거부 케이스 → { ok: false, error: '권한 없음' }
describe('setWbsAssignee', () => {
  it('관리자 + 같은 프로젝트 로스터 멤버 → 갱신 성공', async () => {
    // 큐: wbs_items [{ id: W1, project_id: P1, parent_id: null }] → project_members [{ id: M1, project_id: P1 }]
    //     → wbs_items update [{ id: W1 }]. 단언: r.ok === true, update payload 의 assignee_member_id === M1
  })
  it('다른 프로젝트의 member_id → 거부', async () => {
    // 큐: wbs_items [{ project_id: P1 }] → project_members [{ id: M1, project_id: P2 }]. 단언: r.ok === false
  })
  it('관리자 아님 → 거부', async () => {
    // requireProjectAdmin 목이 { ok: false } — DB update 큐가 소비되지 않아야 한다(captured 길이 0)
  })
  it('null 배정 해제 성공 — 활성 주문은 자동 취소하지 않는다(§2.8 역방향)', async () => {
    // memberId=null: project_members 조회 큐 없이 update 만. agent_work_orders 테이블 큐가 소비되지 않음을 단언
  })
})
describe('setWbsStage', () => {
  it('유효 stage 갱신 + change_logs 기록', async () => {
    // 큐: wbs_items 항목 조회 → stage 현재값 [{ stage: null }] → update [{ id: W1 }] → change_logs insert.
    // 단언: insert payload { field: 'stage', old_value: null, new_value: 'ip' }
  })
  it('허용 밖 문자열 거부', async () => {
    // setWbsStage(W1, 'dd' as never) → { ok: false } — DB 큐 소비 0
  })
})
```

주석의 큐 구성·단언을 **구현 시 전부 실제 코드로 채운다**(보일러플레이트는 `tests/actions/agent-work-actions.test.ts` 관례).

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/actions/wbs-assign.test.ts` → FAIL

- [ ] **Step 3: 구현**

`src/app/actions/wbsAssign.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'

/**
 * WBS 담당자(로스터 축)·단계(stage) 갱신 — §2.5. 배정 권한은 프로젝트 관리자.
 * 담당자는 노드 속성 — 하위 상속·롤업 없음. 배정 해제 시 활성 주문은 자동 취소하지 않는다(§2.8).
 */

const STAGES = new Set(['todo', 'as', 'fp', 'ip', 'im', 'xx'])

async function loadItem(itemId: string): Promise<
  | { ok: true; item: { id: string; project_id: string; parent_id: string | null } }
  | { ok: false; error: string }
> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wbs_items').select('id, project_id, parent_id').eq('id', itemId).maybeSingle()
  if (error) return { ok: false, error: `항목 조회 실패: ${error.message}` }
  if (!data) return { ok: false, error: '항목 없음' }
  return { ok: true, item: data as { id: string; project_id: string; parent_id: string | null } }
}

export async function setWbsAssignee(
  itemId: string, memberId: string | null,
): Promise<{ ok: boolean; error?: string; orderCreated?: boolean }> {
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
  const g = await requireProjectAdmin(item.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  if (memberId !== null) {
    if (!isUuidLike(memberId)) return { ok: false, error: '잘못된 요청입니다.' }
    // 쓰기 선행조회 — 로스터 실재 + 프로젝트 일치(복합 FK 가 2차 방어선, 여기가 1차).
    const { data: mem, error: memErr } = await admin
      .from('project_members').select('id, project_id').eq('id', memberId).maybeSingle()
    if (memErr) return { ok: false, error: `멤버 조회 실패: ${memErr.message}` }
    if (!mem || (mem as { project_id: string }).project_id !== item.project_id) {
      return { ok: false, error: '이 프로젝트의 로스터 멤버가 아닙니다.' }
    }
  }
  const { data: updated, error } = await admin
    .from('wbs_items')
    .update({ assignee_member_id: memberId, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true } // Task 13 에서 ensureOrderForAssignedLeaf 연결 후 orderCreated 반환
}

export async function setWbsStage(
  itemId: string, stage: 'todo' | 'as' | 'fp' | 'ip' | 'im' | 'xx' | null,
): Promise<{ ok: boolean; error?: string }> {
  if (stage !== null && !STAGES.has(stage)) return { ok: false, error: '허용되지 않는 단계입니다.' }
  const loaded = await loadItem(itemId)
  if (!loaded.ok) return loaded
  const { item } = loaded
  const g = await requireProjectAdmin(item.project_id)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const { data: cur, error: curErr } = await admin
    .from('wbs_items').select('stage').eq('id', itemId).maybeSingle()
  if (curErr) return { ok: false, error: `단계 조회 실패: ${curErr.message}` }
  const oldStage = (cur as { stage: string | null } | null)?.stage ?? null
  if (oldStage === stage) return { ok: true }
  const { data: updated, error } = await admin
    .from('wbs_items')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'stage',
    old_value: oldStage, new_value: stage,
  })
  if (logErr) console.error('[wbsAssign] 단계 변경 이력 기록 실패:', logErr.message)
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true }
}
```

`WbsAssigneeStagePanel.tsx` — 클라이언트 컴포넌트: 선택된 항목의 담당자 셀렉트(프로젝트 로스터 목록 — `IssueAssigneePicker` 의 데이터 소스 관례 재사용)와 단계 셀렉트(`todo/as/fp/ip/im/xx` + '미도입(null)'). 변경 시 위 액션 호출·낙관적 갱신 없이 재검증 의존. `WbsGanttSheet.tsx` 에는 기존 행 선택 상태에 패널 연결(파일 내 기존 사이드 패널·컨텍스트 UI 관례를 그대로 따른다 — 새 전역 스타일·레이아웃 변경 금지).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/wbs-assign.test.ts` → PASS. `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/wbsAssign.ts src/components/wbs/WbsAssigneeStagePanel.tsx src/components/wbs/WbsGanttSheet.tsx tests/actions/wbs-assign.test.ts tests/migrations/wbs-assignee-stage.test.ts
git commit -m "feat(wbs): 전 계층 개인 담당자(로스터 축)·Task 단계 편집 — 이슈 담당자 관례 재사용"
```

---

### Task 12A: WBS 명세 패널 (뷰어 조회·편집 — 결정 B)

**Files:**
- Create: `src/app/actions/wbsSpec.ts`
- Create: `src/components/wbs/WbsSpecPanel.tsx`
- Modify: `src/components/wbs/WbsAssigneeStagePanel.tsx` (명세 탭/구획 연결 — Task 12 산출물)
- Test: `tests/actions/wbs-spec.test.ts`

**Interfaces:**
- Consumes: 0073 확장 컬럼(Task 11), Task 12의 패널 노출 지점
- Produces:
  ```typescript
  export async function updateWbsSpec(itemId: string, spec: string): Promise<{ ok: boolean; error?: string }>
  export async function updateWbsSpecFields(itemId: string, fields: { prd_ref?: string | null; entry_point?: string | null; priority?: 'critical' | 'high' | 'medium' | 'low' | null }): Promise<{ ok: boolean; error?: string }>
  ```
  뷰어 표시: 스칼라(category·domain·priority·model·tags·depends·prd_ref·entry_point)는 배지/필드,
  `acceptance`는 체크리스트, `spec`은 **마크다운 렌더 + 편집 토글**(리포의 기존 마크다운 렌더 컴포넌트 관례 재사용 — 위키/회의록 계열에서 실측해 같은 것을 쓴다).

- [ ] **Step 1: 실패 테스트 작성**

`tests/actions/wbs-spec.test.ts` — Task 12 목 관례 그대로:

```typescript
describe('updateWbsSpec', () => {
  it('관리자 → spec 갱신 + change_logs(field: spec) 기록', async () => {
    // 큐: wbs_items 항목 조회 → update [{ id: W1 }] → change_logs insert.
    // 단언: update payload.spec === '# 새 명세', insert payload.field === 'spec'
  })
  it('관리자 아님 → 거부, DB 쓰기 큐 소비 0', async () => {})
  it('1MB 초과 spec 거부(상한)', async () => {
    // updateWbsSpec(W1, 'a'.repeat(1_048_577)) → { ok: false }
  })
})
describe('updateWbsSpecFields', () => {
  it('priority 허용 밖 라벨 거부', async () => {
    // { priority: 'urgent' as never } → { ok: false }
  })
  it('prd_ref·entry_point 부분 갱신 — 전달된 키만 update payload 에 포함', async () => {})
})
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `npx vitest run tests/actions/wbs-spec.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/app/actions/wbsSpec.ts` — `wbsAssign.ts`(Task 12)의 `loadItem`·`requireProjectAdmin` 패턴 그대로:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAdmin } from '@/lib/authz'
import { isUuidLike } from '@/lib/domain/agentWork'

/** WBS 명세(spec 마크다운·참조 필드) 편집 — 결정 B. 편집 권한은 배정과 동일(프로젝트 관리자). */

const SPEC_MAX = 1_048_576 // 1MB — spec 은 본문이지 저장소가 아니다(실물 문서는 로컬 git, 결정 A)
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])

export async function updateWbsSpec(itemId: string, spec: string): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (spec.length > SPEC_MAX) return { ok: false, error: '명세가 너무 큽니다(1MB 상한).' }
  const admin = createAdminClient()
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  const projectId = (item as { project_id: string }).project_id
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { data: updated, error } = await admin
    .from('wbs_items').update({ spec, updated_at: new Date().toISOString() })
    .eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  const { error: logErr } = await admin.from('change_logs').insert({
    user_id: g.actor.userId, wbs_item_id: itemId, field: 'spec',
    old_value: null, new_value: '(명세 갱신)', // 본문 전문을 로그에 넣지 않는다 — 크기·노이즈
  })
  if (logErr) console.error('[wbsSpec] 명세 변경 이력 기록 실패:', logErr.message)
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function updateWbsSpecFields(
  itemId: string,
  fields: { prd_ref?: string | null; entry_point?: string | null; priority?: 'critical' | 'high' | 'medium' | 'low' | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!isUuidLike(itemId)) return { ok: false, error: '잘못된 요청입니다.' }
  if (fields.priority !== undefined && fields.priority !== null && !PRIORITY_LABELS.has(fields.priority)) {
    return { ok: false, error: '허용되지 않는 우선순위입니다.' }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('prd_ref' in fields) patch.prd_ref = fields.prd_ref
  if ('entry_point' in fields) patch.entry_point = fields.entry_point
  if ('priority' in fields) patch.priority = fields.priority
  if (Object.keys(patch).length === 1) return { ok: false, error: '갱신할 필드가 없습니다.' }
  const admin = createAdminClient()
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('id, project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  if (!item) return { ok: false, error: '항목 없음' }
  const projectId = (item as { project_id: string }).project_id
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { data: updated, error } = await admin
    .from('wbs_items').update(patch).eq('id', itemId).select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: '갱신 대상 없음' }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
```

`WbsSpecPanel.tsx` — 클라이언트 컴포넌트: 상단 배지 행(category·domain·priority·model·tags), 참조 필드 2개(prd_ref·entry_point — 인라인 편집), depends 목록(external_ref 뒤 세그먼트 표시), acceptance 체크리스트(읽기 전용 — 정본은 import), spec 마크다운(보기 모드 = 렌더 / 편집 모드 = textarea + 저장 버튼 → `updateWbsSpec`). `WbsAssigneeStagePanel` 에 구획으로 편입.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/wbs-spec.test.ts` → PASS. `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/wbsSpec.ts src/components/wbs/WbsSpecPanel.tsx src/components/wbs/WbsAssigneeStagePanel.tsx tests/actions/wbs-spec.test.ts
git commit -m "feat(wbs): 명세 패널 — spec 마크다운 조회·편집, 스칼라 배지·참조 필드(결정 B)"
```

---

### Task 13: ensureOrderForAssignedLeaf 자동 발행 함수

**Files:**
- Create: `src/lib/agent/ensureOrder.ts`
- Modify: `src/app/actions/wbsAssign.ts` (setWbsAssignee 말미에 연결)
- Test: `tests/agent/ensure-order.test.ts`

**Interfaces:**
- Consumes: 0073 활성 주문 부분 유니크·확장 컬럼(priority 라벨·acceptance), `agent_projects` 게이트
- Produces:
  ```typescript
  export async function ensureOrderForAssignedLeaf(
    admin: AdminClient,
    args: { projectId: string; wbsItemId: string; actorUserId: string; instructions?: string },
  ): Promise<{ ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' } | { ok: false; error: string }>
  // src/lib/domain/agentWork.ts 에 추가(순수):
  export const ORDER_PRIORITY_BY_LABEL = { critical: 100, high: 50, medium: 10, low: 0 } as const
  export function orderPriorityFromLabel(label: string | null): number // 미기재·미지 라벨 = 0
  ```
  Task 14(import)·Task 12(배정 액션)의 공용 멱등 발행 함수(§2.8). 주문 priority 는 항목 priority 라벨 매핑,
  수용 기준은 주문에 복제하지 않고 `wbs_items.acceptance` 를 정본으로 참조(결정 B). `orderPriorityFromLabel` 단위 테스트를 `tests/domain/agent-work.test.ts` 에 3줄 추가한다(4개 라벨 + null + 'urgent' → 0).

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/ensure-order.test.ts` — admin 목 큐 관례:

```typescript
describe('ensureOrderForAssignedLeaf', () => {
  // 큐 순서(구현과 동일): agent_projects → wbs_items(자식) → agent_work_orders(활성) → agent_work_orders(insert)
  it('agent_projects 미등록 → created:false, reason not_agent_project (에러 아님 — 게이트 유지)', async () => {
    // 큐: agent_projects [{ data: null }]. 단언: { ok: true, created: false, reason: 'not_agent_project' }
  })
  it('자식 있는 항목 → created:false, reason not_leaf', async () => {
    // 큐: agent_projects [{ enabled: true }] → wbs_items [{ id: 'child' }]
  })
  it('활성 주문 존재 → created:false, reason active_exists (no-op 멱등)', async () => {
    // 큐: … → wbs_items [null] → agent_work_orders [{ id: 'o-1' }]
  })
  it('조건 충족 → insert, created:true, created_by=actorUserId', async () => {
    // 큐: … → agent_work_orders [null](활성 없음) → insert 성공. insert payload 의 created_by === 'admin-1' 단언
  })
  it('경합 unique violation(23505) → created:false 수렴(멱등 — 에러 아님)', async () => {
    // insert 큐가 { error: { code: '23505', message: 'duplicate' } } — { ok: true, created: false, reason: 'active_exists' }
  })
  it('선행조회 실패 → ok:false (3원칙 — 위장 금지)', async () => {
    // agent_projects 큐 { error: { message: 'db down' } } → { ok: false }
  })
})
```

- [ ] **Step 2: 실행해 실패 확인** → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/lib/agent/ensureOrder.ts`:

```typescript
import type { AdminClient } from '@/lib/minutes/externalApi'
import { orderPriorityFromLabel } from '@/lib/domain/agentWork'

/**
 * 배정 기반 자동 발행 — §2.8. "담당자가 배정된 리프 Task 는 주문이 자동으로 존재한다."
 * 멱등: 활성 주문(ready/claimed/reported) 부분 유니크(0073)가 DB 보증, 여기는 선행조회 + 23505 수렴.
 * 발행 조건은 기존 가드 그대로: agent_projects.enabled · 리프 · 호출부가 관리자 권한 경로.
 */
export async function ensureOrderForAssignedLeaf(
  admin: AdminClient,
  args: { projectId: string; wbsItemId: string; actorUserId: string; instructions?: string },
): Promise<
  | { ok: true; created: boolean; reason?: 'not_agent_project' | 'not_leaf' | 'active_exists' }
  | { ok: false; error: string }
> {
  const { projectId, wbsItemId, actorUserId } = args
  const { data: reg, error: regErr } = await admin
    .from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `등록 조회 실패: ${regErr.message}` }
  if (!reg || (reg as { enabled: boolean }).enabled !== true) {
    return { ok: true, created: false, reason: 'not_agent_project' }
  }
  const { data: child, error: childErr } = await admin
    .from('wbs_items').select('id').eq('parent_id', wbsItemId).limit(1).maybeSingle()
  if (childErr) return { ok: false, error: `하위 항목 확인 실패: ${childErr.message}` }
  if (child) return { ok: true, created: false, reason: 'not_leaf' }
  const { data: active, error: activeErr } = await admin
    .from('agent_work_orders').select('id').eq('wbs_item_id', wbsItemId)
    .in('status', ['ready', 'claimed', 'reported']).limit(1).maybeSingle()
  if (activeErr) return { ok: false, error: `활성 주문 확인 실패: ${activeErr.message}` }
  if (active) return { ok: true, created: false, reason: 'active_exists' }

  // 주문 priority = 항목 priority 라벨의 정수 매핑(계약 v2.0: critical=100/high=50/medium=10/low=0).
  // 수용 기준은 주문에 복제하지 않는다 — 정본은 wbs_items.acceptance jsonb 이고 claim/show 응답이 실어 나른다(결정 B).
  const { data: item, error: itemErr } = await admin
    .from('wbs_items').select('name, priority, external_ref').eq('id', wbsItemId).maybeSingle()
  if (itemErr) return { ok: false, error: `항목 조회 실패: ${itemErr.message}` }
  const row = item as { name: string; priority: string | null; external_ref: string | null } | null
  const { error } = await admin.from('agent_work_orders').insert({
    project_id: projectId, wbs_item_id: wbsItemId,
    instructions: args.instructions?.trim() || (row ? `${row.external_ref ?? ''} ${row.name}`.trim() : ''),
    priority: orderPriorityFromLabel(row?.priority ?? null), created_by: actorUserId,
  })
  if (error) {
    // 부분 유니크 경합 — 다른 트리거가 먼저 발행했다. 멱등 no-op.
    if ((error as { code?: string }).code === '23505') return { ok: true, created: false, reason: 'active_exists' }
    return { ok: false, error: error.message }
  }
  return { ok: true, created: true }
}
```

`setWbsAssignee` 말미(성공 갱신 후, `memberId !== null` 일 때만):

```typescript
  let orderCreated: boolean | undefined
  if (memberId !== null) {
    const ensured = await ensureOrderForAssignedLeaf(admin, {
      projectId: item.project_id, wbsItemId: itemId, actorUserId: g.actor.userId,
    })
    if (!ensured.ok) {
      // 배정은 성공했고 발행만 실패 — 위장하지 않고 알린다(사람이 수동 발행으로 복구 가능).
      return { ok: true, error: `배정됨. 자동 발행 실패: ${ensured.error}`, orderCreated: false }
    }
    orderCreated = ensured.created
  }
  revalidatePath(`/p/${item.project_id}`, 'layout')
  return { ok: true, orderCreated }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/ensure-order.test.ts tests/actions/wbs-assign.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/ensureOrder.ts src/app/actions/wbsAssign.ts tests/agent/ensure-order.test.ts
git commit -m "feat(agent): 배정 기반 자동 발행 — 멱등 ensureOrderForAssignedLeaf, 웹 배정 트리거 연결"
```

---

### Task 14: POST /api/v1/wbs/import

**Files:**
- Create: `src/app/api/v1/wbs/import/route.ts`
- Create: `src/lib/agent/wbsImport.ts` (파싱·매핑 로직 — 라우트는 얇게)
- Test: `tests/agent/wbs-import.test.ts`

**Interfaces:**
- Consumes: Task 11 RPC `import_wbs_upsert`, Task 13 `ensureOrderForAssignedLeaf`, Task 4 리졸버(PAT 전용 + `work:report` 스코프 + 프로젝트 관리자 판정)
- Produces: 계약 v2.0 `/wbs/import` — 요청 `{project_id, module, nodes[]}`, 응답 `{ok, upserted, skipped, unmatched_assignees[], non_leaf_skipped[], orders_created}`
- 노드 스키마(export JSON, §7.2-1): `id·parent_id·kind·title·stage·category·domain·assignee·schedule·depends[]·acceptance[]·priority`. `external_ref = <module>/<id>`, `parent_external_ref = <module>/<parent_id>`. `schedule` `"YYYY-MM-DD ~ YYYY-MM-DD"` 분해는 이 모듈 책임(§2.6)

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/wbs-import.test.ts`:

```typescript
describe('wbsImport 변환(순수부)', () => {
  it('schedule 문자열 분해', () => {
    expect(parseSchedule('2026-08-11 ~ 2026-08-14')).toEqual({ start: '2026-08-11', end: '2026-08-14' })
    expect(parseSchedule(null)).toEqual({ start: null, end: null })
    expect('error' in parseSchedule('8/11~8/14')).toBe(true)
  })
  it('external_ref 합성 — module + "/" + id, parent·depends 도 동일 규칙', () => {
    const base = { id: 'TSK-01-01', parent_id: 'WP-01', kind: 'task' as const, title: '조회 화면', stage: null, category: 'dev', domain: 'fullstack', assignee: 'A@B.c', schedule: null, depends: ['TSK-01-00'], acceptance: ['목록이 뜬다'], priority: 'high' as const, model: 'opus', tags: ['contract'], prd_ref: 'docs/prd.md#3', entry_point: 'src/x.tsx', spec_sections: null }
    const r = toRpcNode('MES', base, 7)
    expect(r).toMatchObject({
      external_ref: 'MES/TSK-01-01', parent_external_ref: 'MES/WP-01',
      depends: ['MES/TSK-01-00'], sort_order: 7, assignee: 'a@b.c',
      priority: 'high', acceptance: ['목록이 뜬다'],
    })
  })
  it('stage·priority 허용 밖 값은 노드 단위 거부', () => {
    const n = { id: 'T1', parent_id: null, kind: 'task' as const, title: 't', stage: null, category: null, domain: null, assignee: null, schedule: null, depends: [], acceptance: [], priority: null, model: null, tags: [], prd_ref: null, entry_point: null, spec_sections: null }
    expect('error' in toRpcNode('MES', { ...n, stage: 'dd' }, 0)).toBe(true)
    expect('error' in toRpcNode('MES', { ...n, priority: 'urgent' as never }, 0)).toBe(true)
  })
  it('spec_sections → 고정 섹션 순서 마크다운 조립(결정 E)', () => {
    const md = assembleSpecMarkdown({
      requirements: ['R1'], test_criteria: ['T1'], constraints: ['C1'],
      api_spec: 'GET /x', data_model: 'wbs_items(...)', description: '개요.',
    })
    expect(md).toBe('개요.\n\n## 요구사항\n- R1\n\n## 제약\n- C1\n\n## 테스트 기준\n- T1\n\n## API 스펙\nGET /x\n\n## 데이터 모델\nwbs_items(...)')
    expect(assembleSpecMarkdown(null)).toBeNull()
    expect(assembleSpecMarkdown({ requirements: [], test_criteria: [], constraints: [], api_spec: null, data_model: null, description: null })).toBeNull()
  })
})
describe('POST /wbs/import', () => {
  // 큐 순서: agent_runners(리졸버) → agent_projects(게이트) → project_roles+memberships(관리자 판정)
  //          → rpc('import_wbs_upsert') 목 → project_members(로스터 맵) → wbs_items update / ensureOrder 큐
  // admin 목에 rpc: vi.fn(async () => ({ data: { upserted: 3, skipped: 0, ids: {...}, new_refs: [...] }, error: null })) 추가.
  it('PAT + work:report + 관리자 → RPC 호출 + 신규 리프 배정 매칭 + orders_created 집계', async () => {
    // new_refs 에 assignee 있는 Task 1건 → 응답 { upserted: 3, orders_created: 1 } 단언
  })
  it('assignee 미매칭은 생략하지 않고 unmatched_assignees 전량 리포트(에러 3원칙)', async () => {
    // project_members 큐에 다른 email 만 → unmatched_assignees: [{ external_ref, assignee }] 단언
  })
  it('비관리자 PAT → 403 forbidden_role (import = 발행 권한과 동치)', async () => {
    // project_roles [{ role: 'member' }], is_superuser: false → 403
  })
  it('legacy 호출 → 400 identity_required', async () => {})
  it('nodes 1000건 초과 → 400', async () => {
    // nodes: Array.from({length:1001}, ...) — 리졸버 큐 소비 전에 400
  })
})
```

- [ ] **Step 2: 실행해 실패 확인** → FAIL

- [ ] **Step 3: 구현**

`src/lib/agent/wbsImport.ts` (순수부 + DB부 분리):

```typescript
import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForAssignedLeaf } from '@/lib/agent/ensureOrder'

export type SpecSections = {
  requirements: string[]; test_criteria: string[]; constraints: string[]
  api_spec: string | null; data_model: string | null; description: string | null
}
export type ImportNode = {
  id: string; parent_id: string | null; kind: 'phase' | 'act' | 'wp' | 'task'
  title: string; stage: string | null; category: string | null; domain: string | null
  assignee: string | null; schedule: string | null
  depends: string[]; acceptance: string[]
  priority: string | null // 라벨: critical/high/medium/low (계약 v2 — 결정 E)
  model: string | null; tags: string[]
  prd_ref: string | null; entry_point: string | null
  spec_sections: SpecSections | null
}
const STAGES = new Set(['todo', 'as', 'fp', 'ip', 'im', 'xx'])
const PRIORITY_LABELS = new Set(['critical', 'high', 'medium', 'low'])
const SCHEDULE_RE = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/

export function parseSchedule(s: string | null): { start: string | null; end: string | null } | { error: string } {
  if (!s) return { start: null, end: null }
  const m = SCHEDULE_RE.exec(s.trim())
  if (!m) return { error: `schedule 형식 오류: ${s}` }
  return { start: m[1], end: m[2] }
}

/** spec_sections → 마크다운 조립 — 섹션 순서는 계약 고정(결정 E): 머리말 → 요구사항 → 제약 → 테스트 기준 → API 스펙 → 데이터 모델. 빈 섹션 생략. */
export function assembleSpecMarkdown(s: SpecSections | null): string | null {
  if (!s) return null
  const parts: string[] = []
  if (s.description) parts.push(s.description.trim())
  const list = (title: string, items: string[]) => {
    if (items.length > 0) parts.push(`## ${title}\n${items.map(i => `- ${i}`).join('\n')}`)
  }
  list('요구사항', s.requirements ?? [])
  list('제약', s.constraints ?? [])
  list('테스트 기준', s.test_criteria ?? [])
  if (s.api_spec) parts.push(`## API 스펙\n${s.api_spec.trim()}`)
  if (s.data_model) parts.push(`## 데이터 모델\n${s.data_model.trim()}`)
  return parts.length > 0 ? parts.join('\n\n') : null
}

export function toRpcNode(module: string, n: ImportNode, index: number):
  | { external_ref: string; parent_external_ref: string | null; title: string
      stage: string | null; planned_start: string | null; planned_end: string | null
      sort_order: number; assignee: string | null
      category: string | null; domain: string | null; priority: string | null
      model: string | null; tags: string[]; depends: string[]
      prd_ref: string | null; entry_point: string | null
      acceptance: string[]; spec: string | null }
  | { error: string } {
  if (!n.id || !n.title) return { error: `id·title 필수: ${JSON.stringify(n.id)}` }
  if (n.stage !== null && n.stage !== undefined && !STAGES.has(n.stage)) return { error: `허용 밖 stage: ${n.stage} (${n.id})` }
  if (n.priority !== null && n.priority !== undefined && !PRIORITY_LABELS.has(n.priority)) {
    return { error: `허용 밖 priority 라벨: ${n.priority} (${n.id})` }
  }
  const sched = parseSchedule(n.schedule)
  if ('error' in sched) return { error: `${sched.error} (${n.id})` }
  return {
    external_ref: `${module}/${n.id}`,
    parent_external_ref: n.parent_id ? `${module}/${n.parent_id}` : null,
    title: n.title, stage: n.stage ?? null,
    planned_start: sched.start, planned_end: sched.end,
    sort_order: index, // 파일 내 등장 순서가 정렬 정본 — priority 는 정렬이 아니라 라벨(결정 E)
    assignee: n.assignee ? n.assignee.trim().toLowerCase() : null,
    category: n.category ?? null, domain: n.domain ?? null, priority: n.priority ?? null,
    model: n.model ?? null, tags: n.tags ?? [],
    depends: (n.depends ?? []).map(d => `${module}/${d}`), // 선행도 external_ref 로 저장(결정 C 게이트 키)
    prd_ref: n.prd_ref ?? null, entry_point: n.entry_point ?? null,
    acceptance: n.acceptance ?? [], spec: assembleSpecMarkdown(n.spec_sections),
  }
}

/** 업로드 후처리 — 신규 리프의 assignee email 을 로스터에 매칭하고 자동 발행까지(§2.6·§2.8). */
export async function applyAssigneesAndOrders(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string
    newRefs: string[]; idsByRef: Record<string, string>
    assigneeByRef: Record<string, string | null> },
): Promise<{ unmatched: Array<{ external_ref: string; assignee: string }>; ordersCreated: number; nonLeafSkipped: string[] }> {
  const { projectId, actorUserId } = args
  const unmatched: Array<{ external_ref: string; assignee: string }> = []
  const nonLeafSkipped: string[] = []
  let ordersCreated = 0
  // 로스터 email → member_id 맵 1회 로드
  const { data: members, error } = await admin
    .from('project_members').select('id, email').eq('project_id', projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const memberByEmail = new Map<string, string>()
  for (const m of (members ?? []) as Array<{ id: string; email: string | null }>) {
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m.id)
  }
  for (const ref of args.newRefs) {
    const email = args.assigneeByRef[ref]
    if (!email) continue
    const itemId = args.idsByRef[ref]
    if (!itemId) continue
    const memberId = memberByEmail.get(email)
    if (!memberId) {
      unmatched.push({ external_ref: ref, assignee: email }) // 생략하지 않고 전량 리포트
      continue
    }
    const { error: upErr } = await admin
      .from('wbs_items').update({ assignee_member_id: memberId }).eq('id', itemId)
    if (upErr) throw new Error(`담당자 반영 실패(${ref}): ${upErr.message}`)
    const ensured = await ensureOrderForAssignedLeaf(admin, { projectId, wbsItemId: itemId, actorUserId })
    if (!ensured.ok) throw new Error(`자동 발행 실패(${ref}): ${ensured.error}`)
    if (ensured.created) ordersCreated += 1
    if (ensured.reason === 'not_leaf') nonLeafSkipped.push(ref)
  }
  return { unmatched, ordersCreated, nonLeafSkipped }
}
```

`src/app/api/v1/wbs/import/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound,
  requireAgentProject, requireScope, resolveAgentPrincipal, patProjectAllowed,
} from '@/lib/agent/externalApi'
import { isUuidLike } from '@/lib/domain/agentWork'
import { applyAssigneesAndOrders, toRpcNode, type ImportNode } from '@/lib/agent/wbsImport'

/** POST /api/v1/wbs/import — export JSON 모듈별 upsert 업로드(§2.6). PAT 전용·관리자 전용. */
export const dynamic = 'force-dynamic'

const MAX_NODES = 1000

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = raw as Record<string, unknown>
  const projectId = typeof b.project_id === 'string' ? b.project_id : ''
  const module_ = typeof b.module === 'string' ? b.module.trim() : ''
  if (!isUuidLike(projectId)) return apiBadRequest('project_id가 필요합니다.')
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(module_)) return apiBadRequest('module 형식이 올바르지 않습니다.')
  if (!Array.isArray(b.nodes) || b.nodes.length === 0) return apiBadRequest('nodes가 필요합니다.')
  if (b.nodes.length > MAX_NODES) return apiBadRequest(`nodes는 ${MAX_NODES}건 이하여야 합니다.`)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:report')
    if (scopeErr) return scopeErr
    if (!patProjectAllowed(principal, projectId)) return apiNotFound()
    if (!(await requireAgentProject(admin, projectId))) return apiNotFound()
    // import = 구조 쓰기 + 자동 발행 트리거 — 발행과 같은 관리자 전용(§2.8). member 는 403.
    const { data: roleRow, error: roleErr } = await admin
      .from('project_roles').select('role').eq('user_id', principal.userId).eq('project_id', projectId).limit(1)
    const { data: mem, error: memErr } = await admin
      .from('memberships').select('is_superuser').eq('user_id', principal.userId).maybeSingle()
    if (roleErr || memErr) return apiInternalError()
    const isSuper = !!(mem as { is_superuser?: boolean } | null)?.is_superuser
    const isAdmin = ((roleRow ?? []) as Array<{ role: string }>).some(r => r.role === 'admin')
    if (!isSuper && !isAdmin) return apiFail(403, 'forbidden_role', '프로젝트 관리자만 업로드할 수 있습니다.')

    // 변환 — 실패 노드는 생략하지 않고 400 으로 전량 보고(에러 3원칙).
    const rpcNodes: unknown[] = []
    const assigneeByRef: Record<string, string | null> = {}
    const errors: string[] = []
    for (const [i, nRaw] of (b.nodes as ImportNode[]).entries()) {
      const r = toRpcNode(module_, nRaw, i)
      if ('error' in r) { errors.push(r.error); continue }
      rpcNodes.push(r)
      assigneeByRef[r.external_ref] = r.assignee
    }
    if (errors.length > 0) return apiBadRequest(`노드 변환 실패 ${errors.length}건: ${errors.slice(0, 5).join(' / ')}`)

    const { data: rpcOut, error: rpcErr } = await admin
      .rpc('import_wbs_upsert', { p_project_id: projectId, p_nodes: rpcNodes })
    if (rpcErr) {
      console.error('[wbs-import] upsert 실패:', rpcErr.message)
      return apiFail(409, 'apply_failed', `업로드 실패: ${rpcErr.message}`)
    }
    const out = rpcOut as { upserted: number; skipped: number; ids: Record<string, string>; new_refs: string[] }

    const post = await applyAssigneesAndOrders(admin, {
      projectId, actorUserId: principal.userId,
      newRefs: out.new_refs, idsByRef: out.ids, assigneeByRef,
    })
    return NextResponse.json({
      ok: true, upserted: out.upserted, skipped: out.skipped,
      unmatched_assignees: post.unmatched, non_leaf_skipped: post.nonLeafSkipped,
      orders_created: post.ordersCreated,
    })
  } catch (e) {
    console.error('[wbs-import] 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = () => apiFail(404, 'not_found', 'Not Found')
export const PUT = GET
export const DELETE = GET
export const PATCH = GET
export const OPTIONS = GET
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent/wbs-import.test.ts` → PASS. `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/wbs/import/route.ts src/lib/agent/wbsImport.ts tests/agent/wbs-import.test.ts
git commit -m "feat(agent): POST /wbs/import — external_ref upsert 업로드·미매칭 전량 리포트·자동 발행 연결"
```

- [ ] **Step 6: 테스트 DB 실검증 (DEV-02 완료 전 과도기)**

`wbs-parse.py --export` 가 아직 없으므로(외부 의존 DEV-02) 계약 v2 스키마로 손으로 만든 4노드 JSON(WP 1 + Task 3 — Task 18 의 T-A/T-B/T-C 구성과 동일: assignee·depends·spec_sections·acceptance·priority 라벨 포함)을 curl 로 업로드:
재업로드 멱등(2회차 `orders_created: 0`), `unmatched_assignees` 동작, `/agent/work?project_id=` 에 자동 발행 주문 노출을 확인한다.

---

### Task 15: scope=assigned + claim 배정·선행 게이트 (결정 C-①)

**Files:**
- Create: `src/lib/agent/assignee.ts`
- Create: `src/lib/agent/depends.ts`
- Modify: `src/lib/agent/mineShared.ts` + `src/app/api/v1/agent/work/mine/route.ts` (`assigned` 구획)
- Modify: `src/app/api/v1/agent/work/[id]/claim/route.ts` (배정 제한 + 선행 게이트 + 응답 확장)
- Modify: `src/app/api/v1/agent/work/[id]/route.ts` (PAT 응답 item 확장 + `depends_evidence`)
- Modify: `src/lib/domain/agentWork.ts` (`stageAtLeast` 순수 함수)
- Test: `tests/agent/assigned-scope.test.ts`, `tests/agent/depends-gate.test.ts`

**Interfaces:**
- Consumes: 0073 `assignee_member_id`·`depends`·`stage`·확장 명세 컬럼, 0072 `evidence`, Task 10의 쓰기 경로
- Produces:
  ```typescript
  // src/lib/domain/agentWork.ts
  export const STAGE_ORDER = ['todo', 'as', 'fp', 'ip', 'im', 'xx'] as const
  export function stageAtLeast(stage: string | null, min: 'im'): boolean // null·미지 값 = false (fail-closed)
  // src/lib/agent/assignee.ts
  export async function myMemberIds(admin: AdminClient, args: { userId: string; userEmail: string; projectId: string }): Promise<string[]>
  // src/lib/agent/depends.ts
  export type DependInfo = { external_ref: string; stage: string | null; branch: string | null; head_sha: string | null }
  export async function loadDependsInfo(admin: AdminClient, args: { projectId: string; depends: string[] }): Promise<DependInfo[]>
  // 각 선행 external_ref 의 stage + 최근 approved 주문의 completion evidence(branch·head_sha).
  // 프로젝트에 없는 ref 는 { stage: null, branch: null, head_sha: null } 로 반환(미충족 판정 재료).
  export const ITEM_DETAIL_COLUMNS = 'id, code, name, external_ref, stage, category, domain, priority, model, tags, depends, prd_ref, entry_point, acceptance, spec, assignee_member_id, planned_start, planned_end'
  ```
  - `/work/mine?scope=assigned`: 내 배정 리프의 활성 주문 목록(자동 발행이 주문 존재를 보증 — §2.8과 정합)
  - claim: ① 배정 제한 — `assignee_member_id` 있으면 그 사람만(403 `not_assignee`) ② **선행 게이트(결정 C)** — depends 중 `stageAtLeast(stage,'im')` 아닌 것이 있으면 403 `dependency_not_met` + `unmet: [{external_ref, stage}]`. 레거시 경로에도 동일 적용
  - claim 200·`GET /work/{id}`(PAT) 응답: `item` 을 `ITEM_DETAIL_COLUMNS` 로 확장(클라이언트 spec.md 캐시 재료 — 결정 A) + `depends_evidence: DependInfo[]`

- [ ] **Step 1: 실패 테스트 작성**

`tests/agent/assigned-scope.test.ts`:

```typescript
describe('myMemberIds — 로스터 다리 이중 매칭', () => {
  it('user_id 링크 행과 email 매칭 행을 합집합·중복 제거로 반환', async () => {
    // project_members 큐: [{ id:'m1', user_id:'u-1', email:null }, { id:'m2', user_id:null, email:'DEV@example.com' }, { id:'m3', user_id:'u-9', email:'x@y.z' }]
    // myMemberIds(admin, { userId:'u-1', userEmail:'dev@example.com', projectId:P1 }) → ['m1','m2'] (m3 제외)
  })
  it('조회 실패는 throw (보안 판정 재료 — 위장 금지)', async () => {
    // 큐 { error: { message: 'db down' } } → await expect(...).rejects.toThrow()
  })
})
describe('scope=assigned', () => {
  it('내 배정 항목의 활성 주문만 반환', async () => {
    // wbs_items 큐: assignee_member_id ∈ ['m1'] 항목 1건 → 그 항목의 ready 주문만 assigned 구획에
  })
})
describe('claim 배정 제한', () => {
  // 큐: 리졸버·멤버십 통과분(Task 10 관례) + wbs_items [{ assignee_member_id }] + project_members(myMemberIds)
  it('배정 항목 + 본인 → 200', async () => {
    // assignee_member_id: 'm1', 로스터 큐가 m1 을 내 것으로 → CAS 진행 → 200
  })
  it('배정 항목 + 타인 → 403 not_assignee', async () => {
    // assignee_member_id: 'm9' → 403 + code 단언
  })
  it('무배정 항목 → 선착순 그대로 200', async () => {
    // assignee_member_id: null → project_members 큐 소비 없이 CAS → 200
  })
})
```

`tests/agent/depends-gate.test.ts` (결정 C-①):

```typescript
describe('stageAtLeast', () => {
  it("im·xx 만 통과, null·todo~ip·미지 값은 false(fail-closed)", () => {
    expect(stageAtLeast('im', 'im')).toBe(true)
    expect(stageAtLeast('xx', 'im')).toBe(true)
    for (const s of [null, 'todo', 'as', 'fp', 'ip', 'dd']) expect(stageAtLeast(s, 'im')).toBe(false)
  })
})
describe('claim 선행 게이트', () => {
  // 큐: 리졸버·멤버십 통과분 + wbs_items(대상 항목: depends ['MES/TSK-01-00']) + wbs_items(선행 조회)
  it('선행 stage=im → 통과(CAS 진행)', async () => {})
  it('선행 stage=ip → 403 dependency_not_met + unmet 배열', async () => {
    // 응답 body: { code: 'dependency_not_met', unmet: [{ external_ref: 'MES/TSK-01-00', stage: 'ip' }] }
  })
  it('선행 ref 가 프로젝트에 없음 → 미충족(403) — fail-closed', async () => {})
  it('depends 빈 배열·null → 게이트 없이 통과', async () => {})
})
describe('depends_evidence', () => {
  it('선행의 최근 approved 주문 completion evidence 에서 branch·head_sha 추출, 없으면 null', async () => {
    // 큐: 선행 항목 → agent_work_orders(approved 최신) → agent_work_reports(completion 최신, evidence: { branch, head_sha })
  })
})
```

- [ ] **Step 2: 실행해 실패 확인** → FAIL

- [ ] **Step 3: 구현**

`src/lib/agent/assignee.ts`:

```typescript
import type { AdminClient } from '@/lib/minutes/externalApi'

/** 로스터 다리 이중 매칭(§2.5-④) — user_id 링크(0019 트리거) 또는 email 소문자 일치. */
export async function myMemberIds(
  admin: AdminClient, args: { userId: string; userEmail: string; projectId: string },
): Promise<string[]> {
  const { data, error } = await admin
    .from('project_members').select('id, user_id, email').eq('project_id', args.projectId)
  if (error) throw new Error(`로스터 조회 실패: ${error.message}`)
  const email = args.userEmail.toLowerCase()
  const out = new Set<string>()
  for (const m of (data ?? []) as Array<{ id: string; user_id: string | null; email: string | null }>) {
    if (m.user_id === args.userId || (m.email && m.email.toLowerCase() === email)) out.add(m.id)
  }
  return [...out]
}
```

claim 제한(`claim/route.ts`, 주문 로드 후 CAS 전):

```typescript
    if (loaded.order.wbs_item_id) {
      // 배정·선행 게이트·응답 확장이 모두 쓰는 항목 상세 — ITEM_DETAIL_COLUMNS 로 1회만 로드한다.
      const { data: item, error: itemErr } = await admin
        .from('wbs_items').select(ITEM_DETAIL_COLUMNS).eq('id', loaded.order.wbs_item_id).maybeSingle()
      if (itemErr) {
        console.error('[agent-api] 배정 확인 실패(거절):', itemErr.message) // fail-closed
        return apiInternalError()
      }
      const assignee = (item as { assignee_member_id: string | null } | null)?.assignee_member_id
      if (assignee) {
        const mine = await myMemberIds(admin, {
          userId: actorUserId, userEmail: actorEmail, projectId: loaded.order.project_id,
        })
        if (!mine.includes(assignee)) {
          return apiFail(403, 'not_assignee', '담당자가 배정된 작업입니다. 담당자만 착수할 수 있습니다.')
        }
      }
    }
```

(`actorUserId`/`actorEmail` — PAT 는 principal, legacy 는 `loadGatedOrder` 반환 + body email.)

선행 게이트(`claim/route.ts`, 배정 검사와 같은 항목 조회를 공유 — `ITEM_DETAIL_COLUMNS` 로 1회 로드):

```typescript
    const depends = ((item as { depends: string[] | null } | null)?.depends ?? [])
    let dependsInfo: DependInfo[] = []
    if (depends.length > 0) {
      dependsInfo = await loadDependsInfo(admin, { projectId: loaded.order.project_id, depends })
      const unmet = dependsInfo.filter(d => !stageAtLeast(d.stage, 'im'))
      if (unmet.length > 0) {
        return NextResponse.json({
          error: '선행 작업이 완료(im 이상)되지 않았습니다.', code: 'dependency_not_met',
          unmet: unmet.map(d => ({ external_ref: d.external_ref, stage: d.stage })),
        }, { status: 403 })
      }
    }
    // …CAS 성공 후 응답: { ok: true, status: 'claimed', item: <ITEM_DETAIL_COLUMNS 행>, depends_evidence: dependsInfo }
```

`src/lib/agent/depends.ts` — `loadDependsInfo`:

```typescript
import type { AdminClient } from '@/lib/minutes/externalApi'

export type DependInfo = { external_ref: string; stage: string | null; branch: string | null; head_sha: string | null }

/** 선행 정보 — stage 는 게이트 재료(결정 C-①), evidence 는 클라이언트 로컬 도달 검사 재료(C-②). */
export async function loadDependsInfo(
  admin: AdminClient, args: { projectId: string; depends: string[] },
): Promise<DependInfo[]> {
  const { data: items, error } = await admin
    .from('wbs_items').select('id, external_ref, stage')
    .eq('project_id', args.projectId).in('external_ref', args.depends)
  if (error) throw new Error(`선행 항목 조회 실패: ${error.message}`) // 게이트 재료 — 위장 금지(호출부 500)
  const byRef = new Map((items ?? []).map((i: { external_ref: string }) => [i.external_ref, i]) as never)
  const out: DependInfo[] = []
  for (const ref of args.depends) {
    const item = byRef.get(ref) as { id: string; stage: string | null } | undefined
    if (!item) { out.push({ external_ref: ref, stage: null, branch: null, head_sha: null }); continue }
    // 최근 approved 주문 → 최신 completion 보고의 evidence
    let branch: string | null = null, headSha: string | null = null
    const { data: order } = await admin
      .from('agent_work_orders').select('id').eq('wbs_item_id', item.id).eq('status', 'approved')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (order) {
      const { data: rep } = await admin
        .from('agent_work_reports').select('evidence').eq('work_order_id', (order as { id: string }).id)
        .eq('kind', 'completion').order('created_at', { ascending: false }).limit(1).maybeSingle()
      const ev = (rep as { evidence?: Record<string, unknown> } | null)?.evidence ?? {}
      branch = typeof ev.branch === 'string' ? ev.branch : null
      headSha = typeof ev.head_sha === 'string' ? ev.head_sha : null
    }
    out.push({ external_ref: ref, stage: item.stage, branch, head_sha: headSha })
  }
  return out
}
```

`[id]/route.ts` — PAT 호출 시 item select 를 `ITEM_DETAIL_COLUMNS` 로 확장하고 `depends_evidence` 를 응답에 추가(레거시 호출 응답은 v1 그대로 — 회귀 기준선).

`mineShared.ts` — `assigned` 구획: `myMemberIds` 를 접근 가능 프로젝트별로 구해 `wbs_items.assignee_member_id in (…)` 항목의 활성 주문(`ready/claimed/reported`)을 모은다. `SUPPORTED_SCOPES = ['available','claimed','all','assigned']`, `all` 응답은 `claimed → assigned → available` 순 구획.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/agent` → 전부 PASS (기존 회귀 포함)

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/assignee.ts src/lib/agent/depends.ts src/lib/agent/mineShared.ts src/lib/domain/agentWork.ts src/app/api/v1/agent/work/mine/route.ts "src/app/api/v1/agent/work/[id]/claim/route.ts" "src/app/api/v1/agent/work/[id]/route.ts" tests/agent/assigned-scope.test.ts tests/agent/depends-gate.test.ts
git commit -m "feat(agent): 배정·선행 게이트 — scope=assigned, not_assignee, depends stage 하드 차단(dependency_not_met)"
```

---

### Task 16: dflow.sh — curl 래퍼

**Files:**
- Create: `docs/agent/claude-skill/dflow-work/scripts/dflow.sh` (실행권한 755)

**Interfaces:**
- Consumes: 계약 v2.0(Task 1) — 엔드포인트·에러코드·exit code 표
- Produces: 서브커맨드 `me|list|show|claim|progress|done|release|doctor` + 프로필(`DFLOW_PATS`·`--as`·`list --all`). SKILL.md(Task 17)가 이 계약으로 호출한다.
- **계획 결정**: JSON 파싱에 `jq` 필수(의존성 0 원칙의 유일한 예외 — `doctor` 가 검사). POSIX sh 만으로의 JSON 파싱은 오류 표면이 더 크다.

- [ ] **Step 1: 스크립트 작성**

```bash
#!/bin/sh
# dflow.sh — D'Flow Agent API 얇은 curl 래퍼. 계약 v2.0 (references/api-contract.md).
# exit: 0 성공 / 2 사용법·설정 / 3 인증 / 4 상태충돌 / 5 권한 / 6 네트워크·서버 / 7 기능꺼짐
# 토큰은 env 확장으로만 전달한다 — echo·파일 기록·명령 문자열 보간 금지.
set -u

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/dflow"
LIST_CACHE="$CACHE_DIR/last-list.json"
PROFILE_CACHE="$CACHE_DIR/profiles.json"

usage() {
  cat >&2 <<'EOF'
사용법: dflow.sh [--as <이름|email>] <cmd> [args]
  me                     현재 프로필 신원·접근 프로젝트
  list [--all] [--scope available|claimed|assigned|all]
  show <ref>             ref = 목록 순번 | UUID 앞 8자 | 전체 UUID
  claim <ref>
  progress <ref> <pct 0-99> <요약>
  done <ref> <요약> [--auto-links]
  release <ref>
  doctor                 설정·의존성·계약 버전 점검
EOF
  exit 2
}

die() { printf '%s\n' "$2" >&2; exit "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || die 2 "필요한 명령이 없습니다: $1"; }

# ---- 설정·프로필 ----------------------------------------------------------
base() {
  [ -n "${DFLOW_API_BASE:-}" ] || die 2 "DFLOW_API_BASE 미설정 — .env 를 확인하세요."
  printf '%s' "${DFLOW_API_BASE%/}"
}
# DFLOW_PATS(쉼표 구분) 우선, 없으면 DFLOW_PAT 단일. 토큰 문자열은 변수로만 다룬다.
tokens() {
  if [ -n "${DFLOW_PATS:-}" ]; then printf '%s' "$DFLOW_PATS" | tr ',' '\n'
  elif [ -n "${DFLOW_PAT:-}" ]; then printf '%s\n' "$DFLOW_PAT"
  else die 2 "DFLOW_PATS 또는 DFLOW_PAT 미설정"; fi
}
# 프로필 캐시: [{prefix, email}] — 평문 토큰은 캐시하지 않는다(재조회 키는 prefix).
profile_email() { # $1=token → 캐시에서 email, 없으면 /me 조회 후 캐시
  _pfx=$(printf '%s' "$1" | cut -d_ -f3)
  if [ -f "$PROFILE_CACHE" ]; then
    _hit=$(jq -r --arg p "$_pfx" '.[] | select(.prefix==$p) | .email' "$PROFILE_CACHE" 2>/dev/null | head -1)
    [ -n "$_hit" ] && { printf '%s' "$_hit"; return 0; }
  fi
  _body=$(TOKEN="$1" api_raw GET /api/v1/agent/me) || return 1
  _email=$(printf '%s' "$_body" | jq -r '.user_email')
  mkdir -p "$CACHE_DIR"; chmod 700 "$CACHE_DIR"
  { [ -f "$PROFILE_CACHE" ] && cat "$PROFILE_CACHE" || printf '[]'; } \
    | jq --arg p "$_pfx" --arg e "$_email" '. + [{prefix:$p, email:$e}] | unique_by(.prefix)' \
    > "$PROFILE_CACHE.tmp" && mv "$PROFILE_CACHE.tmp" "$PROFILE_CACHE"
  chmod 600 "$PROFILE_CACHE"
  printf '%s' "$_email"
}
# --as 해석: 이름/이메일 부분 일치 프로필의 토큰 1개 선택. 미지정이면 첫 토큰.
pick_token() { # $1=--as 값('' 허용)
  _want="$1"; _found=''
  for _t in $(tokens); do
    [ -z "$_want" ] && { printf '%s' "$_t"; return 0; }
    _e=$(profile_email "$_t") || continue
    case "$_e" in *"$_want"*) _found="$_t"; break;; esac
  done
  [ -n "$_found" ] || die 2 "프로필을 찾지 못했습니다: $_want"
  printf '%s' "$_found"
}

# ---- HTTP ----------------------------------------------------------------
api_raw() { # $1=METHOD $2=PATH [$3=JSON body] — TOKEN env 필요. 성공 시 body 출력.
  _code=$(curl -sS -o /tmp/dflow_body.$$ -w '%{http_code}' -X "$1" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    ${3:+--data "$3"} "$(base)$2" 2>/dev/null) || { rm -f /tmp/dflow_body.$$; die 6 "네트워크 오류"; }
  _body=$(cat /tmp/dflow_body.$$; rm -f /tmp/dflow_body.$$)
  case "$_code" in
    2??) printf '%s' "$_body"; return 0 ;;
    401) printf '%s\n' "$_body" >&2; exit 3 ;;
    403) printf '%s\n' "$_body" >&2; exit 5 ;;
    404) printf '%s\n' "$_body" >&2; exit 7 ;;
    409) printf '%s\n' "$_body" >&2; exit 4 ;;
    4??) printf '%s\n' "$_body" >&2; exit 2 ;;
    *)   printf '%s\n' "$_body" >&2; exit 6 ;;
  esac
}

# ---- ref 해석: 순번 → 캐시, 8자 접두/전체 UUID → 그대로 --------------------
resolve_ref() {
  case "$1" in
    [0-9]|[0-9][0-9])
      [ -f "$LIST_CACHE" ] || die 2 "목록 캐시가 없습니다 — 먼저 list 를 실행하세요."
      # 캐시 TTL 30분
      _now=$(date +%s); _mt=$(stat -f %m "$LIST_CACHE" 2>/dev/null || stat -c %Y "$LIST_CACHE")
      [ $((_now - _mt)) -le 1800 ] || die 2 "목록 캐시가 오래됐습니다 — list 를 다시 실행하세요."
      _id=$(jq -r --argjson n "$1" '.[$n-1].id // empty' "$LIST_CACHE")
      [ -n "$_id" ] || die 2 "순번 $1 이 목록에 없습니다."
      printf '%s' "$_id" ;;
    ????????-*) printf '%s' "$1" ;;
    ????????)
      [ -f "$LIST_CACHE" ] || die 2 "UUID 접두 해석에는 목록 캐시가 필요합니다 — list 먼저."
      _id=$(jq -r --arg p "$1" '.[] | select(.id | startswith($p)) | .id' "$LIST_CACHE" | head -1)
      [ -n "$_id" ] || die 2 "접두 $1 로 시작하는 주문이 목록에 없습니다."
      printf '%s' "$_id" ;;
    *) die 2 "ref 형식: 순번 | UUID 8자 | 전체 UUID" ;;
  esac
}

# ---- 출력: compact 1행/건 (순번 상태 우선순위 id8 이름40) -------------------
print_list() { # stdin = 주문 배열 JSON
  jq -r 'to_entries[] | [
    (.key+1),
    ({ready:"RD",claimed:"CL",reported:"RP",approved:"AP",cancelled:"CX"}[.value.status] // "??"),
    .value.priority,
    (.value.id[0:8]),
    ((.value.item.name // .value.instructions // "-") | .[0:40])
  ] | @tsv'
}

# ---- 커맨드 ---------------------------------------------------------------
cmd_me() { TOKEN="$TOK" api_raw GET /api/v1/agent/me | jq . ; }

cmd_list() {
  _scope='available'; _all=''
  while [ $# -gt 0 ]; do case "$1" in
    --all) _all=1 ;;
    --scope) _scope="$2"; shift ;;
    *) die 2 "알 수 없는 옵션: $1" ;;
  esac; shift; done
  if [ -n "$_all" ]; then
    for _t in $(tokens); do
      printf '== %s ==\n' "$(profile_email "$_t" || printf '?')"
      TOKEN="$_t" api_raw GET "/api/v1/agent/work/mine?scope=$_scope" \
        | jq '[.claimed[]?, .assigned[]?, .available[]?]' | tee "$LIST_CACHE.tmp" | print_list
    done
  else
    TOKEN="$TOK" api_raw GET "/api/v1/agent/work/mine?scope=$_scope" \
      | jq '[.claimed[]?, .assigned[]?, .available[]?]' > "$LIST_CACHE.tmp"
    print_list < "$LIST_CACHE.tmp"
  fi
  mkdir -p "$CACHE_DIR"; mv "$LIST_CACHE.tmp" "$LIST_CACHE" 2>/dev/null || true
}

cmd_show() { _id=$(resolve_ref "$1"); TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id" | jq . ; }

# 선행 로컬 도달 검사(결정 C-②) — depends_evidence 의 head_sha 가 현재 리포에 없거나
# HEAD 조상이 아니면 하드 차단(exit 4). 경고+확인이 아니다.
check_depends_local() { # $1=depends_evidence JSON 배열
  printf '%s' "$1" | jq -c '.[] | select(.head_sha != null)' | while IFS= read -r _d; do
    _sha=$(printf '%s' "$_d" | jq -r '.head_sha')
    _ref=$(printf '%s' "$_d" | jq -r '.external_ref')
    git cat-file -e "$_sha^{commit}" 2>/dev/null \
      || die 4 "선행 $_ref 의 커밋($_sha)이 로컬에 없습니다 — git fetch/pull 후 다시 시도하세요."
    git merge-base --is-ancestor "$_sha" HEAD 2>/dev/null \
      || die 4 "선행 $_ref 의 커밋($_sha)이 현재 브랜치에 반영되지 않았습니다 — merge/rebase 후 다시 시도하세요."
  done || exit 4   # while 는 서브셸 — die 의 exit 를 부모로 전파
}

# spec.md 로컬 캐시(결정 A) — DB 정본의 명세를 claim 시점에 스냅샷.
write_spec_cache() { # $1=claim 응답 JSON
  _tsk=$(printf '%s' "$1" | jq -r '.item.external_ref // empty' | awk -F/ '{print $NF}')
  [ -n "$_tsk" ] || return 0
  mkdir -p "docs/tasks/$_tsk"
  printf '%s' "$1" | jq -r '
    "# " + (.item.external_ref // "") + " " + (.item.name // "") + "\n" +
    "> stage: " + (.item.stage // "-") + " · category: " + (.item.category // "-") +
    " · domain: " + (.item.domain // "-") + " · priority: " + (.item.priority // "-") +
    " · model: " + (.item.model // "-") + "\n" +
    "> prd-ref: " + (.item.prd_ref // "-") + "\n> entry-point: " + (.item.entry_point // "-") + "\n" +
    "> depends: " + ((.item.depends // []) | join(", ")) + "\n\n" +
    (.item.spec // "(명세 없음)") + "\n\n## 수용 기준\n" +
    ((.item.acceptance // []) | map("- [ ] " + .) | join("\n"))
  ' > "docs/tasks/$_tsk/spec.md"
  printf 'spec 캐시: docs/tasks/%s/spec.md\n' "$_tsk"
}

cmd_claim() {
  _id=$(resolve_ref "$1")
  # ① show 로 선행 evidence 를 먼저 받아 로컬 검사 — 통과 전에는 claim 자체를 하지 않는다(결정 C-②).
  _detail=$(TOKEN="$TOK" api_raw GET "/api/v1/agent/work/$_id") || exit $?
  check_depends_local "$(printf '%s' "$_detail" | jq -c '.depends_evidence // []')"
  _label="claude-$(hostname -s)"  # 라벨 결정론(§3) — 무작위·타임스탬프 금지
  _resp=$(TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/claim" \
    "$(jq -nc --arg a "$_label" '{agent:$a}')") || exit $?
  write_spec_cache "$_resp"
  printf 'claimed %s\n' "$(printf '%s' "$_id" | cut -c1-8)"
}

cmd_progress() {
  _id=$(resolve_ref "$1"); _pct="$2"; _sum="$3"
  [ "$_pct" -ge 0 ] 2>/dev/null && [ "$_pct" -le 99 ] || die 2 "pct 는 0~99 — 완료는 done 을 쓰세요."
  TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "claude-$(hostname -s)" --argjson p "$_pct" --arg s "$_sum" \
       '{agent:$a, kind:"progress", percent:$p, summary:$s}')" | jq -r '.status'
}

cmd_done() {
  _id=$(resolve_ref "$1"); _sum="$2"; _auto="${3:-}"
  # 완료 = push 완료(결정 C-③) — 현재 브랜치 tip 이 원격에 도달했는지 확인, 미도달이면 보고 거부.
  _branch=$(git branch --show-current 2>/dev/null)
  [ -n "$_branch" ] || die 2 "git 브랜치를 확인할 수 없습니다 — 리포 안에서 실행하세요."
  _local=$(git rev-parse HEAD 2>/dev/null)
  _remote=$(git ls-remote origin "refs/heads/$_branch" 2>/dev/null | cut -f1)
  [ -n "$_remote" ] || die 2 "원격에 브랜치 $_branch 가 없습니다 — git push 후 다시 시도하세요."
  [ "$_remote" = "$_local" ] || die 2 "로컬 HEAD 가 원격에 반영되지 않았습니다 — git push 후 다시 시도하세요."
  _links='[]'; _evidence='{}'
  if [ "$_auto" = "--auto-links" ]; then
    _sha=$(git rev-parse HEAD 2>/dev/null || printf '')
    _branch=$(git branch --show-current 2>/dev/null || printf '')
    _remote=$(git remote get-url origin 2>/dev/null || printf '')
    _pr=$(command -v gh >/dev/null 2>&1 && gh pr view --json url -q .url 2>/dev/null || printf '')
    _links=$(jq -nc --arg r "$_remote" --arg p "$_pr" \
      '[ (if $r|startswith("http") then {label:"repo", url:$r} else empty end),
         (if $p != "" then {label:"pr", url:$p} else empty end) ]')
    _evidence=$(jq -nc --arg b "$_branch" --arg h "$_sha" --arg r "$_remote" --arg p "$_pr" \
      '{branch:$b, head_sha:$h}
       + (if $r|startswith("http") then {repo_url:$r} else {} end)
       + (if $p != "" then {pr_url:$p} else {} end)')
  fi
  TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/report" \
    "$(jq -nc --arg a "claude-$(hostname -s)" --arg s "$_sum" \
       --argjson l "$_links" --argjson e "$_evidence" \
       '{agent:$a, kind:"completion", percent:100, summary:$s, links:$l, evidence:$e}')" \
    | jq -r '"reported(승인 대기) — PM 승인은 웹에서"'
}

cmd_release() {
  _id=$(resolve_ref "$1")
  TOKEN="$TOK" api_raw POST "/api/v1/agent/work/$_id/release" \
    "$(jq -nc --arg a "claude-$(hostname -s)" '{agent:$a}')" | jq -r '.status'
}

cmd_doctor() {
  need curl; need jq
  printf 'base: %s\n' "$(base)"
  _n=0
  for _t in $(tokens); do
    _n=$((_n+1))
    _me=$(TOKEN="$_t" api_raw GET /api/v1/agent/me) || { printf '프로필 %d: 인증 실패\n' "$_n"; continue; }
    _cv=$(printf '%s' "$_me" | jq -r '.contract_version')
    printf '프로필 %d: %s (계약 %s, 프로젝트 %d)\n' "$_n" \
      "$(printf '%s' "$_me" | jq -r '.user_email')" "$_cv" \
      "$(printf '%s' "$_me" | jq -r '.projects | length')"
    [ "$_cv" = "2.0" ] || printf '  ⚠ 계약 버전 불일치 — wbs-web pull 로 스킬을 갱신하세요.\n'
  done
}

# ---- main ----------------------------------------------------------------
need curl; need jq
AS=''
[ "${1:-}" = "--as" ] && { AS="$2"; shift 2; }
[ $# -ge 1 ] || usage
CMD="$1"; shift
case "$CMD" in
  doctor) cmd_doctor "$@" ;;   # doctor 는 전 프로필 순회라 TOK 불필요
  *) TOK=$(pick_token "$AS") || exit 2
     case "$CMD" in
       me) cmd_me "$@" ;;
       list) cmd_list "$@" ;;
       show) [ $# -ge 1 ] || usage; cmd_show "$@" ;;
       claim) [ $# -ge 1 ] || usage; cmd_claim "$@" ;;
       progress) [ $# -ge 3 ] || usage; cmd_progress "$@" ;;
       done) [ $# -ge 2 ] || usage; cmd_done "$@" ;;
       release) [ $# -ge 1 ] || usage; cmd_release "$@" ;;
       *) usage ;;
     esac ;;
esac
```

- [ ] **Step 2: 정적 검증**

Run: `sh -n docs/agent/claude-skill/dflow-work/scripts/dflow.sh && chmod 755 docs/agent/claude-skill/dflow-work/scripts/dflow.sh`
Expected: 문법 오류 없음. `shellcheck` 가 있으면 실행해 SC 지적을 정리한다(없으면 생략).

- [ ] **Step 3: 테스트 환경 실검증**

TSK-00-02 산출물로: `DFLOW_API_BASE=<테스트 URL> DFLOW_PATS=<A의 PAT> sh dflow.sh doctor` → 프로필 1건·계약 2.0 출력. `list` → compact 1행/건. 존재하지 않는 ref → exit 2, 꺼진 서버 → exit 7 확인:
`sh dflow.sh claim 99; echo "exit=$?"` → `exit=2`.
결정 A·C 경로: ① 선행 evidence 가 있는 주문에서 로컬에 없는 sha 를 겪게 만들어 claim → exit 4 + 안내 메시지 ② claim 성공 시 `docs/tasks/<TSK>/spec.md` 생성·내용(머리말+요구사항+수용 기준 체크리스트) 확인 ③ push 전 `done` → exit 2, push 후 → 성공.

- [ ] **Step 4: Commit**

```bash
git add docs/agent/claude-skill/dflow-work/scripts/dflow.sh
git commit -m "feat(skill): dflow.sh — exit code 계약·compact 출력·다중 프로필·auto-links 증적 조립"
```

---

### Task 17: SKILL.md + references + 설치 안내

**Files:**
- Create: `docs/agent/claude-skill/dflow-work/SKILL.md`
- Create: `docs/agent/claude-skill/dflow-work/references/troubleshooting.md`
- Create: `docs/agent/claude-skill/dflow-work/README.md`
- (Task 1의 `references/api-contract.md` 는 이미 존재)

**Interfaces:**
- Consumes: Task 16 `dflow.sh` 계약
- Produces: `ln -s` 로 사용자 레벨 설치되는 스킬 정본 — 개발자는 MES 등 다른 리포에서 작업하므로 리포 내 `.claude/skills/` 는 로드되지 않는다(§3)

- [ ] **Step 1: SKILL.md 작성** (요지 — 실제 파일은 아래 골격을 전부 채운다)

````markdown
---
name: dflow-work
description: D'Flow 작업(내 작업 조회·착수·진행 보고·완료 보고)을 처리할 때 사용. "내 D'Flow 작업", "디플로우 작업", "작업 착수", "진행 보고", "작업 완료" 같은 요청에서 트리거.
---

# D'Flow 작업 처리

모든 호출은 `~/.claude/skills/dflow-work/scripts/dflow.sh` 로 한다. 산문 파싱 금지 —
**exit code 로 분기한다**: 0 성공 / 2 사용법 / 3 인증 / 4 상태충돌 / 5 권한 / 6 서버 / 7 기능꺼짐.

## 시작 절차 (매 세션 1회)
1. `dflow.sh doctor` — 실패(exit≠0)면 references/troubleshooting.md 의 해당 코드 절차.
   계약 버전 경고가 나오면 wbs-web 클론을 pull 하라고 사용자에게 안내.
2. 프로필이 여럿이면(`DFLOW_PATS`) 사용자가 지목한 사람으로 `--as <이름|email>`.

## 워크플로우
목록: `dflow.sh list` (순번을 사용자에게 그대로 보여준다) →
착수: `dflow.sh claim <순번>` — 선행 미반영이면 **exit 4 로 차단**된다(fetch/merge 후 재시도, 우회 금지).
성공 시 `docs/tasks/<TSK>/spec.md` 캐시가 생긴다 — **구현 전 반드시 읽는다**(명세 정본은 D'Flow DB, 이 파일은 claim 시점 스냅샷) →
브랜치 `agent/<주문id 8자>-<slug>` 생성 → 구현 → 커밋 트레일러 `DFlow-Order: <주문 UUID>` →
진행: `dflow.sh progress <순번> <0-99> "<요약>"` (**100 금지** — 서버가 400 으로 거부한다) →
**push** (완료 = push 완료 — push 없이 done 은 exit 2 로 거부된다) →
완료: `dflow.sh done <순번> "<요약>" --auto-links` →
보고 후 상태는 **reported(승인 대기)** 다. "완료했습니다"가 아니라 "승인 대기로 보고했습니다"로 말한다.

## 금지사항 (명령형)
- 토큰을 echo·파일 기록·명령 문자열에 보간하지 않는다 — env 확장으로만.
- `DFLOW_API_BASE` 기본값을 지어내지 않는다.
- `--pct 100` 금지. approve 시도 금지(승인은 사람 몫 — /approve API 자체가 없다).
- 409 를 재시도로 뚫지 않는다 — 상태를 show 로 확인하고 사용자에게 보고.
- 실패를 성공으로 요약하지 않는다.
- git author 를 D'Flow 신원으로 바꾸지 않는다 — 커밋 author 는 PC 주인 그대로(§2.7).
- 작업 대상이 wbs-web 자신이면: `git add -A` 금지 · 마이그레이션 분리 커밋(G1) ·
  `src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`
  변경 시 'Preview 확인 필요(G2)' 를 사용자에게 경고.

## 세션 복구
로컬 상태 파일에 의존하지 않는다 — `dflow.sh list --scope claimed` 로 서버에서 복원.
````

- [ ] **Step 2: troubleshooting.md 작성**

에러코드 전수 해석표(계약 v2.0 §에러코드 표를 클라이언트 관점으로): 404 는 세 원인(기능 꺼짐/프로젝트 미등록/주문 없음)이 의도적으로 구분되지 않음 — `dflow.sh me`(exit 7 이면 기능 꺼짐, 200 인데 프로젝트가 없으면 미등록)로 좁히는 절차. 401 → 토큰 만료·폐기(웹 `/account`에서 재발급). 403 `not_claim_owner`(교차 소유 포함)·`insufficient_scope`(스코프 부족 — `/account`에서 재발급)·`not_assignee`(담당자 배정 작업)·`dependency_not_met`(선행 미완 — `unmet[]`의 Task 를 먼저 끝내거나 배정·단계를 웹에서 정리)·`forbidden_role`(비멤버). 409 `conflict`(선점 경합 — 다른 작업 선택)·`apply_failed`. 400 `identity_mismatch`(body email 제거). 로컬 차단 2종: exit 4 선행 커밋 미반영(fetch/merge 후 재시도 — **우회 금지**), exit 2 push 미완료(push 후 done).

- [ ] **Step 3: README.md 작성 — 온보딩 3단계**

```markdown
# 설치 (10분)
1. 웹 로그인 → /agent-ops → '내 API 토큰' → 발급(스코프 work:read + work:claim) → 평문 1회 복사
2. 작업 리포의 .env 또는 셸 프로필에:
   export DFLOW_API_BASE="https://<호스트>"
   export DFLOW_PATS="dflow_pat_..."          # 여러 명이면 쉼표로 연결. chmod 600 권장
3. ln -s <wbs-web 클론 경로>/docs/agent/claude-skill/dflow-work ~/.claude/skills/dflow-work
확인: ~/.claude/skills/dflow-work/scripts/dflow.sh doctor
```

- [ ] **Step 4: 실검증**

`ln -s` 후 Claude Code 새 세션(임의 디렉터리)에서 "내 D'Flow 작업 보여줘" → 스킬 트리거·목록 출력 확인.

- [ ] **Step 5: Commit**

```bash
git add docs/agent/claude-skill/dflow-work/SKILL.md docs/agent/claude-skill/dflow-work/references/troubleshooting.md docs/agent/claude-skill/dflow-work/README.md
git commit -m "feat(skill): dflow-work 스킬 정본 — 리포 커밋 + ln -s 사용자 설치, 금지사항·복구 절차 포함"
```

---

### Task 18: WP-06 통합 검증

**Files:**
- Create: `docs/superpowers/specs/2026-08-10-agent-work-itest-results.md` (검증 결과 기록)

**Interfaces:**
- Consumes: Task 1~17 전부 + 테스트 환경(TSK-00-02)
- Produces: 수용 기준 통과 증거. `itest` 성격 — force·bypass 금지, 결함 발견 시 해당 태스크로 되돌아가 수정 후 재실행.

- [ ] **Step 1: 수직 E2E (TSK-06-01)**

테스트 프로젝트에서 순서대로, 각 단계의 실제 응답을 결과 문서에 기록.
손 제작 export JSON v2(Task 14 Step 6): 노드 4건 — WP 1 + Task 3(T-A: assignee=사용자 A·spec_sections·acceptance 포함 / T-B: `depends: [T-A]`·assignee=A / T-C: 무배정):
1. 업로드 → `orders_created: 2`(T-A·T-B), spec 조립 결과를 웹 명세 패널에서 확인(섹션 순서 = 계약 고정)
2. A 의 PAT 로 `dflow.sh list` → 자동 발행 주문 노출
3. **선행 게이트**: T-B 를 먼저 claim 시도 → 403 `dependency_not_met`(T-A stage 미충족)
4. T-A `claim` → `docs/tasks/T-A/spec.md` 캐시 생성 확인(결정 A) → `progress 40` → 웹 WBS 화면 actual_pct 40 확인
5. **push 차단**: push 전 `done` → exit 2. push 후 `done --auto-links` → `reported`
6. PM 세션(웹)에서 승인 → WBS 100·주문 `approved`. 웹에서 T-A stage 를 `im` 으로 → T-B claim 성공 + `depends_evidence` 에 T-A 의 branch·head_sha 포함 확인(결정 C-②)
7. **같은 payload 재업로드** → `upserted` 동일·`orders_created: 0`·행 수 불변·웹에서 바꾼 stage·담당자 보존(⑫)
8. PC A 에서 claim → PC B(같은 PAT)에서 report 성공 — 라벨이 달라도 `claimed_by_user_id` 축이라 통과

- [ ] **Step 2: 보안 매트릭스 (TSK-06-02)**

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | `AGENT_API_ENABLED` 미설정 호스트에 전 라우트 호출 | 전부 404 + 발급 액션 거부 |
| 2 | A PAT 로 B 전용 프로젝트 `/work?project_id=` | 404 |
| 3 | A PAT 로 `/me` | B 전용 프로젝트 미노출 |
| 4 | 레거시 시크릿 5개 라우트 | v1 응답 그대로(회귀 기준선) |
| 5 | PAT ↔ 레거시 교차 소유 report/release | 양방향 403 `not_claim_owner` |
| 6 | B 가 A 배정 항목 claim | 403 `not_assignee` |
| 7 | `work:read` 만 있는 PAT 로 claim | 403 `insufficient_scope` |
| 8 | 폐기한 PAT | 401 (다른 프로필은 계속 동작 — §WP-05 수용 기준 선행 확인) |
| 9 | body user_email ≠ 소유자 | 400 `identity_mismatch` |
| 10 | 선행 미완(stage=ip) 항목 claim — 서버 직접 호출(클라이언트 우회) | 403 `dependency_not_met` (게이트는 서버가 정본 — 결정 C-①) |
| 11 | **운영 D-CUBE** | `agent_projects` 미등록 유지 → 운영 호스트 전 라우트 404, 운영 DB 행 변화 0건 (`select count(*) from agent_runners` 등으로 실측) |

- [ ] **Step 3: 온보딩 실측 (TSK-06-03)**

신규 개발자(또는 깨끗한 PC)로 README 3단계를 시계로 재며 수행 — 10분 이내에 MES 리포에서 "내 D'Flow 작업 보여줘"가 동작해야 통과. 걸린 시간·막힌 지점을 결과 문서에 기록.

- [ ] **Step 4: 결과 기록·커밋**

```bash
git add docs/superpowers/specs/2026-08-10-agent-work-itest-results.md
git commit -m "docs(itest): 에이전트 작업 루프 통합 검증 결과 — E2E·보안 매트릭스·온보딩 실측"
```

---

## 계획 밖 (이 계획이 하지 않는 것)

- **운영 D-CUBE `agent_projects` 등록**(미결 ⑤ — 이 설계 전체에서 가장 위험한 단일 동작, 별도 승인) · **레거시 시크릿 폐기**(미결 ④) · **stage 파생 progress 환산 전환**(미결 ③ — v1 즉시 반영 유지) · **에이전트측 주문 발행**(미결 ⑦ `item_owners` 권한 상승 봉합 선행) · **claim 시 `as`→`ip` 자동 전이**(미결 ⑪ 잔여) · **WP-05 운용성**(usage 감사·heartbeat·rate limit·만료 임박 경고 — 후속. PAT 화면은 결정 D 로 처음부터 `/account` 라 이관 작업 없음) · **dev 플러그인 쪽 DEV-01~04**(별도 계획: dev-workflow 툴체인 · wbs-wsf 스킬).
- 발행 폼 UUID 직접 입력의 검색 개선(§2.8 말미)은 WP-05 와 함께 후속으로 미룬다 — 자동 발행이 주 경로가 되므로 임계경로가 아니다.

## Self-Review 결과

- 부록 §2.1(리졸버)→T4 · §2.2(멤버십)→T5 · §2.3(소유권)→T9·10 · §2.4(/me·/mine)→T6·7·10 · §2.5(담당자·단계)→T11·12 · §2.6(업로드)→T11·14 · §2.7(다중 프로필)→T16 · §2.8(자동 발행)→T13·14 · §3(클라이언트)→T16·17 · §7.2(경계 아티팩트)→T1 · WP-06→T18. 미커버 없음.
- **확정 결정 A~E 매핑**: A(DB 정본·spec.md 캐시)→T1·T15(응답 확장)·T16(write_spec_cache) · B(확장 DDL·뷰어 패널)→T11·T12A·T13(priority 매핑·acceptance 정본) · C(선행 하드 차단)→T15(서버 게이트·depends_evidence)·T16(check_depends_local·done push 검사)·T18(#3·#5·매트릭스 10) · D(/account)→T8(G2 브랜치 절차 포함) · E(계약 v2·priority 라벨·spec_sections 조립)→T1·T14(assembleSpecMarkdown·toRpcNode)·T11(RPC 컬럼).
- 타입 일치: `AgentPrincipal`(T4)·`resolveWriteActor`(T10)·`ensureOrderForAssignedLeaf`+`orderPriorityFromLabel`(T13)·`myMemberIds`(T15)·`DependInfo`/`loadDependsInfo`/`ITEM_DETAIL_COLUMNS`/`stageAtLeast`(T15↔T16 jq 필드)·`ImportNode`/`SpecSections`/`assembleSpecMarkdown`(T14↔T1 계약)·RPC 반환 `{upserted,skipped,ids,new_refs}` 및 확장 컬럼 목록(T11↔T14) 교차 확인 완료.
- 알려진 재량 지점 2건(구현자가 판단해 계획 갱신): ① 0073 `on delete set null (컬럼)` 문법이 적용 대상 PG 버전에서 거부되면 트리거 대안 ② `[id]/route.ts` 의 PAT 멤버십 검사 위치(주문 로드 후) — 존재 은닉 순서 유지가 기준.
