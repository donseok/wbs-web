-- 0070 롤백 — 코드 revert(컬럼 참조 제거)가 먼저다.
alter table public.projects drop column if exists is_private;
