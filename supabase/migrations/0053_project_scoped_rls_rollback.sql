-- 0053 롤백. 교체한 쓰기 정책을 2026-07-30 프로덕션 pg_policies 원문으로 되돌린다.
-- (원문은 적용 직전 스냅샷에서 기계 생성 — 손으로 옮기다 생기는 미세 변형을 없앤다.)

begin;

-- ── wbs_items ──
drop policy if exists admin_write_items on wbs_items;
drop policy if exists member_update_actual on wbs_items;
create policy pmo_write_items on wbs_items
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));
create policy team_update_actual on wbs_items
  for update to authenticated
  using ((wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND (o.team_id = ( SELECT m.team_id
           FROM memberships m
          WHERE (m.user_id = auth.uid()))))))))
  with check ((wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND (o.team_id = ( SELECT m.team_id
           FROM memberships m
          WHERE (m.user_id = auth.uid()))))))));

-- ── item_owners ──
drop policy if exists admin_write_owners on item_owners;
create policy pmo_write_owners on item_owners
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── projects ──
drop policy if exists su_insert_projects on projects;
drop policy if exists su_delete_projects on projects;
drop policy if exists admin_update_projects on projects;
create policy pmo_write_projects on projects
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── holidays ──
drop policy if exists admin_write_holidays on holidays;
create policy pmo_write_holidays on holidays
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── project_members ──
drop policy if exists admin_write_members on project_members;
create policy pmo_write_members on project_members
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── announcements ──
drop policy if exists admin_write_announcements on announcements;
create policy pmo_write_announcements on announcements
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── task_dependencies ──
drop policy if exists admin_write_task_dependencies on task_dependencies;
create policy task_dependencies_pmo_write on task_dependencies
  for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.role = 'pmo_admin'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.role = 'pmo_admin'::text)))));

-- ── attendance_records ──
drop policy if exists member_write_attendance on attendance_records;
create policy pmo_write_attendance on attendance_records
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── wbs_progress_snapshots ──
drop policy if exists member_write_snapshots on wbs_progress_snapshots;
create policy member_write_progress_snapshots on wbs_progress_snapshots
  for all to authenticated
  using ((app_role() IS NOT NULL))
  with check ((app_role() IS NOT NULL));

-- ── meetings ──
drop policy if exists insert_own_meetings on meetings;
drop policy if exists update_own_meetings on meetings;
drop policy if exists delete_own_meetings on meetings;
create policy insert_own_meetings on meetings
  for insert to authenticated
  with check (((created_by = auth.uid()) AND (app_role() IS NOT NULL)));
create policy update_own_meetings on meetings
  for update to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))
  with check (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));
create policy delete_own_meetings on meetings
  for delete to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));

-- ── meeting_attendees ──
drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees
  for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))
  with check ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))));

-- ── meeting_exceptions ──
drop policy if exists own_write_meeting_exceptions on meeting_exceptions;
create policy own_write_meeting_exceptions on meeting_exceptions
  for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))
  with check ((EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))));

-- ── issues ──
drop policy if exists insert_own_issues on issues;
drop policy if exists member_update_issues on issues;
drop policy if exists delete_own_issues on issues;
create policy insert_own_issues on issues
  for insert to authenticated
  with check (((created_by = auth.uid()) AND (app_role() IS NOT NULL)));
create policy member_update_issues on issues
  for update to authenticated
  using ((app_role() IS NOT NULL))
  with check ((app_role() IS NOT NULL));
create policy delete_own_issues on issues
  for delete to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));

-- ── issue_assignees ──
drop policy if exists member_insert_issue_assignees on issue_assignees;
drop policy if exists member_delete_issue_assignees on issue_assignees;
create policy member_insert_issue_assignees on issue_assignees
  for insert to authenticated
  with check ((app_role() IS NOT NULL));
create policy member_delete_issue_assignees on issue_assignees
  for delete to authenticated
  using ((app_role() IS NOT NULL));

-- ── weekly_reports ──
drop policy if exists weekly_reports_insert on weekly_reports;
drop policy if exists weekly_reports_update on weekly_reports;
drop policy if exists weekly_reports_delete on weekly_reports;
create policy weekly_reports_insert on weekly_reports
  for insert to authenticated
  with check (true);
create policy weekly_reports_update on weekly_reports
  for update to authenticated
  using (true)
  with check (true);
create policy weekly_reports_delete on weekly_reports
  for delete to authenticated
  using (true);

-- ── weekly_report_rows ──
drop policy if exists weekly_report_rows_insert on weekly_report_rows;
drop policy if exists weekly_report_rows_update on weekly_report_rows;
drop policy if exists weekly_report_rows_delete on weekly_report_rows;
create policy weekly_report_rows_insert on weekly_report_rows
  for insert to authenticated
  with check (true);
create policy weekly_report_rows_update on weekly_report_rows
  for update to authenticated
  using (true)
  with check (true);
create policy weekly_report_rows_delete on weekly_report_rows
  for delete to authenticated
  using (true);

-- ── memberships ──
drop policy if exists su_write_memberships on memberships;
create policy pmo_write_memberships on memberships
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── teams ──
drop policy if exists su_insert_teams on teams;
drop policy if exists su_update_teams on teams;
create policy admin_insert_teams on teams
  for insert to authenticated
  with check ((app_role() = 'pmo_admin'::text));
create policy admin_update_teams on teams
  for update to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── llm_config ──
drop policy if exists su_all_llm_config on llm_config;
create policy admin_all_llm_config on llm_config
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── llm_profiles ──
drop policy if exists su_all_llm_profiles on llm_profiles;
create policy admin_all_llm_profiles on llm_profiles
  for all to authenticated
  using ((app_role() = 'pmo_admin'::text))
  with check ((app_role() = 'pmo_admin'::text));

-- ── usage_events — 0051 원본(전원 열람)으로 복원 ──
drop policy if exists read_usage_events on usage_events;
create policy read_usage_events on usage_events
  for select to authenticated using (true);

-- ── can_attach — 0036 정의로 복원 ──
create or replace function public.can_attach(item uuid) returns boolean
language sql stable as $$
  select app_role() = 'pmo_admin'
      or exists (
        select 1 from item_owners o
        where o.wbs_item_id = item and o.team_id = current_team()
      )
$$;

commit;
