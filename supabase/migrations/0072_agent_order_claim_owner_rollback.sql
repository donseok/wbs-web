begin;
drop index if exists public.agent_work_orders_claim_owner_idx;
alter table public.agent_work_orders drop column if exists claimed_by_user_id;
commit;
