-- 0062: import_wbs·replace_wbs RPC 에서 level insert 제거 — level 컬럼 drop 준비(Task 4, 2026-08-01).
--
-- level 컬럼은 deprecated 다(N단 WBS 코어 전환 이후 depth/parent_id 기반 판정으로 대체됨 — Plan D,
-- generic-wbs-core). 이 마이그레이션은 두 RPC(0060 의 import_wbs, 0061 의 replace_wbs)의 INSERT
-- 컬럼 화이트리스트에서 level 을 빼고 v_item->>'level' 값도 함께 뺀다. level 은 아직 nullable 컬럼으로
-- 남아 있으므로 insert 목록에서 빠지면 그냥 default null 로 들어간다(안전) — 컬럼 자체의 drop 은 이
-- 마이그레이션이 프로덕션에 적용된 뒤 별도 마이그레이션이 담당한다.
--
-- 그 외 본문(부모 해석·owners 순회·holidays upsert·is_owner_split, replace_wbs 의 선행 delete)은
-- 0060/0061 과 바이트 동일하게 보존한다. 0061 말미의 project_settings.excel_profile 백필은 1회성
-- 데이터 이관이었으므로 여기서 재실행하지 않는다(재실행하면 그사이 저장된 커스텀 프로파일을 덮어쓴다).
begin;
set search_path = public, extensions;

create or replace function import_wbs(
  p_project_id uuid,
  p_items jsonb,      -- [{tempId,parentTempId,code,sortOrder,name,biz,deliverable,plannedStart,plannedEnd,weight,actualPct,owners:[{team,kind}],isOwnerSplit}]
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
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
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
  p_items jsonb,      -- [{tempId,parentTempId,code,sortOrder,name,biz,deliverable,plannedStart,plannedEnd,weight,actualPct,owners:[{team,kind}],isOwnerSplit}]
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
      project_id, parent_id, code, sort_order, name, biz, deliverable,
      planned_start, planned_end, weight, actual_pct, is_owner_split
    ) values (
      p_project_id, v_parent, v_item->>'code',
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

reset search_path;
commit;
