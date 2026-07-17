-- WBS 작업 간 의존성(FS/SS) — 간트 연결선, 예상 일정 전파, 크리티컬 패스의 영속 데이터.
-- 계획 일정은 기준선으로 보존하며 앱이 이 관계를 바탕으로 예상 일정을 계산한다.

-- project_id까지 FK에 포함해 wbs_items.project_id가 나중에 바뀌어도 교차 프로젝트 엣지가 남지 않게 한다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wbs_items_id_project_unique') then
    alter table wbs_items add constraint wbs_items_id_project_unique unique (id, project_id);
  end if;
end $$;

create table if not exists task_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  predecessor_id uuid not null,
  successor_id uuid not null,
  dependency_type text not null default 'FS' check (dependency_type in ('FS', 'SS')),
  lag_days int not null default 0 check (lag_days between 0 and 365),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (predecessor_id <> successor_id),
  constraint task_dependencies_pair_unique unique (predecessor_id, successor_id),
  constraint task_dependencies_predecessor_fk foreign key (predecessor_id, project_id)
    references wbs_items(id, project_id) on delete cascade,
  constraint task_dependencies_successor_fk foreign key (successor_id, project_id)
    references wbs_items(id, project_id) on delete cascade
);

create index if not exists task_dependencies_project_idx on task_dependencies (project_id);
create index if not exists task_dependencies_predecessor_idx on task_dependencies (predecessor_id);
create index if not exists task_dependencies_successor_idx on task_dependencies (successor_id);

-- 교차 프로젝트 연결·날짜 없는 작업 연결·순환을 DB에서도 차단한다.
create or replace function public.validate_task_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred_project uuid;
  v_succ_project uuid;
  v_pred_start date;
  v_pred_end date;
  v_succ_start date;
  v_succ_end date;
  v_cycle boolean;
begin
  -- 같은 프로젝트에 대한 동시 반대방향 삽입도 직렬화해 순환 검사 경쟁을 막는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.project_id::text, 0));

  select project_id, planned_start, planned_end
    into v_pred_project, v_pred_start, v_pred_end
    from public.wbs_items where id = new.predecessor_id;
  select project_id, planned_start, planned_end
    into v_succ_project, v_succ_start, v_succ_end
    from public.wbs_items where id = new.successor_id;

  if v_pred_project is null or v_succ_project is null then
    raise exception '연결할 작업을 찾을 수 없습니다' using errcode = '23503';
  end if;
  if v_pred_project <> new.project_id or v_succ_project <> new.project_id then
    raise exception '같은 프로젝트의 작업끼리만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start is null or v_pred_end is null or v_succ_start is null or v_succ_end is null then
    raise exception '계획 시작일과 종료일이 있는 작업만 연결할 수 있습니다' using errcode = '23514';
  end if;
  if v_pred_start > v_pred_end or v_succ_start > v_succ_end then
    raise exception '시작일이 종료일보다 늦은 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(v_pred_start, v_pred_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) or not exists (
    select 1
      from pg_catalog.generate_series(v_succ_start, v_succ_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '계획 기간에 영업일이 없는 작업은 연결할 수 없습니다' using errcode = '23514';
  end if;

  with recursive reachable(id) as (
    select new.successor_id
    union
    select d.successor_id
      from public.task_dependencies d
      join reachable r on d.predecessor_id = r.id
     where d.id <> new.id
  )
  select exists(select 1 from reachable where id = new.predecessor_id) into v_cycle;
  if v_cycle then
    raise exception '순환 의존성은 등록할 수 없습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_task_dependency on task_dependencies;
create trigger trg_validate_task_dependency
  before insert or update on task_dependencies
  for each row execute function public.validate_task_dependency();

-- 의존성이 남은 작업의 일정이 직접 UPDATE로 비워지거나 역전되는 것도 차단한다.
create or replace function public.guard_dependent_wbs_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.task_dependencies d
     where d.predecessor_id = new.id or d.successor_id = new.id
  ) then
    return new;
  end if;
  if new.planned_start is null or new.planned_end is null or new.planned_start > new.planned_end then
    raise exception '의존성이 연결된 작업의 계획일은 비우거나 역전할 수 없습니다' using errcode = '23514';
  end if;
  if not exists (
    select 1
      from pg_catalog.generate_series(new.planned_start, new.planned_end, interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (
         select 1 from public.holidays h where h.project_id = new.project_id and h.date = d::date
       )
  ) then
    raise exception '의존성이 연결된 작업의 계획 기간에는 영업일이 있어야 합니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_dependent_wbs_dates on wbs_items;
create trigger trg_guard_dependent_wbs_dates
  before update of planned_start, planned_end on wbs_items
  for each row execute function public.guard_dependent_wbs_dates();

alter table task_dependencies enable row level security;

drop policy if exists task_dependencies_select on task_dependencies;
create policy task_dependencies_select on task_dependencies for select to authenticated using (true);

drop policy if exists task_dependencies_pmo_write on task_dependencies;
create policy task_dependencies_pmo_write on task_dependencies for all to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid() and m.role = 'pmo_admin'
    )
  )
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid() and m.role = 'pmo_admin'
    )
  );

comment on table task_dependencies is 'WBS 작업 의존성. predecessor → successor, FS/SS 및 영업일 lag.';
comment on column task_dependencies.dependency_type is 'FS=선행 종료 후 후속 시작, SS=선행 시작과 후속 시작 연동';
