-- tests/migrations/sql/supabase-base.sql — 로컬 Postgres 에서 마이그레이션을 돌릴 때 쓰는 Supabase 최소 바탕.
-- 역할(anon·authenticated·service_role)과 auth.users, 시험용 사용자 둘만 만든다. 이미 있으면 건너뛴다.
do $$ begin
  create role anon; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- Supabase 는 public 스키마의 새 테이블에 기본 권한을 준다 — 마이그레이션이 그 권한을 거두는지 확인하려고 똑같이 흉내 낸다.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222')
  on conflict do nothing;
