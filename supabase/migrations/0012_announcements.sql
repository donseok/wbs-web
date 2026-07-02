-- 공지사항 (프로젝트 스코프) + 읽음 워터마크
-- 쓰기: pmo_admin 전용 (RLS + 서버 액션 이중 강제) / 읽기: 인증 사용자 전체(게스트 포함)
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전 (if not exists / drop policy if exists)
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0011과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결 스크립트는 사용하지 않는다.

-- 쓰기 게이트 헬퍼 — 프로덕션에 이미 배포된 정의와 동일(pg_get_functiondef 로 확인).
-- 레포 0002/0004 파일의 current_role() 은 PG 예약어라 적용 불가한 드리프트 표기 —
-- 여기 버전화해 두어 신규 환경 부트스트랩 시에도 마이그레이션 체인이 재생 가능하게 한다.
create or replace function public.app_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'general'
    check (category in ('general', 'important', 'event')),
  is_pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_project_idx
  on announcements(project_id, created_at desc);

-- 읽음 워터마크: 사용자·프로젝트당 1행 ("마지막으로 공지 목록을 본 시각").
-- 공지별 read 행 대신 워터마크 1행 — 안읽음 수 = created_at > last_seen_at 인 공지 수.
create table if not exists announcement_seen (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table announcements enable row level security;
alter table announcement_seen enable row level security;

-- 읽기: 로그인 사용자 전체 (0004 관례)
drop policy if exists read_all_announcements on announcements;
create policy read_all_announcements on announcements
  for select to authenticated using (true);

-- 쓰기: PMO admin 전체.
-- 주의: 레포 0002/0004 파일에는 current_role() 로 적혀 있으나 current_role 은 PG 예약어라
-- 그대로는 적용 불가 — 프로덕션에 실제 배포된 헬퍼는 public.app_role() 이다 (2026-07-02 확인).
drop policy if exists pmo_write_announcements on announcements;
create policy pmo_write_announcements on announcements
  for all to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');

-- 워터마크: 본인 행만 읽고 쓴다 (게스트 포함 모든 인증 사용자)
drop policy if exists own_seen_announcements on announcement_seen;
create policy own_seen_announcements on announcement_seen
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
