-- 0057 롤백 — 신규 테이블만 제거한다. 기존 테이블은 0057 이 건드리지 않았으므로 복원 대상 없음.
drop table if exists agent_work_reports;
drop table if exists agent_work_orders;
drop table if exists agent_projects;
