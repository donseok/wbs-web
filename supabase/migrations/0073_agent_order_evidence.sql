-- 0073: agent_work_reports.evidence — 완료 보고의 git 증적(branch·SHA·PR·checks).
-- 형식 검증만 하며 서버는 실재를 독립 확인하지 않는다(§6 — UI 에 '에이전트 제출 주장' 표기).
begin;
alter table public.agent_work_reports
  add column if not exists evidence jsonb not null default '{}'::jsonb;
commit;
