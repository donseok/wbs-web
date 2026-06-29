-- 운영 스위트(멤버/근태) + 프로젝트 설명 컬럼
-- DK Flow 벤치마킹: 프로젝트별 멤버 로스터 + 근태현황

alter table projects add column if not exists description text;

-- 프로젝트별 멤버 로스터 (전역 memberships 와 별개의 표시용 인력 명단.
-- 외부 인력/협력사도 등록 가능하도록 auth.users 와 강결합하지 않는다.)
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  email text,
  team_id uuid references teams(id) on delete set null,
  role text not null default 'contributor' check (role in ('admin','contributor')),
  title text,                       -- 직함/역할
  created_at timestamptz not null default now()
);
create index if not exists project_members_project_idx on project_members(project_id);

-- 근태 기록
create table if not exists attendance_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  member_id uuid not null references project_members(id) on delete cascade,
  date date not null,
  type text not null check (type in ('work','remote','annual','half','sick','trip','official','absent')),
  note text,
  created_at timestamptz not null default now(),
  unique (member_id, date)
);
create index if not exists attendance_project_date_idx on attendance_records(project_id, date);
create index if not exists attendance_member_idx on attendance_records(member_id);
