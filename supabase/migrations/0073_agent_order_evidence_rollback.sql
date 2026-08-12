begin;
alter table public.agent_work_reports drop column if exists evidence;
commit;
