-- supabase/migrations/0094_agent_heartbeat_rollback.sql
drop policy if exists agent_watchers_select on public.agent_watchers;
drop index if exists public.agent_watchers_last_seen_idx;
drop table if exists public.agent_watchers;
alter table public.agent_work_orders
  drop column if exists last_heartbeat_at,
  drop column if exists heartbeat_phase,
  drop column if exists heartbeat_agent,
  drop column if exists heartbeat_note;
