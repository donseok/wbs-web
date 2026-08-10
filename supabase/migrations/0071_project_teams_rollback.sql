-- 0071 롤백. 순서: 앱 코드 롤백 선배포 → 이 파일 적용(0044 관례).
-- ⚠️ 전제: 프로젝트 팀 행(project_id is not null)이 남아 있으면 teams_code_key 재추가가
-- 동명 충돌로 실패할 수 있다 — 아래 delete 가 프로젝트 팀 행을 제거한다(전역 행 무접촉).
-- item_owners.team_id 는 on delete cascade(0001_init.sql) 라 그 행을 참조하던 item_owners 행이
-- 함께 지워진다. project_members.team_id 는 on delete set null(0003_ops.sql:13) 이라 지워지지
-- 않고 명단의 팀 배정만 null 로 남는다(로스터 행 자체는 보존). 롤백은 프로젝트 팀 기능 전체의
-- 철회이므로 둘 다 의도된 동작이다.
begin;
set search_path = public, extensions;

-- 정책·함수 원복
drop policy if exists pa_insert_project_teams on public.teams;
drop policy if exists pa_update_project_teams on public.teams;

-- member_update_actual: 0053_project_scoped_rls.sql:79-93 원문 그대로 재생성
drop policy if exists member_update_actual on wbs_items;
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

-- can_attach: 0053:254-270 원문 그대로 재생성
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

-- import_wbs / replace_wbs: 0060 / 0061 원문 그대로 재생성
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
      select id into v_team from teams where code = v_owner->>'team';
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
      select id into v_team from teams where code = v_owner->>'team';
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

-- update_project_member_with_identity: 7-인자 drop 후 0070:201-327 원문(6-인자) 재생성
drop function if exists public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text, text
);
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

-- 컬럼·제약 원복 — 프로젝트 팀 행 제거 후 전역 유니크 복원, 위키 FK 재추가
-- ⚠️ 코드 롤백 선배포: 앱이 여전히 7-인자 RPC·project_id 스코프를 호출 중이면 이 delete/drop 뒤 오류가 난다.
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
alter table public.teams drop column if exists project_id;
alter table public.project_members drop column if exists role_label;

reset search_path;
commit;
