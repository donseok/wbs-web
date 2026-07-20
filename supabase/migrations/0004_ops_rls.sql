-- 운영 스위트 RLS (0002 의 app_role() 헬퍼 재사용)
alter table project_members enable row level security;
alter table attendance_records enable row level security;

-- 읽기: 로그인 사용자 전체
create policy read_all_members on project_members for select to authenticated using (true);
create policy read_all_attendance on attendance_records for select to authenticated using (true);

-- 쓰기: PMO admin 전체
create policy pmo_write_members on project_members for all to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');
create policy pmo_write_attendance on attendance_records for all to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');
