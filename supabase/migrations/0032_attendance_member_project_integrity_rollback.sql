alter table public.attendance_records
  drop constraint if exists attendance_member_project_fk;
drop index if exists public.project_members_id_project_uidx;
