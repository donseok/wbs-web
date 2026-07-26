-- Wiki 사람 개입(큐레이션): 0045는 authenticated에게 읽기 정책만 주고 쓰기 정책을 두지 않아
-- AI가 잘못 뽑은 문장 숨기기, 끝난 액션 닫기, 충돌 확정, 갈라진 주제 병합이 모두 불가능했다.
-- (origin='manual' / auto_update_locked 컬럼과 '수동 고정' 칩은 도달할 수 없는 기능이었다.)
--
-- 테이블 직접 쓰기 정책은 계속 열지 않는다. REST 직접 호출로 임의 lifecycle/statement를 주입하면
-- 근거 없는 지식이 만들어지므로, 허용된 전이만 수행하는 security definer RPC로만 연다.
-- 모든 큐레이션은 wiki_change_events에 actor와 함께 남아 AI 반영 이력과 같은 타임라인에 선다.
--
-- 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지). 멱등: 반복 실행 안전.

set search_path = public;

-- ── 1) 감사 컬럼 + 큐레이션 change_type ──
alter table public.wiki_change_events add column if not exists actor_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'wiki_change_events_actor_fk'
      and conrelid = 'public.wiki_change_events'::regclass
  ) then
    alter table public.wiki_change_events
      add constraint wiki_change_events_actor_fk
      foreign key (actor_id) references auth.users(id) on delete set null;
  end if;
end $$;

-- 사람이 정리한 이벤트는 AI의 8종 변경과 섞이지 않게 별도 값으로 남긴다.
alter table public.wiki_change_events
  drop constraint if exists wiki_change_events_change_type_check;
alter table public.wiki_change_events
  add constraint wiki_change_events_change_type_check
  check (change_type in (
    'new','reaffirm','refine','supersede','reverse','conflict','resolve','retract','curate'
  ));

-- ── 2) knowledge_key 슬러그 (lib/domain/wiki.normalizeWikiKnowledgeKey 대응) ──
-- 주제 병합 시 키 앞부분(주제 슬러그)을 정본 주제 것으로 다시 쓰는 데만 쓴다.
-- JS 정규화와 완전히 같지 않아도 최악의 결과는 "다음 회의에서 이 항목을 못 찾음"(= 병합 전과 동일)이며
-- 기존 지식이 훼손되지는 않는다.
create or replace function public.wiki_key_slug(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(normalize(coalesce(p_text, ''), NFKC)),
        '[‐‑‒–—―]', '-', 'g'
      ),
      '[^[:alnum:]]+', '-', 'g'
    ),
    '-'
  )
$$;

-- ── 3) 근거 생존 여부 ──
-- 시스템 철회로 archived된 항목과 사람이 숨긴 항목을 구분하는 유일한 신호다.
-- 전자는 활성 근거가 하나도 없다(0045 retract_minute_wiki_sources가 근거를 회수하고 항목을 archive).
create or replace function public.wiki_item_has_live_source(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.wiki_item_sources s
    where s.wiki_item_id = p_item_id and s.retracted_at is null
  ) or exists (
    select 1 from public.wiki_items w
    where w.id = p_item_id and w.origin = 'manual'
  )
$$;

-- ── 3) 항목 큐레이션 ──
-- 허용 동작만 수행하고, 그 외 값은 거부한다. statement 자체는 바꾸지 않는다 —
-- 원문 근거와 어긋나는 문장을 사람이 덮어쓰면 "근거가 추적되는 지식"이라는 계약이 깨진다.
-- 잘못 추출된 항목은 수정이 아니라 archive(숨김)로 처리한다.
create or replace function public.curate_wiki_item(
  p_item_id uuid,
  p_action  text,
  p_reason  text default null
)
returns table (
  item_id         uuid,
  lifecycle_state text,
  decision_state  text,
  auto_update_locked boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
end $$;

-- ── 4) 주제 병합 ──
-- LLM이 회의마다 제목을 새로 지어 갈라진 주제를 정본 하나로 합친다.
-- 병합 뒤 같은 knowledge_key가 여러 개 살아 있으면 가장 최근 것만 현재값으로 두고
-- 나머지는 조용히 지우지 않고 conflicted로 나란히 보존한다(0045 설계 계약).
create or replace function public.merge_wiki_topics(
  p_source_topic_id uuid,
  p_target_topic_id uuid
)
returns table (moved_items integer, conflicted_items integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
end $$;

-- ── 5) 실행 권한 ──
-- 테이블 쓰기 정책은 계속 없다. 검증된 전이만 하는 이 함수들만 authenticated에게 연다.
revoke all on function public.curate_wiki_item(uuid, text, text) from public, anon;
revoke all on function public.merge_wiki_topics(uuid, uuid) from public, anon;
revoke all on function public.wiki_key_slug(text) from public, anon;
revoke all on function public.wiki_item_has_live_source(uuid) from public, anon;
grant execute on function public.curate_wiki_item(uuid, text, text) to authenticated, service_role;
grant execute on function public.merge_wiki_topics(uuid, uuid) to authenticated, service_role;
grant execute on function public.wiki_key_slug(text) to authenticated, service_role;
grant execute on function public.wiki_item_has_live_source(uuid) to authenticated, service_role;

reset search_path;
