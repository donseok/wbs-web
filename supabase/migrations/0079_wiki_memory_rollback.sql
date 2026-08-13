-- 0079 Wiki Memory rollback.
--
-- 경고(데이터 소실): 이 롤백은 사람이 작성한 wiki_topics.body_md, 모든 문서 revision,
-- 질문/답변, helpful/outdated 피드백, 검증 시각과 Wiki 행동 metadata를 영구 삭제한다.
-- 실행 전에 최소한 아래 데이터를 별도 저장소로 덤프하고 복구 가능성을 확인해야 한다.
--   public.wiki_topics(id, project_id, title, body_md, body_updated_at, body_updated_by,
--                      document_kind, verified_at, verified_by, review_due_at)
--   public.wiki_topic_revisions, public.wiki_questions, public.wiki_feedback
-- 기존 wiki_items 문장/근거/변경 이력은 삭제하지 않는다. 0079에서 추가한 것만 되돌린다.

begin;

set search_path = public, extensions;

-- 의존 RPC부터 제거한다.
drop function if exists public.submit_wiki_feedback(uuid, text, text);
drop function if exists public.review_wiki_item(uuid, text);
drop function if exists public.answer_wiki_question(uuid, text, uuid);
drop function if exists public.create_wiki_question(uuid, uuid, text);
drop function if exists public.restore_wiki_document_revision(uuid, uuid, timestamptz);
drop function if exists public.move_wiki_document(uuid, uuid, integer, integer);
drop function if exists public.verify_wiki_document(uuid, integer, timestamptz);
drop function if exists public.save_wiki_document(uuid, text, text, text, timestamptz);
drop function if exists public.create_wiki_document(uuid, text, text, text, uuid);
drop function if exists public.wiki_normalize_document_title(text);

-- 0079가 교체한 병합 RPC는 아래에서 새 컬럼을 모두 내린 뒤 0053 원식으로 복원한다.

-- event_name 컬럼을 내리기 전에 0051 원식(모든 행이 page view였던 계약)으로 복원한다.
create or replace function public.usage_summary(p_from date, p_to date, p_today date)
returns table (total_events bigint, active_users bigint, today_users bigint, last_event_at timestamptz)
language sql stable
as $$
  select
    (select count(*) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events);
$$;

create or replace function public.usage_daily_actives(p_from date, p_to date)
returns table (d date, active_users integer, events integer)
language sql stable
as $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1 order by 1;
$$;

create or replace function public.usage_menu_ranking(p_from date, p_to date)
returns table (menu_key text, events integer, active_users integer)
language sql stable
as $$
  select menu_key, count(*)::int, count(distinct user_id)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key order by 2 desc, 1;
$$;

create or replace function public.usage_user_rollup(p_from date, p_to date)
returns table (user_id uuid, events integer, active_days integer, last_at timestamptz)
language sql stable
as $$
  select user_id, count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;

create or replace function public.usage_sessions(
  p_from date, p_to date, p_gap_minutes integer default 30
) returns integer
language sql stable
as $$
  with ordered as (
    select user_id, occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  )
  select count(*)::int from ordered
  where prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes);
$$;

-- 새 테이블은 내용 전체가 소실된다. 기존 wiki_* 파생 테이블은 건드리지 않는다.
drop policy if exists wiki_feedback_member_insert on public.wiki_feedback;
drop policy if exists wiki_feedback_read on public.wiki_feedback;
drop table if exists public.wiki_feedback;

drop policy if exists wiki_questions_member_insert on public.wiki_questions;
drop policy if exists wiki_questions_read on public.wiki_questions;
drop table if exists public.wiki_questions;

drop trigger if exists wiki_topic_revisions_immutable_trg
  on public.wiki_topic_revisions;
drop policy if exists wiki_topic_revisions_read on public.wiki_topic_revisions;
drop table if exists public.wiki_topic_revisions;
drop function if exists public.wiki_topic_revisions_reject_mutation();

-- usage_events에는 0079가 추가한 행동 차원만 제거한다. 기존 page-view 행은 남는다.
-- 경고(데이터 소실): event_name을 내린 뒤 제품 이벤트가 page view로 둔갑해 KPI를 오염시키지
-- 않도록 0079가 수집한 non-page-view 행을 의도적으로 삭제한다. 필요하면 먼저 덤프한다.
delete from public.usage_events where event_name <> 'page_view';
drop index if exists public.usage_events_event_name_idx;
alter table public.usage_events
  drop constraint if exists usage_events_metadata_object_check;
alter table public.usage_events
  drop constraint if exists usage_events_event_name_check;
alter table public.usage_events drop column if exists metadata;
alter table public.usage_events drop column if exists event_name;

-- 모든 기존 항목은 review_state가 사라지면 0079 이전처럼 다시 조회된다.
drop index if exists public.wiki_items_topic_pending_idx;
drop index if exists public.wiki_items_project_review_idx;
alter table public.wiki_items
  drop constraint if exists wiki_items_review_state_check;
alter table public.wiki_items drop column if exists review_state;

drop index if exists public.wiki_topics_project_review_due_idx;
drop index if exists public.wiki_topics_project_pinned_idx;
drop index if exists public.wiki_topics_project_parent_idx;

alter table public.wiki_topics
  drop constraint if exists wiki_topics_review_due_check;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_pinned_order_check;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_not_own_parent_check;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_document_kind_check;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_origin_check;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_verified_by_fk;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_parent_project_fk;
alter table public.wiki_topics
  drop constraint if exists wiki_topics_body_updated_by_fk;

alter table public.wiki_topics drop column if exists review_due_at;
alter table public.wiki_topics drop column if exists verified_by;
alter table public.wiki_topics drop column if exists verified_at;
alter table public.wiki_topics drop column if exists document_kind;
alter table public.wiki_topics drop column if exists origin;
alter table public.wiki_topics drop column if exists pinned_order;
alter table public.wiki_topics drop column if exists sort;
alter table public.wiki_topics drop column if exists parent_id;
alter table public.wiki_topics drop column if exists body_updated_by;
alter table public.wiki_topics drop column if exists body_updated_at;
alter table public.wiki_topics drop column if exists body_md;

-- 0079가 교체했던 병합 RPC를 0053 상태로 복원한다. 새 테이블/컬럼을 모두 내린 뒤
-- 정의해야 rollback 뒤 첫 호출도 wiki_topic_revisions/origin 참조로 실패하지 않는다.
create or replace function public.merge_wiki_topics(
  p_source_topic_id uuid,
  p_target_topic_id uuid
) returns table (moved_items integer, conflicted_items integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.wiki_topics%rowtype;
  v_target public.wiki_topics%rowtype;
  v_slug text;
  v_moved integer := 0;
  v_conflicted integer := 0;
begin
  if v_actor is null then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_source_topic_id = p_target_topic_id then
    raise exception 'WIKI_MERGE_SAME_TOPIC' using errcode = '22023';
  end if;

  perform 1 from public.wiki_topics
  where id in (p_source_topic_id, p_target_topic_id)
  order by id
  for update;

  select * into v_source from public.wiki_topics where id = p_source_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_target from public.wiki_topics where id = p_target_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_project_admin(v_source.project_id) then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_source.project_id <> v_target.project_id then
    raise exception 'WIKI_MERGE_CROSS_PROJECT' using errcode = '22023';
  end if;

  v_slug := public.wiki_key_slug(v_target.normalized_title);

  with moved as (
    update public.wiki_items item
    set topic_id = p_target_topic_id,
        knowledge_key = left(
          v_slug || ':' || split_part(item.knowledge_key, ':', 2) || ':'
            || nullif(regexp_replace(item.knowledge_key, '^[^:]*:[^:]*:', ''), ''),
          160
        )
    where item.topic_id = p_source_topic_id
    returning item.id
  )
  select count(*) into v_moved from moved;

  with ranked as (
    select item.id,
           row_number() over (
             partition by item.kind, item.knowledge_key
             order by
               (item.auto_update_locked or item.origin = 'manual') desc,
               coalesce(item.valid_from, item.observed_at, item.updated_at) desc,
               item.updated_at desc,
               item.id desc
           ) as rn
    from public.wiki_items item
    where item.topic_id = p_target_topic_id
      and item.lifecycle_state in ('active','open')
  ), demoted as (
    update public.wiki_items item
    set lifecycle_state = 'conflicted', updated_at = now()
    from ranked
    where item.id = ranked.id
      and ranked.rn > 1
      and not (item.auto_update_locked or item.origin = 'manual')
    returning item.id, item.project_id, to_jsonb(item) as after_row
  ), logged as (
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
        from unnest(v_target.aliases || v_source.aliases || array[v_source.normalized_title]) alias
      ),
      last_changed_at = now(),
      updated_at = now()
  where id = p_target_topic_id;

  insert into public.wiki_change_events (
    project_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_target.project_id, 'curate', to_jsonb(v_source), to_jsonb(v_target),
    format('merge_topic: %s → %s (%s건)', v_source.title, v_target.title, v_moved),
    v_actor
  );

  delete from public.wiki_topics where id = p_source_topic_id;
  return query select v_moved, v_conflicted;
end
$$;

reset search_path;

commit;
