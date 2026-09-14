-- supabase/migrations/0094_agent_heartbeat.sql
-- 좌석표 v1 (docs/superpowers/specs/2026-09-14-agent-office-v1-design.md §3-1)
-- heartbeat 는 보고 행을 만들지 않고 주문 행의 열만 touch 한다 — 행이 늘지 않아 디스크·풀 부담이 없다.
alter table public.agent_work_orders
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_phase   text,
  add column if not exists heartbeat_agent   text,
  add column if not exists heartbeat_note    text;

comment on column public.agent_work_orders.heartbeat_phase is
  'design|build|verify|refactor|blocked|rejected|reported — 마지막 heartbeat 가 말한 phase. blocked 는 담당자 결정 대기.';

-- 감시자(팀장 /dflow-team, 단독 /dflow-poll) 존재 신호. (user_id, agent) 당 1행, TTL 판정은 화면(70분).
create table if not exists public.agent_watchers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete cascade,   -- null = 배정분 전체
  agent         text not null,        -- '<신원>/<host>/lead' 또는 '<신원>/<host>/poll'
  host          text,
  slots         int,
  busy          int,
  until_label   text,                 -- 감시 종료 예정 'HH:MM' 문자열 그대로
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (user_id, agent)
);
create index if not exists agent_watchers_last_seen_idx on public.agent_watchers (last_seen_at);

alter table public.agent_watchers enable row level security;
-- 조회는 로그인 사용자 전체(0057 주문 조회 정책과 같은 수준). 쓰기 정책 없음 — service_role 전용, 서버 가드가 유일 관문.
drop policy if exists agent_watchers_select on public.agent_watchers;
create policy agent_watchers_select on public.agent_watchers
  for select to authenticated using (true);
