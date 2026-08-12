-- 0079: stage 워크플로 재설계 — 'todo' 제거(NULL=미착수로 통합), dev_workflow 플래그 신설.
-- 배경(2026-08-13 사용자 결정): 담당자·stage가 독립 축이라 "담당자 있는데 할 일/미도입" 같은
-- 모순 조합이 생겼다. 도입 여부는 dev_workflow(boolean), 진행은 stage(NULL→as→…→xx),
-- 소유는 assignee_member_id 로 축을 분리한다. stage 의미 정본은 dev-workflow state-machine.json.

begin;

set search_path = public, extensions;

-- 1) 기존 'todo' 행을 NULL 로 이관 (CHECK 재정의 전에 수행해야 한다)
update public.wbs_items set stage = null where stage = 'todo';

-- 2) CHECK 재정의 — 0077 이 컬럼 인라인으로 만든 자동명 제약을 지우고 명시명으로 재생성
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','fp','ip','im','xx'));

-- 3) dev_workflow — "에이전트 개발 워크플로 대상" 플래그. 기존 행은 전부 false(레거시 % 관리).
alter table public.wbs_items
  add column if not exists dev_workflow boolean not null default false;

-- 4) RPC 교체 — dev_workflow upsert + stage 'todo' 하위호환 정규화(v2.0 export 수용).
--    0077 본문 전체를 기준으로 세 곳만 변경: stage 값 식, insert 컬럼/값에 dev_workflow 추가,
--    on conflict set 에 dev_workflow = excluded.dev_workflow 추가. 시그니처는 0077 그대로.
create or replace function public.import_wbs_upsert(
  p_project_id uuid,
  p_nodes jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_node jsonb;
  v_ref text;
  v_parent_ref text;
  v_parent_id uuid;
  v_existing uuid;
  v_upserted int := 0;
  v_skipped int := 0;
  v_ids jsonb := '{}'::jsonb;  -- external_ref → wbs_items.id
  v_new jsonb := '[]'::jsonb;  -- 신규 삽입된 external_ref 목록(호출부의 배정·발행 대상)
  v_id uuid;
  v_start date;
  v_end date;
begin
  for v_node in select * from jsonb_array_elements(p_nodes) loop
    v_ref := v_node->>'external_ref';
    if v_ref is null or v_ref = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_parent_ref := nullif(v_node->>'parent_external_ref', '');
    v_parent_id := null;
    if v_parent_ref is not null then
      -- 같은 배치 앞 원소 우선, 없으면 기존 행에서 해석. 둘 다 없으면 루트로 들어가지 않고 skip.
      if v_ids ? v_parent_ref then
        v_parent_id := (v_ids->>v_parent_ref)::uuid;
      else
        select id into v_parent_id from public.wbs_items
          where project_id = p_project_id and external_ref = v_parent_ref;
        if v_parent_id is null then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;
    end if;
    v_start := nullif(v_node->>'planned_start', '')::date;
    v_end := nullif(v_node->>'planned_end', '')::date;

    select id into v_existing from public.wbs_items
      where project_id = p_project_id and external_ref = v_ref;

    insert into public.wbs_items
      (project_id, parent_id, code, sort_order, name, biz, deliverable,
       planned_start, planned_end, stage, external_ref,
       category, domain, priority, model, tags, depends,
       prd_ref, entry_point, acceptance, spec, dev_workflow)
    values
      (p_project_id, v_parent_id, coalesce(nullif(v_node->>'code',''), v_ref),
       coalesce((v_node->>'sort_order')::int, 0), v_node->>'title',
       nullif(v_node->>'biz',''), nullif(v_node->>'deliverable',''),
       v_start, v_end,
       case when v_node->>'stage' in ('', 'todo') then null else v_node->>'stage' end,
       v_ref,
       nullif(v_node->>'category',''), nullif(v_node->>'domain',''),
       nullif(v_node->>'priority',''), nullif(v_node->>'model',''),
       array(select jsonb_array_elements_text(coalesce(v_node->'tags', '[]'::jsonb))),
       array(select jsonb_array_elements_text(coalesce(v_node->'depends', '[]'::jsonb))),
       nullif(v_node->>'prd_ref',''), nullif(v_node->>'entry_point',''),
       coalesce(v_node->'acceptance', '[]'::jsonb), nullif(v_node->>'spec',''),
       coalesce((v_node->>'dev_workflow')::boolean, false))
    on conflict (project_id, external_ref) where external_ref is not null
    do update set
      parent_id = excluded.parent_id,
      code = excluded.code,
      sort_order = excluded.sort_order,
      name = excluded.name,
      biz = excluded.biz,
      deliverable = excluded.deliverable,
      planned_start = excluded.planned_start,
      planned_end = excluded.planned_end,
      -- 결정 B/E — 파일 소유 명세 필드는 재업로드가 갱신한다(⑫: stage·assignee·actual_pct 만 웹 보존).
      category = excluded.category,
      domain = excluded.domain,
      priority = excluded.priority,
      model = excluded.model,
      tags = excluded.tags,
      depends = excluded.depends,
      prd_ref = excluded.prd_ref,
      entry_point = excluded.entry_point,
      acceptance = excluded.acceptance,
      spec = excluded.spec,
      dev_workflow = excluded.dev_workflow,
      updated_at = now()
    returning id into v_id;

    v_ids := jsonb_set(v_ids, array[v_ref], to_jsonb(v_id::text));
    if v_existing is null then
      v_new := v_new || to_jsonb(v_ref);
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  return jsonb_build_object(
    'upserted', v_upserted, 'skipped', v_skipped, 'ids', v_ids, 'new_refs', v_new);
end;
$$;

reset search_path;

commit;
