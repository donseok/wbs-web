-- supabase/migrations/0099_agent_resume_request_rollback.sql
drop index if exists public.agent_work_orders_resume_idx;
alter table public.agent_work_orders
  drop column if exists resume_requested_at,
  drop column if exists resume_requested_by,
  drop column if exists resume_requested_host;
