-- 0102 rollback — 생성 컬럼이 decisions 에 기대므로 먼저 지운다.
begin;
alter table public.agent_work_reports drop column if exists decision_count;
alter table public.agent_work_reports drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports drop column if exists decisions;
commit;
