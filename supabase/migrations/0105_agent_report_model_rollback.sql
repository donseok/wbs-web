-- supabase/migrations/0105_agent_report_model_rollback.sql
alter table public.agent_work_reports drop column if exists model;
