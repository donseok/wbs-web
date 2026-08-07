-- 프로젝트별 로스터에서 이메일은 같은 사람을 가리키는 전역 키다.
-- 같은 이메일의 여러 프로젝트 소속은 허용하되, 표시 이름은 하나로 고정한다.
--
-- 일반 프로젝트 관리자가 다른 프로젝트 이름을 바꾸는 권한은 없으므로 충돌 이름을
-- 자동 전파하지 않는다. email PK 정본을 먼저 claim한 이름만 허용하고 나머지는 거부한다.
-- email이 NULL인 외부 인력은 기존처럼 프로젝트마다 독립된 이름을 사용할 수 있다.
-- 이름 교정은 update_project_member_with_identity RPC 한 트랜잭션에서 수행한다.
--   * 이 email을 쓰는 로스터가 1행이면 해당 프로젝트 관리자
--   * 2행 이상이면 슈퍼유저만 전 프로젝트 이름을 ON UPDATE CASCADE로 함께 변경
--
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 앱 코드를 배포한다.
-- 롤백: 앱을 0070 이전 버전으로 먼저 돌린 뒤
--       0070_project_member_email_identity_rollback.sql을 적용한다.

begin;

set search_path = public, extensions;

create table if not exists public.project_member_identities (
  email       text primary key,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint project_member_identities_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  ),
  constraint project_member_identities_name_normalized check (
    name = btrim(name) and name <> ''
  )
);

-- 복합 FK의 참조 키. email PK만으로는 PostgreSQL이 (email,name) FK를 받지 않는다.
create unique index if not exists project_member_identities_email_name_uidx
  on public.project_member_identities (email, name);

alter table public.project_member_identities enable row level security;
revoke all on table public.project_member_identities from public, anon, authenticated;
grant all on table public.project_member_identities to service_role;

-- 운영 사전 감사에서 확인한 유일한 충돌. 행을 삭제/병합하면 근태·회의·이슈 FK가
-- 함께 손실되므로, 같은 email의 기존 정본 행 이름으로 대상 이름만 교정한다.
update public.project_members target
   set name = canonical.name
  from public.project_members canonical
 where target.id = '159d4ed9-aeaa-4c39-b40b-8d9d863faf83'::uuid
   and canonical.id = 'a97cab77-9092-44ed-a83a-a91d4be7e03e'::uuid
   and target.email = canonical.email
   and target.name = '종익장'
   and canonical.name = '장종익';

-- 앞으로 이름 비교가 저장 공백에 흔들리지 않게 기존 행도 같은 형태로 수렴시킨다.
update public.project_members
   set name = btrim(name)
 where name <> btrim(name);

-- 알려지지 않은 충돌을 임의의 "최초 이름"으로 덮지 않는다. 명시적으로 정리하지 않은
-- 데이터가 있으면 FK/trigger를 켜기 전에 전체 트랜잭션을 중단한다.
do $$
declare
  v_conflicts integer;
begin
  if exists (
    select 1
      from public.project_members pm
     where btrim(pm.name) = ''
        or (
          pm.email is not null
          and (
            pm.email <> lower(btrim(pm.email))
            or pm.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
          )
        )
  ) then
    raise exception '0070_PRECONDITION_FAILED: blank name or invalid/unnormalized email';
  end if;

  select count(*)
    into v_conflicts
    from (
      select pm.email
        from public.project_members pm
       where pm.email is not null
       group by pm.email
      having count(distinct pm.name) > 1
    ) conflicts;

  if v_conflicts > 0 then
    raise exception '0070_PRECONDITION_FAILED: % conflicting email/name identities remain',
      v_conflicts;
  end if;
end
$$;

insert into public.project_member_identities (email, name)
select distinct pm.email, pm.name
  from public.project_members pm
 where pm.email is not null
on conflict (email) do nothing;

-- 재실행 때 이미 존재하는 정본이 현재 로스터와 다르면 조용히 덮지 않고 중단한다.
do $$
begin
  if exists (
    select 1
      from public.project_members pm
      join public.project_member_identities identity on identity.email = pm.email
     where pm.email is not null
       and pm.name is distinct from identity.name
  ) then
    raise exception '0070_PRECONDITION_FAILED: identity registry disagrees with roster';
  end if;
end
$$;

create or replace function public.enforce_project_member_email_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical_name text;
begin
  -- 0019 normalize trigger가 이름순으로 먼저 실행되지만, 이 함수도 독립적으로
  -- 정규화해 trigger 이름/직접 호출에 계약이 흔들리지 않게 한다.
  new.name := pg_catalog.btrim(new.name);
  if new.name is null or new.name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  if new.email is null then
    return new;
  end if;
  new.email := pg_catalog.lower(pg_catalog.btrim(new.email));
  if new.email = '' then
    new.email := null;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('project_member_identity:' || new.email, 0)
  );

  -- email PK의 INSERT/ON CONFLICT가 같은 이메일의 동시 최초 등록을 직렬화한다.
  -- SELECT 사전검사만으로는 두 트랜잭션이 서로를 못 보고 다른 이름을 넣을 수 있다.
  insert into public.project_member_identities (email, name)
  values (new.email, new.name)
  on conflict (email) do nothing;

  select identity.name
    into v_canonical_name
    from public.project_member_identities identity
   where identity.email = new.email;

  if v_canonical_name is distinct from new.name then
    -- 마지막 로스터가 삭제되거나 email이 바뀐 뒤 남은 orphan 정본은 다음 등록자가
    -- 재선점할 수 있다. 활성 로스터가 하나라도 있으면 다른 프로젝트를 덮지 않고 거부한다.
    if not exists (
      select 1
        from public.project_members pm
       where pm.email = new.email
    ) then
      update public.project_member_identities
         set name = new.name
       where email = new.email;
    else
      raise exception 'PROJECT_MEMBER_EMAIL_NAME_MISMATCH' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_project_member_email_identity()
  from public, anon, authenticated;

-- PostgreSQL은 같은 timing/event trigger를 이름순으로 실행한다. zz_ 접두사로 0019의
-- project_members_normalize_link_trg(email 정규화·명시 user_id 존중) 뒤에 둔다.
drop trigger if exists zz_project_member_email_identity_trg on public.project_members;
create trigger zz_project_member_email_identity_trg
before insert or update of email, name on public.project_members
for each row execute function public.enforce_project_member_email_identity();

alter table public.project_members
  drop constraint if exists project_members_name_normalized;
alter table public.project_members
  add constraint project_members_name_normalized
  check (name = btrim(name) and name <> '');

alter table public.project_members
  drop constraint if exists project_members_email_name_fkey;
alter table public.project_members
  add constraint project_members_email_name_fkey
  foreign key (email, name)
  references public.project_member_identities (email, name)
  on update cascade
  on delete restrict;

-- 프로젝트 속성과 email 정본 이름 변경을 원자적으로 처리한다. 일반 UPDATE action과
-- 전역 rename action을 분리하면 둘 중 하나만 성공할 수 있으므로 한 RPC로 묶는다.
create or replace function public.update_project_member_with_identity(
  p_member_id uuid,
  p_name text,
  p_email text,
  p_team_id uuid,
  p_role text,
  p_title text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.project_members%rowtype;
  v_name text;
  v_email text;
  v_refs integer;
  v_identity_rename boolean;
  v_roster_write_locked boolean := false;
begin
  v_name := pg_catalog.btrim(p_name);
  if v_name is null or v_name = '' then
    raise exception 'PROJECT_MEMBER_NAME_REQUIRED' using errcode = '23514';
  end if;

  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(p_email)), '');
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'PROJECT_MEMBER_EMAIL_INVALID' using errcode = '23514';
  end if;
  if p_role is null or p_role not in ('admin', 'contributor') then
    raise exception 'PROJECT_MEMBER_ROLE_INVALID' using errcode = '23514';
  end if;

  -- 전역 rename 여부를 판정하는 첫 조회에서는 행 잠금을 잡지 않는다.
  -- 대상 행을 먼저 잠그면, 다른 행을 잠근 요청과 FK cascade가 서로를
  -- 기다리는 교착(member row -> advisory <-> advisory -> cascade row)이 생긴다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;

  if v_identity_rename then
    -- ON UPDATE CASCADE와 일반 행 UPDATE의 잠금 순서를 같게 맞추기 위해
    -- 아직 행/advisory 잠금이 없을 때 로스터 쓰기를 잠시 직렬화한다.
    -- 이름 교정은 드물고 행 수도 작아 안전성을 우선한다.
    -- EXCLUSIVE는 일반 SELECT는 허용하지만 다른 RPC의 SELECT ... FOR UPDATE
    -- (ROW SHARE)까지 막는다. SHARE ROW EXCLUSIVE는 ROW SHARE와 호환되어
    -- 다른 RPC가 child 행을 잠근 뒤 UPDATE에서 기다리는 교착이 남는다.
    lock table public.project_members in exclusive mode;
    v_roster_write_locked := true;
  end if;

  -- table lock을 기다리는 동안 대상이 바뀌었을 수 있으므로 행과 권한을
  -- 다시 확정한다. 초기에 rename이 아니었던 요청이 동시 변경으로 rename이
  -- 됐다면, 행을 잠근 채 table lock을 승격하지 말고 재시도로 돌린다.
  select pm.*
    into v_current
    from public.project_members pm
   where pm.id = p_member_id
   for update;
  if not found then
    raise exception 'PROJECT_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_current.project_id) then
    raise exception 'PROJECT_MEMBER_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_identity_rename := v_current.email is not null
    and v_email is not distinct from v_current.email
    and v_name is distinct from v_current.name;
  if v_identity_rename and not v_roster_write_locked then
    raise exception 'PROJECT_MEMBER_RETRY' using errcode = '40001';
  end if;

  -- 같은 email의 이름만 바꾸는 경우 정본을 먼저 갱신한다. FK cascade가 이 email을
  -- 쓰는 모든 프로젝트 로스터 이름을 한 트랜잭션에서 바꾼다.
  if v_identity_rename then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('project_member_identity:' || v_email, 0)
    );

    select count(*)
      into v_refs
      from public.project_members pm
     where pm.email = v_email;

    if v_refs > 1 and not public.is_superuser() then
      raise exception 'PROJECT_MEMBER_IDENTITY_RENAME_FORBIDDEN' using errcode = '42501';
    end if;

    update public.project_member_identities identity
       set name = v_name
     where identity.email = v_email;
    if not found then
      raise exception 'PROJECT_MEMBER_IDENTITY_NOT_FOUND' using errcode = '23503';
    end if;
  end if;

  update public.project_members
     set name = v_name,
         email = v_email,
         team_id = p_team_id,
         role = p_role,
         title = p_title
   where id = p_member_id;

  return true;
end
$$;

revoke all on function public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text
) to authenticated;

reset search_path;

commit;
