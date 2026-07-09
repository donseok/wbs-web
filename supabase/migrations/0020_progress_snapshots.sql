-- 프로젝트 진척 스냅샷 — 대시보드 S-Curve/SPI 추이의 실적 이력 원천.
-- 기록: WBS 변경 서버 액션 + 대시보드 조회 시 (project_id, KST 날짜) upsert. 크론 없음.
-- 권한: 읽기 = 인증 사용자 전체 / 쓰기 = 멤버십 보유자(app_role() is not null)
--       — updateActual 이 팀 멤버에게 허용되므로 스냅샷 쓰기도 동일 범위.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0013과 동일 경로).
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

create table if not exists wbs_progress_snapshots (
  project_id  uuid not null references projects(id) on delete cascade,
  snap_date   date not null,
  actual_pct  numeric(5,2) not null check (actual_pct between 0 and 100),
  planned_pct numeric(5,2) not null check (planned_pct between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (project_id, snap_date)
);

alter table wbs_progress_snapshots enable row level security;

drop policy if exists read_all_progress_snapshots on wbs_progress_snapshots;
create policy read_all_progress_snapshots on wbs_progress_snapshots
  for select to authenticated using (true);

drop policy if exists member_write_progress_snapshots on wbs_progress_snapshots;
create policy member_write_progress_snapshots on wbs_progress_snapshots
  for all to authenticated
  using (app_role() is not null)
  with check (app_role() is not null);
