-- 0089: import 계약 v2.2(nlevel) — 노드별 단계 인덱스·마일스톤·크레딧·I/F 대장 참조 + attach 부착.
-- 배경(2026-08-22 확정, 스펙 docs/superpowers/specs/2026-08-21-wbs-nlevel-md-contract.md §import 계약 v2.2):
-- N단 WBS 분리 업로드 — PMO 골격 선행 후 PL 모듈 파일이 골격 노드(attach) 아래로 들어간다.
-- attach 는 단일 노드(b안 확정 — 모듈 통테 준비도 구축 소속). weight 는 0001 기존 컬럼 재사용.

begin;

set search_path = public, extensions;

-- 1) v2.2 컬럼 — 전부 additive, 기존 행은 null/false 로 두어 레거시 화면에 영향 없음.
alter table public.wbs_items
  add column if not exists level_idx smallint,                        -- levels 배열 인덱스(0-base). null = 레거시(깊이 파생)
  add column if not exists milestone boolean not null default false,  -- [M] — progress none, 발행 제외
  add column if not exists credit_key text,                           -- stage 크레딧 표 키(default/if/doc …)
  add column if not exists if_id text;                                -- PMO I/F 대장 참조(쌍 연결)

-- 2) RPC 교체 — 구 2인자 시그니처를 먼저 drop 한다. create or replace 는 시그니처가 다르면
--    오버로드를 만들고, PostgREST 가 {p_project_id,p_nodes} 호출을 두 함수에 모두 매칭해 모호성
--    에러가 나기 때문이다. 0082 본문 기준 변경점: p_attach_id 파라미터, parent 없는 노드의
--    p_attach_id 부착, v2.2 필드 5종 insert/update.
drop function if exists public.import_wbs_upsert(uuid, jsonb);

create or replace function public.import_wbs_upsert(
  p_project_id uuid,
  p_nodes jsonb,
  p_attach_id uuid default null
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
    else
      -- v2.2: parent 없는 노드는 attach 노드 아래로 — PL 파일 최상위(SUB-*)가 골격 SYS-* 의
      -- 자식이 된다. p_attach_id 가 null(골격·레거시 업로드)이면 종전대로 루트.
      v_parent_id := p_attach_id;
    end if;
    v_start := nullif(v_node->>'planned_start', '')::date;
    v_end := nullif(v_node->>'planned_end', '')::date;

    select id into v_existing from public.wbs_items
      where project_id = p_project_id and external_ref = v_ref;

    insert into public.wbs_items
      (project_id, parent_id, code, sort_order, name, biz, deliverable,
       planned_start, planned_end, stage, external_ref,
       category, domain, priority, model, tags, depends,
       prd_ref, entry_point, acceptance, spec, dev_workflow,
       weight, level_idx, milestone, credit_key, if_id)
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
       coalesce((v_node->>'dev_workflow')::boolean, false),
       nullif(v_node->>'weight','')::numeric,
       nullif(v_node->>'level_idx','')::smallint,
       coalesce((v_node->>'milestone')::boolean, false),
       nullif(v_node->>'credit_key',''), nullif(v_node->>'if_id',''))
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
      weight = excluded.weight,
      level_idx = excluded.level_idx,
      milestone = excluded.milestone,
      credit_key = excluded.credit_key,
      if_id = excluded.if_id,
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
