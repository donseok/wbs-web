-- supabase/migrations/0110_agent_watcher_summary_rollback.sql
begin;
alter table public.agent_watchers drop constraint if exists agent_watchers_input_request_shape;
alter table public.agent_watchers drop constraint if exists agent_watchers_lead_summary_shape;
alter table public.agent_watchers drop constraint if exists agent_watchers_summary_shape;
alter table public.agent_watchers drop column if exists input_request;
alter table public.agent_watchers drop column if exists lead_summary;
alter table public.agent_watchers drop column if exists summary;
commit;
