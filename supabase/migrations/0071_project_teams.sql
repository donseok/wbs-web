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
-- getActor 의 rosterTeams 조회와 아래 RLS 합집합 서브쿼리가 필요로 하는 user_id 단독 탐색은
-- 0019_project_member_user_link.sql:74-75 의 project_members_user_idx(동일 정의)가 이미 받친다.
-- 신규 인덱스 불필요(리뷰 fix round 1 — 이름이 달라 if not exists 로 못 막는 중복이었다).

-- ── 2) 코드 유니크 재편 — 위키 무동작 FK 선행 제거(의존 객체) 후 복합 유니크 ──
-- 제약 실명은 적용 직전 프로덕션에서 확인한다(Task 2 Step 1). if exists 로 방어하되,
-- 실명이 다르면 "조용히 건너뛴 채 복합 유니크 추가"가 되므로 Task 2 의 사후 검증 쿼리가 최종 관문이다.
alter table public.wiki_topics drop constraint if exists wiki_topics_owner_team_fkey;
alter table public.wiki_items drop constraint if exists wiki_items_owner_team_fkey;
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
create or replace function import_wbs(
  p_project_id uuid,
  p_items jsonb,      -- [{tempId,parentTempId,level,code,sortOrder,name,biz,deliverable,plannedStart,plannedEnd,weight,actualPct,owners:[{team,kind}],isOwnerSplit}]
  p_holidays jsonb    -- [{date,name}]
) returns integer
language plpgsql
as $$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$$;

create or replace function public.replace_wbs(
  p_project_id uuid,
  p_items jsonb,      -- [{tempId,parentTempId,level,code,sortOrder,name,biz,deliverable,plannedStart,plannedEnd,weight,actualPct,owners:[{team,kind}],isOwnerSplit}]
  p_holidays jsonb    -- [{date,name}]
) returns integer
language plpgsql
as $$
declare
  v_item jsonb;
  v_owner jsonb;
  v_hol jsonb;
  v_id uuid;
  v_parent uuid;
  v_team uuid;
  v_map jsonb := '{}'::jsonb;   -- tempId -> 생성된 uuid(text)
  v_count integer := 0;
begin
  delete from public.wbs_items where project_id = p_project_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_parent := null;
    if nullif(v_item->>'parentTempId', '') is not null then
      v_parent := nullif(v_map->>(v_item->>'parentTempId'), '')::uuid;
    end if;

    insert into wbs_items (
      project_id, parent_id, level, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'level', v_item->>'code',
      coalesce((v_item->>'sortOrder')::int, 0), v_item->>'name',
      nullif(v_item->>'biz', ''), nullif(v_item->>'deliverable', ''),
      nullif(v_item->>'plannedStart', '')::date, nullif(v_item->>'plannedEnd', '')::date,
      nullif(v_item->>'weight', '')::numeric, nullif(v_item->>'actualPct', '')::numeric,
      coalesce((v_item->>'isOwnerSplit')::boolean, false)
    )
    returning id into v_id;

    v_map := jsonb_set(v_map, array[v_item->>'tempId'], to_jsonb(v_id::text));

    for v_owner in select value from jsonb_array_elements(coalesce(v_item->'owners', '[]'::jsonb)) as t(value)
    loop
      select id into v_team from teams
       where code = v_owner->>'team' and (project_id = p_project_id or project_id is null)
       order by (project_id is not null) desc limit 1;
      if v_team is not null then
        insert into item_owners (wbs_item_id, team_id, kind)
        values (v_id, v_team, v_owner->>'kind')
        on conflict (wbs_item_id, team_id) do nothing;
      end if;
    end loop;

    v_count := v_count + 1;
  end loop;

  for v_hol in select value from jsonb_array_elements(coalesce(p_holidays, '[]'::jsonb)) as t(value)
  loop
    insert into holidays (project_id, date, name)
    values (p_project_id, (v_hol->>'date')::date, nullif(v_hol->>'name', ''))
    on conflict (project_id, date) do update set name = excluded.name;
  end loop;

  return v_count;
end;
$$;

-- ── 8) update_project_member_with_identity — p_role_label 추가 ────────────
-- 시그니처가 바뀌므로 create or replace 가 아니라 구버전 drop 후 신설(오버로드가 남으면
-- PostgREST 의 6-인자 named-args 호출이 모호해져 기존 앱까지 깨진다).
drop function if exists public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text
);
create or replace function public.update_project_member_with_identity(
  p_member_id uuid,
  p_name text,
  p_email text,
  p_team_id uuid,
  p_role text,
  p_title text,
  p_role_label text default null
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
         title = p_title,
         role_label = p_role_label
   where id = p_member_id;

  return true;
end
$$;

revoke all on function public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text, text
) to authenticated;

reset search_path;
commit;
