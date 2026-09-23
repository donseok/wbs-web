-- 0102 rollback — 생성 컬럼이 decisions 에 기대므로 먼저 지운다.
-- 코드 revert(또는 decisions 를 읽지 않는 코드)가 먼저 배포된 뒤 실행 — 아니면 허브·오피스·사이드바 조회가 실패한다.
begin;
alter table public.agent_work_reports drop column if exists decision_count;
alter table public.agent_work_reports drop constraint if exists agent_work_reports_decisions_shape;
alter table public.agent_work_reports drop column if exists decisions;
commit;
