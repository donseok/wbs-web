-- supabase/migrations/0106_agent_heavy_work.sql
-- 무거운 작업 표시(docs/superpowers/specs/2026-09-26-heavy-work-office-bubble-design.md).
-- 팀원 heartbeat 훅은 PostToolUse 라 긴 게이트(전체 테스트 10분) 동안 신호가 없다. 팀장 lease 갱신 루프(60초)가
-- heavy.sh 슬롯을 읽어 renew 에 싣고, 라우트가 renew 성공 뒤 이 함수로 적는다. 이력은 남기지 않는다(0100 과 같은 이유).
-- 화면은 값의 by(팀장 신원)의 lease 가 살아 있을 때만 믿는다 — 팀장이 죽어 남은 값은 lease 만료로 저절로 무효다.
-- agent_work_orders 에는 updated_at 트리거가 없다: 이 쓰기는 좌석 생존 판정(lastSignalMs)을 바꾸지 않는다.
begin;

alter table public.agent_work_orders add column if not exists heartbeat_heavy jsonb;
comment on column public.agent_work_orders.heartbeat_heavy is
  '무거운 작업 표시 — {state run|wait, kind, pool, since(epoch), pos, n, cmd(가린 것), by(팀장 user_id)}. by 의 lease 가 죽었으면 무효.';

alter table public.agent_lead_leases add column if not exists heavy jsonb;
comment on column public.agent_lead_leases.heavy is
  '팀장 PC 의 무거운 작업 요약 — {k, held, waiting, load, cpus}. lease 가 살아 있을 때만 유효.';

-- 대상은 이 holder 가 지금 쥔(만료 전) lease 의 프로젝트뿐이다. 주문은 claimed 이고 이 신원이 점유했으며(팀원은 팀장과 같은
-- PAT 신원으로 claim 한다) id 앞 8자리가 하나로 맞을 때만 적는다 — 한 프로젝트에 두 신원의 팀장이 있어도 남의 좌석에 쓰지 않는다.
-- 이 팀장이 적었는데(by) 이번 목록에 없는 주문은 비운다. 값이 같으면 쓰지 않는다(매분 같은 값을 다시 쓰지 않게).
create or replace function public.lead_lease_heavy(p_user uuid, p_holder text, p_pc jsonb, p_orders jsonb)
returns integer
language plpgsql
-- renew 응답이 이 기록을 기다린다. 주문 행 잠금을 오래 기다리면 팀장 renew 가 시간 초과로 실패 1회가 된다 — 짧게 포기한다.
set lock_timeout = '2s'
as $$
declare
  v_proj uuid[];
  n integer;
begin
  select coalesce(array_agg(l.project_id), '{}') into v_proj
    from public.agent_lead_leases l
   where l.user_id = p_user and l.holder = p_holder and l.expires_at >= now();
  if cardinality(v_proj) = 0 then return 0; end if;

  update public.agent_lead_leases l set heavy = p_pc
   where l.user_id = p_user and l.project_id = any(v_proj) and l.heavy is distinct from p_pc;

  with want as (
    select e->>'id8' as id8, (e - 'id8') || jsonb_build_object('by', p_user) as v
      from jsonb_array_elements(case when jsonb_typeof(p_orders) = 'array' then p_orders else '[]'::jsonb end) as e
  ), hit as (
    select (array_agg(o.id))[1] as id, (array_agg(w.v))[1] as v
      from want w
      join public.agent_work_orders o
        on left(o.id::text, 8) = w.id8 and o.status = 'claimed' and o.project_id = any(v_proj)
       and o.claimed_by_user_id = p_user
     group by w.id8
    having count(*) = 1
  ), cleared as (
    update public.agent_work_orders o set heartbeat_heavy = null
     where o.project_id = any(v_proj) and o.heartbeat_heavy->>'by' = p_user::text
       and o.id not in (select h.id from hit h)
    returning o.id
  )
  update public.agent_work_orders o set heartbeat_heavy = h.v
    from hit h
   where o.id = h.id and o.heartbeat_heavy is distinct from h.v;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.lead_lease_heavy(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lead_lease_heavy(uuid, text, jsonb, jsonb) to service_role;

commit;
