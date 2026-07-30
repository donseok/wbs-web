-- 쓰기 정책을 프로젝트 스코프로 교체 — 0052 shim 의 과대 허용을 좁힌다.
--
-- 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md §3.5
-- 전제: 0052 적용 + 새 코드 배포가 끝난 뒤 적용한다. 코드보다 먼저 적용하면
--       옛 코드가 pmo_admin 으로 통과하던 경로가 막힌다(스펙 §7 배포 순서).
--
-- 손대지 않는 것: 읽기 정책 전부(D6 조회 개방), 개인 소유 행 정책
-- (announcement_seen·user_preferences·user_wbs_state·minute_favorites·change_logs·
--  minute_files·minute_folders·minute_highlights — user_id 기준이라 역할과 무관).

begin;

-- ── wbs_items ──
drop policy if exists pmo_write_items on wbs_items;
create policy admin_write_items on wbs_items for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

-- 멤버의 실적·산출물 수정 — 말단 + 자기 팀 담당. 컬럼 범위는 0052 트리거가 제한한다.
drop policy if exists team_update_actual on wbs_items;
create policy member_update_actual on wbs_items for update to authenticated
  using (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid()))
  )
  with check (
    public.is_project_member(project_id)
    and public.wbs_is_leaf(id)
    and exists (select 1 from item_owners o
                 where o.wbs_item_id = wbs_items.id
                   and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid()))
  );

-- ── item_owners — 부모 wbs_items 의 project_id 를 미러 ──
drop policy if exists pmo_write_owners on item_owners;
create policy admin_write_owners on item_owners for all to authenticated
  using (exists (select 1 from wbs_items w where w.id = wbs_item_id and public.is_project_admin(w.project_id)))
  with check (exists (select 1 from wbs_items w where w.id = wbs_item_id and public.is_project_admin(w.project_id)));

-- ── projects — 생성·삭제는 슈퍼유저, 수정은 프로젝트 관리자 ──
drop policy if exists pmo_write_projects on projects;
drop policy if exists su_insert_projects on projects;
create policy su_insert_projects on projects for insert to authenticated
  with check (public.is_superuser());
drop policy if exists su_delete_projects on projects;
create policy su_delete_projects on projects for delete to authenticated
  using (public.is_superuser());
drop policy if exists admin_update_projects on projects;
create policy admin_update_projects on projects for update to authenticated
  using (public.is_project_admin(id)) with check (public.is_project_admin(id));

-- ── holidays · project_members · announcements · task_dependencies — 관리자 ──
drop policy if exists pmo_write_holidays on holidays;
create policy admin_write_holidays on holidays for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_members on project_members;
create policy admin_write_members on project_members for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_announcements on announcements;
create policy admin_write_announcements on announcements for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists task_dependencies_pmo_write on task_dependencies;
create policy admin_write_task_dependencies on task_dependencies for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

-- ── attendance_records · wbs_progress_snapshots — 멤버 ──
drop policy if exists pmo_write_attendance on attendance_records;
create policy member_write_attendance on attendance_records for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists member_write_progress_snapshots on wbs_progress_snapshots;
create policy member_write_snapshots on wbs_progress_snapshots for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

-- ── meetings — 생성은 멤버 본인, 수정·삭제는 본인 또는 관리자 ──
drop policy if exists insert_own_meetings on meetings;
create policy insert_own_meetings on meetings for insert to authenticated
  with check (created_by = auth.uid() and public.is_project_member(project_id));
drop policy if exists update_own_meetings on meetings;
create policy update_own_meetings on meetings for update to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id))
  with check (created_by = auth.uid() or public.is_project_admin(project_id));
drop policy if exists delete_own_meetings on meetings;
create policy delete_own_meetings on meetings for delete to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id));

-- meeting_attendees · meeting_exceptions 는 부모 meetings 를 미러(판정식만 교체)
drop policy if exists own_write_meeting_attendees on meeting_attendees;
create policy own_write_meeting_attendees on meeting_attendees for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))));

drop policy if exists own_write_meeting_exceptions on meeting_exceptions;
create policy own_write_meeting_exceptions on meeting_exceptions for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))))
  with check (exists (select 1 from meetings m where m.id = meeting_id
                 and (m.created_by = auth.uid() or public.is_project_admin(m.project_id))));

-- ── issues — meetings 와 같은 패턴 ──
drop policy if exists insert_own_issues on issues;
create policy insert_own_issues on issues for insert to authenticated
  with check (created_by = auth.uid() and public.is_project_member(project_id));
drop policy if exists member_update_issues on issues;
create policy member_update_issues on issues for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));
drop policy if exists delete_own_issues on issues;
create policy delete_own_issues on issues for delete to authenticated
  using (created_by = auth.uid() or public.is_project_admin(project_id));

drop policy if exists member_insert_issue_assignees on issue_assignees;
create policy member_insert_issue_assignees on issue_assignees for insert to authenticated
  with check (public.is_project_member(project_id));
drop policy if exists member_delete_issue_assignees on issue_assignees;
create policy member_delete_issue_assignees on issue_assignees for delete to authenticated
  using (public.is_project_member(project_id));

-- ── weekly_reports / weekly_report_rows — 0023 의 using(true) 를 닫는다 ──
-- weekly_report_rows 에는 project_id 컬럼이 없다(실측). 부모를 미러한다.
drop policy if exists weekly_reports_insert on weekly_reports;
create policy weekly_reports_insert on weekly_reports for insert to authenticated
  with check (public.is_project_admin(project_id));
drop policy if exists weekly_reports_delete on weekly_reports;
create policy weekly_reports_delete on weekly_reports for delete to authenticated
  using (public.is_project_admin(project_id));
drop policy if exists weekly_reports_update on weekly_reports;
create policy weekly_reports_update on weekly_reports for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists weekly_report_rows_insert on weekly_report_rows;
create policy weekly_report_rows_insert on weekly_report_rows for insert to authenticated
  with check (exists (select 1 from weekly_reports r where r.id = report_id
                       and public.is_project_member(r.project_id)));
drop policy if exists weekly_report_rows_update on weekly_report_rows;
create policy weekly_report_rows_update on weekly_report_rows for update to authenticated
  using (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_member(r.project_id)))
  with check (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_member(r.project_id)));
drop policy if exists weekly_report_rows_delete on weekly_report_rows;
create policy weekly_report_rows_delete on weekly_report_rows for delete to authenticated
  using (exists (select 1 from weekly_reports r where r.id = report_id
                  and public.is_project_admin(r.project_id)));

-- ── 전역 관리 테이블 — 슈퍼유저 ──
drop policy if exists pmo_write_memberships on memberships;
create policy su_write_memberships on memberships for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_insert_teams on teams;
create policy su_insert_teams on teams for insert to authenticated
  with check (public.is_superuser());
drop policy if exists admin_update_teams on teams;
create policy su_update_teams on teams for update to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_all_llm_config on llm_config;
create policy su_all_llm_config on llm_config for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());
drop policy if exists admin_all_llm_profiles on llm_profiles;
create policy su_all_llm_profiles on llm_profiles for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

-- ── usage_events — 사용 현황 열람을 슈퍼유저로 조인다(2026-07-30 사용자 결정) ──
-- 코드 쪽 대응물은 canViewUsage()(이미 배포됨). 계정 목록(이메일·마지막 로그인)은
-- service_role 경로라 이 정책과 무관 — 그래서 코드 게이트가 먼저 배포돼 있어야 한다.
drop policy if exists read_usage_events on usage_events;
create policy read_usage_events on usage_events
  for select to authenticated using (public.is_superuser());

-- ── can_attach — 조회 전용이 팀만 맞으면 통과하던 구멍을 닫는다 ──
-- deliverable_attachments 의 attach_insert/attach_delete 와 storage.objects 의
-- deliverables 정책이 이 함수를 공유하므로 함수 하나만 고치면 된다.
create or replace function public.can_attach(item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wbs_items w
     where w.id = item
       and (
         public.is_project_admin(w.project_id)
         or (
           public.is_project_member(w.project_id)
           and exists (select 1 from public.item_owners o
                        where o.wbs_item_id = item
                          and o.team_id = (select m.team_id from public.memberships m
                                            where m.user_id = auth.uid()))
         )
       )
  )
$$;

commit;
