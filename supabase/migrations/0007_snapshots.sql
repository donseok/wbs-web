-- 주간(또는 임의 시점) 진척 스냅샷 — 전체 공정율 추세를 시간축으로 보기 위함.
-- 같은 날 재캡처는 upsert로 갱신(project_id, captured_on 유니크).
create table if not exists progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  captured_on date not null,
  overall_actual numeric not null,
  overall_planned numeric not null,
  created_at timestamptz not null default now(),
  unique (project_id, captured_on)
);
create index if not exists progress_snapshots_project_idx on progress_snapshots(project_id, captured_on);

alter table progress_snapshots enable row level security;
create policy read_all_snapshots on progress_snapshots for select to authenticated using (true);
create policy pmo_write_snapshots on progress_snapshots for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');
