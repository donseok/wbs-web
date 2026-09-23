-- supabase/migrations/0103_force_progress.sql
-- 강제 진행 — 의존 간선 면제 + 스텁(docs/superpowers/specs/2026-09-23-force-progress-design.md).
-- ① wbs_items.depends_waived(면제한 선행 ref) ② wbs_items.stub_for(「스텁 제거·실연결」 하위 Task 표식, 구조에 투명)
-- ③ 병목 제안 설정 두 컬럼 ④ depends 축소 시 depends_waived 를 줄이는 트리거 ⑤ 면제 RPC set_dependency_waiver
-- ⑥ apply_workflow_event 재정의: 리프 판정에서 stub 하위 제외 + 스텁 잔존이면 승인·xx 지정 거부.
-- 사전 확인: select count(*) from public.wbs_items where depends is not null;  -- 영향 범위 참고용
-- 적용: npm run db:apply -- supabase/migrations/0103_force_progress.sql --target staging  (운영은 지시 뒤)
begin;

alter table public.wbs_items
  add column if not exists depends_waived text[] not null default '{}',
  add column if not exists stub_for text;

alter table public.wbs_items drop constraint if exists wbs_items_depends_waived_subset;
alter table public.wbs_items add constraint wbs_items_depends_waived_subset
  check (depends_waived <@ coalesce(depends, '{}'::text[]));
alter table public.wbs_items drop constraint if exists wbs_items_stub_for_parent;
alter table public.wbs_items add constraint wbs_items_stub_for_parent
  check (stub_for is null or parent_id is not null);
create unique index if not exists wbs_items_stub_for_uidx
  on public.wbs_items (parent_id, stub_for) where stub_for is not null;

alter table public.project_settings
  add column if not exists force_bottleneck_min_successors int not null default 3,
  add column if not exists force_bottleneck_min_hours int not null default 4;
alter table public.project_settings drop constraint if exists project_settings_force_bottleneck_positive;
alter table public.project_settings add constraint project_settings_force_bottleneck_positive
  check (force_bottleneck_min_successors >= 1 and force_bottleneck_min_hours >= 1);

-- depends 를 바꾸는 모든 쓰기(import_wbs_upsert 재업로드 등)가 면제한 선행을 빼면 depends_waived 를 교집합으로 줄인다.
-- CHECK 만 두면 재업로드 전체가 실패한다. 하위 Task 는 지우지 않는다(스펙 F12 와 같다).
-- security definer: 세션 클라이언트가 depends 를 쓰는 경로가 생겨도 change_logs 의 insert_own_log(user_id = auth.uid())
-- RLS 에 막혀 본 UPDATE 까지 실패하지 않게 한다(0098 broadcast 함수와 같은 선택).
create or replace function public.wbs_items_prune_waived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kept text[];
begin
  if coalesce(array_length(new.depends_waived, 1), 0) = 0 then
    return new;
  end if;
  v_kept := array(select w from unnest(new.depends_waived) as w where w = any(coalesce(new.depends, '{}'::text[])));
  if v_kept is distinct from new.depends_waived then
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (null, new.id, 'depends_waived', array_to_string(new.depends_waived, ','),
              array_to_string(v_kept, ',') || ' (depends 에서 빠짐)');
    new.depends_waived := v_kept;
  end if;
  return new;
end;
$$;

drop trigger if exists wbs_items_prune_waived on public.wbs_items;
create trigger wbs_items_prune_waived
  before update of depends on public.wbs_items
  for each row execute function public.wbs_items_prune_waived();

-- 면제·해제 한 트랜잭션(스펙 F8·§3.2). 판정 순서는 도메인 forceProgress.waiveBlock 과 같다(서버가 정본).
-- 권한은 서버 액션(requireSubtreeManagerOrAdmin)이 먼저 본다 — 이 함수는 service_role 전용.
create or replace function public.set_dependency_waiver(
  p_item_id  uuid,
  p_pred_ref text,
  p_waive    boolean,
  p_reason   text,
  p_actor    uuid
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_project uuid; v_ref text; v_depends text[]; v_waived text[]; v_stub_for text;
  v_assignee uuid; v_tags text[]; v_category text; v_model text; v_priority text;
  v_ps date; v_pe date;
  v_pred_id uuid; v_pred_code text; v_pred_name text; v_pred_stage text; v_pred_pct numeric;
  v_pred_spec text; v_pred_acc jsonb; v_pred_approved boolean;
  v_sub_id uuid; v_sub_created boolean := false; v_sort int; v_sub_name text; v_pred_last text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  select project_id, external_ref, coalesce(depends, '{}'::text[]), depends_waived, stub_for,
         assignee_member_id, tags, category, model, priority, planned_start, planned_end
    into v_project, v_ref, v_depends, v_waived, v_stub_for,
         v_assignee, v_tags, v_category, v_model, v_priority, v_ps, v_pe
    from public.wbs_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'item_not_found'); end if;
  if v_stub_for is not null then return jsonb_build_object('ok', false, 'reason', 'is_stub_task'); end if;
  if exists (select 1 from public.wbs_items where parent_id = p_item_id and stub_for is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_leaf');
  end if;
  if v_ref is null then return jsonb_build_object('ok', false, 'reason', 'no_ref'); end if;
  if not (p_pred_ref = any(v_depends)) then return jsonb_build_object('ok', false, 'reason', 'not_in_depends'); end if;

  if not p_waive then
    -- 해제: 목록에서만 뺀다. 하위 Task 는 유지(F12 — 스텁이 이미 개발 브랜치에 있을 수 있다).
    if not (p_pred_ref = any(v_waived)) then
      return jsonb_build_object('ok', true, 'changed', false, 'sub_task_id', null, 'sub_task_created', false);
    end if;
    update public.wbs_items set depends_waived = array_remove(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', p_pred_ref, '해제 | ' || btrim(p_reason));
    return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', null, 'sub_task_created', false);
  end if;

  select id, code, name, stage, actual_pct, spec, acceptance
    into v_pred_id, v_pred_code, v_pred_name, v_pred_stage, v_pred_pct, v_pred_spec, v_pred_acc
    from public.wbs_items where project_id = v_project and external_ref = p_pred_ref;
  if not found then return jsonb_build_object('ok', false, 'reason', 'pred_not_found'); end if;
  v_pred_approved := exists (select 1 from public.agent_work_orders where wbs_item_id = v_pred_id and status = 'approved');
  -- 선행 충족 세 축(agentWork.predecessorReached) — 이미 도달이면 면제할 이유가 없다.
  if v_pred_stage in ('im', 'xx') or v_pred_approved or coalesce(v_pred_pct, 0) >= 100 then
    return jsonb_build_object('ok', false, 'reason', 'already_reached');
  end if;
  -- F4 계약(forceProgress.hasContract): spec 본문 ∨ acceptance 1건 이상.
  if coalesce(btrim(v_pred_spec), '') = ''
     and (jsonb_typeof(v_pred_acc) is distinct from 'array' or jsonb_array_length(v_pred_acc) = 0) then
    return jsonb_build_object('ok', false, 'reason', 'no_contract');
  end if;

  if not (p_pred_ref = any(v_waived)) then
    update public.wbs_items set depends_waived = array_append(depends_waived, p_pred_ref), updated_at = now()
     where id = p_item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, p_item_id, 'depends_waived', null, p_pred_ref || ' | ' || btrim(p_reason));
  end if;

  -- 하위 Task — 간선당 하나(wbs_items_stub_for_uidx). 재면제는 기존 하위를 다시 쓴다.
  select id into v_sub_id from public.wbs_items where parent_id = p_item_id and stub_for = p_pred_ref;
  if v_sub_id is null then
    v_pred_last := regexp_replace(p_pred_ref, '^.*/', '');
    v_sub_name := '스텁 제거·실연결: ' || v_pred_code || ' ' || v_pred_name;
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.wbs_items where parent_id = p_item_id;
    insert into public.wbs_items (
      project_id, parent_id, code, sort_order, name, external_ref, stub_for, depends,
      dev_workflow, tags, assignee_member_id, category, model, priority, planned_start, planned_end, weight, spec
    ) values (
      v_project, p_item_id, v_pred_last, v_sort, v_sub_name, v_ref || '.stub.' || v_pred_last, p_pred_ref,
      array[p_pred_ref, v_ref],
      true, v_tags, v_assignee, v_category, v_model, v_priority, v_ps, v_pe, null,
      '## 스텁 제거·실연결' || E'\n\n'
      || '선행 ' || v_pred_code || '(' || p_pred_ref || ') 을 대신한 강제 진행 스텁을 실구현으로 바꾼다.' || E'\n\n'
      || '1. 개발 브랜치에서 `git grep -n ''FORCE-STUB: ' || v_pred_last || '''` 로 표식을 모두 찾는다.' || E'\n'
      || '2. 주입 지점을 선행의 실구현으로 바꾸고 `src/__stubs__/' || v_pred_last || '/` 같은 스텁 파일을 지운다.' || E'\n'
      || '3. 후행 ' || v_ref || ' 의 테스트를 실구현 상대로 다시 돌린다. 실패하면 계약 어긋남으로 보고한다.' || E'\n'
      || '4. 완료 조건: 표식 0건 + 후행 테스트 통과.'
    ) returning id into v_sub_id;
    v_sub_created := true;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (p_actor, v_sub_id, 'created', null, v_sub_name);
  end if;

  return jsonb_build_object('ok', true, 'changed', true, 'sub_task_id', v_sub_id, 'sub_task_created', v_sub_created);
end;
$$;

revoke all on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) to service_role;

-- 전이 RPC 재정의 — 0097 본문과 같고 바뀐 곳은 셋: v_stub_pending 선언, 리프 판정의 stub 하위 제외, 스텁 잔존 거부.
create or replace function public.apply_workflow_event(
  p_event         text,
  p_actor         uuid,
  p_item_id       uuid default null,   -- assign|unassign|set_stage 필수. 주문 사건은 주문의 wbs_item_id 를 쓴다(주면 일치해야 한다)
  p_order_id      uuid default null,   -- 주문 사건 필수
  p_stage         text default null,   -- set_stage 전용
  p_agent         text default null,   -- claim: 기록 / report_completion·release: 점유자 일치 조건
  p_agent_user_id uuid default null    -- 위와 같다(PAT 계정)
) returns jsonb
language plpgsql
security invoker
as $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_tags text[];
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_apply boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_stub_pending boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건으로 CAS
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved' end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed' end;
    if v_order_status <> v_expect
       or (p_event in ('report_completion','release') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
    then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  else
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    v_item_id := p_item_id;
  end if;

  -- 항목 잠금. 주문 사건에서 항목이 지워진 주문이면 단계·실적만 건너뛴다(주문 전이는 한다).
  if v_item_id is not null then
    select project_id, stage, actual_pct, dev_workflow, tags
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags
      from public.wbs_items where id = v_item_id for update;
    v_item_found := found;
    if v_item_found then
      -- stub_for 하위(스텁 제거 Task)는 구조에 투명하다(스펙 F9) — 후행은 계속 리프다.
      v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);
    elsif not v_is_order_event then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
  elsif not v_is_order_event then
    return jsonb_build_object('ok', false, 'reason', 'item_required');
  end if;

  -- 스텁 잔존(스펙 F6·F13) — forceProgress.pendingStubs 와 같은 조건. 승인과 사람의 xx 지정을 주문 갱신 전에 거부한다.
  if v_item_found then
    v_stub_pending := exists (select 1 from public.wbs_items
      where parent_id = v_item_id and stub_for is not null and stage is distinct from 'xx');
  end if;
  if v_stub_pending and (p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx')) then
    return jsonb_build_object('ok', false, 'reason', 'stub_pending', 'order_status', v_order_status);
  end if;

  -- 주문 갱신
  if v_is_order_event then
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id,
             claimed_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             updated_at = v_now
       where id = p_order_id;
    else
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' when 'release' then 'as' end;
      v_credit_key := case p_event
        when 'claim' then 'ip' when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' when 'release' then 'as' end;
    end if;
  elsif p_event = 'assign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif v_old_stage is not null then v_skipped := 'stage';
    else v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    end if;
  elsif p_event = 'unassign' then
    if v_dev_workflow is not true then v_skipped := 'not_workflow';
    elsif v_old_stage is distinct from 'as' then v_skipped := 'stage';
    else v_apply := true; v_new_stage := null; v_credit_key := null;
    end if;
  else -- set_stage
    if p_stage is not null and p_stage not in ('as','ip','im','xx') then
      return jsonb_build_object('ok', false, 'reason', 'bad_stage');
    end if;
    -- 잠금(위임됨 ∨ 에이전트가 주문을 쥠)이면 해제(null)도 거부 — 단계는 승인·반려로만 바뀐다(§3.5).
    -- ready 는 넣지 않는다: dev_workflow 리프마다 배정과 무관하게 상주한다. 조건은 agentWork.stageLockedForHuman 과 같다.
    if 'agent' = any(coalesce(v_tags, '{}'::text[]))
       or exists (select 1 from public.agent_work_orders
                   where wbs_item_id = v_item_id and status in ('claimed','reported')) then
      return jsonb_build_object('ok', false, 'reason', 'locked');
    end if;
    if p_stage is null then
      -- 해제는 워크플로·리프와 무관하게 허용(잘못 찍힌 값을 지울 길). 실적 불변.
      v_apply := true; v_new_stage := null; v_credit_key := null;
    else
      if v_dev_workflow is not true then return jsonb_build_object('ok', false, 'reason', 'not_workflow'); end if;
      if not v_is_leaf then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
      v_apply := true; v_new_stage := p_stage; v_credit_key := p_stage;
    end if;
  end if;

  if v_apply then
    if v_credit_key = 'xx' then
      v_new_pct := 100;
    elsif v_credit_key is not null then
      select stage_credits into v_credits from public.project_settings where project_id = v_project_id;
      v_credits := coalesce(v_credits, c_default);
      -- 표는 하나다(2026-09-16) — 항목 credit_key 로 고르지 않는다.
      v_table := coalesce(v_credits -> 'default', c_default -> 'default');
      v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
    end if;
    if v_new_stage is distinct from v_old_stage then
      v_stage_changed := true;
      v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'stage', v_old_stage, v_new_stage);
    end if;
    if v_new_pct is not null and v_new_pct is distinct from v_old_pct then
      v_actual_changed := true;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_item_id, 'actual_pct', v_old_pct::text, v_new_pct::text);
    end if;
    if v_stage_changed or v_actual_changed then
      update public.wbs_items
         set stage = case when v_stage_changed then v_new_stage else stage end,
             actual_pct = case when v_actual_changed then v_new_pct else actual_pct end,
             updated_at = v_now
       where id = v_item_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_status', case when v_is_order_event then v_next end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role;

commit;
