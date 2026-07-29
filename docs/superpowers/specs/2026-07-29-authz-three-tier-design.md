# 권한 체계 3단 재설계 — 슈퍼유저 / 관리자 / 멤버

> **상태:** 확정 스펙 (구현 전)
> **작성일:** 2026-07-29
> **결정 경로:** 프로덕션 권한 실측(41계정·106정책) → 브레인스토밍 문답 5건 → 사용자 확정
> **프레임:** 역할을 "전역 1축"에서 "전역 등급 + 프로젝트 역할" 2축으로 분리한다. 기존 쓰기 정책 46개는
> `app_role()` 호환 shim 으로 의미를 보존하고, 프로젝트 스코프가 실제로 필요한 것만 선별 교체한다.
> 마이그레이션은 컬럼을 **더하기만** 해서 무중단 2단 배포를 성립시킨다.

---

## 1. 문제 — 현재 권한 체계 실측

### 1.1 구조

`memberships` 는 사용자당 한 행이고(`primary key (user_id)`) 프로젝트 개념이 없다.

```sql
-- supabase/migrations/0001_init.sql:17
create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  role text not null check (role in ('pmo_admin','team_editor')),
  primary key (user_id)
);
```

- 역할 2종: `pmo_admin`(전권) / `team_editor`(자기 팀 담당 말단 WBS 실적%·산출물)
- 읽기: 전 테이블 `using (true)` — 로그인하면 모두 조회
- 쓰기 게이트: RLS 정책 106개 중 **비-SELECT 정책 46개**(프로덕션 `pg_policies` 실측) +
  서버 액션 105개가 `app_role() = 'pmo_admin'` 또는 `m?.role !== 'pmo_admin'` 를 **각자 하드코딩**
  (`src` 내 `pmo_admin` 비교식 75곳 · `getMembership()` 호출 86회). 중앙 authz 모듈이 없다.

### 1.2 프로덕션 실측 (2026-07-29, ref `rglfgrwwwwdqejohdnty`)

| 항목 | 값 |
|---|---|
| 프로젝트 | 1개 — `D-CUBE 프로젝트` (`7a1c6034-a647-4673-ae85-d0b6daa2f6f3`) |
| 계정(`auth.users`, 미삭제) | 41 |
| `memberships` | 41 (전원 보유) |
| `pmo_admin` | **28** — PMO 14 · MES 11 · ERP 2 · 가공 1 |
| `team_editor` | 13 — ERP 9 · MES 4 |
| 권한 없는 계정 | 0 |

### 1.3 요청한 3단 체계와 어긋나는 지점 셋

1. **슈퍼유저 계층이 없다.** 68%(28/41)가 전역 전권이라 사실상 전원이 슈퍼유저처럼 동작한다.
2. **"지정한 프로젝트만"을 표현할 자리가 없다.** `memberships` 에 `project_id` 가 없다.
3. **"조회 전용"이 표현되지 않는다.** 회의·회의록·이슈 생성 정책은 `app_role() is not null` 이라
   멤버십만 있으면 통과하고, 주간보고 시트는 `using (true)` 라 **멤버십조차 보지 않는다**
   (`0023_weekly_sheet.sql:37-52`, `src/app/actions/weekly.ts` 는 `getSession()` 만 확인).

### 1.4 별도로 발견한 fail-open 결함

`guard_team_editor_actual_only` 트리거(`0022_leaf_actual_rls.sql:74`, 프로덕션 정의 대조 확인)는
컬럼 범위 제한을 **역할 문자열이 `'team_editor'` 일 때만** 적용한다.

```sql
if v_role is distinct from 'team_editor' then
  return new;          -- ← 그 외 모든 역할은 무제한 통과
end if;
```

역할 이름을 바꾸는 순간 이 가드가 통째로 무력화되어, 멤버가 담당 말단 행의 **이름·일정·가중치까지**
PostgREST 로 직접 고칠 수 있게 된다. 이번 작업에서 판정을 뒤집어 fail-closed 로 만든다.
CLAUDE.md "보안 가드는 fail-closed" 원칙의 직접 적용 대상이다.

### 1.5 RLS 가 2차 방어선이 아닌 영역이 있다

프로덕션 실측 결과, 다음 테이블은 RLS 가 켜져 있으나 **쓰기 정책이 하나도 없다**
(SELECT 정책만 존재). 즉 사용자 세션으로는 아예 못 쓰고, 앱은 `createAdminClient()`
= service_role 로 쓴다. service_role 은 **RLS 를 통째로 우회**한다.

| 테이블 | 쓰기 정책 | 실제 쓰기 경로 |
|---|:--:|---|
| `minutes`, `minute_embeddings` | 0 | `src/app/actions/minutes.ts` — admin client |
| `wiki_items`, `wiki_topics` | 0 | `src/lib/ai/wiki-ingest.ts` — admin client |
| `project_ai_briefs` | 0 | `src/lib/ai/brief.ts` — admin client |
| `ai_documents`, `wbs_embeddings` | 0 | 색인 워커 — admin client |

레포의 `0021_minutes.sql` 은 `insert_own_minutes` 등을 만들지만 **프로덕션에는 없다**
(2026-07-29 `pg_policy` 대조). 회의록 쓰기를 admin client 로 옮기면서 정책이 무의미해진
결과로 보이며, 어느 쪽이든 사실은 하나다 — **회의록·위키·AI 브리핑에서는 서버 액션 가드가
유일한 방어선이다.**

반대로 `meetings`·`issues`·`weekly_*`·`wbs_items`·`attendance_records`·`announcements`·
`project_members`·`deliverable_attachments` 는 사용자 세션 클라이언트로 쓰므로 RLS 가 실제
2차 방어선으로 작동한다(`createServerClient` 사용 확인).

이 구분이 §3.5 의 정책 교체 범위와 §9 의 검증 방법을 가른다.

---

## 2. 확정 결정 요약

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| D1 | 역할 축 | 전역 등급(`superuser`) + 프로젝트 역할(`admin`/`member`) 2축 | "관리자는 지정한 프로젝트만"을 표현하려면 프로젝트 축이 필수 |
| D2 | 조회 전용의 표현 | `project_roles` 행의 **부재** | `viewer` 값을 두면 "행 없음"과 "viewer 행"이 같은 뜻이 되어 판정이 갈라진다 |
| D3 | WBS 실적 입력 | **멤버**가 흡수 — 자기 팀이 담당인 말단 항목만 | 사용자 확정. 기존 `team_editor` 13명이 그대로 멤버가 되어 현장 흐름이 끊기지 않는다 |
| D4 | 초기 이관 | PMO팀 `pmo_admin` → 관리자, 나머지 → 멤버 | 사용자 확정. 권한을 업무 역할과 일치시키되 강등 폭을 예측 가능하게 |
| D5 | 슈퍼유저 | 이돈석 2계정(`donseok.lee@dongkuk.com`, `donseok75@gmail.com`) | 사용자 확정. `dcube@` 공용계정은 관리자까지만 — 공용계정이 최고권한을 갖지 않게 |
| D6 | 조회 범위 | 전 프로젝트 개방 유지 + `can_read_project()` 헬퍼만 선반영 | 사용자 확정. 읽기까지 스코프하면 읽기 정책 60개·전 목록 쿼리·대시보드·RAG 검색을 다시 써야 해 회귀 위험이 크다 |
| D7 | 계정 생성 | 관리자도 가능. 생성된 계정은 프로젝트 역할 없이(=조회 전용) 시작 | 사용자 확정. 신규 입사·파트너 투입마다 슈퍼유저를 기다리지 않게 |
| D8 | 멤버 범위 | 회의·주간보고·WBS 실적/산출물 + **회의록·이슈·첨부파일·근태** | 사용자 확정(4개 모두 선택) |
| D9 | `memberships.role` | **삭제하지 않고 유지**, 신규 코드는 읽지 않음 → deprecated 박제 | 값을 갈아엎으면 마이그레이션~코드배포 사이에 41명 전원이 권한을 잃는다 |
| D10 | 기존 쓰기 정책 46개 | `app_role()` shim 재정의로 의미 보존 + 29개만 선별 교체 | 전량 재작성은 회귀 위험이 이득을 넘는다 |
| D11 | service_role 경로 | 회의록·위키·AI 브리핑은 RLS 2차 방어선이 없음을 스펙에 명시하고 서버 액션 가드로 전담 | §1.5 실측. 감추면 "RLS 가 막아 준다"는 잘못된 안심이 생긴다 |

---

## 3. 데이터 모델

### 3.1 `supabase/migrations/0051_authz_roles.sql`

번호 **0051** — 0050(`0050_migration_ledger.sql`)이 최신이며, 미머지 브랜치를 포함한 모든 ref 를
대조해 0051 이 비어 있음을 확인했다(2026-07-29 실측). 멱등 SQL + 롤백 파일 동봉,
적용은 Supabase Management API 경로(레포 관례 — `db push` 금지).

```sql
-- 1) 전역 등급 — 컬럼을 '더하기만' 한다. memberships.role 은 그대로 살려 둔다.
alter table memberships
  add column if not exists is_superuser boolean not null default false;

-- 2) 프로젝트 역할
create table if not exists project_roles (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','member')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_roles_user_idx on project_roles(user_id);
```

`granted_by` 를 남기는 이유: 관리자도 멤버를 부여할 수 있으므로 "누가 이 사람에게 권한을 줬나"를
사후에 물을 수 있어야 한다. `on delete set null` — 부여자 계정이 지워져도 권한 행은 남는다.

**`project_roles` 자신의 RLS** — 권한 테이블이므로 가장 먼저 조인다.

```sql
alter table project_roles enable row level security;

-- 읽기: 로그인 사용자 전체 (화면이 "이 프로젝트의 관리자·멤버"를 보여줘야 한다)
create policy read_all_project_roles on project_roles
  for select to authenticated using (true);

-- 관리자 슬롯은 슈퍼유저만 — D7. 관리자가 관리자를 늘리면 지금의 28명 상황이 재현된다.
create policy su_write_admin_roles on project_roles for all to authenticated
  using (role = 'admin' and public.is_superuser())
  with check (role = 'admin' and public.is_superuser());

-- 멤버 슬롯은 해당 프로젝트 관리자 이상
create policy admin_write_member_roles on project_roles for all to authenticated
  using (role = 'member' and public.is_project_admin(project_id))
  with check (role = 'member' and public.is_project_admin(project_id));
```

두 정책이 `role` 로 갈라져 있어 관리자는 `role='admin'` 행을 insert 도 update 도 할 수 없다.
`is_project_admin` 이 `security definer` 라 이 정책 안에서 `project_roles` 를 다시 읽어도
RLS 재귀가 걸리지 않는다(0022 `wbs_is_leaf` 와 같은 이유).

### 3.2 판정 헬퍼

```sql
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

-- D6: 지금은 항상 true. 나중에 조회를 좁힐 때 이 함수 본문만 고치면 된다.
create or replace function public.can_read_project(pid uuid) returns boolean
language sql stable as $$ select true $$;
```

`security definer` + `set search_path = ''` 는 0019/0022 가 이미 택한 패턴이다
(pg_temp 를 통한 객체 가로채기 차단). 노출값은 boolean 하나뿐이다.

### 3.3 `app_role()` 호환 shim

정책 텍스트를 건드리지 않고 함수 하나만 바꾼다.

```sql
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
```

이것만으로 자동으로 올바르게 동작하는 것:

- `app_role() = 'pmo_admin'` 쓰기 정책 다수 → 슈퍼유저·관리자만 통과
- `app_role() is not null` 정책(**회의·이슈** insert) → 조회 전용 사용자 자동 차단
- `current_team()` 은 손대지 않는다 — 팀 소속은 `memberships.team_id` 에 그대로 있다

**회의록(`minutes`)은 여기에 해당하지 않는다** — §1.5 대로 쓰기 정책 자체가 없고 admin client 로
쓴다. 회의록의 조회 전용 차단은 전적으로 §4 의 서버 액션 가드가 책임진다.

**알려진 한계(의도적):** 프로젝트가 여럿이 되면 이 shim 은 "A프로젝트 관리자가 B프로젝트 RLS 를
통과"하는 과대 허용이 된다. 그래서 §3.5 에서 핵심 테이블을 프로젝트 인자 헬퍼로 교체하고,
**서버 액션이 1차 관문**이 되도록 §4 를 설계했다. shim 이 남는 곳은 전역 성격의 테이블뿐이다.

### 3.4 fail-open 트리거 뒤집기

```sql
create or replace function public.guard_non_admin_column_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 서버·임포트 경로(auth.uid() is null, service_role)는 그대로 통과
  if auth.uid() is null then return new; end if;
  if public.is_project_admin(new.project_id) then return new; end if;

  -- 그 외 전원(멤버·조회 전용·미상): 실적%·산출물만 허용 — fail-closed
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
drop trigger if exists trg_guard_non_admin_column_scope on wbs_items;
create trigger trg_guard_non_admin_column_scope
  before update on wbs_items
  for each row execute function public.guard_non_admin_column_scope();
```

옛 트리거·함수는 `drop` 한다. 남겨 두면 두 트리거가 함께 돌아 판정 근거가 둘이 된다.

### 3.5 정책 교체 — `0052_project_scoped_rls.sql`

프로덕션의 비-SELECT 정책 46개를 셋으로 나눈다. 읽기 정책은 D6 에 따라 손대지 않는다.

**(a) 프로젝트 스코프로 교체 — 24개 정책**

| 테이블 | 현재 정책 | 변경 |
|---|---|---|
| `wbs_items` | `pmo_write_items`(ALL) | `is_project_admin(project_id)` |
| | `team_update_actual`(UPDATE) | `is_project_member(project_id)` + 말단 + 자기 팀 담당 (컬럼 범위는 §3.4 트리거) |
| `item_owners` | `pmo_write_owners`(ALL) | 부모 `wbs_items.project_id` 를 EXISTS 로 미러 |
| `holidays` | `pmo_write_holidays`(ALL) | `is_project_admin(project_id)` |
| `projects` | `pmo_write_projects`(ALL) | INSERT·DELETE → `is_superuser()` / UPDATE → `is_project_admin(id)` |
| `project_members` | `pmo_write_members`(ALL) | `is_project_admin(project_id)` |
| `attendance_records` | `pmo_write_attendance`(ALL) | `is_project_member(project_id)` |
| `announcements` | `pmo_write_announcements`(ALL) | `is_project_admin(project_id)` |
| `task_dependencies` | `task_dependencies_pmo_write`(ALL) | `is_project_admin(project_id)` |
| `wbs_progress_snapshots` | `member_write_progress_snapshots`(ALL) | `is_project_member(project_id)` |
| `meetings` | insert/update/delete_own (3) | insert: 본인 + `is_project_member` / update·delete: 본인 or `is_project_admin` |
| `meeting_attendees`, `meeting_exceptions` | own_write_* (2) | 부모 `meetings` 미러 (판정만 교체) |
| `issues` | insert_own/member_update/delete_own (3) | `meetings` 와 동일 패턴 |
| `issue_assignees` | member_insert/delete (2) | 부모 `issues` 미러 |
| `weekly_reports` | insert/update/delete — **전부 `using(true)`** (3) | insert·delete → `is_project_admin(project_id)` / update → `is_project_member(project_id)` |
| `weekly_report_rows` | insert/update/delete — **전부 `using(true)`** (3) | `is_project_member` (부모 `weekly_reports.project_id` 미러 — 이 테이블엔 `project_id` 가 없음, 실측 확인) |

**(b) 전역(슈퍼유저)으로 조이기 — 5개 정책**

`memberships`(`pmo_write_memberships`), `teams`(`admin_insert_teams`·`admin_update_teams`),
`llm_config`·`llm_profiles`(`admin_all_*`) → `is_superuser()`.

**(c) 손대지 않음 — 개인 소유 행**

`announcement_seen`, `user_preferences`, `user_wbs_state`, `minute_favorites`, `change_logs`
— 전부 `user_id = auth.uid()` 기준이라 역할과 무관하다.

**첨부 헬퍼도 함께 조인다.** `can_attach(item)` 은 지금 `app_role()='pmo_admin' or 팀 담당` 이라
**조회 전용 사용자도 팀만 맞으면 통과**한다. 항목의 `project_id` 를 조회해 `is_project_member`
조건을 추가한다. `deliverable_attachments`(`attach_insert`/`attach_delete`)와
`storage.objects`의 deliverables 정책 3개가 이 헬퍼를 공유하므로 함수 하나만 고치면 된다.

**회의록 계열은 RLS 로 못 막는다.** `minutes` 는 쓰기 정책이 없고(§1.5), 자식 테이블
`minute_files`·`minute_folders`·`minute_highlights` 의 `own_*` 정책은 admin client 경로에서
평가되지 않는다. 이 계열의 권한은 §4 서버 액션 가드가 전담하며, 스펙은 그 사실을 감추지 않는다.
`minutes.project_id` 는 nullable 이므로(미지정 상태 허용 — 회의록 탐색기 설계) 서버 액션도
`null` 분기를 명시적으로 처리한다: 프로젝트 미지정 회의록의 수정·삭제는 **작성자 또는 슈퍼유저**만.

### 3.6 백필과 검증 (0051 말미, 같은 트랜잭션)

```sql
-- 슈퍼유저 (D5)
update memberships m set is_superuser = true
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) in ('donseok.lee@dongkuk.com', 'donseok75@gmail.com');

-- 프로젝트 역할 (D4) — 프로젝트 전체에 대해 규칙으로 부여한다(하드코딩 명단 금지)
insert into project_roles (project_id, user_id, role, granted_by, granted_at)
select p.id, m.user_id,
       case when t.code = 'PMO' and m.role = 'pmo_admin' then 'admin' else 'member' end,
       null, now()
  from projects p
 cross join memberships m
  join teams t on t.id = m.team_id
 on conflict (project_id, user_id) do nothing;
```

**검증 블록** — 통과하지 못하면 `raise exception` 으로 트랜잭션을 중단한다.

```sql
do $$
declare lost int; su int;
begin
  -- (a) 기존 pmo_admin 28명이 전원 superuser 또는 admin 으로 안착했는가
  select count(*) into lost from memberships m
   where m.role = 'pmo_admin' and not m.is_superuser
     and not exists (select 1 from project_roles r
                      where r.user_id = m.user_id and r.role = 'admin');
  -- 비PMO pmo_admin 14명은 D4 에 따라 의도적으로 멤버로 강등된다 → 기대값 14
  if lost <> 14 then
    raise exception '0051 중단: 강등 대상이 14명이어야 하는데 %명입니다. 백필 규칙을 확인하세요.', lost;
  end if;

  -- (b) 슈퍼유저가 정확히 2명인가
  select count(*) into su from memberships where is_superuser;
  if su <> 2 then
    raise exception '0051 중단: 슈퍼유저가 2명이어야 하는데 %명입니다.', su;
  end if;

  -- (c) 권한 없는 계정이 생기지 않았는가 (조회 전용 0명이 이관 기대치)
  if exists (select 1 from memberships m
              where not m.is_superuser
                and not exists (select 1 from project_roles r where r.user_id = m.user_id)) then
    raise exception '0051 중단: 프로젝트 역할이 없는 계정이 있습니다.';
  end if;
end $$;
```

기대값 14·2 는 §1.2 실측에 근거한다. 적용 시점에 계정이 늘어 숫자가 어긋나면 **중단하는 것이
맞다** — 조용히 통과시키면 누가 권한을 잃었는지 모른 채 배포된다.

### 3.7 이관 결과

| 대상 | 인원 | 결과 |
|---|--:|---|
| `donseok.lee@` · `donseok75@` | 2 | 슈퍼유저 (+ D-CUBE 관리자) |
| PMO팀 `pmo_admin` 나머지 (`dcube@` 공용계정 포함) | 12 | D-CUBE 관리자 |
| 비PMO `pmo_admin` (MES 11 · ERP 2 · 가공 1) | 14 | D-CUBE 멤버 |
| `team_editor` (ERP 9 · MES 4) | 13 | D-CUBE 멤버 |
| **합계** | **41** | 조회 전용 0명 |

권한을 잃는 사람은 비PMO `pmo_admin` 14명뿐이고, 잃는 것은 WBS 구조 편집·공지·인력 로스터·위키
큐레이션이다. 실적 입력·회의·회의록·주간보고·이슈·첨부·근태는 그대로 유지된다.

---

## 4. 애플리케이션 계층

### 4.1 모듈 경계

```
src/lib/domain/authz.ts     순수 판정. Actor + 액션(+컨텍스트) → boolean.
                            부수효과·IO 없음. 4역할 × 전 기능 매트릭스를 테스트로 고정.
src/lib/authz.ts            getActor() — 세션에서 Actor 조립(전역 등급 + 프로젝트 역할 맵).
                            requireProjectAdmin/Member(pid) 가드. 조회 실패는 거부(fail-closed).
src/lib/domain/permissions.ts  기존 canEditActual/canEditWeight/canEditDeliverable 를
                            Membership → Actor 시그니처로 변경. 호출부는 WBS 화면 계열.
```

```ts
export type ProjectRole = 'admin' | 'member'

export interface Actor {
  userId: string
  teamCode: TeamCode | null
  teamId: string | null
  isSuperuser: boolean
  projectRoles: ReadonlyMap<string, ProjectRole>   // projectId → role
}

export function roleIn(actor: Actor, projectId: string): ProjectRole | 'viewer'
export function isProjectAdmin(actor: Actor, projectId: string): boolean
export function isProjectMember(actor: Actor, projectId: string): boolean
```

`getMembership()` 은 남긴다(헤더 표시·팀 라벨 등 역할과 무관한 소비자가 있다). `getActor()` 가
같은 조회를 흡수하되, 권한 판정은 전부 `getActor()` 경로로 단일화한다.

### 4.2 서버 액션 교체

`src` 에 흩어진 `pmo_admin` 비교식 75곳(테스트 제외)을 액션의 성격에 따라 셋 중 하나로 바꾼다.

```ts
const a = await requireProjectAdmin(projectId)    // 관리자 이상
const a = await requireProjectMember(projectId)   // 멤버 이상
const a = await requireSuperuser()                // 전역 관리
```

가드는 실패 사유를 구분해 반환한다 — 조회 실패(`불러올 수 없음`)와 권한 없음(`권한 없음`)을
같은 문구로 뭉개지 않는다(에러 처리 3원칙: 표시 = 로깅).

**`projectId` 를 인자로 받지 않는 액션이 있다.** 이 경우 대상 행에서 `project_id` 를 **먼저 조회**해
판정한다. 선행 조회가 실패하면 쓰기를 중단한다(3원칙 2). 해당 액션은 구현 계획에서 개별 식별한다.

### 4.3 전수 점검 대상

| 경로 | 현재 | 조치 |
|---|---|---|
| `src/app/actions/*.ts` (20파일 · 액션 105개) | 각자 하드코딩 | 가드 3종으로 통일 |
| `src/app/actions/weekly.ts` (액션 4개) | `getSession()` 만 — **멤버십도 안 봄** | `requireProjectMember` |
| `src/app/actions/minutes.ts` (액션 27개) | 작성자·`pmo_admin`, **admin client** | RLS 2차 방어선 없음(§1.5) — 가드가 유일 관문이므로 최우선 검토 |
| `src/app/actions/preferences.ts`, `notifications.ts` | 게이트 없음 | 개인 설정이라 로그인만으로 정상 — 변경 없음(근거 주석) |
| `src/app/api/import/route.ts` | `pmo_admin` | `requireProjectAdmin` |
| `src/app/api/chat/reindex`, `health` | `pmo_admin` | `requireSuperuser` |
| `src/app/api/chat/command`, `stream`, `v2/stream` | `getSession()` (읽기 제안 전용) | 변경 없음 — 실제 쓰기는 서버 액션이 재검증(확인함) |
| `src/app/api/v1/minutes/*` | 외부 토큰 인증 | **무영향** — 사람 권한 체계와 무관(확인함) |
| `src/app/(app)/**/page.tsx` 리다이렉트 게이트 | `pmo_admin` | 역할에 맞게 재지정 |

### 4.4 UI 어포던스

조회 전용에게 쓰기 버튼을 노출하지 않는다. 다만 **어포던스는 편의이지 방어선이 아니다** —
서버 액션 가드가 항상 재검증한다(기존 관례 유지).

사이드바·전역 레이아웃이 `src/components/app/*` 에 있으면 CLAUDE.md G2 대상이므로
`ui/authz` 브랜치로 push 해 Preview 를 받은 뒤 머지한다. Preview 는 Supabase 에 접근하지 못해
로그인 후 화면을 볼 수 없다는 한계를 알고 쓴다(속도 방지턱이지 보증이 아님).

---

## 5. 기능별 권한 매트릭스

`○` 가능 · `본인` 자신이 만든 것만 · `팀` 자기 팀이 담당인 항목만 · `—` 불가

| 기능 | 슈퍼유저 | 관리자 | 멤버 | 조회 |
|---|:--:|:--:|:--:|:--:|
| **전역** ||||
| 프로젝트 생성·삭제 | ○ | — | — | — |
| 슈퍼유저 지정·해제 | ○ | — | — | — |
| 관리자 지정·해제 | ○ | — | — | — |
| 팀 기준정보 `/admin/teams` | ○ | — | — | — |
| LLM 설정 `/admin/llm-config` | ○ | — | — | — |
| 봇 재색인·헬스 | ○ | — | — | — |
| 계정 생성·비밀번호 초기화 | ○ | ○ | — | — |
| 멤버 지정·해제 | ○ | ○ | — | — |
| **프로젝트** ||||
| 프로젝트 설정(기준일·휴일·설명) | ○ | ○ | — | — |
| WBS 구조(추가·삭제·일정·가중치·담당팀·의존성) | ○ | ○ | — | — |
| WBS 엑셀 임포트·교체 | ○ | ○ | — | — |
| WBS 실적%·산출물 텍스트 | ○ | ○ | 팀 | — |
| 산출물 첨부파일 | ○ | ○ | 팀 | — |
| 공지 등록·수정·삭제 | ○ | ○ | — | — |
| 프로젝트 인력 로스터 | ○ | ○ | — | — |
| 근태 기록 | ○ | ○ | ○ | — |
| 회의 등록·수정·삭제 | ○ | ○ | 본인 | — |
| 회의록 업로드·수정·삭제·편철 | ○ | ○ | 본인 | — |
| 주간보고 셀 작성·수정 | ○ | ○ | ○ | — |
| 주간보고 회차 생성·삭제 | ○ | ○ | — | — |
| 이슈 등록·수정·삭제 | ○ | ○ | 본인 | — |
| 위키 큐레이션·주제 병합 | ○ | ○ | — | — |
| AI 브리핑 생성 | ○ | ○ | — | — |
| 봇 WBS 쓰기 명령 적용 | ○ | ○ | — | — |
| **전원** ||||
| 모든 화면 조회 | ○ | ○ | ○ | ○ |
| 챗봇 질의, 엑셀·PPT 내려받기 | ○ | ○ | ○ | ○ |
| 개인 설정(테마·언어·접힘), 공지 읽음 | ○ | ○ | ○ | ○ |

**경계 두 건의 근거**

- **근태는 멤버 허용, 대상은 로스터 전원.** 실무에서 팀 총무가 팀원 근태를 대신 입력한다.
  "본인 것만"으로 좁히면 지금 PMO 가 하던 일괄 입력이 불가능해진다.
- **주간보고 셀은 멤버 전체 개방, 회차 생성·삭제만 관리자.** 구글시트형 공동편집이라 셀 단위로
  소유자를 나누면 기존 멀티셀 편집·프레즌스가 깨진다.

---

## 6. 화면

### 6.1 `/admin/accounts` — 계정 관리

권한 드롭다운의 **의미가 바뀐다**. 현재 `pmo_admin | team_editor` 단일 선택을 다음으로 대체한다.

- `팀코드` (기존 유지 — WBS 담당 판정용)
- `프로젝트 역할` = `관리자 | 멤버 | 조회` (대상 프로젝트는 화면 상단에서 선택)
- `슈퍼유저` 토글 — **슈퍼유저에게만 노출**

일괄 등록 포맷의 3열도 바뀐다.

```
현재:  이메일, 팀코드, pmo_admin|team_editor, 초기비번[, 이름]
변경:  이메일, 팀코드, admin|member|viewer,   초기비번[, 이름]
```

`parseBulkAccounts`(`src/lib/domain/accounts.ts:41`)의 `isAccountRole` 검증과 화면 안내문
(`AccountsManager.tsx:245-252`)을 함께 고친다. 슈퍼유저는 일괄 등록으로 지정할 수 없다.

**마지막 슈퍼유저 강등 방지** — `updateAccountRole` 의 기존 "마지막 PMO 관리자" 가드
(`accounts.ts:150-165`)를 "마지막 슈퍼유저"로 이식한다. 조회 실패는 거부(fail-closed) 유지.

### 6.2 `/p/[projectId]/settings` 권한 탭 (신설)

이 프로젝트의 관리자·멤버 목록과 추가·제거. 관리자에게는 멤버 슬롯만 조작 가능하게 하고
관리자 슬롯은 읽기 전용으로 보여준다(D7 — 관리자가 관리자를 늘리면 지금의 28명 상황이 재현된다).

### 6.3 어포던스

조회 전용에게 등록·수정·삭제 버튼을 숨긴다. 대상: WBS 시트, 회의, 회의록, 주간보고, 이슈,
근태, 공지, 인력 로스터, 첨부, 위키.

---

## 7. 배포 순서

마이그레이션과 코드는 **항상 별도 커밋**이다(CLAUDE.md G1 · pre-push 훅이 차단).

| 순서 | 내용 | 비고 |
|---|---|---|
| 1 | `0051_authz_roles.sql` 적용 | 컬럼을 더하기만 하므로 **적용 직후에도 기존 코드가 그대로 동작**한다 |
| 2 | 코드 배포 (authz 모듈 · 가드 교체 · 화면) | 이 시점부터 새 판정이 1차 방어선 |
| 3 | `0052_project_scoped_rls.sql` 적용 | 쓰기 정책 29개 교체(프로젝트 24 + 전역 5) + `can_attach` 조이기 |
| 4 | `0053_deprecate_membership_role.sql` | `memberships.role` 에 deprecated 주석 박제 (컬럼은 남긴다) |

**`memberships.role` 을 갈아엎지 않는 이유가 이 순서의 핵심이다.** 값을 새 체계로 바꾸면
1번과 2번 사이에 기존 코드 75곳의 문자열 비교가 전부 실패해 41명 전원이 권한을 잃는다.
0019 가 남긴 교훈(마이그레이션 먼저 → 코드 배포)과 같은 방향이다.

각 마이그레이션에 `_rollback.sql` 을 동반한다. 배포 후 `npm run smoke:prod` → 화면 확인 →
`npm run mark:good`.

---

## 8. 실패 모드와 방어

| 위험 | 방어 |
|---|---|
| 백필 누락으로 권한 상실 | §3.6 검증 블록이 기대값(강등 14 · 슈퍼유저 2 · 무권한 0)과 어긋나면 트랜잭션 중단 |
| 마지막 슈퍼유저 강등 → 복구 불가 | §6.1 가드 이식. 조회 실패는 거부 |
| `project_roles` 조회 실패를 "권한 없음"으로 위장 | fail-closed 로 거부하되 사유를 로그와 화면에 구분 표기(3원칙 1) |
| `projectId` 없는 액션의 판정 누락 | 대상 행에서 `project_id` 선행 조회, 실패 시 쓰기 중단(3원칙 2) |
| 역할 이름을 또 바꿔 컬럼 가드가 뚫림 | §3.4 에서 fail-closed 로 뒤집어 구조적으로 재발 불가 |
| 라우트 핸들러 누락 | §4.3 전수표로 18개 라우트 전량 점검 |
| 옛 트리거 잔존으로 판정 근거 이중화 | §3.4 에서 옛 트리거·함수를 명시적으로 `drop` |
| **"RLS 가 막아 준다"는 잘못된 안심** | §1.5 의 service_role 경로에는 2차 방어선이 없다. 회의록 27개 액션 가드를 최우선으로 채우고, 해당 코드에 근거 주석을 남긴다 |
| UI 레이아웃 회귀 | `src/components/app/*` 변경 시 `ui/authz` 브랜치 경유(G2) |

---

## 9. 검증

- `tests/domain/authz.test.ts` — 4역할 × 24기능 매트릭스 전량 (§5 표가 곧 테스트 케이스)
- `tests/domain/permissions.test.ts` — 기존 테스트를 Actor 시그니처로 이행
- `tests/actions/*-gate.test.ts` — 기존 게이트 테스트 패턴(accounts/llmConfig/meeting-notify)을
  주요 액션으로 확장. 특히 **조회 전용이 주간보고 셀을 못 쓴다**는 회귀 테스트
- RLS 시뮬레이션 — `set local role authenticated` + `request.jwt.claims` 로 4역할의 차단을
  프로덕션에서 **읽기로만** 검증. 쓰기 검증은 D-CUBE 데이터 보호 원칙상 금지
- **§1.5 의 service_role 경로(회의록·위키·AI 브리핑)는 RLS 시뮬레이션으로 검증되지 않는다.**
  이 계열은 서버 액션 단위 테스트로만 보장되므로, 회의록 27개 액션의 가드 테스트를
  다른 어떤 항목보다 먼저 채운다
- `npm run build` · `npm run lint` · `npm run test` · 배포 후 `npm run smoke:prod`

---

## 10. 범위 밖 (의도적)

- **조회 범위의 프로젝트 스코프화** — D6 에 따라 `can_read_project()` 헬퍼만 심고 본문은 `true`.
  전환이 필요해지면 이 함수 하나와 읽기 정책만 고치면 된다.
- **역할 세분화**(읽기 전용 관리자, 팀장 등급 등) — 3단으로 확정.
- **`memberships.role` 컬럼 삭제** — 박제까지만. 삭제는 새 체계가 한 사이클 안정된 뒤 별도 작업.
- **감사 로그(권한 변경 이력)** — `granted_by`/`granted_at` 으로 현재 상태의 출처만 남긴다.
  변경 이력 테이블은 후속 과제.
