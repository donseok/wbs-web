-- 주간업무 시트 — 구글시트식 자유 작성 그리드(주차 문서 + 모듈 행) + PPT 소스.
-- 권한: 읽기/쓰기 모두 인증 사용자 전원(협업 시트 — 설계 승인 2026-07-10). created_by/app_role() 게이트 없음.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists / duplicate_object 무시).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021과 동일 경로).
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.

-- ── 주차 문서 ──
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  week_start date not null,           -- 그 주 월요일 (서버에서 정규화)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, week_start)
);

-- ── 모듈 행 (텍스트 셀 4개 내장 — 셀 저장 = 열 하나 UPDATE) ──
create table if not exists weekly_report_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references weekly_reports(id) on delete cascade,
  section text not null default '',   -- 구분: 공통/ERP/MES …
  module text not null default '',    -- 모듈: SD/LE, MD/PP …
  sort_order int not null default 1,
  this_content text not null default '',
  this_issue   text not null default '',
  next_content text not null default '',
  next_issue   text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists weekly_report_rows_report_idx on weekly_report_rows (report_id, sort_order);

-- ── RLS: 협업 시트 — 인증 사용자 전원 편집 ──
alter table weekly_reports     enable row level security;
alter table weekly_report_rows enable row level security;

drop policy if exists weekly_reports_select on weekly_reports;
create policy weekly_reports_select on weekly_reports for select to authenticated using (true);
drop policy if exists weekly_reports_insert on weekly_reports;
create policy weekly_reports_insert on weekly_reports for insert to authenticated with check (true);
drop policy if exists weekly_reports_update on weekly_reports;
create policy weekly_reports_update on weekly_reports for update to authenticated using (true) with check (true);
drop policy if exists weekly_reports_delete on weekly_reports;
create policy weekly_reports_delete on weekly_reports for delete to authenticated using (true);

drop policy if exists weekly_report_rows_select on weekly_report_rows;
create policy weekly_report_rows_select on weekly_report_rows for select to authenticated using (true);
drop policy if exists weekly_report_rows_insert on weekly_report_rows;
create policy weekly_report_rows_insert on weekly_report_rows for insert to authenticated with check (true);
drop policy if exists weekly_report_rows_update on weekly_report_rows;
create policy weekly_report_rows_update on weekly_report_rows for update to authenticated using (true) with check (true);
drop policy if exists weekly_report_rows_delete on weekly_report_rows;
create policy weekly_report_rows_delete on weekly_report_rows for delete to authenticated using (true);

-- ── Realtime: 행 변경 브로드캐스트 (중복 추가는 duplicate_object — 멱등 처리) ──
do $$
begin
  alter publication supabase_realtime add table weekly_report_rows;
exception when duplicate_object then null;
end $$;
