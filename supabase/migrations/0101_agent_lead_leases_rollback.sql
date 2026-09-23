-- supabase/migrations/0101_agent_lead_leases_rollback.sql
begin;
drop function if exists public.lead_lease_force_release(uuid, uuid);
drop function if exists public.lead_lease_release(uuid, text, jsonb);
drop function if exists public.lead_lease_renew(uuid, text, jsonb);
drop function if exists public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean);
drop function if exists public.lead_lease_ttl();
drop table if exists public.agent_lead_leases;
commit;
