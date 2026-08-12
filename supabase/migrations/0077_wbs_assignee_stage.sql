-- 0077(구 0076): WBS 전 계층 담당자(로스터 축)·Task 단계(stage)·업로드 매칭 키(external_ref).
-- v1 원칙("에이전트 기능은 기존 테이블 ALTER 0건")의 첫 의도적 예외 — 에이전트 전용이 아니라
-- WBS 제품 기능이다(§2.5). 전 컬럼 nullable/additive — 기존 행·기존 프로젝트 무영향.
-- 담당자 축은 auth 가 아니라 로스터: issue_assignees(0042) 관례의 복합 FK 로
-- "담당자의 프로젝트 = 항목의 프로젝트"를 DB 가 보장한다. 컬럼명은 status 가 아니라 stage —
-- 파생 Status(statusOf) 와의 충돌 회피.

begin;

set search_path = public, extensions;

alter table public.wbs_items
  add column if not exists assignee_member_id uuid,
  add column if not exists stage text
    check (stage in ('todo','as','fp','ip','im','xx')),
  add column if not exists external_ref text,
  -- 결정 B — WBS 중앙관리 확장 명세. 실물 문서는 로컬 git, DB 에는 참조 문자열(prd_ref·entry_point)과
  -- 조립된 마크다운 본문(spec)만 둔다. priority 는 라벨(주문 정수 매핑은 코드 몫 — 계약 v2.0).
  add column if not exists category text,
  add column if not exists domain text,
  add column if not exists priority text
    check (priority in ('critical','high','medium','low')),
  add column if not exists model text,
  add column if not exists tags text[],
  add column if not exists depends text[],   -- 선행 external_ref 배열(결정 C 게이트 키)
  add column if not exists prd_ref text,
  add column if not exists entry_point text,
  add column if not exists acceptance jsonb not null default '[]'::jsonb,
  add column if not exists spec text;

-- 복합 FK: on delete set null 의 대상 컬럼을 명시(PG15+) — 명시하지 않으면 project_id 까지 null 이 된다.
alter table public.wbs_items
  drop constraint if exists wbs_items_assignee_member_fk;
alter table public.wbs_items
  add constraint wbs_items_assignee_member_fk
  foreign key (assignee_member_id, project_id)
  references public.project_members (id, project_id)
  on delete set null (assignee_member_id);

create unique index if not exists wbs_items_project_external_ref_uidx
  on public.wbs_items (project_id, external_ref) where external_ref is not null;

-- 배정 기반 자동 발행의 멱등 보증 — 리프당 활성 주문 1개(§2.8).
-- 사전 확인: 중복 활성 주문이 있으면 인덱스 생성이 실패한다. 적용 전
--   select wbs_item_id, count(*) from agent_work_orders
--   where status in ('ready','claimed','reported') and wbs_item_id is not null
--   group by 1 having count(*) > 1;
-- 이 0행임을 확인하고, 있으면 사람이 취소로 정리한 뒤 적용한다(자동 정리 금지 — 점유 중 작업 보호).
create unique index if not exists agent_work_orders_active_per_item_uidx
  on public.agent_work_orders (wbs_item_id)
  where status in ('ready','claimed','reported') and wbs_item_id is not null;

-- upsert RPC — 마법사 전용 import_wbs(append)/replace_wbs(전삭제) 와 다른 제3의 경로(§2.6).
-- 매칭 키 external_ref. 삭제 없음. 필드 소유권(미결 ⑫ 권고안):
--   신규 행 = 파일 값 전부 시드 / 기존 행 = 구조·일정만 갱신, stage·assignee_member_id·actual_pct 보존.
-- security invoker — 호출은 service_role(라우트 가드가 유일 관문). 부모는 같은 배치의 앞 원소 또는 기존 행.
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
       prd_ref, entry_point, acceptance, spec)
    values
      (p_project_id, v_parent_id, coalesce(nullif(v_node->>'code',''), v_ref),
       coalesce((v_node->>'sort_order')::int, 0), v_node->>'title',
       nullif(v_node->>'biz',''), nullif(v_node->>'deliverable',''),
       v_start, v_end, nullif(v_node->>'stage',''), v_ref,
       nullif(v_node->>'category',''), nullif(v_node->>'domain',''),
       nullif(v_node->>'priority',''), nullif(v_node->>'model',''),
       array(select jsonb_array_elements_text(coalesce(v_node->'tags', '[]'::jsonb))),
       array(select jsonb_array_elements_text(coalesce(v_node->'depends', '[]'::jsonb))),
       nullif(v_node->>'prd_ref',''), nullif(v_node->>'entry_point',''),
       coalesce(v_node->'acceptance', '[]'::jsonb), nullif(v_node->>'spec',''))
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
