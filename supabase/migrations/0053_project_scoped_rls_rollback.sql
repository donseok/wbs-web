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

-- ── 위키 RPC — 0048 시점(전역 판정) 원문으로 복원 ──
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
  if v_actor is null or public.app_role() is null then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('resolve','reopen','archive','restore','lock','unlock','confirm') then
    raise exception 'WIKI_CURATE_UNKNOWN_ACTION' using errcode = '22023';
  end if;

  select * into v_item from public.wiki_items where id = p_item_id for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
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
  if v_actor is null or public.app_role() <> 'pmo_admin' then
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
