-- supabase/migrations/0104_agent_order_tokens.sql
-- 에이전트 주문별 사용 토큰(2026-09-24 사용자 요청). heartbeat 훅이 세션 대화 기록(.jsonl)과 서브에이전트 기록을
-- 셸(jq)로 합쳐 모델별 누적값을 싣는다 — LLM 토큰을 쓰지 않는다. 행은 (주문, 세션, 모델) 하나이고, 값은 그 세션의
-- 누적 합계라 매번 덮어쓴다(upsert). 세션을 키에 넣는 이유: 팀원 재시작·재작업은 새 세션이라 합산해야 하고,
-- 같은 세션의 다음 heartbeat 는 같은 행을 갱신해야 중복이 없다. 이력은 남기지 않는다(0094 와 같은 이유).
create table if not exists public.agent_work_order_tokens (
  work_order_id uuid not null references public.agent_work_orders(id) on delete cascade,
  session_id text not null check (session_id ~ '^[A-Za-z0-9-]{1,64}$'),
  model text not null check (char_length(model) between 1 and 64),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cache_creation_tokens bigint not null default 0 check (cache_creation_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (work_order_id, session_id, model)
);

comment on table public.agent_work_order_tokens is
  '주문·세션·모델별 누적 토큰. heartbeat 훅이 싣고 service_role 이 upsert 한다. 화면은 주문 단위로 합산한다.';

-- RLS: 조회는 주문의 프로젝트 구성원(0057 read_agent_work_reports 와 같은 판정). 쓰기 정책은 두지 않는다 —
-- 쓰기는 heartbeat 라우트(service_role)뿐이다.
alter table public.agent_work_order_tokens enable row level security;

drop policy if exists read_agent_work_order_tokens on public.agent_work_order_tokens;
create policy read_agent_work_order_tokens on public.agent_work_order_tokens for select to authenticated
  using (exists (
    select 1 from public.agent_work_orders o
    where o.id = public.agent_work_order_tokens.work_order_id
      and public.is_project_member(o.project_id)
  ));

revoke all on table public.agent_work_order_tokens from public, anon, authenticated;
grant select on table public.agent_work_order_tokens to authenticated;
