-- supabase/migrations/0106_agent_heavy_work_rollback.sql
begin;
drop function if exists public.lead_lease_heavy(uuid, text, jsonb, jsonb);
alter table public.agent_lead_leases drop column if exists heavy;
alter table public.agent_work_orders drop column if exists heartbeat_heavy;
commit;
