-- 0054 롤백 — 박제 주석 제거(스키마 무변경).
comment on column memberships.role is null;
comment on column memberships.is_superuser is null;
comment on table project_roles is null;
