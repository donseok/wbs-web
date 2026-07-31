-- 임포트 마법사 Plan B, Task 2 — replace_wbs RPC 신규 + D-CUBE excel_profile 백필(§6.6-3, §7.5).
--
-- replace_wbs 는 0060_import_wbs_owner_split.sql 의 import_wbs 본문을 복제한 "신규" 함수다(함수 분리가
-- 계약 — import_wbs 는 이 마이그레이션에서 무접촉). 서두에 해당 프로젝트 wbs_items 전량 delete 를 추가해
-- "임포트(추가)"가 아닌 "교체" 시맨틱을 구현한다.
--
-- change_logs 는 wbs_item_id 가 on delete cascade(0001_init.sql)라 이 delete 와 함께 자동으로 지워진다.
-- 이력 백업은 이 함수의 책임이 아니다(사용자 결정 Q1: 백업 대상은 트리(wbs_items)뿐 — change_logs 유실은
-- 비가역이며 앱 계층이 확인 화면에서 경고한다).
--
-- 권한 게이트는 import_wbs 와 동일한 방식을 그대로 복제한다: 0006/0060 실물에는 함수 본문에 관리자 검사가
-- 없고 SECURITY DEFINER 도 쓰지 않는다(기본값인 INVOKER) — 호출자 권한으로 실행되어 wbs_items 의 RLS 정책
-- admin_write_items(0053_project_scoped_rls.sql, is_project_admin(project_id))가 delete·insert 를 모두
-- 게이트한다. replace_wbs 도 이와 동일하게 둔다(함수 서두 관리자 검사 없음).
begin;
set search_path = public, extensions;

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

-- §7.5 parked 항목 해소 — 0058 이 전 프로젝트에 시드한 excel_profile='{}' 을 D-CUBE 레거시 좌표로 채운다.
-- 조건은 이중이다: preset_applied='legacy-dcube' (D-CUBE 관례로 생성된 프로젝트만) AND excel_profile='{}'
-- (아직 아무도 커스텀 프로파일을 저장하지 않은 행만) — 이미 커스텀 값이 있는 프로젝트는 무접촉.
-- 값은 src/lib/excel/profile.ts 의 LEGACY_DCUBE_PROFILE 를 그대로 JSON 직렬화한 것이다(키 순서 무관,
-- 값 일치가 계약 — Task 1 report 의 좌표와 node JSON.parse 대조로 확인했다. Task 2 report 참조).
update public.project_settings
set excel_profile = '{"version":1,"sheetName":"WBS","holidaySheetName":"Holiday","headerRow":2,"hierarchy":{"kind":"columns","columns":[1,2,3]},"logical":{"extraAxis":0,"code":null,"deliverable":11,"start":12,"end":13,"weight":14,"actualPct":16},"teamColumns":[[6,"PMO"],[7,"ERP"],[8,"MES"],[9,"가공"],[10,"MDM"]],"ownerMarks":{"●":"primary","△":"support"}}'::jsonb
where preset_applied = 'legacy-dcube' and excel_profile = '{}'::jsonb;

reset search_path;
commit;
