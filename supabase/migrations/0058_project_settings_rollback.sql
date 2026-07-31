-- 0058 롤백 — 신규 테이블만 제거. 기존 테이블 무접촉이었으므로 복원 대상 없음.
begin;
set search_path = public, extensions;
drop table if exists public.project_settings;
reset search_path;
commit;
