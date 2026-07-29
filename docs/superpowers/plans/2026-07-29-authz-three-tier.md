# 권한 체계 3단 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역 1역할(`pmo_admin`/`team_editor`)을 전역 등급(슈퍼유저) + 프로젝트 역할(관리자/멤버/조회) 2축으로 바꾸고, 서버 액션·RLS·화면을 모두 새 판정으로 통일한다.

**Architecture:** `memberships` 에 `is_superuser` 컬럼을, 새 `project_roles` 테이블에 프로젝트별 역할을 둔다. 기존 쓰기 정책 46개는 `app_role()` 호환 shim 으로 의미를 보존한 뒤 29개만 프로젝트 인자 헬퍼로 교체한다. 앱은 `src/lib/domain/authz.ts`(순수 판정) + `src/lib/authz.ts`(가드) 두 모듈로 단일화하고, 흩어진 `pmo_admin` 비교식 75곳을 가드 3종으로 대체한다.

**Tech Stack:** Next.js 15 App Router · TypeScript · Supabase(Postgres + RLS) · vitest · Tailwind v4

**스펙:** `docs/superpowers/specs/2026-07-29-authz-three-tier-design.md` — 결정 근거·실측치는 전부 여기에 있다. 이 계획과 스펙이 어긋나면 스펙이 정본이다.

---

## Global Constraints

프로젝트 전역 규칙이다. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **`git add -A` 금지.** 항상 파일명을 명시해 stage 한다. 병렬 세션의 dirty 파일과 `.env` 가 섞인다.
- **마이그레이션과 코드를 같은 커밋에 담지 않는다.** `supabase/migrations/*` 는 반드시 별도 커밋. pre-push 훅 G1 이 차단한다.
- **마이그레이션 적용은 Supabase Management API 경유.** `supabase db push` 금지. 레시피는 아래 §마이그레이션 적용 레시피.
- **새 마이그레이션에는 `_rollback.sql` 을 함께 만든다.**
- **운영 D-CUBE 데이터를 훼손하지 않는다.** 로컬 dev 도 프로덕션 Supabase 를 공유한다. 검증 쿼리는 SELECT 만.
- **RLS 헬퍼 이름은 `app_role()`** — 레포 옛 표기 `current_role()` 은 PG 예약어라 실행 불가.
- **에러 처리 3원칙:** ①조회 실패를 "데이터 없음"으로 위장하지 않는다(표시=로깅) ②쓰기 전 선행 조회가 실패하면 중단한다 ③보안 가드는 fail-closed.
- **UI 위험 파일**(`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*`)을 건드리면 `ui/authz` 브랜치로 push 한 뒤 머지한다(G2). 그 외는 `main` 직행 가능.
- **커밋 메시지는 한국어.** "무엇"보다 "왜".
- 상태 변형 display 유틸(`group-hover:flex`, `data-[state=open]:hidden` 등) 사용 금지 — `globals.css` 의 unlayered 반응형 안전망에 진다.
- 테스트: `npm run test` (vitest, `tests/**/*.test.{ts,tsx}`). 별칭 `@` → `src`.

### 마이그레이션 적용 레시피

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w \
      | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -H "User-Agent: claude-code" \
  --data "$(python3 -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" supabase/migrations/00XX_....sql)"
```

토큰은 절대 평문 출력하지 않는다. 적용 후 반드시 `pg_get_functiondef` / `pg_policies` 조회로 검증한다.

### 고정 사실 (2026-07-29 프로덕션 실측)

- 프로젝트 1개: `D-CUBE 프로젝트` = `7a1c6034-a647-4673-ae85-d0b6daa2f6f3`
- 계정 41 · `memberships` 41 · `pmo_admin` 28(PMO 14 / MES 11 / ERP 2 / 가공 1) · `team_editor` 13(ERP 9 / MES 4)
- 비-SELECT 정책 46개
- 슈퍼유저 대상: `donseok.lee@dongkuk.com`, `donseok75@gmail.com`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0051_authz_roles.sql` (+`_rollback`) | `project_roles` 신설 · `memberships.is_superuser` · 헬퍼 4종 · `app_role()` shim · 가드 트리거 교체 · 백필 · 검증 |
| `supabase/migrations/0052_project_scoped_rls.sql` (+`_rollback`) | 쓰기 정책 29개 교체 · `can_attach` 조이기 |
| `supabase/migrations/0053_deprecate_membership_role.sql` (+`_rollback`) | `memberships.role` deprecated 주석 박제 |
| `src/lib/domain/authz.ts` | **순수 판정.** `Actor` 타입 + `isProjectAdmin`/`isProjectMember`/`roleIn`. IO 없음 |
| `src/lib/authz.ts` | `getActor()` · 가드 3종 · `resolveProjectId()`. 서버 전용 |
| `src/lib/domain/permissions.ts` | 기존 `canEditActual`/`canEditWeight`/`canEditDeliverable` 을 `Actor` 시그니처로 이행 |
| `src/app/actions/projectRoles.ts` | **신규.** 프로젝트 역할 CRUD 서버 액션 |
| `src/app/actions/*.ts` (20파일) | 가드 3종으로 교체 |
| `src/app/api/{import,chat/reindex,chat/health}/route.ts` | 가드 교체 |
| `src/components/settings/ProjectRolesManager.tsx` | **신규.** 프로젝트 권한 탭 UI |
| `src/components/admin/AccountsManager.tsx` | 역할 드롭다운·일괄 등록 포맷 개편 |
| `src/lib/domain/accounts.ts` | `ACCOUNT_ROLES` → 프로젝트 역할 화이트리스트로 교체 |
| `tests/domain/authz.test.ts` | **신규.** 4역할 × 기능 매트릭스 |
| `tests/authz/guards.test.ts` | **신규.** 가드 3종 + `resolveProjectId` fail-closed |
| `tests/actions/authz-gate.test.ts` | **신규.** 액션 게이트 회귀 |

---

## Task 1: 0051 마이그레이션 파일 작성

**Files:**
- Create: `supabase/migrations/0051_authz_roles.sql`
- Create: `supabase/migrations/0051_authz_roles_rollback.sql`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: DB 함수 `is_superuser()`, `is_project_admin(uuid)`, `is_project_member(uuid)`, `can_read_project(uuid)`, 재정의된 `app_role()`, 테이블 `project_roles(project_id, user_id, role, granted_by, granted_at)`, 컬럼 `memberships.is_superuser`

이 태스크는 **파일만 만든다.** 적용은 Task 2.

- [ ] **Step 1: `0051_authz_roles.sql` 작성**

```sql
-- 권한 체계 3단 재설계 — 전역 등급(슈퍼유저) + 프로젝트 역할(관리자/멤버) 2축.
--
-- 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md
--
-- 핵심 원칙: 컬럼을 '더하기만' 한다. memberships.role 은 손대지 않는다.
--   값을 새 체계로 갈아엎으면 이 마이그레이션 적용 시점부터 코드 배포 완료까지
--   기존 코드 75곳의 문자열 비교가 전부 실패해 41명 전원이 권한을 잃는다.
--   role 컬럼은 0053 에서 deprecated 로 박제만 하고 남긴다.
--
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.
-- 재실행 안전(멱등). 트랜잭션으로 감싸 실행할 것.

begin;

-- ── 1) 전역 등급 ────────────────────────────────────────────────────────────
alter table memberships
  add column if not exists is_superuser boolean not null default false;

-- ── 2) 프로젝트 역할 ────────────────────────────────────────────────────────
-- '조회 전용'은 role 값이 아니라 행의 부재로 표현한다. viewer 값을 두면
-- "행 없음"과 "viewer 행"이 같은 뜻이 되어 판정이 두 갈래로 갈린다.
create table if not exists project_roles (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','member')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_roles_user_idx on project_roles(user_id);

-- ── 3) 판정 헬퍼 ────────────────────────────────────────────────────────────
-- security definer + search_path='' 는 0019/0022 가 택한 패턴(pg_temp 가로채기 차단).
-- 노출값은 boolean 하나뿐이다. 정책 안에서 project_roles 를 다시 읽어도
-- RLS 재귀가 걸리지 않는 것도 definer 덕분이다(0022 wbs_is_leaf 와 같은 이유).
create or replace function public.is_superuser() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.is_superuser from public.memberships m
                    where m.user_id = auth.uid()), false)
$$;

create or replace function public.is_project_admin(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_superuser()
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid() and r.role = 'admin')
$$;

create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_project_admin(pid)
      or exists (select 1 from public.project_roles r
                  where r.project_id = pid and r.user_id = auth.uid())
$$;

-- 조회 범위는 지금 전면 개방(설계 결정 D6). 나중에 좁힐 때 이 함수 본문만 고친다.
create or replace function public.can_read_project(pid uuid) returns boolean
language sql stable as $$ select true $$;

revoke all on function public.is_superuser()            from public;
revoke all on function public.is_project_admin(uuid)    from public;
revoke all on function public.is_project_member(uuid)   from public;
revoke all on function public.can_read_project(uuid)    from public;
grant execute on function public.is_superuser()          to authenticated;
grant execute on function public.is_project_admin(uuid)  to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.can_read_project(uuid)  to authenticated;

-- ── 4) project_roles 자신의 RLS ─────────────────────────────────────────────
alter table project_roles enable row level security;

drop policy if exists read_all_project_roles on project_roles;
create policy read_all_project_roles on project_roles
  for select to authenticated using (true);

-- 관리자 슬롯은 슈퍼유저만. 관리자가 관리자를 늘리면 지금의 28명 상황이 재현된다.
drop policy if exists su_write_admin_roles on project_roles;
create policy su_write_admin_roles on project_roles for all to authenticated
  using (role = 'admin' and public.is_superuser())
  with check (role = 'admin' and public.is_superuser());

-- 멤버 슬롯은 해당 프로젝트 관리자 이상.
drop policy if exists admin_write_member_roles on project_roles;
create policy admin_write_member_roles on project_roles for all to authenticated
  using (role = 'member' and public.is_project_admin(project_id))
  with check (role = 'member' and public.is_project_admin(project_id));

-- ── 5) 백필 ────────────────────────────────────────────────────────────────
-- 슈퍼유저 (설계 결정 D5)
update memberships m set is_superuser = true
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) in ('donseok.lee@dongkuk.com', 'donseok75@gmail.com');

-- 프로젝트 역할 (설계 결정 D4) — 규칙으로 부여한다. 하드코딩 명단을 쓰지 않는다.
-- PMO팀 pmo_admin → 관리자, 그 외 전원 → 멤버.
insert into project_roles (project_id, user_id, role, granted_by, granted_at)
select p.id, m.user_id,
       case when t.code = 'PMO' and m.role = 'pmo_admin' then 'admin' else 'member' end,
       null, now()
  from projects p
 cross join memberships m
  join teams t on t.id = m.team_id
    on conflict (project_id, user_id) do nothing;

-- ── 6) app_role() 호환 shim ────────────────────────────────────────────────
-- 정책 텍스트를 건드리지 않고 함수 하나만 바꿔 기존 46개 쓰기 정책의 의미를 보존한다.
-- 알려진 한계(의도적): 프로젝트가 여럿이 되면 "A프로젝트 관리자가 B프로젝트 RLS 통과"가
-- 된다. 그래서 0052 가 핵심 테이블을 프로젝트 인자 헬퍼로 교체하고, 서버 액션이 1차 관문이다.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.is_superuser() then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid() and r.role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_roles r
                  where r.user_id = auth.uid()) then 'team_editor'
    else null
  end
$$;

-- ── 7) 컬럼 가드 트리거 fail-open → fail-closed ────────────────────────────
-- 옛 guard_team_editor_actual_only 는 역할 문자열이 'team_editor' 일 때만 컬럼을
-- 제한했다. 역할 이름이 바뀌면 가드가 통째로 열린다. 판정을 뒤집는다.
create or replace function public.guard_non_admin_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 서버·임포트 경로(service_role: auth.uid() is null)는 그대로 통과
  if auth.uid() is null then return new; end if;
  if public.is_project_admin(new.project_id) then return new; end if;

  -- 그 외 전원(멤버·조회 전용·미상): 실적%·산출물만 허용
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 옛 트리거·함수를 명시적으로 제거한다. 남기면 두 트리거가 함께 돌아 판정 근거가 둘이 된다.
drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
drop function if exists public.guard_team_editor_actual_only();
drop trigger if exists trg_guard_non_admin_column_scope on wbs_items;
create trigger trg_guard_non_admin_column_scope
  before update on wbs_items
  for each row execute function public.guard_non_admin_column_scope();

-- ── 8) 검증 — 어긋나면 통째로 되돌린다 ─────────────────────────────────────
-- 기대값은 2026-07-29 실측(pmo_admin 28 = PMO 14 + 비PMO 14)에 근거한다.
-- 적용 시점에 계정이 늘어 숫자가 어긋나면 중단하는 것이 맞다 —
-- 조용히 통과시키면 누가 권한을 잃었는지 모른 채 배포된다.
do $$
declare demoted int; su int; orphan int;
begin
  select count(*) into demoted from memberships m
   where m.role = 'pmo_admin' and not m.is_superuser
     and not exists (select 1 from project_roles r
                      where r.user_id = m.user_id and r.role = 'admin');
  if demoted <> 14 then
    raise exception '0051 중단: 관리자로 안착하지 못한 옛 pmo_admin 이 14명이어야 하는데 %명입니다. 백필 규칙과 팀 소속을 확인하세요.', demoted;
  end if;

  select count(*) into su from memberships where is_superuser;
  if su <> 2 then
    raise exception '0051 중단: 슈퍼유저가 2명이어야 하는데 %명입니다. 대상 이메일을 확인하세요.', su;
  end if;

  select count(*) into orphan from memberships m
   where not m.is_superuser
     and not exists (select 1 from project_roles r where r.user_id = m.user_id);
  if orphan > 0 then
    raise exception '0051 중단: 프로젝트 역할이 없는 계정이 %건 있습니다.', orphan;
  end if;
end $$;

commit;
```

- [ ] **Step 2: `0051_authz_roles_rollback.sql` 작성**

```sql
-- 0051 롤백. app_role()·가드 트리거를 0022/0036 시점 정의로 되돌린다.
-- (아래 정의는 2026-07-29 프로덕션 pg_get_functiondef 원문과 동일하다.)

begin;

drop trigger if exists trg_guard_non_admin_column_scope on wbs_items;
drop function if exists public.guard_non_admin_column_scope();

create or replace function public.guard_team_editor_actual_only()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  select m.role into v_role from public.memberships m where m.user_id = auth.uid();
  if v_role is distinct from 'team_editor' then
    return new;
  end if;
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '팀 편집자는 실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
create trigger trg_guard_team_editor_actual_only
  before update on wbs_items
  for each row execute function public.guard_team_editor_actual_only();

create or replace function public.app_role() returns text
language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

drop table if exists project_roles;
alter table memberships drop column if exists is_superuser;

drop function if exists public.is_project_member(uuid);
drop function if exists public.is_project_admin(uuid);
drop function if exists public.is_superuser();
drop function if exists public.can_read_project(uuid);

commit;
```

- [ ] **Step 3: 문법 검증 (적용 없이)**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select 1"}'
```
Expected: `[{"?column?":1}]` — 토큰 경로가 살아 있음을 먼저 확인한다. SQL 자체는 Task 2 에서 트랜잭션으로 적용하며, 검증 블록이 실패하면 자동으로 되돌아간다.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0051_authz_roles.sql supabase/migrations/0051_authz_roles_rollback.sql
git commit -m "$(cat <<'EOF'
feat(db): 0051 권한 2축 도입 — 컬럼을 더하기만 해서 무중단 배포를 만든다

memberships.role 을 새 값으로 갈아엎으면 이 마이그레이션 적용부터 코드 배포까지
기존 비교식 75곳이 전부 실패해 41명 전원이 권한을 잃는다. role 은 그대로 두고
is_superuser 컬럼과 project_roles 테이블을 더한다.

app_role() 은 shim 으로 재정의해 기존 쓰기 정책 46개의 의미를 보존한다.
guard_team_editor_actual_only 는 역할 문자열이 'team_editor' 일 때만 컬럼을
제한하는 fail-open 이었다 — 판정을 뒤집어 관리자가 아니면 제한하도록 바꾼다.

Preview-checked: n/a — 마이그레이션 파일만 추가
EOF
)"
```

---

## Task 2: 0051 프로덕션 적용 및 검증

**Files:**
- 없음 (DB 작업)

**Interfaces:**
- Consumes: Task 1 의 `0051_authz_roles.sql`
- Produces: 프로덕션에 배포된 헬퍼·테이블·백필 데이터

- [ ] **Step 1: 적용 전 스냅샷 기록**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select t.code, m.role, count(*) from memberships m join teams t on t.id=m.team_id group by 1,2 order by 2,1"}'
```
Expected: `pmo_admin` PMO 14 / MES 11 / ERP 2 / 가공 1, `team_editor` ERP 9 / MES 4.
이 값이 다르면 **멈추고 사람에게 보고한다** — 0051 의 검증 블록 기대값(14/2)이 그 전제 위에 있다.

- [ ] **Step 2: 0051 적용**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data "$(python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/0051_authz_roles.sql').read()}))")"
```
Expected: 에러 없음. `0051 중단:` 문구가 나오면 트랜잭션이 통째로 되돌아간 것이므로 원인을 고쳐 다시 적용한다.

- [ ] **Step 3: 백필 결과 검증**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select (select count(*) from memberships where is_superuser) su, (select count(*) from project_roles where role=''admin'') admins, (select count(*) from project_roles where role=''member'') members"}'
```
Expected: `{"su":2,"admins":14,"members":27}`
(관리자 14 = PMO팀 pmo_admin 14명 전원. 이 중 2명이 슈퍼유저를 겸한다 — 스펙 §3.7)

- [ ] **Step 4: 헬퍼·트리거 정의 검증**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select proname from pg_proc where proname in (''is_superuser'',''is_project_admin'',''is_project_member'',''can_read_project'',''guard_non_admin_column_scope'',''guard_team_editor_actual_only'') order by 1"}'
```
Expected: `is_project_admin`, `is_project_member`, `is_superuser`, `can_read_project`, `guard_non_admin_column_scope` 5개. **`guard_team_editor_actual_only` 는 없어야 한다** — 남아 있으면 옛 트리거가 함께 도는 상태다.

- [ ] **Step 5: 기존 코드가 여전히 동작하는지 확인 (무중단 검증)**

Run: `npm run build`
Expected: PASS — 코드는 아직 `memberships.role` 을 읽고, 그 컬럼은 그대로 살아 있다.

프로덕션 화면에서 WBS 실적 입력 한 건이 정상 동작하는지 사람이 확인한다.
(쓰기 검증은 D-CUBE 데이터 보호 원칙상 **에이전트가 하지 않는다** — 사람에게 요청한다.)

---

## Task 3: 순수 판정 모듈 `src/lib/domain/authz.ts`

**Files:**
- Create: `src/lib/domain/authz.ts`
- Test: `tests/domain/authz.test.ts`

**Interfaces:**
- Consumes: `TeamCode` from `@/lib/domain/types`
- Produces:
  - `type ProjectRole = 'admin' | 'member'`
  - `type EffectiveRole = 'superuser' | 'admin' | 'member' | 'viewer'`
  - `interface Actor { userId: string; teamCode: TeamCode | null; teamId: string | null; isSuperuser: boolean; projectRoles: ReadonlyMap<string, ProjectRole> }`
  - `function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null`
  - `function isProjectAdmin(actor: Actor | null, projectId: string | null): boolean`
  - `function isProjectMember(actor: Actor | null, projectId: string | null): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/authz.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { roleIn, isProjectAdmin, isProjectMember, type Actor } from '@/lib/domain/authz'

const P = 'proj-1'
const Q = 'proj-2'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), ...over,
})

const superuser = actor({ isSuperuser: true })
const admin = actor({ projectRoles: new Map([[P, 'admin' as const]]) })
const member = actor({ projectRoles: new Map([[P, 'member' as const]]) })
const viewer = actor({})

describe('roleIn', () => {
  it('비로그인은 null', () => {
    expect(roleIn(null, P)).toBe(null)
  })
  it('슈퍼유저는 어느 프로젝트에서도 superuser', () => {
    expect(roleIn(superuser, P)).toBe('superuser')
    expect(roleIn(superuser, Q)).toBe('superuser')
  })
  it('관리자는 지정된 프로젝트에서만 admin, 다른 프로젝트에서는 viewer', () => {
    expect(roleIn(admin, P)).toBe('admin')
    expect(roleIn(admin, Q)).toBe('viewer')
  })
  it('멤버는 지정된 프로젝트에서만 member', () => {
    expect(roleIn(member, P)).toBe('member')
    expect(roleIn(member, Q)).toBe('viewer')
  })
  it('역할이 없으면 viewer', () => {
    expect(roleIn(viewer, P)).toBe('viewer')
  })
  // 프로젝트 미지정 대상(예: project_id 가 null 인 회의록)은 프로젝트로 판정할 수 없다.
  // 슈퍼유저만 superuser 로 보고 나머지는 viewer — fail-closed.
  it('projectId 가 null 이면 슈퍼유저 외 전원 viewer', () => {
    expect(roleIn(superuser, null)).toBe('superuser')
    expect(roleIn(admin, null)).toBe('viewer')
    expect(roleIn(member, null)).toBe('viewer')
  })
})

describe('isProjectAdmin', () => {
  it('슈퍼유저·해당 프로젝트 관리자만 true', () => {
    expect(isProjectAdmin(superuser, P)).toBe(true)
    expect(isProjectAdmin(admin, P)).toBe(true)
    expect(isProjectAdmin(admin, Q)).toBe(false)
    expect(isProjectAdmin(member, P)).toBe(false)
    expect(isProjectAdmin(viewer, P)).toBe(false)
    expect(isProjectAdmin(null, P)).toBe(false)
  })
})

describe('isProjectMember', () => {
  it('멤버 이상이면 true (관리자·슈퍼유저 포함)', () => {
    expect(isProjectMember(superuser, P)).toBe(true)
    expect(isProjectMember(admin, P)).toBe(true)
    expect(isProjectMember(member, P)).toBe(true)
    expect(isProjectMember(viewer, P)).toBe(false)
    expect(isProjectMember(null, P)).toBe(false)
  })
  it('다른 프로젝트에는 전이되지 않는다', () => {
    expect(isProjectMember(member, Q)).toBe(false)
    expect(isProjectMember(admin, Q)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/domain/authz.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/domain/authz"`

- [ ] **Step 3: 구현**

`src/lib/domain/authz.ts`:

```ts
// 권한 판정의 순수 계층 — IO·부수효과 없음. 서버 액션과 UI 어포던스가 같은 규칙을 쓰도록 공유한다.
// 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md
import type { TeamCode } from './types'

/** project_roles.role 값. '조회 전용'은 값이 아니라 행의 부재로 표현한다. */
export type ProjectRole = 'admin' | 'member'

/** 특정 프로젝트에서의 유효 역할. viewer = 프로젝트 역할이 없는 로그인 사용자. */
export type EffectiveRole = 'superuser' | 'admin' | 'member' | 'viewer'

/** 로그인 사용자의 권한 스냅샷. getActor() 가 조립한다. */
export interface Actor {
  userId: string
  teamCode: TeamCode | null
  teamId: string | null
  isSuperuser: boolean
  /** projectId → role. 없는 키 = 그 프로젝트에서는 조회 전용. */
  projectRoles: ReadonlyMap<string, ProjectRole>
}

/**
 * 이 사용자가 이 프로젝트에서 갖는 유효 역할. 비로그인은 null.
 *
 * projectId 가 null 인 경우(프로젝트 미지정 회의록 등)는 프로젝트로 판정할 수 없으므로
 * 슈퍼유저 외 전원을 viewer 로 본다 — fail-closed. 호출부는 이 경우 '작성자 본인'
 * 같은 별도 조건과 OR 로 결합해야 한다.
 */
export function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null {
  if (!actor) return null
  if (actor.isSuperuser) return 'superuser'
  if (!projectId) return 'viewer'
  return actor.projectRoles.get(projectId) ?? 'viewer'
}

/** 관리자 이상(슈퍼유저 포함). 등록·수정·삭제 전권. */
export function isProjectAdmin(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId)
  return r === 'superuser' || r === 'admin'
}

/** 멤버 이상. 회의·회의록·주간보고·이슈·근태·첨부 쓰기의 최소 자격. */
export function isProjectMember(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId)
  return r === 'superuser' || r === 'admin' || r === 'member'
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/domain/authz.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/domain/authz.ts tests/domain/authz.test.ts
git commit -m "$(cat <<'EOF'
feat(authz): 권한 판정의 순수 계층 — 서버와 화면이 같은 규칙을 보게 한다

지금은 pmo_admin 비교식이 75곳에 흩어져 있어 서버 게이트와 UI 어포던스가
따로 논다. 판정을 순수 함수로 모아 양쪽이 같은 것을 부르게 한다.

projectId 가 null 인 대상(프로젝트 미지정 회의록)은 프로젝트로 판정할 수
없으므로 슈퍼유저 외 전원 viewer 로 본다 — fail-closed.

Preview-checked: n/a — 순수 모듈·테스트만 추가
EOF
)"
```

---

## Task 4: 서버 가드 `src/lib/authz.ts`

**Files:**
- Create: `src/lib/authz.ts`
- Test: `tests/authz/guards.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `Actor`·`isProjectAdmin`·`isProjectMember`; `createServerClient` from `@/lib/supabase/server`
- Produces:
  - `type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }`
  - `async function getActor(): Promise<Actor | null>`
  - `async function requireSuperuser(): Promise<GuardResult>`
  - `async function requireProjectAdmin(projectId: string | null): Promise<GuardResult>`
  - `async function requireProjectMember(projectId: string | null): Promise<GuardResult>`
  - `type ProjectScopedTable = 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records' | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'`
  - `async function resolveProjectId(table: ProjectScopedTable, id: string): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }>`

**에러 문구 규약(고정):**
- 권한 판정 거부 → `'권한 없음'` (기존 테스트·UI 문구와 일치)
- 로그인 없음 → `'로그인 필요'`
- 조회 실패 → `'권한을 확인할 수 없어 중단했습니다.'` + `console.error`
- 대상 없음 → `'대상을 찾을 수 없습니다.'`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/authz/guards.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase 서버 클라이언트를 모킹해 가드 로직만 검증한다.
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { mockClient } = vi.hoisted(() => ({ mockClient: { auth: { getUser: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => mockClient) }))

import { getActor, requireSuperuser, requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'

const USER = { id: 'u1', email: 'a@b.com' }

/** memberships 단건 조회와 project_roles 목록 조회를 순서대로 흉내낸다. */
function stubDb(opts: {
  membership?: { is_superuser: boolean; teams: { code: string; id: string } } | null
  membershipError?: { message: string } | null
  roles?: { project_id: string; role: string }[] | null
  rolesError?: { message: string } | null
}) {
  mockClient.auth.getUser.mockResolvedValue({ data: { user: USER } })
  mockClient.from.mockImplementation((table: string) => {
    if (table === 'memberships') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: opts.membership ?? null, error: opts.membershipError ?? null }) }) }) }
    }
    if (table === 'project_roles') {
      return { select: () => ({ eq: async () => ({
        data: opts.roles ?? null, error: opts.rolesError ?? null }) }) }
    }
    throw new Error(`예상치 못한 테이블: ${table}`)
  })
}

beforeEach(() => { mockClient.from.mockReset(); mockClient.auth.getUser.mockReset() })

describe('getActor', () => {
  it('비로그인은 null', async () => {
    mockClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect(await getActor()).toBe(null)
  })

  it('멤버십과 프로젝트 역할을 합쳐 Actor 를 만든다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: [{ project_id: 'p1', role: 'admin' }, { project_id: 'p2', role: 'member' }],
    })
    const a = await getActor()
    expect(a?.userId).toBe('u1')
    expect(a?.teamCode).toBe('ERP')
    expect(a?.isSuperuser).toBe(false)
    expect(a?.projectRoles.get('p1')).toBe('admin')
    expect(a?.projectRoles.get('p2')).toBe('member')
  })

  // 조회 실패를 '역할 없음'으로 폴백하면 가드가 조용히 전원을 거부하거나(운영 마비)
  // 반대로 실패를 성공처럼 흘려보낸다. 실패는 예외로 드러낸다.
  it('project_roles 조회가 실패하면 예외를 던진다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't9' } },
      roles: null, rolesError: { message: 'boom' },
    })
    await expect(getActor()).rejects.toThrow(/권한 정보/)
  })
})

describe('requireSuperuser', () => {
  it('슈퍼유저는 통과', async () => {
    stubDb({ membership: { is_superuser: true, teams: { code: 'PMO', id: 't1' } }, roles: [] })
    const r = await requireSuperuser()
    expect(r.ok).toBe(true)
  })
  it('관리자는 거부', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect(await requireSuperuser()).toEqual({ ok: false, error: '권한 없음' })
  })
  it('비로그인은 로그인 필요', async () => {
    mockClient.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect(await requireSuperuser()).toEqual({ ok: false, error: '로그인 필요' })
  })
})

describe('requireProjectAdmin / requireProjectMember', () => {
  it('관리자는 admin·member 가드 모두 통과', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect((await requireProjectAdmin('p1')).ok).toBe(true)
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('멤버는 admin 가드에서 거부, member 가드는 통과', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't2' } },
      roles: [{ project_id: 'p1', role: 'member' }],
    })
    expect(await requireProjectAdmin('p1')).toEqual({ ok: false, error: '권한 없음' })
    stubDb({
      membership: { is_superuser: false, teams: { code: 'ERP', id: 't2' } },
      roles: [{ project_id: 'p1', role: 'member' }],
    })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('다른 프로젝트 관리자는 거부 — 프로젝트 스코프', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: [{ project_id: 'p1', role: 'admin' }],
    })
    expect(await requireProjectAdmin('p2')).toEqual({ ok: false, error: '권한 없음' })
  })

  it('조회 실패는 통과시키지 않고 사유를 구분해 돌려준다', async () => {
    stubDb({
      membership: { is_superuser: false, teams: { code: 'PMO', id: 't1' } },
      roles: null, rolesError: { message: 'boom' },
    })
    expect(await requireProjectAdmin('p1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
  })
})

describe('resolveProjectId', () => {
  it('행의 project_id 를 돌려준다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'p1' }, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({ ok: true, projectId: 'p1' })
  })

  it('행이 없으면 대상을 찾을 수 없음', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '대상을 찾을 수 없습니다.',
    })
  })

  // 3원칙 ②: 쓰기 전 선행 조회가 실패하면 중단한다.
  it('조회가 실패하면 중단한다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/authz/guards.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/authz"`

- [ ] **Step 3: 구현**

`src/lib/authz.ts`:

```ts
import { createServerClient } from './supabase/server'
import {
  isProjectAdmin as pureIsProjectAdmin,
  isProjectMember as pureIsProjectMember,
  type Actor, type ProjectRole,
} from './domain/authz'
import type { TeamCode } from './domain/types'

export type { Actor, ProjectRole }

export type GuardResult = { ok: true; actor: Actor } | { ok: false; error: string }

const ERR_LOOKUP = '권한을 확인할 수 없어 중단했습니다.'
const ERR_DENIED = '권한 없음'
const ERR_ANON = '로그인 필요'
const ERR_MISSING = '대상을 찾을 수 없습니다.'

/**
 * 로그인 사용자의 권한 스냅샷을 조립한다. 비로그인은 null.
 *
 * 조회 실패는 throw 한다 — '역할 없음'으로 폴백하면 그 순간 전원이 조회 전용으로
 * 보이고(운영 마비), 반대로 관대하게 폴백하면 가드가 통째로 뚫린다. 어느 쪽도 조용해서는 안 된다.
 */
export async function getActor(): Promise<Actor | null> {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null

  const { data: mem, error: memErr } = await sb
    .from('memberships')
    .select('is_superuser, teams(code, id)')
    .eq('user_id', u.user.id)
    .maybeSingle()
  if (memErr) {
    console.error('[getActor] 멤버십 조회 실패:', memErr.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + memErr.message)
  }

  const { data: roles, error: rolesErr } = await sb
    .from('project_roles')
    .select('project_id, role')
    .eq('user_id', u.user.id)
  if (rolesErr || !roles) {
    console.error('[getActor] 프로젝트 역할 조회 실패:', rolesErr?.message)
    throw new Error('권한 정보를 불러오지 못했습니다: ' + (rolesErr?.message ?? 'unknown'))
  }

  const team = (mem?.teams ?? null) as unknown as { code: TeamCode; id: string } | null
  const map = new Map<string, ProjectRole>()
  for (const r of roles) map.set(r.project_id as string, r.role as ProjectRole)

  return {
    userId: u.user.id,
    teamCode: team?.code ?? null,
    teamId: team?.id ?? null,
    isSuperuser: Boolean(mem?.is_superuser),
    projectRoles: map,
  }
}

/** getActor 의 throw 를 GuardResult 로 감싼다 — 액션은 예외가 아니라 결과로 응답한다. */
async function actorOrError(): Promise<GuardResult> {
  let actor: Actor | null
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!actor) return { ok: false, error: ERR_ANON }
  return { ok: true, actor }
}

/** 전역 관리(프로젝트 생성·삭제, 관리자 지정, 팀 기준정보, LLM 설정, 봇 재색인). */
export async function requireSuperuser(): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return r.actor.isSuperuser ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 관리자 이상. */
export async function requireProjectAdmin(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return pureIsProjectAdmin(r.actor, projectId) ? r : { ok: false, error: ERR_DENIED }
}

/** 해당 프로젝트의 멤버 이상. */
export async function requireProjectMember(projectId: string | null): Promise<GuardResult> {
  const r = await actorOrError()
  if (!r.ok) return r
  return pureIsProjectMember(r.actor, projectId) ? r : { ok: false, error: ERR_DENIED }
}

/** project_id 컬럼을 직접 가진 테이블 화이트리스트 — 임의 테이블 조회를 막는다. */
export type ProjectScopedTable =
  | 'wbs_items' | 'meetings' | 'issues' | 'minutes' | 'attendance_records'
  | 'announcements' | 'weekly_reports' | 'project_members' | 'task_dependencies'

/**
 * 대상 행에서 project_id 를 읽어 온다. projectId 를 인자로 받지 않는 액션이 판정 전에 쓴다.
 * 조회 실패는 쓰기 중단 사유다(3원칙 ②). minutes.project_id 는 nullable 이므로
 * ok:true 이면서 projectId 가 null 일 수 있다 — 호출부가 그 분기를 명시적으로 처리해야 한다.
 */
export async function resolveProjectId(
  table: ProjectScopedTable, id: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false; error: string }> {
  const sb = await createServerClient()
  const { data, error } = await sb.from(table).select('project_id').eq('id', id).maybeSingle()
  if (error) {
    console.error(`[resolveProjectId] ${table} 조회 실패:`, error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: ERR_MISSING }
  return { ok: true, projectId: (data.project_id as string | null) ?? null }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/authz/guards.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/authz.ts tests/authz/guards.test.ts
git commit -m "$(cat <<'EOF'
feat(authz): 서버 가드 3종 — 조회 실패와 권한 없음을 같은 문구로 뭉개지 않는다

액션 105개가 각자 게이트를 적던 것을 requireSuperuser/ProjectAdmin/ProjectMember
셋으로 모은다. 권한 조회가 깨졌을 때 '역할 없음'으로 폴백하면 그 순간 전원이
조회 전용으로 보이거나 반대로 가드가 통째로 뚫린다 — 실패는 별도 문구로 드러낸다.

projectId 를 인자로 받지 않는 액션을 위해 resolveProjectId 를 둔다.
선행 조회가 실패하면 쓰기를 중단한다.

Preview-checked: n/a — 서버 모듈·테스트만 추가
EOF
)"
```

---

## Task 5: `permissions.ts` 를 Actor 시그니처로 이행

**Files:**
- Modify: `src/lib/domain/permissions.ts` (전면 교체)
- Modify: `tests/domain/permissions.test.ts` (전면 교체)
- Modify: 호출부 — `src/components/wbs/*`, `src/app/(app)/p/[projectId]/**` 중 `canEditActual`/`canEditWeight`/`canEditDeliverable` 사용처

**Interfaces:**
- Consumes: Task 3 의 `Actor`, `isProjectAdmin`, `isProjectMember`
- Produces:
  - `canEditActual(item: ComputedItem, actor: Actor | null, projectId: string): boolean`
  - `canEditWeight(actor: Actor | null, projectId: string): boolean`
  - `canEditDeliverable(item: ComputedItem, actor: Actor | null, projectId: string): boolean`

- [ ] **Step 1: 호출부 목록 확보**

Run: `rg -n "canEditActual|canEditWeight|canEditDeliverable" src --glob '!*.test.*'`
Expected: 호출부 파일 목록. 이 목록을 Step 4 에서 전부 고친다.

- [ ] **Step 2: 테스트를 새 시그니처로 교체**

`tests/domain/permissions.test.ts` 를 통째로 아래로 바꾼다.

```ts
import { describe, it, expect } from 'vitest'
import { canEditActual, canEditWeight, canEditDeliverable } from '@/lib/domain/permissions'
import type { Actor } from '@/lib/domain/authz'
import type { ComputedItem } from '@/lib/domain/types'

const P = 'proj-1'

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1', teamCode: 'PMO', teamId: 't1', isSuperuser: false,
  projectRoles: new Map(), ...over,
})
const superuser = actor({ isSuperuser: true })
const admin = actor({ projectRoles: new Map([[P, 'admin' as const]]) })
const gagongMember = actor({ teamCode: '가공', teamId: 'd', projectRoles: new Map([[P, 'member' as const]]) })
const viewer = actor({ teamCode: '가공', teamId: 'd' })

const item = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'a', parentId: null, level: 'activity', code: 'a', sortOrder: 1, name: 'a',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: 0,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

describe('canEditActual', () => {
  it('비로그인은 불가', () => {
    expect(canEditActual(item({}), null, P)).toBe(false)
  })
  it('관리자·슈퍼유저는 담당이 없는 말단도 편집 가능', () => {
    expect(canEditActual(item({ owners: [] }), admin, P)).toBe(true)
    expect(canEditActual(item({ owners: [] }), superuser, P)).toBe(true)
  })
  // 롤업(computeNode)이 자식 유무로 말단을 판정하므로, 자식 없는 task/phase 도 자기
  // actual_pct 를 그대로 상위로 올린다. 입력을 막으면 그 항목은 영영 0% 로 남는다.
  it('자식 없는 task/phase(단독 항목)도 편집 가능', () => {
    expect(canEditActual(item({ level: 'task' }), admin, P)).toBe(true)
    expect(canEditActual(item({ level: 'phase' }), admin, P)).toBe(true)
  })
  it('멤버는 자기 팀 담당(primary/support)만 가능', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'support' }] }), gagongMember, P)).toBe(true)
    expect(canEditActual(item({ owners: [{ team: 'ERP', kind: 'primary' }] }), gagongMember, P)).toBe(false)
    expect(canEditActual(item({ owners: [] }), gagongMember, P)).toBe(false)
  })
  it('조회 전용은 담당 팀이어도 불가', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), viewer, P)).toBe(false)
  })
  it('다른 프로젝트의 멤버는 불가', () => {
    expect(canEditActual(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, 'proj-2')).toBe(false)
  })
  it('자식이 있으면(롤업 항목) 불가 — level 무관', () => {
    expect(canEditActual(item({ children: [item({})] }), admin, P)).toBe(false)
    expect(canEditActual(item({ level: 'task', children: [item({})] }), admin, P)).toBe(false)
    expect(canEditActual(item({ level: 'phase', children: [item({})] }), superuser, P)).toBe(false)
  })
})

describe('canEditWeight', () => {
  it('관리자 이상만 가능', () => {
    expect(canEditWeight(superuser, P)).toBe(true)
    expect(canEditWeight(admin, P)).toBe(true)
    expect(canEditWeight(gagongMember, P)).toBe(false)
    expect(canEditWeight(viewer, P)).toBe(false)
    expect(canEditWeight(null, P)).toBe(false)
  })
})

describe('canEditDeliverable', () => {
  it('관리자 이상은 상위 항목도 가능', () => {
    expect(canEditDeliverable(item({ children: [item({})] }), admin, P)).toBe(true)
  })
  it('멤버는 말단 + 자기 팀 담당만', () => {
    expect(canEditDeliverable(item({ owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(true)
    expect(canEditDeliverable(item({ children: [item({})], owners: [{ team: '가공', kind: 'primary' }] }), gagongMember, P)).toBe(false)
  })
  it('조회 전용은 불가', () => {
    expect(canEditDeliverable(item({ owners: [{ team: '가공', kind: 'primary' }] }), viewer, P)).toBe(false)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/domain/permissions.test.ts`
Expected: FAIL — 인자 개수 불일치 / `Membership` 타입 오류

- [ ] **Step 4: `permissions.ts` 구현**

`src/lib/domain/permissions.ts` 를 통째로 아래로 바꾼다.

```ts
import type { ComputedItem } from './types'
import { isProjectAdmin, isProjectMember, type Actor } from './authz'

/**
 * 실적% 편집 권한 (순수). UI 어포던스 게이팅과 서버 재검증이 같은 규칙을 쓰도록 공유한다.
 * 규칙: 말단(자식 없는) 항목만 + 관리자 이상은 전체, 멤버는 자기 팀이 담당(primary/support)인 항목만.
 *
 * 말단 판정 기준은 level 이 아니라 자식 유무다 — 롤업(computeNode)이 children.length===0 인
 * 노드의 actualPct 를 그대로 rolledActualPct 로 쓰기 때문. level==='activity' 로 게이팅하면
 * 자식 없는 Task(예: "1-3. 프로젝트 착수 보고회")가 롤업엔 0% 로 반영되는데 입력은 막히는
 * 모순이 생긴다. 상위(롤업) 항목은 항상 false — 서버 updateActual 도 자식이 있으면 거부한다.
 */
export function canEditActual(item: ComputedItem, actor: Actor | null, projectId: string): boolean {
  if (item.children.length > 0) return false
  if (isProjectAdmin(actor, projectId)) return true
  if (!isProjectMember(actor, projectId)) return false
  return item.owners.some(o => o.team === actor!.teamCode)
}

/** 가중치 편집 권한 — 구조/롤업 영향이라 관리자 이상만. */
export function canEditWeight(actor: Actor | null, projectId: string): boolean {
  return isProjectAdmin(actor, projectId)
}

/** 산출물 텍스트 편집 권한 — 관리자 이상은 전체. 멤버는 실적%와 동일 조건(말단+자기 담당)만.
 *  말단 제약은 프로덕션 RLS(team_update_actual: wbs_is_leaf + 담당) 때문 — 비말단은 UPDATE 정책이
 *  없어 조용한 no-op 이 되므로 어포던스를 열지 않는다. 컬럼 가드는 0028 이 deliverable 을 허용한다. */
export function canEditDeliverable(item: ComputedItem, actor: Actor | null, projectId: string): boolean {
  if (isProjectAdmin(actor, projectId)) return true
  if (item.children.length > 0) return false
  if (!isProjectMember(actor, projectId)) return false
  return item.owners.some(o => o.team === actor!.teamCode)
}
```

- [ ] **Step 5: 호출부를 새 시그니처로 고친다**

Step 1 목록의 각 호출부에서:
- `membership` 을 넘기던 자리에 `actor` 를 넘긴다 (페이지 컴포넌트는 `getMembership()` → `getActor()` 로 교체).
- 세 함수 모두 마지막 인자로 `projectId` 를 추가한다. 프로젝트 화면이므로 `params.projectId` 가 이미 있다.
- 클라이언트 컴포넌트에 `Actor` 를 props 로 내려야 하면 `Map` 은 직렬화되지 않는다. 서버에서 필요한 boolean 만 계산해 내려보낸다(예: `canEditWeight` 결과). **`Actor` 자체를 클라이언트 컴포넌트 props 로 넘기지 않는다.**

- [ ] **Step 6: 테스트·빌드 확인**

Run: `npx vitest run tests/domain/permissions.test.ts && npm run build && npm run lint`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/permissions.ts tests/domain/permissions.test.ts <Step 1 에서 찾은 호출부 파일들>
git commit -m "$(cat <<'EOF'
refactor(authz): WBS 편집 판정을 Actor·프로젝트 인자로 이행

같은 팀이라도 프로젝트 역할이 없으면 실적을 못 쓴다 — 지금은 팀만 맞으면
통과했다. 판정에 projectId 를 넣어야 이 구분이 생긴다.

Map 은 직렬화되지 않으므로 Actor 를 클라이언트 컴포넌트 props 로 내리지 않는다.
서버에서 boolean 만 계산해 넘긴다.

Preview-checked: n/a — WBS 화면 로직만, 전역 레이아웃 무변경
EOF
)"
```

---

## Task 6: 회의록 액션 27개 가드 교체 (최우선)

**Files:**
- Modify: `src/app/actions/minutes.ts`
- Test: `tests/actions/authz-gate.test.ts` (신규 — 이 태스크에서 만들고 이후 태스크가 확장)

**Interfaces:**
- Consumes: Task 4 의 `requireProjectAdmin`/`requireProjectMember`/`resolveProjectId`/`getActor`
- Produces: 없음 (내부 교체)

**왜 최우선인가:** `minutes` 는 RLS 쓰기 정책이 0개이고 앱이 `createAdminClient()`(service_role)로 쓴다. service_role 은 RLS 를 우회하므로 **이 파일의 가드가 유일한 방어선**이다. 스펙 §1.5.

**액션별 목표 가드**

| 액션 | 가드 | projectId 출처 |
|---|---|---|
| `createMinute` | `requireProjectMember` | 인자 |
| `updateMinuteMeta` | 작성자 본인 **또는** `requireProjectAdmin` | `resolveProjectId('minutes', id)` |
| `assignMinutesProject` | `requireProjectAdmin` | 대상 프로젝트 인자 |
| `resetMinuteExternalId` | `requireProjectAdmin` | `resolveProjectId('minutes', id)` |
| `replaceMinuteBody` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId` |
| `recordMinuteFile`, `removeMinuteFile` | 작성자 본인 또는 `requireProjectAdmin` | 부모 minute |
| `deleteMinute` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId` |
| `createMinuteFolder`, `renameMinuteFolder`, `deleteMinuteFolder`, `moveMinuteFolder`, `moveMinuteToFolder` | `requireProjectAdmin` (시드 폴더는 `requireSuperuser`) | 폴더의 프로젝트 |
| `toggleMinuteFavorite`, `toggleMinuteHighlight` | `requireProjectMember` | `resolveProjectId` |
| `ensureMinuteInsightsAction` | `requireProjectMember` | `resolveProjectId` |
| `setMinuteShare` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId` |
| `getMinuteShare`, `getMinuteFileUrl` | `requireProjectMember` | `resolveProjectId` |
| `fetchMinuteDetail`, `fetchMinuteFoldersLite`, `fetchProjectMeetingsLite`, `fetchMeetingMinutesLite`, `fetchMinutesRange`, `fetchMinutesSearch`, `fetchMinutesExplorer`, `fetchMinuteFavorites` | 조회 — `getActor()` 로 로그인만 확인 (D6: 조회 전면 개방) | — |

**`project_id` 가 null 인 회의록:** `roleIn(actor, null)` 은 슈퍼유저 외 전원 `viewer` 다. 따라서 프로젝트 미지정 회의록의 수정·삭제는 **작성자 본인 또는 슈퍼유저**만 통과한다. 이 분기를 코드 주석으로 명시한다.

- [ ] **Step 1: 실패하는 게이트 테스트 작성**

`tests/actions/authz-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createAdminClient, requireProjectMember, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => { throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다') }),
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember, requireProjectAdmin, resolveProjectId,
  requireSuperuser: vi.fn(), getActor: vi.fn(),
}))

import { createMinute, deleteMinute } from '@/app/actions/minutes'

const DENIED = { ok: false as const, error: '권한 없음' }
const LOOKUP_FAIL = { ok: false as const, error: '권한을 확인할 수 없어 중단했습니다.' }

beforeEach(() => {
  createAdminClient.mockClear()
  requireProjectMember.mockReset()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
})

describe('회의록 액션 권한 게이트 — RLS 2차 방어선이 없는 경로', () => {
  it('조회 전용은 createMinute 거부 — admin client 에 닿지 않는다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await createMinute({ projectId: 'p1', title: 't', body: 'b' } as never)
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회가 실패하면 createMinute 을 중단한다', async () => {
    requireProjectMember.mockResolvedValue(LOOKUP_FAIL)
    const res = await createMinute({ projectId: 'p1', title: 't', body: 'b' } as never)
    expect(res).toMatchObject({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('deleteMinute 은 대상의 project_id 를 먼저 조회하고, 조회 실패면 중단한다', async () => {
    resolveProjectId.mockResolvedValue(LOOKUP_FAIL)
    const res = await deleteMinute('m1')
    expect(res).toMatchObject({ ok: false })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts`
Expected: FAIL — `minutes.ts` 가 아직 `@/lib/authz` 를 쓰지 않아 모킹이 걸리지 않고, `getMembership` 미모킹으로 실패

- [ ] **Step 3: `minutes.ts` 교체**

파일 상단 import 를 바꾼다.

```ts
// 변경 전
import { getMembership, getSession } from '@/lib/auth'
// 변경 후
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, requireProjectMember, requireSuperuser, resolveProjectId, getActor } from '@/lib/authz'
```

각 액션의 게이트를 위 표대로 바꾼다. 대표 형태 둘:

```ts
// (a) projectId 를 인자로 받는 경우 — createMinute
export async function createMinute(input: MinuteInput): Promise<MinuteActionResult> {
  const g = await requireProjectMember(input.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const userId = g.actor.userId
  // …이하 기존 본문. getMembership()/getSession() 재조회를 지운다.
}

// (b) 대상 행에서 project_id 를 끌어와야 하는 경우 — deleteMinute
export async function deleteMinute(id: string): Promise<MinuteActionResult> {
  // 쓰기 전 선행 조회가 실패하면 중단한다(에러 처리 3원칙 ②).
  const found = await resolveProjectId('minutes', id)
  if (!found.ok) return { ok: false, error: found.error }

  // project_id 가 null 인 회의록(미지정)은 프로젝트로 판정할 수 없다.
  // roleIn(actor, null) 이 슈퍼유저 외 전원 viewer 이므로,
  // 이 경우 통과 조건은 '작성자 본인 또는 슈퍼유저'로 좁혀진다 — 의도된 fail-closed.
  const g = await requireProjectAdmin(found.projectId)
  const actor = g.ok ? g.actor : await getActor()
  if (!g.ok && !actor) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const { data: row, error: rowErr } = await sb
    .from('minutes').select('created_by').eq('id', id).maybeSingle()
  if (rowErr) {
    console.error('[deleteMinute] 소유자 조회 실패:', rowErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  const isOwner = row?.created_by === actor?.userId
  if (!g.ok && !isOwner) return { ok: false, error: '권한 없음' }
  // …이하 기존 삭제 본문
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts && npm run test`
Expected: 신규 3건 PASS. 기존 테스트 중 `getMembership` 을 모킹하던 회의록 테스트가 깨지면 `@/lib/authz` 모킹으로 함께 고친다.

- [ ] **Step 5: 잔여 `getMembership` 확인**

Run: `rg -n "getMembership|pmo_admin" src/app/actions/minutes.ts`
Expected: 출력 없음 — 남아 있으면 교체가 덜 된 것이다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/minutes.ts tests/actions/authz-gate.test.ts
git commit -m "$(cat <<'EOF'
refactor(authz): 회의록 액션 27개를 새 가드로 — 여기엔 RLS 2차 방어선이 없다

minutes 는 프로덕션에 쓰기 정책이 0개이고 앱이 service_role 로 쓴다.
service_role 은 RLS 를 우회하므로 이 파일의 게이트가 유일한 방어선이다.
그래서 다른 어떤 파일보다 먼저 옮긴다.

project_id 가 null 인 회의록은 프로젝트로 판정할 수 없다. 통과 조건이
'작성자 본인 또는 슈퍼유저'로 좁혀지는 것은 의도된 fail-closed 다.

Preview-checked: n/a — 서버 액션만, 화면 무변경
EOF
)"
```

---

## Task 7: WBS·프로젝트 액션 가드 교체

**Files:**
- Modify: `src/app/actions/wbs.ts`, `src/app/actions/project.ts`, `src/app/api/import/route.ts`
- Test: `tests/actions/authz-gate.test.ts` (확장)

**Interfaces:**
- Consumes: Task 4 가드, Task 5 의 `canEditActual`/`canEditDeliverable`
- Produces: 없음

**액션별 목표 가드**

| 파일 | 액션 | 가드 | projectId 출처 |
|---|---|---|---|
| `wbs.ts` | `getChangeLogs` | 로그인만 (`getActor`) | — |
| | `updateActual` | `requireProjectMember` + `canEditActual` 재검증 | `resolveProjectId('wbs_items', itemId)` |
| | `updateDeliverable` | `requireProjectMember` + `canEditDeliverable` 재검증 | `resolveProjectId('wbs_items', itemId)` |
| | `updateWeight`, `addWbsItem`, `addSubAct`, `updateWbsFields`, `deleteWbsItem`, `moveWbsItem` | `requireProjectAdmin` | `addWbsItem` 은 인자, 나머지는 `resolveProjectId('wbs_items', …)` |
| | `addTaskDependency` | `requireProjectAdmin` | 인자 |
| | `removeTaskDependency` | `requireProjectAdmin` | `resolveProjectId('task_dependencies', dependencyId)` |
| `project.ts` | `listProjects` | 로그인만 | — |
| | `createProject` | `requireSuperuser` | — |
| | `updateProject`, `setBaseDate`, `addHoliday`, `removeHoliday` | `requireProjectAdmin` | 인자 |
| `api/import/route.ts` | POST | `requireProjectAdmin` | 요청 본문의 projectId |

`addSubAct(actId, …)` 는 `actId` 가 `wbs_items.id` 이므로 `resolveProjectId('wbs_items', actId)` 를 쓴다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/authz-gate.test.ts` 의 `import` 줄에 `updateActual`, `updateWeight` 를 추가하고 아래 describe 를 덧붙인다.

```ts
import { updateActual, updateWeight } from '@/app/actions/wbs'

describe('WBS 액션 권한 게이트', () => {
  it('조회 전용은 updateActual 거부', async () => {
    resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
    requireProjectMember.mockResolvedValue(DENIED)
    expect(await updateActual('i1', 50)).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('멤버는 updateWeight 거부 — 가중치는 관리자 이상', async () => {
    resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
    requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await updateWeight('i1', 10)).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('대상 항목이 없으면 updateActual 을 중단한다', async () => {
    resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(await updateActual('nope', 50)).toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts`
Expected: FAIL — `wbs.ts` 가 아직 `getMembership` 을 쓴다

- [ ] **Step 3: 세 파일 교체**

표대로 게이트를 바꾼다. `wbs.ts` 의 `updateActual` 대표 형태:

```ts
export async function updateActual(
  itemId: string, newPct: number, expectedCurrent?: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // …이하 기존 본문. 기존의 `m.role !== 'pmo_admin'` 분기는
  //    canEditActual(item, g.actor, found.projectId!) 재검증으로 바꾼다.
}
```

- [ ] **Step 4: 테스트·빌드 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts && npm run build`
Expected: PASS

- [ ] **Step 5: 잔여 확인**

Run: `rg -n "getMembership|pmo_admin" src/app/actions/wbs.ts src/app/actions/project.ts src/app/api/import/route.ts`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/wbs.ts src/app/actions/project.ts src/app/api/import/route.ts tests/actions/authz-gate.test.ts
git commit -m "$(cat <<'EOF'
refactor(authz): WBS·프로젝트 액션을 새 가드로 — 구조 편집과 실적 입력을 가른다

지금은 둘 다 pmo_admin 하나로 묶여 있어 실적만 올리면 되는 사람에게 구조
편집 권한까지 함께 줘야 했다. 실적·산출물은 멤버, 가중치·항목·일정은 관리자로 나눈다.

프로젝트 생성은 슈퍼유저 전용. itemId 만 받는 액션은 project_id 를 먼저 조회하고,
조회가 실패하면 쓰기를 중단한다.

Preview-checked: n/a — 서버 액션만
EOF
)"
```

---

## Task 8: 회의·이슈·주간보고·근태 액션 가드 교체

**Files:**
- Modify: `src/app/actions/meetings.ts`, `src/app/actions/meetingNotify.ts`, `src/app/actions/issues.ts`, `src/app/actions/weekly.ts`, `src/app/actions/attendance.ts`
- Test: `tests/actions/authz-gate.test.ts` (확장)

**Interfaces:**
- Consumes: Task 4 가드
- Produces: 없음

**액션별 목표 가드**

| 파일 | 액션 | 가드 | projectId 출처 |
|---|---|---|---|
| `meetings.ts` | `createMeeting` | `requireProjectMember` | 인자 |
| | `updateMeeting`, `deleteMeeting`, `setMeetingAttendees`, `cancelOccurrence` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId('meetings', id)` |
| | `fetchMyMeetings`, `fetchMeetingDetail` | 로그인만 | — |
| `meetingNotify.ts` | `notifyMeetingSaved` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId('meetings', …)` |
| `issues.ts` | `createIssue`, `createIssueFromMinuteBlock` | `requireProjectMember` | 인자 |
| | `updateIssue`, `deleteIssue` | 작성자 본인 또는 `requireProjectAdmin` | `resolveProjectId('issues', issueId)` |
| | `updateIssueProgress` | `requireProjectMember` | `resolveProjectId('issues', issueId)` |
| | `fetchIssueProjectMembers` | 로그인만 | — |
| `weekly.ts` | `createWeeklyReport` | `requireProjectAdmin` | 인자 |
| | `saveWeeklyTitle`, `saveWeeklyCell`, `saveWeeklyCells` | `requireProjectMember` | 인자 |
| `attendance.ts` | `upsertAttendance` | `requireProjectMember` | 인자 |
| | `removeAttendance` | `requireProjectMember` | `resolveProjectId('attendance_records', recordId)` |

**`weekly.ts` 는 게이트 신설이다** — 현재 `getSession()` 만 확인해서 멤버십 없는 계정도 시트를 쓴다.
`removeAttendance` 는 이미 `project_id` 를 조회하지만 **게이트 뒤에** 한다. 조회를 게이트 앞으로 옮긴다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/authz-gate.test.ts` 에 덧붙인다.

```ts
import { saveWeeklyCell, createWeeklyReport } from '@/app/actions/weekly'
import { upsertAttendance } from '@/app/actions/attendance'

describe('주간보고·근태 권한 게이트', () => {
  // 회귀 방어: 개편 전에는 로그인만 하면 시트를 쓸 수 있었다(0023 이 using(true)).
  it('조회 전용은 주간보고 셀을 쓸 수 없다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    expect(await saveWeeklyCell('p1', 'r1', 'c1', 'x')).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('멤버는 주간보고 회차를 만들 수 없다 — 회차 생성은 관리자', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await createWeeklyReport('p1', '2026-07-27', false)).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('조회 전용은 근태를 입력할 수 없다', async () => {
    requireProjectMember.mockResolvedValue(DENIED)
    const res = await upsertAttendance('p1', { memberId: 'm1', date: '2026-07-29', type: 'work' })
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts`
Expected: FAIL — `weekly.ts` 는 아직 게이트가 없어 `ok:true` 로 진행하려다 Supabase 미모킹으로 터진다

- [ ] **Step 3: 다섯 파일 교체**

표대로 바꾼다. `weekly.ts` 대표 형태:

```ts
// 변경 전
if (!(await getSession())) return { ok: false, error: '로그인 필요' }
// 변경 후
const g = await requireProjectMember(projectId)
if (!g.ok) return { ok: false, error: g.error }
```

`attendance.ts` 의 `removeAttendance` 는 조회를 게이트 앞으로 옮긴다.

```ts
export async function removeAttendance(recordId: string): Promise<{ ok: boolean; error?: string }> {
  // 판정에 필요한 project_id 를 먼저 읽는다 — 게이트 뒤로 두면 판정할 대상이 없다.
  const found = await resolveProjectId('attendance_records', recordId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const { error } = await sb.from('attendance_records').delete().eq('id', recordId)
  if (error) return { ok: false, error: error.message }
  if (found.projectId) revalidatePath(`/p/${found.projectId}/attendance`)
  return { ok: true }
}
```

- [ ] **Step 4: 테스트·빌드 확인**

Run: `npx vitest run && npm run build`
Expected: PASS. 기존 `tests/actions/meeting-notify-gate.test.ts` 가 `getMembership` 을 모킹하고 있으면 `@/lib/authz` 모킹으로 고친다.

- [ ] **Step 5: 잔여 확인**

Run: `rg -n "getMembership|pmo_admin" src/app/actions/meetings.ts src/app/actions/meetingNotify.ts src/app/actions/issues.ts src/app/actions/weekly.ts src/app/actions/attendance.ts`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/meetings.ts src/app/actions/meetingNotify.ts src/app/actions/issues.ts src/app/actions/weekly.ts src/app/actions/attendance.ts tests/actions/authz-gate.test.ts
git commit -m "$(cat <<'EOF'
refactor(authz): 회의·이슈·주간보고·근태에 멤버 게이트를 세운다

주간보고 시트는 게이트가 아예 없었다 — 0023 이 RLS 를 using(true) 로 열어 뒀고
액션도 getSession() 만 봐서, 멤버십 없는 계정도 남의 프로젝트 시트를 쓸 수 있었다.

근태 삭제는 판정에 쓸 project_id 를 게이트 뒤에서 읽고 있었다. 조회를 앞으로 옮긴다.

Preview-checked: n/a — 서버 액션만
EOF
)"
```

---

## Task 9: 나머지 프로젝트 액션 + 전역 관리 액션 가드 교체

**Files:**
- Modify: `src/app/actions/announcements.ts`, `src/app/actions/attachments.ts`, `src/app/actions/members.ts`, `src/app/actions/brief.ts`, `src/app/actions/risk.ts`, `src/app/actions/wiki.ts`, `src/app/actions/chat.ts`, `src/app/actions/teams.ts`, `src/app/actions/llmConfig.ts`
- Modify: `src/app/api/chat/reindex/route.ts`, `src/app/api/chat/health/route.ts`
- Test: `tests/actions/authz-gate.test.ts` (확장), `tests/actions/llmConfig-gate.test.ts` (수정)

**Interfaces:**
- Consumes: Task 4 가드
- Produces: 없음

**액션별 목표 가드**

| 파일 | 액션 | 가드 | projectId 출처 |
|---|---|---|---|
| `announcements.ts` | `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `createAnnouncementFromMeeting` | `requireProjectAdmin` | 인자 / `resolveProjectId('announcements', id)` |
| | `markAnnouncementsSeen`, `getHeaderAnnouncements`, `getUnreadAnnouncementCount` | 로그인만 | — |
| `attachments.ts` | `listAttachments` | 로그인만 | — |
| | `recordAttachment`, `removeAttachment` | `requireProjectMember` + 자기 팀 담당 확인 | `resolveProjectId('wbs_items', wbsItemId)` |
| `members.ts` | `addMember`, `updateMember`, `removeMember` | `requireProjectAdmin` | 인자 / `resolveProjectId('project_members', memberId)` |
| `brief.ts` | `ensureProjectBriefAction` | `requireProjectAdmin` | 인자 |
| | `getProjectBriefAction` | 로그인만 | — |
| `risk.ts` | `ensureRiskBriefAction` | `requireProjectAdmin` | 인자 |
| `wiki.ts` | `curateWikiItem`, `mergeWikiTopics` | `requireProjectAdmin` | 인자 |
| `chat.ts` | `reindexProjectAction` | `requireSuperuser` | — |
| `teams.ts` | `addTeam`, `updateTeam`, `listTeamsAdmin` | `requireSuperuser` | — |
| `llmConfig.ts` | `listLlmProfiles`, `createLlmProfile`, `updateLlmProfile`, `deleteLlmProfile`, `getLlmConfig`, `saveLlmConfig`, `testLlmConnection` | `requireSuperuser` | — |
| `api/chat/reindex/route.ts` | POST | `requireSuperuser` | — |
| `api/chat/health/route.ts` | GET | `requireSuperuser` | — |

`llmConfig.ts:88 maskToken` 은 순수 함수이므로 게이트 대상이 아니다.

- [ ] **Step 1: 실패하는 테스트 추가**

`tests/actions/authz-gate.test.ts` 에 덧붙인다.

```ts
import { addTeam } from '@/app/actions/teams'
import { createAnnouncement } from '@/app/actions/announcements'

describe('전역 관리 권한 게이트', () => {
  it('관리자는 팀 기준정보를 바꿀 수 없다 — 슈퍼유저 전용', async () => {
    const { requireSuperuser } = await import('@/lib/authz')
    vi.mocked(requireSuperuser).mockResolvedValue(DENIED)
    expect(await addTeam({ code: 'X', name: 'X팀' } as never)).toMatchObject({ ok: false, error: '권한 없음' })
  })

  it('멤버는 공지를 등록할 수 없다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await createAnnouncement('p1', { title: 't', body: 'b' } as never))
      .toMatchObject({ ok: false, error: '권한 없음' })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/actions/authz-gate.test.ts`
Expected: FAIL

- [ ] **Step 3: 열한 파일 교체**

표대로 바꾼다. `attachments.ts` 는 팀 담당 확인이 함께 필요하다.

```ts
export async function recordAttachment(
  wbsItemId: string, path: string, name: string, size: number,
): Promise<{ ok: boolean; error?: string }> {
  const found = await resolveProjectId('wbs_items', wbsItemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }

  // 관리자 이상은 전체, 멤버는 자기 팀이 담당인 항목만 — can_attach RLS 와 같은 규칙.
  if (!isProjectAdmin(g.actor, found.projectId)) {
    const sb = await createServerClient()
    const { data: owners, error: ownErr } = await sb
      .from('item_owners').select('team_id').eq('wbs_item_id', wbsItemId)
    if (ownErr || !owners) {
      console.error('[recordAttachment] 담당 팀 조회 실패:', ownErr?.message)
      return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
    }
    if (!owners.some(o => o.team_id === g.actor.teamId)) return { ok: false, error: '권한 없음' }
  }
  // …이하 기존 본문
}
```

- [ ] **Step 4: 기존 게이트 테스트 수정**

`tests/actions/llmConfig-gate.test.ts` 의 `vi.mock('@/lib/auth', …)` 을 `vi.mock('@/lib/authz', …)` 로 바꾸고, `getMembership` 대신 `requireSuperuser` 를 모킹한다. `tests/actions/accounts-gate.test.ts` 는 Task 10 에서 함께 고친다.

- [ ] **Step 5: 테스트·빌드 확인**

Run: `npm run test && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 6: 잔여 확인 — 액션 전체**

Run: `rg -n "pmo_admin" src/app/actions src/app/api --glob '!*.test.*'`
Expected: `src/app/actions/accounts.ts` 만 남는다 (Task 10 에서 처리)

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/announcements.ts src/app/actions/attachments.ts src/app/actions/members.ts src/app/actions/brief.ts src/app/actions/risk.ts src/app/actions/wiki.ts src/app/actions/chat.ts src/app/actions/teams.ts src/app/actions/llmConfig.ts src/app/api/chat/reindex/route.ts src/app/api/chat/health/route.ts tests/actions/authz-gate.test.ts tests/actions/llmConfig-gate.test.ts
git commit -m "$(cat <<'EOF'
refactor(authz): 남은 액션을 가드로 옮기고 전역 설정을 슈퍼유저로 좁힌다

팀 기준정보·LLM 설정·봇 재색인은 프로젝트가 아니라 서버 전체를 바꾼다.
프로젝트 관리자에게 열어 둘 이유가 없어 슈퍼유저 전용으로 내린다.

첨부는 can_attach RLS 와 같은 규칙(관리자 전체 / 멤버는 자기 팀 담당)을
액션에도 세운다 — 담당 팀 조회가 실패하면 통과시키지 않는다.

Preview-checked: n/a — 서버 액션·API 라우트만
EOF
)"
```

---

## Task 10: 계정 관리 액션 개편

**Files:**
- Modify: `src/lib/domain/accounts.ts`
- Modify: `src/app/actions/accounts.ts`
- Create: `src/app/actions/projectRoles.ts`
- Test: `tests/domain/accounts.test.ts` (수정), `tests/actions/accounts-gate.test.ts` (수정)

**Interfaces:**
- Consumes: Task 4 가드
- Produces:
  - `accounts.ts`: `ACCOUNT_ROLES = ['admin','member','viewer'] as const`, `type AccountRole`, `isAccountRole(v)`, `parseBulkAccounts(text, teamCodes)` (3열 의미 변경)
  - `accounts.ts` 액션: `createAccount(input)` — `input.role: AccountRole`, `input.projectId: string`
  - `projectRoles.ts`:
    - `listProjectRoles(projectId): Promise<{ ok: true; rows: ProjectRoleRow[] } | { ok: false; error: string }>`
    - `interface ProjectRoleRow { userId: string; email: string; name: string | null; teamCode: string | null; role: 'admin' | 'member' | 'viewer'; isSuperuser: boolean }`
    - `setProjectRole(projectId: string, userId: string, role: 'admin' | 'member' | 'viewer'): Promise<{ ok: boolean; error?: string }>`
    - `setSuperuser(userId: string, value: boolean): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/domain/accounts.test.ts` 의 역할 관련 케이스를 아래로 바꾼다(파일의 다른 케이스는 그대로 둔다).

```ts
import { isAccountRole, parseBulkAccounts, ACCOUNT_ROLES } from '@/lib/domain/accounts'

describe('AccountRole', () => {
  it('새 3단 값만 허용한다', () => {
    expect(ACCOUNT_ROLES).toEqual(['admin', 'member', 'viewer'])
    expect(isAccountRole('admin')).toBe(true)
    expect(isAccountRole('member')).toBe(true)
    expect(isAccountRole('viewer')).toBe(true)
  })
  // 옛 값을 조용히 허용하면 일괄 등록 파일이 예전 포맷 그대로 통과해
  // 전원이 admin 으로 만들어진다. 명시적으로 거부한다.
  it('옛 값(pmo_admin·team_editor)은 거부한다', () => {
    expect(isAccountRole('pmo_admin')).toBe(false)
    expect(isAccountRole('team_editor')).toBe(false)
  })
})

describe('parseBulkAccounts', () => {
  it('3열을 새 역할로 파싱한다', () => {
    const rows = parseBulkAccounts('a@b.com, PMO, member, password1, 홍길동', ['PMO'])
    expect(rows[0]).toMatchObject({ ok: true, email: 'a@b.com', teamCode: 'PMO', role: 'member', name: '홍길동' })
  })
  it('옛 포맷은 사유를 밝히며 거부한다', () => {
    const rows = parseBulkAccounts('a@b.com, PMO, team_editor, password1', ['PMO'])
    expect(rows[0].ok).toBe(false)
    expect(rows[0].error).toContain('team_editor')
  })
})
```

`tests/actions/accounts-gate.test.ts` 의 `vi.mock('@/lib/auth', …)` 을 `vi.mock('@/lib/authz', …)` 로 바꾸고, 게이트 통과 주체를 `requireProjectAdmin` 으로 교체한다. `updateAccountRole` 관련 케이스는 `setProjectRole` 로 옮긴다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/domain/accounts.test.ts tests/actions/accounts-gate.test.ts`
Expected: FAIL — `ACCOUNT_ROLES` 가 아직 옛 값

- [ ] **Step 3: `accounts.ts` 도메인 교체**

`src/lib/domain/accounts.ts`:

```ts
/** 프로젝트 역할 화이트리스트. 'viewer' 는 project_roles 행을 만들지 않는다는 뜻. */
export const ACCOUNT_ROLES = ['admin', 'member', 'viewer'] as const
export type AccountRole = (typeof ACCOUNT_ROLES)[number]

export function isAccountRole(v: string): v is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(v)
}
```

`parseBulkAccounts` 의 역할 검증 분기를 옛 값 전용 문구와 함께 바꾼다.

```ts
if (!isAccountRole(role)) {
  // 옛 포맷(pmo_admin·team_editor)을 조용히 흘리면 전원이 잘못된 권한으로 만들어진다.
  const hint = role === 'pmo_admin' || role === 'team_editor'
    ? ` — 옛 권한 값입니다. admin·member·viewer 로 바꾸세요.`
    : ''
  out.push({ lineNo, raw: trimmed, ok: false, email, error: `알 수 없는 권한: ${role}${hint}` })
  return
}
```

- [ ] **Step 4: `accounts.ts` 액션 교체**

- `isAdmin()` → `requireProjectAdmin(projectId)` 로 교체. `AccountInput` 에 `projectId: string` 추가.
- `createOne` 은 `memberships` insert 시 `role` 을 **`'team_editor'` 고정**으로 넣는다(레거시 컬럼은 not null 이며 0053 까지 살아 있다. 판정에는 쓰이지 않는다). 그 뒤 `input.role !== 'viewer'` 이면 `project_roles` 에 행을 넣는다. `project_roles` insert 가 실패하면 계정 생성 전체를 보상 롤백한다 — 권한 없는 유령 계정을 남기지 않는다.
- `updateAccountRole` 은 삭제하고 `projectRoles.ts` 의 `setProjectRole` 로 대체한다.
- `listAccounts` 의 `AccountRow.role` 은 `project_roles` 조인 결과로 채우고 `isSuperuser` 를 추가한다. 게이트는 `requireProjectAdmin`.

- [ ] **Step 5: `projectRoles.ts` 신설**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireSuperuser } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ProjectRoleRow {
  userId: string
  email: string
  name: string | null
  teamCode: string | null
  role: 'admin' | 'member' | 'viewer'
  isSuperuser: boolean
}

export async function listProjectRoles(
  projectId: string,
): Promise<{ ok: true; rows: ProjectRoleRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()

  const { data: mems, error: memErr } = await admin
    .from('memberships').select('user_id, is_superuser, teams(code)')
  // 조회 실패를 빈 목록으로 폴백하면 이 화면이 곧 '아무도 권한이 없다'는 잘못된 권한 정보가 되고,
  // 관리자가 그걸 근거로 권한을 다시 부여하는 쓰기까지 유발한다.
  if (memErr || !mems) return { ok: false, error: '권한 정보를 불러오지 못했습니다: ' + (memErr?.message ?? 'unknown') }

  const { data: roles, error: roleErr } = await admin
    .from('project_roles').select('user_id, role').eq('project_id', projectId)
  if (roleErr || !roles) return { ok: false, error: '프로젝트 역할을 불러오지 못했습니다: ' + (roleErr?.message ?? 'unknown') }

  const roleBy = new Map(roles.map(r => [r.user_id as string, r.role as 'admin' | 'member']))
  const rows: ProjectRoleRow[] = []
  for (const m of mems) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id as string)
    if (!u?.user) continue
    const team = m.teams as unknown as { code: string } | null
    rows.push({
      userId: m.user_id as string,
      email: u.user.email ?? '',
      name: (u.user.user_metadata?.full_name as string | undefined) ?? null,
      teamCode: team?.code ?? null,
      role: roleBy.get(m.user_id as string) ?? 'viewer',
      isSuperuser: Boolean(m.is_superuser),
    })
  }
  return { ok: true, rows }
}

/** 관리자 슬롯은 슈퍼유저만 조작한다 — 관리자가 관리자를 늘리면 지금의 28명 상황이 재현된다. */
export async function setProjectRole(
  projectId: string, userId: string, role: 'admin' | 'member' | 'viewer',
): Promise<{ ok: boolean; error?: string }> {
  const g = role === 'admin' ? await requireSuperuser() : await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const admin = createAdminClient()

  // 관리자를 강등할 때도 슈퍼유저 권한이 필요하다. 현재 역할을 먼저 읽는다.
  const { data: cur, error: curErr } = await admin
    .from('project_roles').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (curErr) {
    console.error('[setProjectRole] 현재 역할 조회 실패:', curErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (cur?.role === 'admin' && !g.actor.isSuperuser) return { ok: false, error: '권한 없음' }

  if (role === 'viewer') {
    const { error } = await admin.from('project_roles').delete()
      .eq('project_id', projectId).eq('user_id', userId)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await admin.from('project_roles').upsert(
      { project_id: projectId, user_id: userId, role, granted_by: g.actor.userId },
      { onConflict: 'project_id,user_id' },
    )
    if (error) return { ok: false, error: error.message }
  }
  revalidatePath(`/p/${projectId}/settings`)
  revalidatePath('/admin/accounts')
  return { ok: true }
}

export async function setSuperuser(userId: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()

  // 마지막 슈퍼유저 강등 방지 — 전원이 전역 관리에서 잠기면 복구 경로가 DB 직접 수정뿐이다.
  // 조회 실패를 '슈퍼유저 0명'으로 폴백하면 가드가 통째로 무력화되므로 실패는 곧 거부(fail-closed).
  if (!value) {
    const { data: sus, error: susErr } = await admin
      .from('memberships').select('user_id').eq('is_superuser', true)
    if (susErr || !sus) {
      console.error('[setSuperuser] 슈퍼유저 목록 조회 실패:', susErr?.message)
      return { ok: false, error: '슈퍼유저 목록을 확인할 수 없어 변경을 중단했습니다. 잠시 후 다시 시도하세요.' }
    }
    const ids = sus.map(r => r.user_id as string)
    if (ids.includes(userId) && ids.length <= 1) {
      return { ok: false, error: '마지막 슈퍼유저는 해제할 수 없습니다. 다른 슈퍼유저를 먼저 지정하세요.' }
    }
  }

  const { error } = await admin.from('memberships').update({ is_superuser: value }).eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/accounts')
  return { ok: true }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm run test && npm run build && npm run lint`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/accounts.ts src/app/actions/accounts.ts src/app/actions/projectRoles.ts tests/domain/accounts.test.ts tests/actions/accounts-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(authz): 계정 권한을 프로젝트 역할로 — 관리자 슬롯은 슈퍼유저만 만진다

관리자가 관리자를 늘릴 수 있으면 지금의 28명 상황이 그대로 재현된다.
setProjectRole 은 role='admin' 일 때와 기존이 admin 일 때 모두 슈퍼유저를 요구한다.

일괄 등록의 옛 권한 값(pmo_admin·team_editor)은 조용히 넘기지 않고 사유를 밝혀
거부한다 — 통과시키면 예전 포맷 파일이 전원을 admin 으로 만든다.

마지막 슈퍼유저 해제 방지 가드는 조회 실패를 곧 거부로 본다.

Preview-checked: n/a — 서버 액션만, 화면은 다음 커밋
EOF
)"
```

---

## Task 11: 화면 — 계정 관리 · 프로젝트 권한 탭 · 페이지 게이트

**Files:**
- Modify: `src/components/admin/AccountsManager.tsx`
- Create: `src/components/settings/ProjectRolesManager.tsx`
- Modify: `src/app/(app)/p/[projectId]/settings/page.tsx`
- Modify: `src/app/(app)/admin/accounts/page.tsx`, `src/app/(app)/admin/teams/page.tsx`, `src/app/(app)/admin/llm-config/page.tsx`
- Modify: `src/app/(app)/projects/page.tsx`, `src/app/(app)/p/[projectId]/wiki/page.tsx`, `src/app/(app)/minutes/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 10 의 `listProjectRoles`/`setProjectRole`/`setSuperuser`, Task 4 의 `getActor`, Task 3 의 `isProjectAdmin`
- Produces: 없음

**브랜치:** `src/components/app/*` 를 건드리게 되면 `git switch -c ui/authz` 로 시작해 push 후 머지한다(G2). 이 태스크의 파일 목록에는 없지만 사이드바 메뉴 게이팅이 필요해지면 그때 브랜치로 전환한다.

- [ ] **Step 1: 페이지 리다이렉트 게이트 교체**

각 페이지의 `getMembership()` + `role !== 'pmo_admin'` 을 바꾼다.

```tsx
// src/app/(app)/admin/teams/page.tsx · admin/llm-config/page.tsx
// 변경 전
const m = await getMembership()
if (m?.role !== 'pmo_admin') redirect('/projects')
// 변경 후
import { getActor } from '@/lib/authz'
const actor = await getActor()
if (!actor?.isSuperuser) redirect('/projects')
```

```tsx
// src/app/(app)/admin/accounts/page.tsx — 관리자도 계정 생성이 가능하므로 슈퍼유저 전용이 아니다.
const actor = await getActor()
if (!actor) redirect('/login')
const canManage = actor.isSuperuser || actor.projectRoles.size > 0
  ? [...actor.projectRoles.values()].includes('admin') || actor.isSuperuser
  : false
if (!canManage) redirect('/projects')
```

```tsx
// src/app/(app)/projects/page.tsx — 프로젝트 생성은 슈퍼유저 전용
const canCreate = actor?.isSuperuser === true
```

```tsx
// src/app/(app)/p/[projectId]/settings/page.tsx
import { isProjectAdmin } from '@/lib/domain/authz'
const actor = await getActor()
const isAdmin = isProjectAdmin(actor, projectId)
const canMutate = isAdmin
// 기존 isPmo 참조(100·101·105·173·243행)를 isAdmin 으로 바꾼다.
// LLM 설정 배지(105행)는 슈퍼유저 전용이므로 actor?.isSuperuser 로 가른다.
```

```tsx
// src/app/(app)/p/[projectId]/wiki/page.tsx
canMergeTopics={isProjectAdmin(actor, projectId)}
// src/app/(app)/minutes/[id]/page.tsx
&& (detail.minute.createdBy === actor?.userId || isProjectAdmin(actor, detail.minute.projectId))
```

- [ ] **Step 2: `AccountsManager.tsx` 개편**

- `ROLE_LABEL` 을 `{ admin: '관리자', member: '멤버', viewer: '조회' }` 로 바꾼다.
- 기본 선택값 `useState<AccountRole>('team_editor')` 두 곳(133·366행)을 `'viewer'` 로 바꾼다 — 새 계정은 조회 권한으로 시작한다(설계 결정 D7).
- 일괄 등록 안내문(245·246·252행)의 권한 예시를 `admin · member · viewer` 로 바꾼다.
- 계정 표에 `슈퍼유저` 열을 추가한다. **토글은 `actor.isSuperuser` 일 때만 렌더링**한다.
- 역할 변경은 `updateAccountRole` 대신 `setProjectRole(projectId, userId, role)` 을 부른다. 대상 프로젝트는 화면 상단 선택값.

`hidden`/`flex` 같은 상태 변형 display 유틸을 쓰지 않는다 — 조건부 렌더링으로 처리한다.

- [ ] **Step 3: `ProjectRolesManager.tsx` 신설**

`src/components/settings/ProjectRolesManager.tsx` — 클라이언트 컴포넌트.

- props: `{ projectId: string; rows: ProjectRoleRow[]; canManageAdmins: boolean }`
- 표 열: 이름 · 이메일 · 팀 · 역할(select: 관리자/멤버/조회) · 슈퍼유저 배지
- `canManageAdmins` 가 false 면 `관리자` 옵션을 `disabled` 로 렌더링하고, 현재 역할이 `admin` 인 행은 select 전체를 `disabled` 로 둔다.
- 변경 시 `setProjectRole` 호출 → 실패하면 에러 문구를 그 행 아래 표시한다(조용한 실패 금지).
- `Actor` 를 props 로 내리지 않는다 — `canManageAdmins` boolean 만 서버에서 계산해 넘긴다(`Map` 은 직렬화되지 않는다).

- [ ] **Step 4: settings 페이지에 권한 섹션 추가**

`src/app/(app)/p/[projectId]/settings/page.tsx` 에 `SectionCard` 하나를 더한다.

```tsx
{isAdmin && (
  <SectionCard title="권한" icon={<Shield className="size-4" />}>
    {(async () => {
      const res = await listProjectRoles(projectId)
      if (!res.ok) return <p className="text-sm text-delayed">{res.error}</p>
      return <ProjectRolesManager
        projectId={projectId}
        rows={res.rows}
        canManageAdmins={actor?.isSuperuser === true}
      />
    })()}
  </SectionCard>
)}
```

`Shield` 는 이미 이 파일이 import 하고 있다(3행).

- [ ] **Step 5: 빌드·린트·테스트**

Run: `npm run build && npm run lint && npm run test`
Expected: PASS

- [ ] **Step 6: 잔여 확인 — 전 코드베이스**

Run: `rg -n "pmo_admin|team_editor" src --glob '!*.test.*'`
Expected: 남는 것은 **레거시 표기 두 곳뿐**이어야 한다 — `src/lib/repositories/supabase/wbs.ts:78-83`(변경 이력의 옛 역할 라벨)과 `src/lib/ai/chat/orchestrator.ts:154`(용어 사전). 둘 다 과거 데이터를 사람이 읽는 라벨이므로 남긴다. 그 외에 걸리면 교체가 덜 된 것이다.

- [ ] **Step 7: 커밋**

```bash
git add src/components/admin/AccountsManager.tsx src/components/settings/ProjectRolesManager.tsx "src/app/(app)/p/[projectId]/settings/page.tsx" "src/app/(app)/admin/accounts/page.tsx" "src/app/(app)/admin/teams/page.tsx" "src/app/(app)/admin/llm-config/page.tsx" "src/app/(app)/projects/page.tsx" "src/app/(app)/p/[projectId]/wiki/page.tsx" "src/app/(app)/minutes/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(authz): 권한 화면 — 관리자 슬롯은 보이되 만질 수 없게 한다

프로젝트 설정에 권한 섹션을 붙인다. 관리자에게 관리자 슬롯을 숨기지 않고
disabled 로 보여준다 — 누가 관리자인지는 알아야 멤버 배정을 판단할 수 있다.

새 계정 기본값을 viewer 로 둔다. 관리자가 계정을 만들 수 있게 열어 준 대신,
만들어진 계정이 곧바로 쓰기 권한을 갖지 않게 하는 쪽이 안전하다.

Actor 는 Map 을 품고 있어 직렬화되지 않는다 — 클라이언트에는 boolean 만 내린다.

Preview-checked: n/a — 전역 레이아웃(components/app·globals.css) 무변경
EOF
)"
```

---

## Task 12: 배포 및 런타임 검증

**Files:** 없음

- [ ] **Step 1: 전체 검사**

Run: `npm run build && npm run lint && npm run test`
Expected: 전부 PASS. 실패가 남아 있으면 여기서 멈춘다.

- [ ] **Step 2: push**

```bash
git push origin main
```
Expected: pre-push 훅 G1(마이그레이션+코드 혼합)·G2(UI 직행)·G3(반응형 안전망) 통과.
G2 에 걸리면 `git switch -c ui/authz && git push -u origin HEAD` 로 Preview 를 받은 뒤 머지한다.

- [ ] **Step 3: 배포 확인 및 스모크**

Run: `npm run smoke:prod`
Expected: PASS

- [ ] **Step 4: 사람이 확인할 것 (에이전트가 대신하지 않는다)**

프로덕션 데이터를 쓰는 검증이므로 사람에게 요청한다.

1. 슈퍼유저(`donseok.lee@` 또는 `donseok75@`)로 로그인 → `/admin/teams`, `/admin/llm-config` 진입 가능
2. PMO팀 관리자 계정으로 로그인 → `/admin/teams` 진입 시 `/projects` 로 리다이렉트, 프로젝트 설정의 권한 섹션은 보이되 관리자 슬롯은 disabled
3. 멤버 계정(예: MES `team_editor` 였던 계정)으로 로그인 → WBS 실적 입력 가능, WBS 항목 추가 버튼 없음, 주간보고 셀 입력 가능
4. 조회 전용 계정을 하나 만들어(`viewer`) 로그인 → 모든 화면 조회 가능, 쓰기 버튼 전무, 주간보고 셀 입력 불가

- [ ] **Step 5: known-good 태그**

Run: `npm run mark:good`
Expected: 태그 생성. 다음 사고 때 되돌아갈 좌표다.

---

## Task 13: 0052 프로젝트 스코프 RLS

**Files:**
- Create: `supabase/migrations/0052_project_scoped_rls.sql`
- Create: `supabase/migrations/0052_project_scoped_rls_rollback.sql`

**Interfaces:**
- Consumes: Task 1 의 `is_project_admin`/`is_project_member`/`is_superuser`
- Produces: 프로젝트 스코프 쓰기 정책 29개

**전제:** Task 12 가 끝나 새 코드가 프로덕션에서 돌고 있어야 한다. 코드보다 먼저 적용하면 옛 코드가 `pmo_admin` 으로 통과하던 경로가 막힌다.

- [ ] **Step 1: 적용 전 정책 원문 백업**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname=''public'' and cmd <> ''SELECT'' order by tablename, policyname"}' \
  > /private/tmp/claude-501/-Users-jerry-wbs-web/policies-before-0052.json
```
Expected: 46행 JSON. 롤백 파일 작성의 원본이 된다.

- [ ] **Step 2: `0052_project_scoped_rls.sql` 작성**

스펙 §3.5 의 표대로 정책을 교체한다. 대표 형태:

```sql
begin;

-- ── wbs_items ──
drop policy if exists pmo_write_items on wbs_items;
create policy admin_write_items on wbs_items for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

-- 멤버의 실적·산출물 수정 — 말단 + 자기 팀 담당. 컬럼 범위는 0051 트리거가 제한한다.
drop policy if exists team_update_actual on wbs_items;
create policy member_update_actual on wbs_items for update to authenticated
  using (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid()))
  )
  with check (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid()))
  );

-- ── item_owners — 부모 wbs_items 의 project_id 를 미러 ──
drop policy if exists pmo_write_owners on item_owners;
create policy admin_write_owners on item_owners for all to authenticated
  using (exists (select 1 from wbs_items w where w.id = wbs_item_id and public.is_project_admin(w.project_id)))
  with check (exists (select 1 from wbs_items w where w.id = wbs_item_id and public.is_project_admin(w.project_id)));

-- ── projects — 생성·삭제는 슈퍼유저, 수정은 프로젝트 관리자 ──
drop policy if exists pmo_write_projects on projects;
create policy su_insert_projects on projects for insert to authenticated
  with check (public.is_superuser());
create policy su_delete_projects on projects for delete to authenticated
  using (public.is_superuser());
create policy admin_update_projects on projects for update to authenticated
  using (public.is_project_admin(id)) with check (public.is_project_admin(id));

-- ── holidays · project_members · announcements · task_dependencies — 관리자 ──
drop policy if exists pmo_write_holidays on holidays;
create policy admin_write_holidays on holidays for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_members on project_members;
create policy admin_write_members on project_members for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_announcements on announcements;
create policy admin_write_announcements on announcements for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists task_dependencies_pmo_write on task_dependencies;
create policy admin_write_task_dependencies on task_dependencies for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

-- ── attendance_records · wbs_progress_snapshots — 멤버 ──
drop policy if exists pmo_write_attendance on attendance_records;
create policy member_write_attendance on attendance_records for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists member_write_progress_snapshots on wbs_progress_snapshots;
create policy member_write_snapshots on wbs_progress_snapshots for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- ── meetings — 생성은 멤버 본인, 수정·삭제는 본인 또는 관리자 ──
drop policy if exists insert_own_meetings on meetings;
create policy insert_own_meetings on meetings for insert to authenticated
  with check (created_by = auth.uid() and public.is_project_member(project_id));
drop policy if exists update_own_meetings on meetings;
create policy update_own_meetings on meetings for update to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id))
  with check (created_by = auth.uid() or public.is_project_admin(project_id));
drop policy if exists delete_own_meetings on meetings;
create policy delete_own_meetings on meetings for delete to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id));

-- meeting_attendees · meeting_exceptions 는 부모 meetings 를 미러(판정식만 교체)
drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))));

drop policy if exists own_write_meeting_exceptions on meeting_exceptions;
create policy own_write_meeting_exceptions on meeting_exceptions for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))));

-- ── issues — meetings 와 같은 패턴 ──
drop policy if exists insert_own_issues on issues;
create policy insert_own_issues on issues for insert to authenticated
  with check (created_by = auth.uid() and public.is_project_member(project_id));
drop policy if exists member_update_issues on issues;
create policy member_update_issues on issues for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));
drop policy if exists delete_own_issues on issues;
create policy delete_own_issues on issues for delete to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id));

drop policy if exists member_insert_issue_assignees on issue_assignees;
create policy member_insert_issue_assignees on issue_assignees for insert to authenticated
  with check (public.is_project_member(project_id));
drop policy if exists member_delete_issue_assignees on issue_assignees;
create policy member_delete_issue_assignees on issue_assignees for delete to authenticated
  using (public.is_project_member(project_id));

-- ── weekly_reports / weekly_report_rows — 0023 의 using(true) 를 닫는다 ──
-- weekly_report_rows 에는 project_id 컬럼이 없다(실측). 부모를 미러한다.
drop policy if exists weekly_reports_insert on weekly_reports;
create policy weekly_reports_insert on weekly_reports for insert to authenticated
  with check (public.is_project_admin(project_id));
drop policy if exists weekly_reports_delete on weekly_reports;
create policy weekly_reports_delete on weekly_reports for delete to authenticated
  using (public.is_project_admin(project_id));
drop policy if exists weekly_reports_update on weekly_reports;
create policy weekly_reports_update on weekly_reports for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists weekly_report_rows_insert on weekly_report_rows;
create policy weekly_report_rows_insert on weekly_report_rows for insert to authenticated
  with check (exists (select 1 from weekly_reports r where r.id = report_id
                       and public.is_project_member(r.project_id)));
drop policy if exists weekly_report_rows_update on weekly_report_rows;
create policy weekly_report_rows_update on weekly_report_rows for update to authenticated
  using (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_member(r.project_id)))
  with check (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_member(r.project_id)));
drop policy if exists weekly_report_rows_delete on weekly_report_rows;
create policy weekly_report_rows_delete on weekly_report_rows for delete to authenticated
  using (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_admin(r.project_id)));

-- ── 전역 관리 테이블 — 슈퍼유저 ──
drop policy if exists pmo_write_memberships on memberships;
create policy su_write_memberships on memberships for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_insert_teams on teams;
create policy su_insert_teams on teams for insert to authenticated
  with check (public.is_superuser());
drop policy if exists admin_update_teams on teams;
create policy su_update_teams on teams for update to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_all_llm_config on llm_config;
create policy su_all_llm_config on llm_config for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());
drop policy if exists admin_all_llm_profiles on llm_profiles;
create policy su_all_llm_profiles on llm_profiles for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

-- ── can_attach — 조회 전용이 팀만 맞으면 통과하던 구멍을 닫는다 ──
-- deliverable_attachments 의 attach_insert/attach_delete 와 storage.objects 의
-- deliverables 정책 3개가 이 함수를 공유하므로 함수 하나만 고치면 된다.
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
                          and o.team_id = (select m.team_id from public.memberships m
                                            where m.user_id = auth.uid()))
         )
       )
  )
$$;

commit;
```

**컬럼명 실측(2026-07-29):** `weekly_report_rows` 의 부모 FK 는 `report_id` 가 맞다
(`id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue, updated_at`).
`issue_assignees` 는 `project_id` 를 직접 갖고, `deliverable_attachments` 는 `wbs_item_id` 만 갖는다
(`project_id` 없음 → `can_attach` 가 `wbs_items` 를 거쳐 판정하는 이유).

- [ ] **Step 3: 롤백 파일 작성**

Step 1 에서 받은 `policies-before-0052.json` 의 `qual`/`with_check` 원문을 그대로 옮겨
`0052_project_scoped_rls_rollback.sql` 을 만든다. `can_attach` 는 0036 정의로 되돌린다.

```sql
create or replace function public.can_attach(item uuid) returns boolean
language sql stable as $$
  select app_role() = 'pmo_admin'
      or exists (
        select 1 from item_owners o
        where o.wbs_item_id = item and o.team_id = current_team()
      )
$$;
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/0052_project_scoped_rls.sql supabase/migrations/0052_project_scoped_rls_rollback.sql
git commit -m "$(cat <<'EOF'
feat(db): 0052 쓰기 정책을 프로젝트 스코프로 — shim 의 과대 허용을 좁힌다

0051 의 app_role() shim 은 "어느 프로젝트든 관리자면 pmo_admin" 이라 프로젝트가
여럿이 되는 순간 남의 프로젝트까지 통과한다. project_id 를 가진 테이블은
is_project_admin/member 로 직접 판정하게 바꾼다.

주간보고는 0023 이 using(true) 로 열어 둔 채였다. 로그인만 하면 남의 프로젝트
시트를 쓸 수 있던 경로를 닫는다.

can_attach 는 조회 전용도 팀만 맞으면 통과시켰다 — 멤버 조건을 더한다.

Preview-checked: n/a — 마이그레이션 파일만
EOF
)"
```

- [ ] **Step 5: 적용**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data "$(python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/0052_project_scoped_rls.sql').read()}))")"
```
Expected: 에러 없음

- [ ] **Step 6: 정책 반영 검증**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"select count(*) filter (where qual like ''%is_project_%'' or with_check like ''%is_project_%'') scoped, count(*) filter (where qual like ''%is_superuser%'' or with_check like ''%is_superuser%'') su, count(*) filter (where qual like ''%app_role%'' or with_check like ''%app_role%'') legacy from pg_policies where schemaname=''public'' and cmd <> ''SELECT''"}'
```
Expected: `scoped` ≥ 24, `su` ≥ 5, `legacy` 는 회의록 계열 잔여분만.

- [ ] **Step 7: RLS 시뮬레이션 (읽기 전용)**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data '{"query":"begin; set local role authenticated; set local request.jwt.claims = (select json_build_object(''sub'', m.user_id)::text from memberships m join project_roles r on r.user_id=m.user_id where r.role=''member'' limit 1); select public.is_superuser() su, public.is_project_admin(''7a1c6034-a647-4673-ae85-d0b6daa2f6f3'') adm, public.is_project_member(''7a1c6034-a647-4673-ae85-d0b6daa2f6f3'') mem; rollback;"}'
```
Expected: `{"su":false,"adm":false,"mem":true}` — 멤버가 관리자로 판정되면 즉시 롤백한다.

- [ ] **Step 8: 스모크**

Run: `npm run smoke:prod`
Expected: PASS. 이어서 Task 12 Step 4 의 4가지 시나리오를 사람이 다시 확인한다.

---

## Task 14: 0053 `memberships.role` 박제

**Files:**
- Create: `supabase/migrations/0053_deprecate_membership_role.sql`
- Create: `supabase/migrations/0053_deprecate_membership_role_rollback.sql`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (문서·주석만)

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- memberships.role 을 deprecated 로 박제한다. 컬럼은 삭제하지 않는다.
-- 삭제는 새 체계가 한 사이클 안정된 뒤 별도 작업으로 한다 — 지금 지우면
-- 롤백 경로(0051_rollback)가 데이터를 복원할 수 없다.
comment on column memberships.role is
  'DEPRECATED (2026-07-29, 0053). 권한 판정에 쓰지 않는다. 판정은 memberships.is_superuser + project_roles 를 본다. 신규 계정 생성 시 not null 을 채우기 위해 ''team_editor'' 를 넣는다. 삭제 시점 미정.';

comment on column memberships.is_superuser is
  '전역 등급. true 면 모든 프로젝트에 대해 관리자 권한. is_superuser() 헬퍼가 읽는다.';

comment on table project_roles is
  '프로젝트별 역할. 행이 없으면 그 프로젝트에서 조회 전용이다(viewer 값을 두지 않는 이유: "행 없음"과 "viewer 행"이 같은 뜻이 되면 판정이 갈라진다).';
```

롤백은 세 `comment on … is null`.

- [ ] **Step 2: 적용**

Run:
```bash
TOK=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -X POST "https://api.supabase.com/v1/projects/rglfgrwwwwdqejohdnty/database/query" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "User-Agent: claude-code" \
  --data "$(python3 -c "import json;print(json.dumps({'query':open('supabase/migrations/0053_deprecate_membership_role.sql').read()}))")"
```
Expected: 에러 없음

- [ ] **Step 3: `CLAUDE.md` 에 권한 절 추가**

`## 데이터` 절 뒤에 아래를 넣는다.

```markdown
## 권한

3단이다 — **슈퍼유저**(전역) · **관리자**(지정된 프로젝트) · **멤버**(지정된 프로젝트).
프로젝트 역할이 없으면 조회 전용이다.

- 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz.ts`(가드) 두 곳에서만 한다.
  액션에 `role === '...'` 을 직접 적지 않는다.
- 가드는 셋뿐이다: `requireSuperuser()` · `requireProjectAdmin(pid)` · `requireProjectMember(pid)`.
  `projectId` 를 인자로 받지 않는 액션은 `resolveProjectId(table, id)` 로 먼저 읽는다.
- `memberships.role` 은 **deprecated** 다(0053). 읽지 말 것. 전역 등급은 `is_superuser`,
  프로젝트 역할은 `project_roles` 다.
- **회의록·위키·AI 브리핑은 RLS 쓰기 정책이 없다.** service_role 로 쓰기 때문에
  RLS 2차 방어선이 없고 서버 액션 가드가 유일한 관문이다. 이 계열을 손댈 때 특히 주의할 것.
- 설계 정본: `docs/superpowers/specs/2026-07-29-authz-three-tier-design.md`
```

- [ ] **Step 4: 커밋 (마이그레이션과 문서를 나눈다)**

```bash
git add supabase/migrations/0053_deprecate_membership_role.sql supabase/migrations/0053_deprecate_membership_role_rollback.sql
git commit -m "$(cat <<'EOF'
chore(db): 0053 memberships.role 박제 — 지우지 않고 남기는 이유를 컬럼에 적는다

컬럼을 지우면 0051_rollback 이 데이터를 복원할 수 없다. 새 체계가 한 사이클
안정될 때까지 남기되, 다음 사람이 이 컬럼을 판정에 쓰지 않도록 주석으로 못을 박는다.

Preview-checked: n/a — 마이그레이션 파일만
EOF
)"

git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: 권한 절 추가 — 가드는 셋뿐이고 role 문자열은 더 쓰지 않는다

pmo_admin 비교식이 75곳까지 번진 건 규칙이 어디에도 안 적혀 있었기 때문이다.
회의록 계열에 RLS 2차 방어선이 없다는 사실도 함께 적는다 — 코드만 봐서는 안 보인다.

Preview-checked: n/a — 문서만
EOF
)"
```

- [ ] **Step 5: 최종 push·태그**

Run: `git push origin main && npm run smoke:prod && npm run mark:good`
Expected: PASS

---

## Self-Review 결과

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §3.1 데이터 모델 · project_roles RLS | Task 1 |
| §3.2 판정 헬퍼 | Task 1 |
| §3.3 `app_role()` shim | Task 1 |
| §3.4 fail-open 트리거 뒤집기 | Task 1 |
| §3.5 정책 교체 (a)(b)(c) · `can_attach` | Task 13 |
| §3.6 백필·검증 | Task 1 Step 1 · Task 2 |
| §3.7 이관 결과 | Task 2 Step 3 |
| §4.1 모듈 경계 | Task 3, 4 |
| §4.2 서버 액션 교체 | Task 6~10 |
| §4.3 전수 점검표 | Task 6~11 (잔여 확인 스텝) |
| §4.4 UI 어포던스 | Task 11 |
| §5 권한 매트릭스 | Task 3 테스트 + Task 6~10 가드 표 |
| §6.1 `/admin/accounts` · 마지막 슈퍼유저 가드 | Task 10, 11 |
| §6.2 권한 탭 | Task 11 |
| §6.3 어포던스 | Task 11 |
| §7 배포 순서 | Task 2 → 12 → 13 → 14 |
| §8 실패 모드 | Task 1 검증 블록 · Task 4 fail-closed · Task 10 마지막 슈퍼유저 |
| §9 검증 | Task 3·4·6~10 테스트 · Task 13 Step 7 시뮬레이션 · Task 12 Step 4 |
| §10 범위 밖 | 태스크 없음 (의도) |

**미해결로 남긴 것**

없다. 계획 작성 중 불확실했던 `weekly_report_rows.report_id` · `issue_assignees.project_id` ·
`deliverable_attachments` 의 `project_id` 부재는 모두 프로덕션 실측으로 확정했다(Task 13 Step 2).

**타입 일관성**

`Actor`·`ProjectRole`·`GuardResult`·`ProjectRoleRow`·`ProjectScopedTable` 은 Task 3·4·10 의 Interfaces 블록에 정의된 이름 그대로 이후 태스크에서 쓰인다. `canEditActual`/`canEditWeight`/`canEditDeliverable` 은 Task 5 에서 `(item, actor, projectId)` / `(actor, projectId)` 로 통일했고 Task 11 화면이 같은 시그니처를 쓴다.
