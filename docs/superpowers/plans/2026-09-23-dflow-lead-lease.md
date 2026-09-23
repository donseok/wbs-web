# 팀장 lease (과제 B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 신원+프로젝트에 살아 있는 `/dflow-team` 팀장을 PC·clone·hostname 과 무관하게 하나로 묶는다.

**Architecture:** 서버 테이블 `agent_lead_leases`(0101)와 DB 함수 넷이 lease 를 CAS 로 관리한다. `POST /api/v1/agent/lead/lease` 가 acquire·renew·release 를 받고, `dflow.sh lease` 가 그것을 부른다. 팀장은 시작 때 lease 를 얻고, 팀장 PID 에 묶인 `dflow.sh lease keep` 이 60초마다 갱신하며, 잃으면 표식 파일로 감시 루프를 깨운다. 오피스 화면은 lease 를 보여 주고 「팀장 해제」로 강제로 풀 수 있다.

**Tech Stack:** Postgres(plpgsql) · Next.js 15 route handler · supabase-js admin client · POSIX sh + jq + curl · vitest · React(client component)

**Spec:** `docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md`

## Global Constraints

- 반영은 **staging 까지**다. main push·운영 DB 적용·dflow-kit 재빌드는 하지 않는다.
- 작업은 워크트리 `.claude/worktrees/dflow-lead-lease`(브랜치 `feat/dflow-lead-lease`, 기점 `origin/staging`)에서 한다. 메인 체크아웃은 병렬 세션이 쓴다.
- `git add -A` 금지. 파일명을 명시해 stage 한다.
- **마이그레이션 파일과 코드는 다른 커밋**이다(G1).
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **토큰·PAT 값을 출력·로그·파일에 남기지 않는다.** `.dflow.local`·`.env` 는 키 이름만 본다. 테스트 토큰은 가짜 문자열만 쓴다.
- 셸 스크립트는 POSIX sh 다(`dflow.sh` 는 `#!/bin/sh`). bash 전용 문법 금지. SKILL.md 의 셸 블록은 sh·bash·zsh 에서 모두 문법 검사를 통과해야 한다(`tests/skills/dflow-team-shell-blocks.test.ts`). zsh 는 따옴표 없는 변수를 단어로 나누지 않으므로 `$VAR` 로 인자를 늘리거나 줄이지 않는다.
- 에러 3원칙: 조회 실패를 "없음"으로 위장하지 않는다(표시=로깅), 쓰기 전 선행 조회 실패면 중단, 보안 가드는 fail-closed.
- 권한 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/index.ts`(가드)에서만 한다. 액션에 역할 문자열을 적지 않는다.
- lease TTL 은 **180초**, 갱신 주기는 **60초**, 네트워크 연속 실패 허용은 **3회**다. TTL 은 SQL 함수 `lead_lease_ttl()` 한 곳에만 둔다.
- 계약 버전은 **2.4 → 2.5** 로 올린다(additive): `src/lib/agent/externalApi.ts` 의 `AGENT_CONTRACT_VERSION`, `dflow.sh` 의 `CONTRACT_VERSION`, `references/api-contract.md`.

## Review Focus

- **zsh 에서 팀장 블록 실행**: 사람의 Bash 도구 셸은 zsh 다. `--takeover` 유무를 변수 전개로 붙이면 zsh 에서 빈 인자가 넘어가 usage 로 끝난다. → Task 5 의 셸 블록 테스트가 `if` 분기로 쓴 것을 확인한다.
- **팀장이 정상 마감할 때 `lease keep` 이 스스로 끝나는가**: 상태 파일이 사라지면 keep 이 0 으로 끝나야 한다. 아니면 마감 뒤에도 백그라운드 프로세스가 lease 를 계속 갱신해 다른 곳이 3분 넘게 막힌다. → Task 4 테스트 `keep: 상태 파일이 없어지면 0 으로 끝난다`.
- **재시작한 같은 자리가 옛 keep 을 밀어내는가**: 같은 holder 로 다시 acquire 하면 generation 이 올라 옛 keep 의 renew 가 lost 가 된다. → Task 1 검증 SQL 의 「같은 holder 재획득 뒤 옛 generation renew 는 lost」.
- **lease 조회 실패가 재개 요청 "없음"으로 보이지 않는가**: watch 에 holder 가 왔는데 lease 조회가 실패하면 `resume_requests: null` 이어야 한다. → Task 3 테스트.
- **남의 lease 를 해제할 수 없는가**: 멤버지만 주인도 관리자도 아닌 사람의 「팀장 해제」는 서버에서 거부된다. → Task 6 authz 순수 함수 테스트와 액션 테스트.

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `supabase/migrations/0101_agent_lead_leases.sql` · `_rollback.sql` | 테이블 + 함수 넷 + 권한 | 1 |
| `tests/migrations/agent-lead-leases.test.ts` | 마이그레이션 문안 검사 | 1 |
| `scripts/checks/0101_lead_lease_check.sql` | 스테이징 리허설 동작 검증(롤백되는 트랜잭션) | 1 |
| `src/lib/agent/leadLease.ts` | 요청 본문 파싱(순수) | 2 |
| `src/app/api/v1/agent/lead/lease/route.ts` | lease API | 2 |
| `tests/agent/lead-lease-route.test.ts` · `tests/agent/lead-lease-parse.test.ts` | 라우트·파서 | 2 |
| `src/lib/agent/externalApi.ts` | 계약 2.5 | 2 |
| `src/app/api/v1/agent/watch/route.ts` · `tests/agent/watch-route.test.ts` | holder 로 재개 요청 거르기 | 3 |
| `.claude/skills/dflow-work/scripts/dflow-lease.sh` (신규) | lease 셸 함수 | 4 |
| `.claude/skills/dflow-work/scripts/dflow.sh` | `lease` 명령·`watch --holder`·계약 2.5·usage | 4 |
| `.claude/skills/dflow-work/references/api-contract.md` | 계약 문서 2.5 | 4 |
| `tests/skills/dflow-lead-lease.test.ts` | 가짜 curl 로 CLI 검증 | 4 |
| `.claude/skills/dflow-team/SKILL.md` · `references/help.md` | 팀장 흐름 | 5 |
| `tests/skills/dflow-team-lease.test.ts` | 팀장 문서 검사 | 5 |
| `src/lib/domain/authz.ts` · `tests/authz/lead-lease-release.test.ts` | 해제 판정 순수 함수 | 6 |
| `src/lib/domain/seatmap.ts` · `src/lib/data/agentSeatmap.ts` | 층에 lease 싣기 | 6 |
| `src/app/actions/agentSeatmap.ts` | `releaseLeadLease` 액션 | 6 |
| `src/components/agents/FloorCard.tsx` · `SeatmapView.tsx` · `seatmap.module.css` | lease 표시·해제 버튼 | 6 |
| `tests/domain/seatmap.test.ts` · `tests/components/agents-seatmap-view.test.tsx` · `tests/actions/…` | 화면·액션 | 6 |

Task 의존: 2·3·6 은 Task 1 의 함수 이름·반환 모양을, 5 는 Task 4 의 명령·출력을 쓴다. 이름은 이 계획에 고정돼 있으므로 **2·4·6 은 병렬로 해도 된다.** 3 은 2 뒤(`src/lib/agent/leadLease.ts` 의 `HOLDER_RE` 를 쓴다), 5 는 4 뒤, 7 은 모두 끝난 뒤다.

---

### Task 0: 워크트리 준비 (컨트롤러가 직접)

- [ ] **Step 1: 워크트리 생성**

```bash
cd /Users/jji/project/wbs-web
git fetch -q origin
git worktree add -b feat/dflow-lead-lease .claude/worktrees/dflow-lead-lease origin/staging
cd .claude/worktrees/dflow-lead-lease && npm ci --silent
```

- [ ] **Step 2: 기준선 확인**

Run: `npx vitest run tests/skills tests/agent 2>&1 | tail -5`
Expected: 실패 0.

---

### Task 1: 마이그레이션 0101 — 테이블과 lease 함수

**Files:**
- Create: `supabase/migrations/0101_agent_lead_leases.sql`
- Create: `supabase/migrations/0101_agent_lead_leases_rollback.sql`
- Create: `scripts/checks/0101_lead_lease_check.sql`
- Test: `tests/migrations/agent-lead-leases.test.ts`

**Interfaces:**
- Produces (DB, service_role 만 execute):
  - `lead_lease_ttl() returns interval` — `interval '180 seconds'`
  - `lead_lease_acquire(p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean) returns table(project_id uuid, ok boolean, generation bigint, host text, agent text, expires_at timestamptz)` — 막히면 막힌 행만 `ok=false` 로, 얻으면 모든 행을 `ok=true` 로 돌려준다.
  - `lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb) returns table(project_id uuid, ok boolean, expires_at timestamptz)` — `p_leases` 는 `[{"project_id": "...", "generation": n}]`.
  - `lead_lease_release(p_user uuid, p_holder text, p_leases jsonb) returns integer` — 풀린 행 수.
  - `lead_lease_force_release(p_user uuid, p_project uuid) returns integer` — 웹 강제 해제. 살아 있는 lease 가 없으면 0.

- [ ] **Step 1: 실패하는 문안 테스트 작성**

`tests/migrations/agent-lead-leases.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const up = readFileSync(new URL('../../supabase/migrations/0101_agent_lead_leases.sql', import.meta.url), 'utf8')
const down = readFileSync(new URL('../../supabase/migrations/0101_agent_lead_leases_rollback.sql', import.meta.url), 'utf8')

describe('0101 agent_lead_leases', () => {
  it('(user_id, project_id) 기본키와 RLS 를 켜고 정책은 두지 않는다(0095 와 같은 판단)', () => {
    expect(up).toMatch(/create table if not exists public\.agent_lead_leases/)
    expect(up).toMatch(/primary key \(user_id, project_id\)/)
    expect(up).toMatch(/alter table public\.agent_lead_leases enable row level security/)
    expect(up).not.toMatch(/create policy/i)
  })
  it('TTL 은 lead_lease_ttl() 한 곳에만 180초로 둔다', () => {
    expect(up).toMatch(/function public\.lead_lease_ttl\(\)[\s\S]*interval '180 seconds'/)
    expect(up.match(/180 seconds/g)).toHaveLength(1)
  })
  it('함수 넷은 대상 행을 for update 로 잠그거나 조건부 update 로 CAS 한다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release']) {
      expect(up).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`))
    }
    expect(up).toMatch(/for update/)
  })
  it('함수 실행은 service_role 에게만 연다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release']) {
      expect(up).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`))
      expect(up).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`))
    }
  })
  it('rollback 은 함수와 테이블을 지운다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release', 'lead_lease_ttl']) {
      expect(down).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`))
    }
    expect(down).toMatch(/drop table if exists public\.agent_lead_leases/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/migrations/agent-lead-leases.test.ts`
Expected: FAIL (ENOENT — 파일 없음)

- [ ] **Step 3: 마이그레이션 작성**

`supabase/migrations/0101_agent_lead_leases.sql`:

```sql
-- supabase/migrations/0101_agent_lead_leases.sql
-- 팀장 lease — 신원+프로젝트당 /dflow-team 팀장 하나(docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md).
-- 로컬 잠금(dflow-team.lock)은 같은 리포의 워크트리끼리만 본다. 다른 clone·다른 PC 의 같은 신원 팀장을 여기서 막는다.
-- RLS 는 켜고 정책은 두지 않는다 — 0095 가 agent_watchers 에서 지운 이유(로그인 사용자 전체가 남의 신원·host 를 읽음)가
-- 그대로 해당한다. 읽기·쓰기는 service_role(API·서버 액션)만 한다.
begin;

create table if not exists public.agent_lead_leases (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  holder      text,                       -- '<PC ID>:<리포 경로 cksum>'. null = 비어 있음
  host        text,                       -- 표시용 hostname 슬러그
  agent       text,                       -- 표시용 '<신원>/<host>/lead'
  generation  bigint not null default 0,  -- 펜싱 토큰. 획득·인수·해제 때 오른다
  acquired_at timestamptz,
  renewed_at  timestamptz,
  expires_at  timestamptz,
  primary key (user_id, project_id)
);
alter table public.agent_lead_leases enable row level security;

-- TTL 은 여기 한 곳이다. 스킬의 갱신 주기(60초)와 연속 실패 허용(3회)이 이 값에 맞춰져 있다.
create or replace function public.lead_lease_ttl() returns interval
language sql immutable as $$ select interval '180 seconds' $$;

-- 전부 아니면 전무: 하나라도 막히면 아무것도 바꾸지 않고 막힌 행만 돌려준다.
create or replace function public.lead_lease_acquire(
  p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean
) returns table (project_id uuid, ok boolean, generation bigint, host text, agent text, expires_at timestamptz)
language plpgsql as $$
#variable_conflict use_column
begin
  insert into public.agent_lead_leases (user_id, project_id)
    select p_user, x from unnest(p_projects) as x
    on conflict do nothing;
  perform 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
    order by l.project_id
    for update;
  if not p_takeover and exists (
    select 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
      and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
  ) then
    return query
      select l.project_id, false, l.generation, l.host, l.agent, l.expires_at
      from public.agent_lead_leases l
      where l.user_id = p_user and l.project_id = any(p_projects)
        and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
      order by l.project_id;
    return;
  end if;
  return query
    update public.agent_lead_leases l
       set holder = p_holder, host = p_host, agent = p_agent,
           generation = l.generation + 1,
           acquired_at = now(), renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
     where l.user_id = p_user and l.project_id = any(p_projects)
    returning l.project_id, true, l.generation, l.host, l.agent, l.expires_at;
end $$;

-- holder·generation 이 둘 다 맞을 때만 늘린다. 만료됐어도 아무도 가져가지 않았으면 갱신된다.
create or replace function public.lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb)
returns table (project_id uuid, ok boolean, expires_at timestamptz)
language plpgsql as $$
#variable_conflict use_column
begin
  return query
    with want as (
      select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
      from jsonb_array_elements(p_leases) as e
    ), upd as (
      update public.agent_lead_leases l
         set renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
        from want w
       where l.user_id = p_user and l.project_id = w.pid
         and l.holder = p_holder and l.generation = w.gen
      returning l.project_id, l.expires_at
    )
    select w.pid, (u.project_id is not null), u.expires_at
    from want w left join upd u on u.project_id = w.pid
    order by w.pid;
end $$;

-- 행을 지우지 않는다: generation 을 이어 가야 옛 팀장의 갱신이 확실히 실패한다.
create or replace function public.lead_lease_release(p_user uuid, p_holder text, p_leases jsonb)
returns integer
language plpgsql as $$
declare n integer;
begin
  with want as (
    select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
    from jsonb_array_elements(p_leases) as e
  )
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
    from want w
   where l.user_id = p_user and l.project_id = w.pid
     and l.holder = p_holder and l.generation = w.gen;
  get diagnostics n = row_count;
  return n;
end $$;

-- 웹 「팀장 해제」. 권한 판정은 서버 액션이 먼저 한다 — 이 함수는 조건 없이 푼다.
create or replace function public.lead_lease_force_release(p_user uuid, p_project uuid)
returns integer
language plpgsql as $$
declare n integer;
begin
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
   where l.user_id = p_user and l.project_id = p_project
     and l.holder is not null and l.expires_at >= now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.lead_lease_renew(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.lead_lease_release(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.lead_lease_force_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean) to service_role;
grant execute on function public.lead_lease_renew(uuid, text, jsonb) to service_role;
grant execute on function public.lead_lease_release(uuid, text, jsonb) to service_role;
grant execute on function public.lead_lease_force_release(uuid, uuid) to service_role;

commit;
```

`supabase/migrations/0101_agent_lead_leases_rollback.sql`:

```sql
-- supabase/migrations/0101_agent_lead_leases_rollback.sql
begin;
drop function if exists public.lead_lease_force_release(uuid, uuid);
drop function if exists public.lead_lease_release(uuid, text, jsonb);
drop function if exists public.lead_lease_renew(uuid, text, jsonb);
drop function if exists public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean);
drop function if exists public.lead_lease_ttl();
drop table if exists public.agent_lead_leases;
commit;
```

- [ ] **Step 4: 동작 검증 SQL 작성**

`scripts/checks/0101_lead_lease_check.sql` — 스테이징에서 실행해 실패하면 예외로 멈추고, 끝에 롤백해 흔적을 남기지 않는다. 실제 사용자·프로젝트 한 쌍을 빌려 쓴다(FK 때문).

```sql
-- scripts/checks/0101_lead_lease_check.sql — 0101 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0101_lead_lease_check.sql --target staging
begin;
do $$
declare
  u uuid; p uuid; g1 bigint; g2 bigint; r record; n integer;
  ha text := '00000000-0000-4000-8000-00000000000a:1';
  hb text := '00000000-0000-4000-8000-00000000000b:2';
begin
  select id into u from auth.users order by created_at limit 1;
  select id into p from public.projects order by created_at limit 1;
  assert u is not null and p is not null, '검증용 사용자·프로젝트가 없다';
  delete from public.agent_lead_leases where user_id = u and project_id = p;

  -- 1. 빈 행 획득
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', false);
  assert r.ok and r.generation = 1, '빈 행 획득 실패';
  g1 := r.generation;
  -- 2. 다른 holder 는 막힌다(바뀐 것 없음)
  select * into r from public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  assert not r.ok and r.host = 'pc-a', '다른 holder 가 막히지 않았다';
  assert (select generation from public.agent_lead_leases where user_id = u and project_id = p) = g1, '막힘이 행을 바꿨다';
  -- 3. 같은 holder 재획득은 즉시, generation 이 오르고 옛 generation renew 는 lost
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', false);
  assert r.ok and r.generation = g1 + 1, '같은 holder 재획득 실패';
  g2 := r.generation;
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g1)));
  assert not r.ok, '옛 generation renew 가 성공했다';
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2)));
  assert r.ok, '현재 generation renew 가 실패했다';
  -- 4. 만료됐지만 안 뺏긴 lease 의 renew 는 성공
  update public.agent_lead_leases set expires_at = now() - interval '1 minute' where user_id = u and project_id = p;
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2)));
  assert r.ok, '만료됐지만 안 뺏긴 lease 의 renew 가 실패했다';
  -- 5. 만료 뒤에는 다른 holder 가 얻는다
  update public.agent_lead_leases set expires_at = now() - interval '1 minute' where user_id = u and project_id = p;
  select * into r from public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  assert r.ok and r.generation = g2 + 1, '만료 뒤 획득 실패';
  -- 6. takeover 는 살아 있는 lease 도 빼앗는다
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', true);
  assert r.ok and r.generation = g2 + 2, 'takeover 실패';
  -- 7. release 는 holder·generation 이 맞을 때만, generation 을 올린다
  n := public.lead_lease_release(u, hb, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2 + 2)));
  assert n = 0, '남의 release 가 풀었다';
  n := public.lead_lease_release(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2 + 2)));
  assert n = 1, 'release 실패';
  assert (select holder is null and generation = g2 + 3 from public.agent_lead_leases where user_id = u and project_id = p), 'release 뒤 상태가 틀렸다';
  -- 8. force_release 는 살아 있는 lease 만
  n := public.lead_lease_force_release(u, p);
  assert n = 0, '빈 lease 를 force_release 가 셌다';
  perform public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  n := public.lead_lease_force_release(u, p);
  assert n = 1, 'force_release 실패';
  raise notice 'LEAD_LEASE_CHECK_OK';
end $$;
rollback;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/agent-lead-leases.test.ts`
Expected: PASS 5건. 기존 rollback 강제 테스트(`tests/migrations` 전체)도 `npx vitest run tests/migrations` 로 통과를 본다.

- [ ] **Step 6: 커밋 (마이그레이션 단독)**

```bash
git add supabase/migrations/0101_agent_lead_leases.sql supabase/migrations/0101_agent_lead_leases_rollback.sql
git commit -m "feat(db): 0101 팀장 lease 테이블과 CAS 함수를 추가한다

같은 신원+프로젝트의 팀장이 다른 clone·다른 PC 에서 겹쳐 뜨는 것을 서버에서 막는다.
generation 을 펜싱 토큰으로 써서 밀려난 팀장의 갱신이 확실히 실패하게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add tests/migrations/agent-lead-leases.test.ts scripts/checks/0101_lead_lease_check.sql
git commit -m "test(db): 0101 문안 검사와 스테이징 동작 검증 SQL 을 둔다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: lease API 라우트

**Files:**
- Create: `src/lib/agent/leadLease.ts`
- Create: `src/app/api/v1/agent/lead/lease/route.ts`
- Modify: `src/lib/agent/externalApi.ts:121` (`AGENT_CONTRACT_VERSION` → `'2.5'`)
- Modify: `tests/agent/me-route.test.ts` (계약 버전 기대값이 `2.4` 이면 `2.5` 로)
- Test: `tests/agent/lead-lease-parse.test.ts`, `tests/agent/lead-lease-route.test.ts`

**Interfaces:**
- Consumes: Task 1 의 RPC 넷(이름·인자·반환은 Task 1 Interfaces).
- Produces:
  - `parseLeaseBody(raw: unknown): LeaseOp | { error: string }`, `LeaseOp`, `LeaseRef { project_id: string; generation: number }`, `HOLDER_RE`
  - `POST /api/v1/agent/lead/lease` 응답:
    - acquire 200 `{ ok: true, leases: [{project_id, generation, expires_at}] }`
    - acquire 409 `{ error, code: 'lead_lease_held', held: [{project_id, host, agent, expires_at}] }`
    - renew 200 `{ ok: true, expires_at: string|null, lost: string[] }`
    - release 200 `{ ok: true, released: number }`

- [ ] **Step 1: 파서 테스트 작성**

`tests/agent/lead-lease-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseLeaseBody } from '@/lib/agent/leadLease'

const P1 = '11111111-1111-4111-8111-111111111111'
const H = '0123abcd-0000-4000-8000-00000000abcd:4294967295'

describe('parseLeaseBody', () => {
  it('acquire — projects 중복을 지우고 takeover 기본 false', () => {
    expect(parseLeaseBody({ op: 'acquire', projects: [P1, P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead' }))
      .toEqual({ op: 'acquire', projects: [P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead', takeover: false })
  })
  it.each([
    [{ op: 'acquire', projects: [], holder: H, host: 'm', agent: 'a' }, 'projects'],
    [{ op: 'acquire', projects: ['x'], holder: H, host: 'm', agent: 'a' }, 'projects'],
    [{ op: 'acquire', projects: [P1], holder: 'mbp', host: 'm', agent: 'a' }, 'holder'],
    [{ op: 'acquire', projects: [P1], holder: H, host: '', agent: 'a' }, 'host'],
    [{ op: 'acquire', projects: [P1], holder: H, host: 'm', agent: 'a', takeover: 'yes' }, 'takeover'],
    [{ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 0 }] }, 'generation'],
    [{ op: 'renew', holder: H, leases: [] }, 'leases'],
    [{ op: 'steal', holder: H }, 'op'],
  ])('%j → 오류(%s)', (body, word) => {
    const r = parseLeaseBody(body)
    expect('error' in r && r.error).toContain(word)
  })
  it('renew·release — leases 를 그대로 받는다', () => {
    for (const op of ['renew', 'release'] as const) {
      expect(parseLeaseBody({ op, holder: H, leases: [{ project_id: P1, generation: 3 }] }))
        .toEqual({ op, holder: H, leases: [{ project_id: P1, generation: 3 }] })
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/lead-lease-parse.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 파서 구현**

`src/lib/agent/leadLease.ts`:

```ts
// src/lib/agent/leadLease.ts
// 팀장 lease 요청 본문 파싱 — 순수. 스펙 docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §5.
import { isUuidLike } from '@/lib/domain/agentWork'

export const LEAD_LEASE_MAX_PROJECTS = 20
const LABEL_MAX = 120
/** '<PC ID(uuid)>:<리포 경로 cksum>' — 홈 경로를 서버에 보내지 않으려고 경로는 해시로만 받는다. */
export const HOLDER_RE = /^[0-9a-f-]{36}:[0-9]{1,12}$/

export interface LeaseRef { project_id: string; generation: number }
export type LeaseOp =
  | { op: 'acquire'; projects: string[]; holder: string; host: string; agent: string; takeover: boolean }
  | { op: 'renew' | 'release'; holder: string; leases: LeaseRef[] }

const label = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= LABEL_MAX ? t : null
}

export function parseLeaseBody(raw: unknown): LeaseOp | { error: string } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (b.op !== 'acquire' && b.op !== 'renew' && b.op !== 'release') {
    return { error: 'op 는 acquire·renew·release 중 하나여야 합니다.' }
  }
  if (typeof b.holder !== 'string' || !HOLDER_RE.test(b.holder)) return { error: 'holder 형식이 올바르지 않습니다.' }
  const holder = b.holder
  if (b.op === 'acquire') {
    const ps = b.projects
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > LEAD_LEASE_MAX_PROJECTS
      || !ps.every(p => typeof p === 'string' && isUuidLike(p))) {
      return { error: `projects 는 1~${LEAD_LEASE_MAX_PROJECTS}개의 uuid 여야 합니다.` }
    }
    const host = label(b.host)
    if (!host) return { error: `host 는 1~${LABEL_MAX}자여야 합니다.` }
    const agent = label(b.agent)
    if (!agent) return { error: `agent 는 1~${LABEL_MAX}자여야 합니다.` }
    if (b.takeover !== undefined && typeof b.takeover !== 'boolean') return { error: 'takeover 는 boolean 이어야 합니다.' }
    return { op: 'acquire', projects: [...new Set(ps as string[])], holder, host, agent, takeover: b.takeover === true }
  }
  const ls = b.leases
  if (!Array.isArray(ls) || ls.length < 1 || ls.length > LEAD_LEASE_MAX_PROJECTS) {
    return { error: `leases 는 1~${LEAD_LEASE_MAX_PROJECTS}개여야 합니다.` }
  }
  const leases: LeaseRef[] = []
  for (const l of ls) {
    const o = (typeof l === 'object' && l !== null ? l : {}) as Record<string, unknown>
    if (typeof o.project_id !== 'string' || !isUuidLike(o.project_id)) return { error: 'leases 의 project_id 가 uuid 가 아닙니다.' }
    if (typeof o.generation !== 'number' || !Number.isInteger(o.generation) || o.generation < 1) {
      return { error: 'leases 의 generation 은 1 이상의 정수여야 합니다.' }
    }
    leases.push({ project_id: o.project_id, generation: o.generation })
  }
  return { op: b.op, holder, leases }
}
```

- [ ] **Step 4: 파서 테스트 통과 확인**

Run: `npx vitest run tests/agent/lead-lease-parse.test.ts`
Expected: PASS

- [ ] **Step 5: 라우트 테스트 작성**

`tests/agent/lead-lease-route.test.ts` — `watch-route.test.ts` 의 admin 목 방식을 따르고 `rpc` 를 더한다. `isAgentProjectMember` 는 `memberships`·`project_roles` 조회를 쓰므로 큐로 흉내 낸다.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/lead/lease/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const H = '0123abcd-0000-4000-8000-00000000abcd:12345'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, rpcCalls: Array<[string, unknown]> = []) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'not', 'update']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push([fn, args])
      const resp = (queues[`rpc:${fn}`] ?? []).shift() ?? { data: null, error: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'hong@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown) =>
  POST(new NextRequest('http://l/api/v1/agent/lead/lease', {
    method: 'POST', headers: { Authorization: `Bearer ${PAT.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
// agent_runners: 토큰 조회 + last_used 갱신. memberships: 슈퍼유저 아님. project_roles: 멤버.
const base = (runner = RUNNER, member = true): Record<string, Resp[]> => ({
  agent_runners: [{ data: runner }, { data: null }],
  memberships: [{ data: { is_superuser: false } }, { data: { is_superuser: false } }],
  project_roles: [{ data: member ? [{ role: 'member' }] : [] }, { data: member ? [{ role: 'member' }] : [] }],
})
const acquire = (extra: Record<string, unknown> = {}) =>
  ({ op: 'acquire', projects: [P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead', ...extra })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
})

describe('POST /agent/lead/lease', () => {
  it('acquire 200 — RPC 에 사용자·holder·takeover 를 넘기고 generation 을 돌려준다', async () => {
    const calls: Array<[string, unknown]> = []
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ data: [
      { project_id: P1, ok: true, generation: 4, host: 'mbp', agent: 'hong/mbp/lead', expires_at: '2026-09-23T00:03:00Z' },
    ] }] }, calls)
    const res = await post(acquire())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, leases: [{ project_id: P1, generation: 4, expires_at: '2026-09-23T00:03:00Z' }] })
    expect(calls[0]).toEqual(['lead_lease_acquire', {
      p_user: 'u-1', p_projects: [P1], p_holder: H, p_host: 'mbp', p_agent: 'hong/mbp/lead', p_takeover: false,
    }])
  })
  it('acquire 409 lead_lease_held — 막힌 행을 held 로 싣는다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ data: [
      { project_id: P1, ok: false, generation: 2, host: 'other', agent: 'hong/other/lead', expires_at: '2026-09-23T00:02:00Z' },
    ] }] })
    const res = await post(acquire())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('lead_lease_held')
    expect(body.held).toEqual([{ project_id: P1, host: 'other', agent: 'hong/other/lead', expires_at: '2026-09-23T00:02:00Z' }])
  })
  it('acquire — 멤버가 아닌 프로젝트는 403 forbidden_role 이고 RPC 를 부르지 않는다', async () => {
    const admin = useAdmin(base(RUNNER, false))
    const res = await post(acquire())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('프로젝트 한정 PAT 는 다른 프로젝트에 403', async () => {
    const admin = useAdmin(base({ ...RUNNER, project_id: P2 }))
    const res = await post(acquire())
    expect(res.status).toBe(403)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('형식 오류는 400 validation_failed', async () => {
    useAdmin(base())
    const res = await post({ op: 'acquire', projects: [P1], holder: 'bad', host: 'm', agent: 'a' })
    expect(res.status).toBe(400)
  })
  it('RPC 실패는 500 — lease 없음으로 위장하지 않는다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_acquire': [{ error: { message: 'boom' } }] })
    const res = await post(acquire())
    expect(res.status).toBe(500)
  })
  it('renew — ok=false 행을 lost 로, 가장 이른 expires_at 을 돌려준다', async () => {
    useAdmin({ ...base(), 'rpc:lead_lease_renew': [{ data: [
      { project_id: P1, ok: true, expires_at: '2026-09-23T00:03:00Z' },
      { project_id: P2, ok: false, expires_at: null },
    ] }] })
    const res = await post({ op: 'renew', holder: H, leases: [{ project_id: P1, generation: 4 }, { project_id: P2, generation: 1 }] })
    expect(await res.json()).toEqual({ ok: true, expires_at: '2026-09-23T00:03:00Z', lost: [P2] })
  })
  it('release — 풀린 행 수를 돌려준다', async () => {
    const calls: Array<[string, unknown]> = []
    useAdmin({ ...base(), 'rpc:lead_lease_release': [{ data: 1 }] }, calls)
    const res = await post({ op: 'release', holder: H, leases: [{ project_id: P1, generation: 4 }] })
    expect(await res.json()).toEqual({ ok: true, released: 1 })
    expect(calls[0]).toEqual(['lead_lease_release', { p_user: 'u-1', p_holder: H, p_leases: [{ project_id: P1, generation: 4 }] }])
  })
})
```

실행해 보고 `resolveAgentPrincipal` 이 `agent_runners` 를 몇 번 조회하는지가 큐와 다르면, 큐 개수만 실제 호출 수에 맞춘다(`watch-route.test.ts` 의 `runnerQueues` 가 기준). renew·release 는 멤버 조회를 하지 않으므로 남는 큐는 무해하다.

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run tests/agent/lead-lease-route.test.ts`
Expected: FAIL (라우트 없음)

- [ ] **Step 7: 라우트 구현**

`src/app/api/v1/agent/lead/lease/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { parseLeaseBody } from '@/lib/agent/leadLease'

/**
 * 팀장 lease — 신원+프로젝트당 /dflow-team 팀장 하나. 스펙 2026-09-23-dflow-lead-lease-design.md §5.
 * 판정·CAS 는 DB 함수(0101)가 행 잠금 안에서 한다. 여기서는 신원·스코프·멤버십만 거른다.
 * PAT 전용 — 레거시 시크릿은 신원이 없어 lease 의 주인을 정할 수 없다.
 */
export const dynamic = 'force-dynamic'

interface AcquireRow { project_id: string; ok: boolean; generation: number; host: string | null; agent: string | null; expires_at: string | null }
interface RenewRow { project_id: string; ok: boolean; expires_at: string | null }

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const parsed = parseLeaseBody(raw)
  if ('error' in parsed) return apiBadRequest(parsed.error)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    if (principal.kind === 'legacy') return apiFail(400, 'identity_required', '이 엔드포인트는 PAT 전용입니다.')
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    const pids = parsed.op === 'acquire' ? parsed.projects : parsed.leases.map(l => l.project_id)
    if (pids.some(pid => !patProjectAllowed(principal, pid))) {
      return apiFail(403, 'forbidden_role', 'PAT 가 한정된 프로젝트와 다릅니다.')
    }

    if (parsed.op === 'acquire') {
      // 멤버가 아닌 프로젝트의 lease 를 잡아 그 프로젝트의 진짜 팀장을 막는 일을 막는다. 조회 실패도 거절(fail-closed).
      for (const pid of parsed.projects) {
        if (!(await isAgentProjectMember(admin, principal.userId, pid))) {
          return apiFail(403, 'forbidden_role', '이 프로젝트의 멤버가 아닙니다.')
        }
      }
      const { data, error } = await admin.rpc('lead_lease_acquire', {
        p_user: principal.userId, p_projects: parsed.projects, p_holder: parsed.holder,
        p_host: parsed.host, p_agent: parsed.agent, p_takeover: parsed.takeover,
      })
      if (error) { console.error('[agent-api] lease acquire 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as AcquireRow[]
      const held = rows.filter(r => !r.ok)
      if (held.length > 0) {
        return NextResponse.json({
          error: '같은 신원의 다른 팀장이 이 프로젝트의 lease 를 쥐고 있습니다.', code: 'lead_lease_held',
          held: held.map(r => ({ project_id: r.project_id, host: r.host, agent: r.agent, expires_at: r.expires_at })),
        }, { status: 409 })
      }
      return NextResponse.json({
        ok: true, leases: rows.map(r => ({ project_id: r.project_id, generation: r.generation, expires_at: r.expires_at })),
      })
    }

    if (parsed.op === 'renew') {
      const { data, error } = await admin.rpc('lead_lease_renew', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
      })
      if (error) { console.error('[agent-api] lease renew 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as RenewRow[]
      const kept = rows.filter(r => r.ok && r.expires_at).map(r => r.expires_at as string).sort()
      return NextResponse.json({ ok: true, expires_at: kept[0] ?? null, lost: rows.filter(r => !r.ok).map(r => r.project_id) })
    }

    const { data, error } = await admin.rpc('lead_lease_release', {
      p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
    })
    if (error) { console.error('[agent-api] lease release 실패:', error.message); return apiInternalError() }
    return NextResponse.json({ ok: true, released: typeof data === 'number' ? data : 0 })
  } catch (e) {
    console.error('[agent-api] lease 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
```

`src/lib/agent/externalApi.ts:121` 을 `export const AGENT_CONTRACT_VERSION = '2.5'` 로 바꾼다. `tests/agent/me-route.test.ts` 가 `'2.4'` 를 기대하면 `'2.5'` 로 고친다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run tests/agent`
Expected: PASS(전체). `npx tsc --noEmit -p .` 로 타입 오류 0.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/agent/leadLease.ts src/app/api/v1/agent/lead/lease/route.ts src/lib/agent/externalApi.ts tests/agent/lead-lease-parse.test.ts tests/agent/lead-lease-route.test.ts tests/agent/me-route.test.ts
git commit -m "feat(agent-api): 팀장 lease 라우트를 추가하고 계약을 2.5 로 올린다

acquire·renew·release 를 한 라우트에서 받는다. 멤버가 아닌 프로젝트의 lease 는 잡지 못한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: watch — holder 로 재개 요청 거르기

**Files:**
- Modify: `src/app/api/v1/agent/watch/route.ts`
- Test: `tests/agent/watch-route.test.ts`

**Interfaces:**
- Consumes: 테이블 `agent_lead_leases`(Task 1), `HOLDER_RE`(Task 2 가 만든 `src/lib/agent/leadLease.ts`). Task 2 가 끝난 뒤 한다.
- Produces: watch 본문 선택 필드 `holder`. 있으면 `resume_requests` 는 이 사용자가 그 holder 로 **유효한(expires_at > now)** lease 를 쥔 프로젝트의 것만.

- [ ] **Step 1: 테스트 추가**

`tests/agent/watch-route.test.ts` 의 `useAdmin` 의 체인 목록에 `'gt'` 를 더하고(`['eq', 'lt', 'gt', 'in', 'limit', 'order', 'not']`), describe 끝에 추가:

```ts
  describe('holder — lease 쥔 프로젝트의 재개 요청만', () => {
    const H = '0123abcd-0000-4000-8000-00000000abcd:12345'
    const order = (pid: string) => ({
      id: `${pid.slice(0, 8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, project_id: pid, wbs_item_id: null,
      claimed_by: 'claude-mbp', resume_requested_at: '2026-09-23T00:00:00Z', resume_requested_host: 'mbp',
    })
    it('lease 가 있는 프로젝트의 요청만 남긴다', async () => {
      useAdmin({ ...runnerQueues(), agent_lead_leases: [{ data: [{ project_id: P1 }] }], agent_work_orders: [{ data: [order(P1), order(P2)] }] })
      const res = await post({ agent: 'hong/mbp/lead', holder: H })
      const body = await res.json()
      expect(body.resume_requests.map((r: { project_id: string }) => r.project_id)).toEqual([P1])
    })
    it('lease 조회가 실패하면 resume_requests 는 null — 요청 없음으로 위장하지 않는다', async () => {
      useAdmin({ ...runnerQueues(), agent_lead_leases: [{ error: { message: 'boom' } }], agent_work_orders: [{ data: [order(P1)] }] })
      const body = await (await post({ agent: 'hong/mbp/lead', holder: H })).json()
      expect(body.resume_requests).toBeNull()
      expect(body.resume_requests_error).toBeTruthy()
    })
    it('holder 형식이 틀리면 400', async () => {
      useAdmin(runnerQueues())
      expect((await post({ agent: 'a', holder: 'mbp' })).status).toBe(400)
    })
    it('holder 가 없으면 기존 동작(프로젝트를 가리지 않음)', async () => {
      useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [order(P1), order(P2)] }] })
      const body = await (await post({ agent: 'hong/mbp/lead' })).json()
      expect(body.resume_requests).toHaveLength(2)
    })
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/agent/watch-route.test.ts`
Expected: 새 4건 중 앞의 셋 FAIL.

- [ ] **Step 3: 구현**

`src/app/api/v1/agent/watch/route.ts`:
1. import 에 `import { HOLDER_RE } from '@/lib/agent/leadLease'` 를 더한다.
2. 본문 파싱부(`bodyProject` 검사 뒤)에 추가:

```ts
  const holder = b.holder === undefined || b.holder === null ? null : b.holder
  if (holder !== null && (typeof holder !== 'string' || !HOLDER_RE.test(holder))) {
    return apiBadRequest('holder 형식이 올바르지 않습니다.')
  }
```

3. `loadResumeRequests` 에 인자 `holder: string | null` 을 더하고, 함수 첫머리에서 lease 프로젝트를 읽는다:

```ts
  // 팀장이 holder 를 보내면 그 holder 로 쥔 lease 의 프로젝트만 돌려준다(스펙 §9). 신원+프로젝트마다 팀장이
  // 하나이므로 hostname 이 겹치는 다른 PC 의 팀장이 남의 재개 요청을 가져가지 않는다.
  let leased: Set<string> | null = null
  if (holder !== null) {
    const { data: ls, error: lErr } = await admin
      .from('agent_lead_leases').select('project_id')
      .eq('user_id', userId).eq('holder', holder).gt('expires_at', new Date().toISOString())
    if (lErr) { console.error('[agent-api] lease 조회 실패:', lErr.message); return null }
    leased = new Set(((ls ?? []) as Array<{ project_id: string }>).map(r => r.project_id))
  }
```

그리고 주문 행을 읽은 직후 `const rows = …` 다음 줄에서 거른다:

```ts
  const rows = leased === null ? allRows : allRows.filter(r => leased.has(r.project_id))
```

(기존 `const rows = (data ?? []) as Array<…>` 를 `const allRows = …` 로 이름만 바꾼다.)

4. 호출부 `loadResumeRequests(admin, principal.userId, projectId)` 를 `loadResumeRequests(admin, principal.userId, projectId, holder)` 로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/agent/watch-route.test.ts`
Expected: PASS(기존 + 4)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/v1/agent/watch/route.ts tests/agent/watch-route.test.ts
git commit -m "feat(agent-api): watch 가 holder 를 받으면 lease 쥔 프로젝트의 재개 요청만 돌려준다

hostname 이 같은 다른 PC 의 팀장이 남의 재개 요청을 가져가던 구멍을 lease 로 막는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


---

### Task 4: CLI — `dflow.sh lease`

**Files:**
- Create: `.claude/skills/dflow-work/scripts/dflow-lease.sh`
- Modify: `.claude/skills/dflow-work/scripts/dflow.sh` (source·usage·main 분기·`cmd_watch --holder`·`CONTRACT_VERSION=2.5`)
- Modify: `.claude/skills/dflow-work/references/api-contract.md` (v2.5 변경점 + 엔드포인트)
- Modify: `tests/skills/dflow-key-select.test.ts` (가짜 서버 `contract_version` 이 `2.4` 이고 doctor 경고를 검사하는 부분이 있으면 major 비교라 그대로 둔다. 실패할 때만 고친다)
- Test: `tests/skills/dflow-lead-lease.test.ts`

**Interfaces:**
- Consumes: Task 2 의 API 응답 모양.
- Produces (Task 5 가 문서에 쓴다):
  - `dflow.sh lease holder` → stdout 한 줄 `<uuid>:<cksum>`, exit 0.
  - `dflow.sh lease acquire [--takeover]` → exit 0 + `LEASE_OK <n>` / exit 4 + 줄마다 `LEAD_LEASE_HELD <project_id> <host> <agent> <expires_at>` / 그 밖 dflow.sh 공통 코드.
  - `dflow.sh lease renew` → exit 0 + `LEASE_OK` / exit 4 + `LEASE_LOST <pid…>` / 상태 파일 없음 exit 2 + `LEASE_NONE`.
  - `dflow.sh lease release` → exit 0 + `LEASE_RELEASED <n>` 또는 `LEASE_NONE`.
  - `dflow.sh lease keep --pid <PID> --lost-file <path>` → 팀장 PID 가 죽거나 TERM·HUP·INT 를 받으면 release 하고 0, 상태 파일이 없어지면 0, lost 면 `<path>` 에 `LEASE_LOST …` 쓰고 4, 연속 3회 실패면 `<path>` 에 `LEASE_UNREACHABLE rc=<n>` 쓰고 6. 성공한 갱신마다 `<상태 파일>.beat` 에 epoch 초를 쓴다.
  - `dflow.sh watch … --holder <h>` → 본문에 `holder`.
  - 상태 파일: `git rev-parse --path-format=absolute --git-path dflow-team.lease`, 한 줄에 `<project_id> <generation>`, 권한 600.
  - 시험용 환경 변수(문서화하지 않는다): `DFLOW_LEASE_INTERVAL`(기본 60), `DFLOW_LEASE_STEP`(기본 5), `DFLOW_MACHINE_ID_FILE`(기본 `$HOME/.dflow/machine-id`).

- [ ] **Step 1: 테스트 작성**

`tests/skills/dflow-lead-lease.test.ts` — `dflow-key-select.test.ts` 처럼 가짜 `curl` 을 PATH 앞에 둔다. 가짜 curl 은 요청 본문의 `op` 로 응답을 고르고, 받은 본문을 `$FAKE_LOG` 에 한 줄씩 남긴다(토큰은 남기지 않는다).

```ts
// tests/skills/dflow-lead-lease.test.ts
// 팀장 lease CLI(docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §6). dflow.sh 를 가짜 curl 로 실제 실행한다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const DFLOW = join(ROOT, '.claude/skills/dflow-work/scripts/dflow.sh')
const TOKEN = `dflow_pat_AAAAAAAAAAAA_${'x'.repeat(24)}` // 가짜. 실제 키가 아니다
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

// FAKE_MODE 로 응답을 바꾼다: ok(기본) | held | lost | down
const FAKE_CURL = `#!/bin/sh
out=''; data=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --data) data="$2"; shift ;;
    -w|-X|-H) shift ;;
  esac
  shift
done
[ "\${FAKE_MODE:-ok}" = down ] && exit 7
printf '%s\\n' "$data" >> "$FAKE_LOG"
op=$(printf '%s' "$data" | jq -r '.op // empty')
code=200
case "$op" in
  acquire)
    if [ "\${FAKE_MODE:-ok}" = held ]; then code=409
      body='{"error":"x","code":"lead_lease_held","held":[{"project_id":"${P1}","host":"other","agent":"hong/other/lead","expires_at":"2026-09-23T00:02:00Z"}]}'
    else body=$(printf '%s' "$data" | jq -c '{ok:true, leases:[.projects[] | {project_id:., generation:7, expires_at:"2026-09-23T00:03:00Z"}]}'); fi ;;
  renew)
    if [ "\${FAKE_MODE:-ok}" = lost ]; then body='{"ok":true,"expires_at":null,"lost":["${P1}"]}'
    else body='{"ok":true,"expires_at":"2026-09-23T00:03:00Z","lost":[]}'; fi ;;
  release) body='{"ok":true,"released":1}' ;;
  *) body='{"ok":true,"user_email":"hong@example.com","expires_at":"2026-09-23T01:00:00Z","resume_requests":[]}' ;;
esac
printf '%s' "$body" > "$out"; printf '%s' "$code"
`

let tmp: string, repo: string, log: string
const envFor = (env: Record<string, string>) => ({
  NODE_ENV: process.env.NODE_ENV,
  PATH: `${join(tmp, 'bin')}:${process.env.PATH ?? ''}`, HOME: join(tmp, 'home'),
  XDG_CACHE_HOME: join(tmp, 'cache'), FAKE_LOG: log,
  DFLOW_ENV_FILE: join(tmp, 'no-such-env'), DFLOW_CONFIG_DIR: join(tmp, 'no-config'),
  DFLOW_API_BASE: 'https://x.test', DFLOW_PATS: TOKEN, DFLOW_PROJECT_MAP: `a=${P1},b=${P2}`,
  DFLOW_LEASE_INTERVAL: '1', DFLOW_LEASE_STEP: '1', ...env,
})
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('sh', [DFLOW, ...args], { cwd: repo, encoding: 'utf8', env: envFor(env) })
}
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const stateFile = () => join(repo, '.git', 'dflow-team.lease')

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dflow-lease-'))
  repo = join(tmp, 'repo'); log = join(tmp, 'curl.log')
  mkdirSync(join(tmp, 'bin')); mkdirSync(join(tmp, 'home')); mkdirSync(repo)
  writeFileSync(join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 })
  writeFileSync(log, '')
  spawnSync('git', ['init', '-q'], { cwd: repo })
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('lease holder', () => {
  it('machine-id 를 만들고(600) <uuid>:<cksum> 를 찍는다. 두 번째 호출도 같은 값', () => {
    const a = run(['lease', 'holder']); const b = run(['lease', 'holder'])
    expect(a.status).toBe(0)
    expect(a.stdout.trim()).toMatch(/^[0-9a-f-]{36}:[0-9]{1,12}$/)
    expect(b.stdout).toBe(a.stdout)
    const f = join(tmp, 'home/.dflow/machine-id')
    expect(statSync(f).mode & 0o777).toBe(0o600)
  })
})

describe('lease acquire', () => {
  it('바인딩 프로젝트 전부를 한 번에 요청하고 상태 파일을 쓴다', () => {
    const r = run(['lease', 'acquire'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('LEASE_OK 2')
    const body = sent().find(b => b.op === 'acquire')
    expect(body.projects.sort()).toEqual([P1, P2].sort())
    expect(body.takeover).toBe(false)
    expect(body.agent).toMatch(/^hong\/[a-z0-9-]+\/lead$/)
    expect(readFileSync(stateFile(), 'utf8').trim().split('\n').sort()).toEqual([`${P1} 7`, `${P2} 7`].sort())
    expect(statSync(stateFile()).mode & 0o777).toBe(0o600)
  })
  it('--takeover 는 takeover:true 로 보낸다', () => {
    run(['lease', 'acquire', '--takeover'])
    expect(sent().find(b => b.op === 'acquire').takeover).toBe(true)
  })
  it('막히면 exit 4 와 LEAD_LEASE_HELD 줄, 상태 파일은 없다', () => {
    const r = run(['lease', 'acquire'], { FAKE_MODE: 'held' })
    expect(r.status).toBe(4)
    expect(r.stdout.trim()).toBe(`LEAD_LEASE_HELD ${P1} other hong/other/lead 2026-09-23T00:02:00Z`)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('바인딩이 없으면 exit 2', () => {
    const r = run(['lease', 'acquire'], { DFLOW_PROJECT_MAP: '' })
    expect(r.status).toBe(2)
  })
})

describe('lease renew·release', () => {
  it('renew — 상태 파일의 generation 으로 보내고 LEASE_OK', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'renew'])
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('LEASE_OK')
    expect(sent().find(b => b.op === 'renew').leases).toEqual(expect.arrayContaining([{ project_id: P1, generation: 7 }]))
  })
  it('renew — lost 면 exit 4 + LEASE_LOST', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'renew'], { FAKE_MODE: 'lost' })
    expect(r.status).toBe(4)
    expect(r.stdout.trim()).toBe(`LEASE_LOST ${P1}`)
  })
  it('renew — 상태 파일이 없으면 exit 2 + LEASE_NONE', () => {
    const r = run(['lease', 'renew'])
    expect(r.status).toBe(2)
    expect(r.stdout.trim()).toBe('LEASE_NONE')
  })
  it('release — 보내고 상태 파일을 지운다. 두 번째는 LEASE_NONE', () => {
    run(['lease', 'acquire'])
    expect(run(['lease', 'release']).stdout.trim()).toBe('LEASE_RELEASED 1')
    expect(existsSync(stateFile())).toBe(false)
    const again = run(['lease', 'release'])
    expect(again.status).toBe(0)
    expect(again.stdout.trim()).toBe('LEASE_NONE')
  })
})

describe('lease keep', () => {
  it('팀장 PID 가 없으면 release 하고 0 으로 끝난다', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', '999999', '--lost-file', join(tmp, 'lost')])
    expect(r.status).toBe(0)
    expect(sent().some(b => b.op === 'release')).toBe(true)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('상태 파일이 없어지면 0 으로 끝난다(정상 마감의 release 뒤)', () => {
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')])
    expect(r.status).toBe(0)
    expect(existsSync(join(tmp, 'lost'))).toBe(false)
  })
  it('lost 면 표식 파일에 LEASE_LOST 를 쓰고 4', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], { FAKE_MODE: 'lost' })
    expect(r.status).toBe(4)
    expect(readFileSync(join(tmp, 'lost'), 'utf8').trim()).toBe(`LEASE_LOST ${P1}`)
  })
  it('네트워크가 3회 연속 실패하면 LEASE_UNREACHABLE 을 쓰고 6', () => {
    run(['lease', 'acquire'])
    const r = run(['lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], { FAKE_MODE: 'down' })
    expect(r.status).toBe(6)
    expect(readFileSync(join(tmp, 'lost'), 'utf8')).toMatch(/^LEASE_UNREACHABLE rc=6/)
  })
  it('SIGTERM 을 받으면 release 하고 끝난다(세션 종료가 백그라운드 태스크를 거둘 때)', async () => {
    run(['lease', 'acquire'])
    const child = spawn('sh', [DFLOW, 'lease', 'keep', '--pid', String(process.pid), '--lost-file', join(tmp, 'lost')], {
      cwd: repo, env: envFor({}),
    })
    await new Promise(r => setTimeout(r, 1500))   // 첫 갱신까지
    child.kill('SIGTERM')
    const code = await new Promise<number | null>(r => child.on('exit', c => r(c)))
    expect(code).toBe(0)
    expect(sent().some(b => b.op === 'release')).toBe(true)
    expect(existsSync(stateFile())).toBe(false)
  })
  it('성공한 갱신마다 beat 파일을 쓴다', () => {
    run(['lease', 'acquire'])
    // 한 번 갱신한 뒤 PID 를 죽은 것으로 보이게: 존재하지 않는 PID 는 첫 검사에서 바로 끝나므로, 여기서는 renew 를 직접 부른다.
    run(['lease', 'renew'])
    expect(Number(readFileSync(`${stateFile()}.beat`, 'utf8'))).toBeGreaterThan(0)
  })
})

describe('watch --holder', () => {
  it('본문에 holder 를 싣는다', () => {
    const h = run(['lease', 'holder']).stdout.trim()
    run(['watch', '--agent', 'hong/mbp/lead', '--holder', h, '--json'])
    expect(sent().find(b => b.agent === 'hong/mbp/lead').holder).toBe(h)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-lead-lease.test.ts`
Expected: FAIL (usage exit 2)

- [ ] **Step 3: `dflow-lease.sh` 작성**

`.claude/skills/dflow-work/scripts/dflow-lease.sh`:

```sh
# dflow-lease.sh — 팀장 lease(docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md §6). dflow.sh 가 source 한다.
# dflow.sh 의 api_raw·die·slug·host_short·profile_email·ALLOWED_PROJECTS·TOK 을 쓴다. 토큰은 env 로만 넘긴다.

# PC ID — hostname 은 겹칠 수 있어 쓰지 않는다. 처음 쓸 때 /dev/urandom 으로 만든다(uuidgen 이 없는 Git Bash 대비).
lease_machine_id() {
  _mf="${DFLOW_MACHINE_ID_FILE:-$HOME/.dflow/machine-id}"
  if [ ! -s "$_mf" ]; then
    mkdir -p "$(dirname "$_mf")" && chmod 700 "$(dirname "$_mf")" || return 1
    _hex=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n') || return 1
    [ "${#_hex}" -eq 32 ] || return 1
    ( umask 077
      printf '%s-%s-4%s-8%s-%s\n' "$(printf '%s' "$_hex" | cut -c1-8)" "$(printf '%s' "$_hex" | cut -c9-12)" \
        "$(printf '%s' "$_hex" | cut -c14-16)" "$(printf '%s' "$_hex" | cut -c18-20)" "$(printf '%s' "$_hex" | cut -c21-32)" \
        > "$_mf" ) || return 1
    chmod 600 "$_mf"
  fi
  head -n 1 "$_mf" | tr -d '\r'
}
# holder = <PC ID>:<리포 경로 cksum>. 홈 경로를 서버에 보내지 않으려고 경로는 해시로만 싣는다.
lease_holder() {
  _mid=$(lease_machine_id) || return 1
  _top=$(${DFLOW_GIT:-git} rev-parse --show-toplevel 2>/dev/null) || return 1
  printf '%s:%s\n' "$_mid" "$(printf '%s' "$_top" | cksum | cut -d' ' -f1)"
}
lease_state_file() { ${DFLOW_GIT:-git} rev-parse --path-format=absolute --git-path dflow-team.lease 2>/dev/null; }
# 상태 파일 → [{project_id, generation}]
lease_refs_json() { jq -Rnc '[inputs | select(. != "") | split(" ") | {project_id: .[0], generation: (.[1] | tonumber)}]' < "$1"; }

lease_acquire() {
  _take=false
  case "${1:-}" in --takeover) _take=true ;; '') ;; *) usage ;; esac
  [ -n "$ALLOWED_PROJECTS" ] || die 2 "NO_PROJECT .dflow 의 project_id 또는 .dflow.local 의 project_map 을 넣어라"
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  _em=$(profile_email "$TOK") || die 3 "신원 확인 실패(/me)"
  _hs=$(slug "$(host_short)")
  _json=$(printf '%s\n' "$ALLOWED_PROJECTS" | jq -Rnc --arg h "$_h" --arg hs "$_hs" \
    --arg a "$(slug "${_em%%@*}")/$_hs/lead" --argjson t "$_take" \
    '{op:"acquire", projects:[inputs | select(. != "")], holder:$h, host:$hs, agent:$a, takeover:$t}')
  mkdir -p "$CACHE_DIR"; _ef="$CACHE_DIR/lease_err.$$"
  _body=$( (TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") 2>"$_ef" ); _rc=$?
  if [ "$_rc" = 4 ] && jq -e '.code == "lead_lease_held"' "$_ef" >/dev/null 2>&1; then
    jq -r '.held[] | "LEAD_LEASE_HELD \(.project_id) \(.host // "-") \(.agent // "-") \(.expires_at // "-")"' "$_ef"
    rm -f "$_ef"; exit 4
  fi
  [ "$_rc" = 0 ] || { cat "$_ef" >&2; rm -f "$_ef"; exit "$_rc"; }
  rm -f "$_ef"
  ( umask 077; printf '%s' "$_body" | jq -r '.leases[] | "\(.project_id) \(.generation)"' > "$_sf" ) \
    || die 6 "LEASE_STATE 상태 파일을 쓰지 못했다"
  date +%s > "$_sf.beat"   # 첫 기상의 LEASE_KEEP_DEAD 오경보를 막는다(keep 이 첫 갱신을 하기 전)
  printf 'LEASE_OK %s\n' "$(grep -c . "$_sf")"
}

lease_renew() {
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  [ -s "$_sf" ] || { printf 'LEASE_NONE\n'; exit 2; }
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _json=$(jq -nc --arg h "$_h" --argjson l "$(lease_refs_json "$_sf")" '{op:"renew", holder:$h, leases:$l}')
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") || exit $?
  _lost=$(printf '%s' "$_body" | jq -r '.lost | join(" ")')
  [ -z "$_lost" ] || { printf 'LEASE_LOST %s\n' "$_lost"; exit 4; }
  date +%s > "$_sf.beat"
  printf 'LEASE_OK\n'
}

lease_release() {
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  [ -s "$_sf" ] || { rm -f "$_sf" "$_sf.beat"; printf 'LEASE_NONE\n'; return 0; }
  _h=$(lease_holder) || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다"
  _json=$(jq -nc --arg h "$_h" --argjson l "$(lease_refs_json "$_sf")" '{op:"release", holder:$h, leases:$l}')
  _body=$(TOKEN="$TOK" api_raw POST /api/v1/agent/lead/lease "$_json") || exit $?
  rm -f "$_sf" "$_sf.beat"
  printf 'LEASE_RELEASED %s\n' "$(printf '%s' "$_body" | jq -r '.released')"
}

# 팀장 PID 에 묶인 갱신 루프. run_in_background 로 띄운다.
lease_keep() {
  _pid=''; _lf=''
  while [ $# -gt 0 ]; do
    case "$1" in
      --pid) _pid="${2:-}"; shift 2 || usage ;;
      --lost-file) _lf="${2:-}"; shift 2 || usage ;;
      *) usage ;;
    esac
  done
  [ -n "$_pid" ] && [ -n "$_lf" ] || usage
  _iv="${DFLOW_LEASE_INTERVAL:-60}"; _st="${DFLOW_LEASE_STEP:-5}"; _fails=0
  _sf=$(lease_state_file) || die 2 "LEASE_STATE git 리포 안에서 실행하라"
  # 세션이 끝나며 백그라운드 태스크를 신호로 거두면 kill -0 분기에 닿지 못한다. 그때도 바로 반납한다.
  trap '(lease_release) >/dev/null 2>&1; exit 0' TERM HUP INT
  while :; do
    # 팀장이 죽었으면 바로 반납한다 — TTL 을 기다리면 같은 신원이 다른 곳에서 3분간 시작하지 못한다.
    kill -0 "$_pid" 2>/dev/null || { (lease_release) >/dev/null 2>&1; exit 0; }
    # 정상 마감이 release 로 상태 파일을 지웠다.
    [ -s "$_sf" ] || exit 0
    _out=$( (lease_renew) 2>/dev/null ); _rc=$?
    case "$_rc" in
      0) _fails=0 ;;
      4) printf '%s\n' "$_out" > "$_lf"; exit 4 ;;
      *) [ -s "$_sf" ] || exit 0
         _fails=$((_fails + 1))
         # 3분 넘게 서버에 닿지 못하면 이미 만료돼 다른 곳이 가져갔을 수 있다. 소유를 장담할 수 없으니 잃은 것으로 다룬다.
         [ "$_fails" -lt 3 ] || { printf 'LEASE_UNREACHABLE rc=%s\n' "$_rc" > "$_lf"; exit 6; } ;;
    esac
    _t=0
    while [ "$_t" -lt "$_iv" ]; do
      sleep "$_st"; _t=$((_t + _st))
      kill -0 "$_pid" 2>/dev/null || break
      [ -s "$_sf" ] || break
    done
  done
}

cmd_lease() {
  _sub="${1:-}"; [ $# -gt 0 ] && shift
  case "$_sub" in
    holder) lease_holder || die 6 "LEASE_HOLDER PC ID 나 리포 경로를 정하지 못했다" ;;
    acquire) lease_acquire "$@" ;;
    renew) lease_renew ;;
    release) lease_release ;;
    keep) lease_keep "$@" ;;
    *) usage ;;
  esac
}
```

- [ ] **Step 4: `dflow.sh` 연결**

1. `CONTRACT_VERSION=2.4` → `CONTRACT_VERSION=2.5`.
2. `usage()` 의 `watch` 줄을 `watch [--agent id] [--slots n] [--busy n] [--until HH:MM] [--project id] [--holder h] [--json] [--stop]` 로 바꾸고, `release <ref>` 줄 아래에 추가:

```
  lease holder|acquire [--takeover]|renew|release|keep --pid <PID> --lost-file <path>
                         팀장 lease(신원+프로젝트당 팀장 하나). /dflow-team 이 쓴다
```

3. `ALLOWED_PROJECTS=$(dflow_config_projects)` 줄 **뒤**에 source 를 더한다(함수 정의만 있으므로 위치는 main 분기 앞이면 된다):

```sh
. "$(dirname "$0")/dflow-lease.sh"
```

4. `cmd_watch` 의 인자 루프에 `--holder) _holder="${2:-}"; shift 2 || usage ;;` 를 더하고 첫 줄 변수 초기화에 `_holder=''` 를 넣는다. 본문 jq 에 `--arg hd "$_holder"` 와 `+ (if $hd != "" then {holder:$hd} else {} end)` 를 더한다.
5. main 의 TOK 분기 case 에 `lease) cmd_lease "$@" ;;` 를 더한다(`release)` 줄 아래).

- [ ] **Step 5: 계약 문서**

`.claude/skills/dflow-work/references/api-contract.md`:
- 제목 `v2.4` → `v2.5`, 둘째 줄 `contract_version: "2.4"` → `"2.5"` 와 요약 끝에 "v2.5는 팀장 lease 를 더했다." 를 붙인다. 응답 예시와 본문 속 `"2.4"`(현재 값 설명)도 `"2.5"` 로.
- `## v2.4 변경점` 위에 추가:

```markdown
## v2.5 변경점 (2026-09-23)

- `POST /api/v1/agent/lead/lease` 신설 — 신원+프로젝트당 `/dflow-team` 팀장 하나(0101). 본문 `op`:
  - `acquire` `{projects, holder, host, agent, takeover?}` → 200 `{ok, leases:[{project_id, generation, expires_at}]}` · 409 `lead_lease_held` + `held:[{project_id, host, agent, expires_at}]`
  - `renew` `{holder, leases:[{project_id, generation}]}` → 200 `{ok, expires_at, lost:[project_id]}`
  - `release` `{holder, leases}` → 200 `{ok, released}`
  - `holder` = `<PC ID uuid>:<리포 경로 cksum>`. TTL 180초. PAT 전용, `work:claim`, acquire 는 프로젝트 멤버만(403 `forbidden_role`).
- `POST /api/v1/agent/watch` 에 선택 필드 `holder` — 주면 `resume_requests` 를 그 holder 로 쥔 유효 lease 의 프로젝트로 거른다. lease 조회 실패는 `resume_requests: null`.
- CLI: `dflow.sh lease holder|acquire [--takeover]|renew|release|keep`, `dflow.sh watch --holder`.
```

- 엔드포인트 표(`## 엔드포인트`)에 `POST /api/v1/agent/lead/lease` 한 줄을 더하고, 에러코드 전수 표에 `lead_lease_held`(409)를 더한다.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/skills/dflow-lead-lease.test.ts tests/skills/dflow-key-select.test.ts tests/skills/dflow-config.test.ts`
Expected: PASS. 그리고 `sh -n .claude/skills/dflow-work/scripts/dflow-lease.sh && sh -n .claude/skills/dflow-work/scripts/dflow.sh` 가 조용히 끝난다.

- [ ] **Step 7: 커밋**

```bash
git add .claude/skills/dflow-work/scripts/dflow-lease.sh .claude/skills/dflow-work/scripts/dflow.sh .claude/skills/dflow-work/references/api-contract.md tests/skills/dflow-lead-lease.test.ts
git commit -m "feat(dflow-work): dflow.sh lease 로 팀장 lease 를 얻고 갱신한다

keep 은 팀장 PID 에 묶여 60초마다 갱신하고, 팀장이 죽으면 바로 반납한다.
잃으면 표식 파일로 감시 루프를 깨운다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 팀장 흐름 — `dflow-team/SKILL.md`

**Files:**
- Modify: `.claude/skills/dflow-team/SKILL.md` (「인자」, 「1. 시작」 전제 검사 블록과 설명, 5번 감시 시작, 「2-2」 감시 루프, 「2-3」 기상 블록·기상 표, 「7. 마감」 6번 블록, 새 「lease 상실 마감」)
- Modify: `.claude/skills/dflow-team/references/help.md` (인자 표에 강제 인수)
- Test: `tests/skills/dflow-team-lease.test.ts`

**Interfaces:**
- Consumes: Task 4 의 명령·출력(`LEASE_OK`·`LEAD_LEASE_HELD`·`LEASE_LOST`·`LEASE_UNREACHABLE`, 상태 파일 `dflow-team.lease`·`.beat`, 표식 파일 `dflow-team.lease-lost`).

- [ ] **Step 1: 테스트 작성**

`tests/skills/dflow-team-lease.test.ts`:

```ts
// 팀장 lease 가 SKILL.md 흐름에 들어갔는지(스펙 2026-09-23-dflow-lead-lease-design.md §8).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/dflow-team/SKILL.md', 'utf8')
const HELP = readFileSync('.claude/skills/dflow-team/references/help.md', 'utf8')
const section = (from: string, to: string) => SKILL.slice(SKILL.indexOf(from), SKILL.indexOf(to, SKILL.indexOf(from) + 1))

describe('dflow-team lease', () => {
  it('전제 검사: 로컬 잠금을 잡은 뒤 lease acquire, 실패하면 잠금을 지우고 멈춘다', () => {
    const s = section('## 1. 시작', '## 2. 기상과 감시')
    const lock = s.indexOf('owner = <신원>/<host>/lead')
    const acq = s.indexOf('dflow.sh lease acquire')
    expect(lock).toBeGreaterThan(-1)
    expect(acq).toBeGreaterThan(lock)
    expect(s).toMatch(/FAIL LEASE/)
    expect(s).toMatch(/rm -rf "\$LOCK"; echo "FAIL LEASE/)
  })
  it('--takeover 는 변수 전개가 아니라 if 분기로 붙인다(zsh 빈 인자)', () => {
    const s = section('## 1. 시작', '## 2. 기상과 감시')
    expect(s).toMatch(/if \[ "\$TAKEOVER" = --takeover \]; then/)
    expect(s).not.toMatch(/lease acquire \$TAKEOVER/)
  })
  it('감시 시작에서 lease keep 을 팀장 PID 로 run_in_background 로 띄운다', () => {
    expect(SKILL).toMatch(/dflow\.sh lease keep --pid <LEAD_PID> --lost-file '<[^>]+>'/)
  })
  it('감시 루프: LEASE_LOST 검사가 STOP_REQUESTED 뒤, 결과 검사 앞', () => {
    const s = section('### 2-2. 감시 루프', '### 2-3.')
    const stop = s.indexOf('echo STOP_REQUESTED')
    const lease = s.indexOf('echo "LEASE_LOST')
    const hit = s.indexOf('RESULT_READY$hit')
    expect(stop).toBeGreaterThan(-1)
    expect(lease).toBeGreaterThan(stop)
    expect(hit).toBeGreaterThan(lease)
  })
  it('기상: watch 에 --holder 를 싣고 keep 의 beat 를 확인한다', () => {
    const s = section('### 2-3. 기상마다 하는 일', '## 3. 결과 처리')
    expect(s).toMatch(/--holder "\$\(\.claude\/skills\/dflow-work\/scripts\/dflow\.sh lease holder\)"/)
    expect(s).toMatch(/LEASE_KEEP_DEAD/)
    expect(s).toMatch(/\| `LEASE_LOST/)
  })
  it('lease 상실 마감은 워커를 건드리지 않고, 6번 블록의 release 가 남의 lease 를 풀지 않는 이유를 적는다', () => {
    const s = section('**lease 상실 마감**', '## 좌석표 연동')
    expect(s).toMatch(/워커[^\n]*건드리지 않는다/)
    expect(s).toMatch(/holder·generation 이 맞는 행만/)
    expect(s).toMatch(/새 claim·새 spawn·승인 스윕·머지를 하지 않는다/)
  })
  it('정상 마감은 lease release 를 부른다', () => {
    const s = section('## 7. 마감', '**잠금 상실 마감**')
    expect(s).toMatch(/dflow\.sh lease release/)
  })
  it('help 에 강제 인수가 있다', () => {
    expect(HELP).toMatch(/--takeover|강제 인수/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/skills/dflow-team-lease.test.ts`
Expected: FAIL

- [ ] **Step 3: 「인자」 에 강제 인수 추가**

「인자」 의 `- **`help`**:` 항목 바로 아래에 추가:

```markdown
- **강제 인수**: 인자에 `--takeover`·`강제 인수`·`넘겨받기` 가 있으면 「1. 시작」 의 `<TAKEOVER>` 를 `--takeover` 로,
  없으면 빈 값으로 채운다. 같은 신원이 이 프로젝트의 팀장 lease 를 **다른 곳**(다른 clone·다른 PC)에서 쥐고 있을 때
  그것을 빼앗는다. 밀려난 팀장은 20초 안에 `LEASE_LOST` 로 멈추고, 그 팀장의 워커는 하던 작업을 끝낸다. 사람이
  명시할 때만 쓴다. 이유: 살아 있는 팀장을 빼앗으면 그 팀장의 슬롯·대기 큐가 보고만 남기고 끊긴다.
```

- [ ] **Step 4: 전제 검사 블록에 lease 획득 추가**

「1. 시작」 셸 블록의 `rm -f "$(git rev-parse --git-path dflow-team.stop)"   # 지난 실행이 남긴 종료 요청을 지운다` 줄 **바로 뒤**, `echo "PRECHECK_OK …"` **앞**에 넣는다:

```bash
   rm -f "$(git rev-parse --git-path dflow-team.lease-lost)"   # 지난 실행이 남긴 lease 상실 표식을 지운다
   TAKEOVER='<TAKEOVER>'   # --takeover 또는 빈 값(「인자」 강제 인수)
   if [ "$TAKEOVER" = --takeover ]; then lr=$(.claude/skills/dflow-work/scripts/dflow.sh lease acquire --takeover)
   else lr=$(.claude/skills/dflow-work/scripts/dflow.sh lease acquire); fi
   lrc=$?
   printf '%s\n' "$lr"
   [ "$lrc" = 0 ] || { rm -rf "$LOCK"; echo "FAIL LEASE rc=$lrc"; exit 1; }
```

블록 아래 설명 목록(`- **팀장 잠금**:` 항목 뒤)에 추가:

```markdown
   - **팀장 lease**: 로컬 잠금은 같은 리포의 워크트리끼리만 본다. 같은 신원이 **다른 clone·다른 PC** 에서 같은
     프로젝트의 팀장을 띄우는 것은 서버 lease 가 막는다(스펙 `docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md`).
     로컬 잠금을 잡은 **뒤** 얻는다. 이유: 같은 리포의 두 팀장이 동시에 서버에 가서 같은 holder 로 서로를
     밀어내지 않게, 로컬 경합을 먼저 끝낸다. 결과별 처리:
     - `LEASE_OK <n>`: 계속한다.
     - `LEAD_LEASE_HELD <project_id> <host> <agent> <만료 시각>` 줄(exit 4): 잠금을 지우고 멈춘다. 줄마다 "이 프로젝트는
       `<host>` 의 `<agent>` 가 쥐고 있다(만료 `<시각>`)" 로 보고하고, "그 팀장이 이미 죽었다면 최대 3분 뒤 풀린다.
       지금 넘겨받으려면 `/dflow-team … --takeover` 또는 오피스 화면의 「팀장 해제」" 를 덧붙인다.
     - 그 밖(exit 2·3·5·6·7): 잠금을 지우고 사유를 보고하고 멈춘다. 서버에 lease 가 없는 구버전(exit 7, 404)도 여기다.
       lease 를 확인하지 못한 채 시작하지 않는다(fail-closed).
     `holder` 는 `~/.dflow/machine-id`(처음 쓸 때 만든다)와 이 체크아웃 경로로 정해진다. 같은 자리에서 다시 시작하면
     즉시 넘겨받는다.
```

- [ ] **Step 5: 감시 시작(5번)에 lease keep 추가**

「1. 시작」 5번의 절전 방지 설명(`두라" 를 적는다. Linux 서버와 Windows 에서는 띄우지 않는다.`) 바로 뒤에 추가:

```markdown
   **lease 갱신**: 이어서 아래를 Bash `run_in_background` 로 띄운다(모든 OS). 60초마다 lease 를 갱신하고,
   팀장 세션이 끝나면 lease 를 바로 반납하고 끝난다. lease 를 잃으면 표식 파일에 사유를 쓰고 끝나며, 감시 루프가
   그것을 보고 `LEASE_LOST` 로 깨운다. `<lease-lost 절대경로>` 는
   `git rev-parse --path-format=absolute --git-path dflow-team.lease-lost` 의 값을 **리터럴로** 박는다(루프와 같은 이유).
   ```bash
   .claude/skills/dflow-work/scripts/dflow.sh lease keep --pid <LEAD_PID> --lost-file '<lease-lost 절대경로>'
   ```
```

- [ ] **Step 6: 감시 루프(「2-2」)에 검사 추가**

루프 블록 머리의 `STOP_FILE=…` 줄 아래에 추가:

```bash
LEASE_FILE='<팀장 체크아웃>/.git/dflow-team.lease-lost'   # git rev-parse --path-format=absolute --git-path dflow-team.lease-lost 의 값
```

`[ -e "$STOP_FILE" ] && { echo STOP_REQUESTED; exit 0; }` 줄 바로 아래에 추가:

```bash
  [ -e "$LEASE_FILE" ] && { echo "LEASE_LOST $(head -n 1 "$LEASE_FILE")"; exit 0; }
```

루프 아래 설명 목록의 종료 파일 항목 뒤에 추가:

```markdown
- lease 상실 표식(`dflow-team.lease-lost`)이 생기면 `LEASE_LOST <사유>` 를 출력하고 끝난다. 종료 요청 다음, 결과보다
  먼저 본다. 이유: 밀려난 팀장이 새로 도착한 결과로 spawn·스윕을 이어 가지 않게 한다.
```

- [ ] **Step 7: 기상 블록(「2-3」) 수정**

1. 블록의 watch 호출 `wr=$(.claude/skills/dflow-work/scripts/dflow.sh watch --agent "$o_who" \` 다음 줄 `--slots <N> --busy <M> --until '<UNTIL_LABEL>' --json)` 를 아래로 바꾼다:

```bash
      --slots <N> --busy <M> --until '<UNTIL_LABEL>' --json \
      --holder "$(.claude/skills/dflow-work/scripts/dflow.sh lease holder)") \
```

2. 같은 블록의 `sed -n '/^## 기록 명령/,$p' …` 줄 **앞**에 추가:

```bash
LB=$(git rev-parse --git-path dflow-team.lease).beat
lb=$(cat "$LB" 2>/dev/null); lb=${lb:-0}
[ $(( $(date +%s) - lb )) -lt 180 ] || echo "LEASE_KEEP_DEAD 마지막 갱신 ${lb}"
```

3. 블록 아래 설명에 추가(`WATCH_FAILED` 문단 뒤):

```markdown
`LEASE_KEEP_DEAD` 는 lease 갱신 프로세스가 3분 넘게 갱신하지 못한 것이다(죽었거나 서버에 닿지 못함). 그 기상에서
`dflow.sh lease renew` 를 한 번 부른다. `LEASE_OK` 면 「1. 시작」 5번의 lease 갱신 블록을 다시 띄운다. `LEASE_LOST`
(exit 4)나 `LEASE_NONE` 이면 「7. 마감」 의 lease 상실 마감으로 간다. 그 밖의 실패는 사유를 보고하고 다음 기상에 다시
본다. 이유: 갱신 프로세스만 죽으면 이 팀장은 살아 있는데 lease 가 3분 뒤 만료돼 다른 곳이 가져갈 수 있다.
```

4. 기상 표의 `| `STALE` | …` 행 **위**에 추가:

```markdown
| `LEASE_LOST <사유>` | 다른 곳이 이 신원+프로젝트의 팀장 lease 를 가져갔거나(`LEASE_LOST <project_id…>`), 서버에 3분 넘게 닿지 못했다(`LEASE_UNREACHABLE`). 「7. 마감」 의 **lease 상실 마감**으로 간다 |
```

- [ ] **Step 8: 「7. 마감」 수정**

1. 머리 문단의 "잠금 상실은 1~6 을 타지 않고 아래 「잠금 상실 마감」 으로 간다." 를 "잠금 상실과 lease 상실은 1~6 을 타지 않고 아래 「잠금 상실 마감」·「lease 상실 마감」 으로 간다." 로 바꾼다.
2. 6번 블록의 `rm -f "$(git rev-parse --git-path dflow-team.stop)"` 줄 **앞**에 추가(소유 판정이 참인 `if` 안):

```bash
     .claude/skills/dflow-work/scripts/dflow.sh lease release || echo "LEASE_RELEASE_FAILED 3분 뒤 스스로 풀린다"
```

6번 설명 끝(`소유가 맞을 때만 지우는 이유는 …` 문단 뒤)에 추가:

```markdown
   lease 는 잠금보다 먼저 반납한다. 반납이 상태 파일을 지우면 lease 갱신 프로세스는 다음 확인(최대 5초)에서
   스스로 끝난다. 반납이 실패해도 마감을 멈추지 않는다. lease 는 TTL(3분) 뒤 스스로 풀린다.
```

3. `**잠금 상실 마감**` 문단 **뒤**에 새 문단을 추가:

```markdown
**lease 상실 마감**(「2-3」 의 `LEASE_LOST`): 다른 곳의 같은 신원 팀장이 이 프로젝트를 넘겨받았다. 이 팀장은 즉시
손을 뗀다.
1. "팀장 lease 상실: <사유>. 이 프로젝트는 다른 곳의 팀장이 맡았다" 를 보고한다.
2. 새 claim·새 spawn·승인 스윕·머지를 하지 않는다. 대기 큐는 보고만 하고 비운다.
3. 떠 있는 poll 을 TaskStop 으로 멈추고, 세대 파일의 세대를 올려 감시 루프를 끝낸다. lease 갱신 프로세스는 이미
   끝나 있다(표식을 쓰고 끝난다).
4. **떠 있는 워커는 건드리지 않는다.** 워커는 하던 작업을 끝까지 하고 agent 브랜치 push 와 done 보고를 한다. 그
   결과는 새 팀장의 승인 스윕이 서버에서 이어받는다. 팀원 pane·탭을 닫지 않고 `kill-server` 도 하지 않는다.
5. 「7. 마감」 6번 블록을 그대로 실행한다: 좌석표 감시 종료, `lease release`, 로컬 잠금 삭제(소유 판정이 참일 때).
   그 블록의 `lease release` 는 남의 lease 를 풀지 않는다. 서버가 holder·generation 이 맞는 행만 풀기 때문에
   빼앗긴 lease 에는 0건으로 끝나고, 서버에 닿지 못해 끝난 경우(`LEASE_UNREACHABLE`)에는 아무도 가져가지 않은 내
   lease 를 바로 풀어 준다. 이유(로컬 잠금 삭제): 같은 체크아웃에서 사람이 나중에 팀장을 다시 띄울 수 있어야 한다.
   표식 파일(`dflow-team.lease-lost`)은 다음 시작의 전제 검사가 지운다.
6. 7번(남은 에이전트 확인)을 그대로 한다.
7. 보고에 남은 슬롯(TSK·id8·워크트리 경로·pane id)과 "워커 N명은 하던 작업을 끝낸 뒤 스스로 끝난다" 를 적는다.
```

- [ ] **Step 9: help.md**

`.claude/skills/dflow-team/references/help.md` 의 인자 설명(표 또는 목록)에 한 줄 추가:

```markdown
| `--takeover` (강제 인수) | 같은 신원이 이 프로젝트의 팀장을 다른 곳에서 돌리고 있을 때 넘겨받는다. 밀려난 팀장은 멈추고, 그 워커는 하던 작업을 끝낸다 |
```

(help.md 가 표가 아니라 목록이면 같은 내용을 목록 꼴로 넣는다.)

- [ ] **Step 10: 통과 확인**

Run: `npx vitest run tests/skills`
Expected: PASS 전체. 특히 `dflow-team-shell-blocks.test.ts`(새 블록의 sh·bash·zsh 문법)와 `dflow-team.test.ts`·`dflow-lead-worktree.test.ts`(기존 블록 슬라이스)가 깨지지 않아야 한다. 기존 테스트가 블록의 정확한 줄을 잘라 쓰다 깨지면, 그 테스트의 기대를 새 줄에 맞춘다(동작 요구를 바꾸지 않는 선에서).

- [ ] **Step 11: 커밋**

```bash
git add .claude/skills/dflow-team/SKILL.md .claude/skills/dflow-team/references/help.md tests/skills/dflow-team-lease.test.ts
git commit -m "feat(dflow-team): 팀장이 시작할 때 lease 를 얻고 잃으면 손을 뗀다

다른 clone·다른 PC 의 같은 신원 팀장은 LEAD_LEASE_HELD 로 시작하지 못한다. --takeover 로
넘겨받으면 밀려난 팀장은 LEASE_LOST 로 멈추고 워커는 하던 작업을 끝낸다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(기존 테스트를 고쳤으면 그 파일도 이름으로 stage 한다.)

---

### Task 6: 웹 — 오피스 lease 표시와 「팀장 해제」

**Files:**
- Modify: `src/lib/domain/authz.ts` (순수 `canReleaseLeadLease`)
- Modify: `src/lib/domain/seatmap.ts` (`LeaseRow`, `SeatmapRows.leases?`, `LeadLease`, `Floor.leads`)
- Modify: `src/lib/data/agentSeatmap.ts` (lease 조회)
- Modify: `src/app/actions/agentSeatmap.ts` (`releaseLeadLease`)
- Modify: `src/components/agents/FloorCard.tsx`, `src/components/agents/SeatmapView.tsx`, `src/components/agents/seatmap.module.css`
- 모델: 이 Task 는 기존 화면·액션 테스트 방식을 읽고 맞춰야 하므로 중간 등급(Sonnet) 이상에 맡긴다.
- Test: `tests/authz/lead-lease-release.test.ts`, `tests/domain/seatmap.test.ts`, `tests/components/agents-seatmap-view.test.tsx`, `tests/actions/agent-seatmap-release-lease.test.ts`

**Interfaces:**
- Consumes: 테이블 `agent_lead_leases`, RPC `lead_lease_force_release(p_user uuid, p_project uuid) → integer`(Task 1).
- Produces:
  - `canReleaseLeadLease(actor: Actor | null, projectId: string, leaseUserId: string): boolean`
  - `LeaseRow { user_id: string; project_id: string; host: string | null; agent: string | null; renewed_at: string | null; expires_at: string }`
  - `LeadLease { userId: string; host: string | null; agent: string | null; renewedAt: string | null; expiresAt: string; mine: boolean; ownerName: string | null; canRelease: boolean }`
  - `Floor.leads: LeadLease[]`
  - `releaseLeadLease(projectId: string, userId: string): Promise<{ ok: true; released: number } | { ok: false; error: string }>`

- [ ] **Step 1: 권한 순수 함수 테스트**

`tests/authz/lead-lease-release.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canReleaseLeadLease, type Actor } from '@/lib/domain/authz'

const P = '11111111-1111-4111-8111-111111111111'
const actor = (userId: string, role: 'admin' | 'member' | null, isSuperuser = false): Actor => ({
  userId, teamCode: null, teamId: null, isSuperuser,
  projectRoles: new Map(role ? [[P, role]] : []), rosterTeams: new Map(),
})

describe('canReleaseLeadLease', () => {
  it('lease 주인 본인(멤버)은 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-1', 'member'), P, 'u-1')).toBe(true))
  it('그 프로젝트 관리자는 남의 것도 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-2', 'admin'), P, 'u-1')).toBe(true))
  it('슈퍼유저는 풀 수 있다', () => expect(canReleaseLeadLease(actor('u-2', null, true), P, 'u-1')).toBe(true))
  it('다른 멤버는 풀 수 없다', () => expect(canReleaseLeadLease(actor('u-2', 'member'), P, 'u-1')).toBe(false))
  it('비멤버는 자기 것이라도 풀 수 없다', () => expect(canReleaseLeadLease(actor('u-1', null), P, 'u-1')).toBe(false))
  it('actor 가 없으면 false', () => expect(canReleaseLeadLease(null, P, 'u-1')).toBe(false))
})
```

`ProjectRole` 의 실제 값 이름(`'admin'`·`'member'`)이 다르면 `src/lib/domain/authz.ts` 의 타입에 맞춘다.

- [ ] **Step 2: 구현**

`src/lib/domain/authz.ts` 의 `isProjectMember` 정의 아래에 추가:

```ts
/**
 * 팀장 lease 강제 해제(오피스 「팀장 해제」) — 그 프로젝트의 멤버이면서 lease 주인 본인이거나, 그 프로젝트 관리자.
 * 서버 액션은 service_role 로 쓰므로 이 판정이 유일한 관문이다. 스펙 2026-09-23-dflow-lead-lease-design.md §7.
 */
export function canReleaseLeadLease(actor: Actor | null, projectId: string, leaseUserId: string): boolean {
  if (!actor || !isProjectMember(actor, projectId)) return false
  return actor.userId === leaseUserId || isProjectAdmin(actor, projectId)
}
```

Run: `npx vitest run tests/authz/lead-lease-release.test.ts` → PASS.

- [ ] **Step 3: 좌석표 도메인 테스트**

`tests/domain/seatmap.test.ts` 에 추가(기존 파일의 행 생성 도우미와 `assembleSeatmap` 호출 방식을 따른다. 층이 생기려면 그 프로젝트의 주문이 하나 있어야 한다):

import 줄에 `type LeaseRow` 를 더하고, 파일 끝에 추가한다. `rows()`·`ago`·`NOW`·`P1` 은 파일 머리의 도우미다. 기본 `rows()` 의 주문은 `claimed_by_user_id: 'u1'` 이라 `mine: u1` 에서도 층이 생긴다.

```ts
describe('층의 팀장 lease', () => {
  const lease = (user_id: string, expInMs: number): LeaseRow => ({
    user_id, project_id: P1, host: user_id === 'u1' ? 'mbp' : 'air', agent: `${user_id}/x/lead`,
    renewed_at: ago(30_000), expires_at: new Date(NOW + expInMs).toISOString(),
  })
  const v = (admin: boolean) => ({ userId: 'u1', memberIds: new Set<string>(), adminProjectIds: new Set<string>(admin ? [P1] : []) })
  it('유효한 lease 를 층에 싣고, 본인·관리자만 canRelease', () => {
    const m = assembleSeatmap(rows({ leases: [lease('u1', 120_000), lease('u9', 120_000)] }), NOW, { viewer: v(false) })
    const by = Object.fromEntries(m.floors[0].leads.map(l => [l.userId, l]))
    expect(by.u1).toMatchObject({ mine: true, canRelease: true, host: 'mbp' })
    expect(by.u9).toMatchObject({ mine: false, canRelease: false, host: 'air' })
    const adm = assembleSeatmap(rows({ leases: [lease('u9', 120_000)] }), NOW, { viewer: v(true) })
    expect(adm.floors[0].leads[0].canRelease).toBe(true)
  })
  it('만료된 lease 는 싣지 않는다', () => {
    const m = assembleSeatmap(rows({ leases: [lease('u1', -1000)] }), NOW, { viewer: v(false) })
    expect(m.floors[0].leads).toEqual([])
  })
  it('viewer 가 없으면 canRelease 는 모두 false(fail-closed)', () => {
    const m = assembleSeatmap(rows({ leases: [lease('u1', 120_000)] }), NOW)
    expect(m.floors[0].leads[0].canRelease).toBe(false)
  })
  it('scope=mine 이어도 남의 lease 를 빼지 않는다 — 팀장 해제 대상은 남의 것이다', () => {
    const m = assembleSeatmap(rows({ leases: [lease('u9', 120_000)] }), NOW,
      { mine: { userId: 'u1', memberIds: new Set(['m1']) }, viewer: v(false) })
    expect(m.floors[0].leads.map(l => l.userId)).toEqual(['u9'])
  })
})
```

`leases` 가 없는 기존 `rows()` 호출은 그대로 두어도 `leads: []` 가 된다(선택 필드).

- [ ] **Step 4: 도메인 구현**

`src/lib/domain/seatmap.ts`:
1. `WatcherRow` 아래에 추가:

```ts
export interface LeaseRow {
  user_id: string; project_id: string; host: string | null; agent: string | null
  renewed_at: string | null; expires_at: string
}
```

2. `SeatmapRows` 에 선택 필드 `leases?: LeaseRow[]` 를 더한다(주석: "팀장 lease(0101). 옛 호출부·시험이 비워 둘 수 있게 선택 필드다").
3. `Watcher` 아래에 추가:

```ts
/** 팀장 lease(0101) — 신원+프로젝트당 팀장 하나. 오피스 층 머리에 보이고 「팀장 해제」의 대상이다. */
export interface LeadLease {
  userId: string; host: string | null; agent: string | null; renewedAt: string | null; expiresAt: string
  mine: boolean; ownerName: string | null
  /** 본인 lease 이거나 이 층 관리자. 서버 액션이 같은 판정(canReleaseLeadLease)을 다시 한다. */
  canRelease: boolean
}
```

4. `Floor` 에 `leads: LeadLease[]` 를 더한다.
5. `assembleSeatmap` 에서 `aliveWatchers` 계산 뒤에 추가:

```ts
  // lease 는 mine 필터로 거르지 않는다 — 「팀장 해제」는 남의 lease(다른 PC 에 남은 내 신원, 또는 관리자가 보는 남의 것)가 대상이다.
  const liveLeases = (rows.leases ?? []).filter(l => Date.parse(l.expires_at) > nowMs)
  const leadsOf = (pid: string): LeadLease[] => liveLeases
    .filter(l => l.project_id === pid)
    .map(l => {
      const owner = ownerOf(l.user_id, viewerId, ownerName(l.project_id))
      const canRelease = !!viewer?.userId && (viewer.userId === l.user_id || viewer.adminProjectIds.has(pid))
      return { userId: l.user_id, host: l.host, agent: l.agent, renewedAt: l.renewed_at, expiresAt: l.expires_at, mine: owner.mine, ownerName: owner.name, canRelease }
    })
    .sort((a, b) => (a.agent ?? '').localeCompare(b.agent ?? ''))
```

(`viewer`·`viewerId`·`ownerName` 은 함수 안에 이미 있는 이름을 쓴다. 이름이 다르면 그 이름에 맞춘다.) 층 생성 객체에 `leads: leadsOf(id),` 를 더한다.
6. `Floor` 를 만드는 다른 곳(허브 등)이 있으면 `leads: []` 를 채워 타입 오류를 없앤다(`npx tsc --noEmit` 로 찾는다).

- [ ] **Step 5: 데이터 조회**

`src/lib/data/agentSeatmap.ts` 의 `fetchSeatmapRows`:
1. import 에 `LeaseRow` 를 더한다.
2. `Promise.all` 배열 끝에 추가하고 구조 분해에 `leases` 를 더한다:

```ts
    (() => {
      let lq = admin.from('agent_lead_leases').select('user_id, project_id, host, agent, renewed_at, expires_at')
        .not('holder', 'is', null).gt('expires_at', new Date(nowMs).toISOString()).in('project_id', projIds)
      return lq.then(r => must<LeaseRow[]>('팀장 lease', r))
    })(),
```

(`let` 이 필요 없으면 `const` 로. 조회 실패는 `must` 가 throw 한다 — 좌석표 전체가 실패로 보인다. 조회 실패를 lease 없음으로 위장하지 않는다.)
3. 반환 객체에 `leases` 를 더한다.

- [ ] **Step 6: 서버 액션 테스트와 구현**

`tests/actions/agent-seatmap-release-lease.test.ts` — 기존 `tests/actions/` 의 서버 액션 테스트가 `@/lib/authz`·`@/lib/supabase/admin` 을 목으로 두는 방식을 따른다(파일 하나를 열어 그 방식을 그대로 쓴다). 사례:
- 형식이 틀린 uuid → `{ ok: false }`, RPC 호출 없음.
- `requireProjectMember` 가 거부 → `{ ok: false, error: '권한이 없습니다.' }`, RPC 호출 없음.
- 멤버지만 주인도 관리자도 아님 → 거부, RPC 호출 없음.
- 본인 → `lead_lease_force_release` 를 `{ p_user, p_project }` 로 부르고 `{ ok: true, released: 1 }`.
- RPC 오류 → `{ ok: false, error: '팀장 해제에 실패했습니다.' }` + `console.error`.

`src/app/actions/agentSeatmap.ts` 에 추가:

```ts
import { requireProjectMember } from '@/lib/authz'
import { canReleaseLeadLease } from '@/lib/domain/authz'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * 오피스 「팀장 해제」 — 그 (신원, 프로젝트)의 팀장 lease 를 풀고 generation 을 올린다(0101 lead_lease_force_release).
 * 밀려난 팀장은 다음 갱신(최대 60초)에서 LEASE_LOST 로 멈춘다. service_role 로 쓰므로 여기 가드가 유일한 관문이다.
 */
export async function releaseLeadLease(projectId: string, userId: string): Promise<{ ok: true; released: number } | { ok: false; error: string }> {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId) || typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return { ok: false, error: '값이 잘못됐습니다.' }
  }
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: '권한이 없습니다.' }
  if (!canReleaseLeadLease(g.actor, projectId, userId)) return { ok: false, error: '권한이 없습니다.' }
  const { data, error } = await createAdminClient().rpc('lead_lease_force_release', { p_user: userId, p_project: projectId })
  if (error) {
    console.error('[seatmap] 팀장 해제 실패:', error.message)
    return { ok: false, error: '팀장 해제에 실패했습니다.' }
  }
  return { ok: true, released: typeof data === 'number' ? data : 0 }
}
```

(`requireProjectMember` 의 반환 타입 `GuardResult` 가 `{ ok: true; actor } | { ok: false; error }` 인지 확인하고 맞춘다. 이미 있는 import 는 합친다.)

Run: `npx vitest run tests/actions/agent-seatmap-release-lease.test.ts` → PASS.

- [ ] **Step 7: 화면**

`src/components/agents/FloorCard.tsx`:
1. props 에 `onReleaseLead?: (projectId: string, userId: string) => Promise<void>` 를 더한다.
2. `<header className={css.floorHead}>` 안, 감시 표시 `<span className={css.watch} …>` **뒤**에 추가:

```tsx
        {floor.leads.map(l => (
          <LeadChip key={l.userId} lead={l} onRelease={onReleaseLead ? () => onReleaseLead(floor.id, l.userId) : undefined} />
        ))}
```

3. 같은 파일 아래에 컴포넌트 추가 — 두 단계 확인(브라우저 대화상자 `confirm` 을 쓰지 않는다. E2E 자동화가 대화상자에 막힌다):

```tsx
function LeadChip({ lead, onRelease }: { lead: import('@/lib/domain/seatmap').LeadLease; onRelease?: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const who = lead.mine ? '내 팀장' : `${lead.ownerName ?? '다른 계정'} 팀장`
  const at = lead.renewedAt ? new Date(lead.renewedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'
  return (
    <span className={css.lead} data-lead={lead.userId} title={`${lead.agent ?? ''} · 갱신 ${at}`}>
      {who} · {lead.host ?? '-'} · 갱신 {at}
      {lead.canRelease && onRelease && !confirming && (
        <button type="button" className={css.leadRelease} disabled={busy} onClick={() => setConfirming(true)}>팀장 해제</button>
      )}
      {confirming && (
        <>
          <button type="button" className={css.leadRelease} data-lead-confirm disabled={busy}
            onClick={async () => { setBusy(true); try { await onRelease?.() } finally { setBusy(false); setConfirming(false) } }}>
            정말 해제
          </button>
          <button type="button" className={css.leadRelease} disabled={busy} onClick={() => setConfirming(false)}>취소</button>
        </>
      )}
    </span>
  )
}
```

4. `SeatmapView.tsx` 에서 `FloorCard` 를 그리는 곳에 `onReleaseLead` 를 넘긴다. 처리: `releaseLeadLease(projectId, userId)` 를 부르고, 실패면 기존 op 오류 표시 방식(이 파일이 `runHubProcessOp` 결과를 보여 주는 방식)으로 오류를 보이고, 성공이면 좌석표를 다시 읽는다(이 파일의 기존 재조회 함수).
5. `seatmap.module.css` 에 `.lead`(감시 표시 `.watch` 와 같은 크기의 칩)와 `.leadRelease`(작은 텍스트 버튼) 규칙을 더한다. 기존 토큰 변수만 쓴다. **상태 변형 display 유틸(`group-hover:flex` 등)을 쓰지 않는다**(CLAUDE.md 반응형 안전망).

`tests/components/agents-seatmap-view.test.tsx` 에 추가(기존 렌더 도우미를 쓴다):
- `canRelease=true` 인 lease 가 있는 층: 「팀장 해제」 → 「정말 해제」 를 누르면 `releaseLeadLease` 목이 `(floorId, userId)` 로 불린다.
- `canRelease=false` 면 「팀장 해제」 버튼이 없다.

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run tests/authz tests/domain/seatmap.test.ts tests/components tests/actions && npx tsc --noEmit -p . && npm run lint`
Expected: PASS, 타입 오류 0, lint 오류 0.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/domain/authz.ts src/lib/domain/seatmap.ts src/lib/data/agentSeatmap.ts src/app/actions/agentSeatmap.ts src/components/agents/FloorCard.tsx src/components/agents/SeatmapView.tsx src/components/agents/seatmap.module.css tests/authz/lead-lease-release.test.ts tests/domain/seatmap.test.ts tests/components/agents-seatmap-view.test.tsx tests/actions/agent-seatmap-release-lease.test.ts
git commit -m "feat(agents): 오피스 층에 팀장 lease 를 보이고 「팀장 해제」로 풀 수 있게 한다

팀장이 비정상으로 남아 같은 신원이 다른 곳에서 시작하지 못할 때 사람이 웹에서 푼다.
본인 lease 이거나 그 프로젝트 관리자만 풀 수 있다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(tsc 가 가리킨 `leads: []` 보완 파일도 이름으로 stage 한다.)

---

### Task 7: 통합·스테이징 리허설·반영 (컨트롤러가 직접)

- [ ] **Step 1: 전체 검증**

Run: `npx vitest run 2>&1 | tail -5 && npx tsc --noEmit -p . && npm run lint`
Expected: 실패 0.

- [ ] **Step 2: 스테이징 DB 적용과 동작 검증**

`staging:sync` 는 돌리지 않는다. 판단: 0101 은 새 테이블·함수만 만들고 기존 데이터에 기대지 않는다. sync 는 스테이징 데이터를 운영 데이터로 덮어 병렬 세션의 검증 데이터를 지운다. 이 판단을 원장에 `Ruling:` 으로 남긴다.

```bash
npm run db:apply -- supabase/migrations/0101_agent_lead_leases.sql --target staging
npm run db:apply -- scripts/checks/0101_lead_lease_check.sql --target staging
```

Expected: 첫 명령 성공. 둘째 명령은 `LEAD_LEASE_CHECK_OK` 알림 또는 오류 없이 끝나고(assert 실패면 예외 메시지로 멈춘다), 롤백되어 행이 남지 않는다. 확인: `npm run db:apply -- <(echo "select count(*) from agent_lead_leases") --target staging` 이 파일 인자를 받지 못하면, 한 줄 SQL 을 스크래치 파일로 써서 넘긴다. 기대 0.

- [ ] **Step 3: 스테이징 검증 트레일러**

```bash
git commit --allow-empty -m "chore: 0101 스테이징 리허설 통과를 기록한다" \
  --trailer "Staging-verified: $(date +%F) db 리허설 통과" \
  --trailer "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: staging 반영**

```bash
cd /Users/jji/project/wbs-web && git fetch -q origin
cd .claude/worktrees/dflow-lead-lease && git merge -q origin/main && git merge -q origin/staging   # back-merge(병렬 세션 몫 포함)
npx vitest run tests/skills tests/agent 2>&1 | tail -3
git push origin HEAD:staging
```

Expected: fast-forward 또는 머지 커밋으로 push 성공. force push 금지.

- [ ] **Step 5: 스테이징 실동작 확인**

스테이징 URL 배포가 끝난 뒤(메인 체크아웃의 `.dflow.local` 이 스테이징 base 를 쓴다):
1. 메인 체크아웃에서 `.claude/skills/dflow-work/scripts/dflow.sh lease acquire` → `LEASE_OK 1`.
2. `dflow.sh lease holder` 값을 기록하고, 다른 경로의 clone 을 흉내 내 `DFLOW_MACHINE_ID_FILE=$(mktemp) dflow.sh lease acquire` → exit 4 + `LEAD_LEASE_HELD …`.
3. ego-browser 로 스테이징 오피스(`/p/<project>/agents/office`)를 열어 층 머리에 lease 칩이 보이는지, 「팀장 해제」→「정말 해제」 뒤 칩이 사라지는지 본다(주문이 있는 층이어야 칩이 보인다).
4. 해제 뒤 `dflow.sh lease renew` → exit 4 `LEASE_LOST …`. 마지막으로 `dflow.sh lease release` → `LEASE_NONE`(상태 파일 정리).

- [ ] **Step 6: 정리**

워크트리를 지우고(`git worktree remove .claude/worktrees/dflow-lead-lease`), 브랜치 `feat/dflow-lead-lease` 를 지운다(staging 에 포함됨을 `git branch --merged origin/staging` 으로 확인한 뒤). 메모리 `dflow-config-migration.md` 의 과제 B 줄을 "staging <sha> 반영, 운영은 DB(0101) 먼저 → main, 그 뒤 킷 재빌드" 로 고친다.
