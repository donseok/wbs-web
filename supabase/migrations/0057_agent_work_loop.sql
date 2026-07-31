-- 에이전트 작업 루프 (스펙: docs/superpowers/specs/2026-07-31-agent-work-loop-design.md)
-- 추가 전용 — 기존 테이블 ALTER 0건이 D-CUBE 리스크 0 보장의 1층이다(스펙 §1.1).
--
-- 멱등: 반복 실행 안전 (0050~0056 관례 따름). 이슈분석 마이그레이션 패턴 준수.

begin;

set search_path = public, extensions;

create table if not exists public.agent_projects (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default true,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- 항목 삭제 후에도 원장은 감사 기록으로 남긴다(스펙 §2.2) — cascade 가 아니라 set null.
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
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
create index if not exists agent_work_orders_project_status_idx on public.agent_work_orders (project_id, status);
create index if not exists agent_work_orders_item_idx on public.agent_work_orders (wbs_item_id);

create table if not exists public.agent_work_reports (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.agent_work_orders(id) on delete cascade,
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
create index if not exists agent_work_reports_order_idx on public.agent_work_reports (work_order_id);

-- RLS: 조회는 프로젝트 구성원(0053 헬퍼 재사용). 쓰기 정책은 만들지 않는다 —
-- 쓰기는 전부 service_role 경유이며 서버 가드가 유일한 관문이다(스펙 §2.4).
alter table public.agent_projects enable row level security;
alter table public.agent_work_orders enable row level security;
alter table public.agent_work_reports enable row level security;

drop policy if exists read_agent_projects on public.agent_projects;
create policy read_agent_projects on public.agent_projects for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists read_agent_work_orders on public.agent_work_orders;
create policy read_agent_work_orders on public.agent_work_orders for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists read_agent_work_reports on public.agent_work_reports;
create policy read_agent_work_reports on public.agent_work_reports for select to authenticated
  using (exists (
    select 1 from public.agent_work_orders o
    where o.id = public.agent_work_reports.work_order_id
      and public.is_project_member(o.project_id)
  ));

-- 브라우저 클라이언트에는 SELECT 만 열고, INSERT/UPDATE/DELETE 정책은 만들지 않는다.
-- 모든 쓰기는 service_role 서버 경로로 제한된다.
revoke all on table public.agent_projects from public, anon, authenticated;
grant select on table public.agent_projects to authenticated;
grant all on table public.agent_projects to service_role;

revoke all on table public.agent_work_orders from public, anon, authenticated;
grant select on table public.agent_work_orders to authenticated;
grant all on table public.agent_work_orders to service_role;

revoke all on table public.agent_work_reports from public, anon, authenticated;
grant select on table public.agent_work_reports to authenticated;
grant all on table public.agent_work_reports to service_role;

reset search_path;

commit;
