-- supabase/migrations/0100_agent_heartbeat_model_rollback.sql
alter table public.agent_work_orders
  drop column if exists heartbeat_model;
