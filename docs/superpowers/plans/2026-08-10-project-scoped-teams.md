# 프로젝트별 팀 + 역할 라벨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 프로젝트가 독자적인 팀 목록을 정의하고(미정의 시 전역 팀 폴백), 멤버 명단에 자유 입력 역할 라벨을 부여한다. 스펙: `docs/superpowers/specs/2026-08-10-project-scoped-teams-design.md`.

**Architecture:** `teams.project_id`(null=전역) 한 컬럼으로 스코프를 표현한다. 기존 무인자 접근자(`teamsSync` 계열)는 전역 행 전용으로 고정해 회의록·또박또박·계정 등 30여 호출처를 무수정 보호하고, 프로젝트 화면에는 신규 `teamsForProjectSync(projectId)`(프로젝트 행 있으면 그것만·없으면 전역 폴백)와 `/p/[projectId]/layout.tsx`의 TeamsProvider 중첩 주입으로 공급한다. WBS 실적 편집 권한은 기존 판정에 명단 팀(project_members.team_id)을 **합집합으로 추가만** 한다(D-CUBE 회귀 0).

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17, RLS), vitest.

## Global Constraints

- **G1**: 마이그레이션(`supabase/migrations/*`)과 코드는 **다른 커밋**. `git add`는 항상 파일명 명시(`-A` 금지). 커밋 메시지는 한국어, "왜" 중심.
- **UI 위험 파일 무접촉**: `src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*` 는 이 계획에서 **수정하지 않는다**. `TeamsProvider.tsx`도 수정 금지 — 프로젝트 레이아웃에서 중첩 주입만 한다. (전부 main 직행 가능 조건)
- **운영 D-CUBE 데이터 무접촉**. 로컬 dev도 프로덕션 Supabase를 공유한다. 쓰기 검증은 전용 테스트 프로젝트에서만.
- 마이그레이션 적용은 **Supabase Management API** 경유(키체인 "Supabase CLI" 토큰 go-keyring-base64 디코드 → `/database/query`). `supabase db push` 금지.
- `TeamCode`는 `string` 유지(컴파일 타임 유니언 금지 — `src/lib/domain/types.ts:3-4`).
- **봉쇄 지점 계약**: `teamsSync()`/`activeTeamCodesSync()`/`isRegisteredTeamCode()`/`isActiveTeamCode()`는 전역(`projectId === null`) 행만 반환한다. 프로젝트 팀이 회의록·또박또박 API·계정 관리에 새면 안 된다.
- 팀 쓰기 액션은 저장 후 반드시 `await refreshTeams()` (캐시 TTL 60초 관례).
- 로컬 `npm run build`가 `_workspace` 스크래치 ts 3개로 실패하면 해당 파일을 `*.buildskip`로 개명 후 빌드, 끝나면 원복.
- 상태 변형 display 유틸(`group-hover:flex` 등) 금지 — 반응형 안전망이 이긴다.

---

### Task 1: 마이그레이션 0071 + 롤백 + 마이그레이션 테스트

**Files:**
- Create: `supabase/migrations/0071_project_teams.sql`
- Create: `supabase/migrations/0071_project_teams_rollback.sql`
- Test: `tests/migrations/project-teams.test.ts`

**Interfaces:**
- Produces (DB): `teams.project_id uuid null`, `teams_project_code_key unique nulls not distinct (project_id, code)`, `project_members.role_label text`, RLS `pa_insert_project_teams`/`pa_update_project_teams`, 합집합 `member_update_actual`·`can_attach()`, 스코프 해석 `import_wbs`/`replace_wbs`, 7-인자 `update_project_member_with_identity(..., p_role_label text default null)`
- 번호 주의: 리포에 0070이 두 벌 있는 것은 사전 존재 이슈(범위 밖). 이 파일은 0071. 작성 전 `ls supabase/migrations | sort | tail`로 0071이 비어 있는지 확인하고, 선점됐으면 다음 번호를 쓰되 파일 내 참조도 함께 바꾼다.

- [ ] **Step 1: 마이그레이션 테스트 작성 (실패 확인용)**

`tests/migrations/project-teams.test.ts` — 기존 관례(`tests/migrations/*.test.ts`는 SQL 파일 텍스트를 읽어 불변식을 검사한다. `import-wbs-owner-split.test.ts` 참조):

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIG = readFileSync(join(process.cwd(), 'supabase/migrations/0071_project_teams.sql'), 'utf8')
const ROLLBACK = readFileSync(join(process.cwd(), 'supabase/migrations/0071_project_teams_rollback.sql'), 'utf8')

describe('0071 project teams', () => {
  it('teams.project_id 컬럼과 프로젝트 인덱스를 추가한다', () => {
    expect(MIG).toMatch(/alter table public\.teams add column if not exists project_id uuid references public\.projects\(id\) on delete cascade/)
    expect(MIG).toMatch(/create index if not exists idx_teams_project on public\.teams\(project_id\)/)
  })
  it('코드 유니크를 (project_id, code) nulls not distinct 로 교체하고 위키 FK 2건을 선행 제거한다', () => {
    expect(MIG).toMatch(/wiki_topics drop constraint if exists wiki_topics_owner_team_fkey/)
    expect(MIG).toMatch(/wiki_items drop constraint if exists wiki_items_owner_team_fkey/)
    expect(MIG).toMatch(/teams drop constraint if exists teams_code_key/)
    expect(MIG).toMatch(/unique nulls not distinct \(project_id, code\)/)
    // 위키 FK drop 이 teams_code_key drop 보다 먼저여야 한다(의존 객체 에러 방지)
    expect(MIG.indexOf('wiki_topics_owner_team_fkey')).toBeLessThan(MIG.indexOf('teams_code_key'))
  })
  it('프로젝트 행 한정 관리자 쓰기 RLS 를 추가한다(전역 행은 su_* 유지)', () => {
    expect(MIG).toMatch(/create policy pa_insert_project_teams on public\.teams for insert to authenticated/)
    expect(MIG).toMatch(/create policy pa_update_project_teams on public\.teams for update to authenticated/)
    // 두 정책 모두 project_id is not null 과 is_project_admin 을 요구
    const pa = MIG.slice(MIG.indexOf('pa_insert_project_teams'))
    expect(pa).toMatch(/project_id is not null and public\.is_project_admin\(project_id\)/)
  })
  it('member_update_actual 과 can_attach 가 명단 팀 합집합을 갖는다(기존 memberships 판정 유지)', () => {
    // 합집합 = 기존 memberships 서브쿼리 + project_members 서브쿼리 (빼기 없음 — D-CUBE 회귀 0)
    const policy = MIG.slice(MIG.indexOf('create policy member_update_actual'))
    expect(policy).toMatch(/select m\.team_id from memberships m where m\.user_id = auth\.uid\(\)/)
    expect(policy).toMatch(/from project_members pm[\s\S]*?pm\.project_id = wbs_items\.project_id[\s\S]*?pm\.user_id = auth\.uid\(\)[\s\S]*?pm\.team_id is not null/)
    const attach = MIG.slice(MIG.indexOf('create or replace function public.can_attach'))
    expect(attach).toMatch(/public\.project_members pm[\s\S]*?pm\.project_id = w\.project_id/)
  })
  it('임포트 RPC 팀 해석이 프로젝트 우선·전역 폴백 스코프다', () => {
    for (const fn of ['function import_wbs', 'function public.replace_wbs']) {
      const body = MIG.slice(MIG.indexOf(fn))
      expect(body).toMatch(/where code = v_owner->>'team'\s+and \(project_id = p_project_id or project_id is null\)\s+order by \(project_id is not null\) desc\s+limit 1/)
    }
  })
  it('role_label 컬럼과 7-인자 update_project_member_with_identity 를 추가한다', () => {
    expect(MIG).toMatch(/alter table public\.project_members add column if not exists role_label text/)
    expect(MIG).toMatch(/drop function if exists public\.update_project_member_with_identity\(\s*uuid, text, text, uuid, text, text\s*\)/)
    expect(MIG).toMatch(/p_role_label text default null/)
    expect(MIG).toMatch(/role_label = p_role_label/)
  })
  it('롤백 파일이 존재하고 프로젝트 팀 행 선행 삭제 전제를 명시한다', () => {
    expect(ROLLBACK).toMatch(/코드 롤백 선배포/)
    expect(ROLLBACK).toMatch(/project_id is not null/) // 잔존 프로젝트 팀 행 처리
    expect(ROLLBACK).toMatch(/teams_code_key/)         // 전역 유니크 원복
    expect(ROLLBACK).toMatch(/wiki_topics[\s\S]*references public\.teams\(code\)/) // 위키 FK 재추가
  })
})
```

- [ ] **Step 2: 테스트 실행 — 파일 부재로 실패 확인**

Run: `npx vitest run tests/migrations/project-teams.test.ts`
Expected: FAIL (ENOENT — 마이그레이션 파일 없음)

- [ ] **Step 3: 마이그레이션 본문 작성**

`supabase/migrations/0071_project_teams.sql`:

```sql
-- 프로젝트별 팀(스펙 2026-08-10-project-scoped-teams-design.md).
-- teams.project_id null=전역(현행 5팀 무접촉), 값=프로젝트 전용. 프로젝트 화면의 팀 목록은
-- 앱 계층이 "프로젝트 행 있으면 그것만, 없으면 전역 폴백"으로 해석한다(D-CUBE 데이터 이동 0건).
--
-- 위키 FK 2건 제거는 사용자 승인(2026-08-10) — 팀 개명 액션이 없고(on update cascade 발동 불가)
-- 삭제 정책도 없어(on delete set null 발동 불가) 실질 무동작이다. 위키 기능·데이터 무변경.
--
-- 적용 순서: 이 마이그레이션 먼저, 앱 코드 배포는 뒤(전부 가산적·하위호환 —
-- update_project_member_with_identity 의 새 인자는 default null 이라 구 앱의 6-인자 호출도 성립).
-- 롤백: 앱을 먼저 되돌린 뒤 0071_project_teams_rollback.sql.
begin;
set search_path = public, extensions;

-- ── 1) 스코프 컬럼 + 인덱스 ─────────────────────────────────────────────
alter table public.teams add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists idx_teams_project on public.teams(project_id);
-- getActor 의 rosterTeams 조회와 아래 RLS 합집합 서브쿼리가 user_id 단독 탐색을 한다.
-- 0019 의 (project_id,user_id) 부분 유니크는 선두 컬럼이 달라 이 탐색을 받치지 못한다.
create index if not exists idx_project_members_user on public.project_members(user_id) where user_id is not null;

-- ── 2) 코드 유니크 재편 — 위키 무동작 FK 선행 제거(의존 객체) 후 복합 유니크 ──
-- 제약 실명은 적용 직전 프로덕션에서 확인한다(Task 2 Step 1). if exists 로 방어하되,
-- 실명이 다르면 "조용히 건너뛴 채 복합 유니크 추가"가 되므로 Task 2 의 사후 검증 쿼리가 최종 관문이다.
alter table public.wiki_topics drop constraint if exists wiki_topics_owner_team_fkey;
alter table public.wiki_items  drop constraint if exists wiki_items_owner_team_fkey;
alter table public.teams drop constraint if exists teams_code_key;
-- PG17: nulls not distinct 로 전역(null)끼리의 code 중복도 계속 차단한다.
alter table public.teams add constraint teams_project_code_key unique nulls not distinct (project_id, code);

-- ── 3) RLS — 프로젝트 행은 그 프로젝트 관리자가 쓴다. 전역 행은 su_*(0053) 그대로. ──
-- delete 정책은 계속 없음(비활성화=삭제, 0044 관례).
drop policy if exists pa_insert_project_teams on public.teams;
create policy pa_insert_project_teams on public.teams for insert to authenticated
  with check (project_id is not null and public.is_project_admin(project_id));
drop policy if exists pa_update_project_teams on public.teams;
create policy pa_update_project_teams on public.teams for update to authenticated
  using      (project_id is not null and public.is_project_admin(project_id))
  with check (project_id is not null and public.is_project_admin(project_id));

-- ── 4) 명단 역할 라벨(자유 입력, 표시용 — 권한 아님) ─────────────────────
alter table public.project_members add column if not exists role_label text;

-- ── 5) member_update_actual — '내 팀' 합집합(계정 전역 팀 ∪ 그 프로젝트 명단 팀) ──
-- 0053:79-93 의 판정에 project_members 경로를 **추가만** 한다. 기존 memberships 경로를
-- 빼면 D-CUBE(명단 팀 미배정 상태)가 회귀한다.
drop policy if exists member_update_actual on wbs_items;
create policy member_update_actual on wbs_items for update to authenticated
  using (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and (o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
                     or o.team_id in (select pm.team_id from project_members pm
                                       where pm.project_id = wbs_items.project_id
                                         and pm.user_id = auth.uid()
                                         and pm.team_id is not null)))
  )
  with check (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and (o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
                     or o.team_id in (select pm.team_id from project_members pm
                                       where pm.project_id = wbs_items.project_id
                                         and pm.user_id = auth.uid()
                                         and pm.team_id is not null)))
  );

-- ── 6) can_attach — 동일 합집합(0053:254-270 원문에서 팀 매치만 확장) ──────
create or replace function public.can_attach(item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wbs_items w
     where w.id = item
       and (
         public.is_project_admin(w.project_id)
         or (
           public.is_project_member(w.project_id)
           and exists (select 1 from public.item_owners o
                        where o.wbs_item_id = item
                          and (o.team_id = (select m.team_id from public.memberships m
                                             where m.user_id = auth.uid())
                            or o.team_id in (select pm.team_id from public.project_members pm
                                              where pm.project_id = w.project_id
                                                and pm.user_id = auth.uid()
                                                and pm.team_id is not null)))
         )
       )
  )
$$;

-- ── 7) 임포트 RPC 팀 해석 스코프 — 복합 유니크로 동명 2행이 가능해져 필수 ──
-- import_wbs 는 0060 본문 전체를, replace_wbs 는 0061 본문 전체를 그대로 복사하되
-- 팀 해석 한 줄만 아래로 교체한다(각 1곳):
--   [기존]  select id into v_team from teams where code = v_owner->>'team';
--   [교체]  select id into v_team from teams
--            where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
--            order by (project_id is not null) desc limit 1;
-- (프로젝트 행 우선, 없으면 전역 — 앱 계층 teamsForProject 와 같은 규칙)
create or replace function import_wbs( ... 0060 전문 복사 + 위 한 줄 교체 ... ) $$;
create or replace function public.replace_wbs( ... 0061 전문 복사 + 위 한 줄 교체 ... ) $$;

-- ── 8) update_project_member_with_identity — p_role_label 추가 ────────────
-- 시그니처가 바뀌므로 create or replace 가 아니라 구버전 drop 후 신설(오버로드가 남으면
-- PostgREST 의 6-인자 named-args 호출이 모호해져 기존 앱까지 깨진다).
drop function if exists public.update_project_member_with_identity(uuid, text, text, uuid, text, text);
create or replace function public.update_project_member_with_identity(
  p_member_id uuid,
  p_name text,
  p_email text,
  p_team_id uuid,
  p_role text,
  p_title text,
  p_role_label text default null
) ...
-- 본문은 0070_project_member_email_identity.sql:213-319 전문 복사 + 마지막 UPDATE 한 곳 수정:
--   update public.project_members
--      set name = v_name, email = v_email, team_id = p_team_id,
--          role = p_role, title = p_title,
--          role_label = nullif(pg_catalog.btrim(p_role_label), '')
--    where id = p_member_id;
-- revoke/grant 도 0070과 동일하게 재선언하되 7-인자 시그니처로:
revoke all on function public.update_project_member_with_identity(uuid, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.update_project_member_with_identity(uuid, text, text, uuid, text, text, text) to authenticated;

reset search_path;
commit;
```

⚠️ 위 7)·8)의 `...` 는 **이 계획서에서의 표기**일 뿐이다 — 실제 파일에는 0060·0061·0070의 함수 전문을 복사해 넣고 명시된 줄만 교체한다. 완성 후 `grep -c 'create or replace function' 0071...` = 4 (import_wbs, replace_wbs, can_attach, update_project_member_with_identity).

- [ ] **Step 4: 롤백 파일 작성**

`supabase/migrations/0071_project_teams_rollback.sql`:

```sql
-- 0071 롤백. 순서: 앱 코드 롤백 선배포 → 이 파일 적용(0044 관례).
-- ⚠️ 전제: 프로젝트 팀 행(project_id is not null)이 남아 있으면 teams_code_key 재추가가
-- 동명 충돌로 실패할 수 있다 — 아래 delete 가 프로젝트 팀 행을 제거한다(전역 행 무접촉).
-- item_owners 등이 프로젝트 팀 행을 참조 중이면 FK(on delete cascade)로 함께 지워진다:
-- 롤백은 프로젝트 팀 기능 전체의 철회이므로 의도된 동작이다.
begin;
set search_path = public, extensions;

-- 정책·함수 원복
drop policy if exists pa_insert_project_teams on public.teams;
drop policy if exists pa_update_project_teams on public.teams;

-- member_update_actual: 0053_project_scoped_rls.sql:79-93 원문 그대로 재생성
drop policy if exists member_update_actual on wbs_items;
create policy member_update_actual on wbs_items for update to authenticated
  using ( ... 0053:80-86 원문 ... )
  with check ( ... 0053:87-93 원문 ... );

-- can_attach: 0053:254-270 원문 그대로 재생성
create or replace function public.can_attach(item uuid) ... 0053 원문 ...;

-- import_wbs / replace_wbs: 0060 / 0061 원문 그대로 재생성
create or replace function import_wbs(...) ... 0060 원문 ...;
create or replace function public.replace_wbs(...) ... 0061 원문 ...;

-- update_project_member_with_identity: 7-인자 drop 후 0070:201-327 원문(6-인자) 재생성
drop function if exists public.update_project_member_with_identity(uuid, text, text, uuid, text, text, text);
create or replace function public.update_project_member_with_identity(...) ... 0070 원문 + revoke/grant ...;

-- 컬럼·제약 원복 — 프로젝트 팀 행 제거 후 전역 유니크 복원, 위키 FK 재추가
delete from public.teams where project_id is not null;
alter table public.teams drop constraint if exists teams_project_code_key;
alter table public.teams add constraint teams_code_key unique (code);
alter table public.wiki_topics
  add constraint wiki_topics_owner_team_fkey foreign key (owner_team)
  references public.teams(code) on update cascade on delete set null;
alter table public.wiki_items
  add constraint wiki_items_owner_team_fkey foreign key (owner_team)
  references public.teams(code) on update cascade on delete set null;
drop index if exists idx_teams_project;
drop index if exists idx_project_members_user;
alter table public.teams drop column if exists project_id;
alter table public.project_members drop column if exists role_label;

reset search_path;
commit;
```

(`...` 표기는 여기서도 마찬가지 — 원문 전문을 복사한다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/migrations/project-teams.test.ts`
Expected: PASS. 이어서 `npx vitest run tests/migrations/` 전체도 PASS(migration-ledger 등 기존 불변식 확인 — 실패하면 그 테스트가 요구하는 원장 갱신을 따른다).

- [ ] **Step 6: 커밋 (마이그레이션 단독 — G1)**

```bash
git add supabase/migrations/0071_project_teams.sql supabase/migrations/0071_project_teams_rollback.sql tests/migrations/project-teams.test.ts
git commit -m "migration(0071): 프로젝트별 팀 — teams.project_id·복합 유니크·권한 합집합·role_label"
```
(테스트 파일은 코드가 아니라 마이그레이션의 불변식 검사라 같은 커밋이 관례 — tests/migrations 기존 커밋들과 동일. pre-push G1은 src/ 혼입만 막는다.)

---

### Task 2: 프로덕션 적용(Management API) + 사후 검증

**Files:** 없음(DB 작업). 실명 불일치 발견 시 Task 1 파일 수정 후 재커밋.

**Interfaces:**
- Consumes: Task 1 의 SQL 파일
- Produces: 프로덕션 DB에 0071 적용 완료 상태(이후 모든 코드 태스크의 전제 — **로컬 dev도 프로덕션 DB를 공유하므로 코드 작업 전에 반드시 적용**)

- [ ] **Step 1: 제약 실명 사전 확인**

Management API(`supabase-mgmt-api-recipe` 메모리의 레시피: 키체인 "Supabase CLI" 토큰 → `POST /v1/projects/rglfgrwwwwdqejohdnty/database/query`)로:

```sql
select conname, conrelid::regclass from pg_constraint
 where conname in ('teams_code_key','wiki_topics_owner_team_fkey','wiki_items_owner_team_fkey');
```

Expected: 3행. 이름이 다르면 0071 파일의 drop 대상 이름을 실명으로 고치고 재커밋(적용 전 파일 수정이 옳다 — 0061 선례).

- [ ] **Step 2: 드라이런** — `begin; ... rollback;`으로 0071 전문을 감싸 실행해 에러 없음을 확인(authz-three-tier 메모리의 드라이런 레시피).

- [ ] **Step 3: 본적용** — 0071 전문 실행.

- [ ] **Step 4: 사후 검증 쿼리**

```sql
-- 컬럼·제약
select count(*) from information_schema.columns where table_name='teams' and column_name='project_id';          -- 1
select count(*) from information_schema.columns where table_name='project_members' and column_name='role_label'; -- 1
select conname from pg_constraint where conrelid='public.teams'::regclass and contype='u';                      -- teams_project_code_key 만
-- 정책
select policyname from pg_policies where tablename='teams';        -- read_all_teams, su_insert_teams, su_update_teams, pa_insert_project_teams, pa_update_project_teams
select count(*) from pg_policies where tablename='wbs_items' and policyname='member_update_actual';             -- 1
-- 함수 시그니처
select proname, pronargs from pg_proc where proname='update_project_member_with_identity';                      -- 1행, pronargs=7
-- 기존 데이터 무접촉
select count(*) from teams where project_id is not null;                                                        -- 0
```

- [ ] **Step 5: 기존 화면 즉시 회귀 확인** — 프로덕션 D'Flow에서 WBS 화면·멤버 명단이 정상 로드되는지 확인(구 코드 + 신 DB 공존 구간). 멤버 수정 1건을 테스트 프로젝트에서 실행해 6-인자 호출이 여전히 성립하는지 본다(default 인자 하위호환 검증). **D-CUBE에는 쓰지 않는다.**

---

### Task 3: 도메인 순수 계층 + master.ts 접근자

**Files:**
- Modify: `src/lib/domain/teams.ts`
- Modify: `src/lib/teams/master.ts`
- Test: `tests/domain/teams-scope.test.ts` (신규)

**Interfaces:**
- Produces:
  - `Team` 인터페이스에 `projectId: string | null` 추가
  - `resolveTeamsForProject(all: readonly Team[], projectId: string): Team[]` (순수 — 폴백 규칙의 단일 정의)
  - master.ts: `teamsForProjectSync(projectId: string): readonly Team[]`, `projectTeamRowsSync(projectId: string): readonly Team[]`(폴백 없는 프로젝트 행 원본 — 설정 화면의 "상속 중" 판정용), `activeTeamCodesForProjectSync(projectId: string): TeamCode[]`, `isActiveTeamCodeForProject(code: string, projectId: string): boolean`, `isRegisteredTeamCodeForProject(code: string, projectId: string): boolean`
  - 기존 `teamsSync()` 계열은 **전역 행만** 반환(시그니처 무변경 — 호출처 30여 곳 무수정)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/teams-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveTeamsForProject, type Team } from '@/lib/domain/teams'

const team = (code: string, projectId: string | null, active = true): Team =>
  ({ id: `id-${code}-${projectId ?? 'g'}`, code, sortOrder: 0, active, progressVisible: true, projectId })

describe('resolveTeamsForProject — 프로젝트 행 있으면 그것만, 없으면 전역 폴백', () => {
  const globals = [team('PMO', null), team('ERP', null)]
  it('프로젝트 팀이 없으면 전역 팀을 반환한다(D-CUBE 현행 유지)', () => {
    expect(resolveTeamsForProject(globals, 'p1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('프로젝트 팀이 있으면 그것만 반환한다(전역 혼입 없음)', () => {
    const all = [...globals, team('개발', 'p1'), team('QA', 'p1')]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['개발', 'QA'])
  })
  it('다른 프로젝트의 팀은 보이지 않는다', () => {
    const all = [...globals, team('개발', 'p2')]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('비활성 프로젝트 팀만 있어도 전역으로 복귀하지 않는다(폴백 판정은 비활성 포함)', () => {
    const all = [...globals, team('개발', 'p1', false)]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['개발'])
  })
  it('전역과 동명인 프로젝트 팀이 공존할 수 있다', () => {
    const all = [...globals, team('PMO', 'p1')]
    const r = resolveTeamsForProject(all, 'p1')
    expect(r).toHaveLength(1)
    expect(r[0].projectId).toBe('p1')
  })
})
```

- [ ] **Step 2: 실행 — 실패 확인**

Run: `npx vitest run tests/domain/teams-scope.test.ts`
Expected: FAIL ("resolveTeamsForProject is not exported" / Team에 projectId 없음 타입 에러)

- [ ] **Step 3: domain/teams.ts 수정**

```ts
export interface Team {
  id: string
  /** 표시명이자 식별 코드(teams.code). teams.name은 code와 동기. */
  code: TeamCode
  sortOrder: number
  active: boolean
  /** 대시보드 '팀별 진척현황' 노출 여부(기존 MDM 제외 규칙의 데이터화). */
  progressVisible: boolean
  /** null = 전역 팀(회의록·또박또박·계정의 유일한 축). 값 = 그 프로젝트 전용 팀(0071). */
  projectId: string | null
}
```

`DEFAULT_TEAMS` 5개 항목 각각에 `projectId: null` 추가.

폴백 규칙(파일 하단에 추가):

```ts
/** 프로젝트 화면의 팀 목록 해석 — 프로젝트 행이 하나라도 있으면(비활성 포함) 그것만, 없으면 전역 폴백.
 *  비활성 포함으로 판정해야 "전 팀 비활성화"가 전역 상속으로 오해 복귀하지 않는다(스펙 §2). */
export function resolveTeamsForProject(all: readonly Team[], projectId: string): Team[] {
  const own = all.filter(t => t.projectId === projectId)
  if (own.length > 0) return own
  return all.filter(t => t.projectId === null)
}
```

- [ ] **Step 4: master.ts 수정**

`fetchTeams`의 select 에 `project_id` 추가 + 매핑에 `projectId: (r.project_id as string | null) ?? null`. 빈 목록 throw 판정은 **전역 행 기준**으로 바꾼다(프로젝트 행만 남고 전역이 빈 것도 비정상):

```ts
    .select('id, code, sort_order, active, progress_visible, project_id')
```
```ts
  if (teams.filter(t => t.projectId === null).length === 0) throw new Error('전역 teams 행이 비어 있습니다')
```

기존 접근자를 전역 전용으로 고정하고 프로젝트 인식 접근자를 추가(파일 하단, 기존 함수들 주석도 "전역 행만"으로 갱신):

```ts
/** 전체 캐시(전역+프로젝트, 비활성 포함). 내부용 — 외부는 아래 스코프 접근자를 쓴다. */
function allTeamsSync(): readonly Team[] {
  if (!background && Date.now() >= nextRefreshAt) {
    background = refreshTeams().catch(() => false).finally(() => { background = null })
  }
  return cache
}

/** 전역 팀(비활성 포함) — 회의록·또박또박·계정 등 프로젝트 축 없는 화면의 유일한 소스.
 *  프로젝트 팀은 여기 절대 섞이지 않는다(스펙 봉쇄 지점). */
export function teamsSync(): readonly Team[] {
  return allTeamsSync().filter(t => t.projectId === null)
}

/** 프로젝트 화면용 — 프로젝트 행 있으면 그것만, 없으면 전역 폴백(비활성 포함). */
export function teamsForProjectSync(projectId: string): readonly Team[] {
  return resolveTeamsForProject(allTeamsSync(), projectId)
}

/** 폴백 없는 프로젝트 행 원본(비활성 포함) — 설정 화면의 "전역 상속 중" 판정·목록용. */
export function projectTeamRowsSync(projectId: string): readonly Team[] {
  return allTeamsSync().filter(t => t.projectId === projectId)
}

export function activeTeamCodesForProjectSync(projectId: string): TeamCode[] {
  return activeCodes(teamsForProjectSync(projectId))
}

export function isRegisteredTeamCodeForProject(code: string, projectId: string): boolean {
  return teamsForProjectSync(projectId).some(t => t.code === code)
}

export function isActiveTeamCodeForProject(code: string, projectId: string): boolean {
  return teamsForProjectSync(projectId).some(t => t.active && t.code === code)
}
```

(기존 `teamsSync` 본문의 백그라운드 갱신 로직은 `allTeamsSync`로 이동 — `activeTeamCodesSync`/`isRegisteredTeamCode`/`isActiveTeamCode`는 `teamsSync()` 경유라 자동으로 전역 전용이 된다. `import { resolveTeamsForProject }` 추가.)

- [ ] **Step 5: 테스트·타입 확인**

Run: `npx vitest run tests/domain/teams-scope.test.ts && npx vitest run tests/domain/ && npx tsc --noEmit`
Expected: PASS. `DEFAULT_TEAMS` 픽스처를 쓰는 기존 테스트가 projectId 누락으로 깨지면 픽스처에 `projectId: null` 추가.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/domain/teams.ts src/lib/teams/master.ts tests/domain/teams-scope.test.ts
git commit -m "프로젝트별 팀 해석 규칙 — 전역 접근자 봉쇄 + teamsForProject 폴백(스펙 §2)"
```

---

### Task 4: 권한 합집합 — Actor.rosterTeams + permissions + 서버 액션

**Files:**
- Modify: `src/lib/domain/authz.ts` (Actor, ProjectActorView, toProjectActorView, actorFromView)
- Modify: `src/lib/authz/index.ts` (getActor)
- Modify: `src/lib/domain/permissions.ts`
- Modify: `src/app/actions/wbs.ts:94-102` (updateActual 팀 검사 — updateDeliverable에 같은 패턴이 있으면 동일 수정)
- Modify: `src/app/actions/attachments.ts:23-31`
- Test: `tests/domain/permissions-roster.test.ts` (신규)

**Interfaces:**
- Consumes: 없음(독립 — DB 컬럼은 Task 2에서 적용됨)
- Produces:
  - `Actor.rosterTeams: ReadonlyMap<string, { teamId: string; teamCode: TeamCode }>` (projectId → 그 프로젝트 명단의 내 팀)
  - `ProjectActorView.rosterTeamId: string | null`, `rosterTeamCode: TeamCode | null`
  - `permissions.ts`: `actorTeamCodesFor(actor: Actor, projectId: string): string[]`, `actorTeamIdsFor(actor: Actor, projectId: string): string[]`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/domain/permissions-roster.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canEditActual, actorTeamCodesFor } from '@/lib/domain/permissions'
import type { Actor } from '@/lib/domain/authz'
import type { ComputedItem } from '@/lib/domain/types'

const P = 'p1'
const leaf = (ownerTeam: string) =>
  ({ children: [], owners: [{ team: ownerTeam, kind: 'primary' }] } as unknown as ComputedItem)
const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: null, teamId: null, isSuperuser: false,
  projectRoles: new Map([[P, 'member']]), rosterTeams: new Map(), ...over,
})

describe('실적 편집 — 내 팀 = 계정 전역 팀 ∪ 프로젝트 명단 팀(합집합, 스펙 §3)', () => {
  it('계정 전역 팀 일치(기존 경로) — D-CUBE 회귀 0', () => {
    expect(canEditActual(leaf('ERP'), actor({ teamCode: 'ERP', teamId: 't-erp' }), P)).toBe(true)
  })
  it('명단 팀 일치(신규 경로) — 계정 팀이 달라도 허용', () => {
    const a = actor({ teamCode: 'PMO', teamId: 't-pmo',
      rosterTeams: new Map([[P, { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('개발'), a, P)).toBe(true)
  })
  it('둘 다 불일치면 거부', () => {
    const a = actor({ teamCode: 'PMO', teamId: 't-pmo',
      rosterTeams: new Map([[P, { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('QA'), a, P)).toBe(false)
  })
  it('다른 프로젝트의 명단 팀은 판정에 쓰지 않는다', () => {
    const a = actor({ rosterTeams: new Map([['p2', { teamId: 't-dev', teamCode: '개발' }]]) })
    expect(canEditActual(leaf('개발'), a, P)).toBe(false)
  })
  it('actorTeamCodesFor 는 중복을 제거한다(계정 팀 == 명단 팀)', () => {
    const a = actor({ teamCode: 'ERP', teamId: 't-erp',
      rosterTeams: new Map([[P, { teamId: 't-erp', teamCode: 'ERP' }]]) })
    expect(actorTeamCodesFor(a, P)).toEqual(['ERP'])
  })
})
```

- [ ] **Step 2: 실행 — 실패 확인**

Run: `npx vitest run tests/domain/permissions-roster.test.ts`
Expected: FAIL (rosterTeams 필드 없음 / actorTeamCodesFor 미정의)

- [ ] **Step 3: domain/authz.ts 확장**

`Actor`에 추가:
```ts
  /** projectId → 그 프로젝트 명단(project_members)의 내 팀. 없는 키 = 명단 팀 없음.
   *  WBS 실적·첨부의 '내 팀' 판정은 teamCode/teamId 와 이 값의 합집합이다(0071 RLS와 동일). */
  rosterTeams: ReadonlyMap<string, { teamId: string; teamCode: TeamCode }>
```

`ProjectActorView`에 추가:
```ts
  /** 이 프로젝트 명단의 내 팀(0071 합집합 판정용). null = 명단 팀 없음. */
  rosterTeamId: string | null
  rosterTeamCode: TeamCode | null
```

`toProjectActorView` 반환 객체에 추가:
```ts
    rosterTeamId: actor.rosterTeams.get(projectId)?.teamId ?? null,
    rosterTeamCode: actor.rosterTeams.get(projectId)?.teamCode ?? null,
```

`actorFromView` 반환 객체에 추가:
```ts
    rosterTeams: new Map(view.rosterTeamId && view.rosterTeamCode
      ? [[projectId, { teamId: view.rosterTeamId, teamCode: view.rosterTeamCode }]] : []),
```

- [ ] **Step 4: getActor 에 rosterTeams 조립 추가** (`src/lib/authz/index.ts`, project_roles 조회 다음에):

```ts
  // 0071: 프로젝트 명단의 내 팀 — WBS 실적·첨부의 합집합 판정 재료. 조회 실패는 다른 축과
  // 동일하게 throw(fail-closed) — 명단 팀만 빠진 Actor 는 '권한 없음'으로 조용히 좁아진다.
  const { data: rosterRows, error: rosterErr } = await sb
    .from('project_members')
    .select('project_id, team_id, teams(code)')
    .eq('user_id', u.user.id)
    .not('team_id', 'is', null)
  if (rosterErr || !rosterRows) {
    console.error('[getActor] 명단 팀 조회 실패:', rosterErr?.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + (rosterErr?.message ?? 'unknown'))
  }
  const rosterTeams = new Map<string, { teamId: string; teamCode: TeamCode }>()
  for (const r of rosterRows) {
    const t = (r.teams ?? null) as unknown as { code: TeamCode } | null
    if (r.team_id && t?.code) rosterTeams.set(r.project_id as string, { teamId: r.team_id as string, teamCode: t.code })
  }
```
반환 객체에 `rosterTeams,` 추가.

- [ ] **Step 5: permissions.ts 합집합**

```ts
/** '내 팀' 후보 코드 — 계정 전역 팀(memberships) ∪ 그 프로젝트 명단 팀(0071 RLS와 동일 합집합). */
export function actorTeamCodesFor(actor: Actor, projectId: string): string[] {
  const out: string[] = []
  if (actor.teamCode) out.push(actor.teamCode)
  const roster = actor.rosterTeams.get(projectId)
  if (roster && roster.teamCode !== actor.teamCode) out.push(roster.teamCode)
  return out
}

/** '내 팀' 후보 id — 서버 액션의 item_owners 재검증용(위와 같은 합집합). */
export function actorTeamIdsFor(actor: Actor, projectId: string): string[] {
  const out: string[] = []
  if (actor.teamId) out.push(actor.teamId)
  const roster = actor.rosterTeams.get(projectId)
  if (roster && roster.teamId !== actor.teamId) out.push(roster.teamId)
  return out
}
```

`canEditActual`/`canEditDeliverable`의 마지막 줄을 각각:
```ts
  const mine = actorTeamCodesFor(actor!, projectId)
  return item.owners.some(o => mine.includes(o.team))
```

- [ ] **Step 6: 서버 액션 재검증 합집합**

`actions/wbs.ts` updateActual(95-102) — 기존:
```ts
    if (!g.actor.teamId) return { ok: false, error: '담당 작업이 아님' }
    const { data: owner, error: ownerErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).eq('team_id', g.actor.teamId).maybeSingle()
```
교체(0071 RLS·permissions 와 동일 합집합):
```ts
    const myTeamIds = actorTeamIdsFor(g.actor, found.projectId!)
    if (myTeamIds.length === 0) return { ok: false, error: '담당 작업이 아님' }
    const { data: owner, error: ownerErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId).in('team_id', myTeamIds).limit(1).maybeSingle()
```
(`actorTeamIdsFor` import 추가. 같은 파일의 updateDeliverable 에 동일 패턴이 있으면 같은 방식으로 교체 — `grep -n "actor.teamId" src/app/actions/wbs.ts`로 전수 확인.)

`actions/attachments.ts:31` — 기존:
```ts
  if (!owners.some(o => o.team_id === g.actor.teamId)) return { ok: false, error: '권한 없음' }
```
교체:
```ts
  const myTeamIds = actorTeamIdsFor(g.actor, found.projectId ?? '')
  if (!owners.some(o => myTeamIds.includes(o.team_id as string))) return { ok: false, error: '권한 없음' }
```

- [ ] **Step 7: 전체 확인** — `npx vitest run tests/domain/permissions-roster.test.ts && npx vitest run tests/ && npx tsc --noEmit`
Expected: PASS. Actor 픽스처를 만드는 기존 테스트(tests/authz 등)가 rosterTeams 누락으로 깨지면 `rosterTeams: new Map()` 추가.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/domain/authz.ts src/lib/authz/index.ts src/lib/domain/permissions.ts src/app/actions/wbs.ts src/app/actions/attachments.ts tests/domain/permissions-roster.test.ts
git commit -m "WBS 실적·첨부 '내 팀' 합집합 — 계정 전역 팀 ∪ 프로젝트 명단 팀(0071 RLS와 동일 판정)"
```

---

### Task 5: Provider 중첩 + 서버 주입처 프로젝트 인식 전환

**Files:**
- Modify: `src/app/(app)/p/[projectId]/layout.tsx` (4줄 셸 → Provider 중첩)
- Modify: `src/components/dashboard/DashboardView.tsx:87,140`
- Modify: `src/components/dashboard/TeamProgress.tsx` (teams prop 주입)
- Modify: `src/app/api/report/route.ts:111`
- Modify: `src/app/api/export/route.ts:65`
- Modify: `src/app/actions/risk.ts:40`
- Modify: `src/lib/data/wbs.ts:61` · `src/lib/repositories/supabase/wbs.ts:54` · `src/lib/data/snapshots.ts:68` (팀 정렬 주입 — 각 지점의 함수가 projectId 를 이미 안다)

**Interfaces:**
- Consumes: Task 3 의 `teamsForProjectSync`/`activeTeamCodesForProjectSync`
- Produces: `/p/` 하위 전 클라이언트 컴포넌트(useTeams/useTeamCodes)가 프로젝트 팀 수신; `TeamProgress` 시그니처 `{ items: ComputedItem[]; teams: readonly Team[] }`

- [ ] **Step 1: 프로젝트 레이아웃에서 TeamsProvider 중첩**

`src/app/(app)/p/[projectId]/layout.tsx` 전체 교체:

```tsx
import { TeamsProvider } from '@/components/app/TeamsProvider'
import { teamsForProjectSync } from '@/lib/teams/master'

// 프로젝트 셸. 메뉴는 사이드바로 이동했고, 각 페이지가 자체 PageHero 를 렌더한다.
// TeamsProvider 중첩(안쪽 승리)으로 /p/ 하위의 useTeams/useTeamCodes 가 프로젝트 팀을 받는다 —
// 전역 화면(회의록·계정)은 (app)/layout 의 전역 Provider 그대로(스펙 §2).
export default async function ProjectLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const teams = teamsForProjectSync(projectId).filter(t => t.active)
  return (
    <TeamsProvider teams={teams}>
      <div className="h-full min-h-0 min-w-0">{children}</div>
    </TeamsProvider>
  )
}
```

- [ ] **Step 2: 서버 주입처 교체** (전부 `activeTeamCodesSync()` → `activeTeamCodesForProjectSync(projectId)`, `teamsSync()` → `teamsForProjectSync(projectId)` — import 교체 포함):

| 파일:라인 | 변경 |
|---|---|
| `DashboardView.tsx:87` | `teamOrderMap(activeCodes(teamsSync()))` → `teamOrderMap(activeCodes(teamsForProjectSync(projectId)))` |
| `DashboardView.tsx:140` | `<TeamProgress items={items} />` → `<TeamProgress items={items} teams={teamsForProjectSync(projectId)} />` |
| `api/report/route.ts:111` | `teams: activeTeamCodesSync()` → `teams: activeTeamCodesForProjectSync(projectId)` |
| `api/export/route.ts:65` | `activeTeamCodesSync()` → `activeTeamCodesForProjectSync(projectId)` |
| `actions/risk.ts:40` | `teams: activeTeamCodesSync()` → `teams: activeTeamCodesForProjectSync(projectId)` |
| `lib/data/wbs.ts:61` · `lib/repositories/supabase/wbs.ts:54` · `lib/data/snapshots.ts:68` | 해당 함수 스코프의 projectId 로 `ForProject` 버전 사용(각 파일에서 projectId 식별자명 확인 후 동일 패턴) |

- [ ] **Step 3: TeamProgress 를 주입식으로**

```tsx
import { Users } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import type { Team } from '@/lib/domain/teams'
import { teamProgress } from '@/lib/domain/dashboard'
// ... 기존 import 유지, teamsSync import 제거

/** 팀별 진척 — 팀 목록은 DashboardView 가 프로젝트 인식으로 주입한다(0071). */
export function TeamProgress({ items, teams }: { items: ComputedItem[]; teams: readonly Team[] }) {
  const progressTeams = teams.filter(tm => tm.active && tm.progressVisible).map(tm => tm.code)
  const rows = teamProgress(collectLeaves(items), progressTeams)
  // ... 이하 렌더 동일
```

- [ ] **Step 4: 검증** — `npx tsc --noEmit && npm run lint && npx vitest run tests/`
Expected: PASS. 이어서 `npm run dev`로 D-CUBE 대시보드·WBS·칸반이 기존과 동일하게 보이는지 확인(프로젝트 팀 0건 → 폴백 → 현행 화면. 읽기만 한다).

- [ ] **Step 5: 커밋**

```bash
git add "src/app/(app)/p/[projectId]/layout.tsx" src/components/dashboard/DashboardView.tsx src/components/dashboard/TeamProgress.tsx src/app/api/report/route.ts src/app/api/export/route.ts src/app/actions/risk.ts src/lib/data/wbs.ts src/lib/repositories/supabase/wbs.ts src/lib/data/snapshots.ts
git commit -m "프로젝트 화면 팀 공급 전환 — Provider 중첩 + 서버 주입처 teamsForProject(폴백으로 D-CUBE 무변화)"
```

---

### Task 6: teams 코드→id 해석 스코프 스위프

복합 유니크 도입으로 `.eq('code', X)` 단독 조회는 동명 2행에서 `.single()`이 깨지거나 임의 행을 잡는다. **전수 소탕이 목적.**

**Files:**
- Modify: `src/app/actions/members.ts:30-34` (resolveTeamId)
- Modify: `src/app/actions/projectInvites.ts:101-108` (resolveTeamId) + `:192` (팀 검증)
- Modify: `src/app/actions/accounts.ts` (팀 해석·검증 지점 — 전역 스코프 고정)
- Modify: `src/app/actions/wbs.ts:289` (addSubAct 팀 해석)

**Interfaces:**
- Consumes: Task 3 접근자
- Produces: 프로젝트 문맥 코드 해석의 공용 패턴 — "프로젝트 행 우선·전역 폴백" 쿼리

- [ ] **Step 1: 전수 목록 확보**

Run: `grep -rn "from('teams')" src --include="*.ts" --include="*.tsx"`
Expected: master.ts(캐시)·actions/teams.ts(전역 관리)·아래 수정 대상들. 목록에 이 계획에 없는 지점이 나오면 같은 기준(프로젝트 문맥 → 스코프 해석 / 전역 문맥 → `.is('project_id', null)`)으로 수정하고 커밋 메시지에 기록한다.

- [ ] **Step 2: 프로젝트 문맥 해석 패턴 적용** — members.ts `resolveTeamId`:

```ts
/** 팀 코드 → teams.id — 프로젝트 행 우선, 전역 폴백(0071 스코프. import RPC 와 같은 규칙). */
async function resolveTeamId(sb: ServerClient, teamCode: TeamCode | null, projectId: string): Promise<string | null> {
  if (!teamCode) return null
  const { data } = await sb.from('teams')
    .select('id, project_id')
    .eq('code', teamCode)
    .or(`project_id.eq.${projectId},project_id.is.null`)
  const rows = (data ?? []) as Array<{ id: string; project_id: string | null }>
  return (rows.find(r => r.project_id !== null) ?? rows[0])?.id ?? null
}
```
호출부 2곳(addMember/updateMember)에 `projectId`(updateMember는 `found.projectId!`) 전달.

- [ ] **Step 3: projectInvites.ts** — `resolveTeamId(admin, teamCode)` → 동일 패턴으로 `projectId` 인자 추가(호출부 `:217`은 projectId 보유). `:192` 검증 교체:

```ts
  if (!isTeamCode(input.teamCode, activeTeamCodesForProjectSync(projectId))) return { ok: false, error: ERR_TEAM }
```

- [ ] **Step 4: accounts.ts** — 계정(전역 축) 팀 해석·검증은 전역 고정: `from('teams')` 조회에 `.is('project_id', null)` 추가, 검증은 기존 `activeTeamCodesSync()` 유지(이미 전역 전용이라 무변경). `grep -n "teams" src/app/actions/accounts.ts`로 해석 지점 전수 확인.

- [ ] **Step 5: addSubAct** (`wbs.ts:289`) — 기존:
```ts
  const { data: teamRow, error: teamErr } = await sb.from('teams').select('id').eq('code', team).maybeSingle()
```
교체:
```ts
  const { data: teamRows, error: teamErr } = await sb.from('teams')
    .select('id, project_id').eq('code', team)
    .or(`project_id.eq.${act.project_id},project_id.is.null`)
  if (teamErr) return { ok: false, error: `담당 팀 조회 실패: ${teamErr.message}` }
  const teamRow = (teamRows ?? []).find(r => r.project_id !== null) ?? (teamRows ?? [])[0]
  if (!teamRow) return { ok: false, error: '담당 팀을 찾을 수 없습니다' }
```

- [ ] **Step 6: 검증·커밋**

Run: `npx tsc --noEmit && npx vitest run tests/`
```bash
git add src/app/actions/members.ts src/app/actions/projectInvites.ts src/app/actions/accounts.ts src/app/actions/wbs.ts
git commit -m "teams 코드 해석 스코프 소탕 — 동명 2행(복합 유니크)에서 .single() 파손·임의 행 방지"
```

---

### Task 7: 프로젝트 팀 관리 — 액션 + UI

**Files:**
- Create: `src/app/actions/projectTeams.ts`
- Create: `src/components/settings/ProjectTeamsManager.tsx`
- Modify: `src/app/(app)/p/[projectId]/settings/page.tsx` (권한 섹션 뒤에 팀 관리 섹션)
- Test: `tests/actions/` 관례가 있으면 액션 입력 검증 테스트, 없으면 도메인 검증만(중복 검사는 액션 내 DB 대조라 vitest 범위 밖 — 기존 teams 액션도 동일)

**Interfaces:**
- Consumes: Task 3 `projectTeamRowsSync`/`teamsSync`, `normalizeNewTeamCode`, `requireProjectAdmin`, `refreshTeams`
- Produces: `addProjectTeam(projectId: string, input: string)`, `updateProjectTeam(projectId: string, teamId: string, patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number })`, `copyGlobalTeams(projectId: string)` — 전부 `Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: 액션 작성** — `src/app/actions/projectTeams.ts` (actions/teams.ts 관례 복제, 차이 3가지: 가드=requireProjectAdmin / insert에 project_id / **시드 폴더 생성 없음**):

```ts
'use server'

// 프로젝트 팀 관리(프로젝트 관리자) — 전역 팀(/admin/teams, 슈퍼유저)과 별개 스코프(0071).
// 회의록 시드 폴더는 만들지 않는다: 회의록·또박또박은 전역 팀 축이다(스펙 §5).
// 삭제 없음: 비활성화=삭제(전역 팀과 동일 관례).

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { refreshTeams, teamsSync } from '@/lib/teams/master'

export type ProjectTeamActionResult = { ok: true } | { ok: false; error: string }

export async function addProjectTeam(projectId: string, input: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const norm = normalizeNewTeamCode(input)
  if (!norm.ok) return norm
  const admin = createAdminClient()

  // 중복은 동일 프로젝트 내에서만 거부 — 전역·타 프로젝트 동명은 허용(복합 유니크와 일치).
  const dup = await admin.from('teams').select('id').eq('project_id', projectId).eq('code', norm.code).maybeSingle()
  if (dup.error) return { ok: false, error: `팀 조회 실패: ${dup.error.message}` }
  if (dup.data) return { ok: false, error: `'${norm.code}' 팀이 이미 이 프로젝트에 있습니다.` }

  const max = await admin.from('teams')
    .select('sort_order').eq('project_id', projectId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle()
  if (max.error) return { ok: false, error: `팀 조회 실패: ${max.error.message}` }
  const sortOrder = Number((max.data as { sort_order?: number } | null)?.sort_order ?? -1) + 1

  const ins = await admin.from('teams')
    .insert({ code: norm.code, name: norm.code, sort_order: sortOrder, project_id: projectId })
  if (ins.error) return { ok: false, error: `팀 생성 실패: ${ins.error.message}` }

  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

export async function updateProjectTeam(
  projectId: string, teamId: string,
  patch: { active?: boolean; progressVisible?: boolean; sortOrder?: number },
): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const row: Record<string, unknown> = {}
  if (typeof patch.active === 'boolean') row.active = patch.active
  if (typeof patch.progressVisible === 'boolean') row.progress_visible = patch.progressVisible
  if (typeof patch.sortOrder === 'number' && Number.isInteger(patch.sortOrder)) row.sort_order = patch.sortOrder
  if (Object.keys(row).length === 0) return { ok: false, error: '변경할 항목이 없습니다.' }
  const admin = createAdminClient()
  // .eq('project_id') 를 함께 건다 — 관리자 가드가 통과한 프로젝트의 행만 만진다(전역 행 오수정 차단).
  const upd = await admin.from('teams').update(row).eq('id', teamId).eq('project_id', projectId)
  if (upd.error) return { ok: false, error: `팀 수정 실패: ${upd.error.message}` }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}

/** 전역 활성 팀을 프로젝트 팀으로 복사해 시작 — 프로젝트 팀 0개일 때만(1회성 시작 도구). */
export async function copyGlobalTeams(projectId: string): Promise<ProjectTeamActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const existing = await admin.from('teams').select('id').eq('project_id', projectId).limit(1).maybeSingle()
  if (existing.error) return { ok: false, error: `팀 조회 실패: ${existing.error.message}` }
  if (existing.data) return { ok: false, error: '이미 프로젝트 팀이 정의되어 있습니다.' }
  const globals = teamsSync().filter(t => t.active)
  const ins = await admin.from('teams').insert(globals.map(t => ({
    code: t.code, name: t.code, sort_order: t.sortOrder,
    progress_visible: t.progressVisible, project_id: projectId,
  })))
  if (ins.error) return { ok: false, error: `복사 실패: ${ins.error.message}` }
  await refreshTeams()
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true }
}
```

- [ ] **Step 2: ProjectTeamsManager 작성** — `src/components/settings/ProjectTeamsManager.tsx`. `TeamsManager`(src/components/admin/TeamsManager.tsx)를 본떠 만들되:
  - props: `{ projectId: string; teams: AdminTeamRow[]; inherited: boolean }` (`AdminTeamRow` 형태 재선언 — admin 컴포넌트에서 import 하지 않는다)
  - 액션 호출은 `addProjectTeam(projectId, code)`/`updateProjectTeam(projectId, id, patch)`/`copyGlobalTeams(projectId)`
  - `inherited === true`(프로젝트 팀 0개)일 때: 테이블 대신 안내 패널 — "현재 전역 팀을 상속 중입니다. 이 프로젝트만의 팀을 정의하면 상속이 끊깁니다." + 버튼 2개(`전역 팀 복사로 시작` → copyGlobalTeams, `빈 목록에서 시작` → 팀 추가 입력 노출)
  - **상속 종료 경고**: inherited 상태에서 첫 추가/복사 실행 전 `confirm` 모달(기존 Modal 컴포넌트) — "이 프로젝트는 더 이상 전역 팀을 따르지 않습니다. 기존 WBS 담당이 전역 팀에 걸려 있으면 화면에서 '목록 밖 팀'으로 처리됩니다(칸반 미배정·엑셀 열 덧붙임). 계속할까요?"
  - 하단 안내 문구는 전역판과 달리: "이 팀 목록은 이 프로젝트의 WBS 담당·명단·칸반·보고서에만 적용됩니다. 회의록 보관함은 전역 팀 기준을 유지합니다."
  - 정렬 스왑·활성/진척 토글 UI는 TeamsManager 와 동일 구조(코드 복제 허용 — admin 판과 액션·문구가 달라 공용화하면 오히려 결합)

- [ ] **Step 3: settings 페이지에 섹션 추가** — `settings/page.tsx` 권한 SectionCard(`{isAdmin && (... 권한 ...)}`) **다음에**:

```tsx
      {/* ── 팀 관리 (관리자 이상) — 프로젝트 스코프 팀(0071). 전역 팀은 /admin/teams. ── */}
        {isAdmin && (
          <SectionCard
            eyebrow="TEAMS"
            title={locale === 'ko' ? '팀 관리' : 'Teams'}
            icon={Users}
          >
            <p className="-mt-2 mb-4 text-xs leading-5 text-ink-muted">
              {locale === 'ko'
                ? '이 프로젝트의 팀 목록입니다. WBS 담당·명단·칸반·보고서가 이 목록을 씁니다. 정의하지 않으면 전역 팀을 상속합니다.'
                : 'Teams for this project, used by WBS owners, roster, kanban and reports. Inherits global teams until defined.'}
            </p>
            <ProjectTeamsManager
              projectId={projectId}
              teams={projectTeamRows.map(t => ({ id: t.id, code: t.code, sortOrder: t.sortOrder, active: t.active, progressVisible: t.progressVisible }))}
              inherited={projectTeamRows.length === 0}
            />
          </SectionCard>
        )}
```

페이지 상단에 `import { projectTeamRowsSync } from '@/lib/teams/master'`, `import { ProjectTeamsManager } from '@/components/settings/ProjectTeamsManager'`, lucide `Users` 추가, 본문에서 `const projectTeamRows = projectTeamRowsSync(projectId)`.

- [ ] **Step 4: 수동 검증(전용 테스트 프로젝트)** — `npm run dev` → 테스트 프로젝트 설정에서: 상속 안내 표시 → 팀 2개 추가(경고 모달 확인) → WBS/칸반/명단 드롭다운이 그 2팀만 노출 → 전역 화면(/minutes 팀 탭, /admin/teams)은 5팀 그대로. **D-CUBE 설정 페이지에서는 "전역 팀 상속 중" 표시만 확인하고 아무것도 누르지 않는다.**

- [ ] **Step 5: 커밋**

```bash
git add src/app/actions/projectTeams.ts src/components/settings/ProjectTeamsManager.tsx "src/app/(app)/p/[projectId]/settings/page.tsx"
git commit -m "프로젝트 설정에 팀 관리 섹션 — 관리자 CRUD·전역 복사 시작·상속 종료 경고(스펙 §4)"
```

---

### Task 8: 명단 역할 라벨(role_label)

**Files:**
- Modify: `src/lib/domain/types.ts:60-70` (ProjectMember)
- Modify: `src/lib/data/members.ts` (select + 매핑)
- Modify: `src/app/actions/members.ts` (MemberInput·insert·RPC 호출)
- Modify: `src/components/members/MembersBoard.tsx` (폼 필드 + 카드 칩)

**Interfaces:**
- Consumes: Task 2 의 `role_label` 컬럼·7-인자 RPC
- Produces: `ProjectMember.roleLabel: string | null`, `MemberInput.roleLabel: string | null`

- [ ] **Step 1: 타입·로더** — `ProjectMember`에 `roleLabel: string | null  // 자유 입력 역할(예: PM·개발·QA). role(리더/실무)·title(직함)과 별개 축(0071)` 추가. `lib/data/members.ts` select 에 `role_label` 추가, 매핑에 `roleLabel: (r.role_label as string) ?? null,`.

- [ ] **Step 2: 액션** — `MemberInput`에 `roleLabel: string | null` 추가. `addMember` insert 에 `role_label: input.roleLabel?.trim() || null,`. `updateMember` RPC 호출에 `p_role_label: input.roleLabel,` 추가.

- [ ] **Step 3: 폼·표시** — `MemberFormModal`: `const [roleLabel, setRoleLabel] = useState('')`, open effect 에 `setRoleLabel(initial?.roleLabel ?? '')`, submit input 에 `roleLabel: roleLabel.trim() || null,`. 직함(title) 필드 옆/아래에 입력 추가(신규 문구는 dict 미보유 → locale 분기 관례):

```tsx
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{locale === 'en' ? 'Role' : '역할'}</span>
          <input className="app-input" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)}
            placeholder={locale === 'en' ? 'e.g. PM, Dev, QA' : '예: PM · 개발 · QA'} maxLength={30} />
        </label>
```
(`useLocale()`의 `locale`이 MemberFormModal 스코프에 없으면 `const { t, locale } = useLocale()`로 확장.)

카드 표시: 멤버 카드에서 title 을 렌더하는 지점을 찾아(`grep -n "title" src/components/members/MembersBoard.tsx`) 그 옆에 roleLabel 칩 추가 — 기존 chip 컨벤션(`<span className="chip bg-brand-weak text-brand">{m.roleLabel}</span>`, null 이면 미표시).

- [ ] **Step 4: 검증** — `npx tsc --noEmit && npx vitest run tests/`. `npm run dev` → 테스트 프로젝트 명단에서 역할 입력·수정·표시 라운드트립 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/types.ts src/lib/data/members.ts src/app/actions/members.ts src/components/members/MembersBoard.tsx
git commit -m "명단 역할 라벨(role_label) — 자유 입력 표시용, 리더/실무·직함과 별개 축(스펙 §4)"
```

---

### Task 9: 임포트 부트스트랩 스코프 분기

**Files:**
- Modify: `src/app/api/import/execute/route.ts:75-95`
- Modify: `src/components/import/ImportWizard.tsx` (409 payload scope + 모달 문구/버튼 게이트)

**Interfaces:**
- Consumes: Task 3 `teamsForProjectSync`/`projectTeamRowsSync`, Task 7 `addProjectTeam`
- Produces: 409 응답 `{ needsTeams: string[], scope: 'project' | 'global' }`

- [ ] **Step 1: 라우트 분기** — `route.ts:76-95` 교체:

```ts
  // 팀 마스터 대조(§10.3) — 대조 기준도 등록 스코프도 프로젝트 팀 정의 여부를 따른다(0071).
  const projectDefined = projectTeamRowsSync(projectId).length > 0
  const registered = new Set(teamsForProjectSync(projectId).map(t => t.code))
  const unknownTeams = [...new Set(parsed.rows.flatMap(r => r.owners.map(o => o.team)))]
    .filter(t => !registered.has(t))

  if (unknownTeams.length > 0) {
    if (!registerTeams) {
      return NextResponse.json({ needsTeams: unknownTeams, scope: projectDefined ? 'project' : 'global' }, { status: 409 })
    }
    if (projectDefined) {
      // 프로젝트 팀으로 등록 — 라우트 상단 가드(관리자)로 충분, 시드 폴더 없음(addProjectTeam 계약).
      for (const team of unknownTeams) {
        const added = await addProjectTeam(projectId, team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    } else {
      // 전역 상속 프로젝트(D-CUBE)는 현행 유지 — 전역 마스터 등록은 슈퍼유저만.
      const su = await requireSuperuser()
      if (!su.ok) return NextResponse.json({ error: '팀 등록은 슈퍼유저 권한' }, { status: 403 })
      for (const team of unknownTeams) {
        const added = await addTeam(team)
        if (!added.ok) {
          return NextResponse.json({ error: `팀 등록 실패: ${team} — ${added.error}` }, { status: 500 })
        }
      }
    }
  }
```
(import 추가: `projectTeamRowsSync, teamsForProjectSync` — 기존 `teamsSync` import 는 이 지점에서만 쓰였으면 제거, `addProjectTeam`.)

- [ ] **Step 2: ImportWizard** — 409 처리에 scope 보존(`executeNeedsTeams` 액션에 `scope` 필드 추가, 리듀서·state 타입 함께). 모달: `state.needsTeamsScope === 'project'`이면 등록 버튼 `disabled={state.busy}`(관리자면 충분 — 이 화면 자체가 관리자 전용)와 안내 문구 locale 분기 "이 프로젝트의 팀으로 등록됩니다(전역 팀에는 영향 없음).", `'global'`이면 기존 그대로(슈퍼유저 게이트 + 기존 문구).

- [ ] **Step 3: 검증** — `npx tsc --noEmit && npx vitest run tests/`. 수동: 테스트 프로젝트(팀 정의됨)에 미등록 팀이 든 엑셀 임포트 → 409 모달(프로젝트 문구) → 등록 → 프로젝트 팀으로 생성 + `/admin/teams` 무변화 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/import/execute/route.ts src/components/import/ImportWizard.tsx
git commit -m "임포트 팀 부트스트랩 스코프 분기 — 팀 정의 프로젝트는 프로젝트 스코프 등록(전역 오염 차단)"
```

---

### Task 10: 봇 도구 + planner 힌트

**Files:**
- Modify: `src/lib/ai/tools/wbs.ts:204` (+ `:121-130` computedSnapshot 정렬 주입)
- Modify: `src/lib/ai/tools/kanban.ts:101-103` (+ `:79-83,124-126` 정렬/그룹 주입)
- Modify: `src/lib/ai/tools/attendance.ts:64-66`
- Modify: `src/lib/ai/tools/members.ts:53-58` (readTeam) + 호출부 `:81,:154` + `:178` 그룹 순서
- Modify: `src/lib/ai/chat/planner.ts:218`
- (무접촉: `src/lib/ai/tools/minutes.ts` — 회의록은 전역 축)

**Interfaces:**
- Consumes: Task 3 `activeTeamCodesForProjectSync`
- Produces: `readTeam(value: unknown, projectId: string)` 시그니처 변경

- [ ] **Step 1: 검증 지점 교체** — 각 execute 는 projectId 를 이미 확보한 뒤 검증한다(감사 실측):
  - wbs.ts:204, kanban.ts:101, attendance.ts:64 — `activeTeamCodesSync()` → `activeTeamCodesForProjectSync(projectId)`
  - members.ts readTeam — `function readTeam(value: unknown, projectId: string)`으로 바꾸고 내부 `activeTeamCodesSync()` → `activeTeamCodesForProjectSync(projectId)`. 호출부 2곳은 projectId 확보 **이후로 이동**(`readRequiredString(args.projectId)` 다음 줄).

- [ ] **Step 2: 정렬/그룹 주입 교체** — 헬퍼가 projectId 를 모르는 지점은 호출부(execute)에서 코드 목록을 계산해 인자로 내린다: wbs.ts computedSnapshot, kanban.ts groupColumns/teamOrderMap, members.ts:178, dashboard.ts:83. 각 헬퍼 시그니처에 `teamCodes: readonly string[]` 추가가 가장 작다 — 파일별로 확인 후 동일 패턴 적용.

- [ ] **Step 3: planner 힌트** — `planner.ts:218`:
```ts
    argHints: 'team은 프로젝트에 등록된 팀 코드(선택)',
```

- [ ] **Step 4: 검증·커밋** — `npx tsc --noEmit && npx vitest run tests/`

```bash
git add src/lib/ai/tools/wbs.ts src/lib/ai/tools/kanban.ts src/lib/ai/tools/attendance.ts src/lib/ai/tools/members.ts src/lib/ai/tools/dashboard.ts src/lib/ai/chat/planner.ts
git commit -m "봇 도구 팀 검증 프로젝트 인식 전환 + planner 5팀 하드코딩 힌트 제거"
```

---

### Task 11: 전체 검증 → 배포 → 실화면 → mark:good

**Files:** 없음(검증·배포)

- [ ] **Step 1: 전체 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run tests/ && npm run build`
(build 실패가 `_workspace` 스크래치 ts 때문이면 `*.buildskip` 개명 후 재시도, 끝나면 원복.)

- [ ] **Step 2: D-CUBE 회귀 화면 확인(로컬 dev, 읽기만)** — 대시보드 팀 카드 5팀·WBS 담당 열·칸반 컬럼·엑셀 내보내기 열·주간 PPT 팀 행이 배포 전과 동일한지 눈으로 확인.

- [ ] **Step 3: push** — `git push origin main` (Vercel 자동 배포. 마이그레이션은 Task 2에서 이미 적용됨 — DB 선행·코드 후행 순서 충족.)

- [ ] **Step 4: 프로덕션 검증** — `npm run smoke:prod` → 실화면: ① D-CUBE 대시보드/WBS/칸반 현행 동일 ② 테스트 프로젝트에서 팀 정의→명단 배정(역할 라벨 포함)→WBS 담당 지정(sub-act)→**멤버 계정으로** 자기 팀 리프 실적 편집 성공 + 타 팀 리프 거부 ③ /minutes 팀 탭·/admin/teams·또박또박 `GET /api/v1/minutes/meta` 의 teams 가 전역 5팀 그대로.

- [ ] **Step 5: known-good** — 화면 확인까지 끝나면 `npm run mark:good`.

---

## Self-Review 결과 (계획 작성 시점)

- 스펙 커버리지: §1(스키마)=Task 1-2, §2(해석 규칙)=Task 3·5, §3(권한)=Task 1·4, §4(UI)=Task 7-8, §5(결합부)=Task 1(RPC)·6(해석 소탕)·9(임포트)·10(봇)·초대(Task 6), §7(경계 케이스)=Task 7 경고 모달·Task 11 검증, §8(테스트)=각 태스크+Task 11, §9(롤백)=Task 1.
- 스펙 §5 초대 redeem "현행 유지" = 코드 무변경(계획에 태스크 없음이 맞다).
- 타입 일관성: `Team.projectId`(T3) ← T5/T7 소비, `actorTeamIdsFor`(T4) ← T4 내 소비, `addProjectTeam(projectId, input)`(T7) ← T9 소비, `resolveTeamsForProject`(T3) ← master.ts 소비 — 일치 확인.
- 마이그레이션 내 `...` 표기는 원문 복사 지시이며 placeholder 가 아님을 본문에 명시했다.
