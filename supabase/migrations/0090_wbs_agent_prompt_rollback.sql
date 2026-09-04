-- 0090 rollback — agent_prompt 컬럼 제거(사용자 입력 데이터가 지워진다 — 실행 전 백업 확인)
alter table public.wbs_items
  drop column if exists agent_prompt;
