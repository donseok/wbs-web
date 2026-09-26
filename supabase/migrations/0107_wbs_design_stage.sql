-- supabase/migrations/0107_wbs_design_stage.sql
-- 설계 단계(ds) 신설과 설계 선행 claim(docs/superpowers/specs/2026-09-26-dflow-parallel-token-design.md §6).
-- ① 단계 어휘에 ds(설계 중)를 as 와 ip 사이에 더한다(CHECK).
-- ② 크레딧 기본값에 ds 10. 프로젝트 설정 표에 ds 가 없으면 RPC 가 코드 기본값(c_default)으로 채운다 — 기존 표는 고치지 않는다.
-- ③ apply_workflow_event 재정의 — 0103 본문과 같고 바뀐 곳은 다섯이다:
--    c_default 에 ds, claim 의 p_stage='ds' 면 단계·크레딧 ds(아니면 종전 ip), 새 사건 build_start(claimed·점유자 일치,
--    ds → ip·크레딧 ip, ip 이상이면 무변경 ok, 주문 status 불변), set_stage 허용 값에 ds.
-- 선행 관문(선행 reached·design_first_too_early)은 SQL 이 아니라 라우트(claim·build-start)가 판정한다 — 종전 claim 과 같은 구조.
-- heartbeat_phase 에는 DB CHECK 가 없다(0094~0106 확인) — wait_pred 는 라우트 허용 목록만 넓힌다.
-- 배포 순서: 이 마이그레이션이 코드보다 먼저다. 역순이면 ds 를 쓰는 RPC 호출이 CHECK 에 걸린다.
-- 사전 확인: select stage, count(*) from public.wbs_items group by stage;
-- 적용: npm run db:apply -- supabase/migrations/0107_wbs_design_stage.sql --target staging  (운영은 지시 뒤)
begin;

alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','ds','ip','im','xx'));

comment on column public.project_settings.stage_credits is
  '단계 전이 실적 크레딧 {default:{as,ds,ip,rw,im,xx}} — null 이면 코드 기본값, ds 가 없으면 기본값(10). 규칙: 정수·5단위·as<ds<ip<rw<im<xx·간격>=10·xx=100';

-- 전이 RPC 재정의 — 0103 본문 기준.
create or replace function public.apply_workflow_event(
  p_event         text,
  p_actor         uuid,
  p_item_id       uuid default null,   -- assign|unassign|set_stage 필수. 주문 사건은 주문의 wbs_item_id 를 쓴다(주면 일치해야 한다)
  p_order_id      uuid default null,   -- 주문 사건 필수
  p_stage         text default null,   -- set_stage 의 목표 단계 / claim: null(종전 ip) 또는 'ds'(설계 선행, 0107)
  p_agent         text default null,   -- claim: 기록 / report_completion·release·build_start: 점유자 일치 조건
  p_agent_user_id uuid default null    -- 위와 같다(PAT 계정)
) returns jsonb
language plpgsql
security invoker
as $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ds":10,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
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
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage','build_start') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  -- claim 이 받는 단계는 종전(null → ip)과 설계 선행(ds) 둘뿐이다(0107). 주문을 잠그기 전에 거부한다.
  if p_event = 'claim' and p_stage is not null and p_stage <> 'ds' then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;
  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start');

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
      when 'rework' then 'approved'
      when 'build_start' then 'claimed' end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed'
      when 'build_start' then 'claimed' end;
    if v_order_status <> v_expect
       or (p_event in ('report_completion','release','build_start') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release','build_start') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
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
    elsif p_event <> 'build_start' then
      -- build_start 는 주문 status 를 바꾸지 않는다(claimed 그대로) — 단계만 ds → ip 로 옮긴다.
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif p_event = 'build_start' then
      -- 설계 끝 → 구현 시작(0107). ds 일 때만 옮긴다. 이미 ip 이상이면 아무것도 바꾸지 않는다(멱등 — 옛 claim 은 곧바로 ip).
      if v_old_stage = 'ds' then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip';
      elsif v_old_stage is null or v_old_stage not in ('ip','im','xx') then v_skipped := 'stage';
      end if;
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'claim' then case when p_stage = 'ds' then 'ds' else 'ip' end when 'report_completion' then 'im' when 'approve' then 'xx'
        when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' when 'release' then 'as' end;
      v_credit_key := case p_event
        when 'claim' then case when p_stage = 'ds' then 'ds' else 'ip' end when 'report_completion' then 'im' when 'approve' then 'xx'
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
    if p_stage is not null and p_stage not in ('as','ds','ip','im','xx') then
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
