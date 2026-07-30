-- 쓰기 정책을 프로젝트 스코프로 교체 — 0052 shim 의 과대 허용을 좁힌다.
--
-- 설계 정본: docs/superpowers/specs/2026-07-29-authz-three-tier-design.md §3.5
-- 전제: 0052 적용 + 새 코드 배포가 끝난 뒤 적용한다. 코드보다 먼저 적용하면
--       옛 코드가 pmo_admin 으로 통과하던 경로가 막힌다(스펙 §7 배포 순서).
--
-- 재실행 안전(멱등): 새 정책 이름도 함께 drop 한다. 이게 없으면 중간에 끊긴 적용을
-- 다시 돌릴 때 첫 번째 이미-생성된 정책에서 42710 으로 멈춰, 나머지 테이블이
-- 옛 광역 정책 상태로 남는다(사전검증도 그 상태를 '재실행'으로 오판한다).
--
-- 손대지 않는 것: 읽기 정책 전부(D6 조회 개방), 개인 소유 행 정책
-- (announcement_seen·user_preferences·user_wbs_state·minute_favorites·change_logs·
--  minute_files·minute_folders·minute_highlights — user_id 기준이라 역할과 무관).

begin;

-- ── 0) 사전검증 — 교체할 옛 정책이 실제로 존재하는지 확인한다 ────────────────
-- `drop policy if exists` 는 이름이 어긋나도 조용히 통과한다. 그러면 옛 광역 정책
-- (app_role()='pmo_admin' 등)이 새 정책과 **함께** 남아, RLS 는 OR 결합이므로
-- 좁힌 정책이 아무 효과도 없게 된다 — 조인 줄 알았는데 열려 있는 상태다.
-- 0022 가 택한 사전검증 패턴을 따른다.
do $$
declare missing text;
begin
  select string_agg(x.t || '.' || x.p, ', ') into missing
    from (values
      ('wbs_items','pmo_write_items'), ('wbs_items','team_update_actual'),
      ('item_owners','pmo_write_owners'), ('projects','pmo_write_projects'),
      ('holidays','pmo_write_holidays'), ('project_members','pmo_write_members'),
      ('announcements','pmo_write_announcements'),
      ('task_dependencies','task_dependencies_pmo_write'),
      ('attendance_records','pmo_write_attendance'),
      ('wbs_progress_snapshots','member_write_progress_snapshots'),
      ('meetings','insert_own_meetings'), ('meetings','update_own_meetings'),
      ('meetings','delete_own_meetings'),
      ('meeting_attendees','own_write_meeting_attendees'),
      ('meeting_exceptions','own_write_meeting_exceptions'),
      ('issues','insert_own_issues'), ('issues','member_update_issues'),
      ('issues','delete_own_issues'),
      ('issue_assignees','member_insert_issue_assignees'),
      ('issue_assignees','member_delete_issue_assignees'),
      ('weekly_reports','weekly_reports_insert'), ('weekly_reports','weekly_reports_update'),
      ('weekly_reports','weekly_reports_delete'),
      ('weekly_report_rows','weekly_report_rows_insert'),
      ('weekly_report_rows','weekly_report_rows_update'),
      ('weekly_report_rows','weekly_report_rows_delete'),
      ('memberships','pmo_write_memberships'),
      ('teams','admin_insert_teams'), ('teams','admin_update_teams'),
      ('llm_config','admin_all_llm_config'), ('llm_profiles','admin_all_llm_profiles'),
      ('usage_events','read_usage_events')
    ) as x(t, p)
   where not exists (
     select 1 from pg_policies
      where schemaname = 'public' and tablename = x.t and policyname = x.p
   );
  -- 재실행(이미 교체 완료)에서는 전부 없는 것이 정상이므로, '하나도 없음'은 통과시킨다.
  -- 일부만 없는 상태 = 이름 드리프트이거나 중단된 적용이므로 중단한다.
  if missing is not null and missing <> '' then
    if exists (select 1 from pg_policies
                where schemaname = 'public' and tablename = 'wbs_items'
                  and policyname = 'admin_write_items') then
      raise notice '0053 재실행: 이미 교체된 정책은 건너뜁니다.';
    else
      raise exception '0053 중단: 교체 대상 정책이 없습니다 — %. 이름이 드리프트했는지 확인하세요(옛 정책이 남으면 새 정책과 OR 결합되어 조인 효과가 사라집니다).', missing;
    end if;
  end if;
end $$;

-- ── wbs_items ──
drop policy if exists pmo_write_items on wbs_items;
drop policy if exists admin_write_items on wbs_items;
create policy admin_write_items on wbs_items for all to authenticated
  using (public.is_project_admin(project_id))
  with check (public.is_project_admin(project_id));

-- 멤버의 실적·산출물 수정 — 말단 + 자기 팀 담당. 컬럼 범위는 0052 트리거가 제한한다.
drop policy if exists team_update_actual on wbs_items;
drop policy if exists member_update_actual on wbs_items;
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
drop policy if exists admin_write_owners on item_owners;
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
drop policy if exists admin_write_holidays on holidays;
create policy admin_write_holidays on holidays for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_members on project_members;
drop policy if exists admin_write_members on project_members;
create policy admin_write_members on project_members for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists pmo_write_announcements on announcements;
drop policy if exists admin_write_announcements on announcements;
create policy admin_write_announcements on announcements for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

drop policy if exists task_dependencies_pmo_write on task_dependencies;
drop policy if exists admin_write_task_dependencies on task_dependencies;
create policy admin_write_task_dependencies on task_dependencies for all to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));

-- ── attendance_records · wbs_progress_snapshots — 멤버 ──
drop policy if exists pmo_write_attendance on attendance_records;
drop policy if exists member_write_attendance on attendance_records;
create policy member_write_attendance on attendance_records for all to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists member_write_progress_snapshots on wbs_progress_snapshots;
drop policy if exists member_write_snapshots on wbs_progress_snapshots;
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
drop policy if exists su_write_memberships on memberships;
create policy su_write_memberships on memberships for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_insert_teams on teams;
drop policy if exists su_insert_teams on teams;
create policy su_insert_teams on teams for insert to authenticated
  with check (public.is_superuser());
drop policy if exists admin_update_teams on teams;
drop policy if exists su_update_teams on teams;
create policy su_update_teams on teams for update to authenticated
  using (public.is_superuser()) with check (public.is_superuser());

drop policy if exists admin_all_llm_config on llm_config;
drop policy if exists su_all_llm_config on llm_config;
create policy su_all_llm_config on llm_config for all to authenticated
  using (public.is_superuser()) with check (public.is_superuser());
drop policy if exists admin_all_llm_profiles on llm_profiles;
drop policy if exists su_all_llm_profiles on llm_profiles;
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


-- ── 위키 RPC — 전역 판정을 대상 프로젝트 판정으로 교체 ──────────────────────
-- 위키는 RLS 쓰기 정책이 0개이고(스펙 §1.5) 이 두 RPC 가 authenticated 에 grant 돼
-- 있으므로, 서버 액션을 거치지 않는 PostgREST 직접 호출이 가능하다. 옛 검사는
-- app_role() 전역 판정이라 0052 shim 이후 '아무 프로젝트든 역할/관리자'로 넓어졌다.
-- 아래 정의는 2026-07-30 프로덕션 pg_get_functiondef 원문에서 **권한 검사만** 교체한 것이다.

CREATE OR REPLACE FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(item_id uuid, lifecycle_state text, decision_state text, auto_update_locked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor   uuid := auth.uid();
  v_item    public.wiki_items%rowtype;
  v_before  jsonb;
  v_after   jsonb;
  v_reason  text := left(coalesce(btrim(p_reason), ''), 500);
begin
  if v_actor is null then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('resolve','reopen','archive','restore','lock','unlock','confirm') then
    raise exception 'WIKI_CURATE_UNKNOWN_ACTION' using errcode = '22023';
  end if;

  select * into v_item from public.wiki_items where id = p_item_id for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(app_role() is not null)는
  -- 0052 shim 이후 '아무 프로젝트든 역할 보유'로 넓어져, 이 RPC 가 authenticated 에
  -- grant 돼 있는 탓에 멤버 누구나 PostgREST 로 남의 프로젝트 위키를 정리할 수 있었다.
  -- 위키는 RLS 쓰기 정책이 0개라 이 검사가 유일한 방어선이다(스펙 D11).
  if not public.is_project_admin(v_item.project_id) then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_before := to_jsonb(v_item);

  if p_action = 'resolve' then
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = 'resolved', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'reopen' then
    if v_item.lifecycle_state not in ('resolved','archived') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    if v_item.lifecycle_state = 'archived' and not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action = 'archive' then
    if v_item.lifecycle_state = 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- 근거(wiki_item_sources)는 지우지 않는다. 숨긴 뒤에도 감사 추적이 남아야 한다.
    update public.wiki_items
      set lifecycle_state = 'archived', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'restore' then
    if v_item.lifecycle_state <> 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- archived는 사람의 '숨김'만이 아니라 시스템 철회(회의록 보관·프로젝트 이동으로 근거가
    -- 회수된 경우)로도 붙는다. 근거가 하나도 살아있지 않은 항목을 되살리면 원문으로 추적되지
    -- 않는 지식이 현재값이 된다 — Wiki의 근본 계약이 깨지므로 막는다.
    if not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action in ('lock','unlock') then
    update public.wiki_items
      set auto_update_locked = (p_action = 'lock'), updated_at = now()
      where id = p_item_id;

  elsif p_action = 'confirm' then
    -- 충돌·논의 중 항목을 사람이 현재 정본으로 확정한다. 이후 AI가 다시 덮지 못하도록
    -- 함께 고정한다(canAutoApplyWikiChange가 auto_update_locked에서 멈춘다).
    -- 이미 끝난 항목(대체·완료·숨김)에서는 확정할 수 없다. 그걸 허용하면 폐기된 문장이
    -- 현재값으로 되살아난 뒤 고정까지 돼 그 knowledge_key가 영구 동결된다.
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          certainty = 'explicit',
          decision_state = case
            when v_item.kind = 'decision' then 'confirmed' else v_item.decision_state
          end,
          auto_update_locked = true,
          updated_at = now()
      where id = p_item_id;
  end if;

  select to_jsonb(w) into v_after from public.wiki_items w where w.id = p_item_id;

  insert into public.wiki_change_events (
    project_id, wiki_item_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_item.project_id,
    p_item_id,
    'curate',
    v_before,
    v_after,
    case when v_reason = '' then p_action else p_action || ': ' || v_reason end,
    v_actor
  );

  update public.wiki_topics
    set last_changed_at = now(), updated_at = now()
    where id = v_item.topic_id;

  return query
    select w.id, w.lifecycle_state, w.decision_state, w.auto_update_locked
    from public.wiki_items w where w.id = p_item_id;
end $function$;

CREATE OR REPLACE FUNCTION public.merge_wiki_topics(p_source_topic_id uuid, p_target_topic_id uuid)
 RETURNS TABLE(moved_items integer, conflicted_items integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor  uuid := auth.uid();
  v_source public.wiki_topics%rowtype;
  v_target public.wiki_topics%rowtype;
  v_slug   text;
  v_moved  integer := 0;
  v_conflicted integer := 0;
begin
  if v_actor is null then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_source_topic_id = p_target_topic_id then
    raise exception 'WIKI_MERGE_SAME_TOPIC' using errcode = '22023';
  end if;

  -- 교착 방지: 항상 id 오름차순으로 잠근다.
  perform 1 from public.wiki_topics
    where id in (p_source_topic_id, p_target_topic_id)
    order by id
    for update;

  select * into v_source from public.wiki_topics where id = p_source_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_target from public.wiki_topics where id = p_target_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  -- 권한 판정은 **대상 주제의 프로젝트** 기준이다(0053). 옛 검사(app_role()='pmo_admin')는
  -- 0052 shim 이후 '어느 프로젝트든 관리자'가 되어 타 프로젝트 주제까지 병합할 수 있었다.
  if not public.is_project_admin(v_source.project_id) then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_source.project_id <> v_target.project_id then
    raise exception 'WIKI_MERGE_CROSS_PROJECT' using errcode = '22023';
  end if;

  v_slug := public.wiki_key_slug(v_target.normalized_title);

  -- 항목을 정본 주제로 옮기면서 knowledge_key의 주제 슬러그도 정본 것으로 다시 쓴다.
  -- 키를 그대로 두면 다음 회의의 같은 지식이 여전히 다른 키로 들어와 병합 효과가 사라진다.
  -- updated_at은 건드리지 않는다 — 아래 승자 판정이 "언제 병합했는가"가 아니라
  -- "어느 지식이 더 최근인가"를 보게 하려면 옮겼다는 사실이 시각을 바꾸면 안 된다.
  with moved as (
    update public.wiki_items w
      set topic_id = p_target_topic_id,
          knowledge_key = left(
            v_slug || ':' || split_part(w.knowledge_key, ':', 2) || ':'
              || nullif(regexp_replace(w.knowledge_key, '^[^:]*:[^:]*:', ''), ''),
            160
          )
      where w.topic_id = p_source_topic_id
      returning w.id
  )
  select count(*) into v_moved from moved;

  -- 같은 (kind, knowledge_key)에 현재값이 여럿 생기면 최신 지식만 남기고 나머지는 상충으로 보존.
  --
  -- 순서 기준은 지식의 실제 시점(valid_from → observed_at)이다. updated_at으로 정렬하면
  -- 방금 옮겨온 항목이 항상 이겨서, 낡은 파편 주제를 정본으로 합치는 순간 정본의 최신 결정이
  -- conflicted로 밀려나고 폐기된 문장이 현재값이 된다(감사 확정 결함).
  --
  -- 사람이 확정·고정한 항목(auto_update_locked)과 수동 항목은 절대 강등하지 않는다.
  -- 병합 정리가 사람의 판정을 뒤집으면 canAutoApplyWikiChange가 지키는 고정 계약이 무너진다.
  with ranked as (
    select w.id,
           row_number() over (
             partition by w.kind, w.knowledge_key
             order by
               (w.auto_update_locked or w.origin = 'manual') desc,
               coalesce(w.valid_from, w.observed_at, w.updated_at) desc,
               w.updated_at desc,
               w.id desc
           ) as rn
    from public.wiki_items w
    where w.topic_id = p_target_topic_id
      and w.lifecycle_state in ('active','open')
  ), demoted as (
    update public.wiki_items w
      set lifecycle_state = 'conflicted', updated_at = now()
      from ranked
      where w.id = ranked.id
        and ranked.rn > 1
        and not (w.auto_update_locked or w.origin = 'manual')
      returning w.id, w.project_id, to_jsonb(w) as after_row
  )
  -- 강등도 사람이 한 정리다. 항목별 이력을 남기지 않으면 사용자는 자기 결정이 왜 상충으로
  -- 바뀌었는지 타임라인에서 추적할 수 없다(파일 헤더의 감사 계약).
  , logged as (
    insert into public.wiki_change_events (
      project_id, wiki_item_id, change_type, after_snapshot, reason, actor_id
    )
    select demoted.project_id, demoted.id, 'curate', demoted.after_row,
           format('merge_topic_demote: %s → %s', v_source.title, v_target.title), v_actor
    from demoted
    returning 1
  )
  select count(*) into v_conflicted from logged;

  update public.wiki_topics
    set aliases = (
          select array_agg(distinct alias)
          from unnest(v_target.aliases || v_source.aliases || array[v_source.normalized_title]) as alias
        ),
        last_changed_at = now(),
        updated_at = now()
    where id = p_target_topic_id;

  insert into public.wiki_change_events (
    project_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_target.project_id,
    'curate',
    to_jsonb(v_source),
    to_jsonb(v_target),
    format('merge_topic: %s → %s (%s건)', v_source.title, v_target.title, v_moved),
    v_actor
  );

  delete from public.wiki_topics where id = p_source_topic_id;

  return query select v_moved, v_conflicted;
end $function$;

commit;
