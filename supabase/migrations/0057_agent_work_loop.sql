-- 에이전트 작업 루프 (스펙: docs/superpowers/specs/2026-07-31-agent-work-loop-design.md)
-- 추가 전용 — 기존 테이블 ALTER 0건이 D-CUBE 리스크 0 보장의 1층이다(스펙 §1.1).

create table agent_projects (
  project_id uuid primary key references projects(id) on delete cascade,
  enabled boolean not null default true,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agent_work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- 항목 삭제 후에도 원장은 감사 기록으로 남긴다(스펙 §2.2) — cascade 가 아니라 set null.
  wbs_item_id uuid references wbs_items(id) on delete set null,
  status text not null default 'ready'
    check (status in ('ready','claimed','reported','approved','cancelled')),
  instructions text not null default '',
  priority int not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_work_orders_project_status_idx on agent_work_orders (project_id, status);
create index agent_work_orders_item_idx on agent_work_orders (wbs_item_id);

create table agent_work_reports (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references agent_work_orders(id) on delete cascade,
  kind text not null check (kind in ('progress','completion')),
  percent int not null check (percent between 0 and 100),
  summary text not null,
  links jsonb not null default '[]'::jsonb,
  agent text not null,
  actor_user_id uuid references auth.users(id),
  applied_to_wbs boolean not null default false,
  review_action text check (review_action in ('approve','reject')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index agent_work_reports_order_idx on agent_work_reports (work_order_id);

-- RLS: 조회는 프로젝트 구성원(0053 헬퍼 재사용). 쓰기 정책은 만들지 않는다 —
-- 쓰기는 전부 service_role 경유이며 서버 가드가 유일한 관문이다(스펙 §2.4).
alter table agent_projects enable row level security;
alter table agent_work_orders enable row level security;
alter table agent_work_reports enable row level security;

create policy read_agent_projects on agent_projects for select to authenticated
  using (public.is_project_member(project_id));
create policy read_agent_work_orders on agent_work_orders for select to authenticated
  using (public.is_project_member(project_id));
create policy read_agent_work_reports on agent_work_reports for select to authenticated
  using (exists (
    select 1 from agent_work_orders o
    where o.id = agent_work_reports.work_order_id
      and public.is_project_member(o.project_id)
  ));
