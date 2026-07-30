-- 권한 체계 3단 재설계 — 전역 등급(슈퍼유저) + 프로젝트 역할(관리자/멤버) 2축.
--
-- 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md
--   (스펙은 이 파일을 0051 로 부르지만, 그 사이 0051 을 usage_events 가 차지해 0052 가 됐다.)
--
-- 핵심 원칙: 컬럼을 '더하기만' 한다. memberships.role 은 손대지 않는다.
--   값을 새 체계로 갈아엎으면 이 마이그레이션 적용 시점부터 코드 배포 완료까지
--   기존 코드 75곳의 문자열 비교가 전부 실패해 41명 전원이 권한을 잃는다.
--   role 컬럼은 0054 에서 deprecated 로 박제만 하고 남긴다.
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
--
-- **1회성 이관이다.** cross join 은 실행 시점의 모든 프로젝트 × 모든 멤버십을 채우므로,
-- 두 번째 프로젝트가 생긴 뒤 이 파일을 재실행하면 그 프로젝트에 41명 전원이 조용히
-- 등록된다(신규 프로젝트는 빈 역할로 시작해야 한다는 새 체계와 정반대). 검증 블록도
-- 그 변화를 감지하지 못한다. 그래서 project_roles 가 비어 있을 때만 돈다 —
-- 이 가드가 있어야 "재실행 안전"이 권한 대량 부여를 뜻하지 않게 된다.
insert into project_roles (project_id, user_id, role, granted_by, granted_at)
select p.id, m.user_id,
       case when t.code = 'PMO' and m.role = 'pmo_admin' then 'admin' else 'member' end,
       null, now()
  from projects p
 cross join memberships m
  join teams t on t.id = m.team_id
 where not exists (select 1 from project_roles)
    on conflict (project_id, user_id) do nothing;

-- ── 6) app_role() 호환 shim ────────────────────────────────────────────────
-- 정책 텍스트를 건드리지 않고 함수 하나만 바꿔 기존 46개 쓰기 정책의 의미를 보존한다.
-- 알려진 한계(의도적): 프로젝트가 여럿이 되면 "A프로젝트 관리자가 B프로젝트 RLS 통과"가
-- 된다. 그래서 0053 이 핵심 테이블을 프로젝트 인자 헬퍼로 교체하고, 서버 액션이 1차 관문이다.
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
  -- 판정 기준은 **old.project_id** 다. new 로 보면 "A 의 멤버이자 B 의 관리자"가
  -- project_id 를 B 로 바꾸는 UPDATE 한 번으로 컬럼 제한을 통째로 건너뛰고
  -- 이름·일정·가중치까지 재작성할 수 있다(B 관리자로 판정되므로).
  -- old 기준이면 project_id 변경 자체가 아래 diff 검사에 걸려 막힌다.
  if public.is_project_admin(old.project_id) then return new; end if;

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
-- 기대값은 2026-07-30 재실측(pmo_admin 28 = PMO 14 + 비PMO 14, 2026-07-29 와 동일)에 근거한다.
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
    raise exception '0052 중단: 관리자로 안착하지 못한 옛 pmo_admin 이 14명이어야 하는데 %명입니다. 백필 규칙과 팀 소속을 확인하세요.', demoted;
  end if;

  select count(*) into su from memberships where is_superuser;
  if su <> 2 then
    raise exception '0052 중단: 슈퍼유저가 2명이어야 하는데 %명입니다. 대상 이메일을 확인하세요.', su;
  end if;

  select count(*) into orphan from memberships m
   where not m.is_superuser
     and not exists (select 1 from project_roles r where r.user_id = m.user_id);
  if orphan > 0 then
    raise exception '0052 중단: 프로젝트 역할이 없는 계정이 %건 있습니다.', orphan;
  end if;
end $$;

commit;
