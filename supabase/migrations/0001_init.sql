create extension if not exists "pgcrypto";

create table teams (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code in ('PMO','DT','ERP','MES')),
  name text not null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  role text not null check (role in ('pmo_admin','team_editor')),
  primary key (user_id)
);

create table wbs_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references wbs_items(id) on delete cascade,
  level text not null check (level in ('phase','task','activity')),
  code text not null,
  sort_order int not null default 0,
  name text not null,
  biz text,
  deliverable text,
  planned_start date,
  planned_end date,
  weight numeric,                 -- null이면 형제 균등
  actual_pct numeric check (actual_pct between 0 and 100),  -- leaf만 사용
  updated_at timestamptz not null default now()
);
create index on wbs_items (project_id);
create index on wbs_items (parent_id);

create table item_owners (
  wbs_item_id uuid not null references wbs_items(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  kind text not null check (kind in ('primary','support')),
  primary key (wbs_item_id, team_id)
);

create table holidays (
  project_id uuid not null references projects(id) on delete cascade,
  date date not null,
  name text,
  primary key (project_id, date)
);

create table change_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id),
  wbs_item_id uuid references wbs_items(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  at timestamptz not null default now()
);
create index on change_logs (wbs_item_id);
