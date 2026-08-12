-- 0076 rollback: 컬럼 3개·인덱스 2개·RPC 제거. 담당자·단계·external_ref 데이터는 소멸한다.
begin;
drop function if exists public.import_wbs_upsert(uuid, jsonb);
drop index if exists public.agent_work_orders_active_per_item_uidx;
drop index if exists public.wbs_items_project_external_ref_uidx;
alter table public.wbs_items drop constraint if exists wbs_items_assignee_member_fk;
alter table public.wbs_items
  drop column if exists spec,
  drop column if exists acceptance,
  drop column if exists entry_point,
  drop column if exists prd_ref,
  drop column if exists depends,
  drop column if exists tags,
  drop column if exists model,
  drop column if exists priority,
  drop column if exists domain,
  drop column if exists category,
  drop column if exists external_ref,
  drop column if exists stage,
  drop column if exists assignee_member_id;
commit;
