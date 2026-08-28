-- 0091 rollback — milestone_date 컬럼 제거(경고: 체크해 둔 공지의 마일스톤 일자가 지워진다 — 실행 전 백업 확인)
alter table public.announcements
  drop column if exists milestone_date;
