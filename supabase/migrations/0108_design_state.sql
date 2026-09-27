-- supabase/migrations/0108_design_state.sql
-- 설계 상태·구현자동(docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md — 12절 우선,
-- 계획서 docs/superpowers/plans/2026-09-27-design-state-dev-auto.md P1~P3·P12·P13).
-- ① wbs_items.design_mode(auto·review·human, NOT NULL DEFAULT 'auto') — D1·D17.
-- ② agent_work_orders: design_state·claim_scope·design_note·runner·runner_seen_at — 3절·D8·D25.
-- ③ 단계 어휘에 dd(설계 완료)를 ds 와 ip 사이에(CHECK) — D6.
-- ④ 크레딧 기본값에 dd 20. 표에 dd 가 없으면 RPC 가 greatest(ds, least(20, ip-5)) 로 채운다 — D18·P12.
-- ⑤ apply_workflow_event 재정의 — 0107 본문 기준. 새 인자 p_scope·p_cas·p_note·p_mode·p_runner(모두 기본값 null) 때문에
--    옛 7인자 함수를 drop 하고 다시 만든다(오버로드가 남으면 PostgREST 이름 인자 호출이 모호해진다, P2). 2.9·2.10 앱은
--    새 인자를 보내지 않으므로 기본값으로 종전처럼 돈다(claim_scope 는 legacy, runner 는 p_agent).
--    관문 규칙은 라우트(src/lib/domain/designGate.ts)가 집행한다. 여기는 원자 전이와 CAS, 사건별 전제 재확인만 한다(D7).
-- ⑥ 데이터 이전(8절·L4·L12·W25·D26): 설계만 멈춤 잔재 → review·design·dd, 설계 선행 잔재(wait_pred) → dd,
--    나머지 claimed 의 claim_scope·runner 채움, 이미 진행된 항목의 ready 주문 취소.
-- 배포 순서: 이 마이그레이션이 코드보다 먼저다(새 칸·새 RPC 인자에 기본값이 있어 옛 앱이 그대로 돈다).
-- 사전·사후 건수: 계획서 Task 5 Step 3·6.
-- 적용: npm run db:apply -- supabase/migrations/0108_design_state.sql --target staging  (운영은 지시 뒤)
begin;

-- ① 설계 방식
alter table public.wbs_items add column if not exists design_mode text not null default 'auto';
alter table public.wbs_items drop constraint if exists wbs_items_design_mode_check;
alter table public.wbs_items
  add constraint wbs_items_design_mode_check check (design_mode in ('auto','review','human'));
comment on column public.wbs_items.design_mode is
  '설계 방식 — auto(완전자동)·review(설계 검토: 에이전트 설계 → 사람 승인)·human(구현자동: 사람 설계 → 확정). 설계 상태 스펙 D1';

-- ② 주문의 설계 상태·범위·도는 PC
alter table public.agent_work_orders
  add column if not exists design_state text,
  add column if not exists claim_scope text,
  add column if not exists design_note text,
  add column if not exists runner text,
  add column if not exists runner_seen_at timestamptz;
alter table public.agent_work_orders drop constraint if exists agent_work_orders_design_state_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_design_state_check check (design_state is null or design_state in ('review','accepted'));
alter table public.agent_work_orders drop constraint if exists agent_work_orders_claim_scope_check;
alter table public.agent_work_orders
  add constraint agent_work_orders_claim_scope_check check (claim_scope is null or claim_scope in ('full','design','build','legacy'));
alter table public.agent_work_orders drop constraint if exists agent_work_orders_design_note_len;
alter table public.agent_work_orders
  add constraint agent_work_orders_design_note_len check (design_note is null or char_length(design_note) <= 500);
comment on column public.agent_work_orders.design_state is '설계 상태 — null(없음)·review(설계 검토 대기)·accepted(승인·확정). 단계 ip 이상에서는 취소 말고 바뀌지 않는다(D24)';
comment on column public.agent_work_orders.claim_scope is 'claim 범위 — null 은 legacy(2.9 앱·0108 이전 claim). 설계 승인(design_accept ①)이 build 로 바꾼다(D8)';
comment on column public.agent_work_orders.runner is '도는 PC 의 에이전트 라벨(D25). claim·build-start·heartbeat 가 적고 완료 보고·설계 검토 멈춤·해제·취소·되돌림이 비운다';

-- ③ 단계 dd
alter table public.wbs_items drop constraint if exists wbs_items_stage_check;
alter table public.wbs_items
  add constraint wbs_items_stage_check check (stage in ('as','ds','dd','ip','im','xx'));

-- ④ 크레딧 설명
comment on column public.project_settings.stage_credits is
  '단계 전이 실적 크레딧 {default:{as,ds,dd,ip,rw,im,xx}} — null 이면 코드 기본값. ds 가 없으면 10, dd 가 없으면 greatest(ds, least(20, ip-5)). 규칙: 정수·5단위·핵심 사슬 as<ip<rw<im<xx 간격>=10·as<=ds<=dd<=ip·xx=100';

-- ⑤ 전이 RPC — 시그니처가 바뀌므로 옛 함수를 먼저 지운다.
drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid);

create or replace function public.apply_workflow_event(
  p_event         text,
  p_actor         uuid,
  p_item_id       uuid default null,   -- assign|unassign|set_stage|set_design_mode 필수. 주문 사건은 주문의 wbs_item_id 를 쓴다(주면 일치해야 한다)
  p_order_id      uuid default null,   -- 주문 사건 필수
  p_stage         text default null,   -- set_stage 의 목표 단계 / claim(legacy): null(종전 ip) 또는 'ds'(설계 선행, 0107)
  p_agent         text default null,   -- claim: 기록 / report_completion·release·build_start·design_done: 점유자 일치 조건
  p_agent_user_id uuid default null,   -- 위와 같다(PAT 계정)
  p_scope         text default null,   -- claim: full·design·build·legacy(null=legacy) / build_start: full·build·rework·legacy(0108)
  p_cas           jsonb default null,  -- 라우트가 읽은 값: design_state·design_mode·claim_scope·runner·runner_seen_at 키가 있으면 같아야 한다(0108, P1)
  p_note          text default null,   -- design_reopen 의 사유(0108)
  p_mode          text default null,   -- set_design_mode 의 목표 방식(0108)
  p_runner        text default null    -- claim·build_start·design_done 이 적을 호출 라벨(0108, D25)
) returns jsonb
language plpgsql
security invoker
as $$
declare
  c_default constant jsonb := '{"default":{"as":0,"ds":10,"dd":20,"ip":30,"rw":50,"im":80,"xx":100}}'::jsonb;
  -- record 대신 스칼라를 쓴다: 항목이 지워진 주문처럼 SELECT INTO 를 건너뛴 경로에서 미할당 record 의
  -- 필드를 참조하면 CASE 의 안 타는 분기라도 "record is not assigned yet" 로 실패한다.
  v_is_order_event boolean;
  v_order_status text;
  v_order_claimed_by text;
  v_order_claimed_by_user uuid;
  v_order_item uuid;
  v_order_design_state text;
  v_order_claim_scope text;
  v_order_runner text;
  v_order_runner_seen timestamptz;
  v_item_id uuid;
  v_item_found boolean := false;
  v_project_id uuid;
  v_old_stage text;
  v_old_pct numeric;
  v_dev_workflow boolean;
  v_tags text[];
  v_design_mode text;
  v_is_leaf boolean := false;
  v_expect text;
  v_next text;
  v_scope text;
  v_new_design_state text;
  v_apply boolean := false;
  v_keep_max boolean := false;
  v_new_stage text;
  v_credit_key text;
  v_credits jsonb;
  v_table jsonb;
  v_new_pct numeric;
  v_ds numeric;
  v_ip numeric;
  v_skipped text;
  v_stage_changed boolean := false;
  v_actual_changed boolean := false;
  v_reached_first boolean := false;
  v_stub_pending boolean := false;
  v_now timestamptz := now();
begin
  if p_event is null or p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage','build_start',
                                        'design_done','design_accept','design_reopen','cancel','set_design_mode') then
    return jsonb_build_object('ok', false, 'reason', 'bad_event');
  end if;
  -- claim 이 받는 p_stage 는 종전(null → ip)과 설계 선행(ds) 둘뿐이다(0107). 주문을 잠그기 전에 거부한다.
  if p_event = 'claim' and p_stage is not null and p_stage <> 'ds' then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;
  -- 범위·방식 값 검사(0108) — 모르는 값을 legacy 로 삼키지 않는다.
  if p_event = 'claim' and p_scope is not null and p_scope not in ('full','design','build','legacy') then
    return jsonb_build_object('ok', false, 'reason', 'bad_scope');
  end if;
  if p_event = 'build_start' and p_scope is not null and p_scope not in ('full','build','rework','legacy') then
    return jsonb_build_object('ok', false, 'reason', 'bad_scope');
  end if;
  if p_event = 'set_design_mode' and (p_mode is null or p_mode not in ('auto','review','human')) then
    return jsonb_build_object('ok', false, 'reason', 'bad_mode');
  end if;
  v_scope := coalesce(p_scope, 'legacy');

  -- 설계 방식 변경(4.1, P3) — claim 과 같은 잠금 순서(주문 → 항목)로 교착을 피한다.
  -- 조건은 designGate.designModeChangeBlock 과 같다: 설계 상태가 있거나 claimed·reported·approved 주문이 있으면 거부.
  if p_event = 'set_design_mode' then
    if p_item_id is null then
      return jsonb_build_object('ok', false, 'reason', 'item_required');
    end if;
    perform 1 from public.agent_work_orders where wbs_item_id = p_item_id order by id for update;
    select design_mode into v_design_mode from public.wbs_items where id = p_item_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'item_not_found');
    end if;
    if exists (select 1 from public.agent_work_orders
                where wbs_item_id = p_item_id
                  and (status in ('claimed','reported','approved') or (status = 'ready' and design_state is not null))) then
      return jsonb_build_object('ok', false, 'reason', 'design_mode_locked');
    end if;
    if v_design_mode is distinct from p_mode then
      update public.wbs_items set design_mode = p_mode, updated_at = v_now where id = p_item_id;
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, p_item_id, 'design_mode', v_design_mode, p_mode);
    end if;
    return jsonb_build_object('ok', true, 'design_mode', p_mode, 'design_mode_changed', v_design_mode is distinct from p_mode);
  end if;

  v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start',
                                  'design_done','design_accept','design_reopen','cancel');

  -- 주문 사건: 주문을 잠그고 사건이 정한 기대 status·점유자 조건·CAS 로 본다
  if v_is_order_event then
    if p_order_id is null then
      return jsonb_build_object('ok', false, 'reason', 'order_required');
    end if;
    select status, claimed_by, claimed_by_user_id, wbs_item_id, design_state, claim_scope, runner, runner_seen_at
      into v_order_status, v_order_claimed_by, v_order_claimed_by_user, v_order_item,
           v_order_design_state, v_order_claim_scope, v_order_runner, v_order_runner_seen
      from public.agent_work_orders where id = p_order_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'order_not_found');
    end if;
    if p_item_id is not null and v_order_item is distinct from p_item_id then
      return jsonb_build_object('ok', false, 'reason', 'order_item_mismatch');
    end if;
    v_item_id := v_order_item;
    -- design_accept·design_reopen·cancel 은 ready·claimed 둘 다 받는다(아래 조건에서 가른다).
    v_expect := case p_event
      when 'claim' then 'ready'
      when 'report_completion' then 'claimed'
      when 'release' then 'claimed'
      when 'approve' then 'reported'
      when 'reject' then 'reported'
      when 'unapprove' then 'approved'
      when 'rework' then 'approved'
      when 'build_start' then 'claimed'
      when 'design_done' then 'claimed'
      else v_order_status end;
    v_next := case p_event
      when 'claim' then 'claimed'
      when 'report_completion' then 'reported'
      when 'release' then 'ready'
      when 'approve' then 'approved'
      when 'reject' then 'claimed'
      when 'unapprove' then 'reported'
      when 'rework' then 'claimed'
      when 'cancel' then 'cancelled'
      else v_order_status end;
    if v_order_status <> v_expect
       or (p_event in ('design_accept','design_reopen','cancel') and v_order_status not in ('ready','claimed'))
       or (p_event in ('report_completion','release','build_start','design_done') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)
       or (p_event in ('report_completion','release','build_start','design_done') and p_agent is not null and v_order_claimed_by is distinct from p_agent)
       or (p_cas is not null and p_cas ? 'design_state' and v_order_design_state is distinct from (p_cas ->> 'design_state'))
       or (p_cas is not null and p_cas ? 'claim_scope' and v_order_claim_scope is distinct from (p_cas ->> 'claim_scope'))
       or (p_cas is not null and p_cas ? 'runner' and v_order_runner is distinct from (p_cas ->> 'runner'))
       or (p_cas is not null and p_cas ? 'runner_seen_at' and v_order_runner_seen is distinct from (p_cas ->> 'runner_seen_at')::timestamptz)
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
    select project_id, stage, actual_pct, dev_workflow, tags, design_mode
      into v_project_id, v_old_stage, v_old_pct, v_dev_workflow, v_tags, v_design_mode
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

  -- CAS(P1) — 라우트가 읽은 설계 방식과 같아야 한다(방식 변경과 claim 의 경합, 5차 W28).
  if v_is_order_event and p_cas is not null and p_cas ? 'design_mode' and v_item_found
     and v_design_mode is distinct from (p_cas ->> 'design_mode') then
    return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
  end if;

  -- 사건별 전제(0108) — 라우트·서버 액션의 관문과 같은 조건을 잠근 행으로 다시 본다. 판정과 쓰기 사이에 바뀌었으면 거부한다.
  if p_event = 'design_done' and v_item_found and v_is_leaf and v_old_stage in ('ip','im','xx') then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  if p_event = 'design_accept' then
    if v_order_status = 'claimed' then
      if v_order_design_state is distinct from 'review' or v_old_stage is distinct from 'dd' then
        return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
      end if;
    elsif v_design_mode is distinct from 'human' or not ('agent' = any(coalesce(v_tags, '{}'::text[])))
          or v_order_design_state is not null or coalesce(v_old_stage, 'as') not in ('as','ds')
          or coalesce(v_old_pct, 0) >= 100
          or exists (select 1 from public.agent_work_orders where wbs_item_id = v_item_id and status = 'approved') then
      return jsonb_build_object('ok', false, 'conflict', true, 'order_status', v_order_status);
    end if;
  end if;
  if p_event = 'design_reopen' and v_order_design_state is distinct from 'review'
     and (v_order_design_state is distinct from 'accepted' or v_old_stage is distinct from 'dd') then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  -- 완료 보고: 설계 검토 대기면 거부(W23), 리프는 단계 ip 에서만(Y2). 부모·지워진 항목은 단계를 보지 않는다.
  if p_event = 'report_completion' and (v_order_design_state = 'review'
       or (v_item_found and v_is_leaf and v_old_stage is distinct from 'ip')) then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
  end if;
  -- 반납(D13): 설계 상태가 있거나, 설계만 하던 주문(claim_scope design)이 ds·dd 면 거부 — 웹의 「중단」을 쓴다.
  if p_event = 'release' and (v_order_design_state is not null
       or (v_order_claim_scope = 'design' and v_item_found and v_old_stage in ('ds','dd'))) then
    return jsonb_build_object('ok', false, 'reason', 'design_gate', 'order_status', v_order_status);
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
    v_new_design_state := v_order_design_state;
    if p_event = 'claim' then
      update public.agent_work_orders
         set status = 'claimed', claimed_by = p_agent, claimed_by_user_id = p_agent_user_id, claimed_at = v_now,
             claim_scope = v_scope, runner = coalesce(p_runner, p_agent), runner_seen_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'release' then
      update public.agent_work_orders
         set status = 'ready', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
             claim_scope = null, runner = null, runner_seen_at = null,
             updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'build_start' then
      -- 주문 status 는 claimed 그대로다(0107). 도는 PC 를 호출자로 적는다(D25 — 라우트가 runner·runner_seen_at CAS 를 싣는다).
      update public.agent_work_orders
         set runner = coalesce(p_runner, p_agent, runner), runner_seen_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'report_completion' then
      update public.agent_work_orders
         set status = 'reported', runner = null, runner_seen_at = null, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'cancel' then
      -- D14 공용 취소 — 위임 해제·「중단」·개발 워크플로 끄기·스텁 제거·import 의 표식 제거(L7)가 모두 이 사건이다.
      v_new_design_state := null;
      update public.agent_work_orders
         set status = 'cancelled', claimed_by = null, claimed_by_user_id = null, claimed_at = null,
             design_state = null, claim_scope = null, runner = null, runner_seen_at = null, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_done' then
      -- 설계 상태: 없음 → review(방식 review 이거나 claim_scope design). accepted 는 그대로. review 가 되면 runner 를 비운다(D25).
      if v_order_design_state is null and (v_design_mode = 'review' or v_order_claim_scope = 'design') then v_new_design_state := 'review'; end if;
      update public.agent_work_orders
         set design_state = v_new_design_state,
             runner = case when v_new_design_state = 'review' then null else runner end,
             runner_seen_at = case when v_new_design_state = 'review' then null else runner_seen_at end,
             heartbeat_phase = case when v_new_design_state = 'review' then 'wait_review' else 'wait_pred' end,
             heartbeat_agent = coalesce(p_runner, p_agent, heartbeat_agent), last_heartbeat_at = v_now, updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_accept' then
      -- ① 「설계 승인」(claimed·review·dd) 은 claim_scope 를 build 로(D8), ② 「설계 확정」(ready·human) 은 단계 dd 로(아래).
      v_new_design_state := 'accepted';
      update public.agent_work_orders
         set design_state = 'accepted', design_note = null,
             claim_scope = case when v_order_status = 'claimed' then 'build' else claim_scope end,
             updated_at = v_now
       where id = p_order_id;
    elsif p_event = 'design_reopen' then
      if v_order_design_state = 'review' then
        -- 검토 대기 중이면 사유만 고친다(4.1).
        update public.agent_work_orders set design_note = p_note, updated_at = v_now where id = p_order_id;
      elsif v_design_mode = 'human' then
        v_new_design_state := null;
        if v_order_status = 'claimed' then
          -- 사람 설계 대기로 — 주문을 ready 로 되돌리고 점유·heartbeat·재개 요청·범위·도는 PC 를 release 처럼 비운다.
          v_next := 'ready';
          update public.agent_work_orders
             set status = 'ready', design_state = null, design_note = p_note,
                 claimed_by = null, claimed_by_user_id = null, claimed_at = null,
                 last_heartbeat_at = null, heartbeat_phase = null, heartbeat_agent = null, heartbeat_note = null,
                 resume_requested_at = null, resume_requested_by = null, resume_requested_host = null,
                 claim_scope = null, runner = null, runner_seen_at = null, updated_at = v_now
           where id = p_order_id;
        else
          update public.agent_work_orders set design_state = null, design_note = p_note, updated_at = v_now where id = p_order_id;
        end if;
      else
        -- review·auto 는 설계 검토 대기로. 방식과 관계없이 runner 를 비운다(L9 — 재승인 뒤 다른 PC 가 30분 기다리지 않게).
        v_new_design_state := 'review';
        update public.agent_work_orders
           set design_state = 'review', design_note = p_note, runner = null, runner_seen_at = null, updated_at = v_now
         where id = p_order_id;
      end if;
    else
      -- approve·reject·unapprove·rework — 종전과 같다.
      update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;
    end if;
  end if;

  -- 단계·실적 결정(스펙 §3.4·§4.2, 0108 설계 상태 스펙 4.1)
  if v_is_order_event then
    -- 주문의 존재가 워크플로 증거 — dev_workflow 를 보지 않는다(구 force 의 일반화). 리프에만.
    if not v_item_found then v_skipped := 'no_item';
    elsif not v_is_leaf then v_skipped := 'parent';
    elsif p_event = 'build_start' then
      -- 설계 끝 → 구현 시작. ds·dd 일 때만 옮긴다. 이미 ip 이상이면 아무것도 바꾸지 않는다(멱등).
      if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip'; v_keep_max := true;
      elsif v_old_stage is null or v_old_stage not in ('ip','im','xx') then v_skipped := 'stage';
      end if;
    elsif p_event = 'claim' then
      v_apply := true; v_keep_max := true;
      if v_scope in ('full','design') then v_new_stage := 'ds'; v_credit_key := 'ds';
      elsif v_scope = 'build' then v_new_stage := 'dd'; v_credit_key := 'dd';
      else v_new_stage := case when p_stage = 'ds' then 'ds' else 'ip' end; v_credit_key := v_new_stage;
      end if;
    elsif p_event = 'design_done' then
      if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true;
      else v_skipped := 'stage';
      end if;
    elsif p_event = 'design_accept' then
      if v_order_status = 'ready' then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true; end if;
    elsif p_event = 'design_reopen' then
      if v_design_mode = 'human' and v_order_design_state = 'accepted' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;
    elsif p_event = 'cancel' then
      -- D14: claimed 취소면 as(종전과 같다), ready 취소면 dd 만 as 로.
      if v_order_status = 'claimed' or v_old_stage = 'dd' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;
    elsif p_event = 'release' then
      v_apply := true; v_new_stage := 'as'; v_credit_key := 'as';
    else
      v_apply := true;
      v_new_stage := case p_event
        when 'report_completion' then 'im' when 'approve' then 'xx' when 'unapprove' then 'im' when 'reject' then 'ip' when 'rework' then 'ip' end;
      v_credit_key := case p_event
        when 'report_completion' then 'im' when 'approve' then 'xx' when 'unapprove' then 'im' when 'reject' then 'rw' when 'rework' then 'rw' end;
      v_keep_max := p_event in ('report_completion','approve');
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
  else -- set_stage — 사람은 dd 를 고를 수 없다(dd 는 design_done·design_accept 로만 생긴다, 스펙 7절).
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
      if v_credit_key = 'dd' and not (v_table ? 'dd') then
        -- 0108 이전 표에는 dd 가 없다 — greatest(ds, least(20, ip-5)) 로 채운다(D18·P12, stageCredits.fillOptional 과 같은 식).
        v_ds := coalesce((v_table ->> 'ds')::numeric, (c_default -> 'default' ->> 'ds')::numeric);
        v_ip := coalesce((v_table ->> 'ip')::numeric, (c_default -> 'default' ->> 'ip')::numeric);
        v_new_pct := greatest(v_ds, least(20, v_ip - 5));
      else
        v_new_pct := coalesce((v_table ->> v_credit_key)::numeric, (c_default -> 'default' ->> v_credit_key)::numeric);
      end if;
    end if;
    -- 앞으로 가는 사건은 실적을 낮추지 않는다(D19·P13).
    if v_keep_max and v_new_pct is not null and v_old_pct is not null and v_old_pct > v_new_pct then v_new_pct := v_old_pct; end if;
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
    'prev_status', case when v_is_order_event then v_order_status end,
    'design_state', case when v_is_order_event then v_new_design_state end,
    'stage', case when v_stage_changed then v_new_stage else v_old_stage end,
    'actual_pct', case when v_actual_changed then v_new_pct else v_old_pct end,
    'stage_changed', v_stage_changed,
    'actual_changed', v_actual_changed,
    'reached_first', v_reached_first,
    'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text) to service_role;

-- ⑥-1 설계 멈춤 잔재(리프만): claimed ∧ ds ∧ heartbeat_phase wait_review(2.10 설계만, 스테이징) 또는 wait_pred(설계 선행, L4)
--     → 단계 dd·실적 max(현재, dd). wait_review 는 설계 상태 review·claim_scope design·runner 없음(8절, W25).
do $$
declare
  r record;
  v_dd numeric;
begin
  for r in
    select o.id as order_id, i.id as item_id, i.actual_pct as old_pct, i.project_id, o.heartbeat_phase as phase
      from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
     where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase in ('wait_review','wait_pred')
       and not exists (select 1 from public.wbs_items c where c.parent_id = i.id and c.stub_for is null)
  loop
    select coalesce((s.stage_credits -> 'default' ->> 'dd')::numeric,
                    greatest(coalesce((s.stage_credits -> 'default' ->> 'ds')::numeric, 10),
                             least(20, coalesce((s.stage_credits -> 'default' ->> 'ip')::numeric, 30) - 5)))
      into v_dd from public.project_settings s where s.project_id = r.project_id;
    v_dd := coalesce(v_dd, 20);
    update public.wbs_items set stage = 'dd', actual_pct = greatest(coalesce(actual_pct, 0), v_dd), updated_at = now() where id = r.item_id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value) values (null, r.item_id, 'stage', 'ds', 'dd');
    if coalesce(r.old_pct, 0) < v_dd then
      insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (null, r.item_id, 'actual_pct', r.old_pct::text, v_dd::text);
    end if;
    if r.phase = 'wait_review' then
      update public.agent_work_orders set design_state = 'review', claim_scope = 'design', runner = null, runner_seen_at = null where id = r.order_id;
    end if;
  end loop;
end $$;

-- ⑥-2 나머지 claimed 의 범위·도는 PC — runner 는 마지막 heartbeat 의 라벨 먼저(L12: 다른 PC 가 이어받은 주문), 없으면 점유 라벨.
update public.agent_work_orders
   set claim_scope = coalesce(claim_scope, 'legacy'),
       runner = coalesce(runner, heartbeat_agent, claimed_by),
       runner_seen_at = coalesce(runner_seen_at, last_heartbeat_at)
 where status = 'claimed' and design_state is null;

-- ⑥-3 이미 진행된 항목(단계 ip 이상·실적 100·approved 주문)의 ready 주문을 취소하고 이력을 남긴다(D26, 5차 W9).
do $$
declare
  r record;
begin
  for r in
    select o.id, o.wbs_item_id
      from public.agent_work_orders o join public.wbs_items i on i.id = o.wbs_item_id
     where o.status = 'ready'
       and (i.stage in ('ip','im','xx') or coalesce(i.actual_pct, 0) >= 100
            or exists (select 1 from public.agent_work_orders a where a.wbs_item_id = i.id and a.status = 'approved'))
  loop
    update public.agent_work_orders set status = 'cancelled', updated_at = now() where id = r.id;
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
      values (null, r.wbs_item_id, 'agent_order', 'ready', 'cancelled(0108 D26)');
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
