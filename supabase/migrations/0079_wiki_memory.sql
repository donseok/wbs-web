-- 0079 Wiki Memory: 사람이 관리하는 문서, 검증·질문·피드백, 사용행동 계측.
--
-- 핵심 계약
--   1) 기존 AI 지식은 review_state='accepted' 로 보존한다. 이 migration 은 어떤 Wiki
--      worker/cron/feature flag도 켜지 않는다.
--   2) 문서 본문은 검증된 RPC에서만 바꾸고 매 저장을 append-only revision으로 남긴다.
--   3) RPC는 클라이언트가 보낸 project_id를 권한 근거로 믿지 않고 잠근 대상 행에서
--      프로젝트를 다시 구한다. 부모·질문·revision 결합은 DB FK와 RPC 양쪽에서 검증한다.
--   4) body_updated_at은 낙관적 잠금 토큰이다. 오래된 토큰으로 저장/복원할 수 없다.
--
-- 롤백: 0079_wiki_memory_rollback.sql. 사람이 쓴 본문·revision·질문·피드백이 소실되므로
-- 롤백 파일의 데이터 소실 경고와 선행 덤프 절차를 반드시 확인한다.

begin;

set search_path = public, extensions;

-- ── 1) wiki_topics를 사람이 쓰는 검증 가능한 문서로 승격 ──────────────────
alter table public.wiki_topics add column if not exists body_md text;
alter table public.wiki_topics add column if not exists body_updated_at timestamptz;
alter table public.wiki_topics add column if not exists body_updated_by uuid;
alter table public.wiki_topics add column if not exists parent_id uuid;
alter table public.wiki_topics add column if not exists sort integer not null default 0;
alter table public.wiki_topics add column if not exists pinned_order integer;
alter table public.wiki_topics add column if not exists origin text not null default 'ai';
alter table public.wiki_topics add column if not exists document_kind text not null default 'reference';
alter table public.wiki_topics add column if not exists verified_at timestamptz;
alter table public.wiki_topics add column if not exists verified_by uuid;
alter table public.wiki_topics add column if not exists review_due_at timestamptz;

-- 기존 주제는 AI가 만든 자산이다. glossary 타입만 문서 템플릿 의미가 명백하므로 보존한다.
update public.wiki_topics
set document_kind = 'glossary'
where type = 'glossary'
  and document_kind = 'reference';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_body_updated_by_fk'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_body_updated_by_fk
      foreign key (body_updated_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_parent_project_fk'
  ) then
    -- project_id까지 묶어 부모가 다른 프로젝트의 문서가 되는 상태를 DB에서도 차단한다.
    alter table public.wiki_topics
      add constraint wiki_topics_parent_project_fk
      foreign key (parent_id, project_id)
      references public.wiki_topics (id, project_id)
      on delete set null (parent_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_verified_by_fk'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_verified_by_fk
      foreign key (verified_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_origin_check'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_origin_check check (origin in ('ai','manual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_document_kind_check'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_document_kind_check
      check (document_kind in (
        'overview','decision','how_to','runbook','faq','glossary','reference'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_not_own_parent_check'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_not_own_parent_check
      check (parent_id is null or parent_id <> id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_pinned_order_check'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_pinned_order_check
      check (pinned_order is null or pinned_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_topics'::regclass
      and conname = 'wiki_topics_review_due_check'
  ) then
    alter table public.wiki_topics
      add constraint wiki_topics_review_due_check
      check (review_due_at is null or verified_at is null or review_due_at >= verified_at);
  end if;
end
$$;

create index if not exists wiki_topics_project_parent_idx
  on public.wiki_topics (project_id, parent_id, sort, id);
create index if not exists wiki_topics_project_pinned_idx
  on public.wiki_topics (project_id, pinned_order)
  where pinned_order is not null;
create index if not exists wiki_topics_project_review_due_idx
  on public.wiki_topics (project_id, review_due_at)
  where review_due_at is not null;

-- ── 2) 문서 revision은 append-only ─────────────────────────────────────────
create table if not exists public.wiki_topic_revisions (
  id             uuid primary key default gen_random_uuid(),
  topic_id       uuid not null,
  project_id     uuid not null,
  version_no     integer not null check (version_no > 0),
  title          text not null check (btrim(title) <> ''),
  body_md        text not null,
  body_hash      text not null check (body_hash <> ''),
  document_kind  text not null
                   check (document_kind in (
                     'overview','decision','how_to','runbook','faq','glossary','reference'
                   )),
  edited_by      uuid references auth.users(id) on delete set null,
  edited_by_name text,
  created_at     timestamptz not null default now(),
  constraint wiki_topic_revisions_topic_version_unique unique (topic_id, version_no),
  constraint wiki_topic_revisions_topic_project_fk
    foreign key (topic_id, project_id)
    references public.wiki_topics (id, project_id)
    on delete restrict
);

create index if not exists wiki_topic_revisions_topic_created_idx
  on public.wiki_topic_revisions (topic_id, version_no desc);
create index if not exists wiki_topic_revisions_project_created_idx
  on public.wiki_topic_revisions (project_id, created_at desc);

create or replace function public.wiki_topic_revisions_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  -- auth.users 삭제에 따른 FK SET NULL만 허용한다. 본문·제목·버전은 끝까지 불변이다.
  if tg_op = 'UPDATE'
     and old.edited_by is not null
     and new.edited_by is null
     and (to_jsonb(new) - 'edited_by') = (to_jsonb(old) - 'edited_by') then
    return new;
  end if;
  raise exception 'WIKI_REVISION_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function public.wiki_topic_revisions_reject_mutation()
  from public, anon, authenticated;
grant execute on function public.wiki_topic_revisions_reject_mutation()
  to service_role;

drop trigger if exists wiki_topic_revisions_immutable_trg
  on public.wiki_topic_revisions;
create trigger wiki_topic_revisions_immutable_trg
before update or delete on public.wiki_topic_revisions
for each row execute function public.wiki_topic_revisions_reject_mutation();

-- ── 3) AI 제안 검토 상태 ───────────────────────────────────────────────────
-- default accepted가 기존 1,219건과 구버전 읽기 동작을 그대로 보존한다. 새 AI 경로는
-- 애플리케이션에서 명시적으로 pending을 써야 하며 이 migration은 자동화를 켜지 않는다.
alter table public.wiki_items
  add column if not exists review_state text not null default 'accepted';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_items'::regclass
      and conname = 'wiki_items_review_state_check'
  ) then
    alter table public.wiki_items
      add constraint wiki_items_review_state_check
      check (review_state in ('pending','accepted','rejected'));
  end if;
end
$$;

create index if not exists wiki_items_project_review_idx
  on public.wiki_items (project_id, review_state, updated_at desc);
create index if not exists wiki_items_topic_pending_idx
  on public.wiki_items (topic_id, updated_at desc)
  where review_state = 'pending';

-- ── 4) 질문과 지식 품질 피드백 ─────────────────────────────────────────────
create table if not exists public.wiki_questions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  topic_id     uuid,
  status       text not null default 'open'
                 check (status in ('open','answered','closed')),
  question     text not null check (btrim(question) <> '' and char_length(question) <= 2000),
  answer       text check (answer is null or char_length(answer) <= 20000),
  asked_by     uuid default auth.uid() references auth.users(id) on delete set null,
  answered_by  uuid references auth.users(id) on delete set null,
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint wiki_questions_id_project_unique unique (id, project_id),
  constraint wiki_questions_topic_project_fk
    foreign key (topic_id, project_id)
    references public.wiki_topics (id, project_id)
    on delete set null (topic_id),
  constraint wiki_questions_answer_state_check check (
    status <> 'answered'
    or (answer is not null and btrim(answer) <> '' and answered_at is not null)
  )
);

create index if not exists wiki_questions_project_status_idx
  on public.wiki_questions (project_id, status, updated_at desc);
create index if not exists wiki_questions_topic_idx
  on public.wiki_questions (topic_id, created_at desc)
  where topic_id is not null;
create index if not exists wiki_questions_asked_by_idx
  on public.wiki_questions (asked_by, created_at desc);

create table if not exists public.wiki_feedback (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  topic_id       uuid not null,
  feedback_type  text not null check (feedback_type in ('helpful','outdated')),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  comment        text check (comment is null or char_length(comment) <= 500),
  resolution     text check (resolution is null or char_length(resolution) <= 4000),
  resolved_by    uuid references auth.users(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wiki_feedback_id_project_unique unique (id, project_id),
  constraint wiki_feedback_user_topic_kind_unique
    unique (topic_id, user_id, feedback_type),
  constraint wiki_feedback_topic_project_fk
    foreign key (topic_id, project_id)
    references public.wiki_topics (id, project_id)
    on delete cascade,
  constraint wiki_feedback_resolution_state_check check (
    (resolution is null and resolved_at is null)
    or (resolution is not null and btrim(resolution) <> '' and resolved_at is not null)
  )
);

create index if not exists wiki_feedback_topic_created_idx
  on public.wiki_feedback (topic_id, created_at desc);
create index if not exists wiki_feedback_project_open_idx
  on public.wiki_feedback (project_id, feedback_type, created_at desc)
  where resolved_at is null;

-- ── 5) Wiki 행동 계측 ──────────────────────────────────────────────────────
alter table public.usage_events
  add column if not exists event_name text not null default 'page_view';
alter table public.usage_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_event_name_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_event_name_check
      check (btrim(event_name) <> '' and char_length(event_name) <= 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_metadata_object_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_metadata_object_check
      check (jsonb_typeof(metadata) = 'object');
  end if;
end
$$;

create index if not exists usage_events_event_name_idx
  on public.usage_events (event_name, occurred_at desc);

-- 0051의 기존 집계는 행 전체를 "페이지 이동"으로 가정했다. 0079부터 같은 테이블에
-- search/answer/reuse 같은 제품 이벤트도 들어오므로, 기존 대시보드·세션의 의미를
-- event_name='page_view'로 고정한다. 새 Wiki 행동 분석은 별도 쿼리가 event_name을 쓴다.
create or replace function public.usage_summary(p_from date, p_to date, p_today date)
returns table (
  total_events bigint,
  active_users bigint,
  today_users bigint,
  last_event_at timestamptz
)
language sql
stable
as $$
  select
    (select count(*) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where event_name = 'page_view'
         and occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events
       where event_name = 'page_view');
$$;

create or replace function public.usage_daily_actives(p_from date, p_to date)
returns table (d date, active_users integer, events integer)
language sql
stable
as $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1
  order by 1;
$$;

create or replace function public.usage_menu_ranking(p_from date, p_to date)
returns table (menu_key text, events integer, active_users integer)
language sql
stable
as $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key
  order by 2 desc, 1;
$$;

create or replace function public.usage_user_rollup(p_from date, p_to date)
returns table (user_id uuid, events integer, active_days integer, last_at timestamptz)
language sql
stable
as $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where event_name = 'page_view'
    and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;

create or replace function public.usage_sessions(
  p_from date,
  p_to date,
  p_gap_minutes integer default 30
) returns integer
language sql
stable
as $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where event_name = 'page_view'
      and occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  )
  select count(*)::int
  from ordered
  where prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes);
$$;

-- ── 6) RLS와 최소 권한 ─────────────────────────────────────────────────────
alter table public.wiki_topic_revisions enable row level security;
alter table public.wiki_questions enable row level security;
alter table public.wiki_feedback enable row level security;

drop policy if exists wiki_topic_revisions_read on public.wiki_topic_revisions;
create policy wiki_topic_revisions_read on public.wiki_topic_revisions
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists wiki_questions_read on public.wiki_questions;
create policy wiki_questions_read on public.wiki_questions
  for select to authenticated
  using (public.can_read_project(project_id));

-- 질문자는 user_id를 보낼 권한이 없고 asked_by default=auth.uid()만 사용한다.
drop policy if exists wiki_questions_member_insert on public.wiki_questions;
create policy wiki_questions_member_insert on public.wiki_questions
  for insert to authenticated
  with check (
    asked_by = auth.uid()
    and public.is_project_member(project_id)
    and (
      wiki_questions.topic_id is null
      or exists (
        select 1 from public.wiki_topics topic
        where topic.id = wiki_questions.topic_id
          and topic.project_id = wiki_questions.project_id
      )
    )
  );

drop policy if exists wiki_feedback_read on public.wiki_feedback;
create policy wiki_feedback_read on public.wiki_feedback
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists wiki_feedback_member_insert on public.wiki_feedback;
create policy wiki_feedback_member_insert on public.wiki_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_project_member(project_id)
    and exists (
      select 1 from public.wiki_topics topic
      where topic.id = wiki_feedback.topic_id
        and topic.project_id = wiki_feedback.project_id
    )
  );

-- wiki_topics 본문을 직접 UPDATE하면 revision/CAS를 우회한다. 기존처럼 SELECT만 남기고
-- 쓰기는 아래 security-definer RPC로 제한한다.
revoke all on table public.wiki_topic_revisions from public, anon, authenticated;
revoke all on table public.wiki_questions from public, anon, authenticated;
revoke all on table public.wiki_feedback from public, anon, authenticated;

grant select on table public.wiki_topic_revisions to authenticated;
grant select, insert (project_id, topic_id, question)
  on table public.wiki_questions to authenticated;
grant select, insert (project_id, topic_id, feedback_type, comment)
  on table public.wiki_feedback to authenticated;

grant all on table public.wiki_topic_revisions to service_role;
grant all on table public.wiki_questions to service_role;
grant all on table public.wiki_feedback to service_role;

-- ── 7) 공통 입력 정규화 ────────────────────────────────────────────────────
-- src/lib/domain/wiki.normalizeWikiTitle과 같은 NFKC/공백/대시/구분자/소문자 규칙이다.
create or replace function public.wiki_normalize_document_title(p_title text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(normalize(p_title, NFKC), '[[:space:]]+', ' ', 'g'),
        '[‐‑‒–—―]', '-', 'g'
      ),
      '[[:space:]]*([/·:-])[[:space:]]*', E'\\1', 'g'
    )
  )::text
$$;

revoke all on function public.wiki_normalize_document_title(text)
  from public, anon, authenticated;
grant execute on function public.wiki_normalize_document_title(text)
  to service_role;

-- ── 8) 원자적 문서 RPC ─────────────────────────────────────────────────────
create or replace function public.create_wiki_document(
  p_project_id uuid,
  p_title text,
  p_body_md text,
  p_document_kind text,
  p_parent_id uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body_md, '');
  v_normalized_title text;
  v_cursor uuid;
  v_parent uuid;
  v_depth integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.is_project_member(p_project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_title = '' or char_length(v_title) > 160 then
    raise exception 'WIKI_DOCUMENT_TITLE_INVALID' using errcode = '22023';
  end if;
  if p_document_kind is null or p_document_kind not in (
    'overview','decision','how_to','runbook','faq','glossary','reference'
  ) then
    raise exception 'WIKI_DOCUMENT_KIND_INVALID' using errcode = '22023';
  end if;
  if char_length(v_body) > 100000 then
    raise exception 'WIKI_DOCUMENT_BODY_TOO_LARGE' using errcode = '22023';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  -- 같은 프로젝트의 트리 변경을 직렬화해 create/move 경합으로 깊이·순환 규칙이
  -- 검사 직후 뒤집히지 않게 한다. 트랜잭션 종료 시 자동 해제된다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text, 79)
  );

  -- 새 문서도 이동 RPC와 같은 루트+2단 상한 및 "문서만 부모" 규칙을 적용한다.
  v_cursor := p_parent_id;
  while v_cursor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 2 then
      raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
    end if;

    select parent.parent_id into v_parent
    from public.wiki_topics parent
    where parent.id = v_cursor
      and parent.project_id = p_project_id
      and nullif(btrim(coalesce(parent.body_md, '')), '') is not null;
    if not found then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    v_cursor := v_parent;
  end loop;

  v_normalized_title := public.wiki_normalize_document_title(v_title);

  begin
    insert into public.wiki_topics (
      project_id, title, normalized_title, type, body_md,
      body_updated_at, body_updated_by, parent_id, origin, document_kind,
      last_changed_at, created_at, updated_at
    ) values (
      p_project_id,
      v_title,
      v_normalized_title,
      case p_document_kind
        when 'glossary' then 'glossary'
        when 'how_to' then 'process'
        when 'runbook' then 'process'
        when 'decision' then 'policy'
        else 'general'
      end,
      v_body,
      v_now,
      v_actor,
      p_parent_id,
      'manual',
      p_document_kind,
      v_now,
      v_now,
      v_now
    )
    returning id into v_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  insert into public.wiki_topic_revisions (
    topic_id, project_id, version_no, title, body_md, body_hash,
    document_kind, edited_by, edited_by_name, created_at
  ) values (
    v_topic_id, p_project_id, 1, v_title, v_body,
    public.wiki_fnv1a64(v_body),
    p_document_kind, v_actor, v_actor_name, v_now
  );

  return v_topic_id;
end
$$;

create or replace function public.save_wiki_document(
  p_topic_id uuid,
  p_title text,
  p_body_md text,
  p_document_kind text,
  p_expected_updated_at timestamptz default null
) returns table (topic_id uuid, body_updated_at timestamptz, version_no integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic public.wiki_topics%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := coalesce(p_body_md, '');
  v_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;
  if v_title = '' or char_length(v_title) > 160 then
    raise exception 'WIKI_DOCUMENT_TITLE_INVALID' using errcode = '22023';
  end if;
  if p_document_kind is null or p_document_kind not in (
    'overview','decision','how_to','runbook','faq','glossary','reference'
  ) then
    raise exception 'WIKI_DOCUMENT_KIND_INVALID' using errcode = '22023';
  end if;
  if char_length(v_body) > 100000 then
    raise exception 'WIKI_DOCUMENT_BODY_TOO_LARGE' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is not null
     and nullif(btrim(v_body), '') is null
     and not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  select coalesce(max(revision.version_no), 0) + 1 into v_version
  from public.wiki_topic_revisions revision
  where revision.topic_id = p_topic_id;

  -- clock_timestamp가 이전 토큰과 같아도 다음 저장 토큰은 반드시 달라야 한다.
  if v_topic.body_updated_at is not null and v_now <= v_topic.body_updated_at then
    v_now := v_topic.body_updated_at + interval '1 microsecond';
  end if;

  begin
    insert into public.wiki_topic_revisions (
      topic_id, project_id, version_no, title, body_md, body_hash,
      document_kind, edited_by, edited_by_name, created_at
    ) values (
      p_topic_id, v_topic.project_id, v_version, v_title, v_body,
      public.wiki_fnv1a64(v_body),
      p_document_kind, v_actor, v_actor_name, v_now
    );

    update public.wiki_topics topic
    set title = v_title,
        normalized_title = public.wiki_normalize_document_title(v_title),
        type = case p_document_kind
          when 'glossary' then 'glossary'
          when 'how_to' then 'process'
          when 'runbook' then 'process'
          when 'decision' then 'policy'
          else topic.type
        end,
        body_md = v_body,
        body_updated_at = v_now,
        body_updated_by = v_actor,
        origin = 'manual',
        document_kind = p_document_kind,
        verified_at = null,
        verified_by = null,
        review_due_at = null,
        last_changed_at = v_now,
        updated_at = v_now
    where topic.id = p_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  return query select p_topic_id, v_now, v_version;
end
$$;

create or replace function public.verify_wiki_document(
  p_topic_id uuid,
  p_review_days integer default 90,
  p_expected_updated_at timestamptz default null
) returns table (topic_id uuid, verified_at timestamptz, review_due_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_topic public.wiki_topics%rowtype;
  v_now timestamptz := clock_timestamp();
  v_due timestamptz;
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is null then
    raise exception 'WIKI_DOCUMENT_EMPTY' using errcode = '22023';
  end if;
  if p_review_days is null or p_review_days < 1 or p_review_days > 365 then
    raise exception 'WIKI_DOCUMENT_REVIEW_DAYS_INVALID' using errcode = '22023';
  end if;

  v_due := v_now + make_interval(days => p_review_days);
  update public.wiki_topics topic
  set verified_at = v_now,
      verified_by = v_actor,
      review_due_at = v_due,
      updated_at = v_now
  where topic.id = p_topic_id;

  -- "오래됨" 신고는 이 검증이 대체한 유지관리 작업이다. 문서 검증과 같은 트랜잭션에서
  -- 열린 신고를 닫아 verified 배지와 피드백 큐가 서로 다른 상태가 되지 않게 한다.
  update public.wiki_feedback feedback
  set resolution = 'verified',
      resolved_by = v_actor,
      resolved_at = v_now,
      updated_at = v_now
  where feedback.topic_id = p_topic_id
    and feedback.project_id = v_topic.project_id
    and feedback.feedback_type = 'outdated'
    and feedback.resolved_at is null;

  return query select p_topic_id, v_now, v_due;
end
$$;

create or replace function public.move_wiki_document(
  p_topic_id uuid,
  p_parent_id uuid,
  p_sort integer default 0,
  p_pinned_order integer default null
) returns table (
  topic_id uuid,
  parent_id uuid,
  sort integer,
  pinned_order integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_topic public.wiki_topics%rowtype;
  v_cursor uuid;
  v_parent uuid;
  v_depth integer := 0;
  v_descendant_depth integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_sort is null or p_sort < 0 or (p_pinned_order is not null and p_pinned_order < 0) then
    raise exception 'WIKI_DOCUMENT_POSITION_INVALID' using errcode = '22023';
  end if;
  if p_parent_id = p_topic_id then
    raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_topic.project_id::text, 79)
  );

  -- 부모 체인을 직접 확인해 타 프로젝트 결합, 순환, 3단 초과를 한 번에 차단한다.
  v_cursor := p_parent_id;
  while v_cursor is not null loop
    v_depth := v_depth + 1;
    if v_depth > 2 then
      raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
    end if;

    select topic.parent_id into v_parent
    from public.wiki_topics topic
    where topic.id = v_cursor
      and topic.project_id = v_topic.project_id
      and nullif(btrim(coalesce(topic.body_md, '')), '') is not null;
    if not found then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    if v_parent = p_topic_id then
      raise exception 'WIKI_DOCUMENT_PARENT_INVALID' using errcode = '23514';
    end if;
    v_cursor := v_parent;
  end loop;

  -- 이동 대상의 하위 트리 높이까지 합쳐 루트+2단(간선 깊이 2)을 넘지 않게 한다.
  with recursive descendants as (
    select topic.id, 0 as depth, array[topic.id] as path
    from public.wiki_topics topic
    where topic.id = p_topic_id and topic.project_id = v_topic.project_id
    union all
    select child.id, descendants.depth + 1, descendants.path || child.id
    from public.wiki_topics child
    join descendants on child.parent_id = descendants.id
    where child.project_id = v_topic.project_id
      and not (child.id = any(descendants.path))
      and descendants.depth < 100
  )
  select coalesce(max(descendants.depth), 0) into v_descendant_depth
  from descendants;

  if v_depth + v_descendant_depth > 2 then
    raise exception 'WIKI_DOCUMENT_DEPTH_EXCEEDED' using errcode = '22023';
  end if;

  update public.wiki_topics topic
  set parent_id = p_parent_id,
      sort = p_sort,
      pinned_order = p_pinned_order,
      last_changed_at = v_now,
      updated_at = v_now
  where topic.id = p_topic_id;

  return query select p_topic_id, p_parent_id, p_sort, p_pinned_order;
end
$$;

create or replace function public.restore_wiki_document_revision(
  p_topic_id uuid,
  p_revision_id uuid,
  p_expected_updated_at timestamptz default null
) returns table (topic_id uuid, body_updated_at timestamptz, version_no integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_topic public.wiki_topics%rowtype;
  v_revision public.wiki_topic_revisions%rowtype;
  v_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select topic.* into v_topic
  from public.wiki_topics topic
  where topic.id = p_topic_id
  for update;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_topic.body_updated_at is distinct from p_expected_updated_at then
    raise exception 'WIKI_DOCUMENT_EDIT_CONFLICT' using errcode = '40001';
  end if;

  select revision.* into v_revision
  from public.wiki_topic_revisions revision
  where revision.id = p_revision_id
    and revision.topic_id = p_topic_id
    and revision.project_id = v_topic.project_id;
  if not found then
    raise exception 'WIKI_REVISION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if nullif(btrim(coalesce(v_topic.body_md, '')), '') is not null
     and nullif(btrim(v_revision.body_md), '') is null
     and not public.is_project_admin(v_topic.project_id) then
    raise exception 'WIKI_DOCUMENT_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(
    nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
    user_row.email
  ) into v_actor_name
  from auth.users user_row
  where user_row.id = v_actor;

  select coalesce(max(revision.version_no), 0) + 1 into v_version
  from public.wiki_topic_revisions revision
  where revision.topic_id = p_topic_id;

  if v_topic.body_updated_at is not null and v_now <= v_topic.body_updated_at then
    v_now := v_topic.body_updated_at + interval '1 microsecond';
  end if;

  begin
    -- 과거 행은 수정하지 않는다. 복원 결과도 새 revision으로 append한다.
    insert into public.wiki_topic_revisions (
      topic_id, project_id, version_no, title, body_md, body_hash,
      document_kind, edited_by, edited_by_name, created_at
    ) values (
      p_topic_id, v_topic.project_id, v_version,
      v_revision.title, v_revision.body_md, v_revision.body_hash,
      v_revision.document_kind, v_actor, v_actor_name, v_now
    );

    update public.wiki_topics topic
    set title = v_revision.title,
        normalized_title = public.wiki_normalize_document_title(v_revision.title),
        type = case v_revision.document_kind
          when 'glossary' then 'glossary'
          when 'how_to' then 'process'
          when 'runbook' then 'process'
          when 'decision' then 'policy'
          else topic.type
        end,
        body_md = v_revision.body_md,
        body_updated_at = v_now,
        body_updated_by = v_actor,
        origin = 'manual',
        document_kind = v_revision.document_kind,
        verified_at = null,
        verified_by = null,
        review_due_at = null,
        last_changed_at = v_now,
        updated_at = v_now
    where topic.id = p_topic_id;
  exception when unique_violation then
    raise exception 'WIKI_DOCUMENT_TITLE_TAKEN' using errcode = '23505';
  end;

  return query select p_topic_id, v_now, v_version;
end
$$;

-- ── 9) 질문·검토·피드백 RPC ────────────────────────────────────────────────
create or replace function public.create_wiki_question(
  p_project_id uuid,
  p_topic_id uuid,
  p_question text
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_question_id uuid;
  v_question text := btrim(coalesce(p_question, ''));
begin
  if v_actor is null or not public.is_project_member(p_project_id) then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_question = '' or char_length(v_question) > 2000 then
    raise exception 'WIKI_QUESTION_INVALID' using errcode = '22023';
  end if;
  if p_topic_id is not null and not exists (
    select 1 from public.wiki_topics topic
    where topic.id = p_topic_id and topic.project_id = p_project_id
  ) then
    raise exception 'WIKI_QUESTION_TOPIC_MISMATCH' using errcode = '23514';
  end if;

  insert into public.wiki_questions (project_id, topic_id, question, asked_by)
  values (p_project_id, p_topic_id, v_question, v_actor)
  returning id into v_question_id;
  return v_question_id;
end
$$;

create or replace function public.answer_wiki_question(
  p_question_id uuid,
  p_answer text,
  p_topic_id uuid default null
) returns table (
  question_id uuid,
  status text,
  topic_id uuid,
  answered_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_question public.wiki_questions%rowtype;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_topic_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;

  select question.* into v_question
  from public.wiki_questions question
  where question.id = p_question_id
  for update;
  if not found then
    raise exception 'WIKI_QUESTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_question.project_id) then
    raise exception 'WIKI_QUESTION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_question.status <> 'open' then
    raise exception 'WIKI_QUESTION_NOT_OPEN' using errcode = '22023';
  end if;
  if v_answer = '' or char_length(v_answer) > 20000 then
    raise exception 'WIKI_ANSWER_INVALID' using errcode = '22023';
  end if;

  v_topic_id := coalesce(p_topic_id, v_question.topic_id);
  if v_topic_id is not null and not exists (
    select 1 from public.wiki_topics topic
    where topic.id = v_topic_id and topic.project_id = v_question.project_id
  ) then
    raise exception 'WIKI_QUESTION_TOPIC_MISMATCH' using errcode = '23514';
  end if;

  update public.wiki_questions question
  set answer = v_answer,
      status = 'answered',
      topic_id = v_topic_id,
      answered_by = v_actor,
      answered_at = v_now,
      updated_at = v_now
  where question.id = p_question_id;

  return query select p_question_id, 'answered'::text, v_topic_id, v_now;
end
$$;

create or replace function public.review_wiki_item(
  p_item_id uuid,
  p_review_state text
) returns table (item_id uuid, review_state text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_item public.wiki_items%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if p_review_state is null or p_review_state not in ('pending','accepted','rejected') then
    raise exception 'WIKI_REVIEW_STATE_INVALID' using errcode = '22023';
  end if;

  select item.* into v_item
  from public.wiki_items item
  where item.id = p_item_id
  for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_admin(v_item.project_id) then
    raise exception 'WIKI_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  if v_item.review_state = p_review_state then
    return query select p_item_id, v_item.review_state;
    return;
  end if;
  if not (
    (v_item.review_state = 'pending' and p_review_state in ('accepted','rejected'))
    or (v_item.review_state = 'rejected' and p_review_state = 'pending')
  ) then
    raise exception 'WIKI_REVIEW_INVALID_TRANSITION' using errcode = '22023';
  end if;

  v_before := to_jsonb(v_item);
  update public.wiki_items item
  set review_state = p_review_state,
      updated_at = v_now
  where item.id = p_item_id;
  select to_jsonb(item) into v_after
  from public.wiki_items item
  where item.id = p_item_id;

  insert into public.wiki_change_events (
    project_id, wiki_item_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_item.project_id, p_item_id, 'curate', v_before, v_after,
    'review:' || p_review_state, v_actor
  );

  update public.wiki_topics topic
  set last_changed_at = v_now, updated_at = v_now
  where topic.id = v_item.topic_id and topic.project_id = v_item.project_id;

  return query select p_item_id, p_review_state;
end
$$;

create or replace function public.submit_wiki_feedback(
  p_topic_id uuid,
  p_kind text,
  p_comment text default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
  v_feedback_id uuid;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'WIKI_FEEDBACK_FORBIDDEN' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('helpful','outdated') then
    raise exception 'WIKI_FEEDBACK_KIND_INVALID' using errcode = '22023';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'WIKI_FEEDBACK_COMMENT_INVALID' using errcode = '22023';
  end if;

  -- 프로젝트 id를 클라이언트에서 받지 않는다. 대상 topic이 권한 판정의 단일 정본이다.
  select topic.project_id into v_project_id
  from public.wiki_topics topic
  where topic.id = p_topic_id;
  if not found then
    raise exception 'WIKI_DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_project_member(v_project_id) then
    raise exception 'WIKI_FEEDBACK_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.wiki_feedback (
    project_id, topic_id, feedback_type, user_id, comment, created_at, updated_at
  ) values (
    v_project_id, p_topic_id, p_kind, v_actor, v_comment, v_now, v_now
  )
  on conflict (topic_id, user_id, feedback_type) do update
  set comment = excluded.comment,
      -- 같은 사용자가 오래됨을 다시 누르면 이전 해결 상태를 재연다.
      resolution = null,
      resolved_by = null,
      resolved_at = null,
      updated_at = excluded.updated_at
  returning id into v_feedback_id;

  if p_kind = 'outdated' then
    update public.wiki_topics topic
    set review_due_at = least(coalesce(topic.review_due_at, v_now), v_now),
        updated_at = v_now
    where topic.id = p_topic_id and topic.project_id = v_project_id;
  end if;

  return v_feedback_id;
end
$$;

-- 0053의 삭제형 병합은 사람이 쓴 문서와 revision이 생긴 0079 이후 FK restrict에 막히거나,
-- 문서 정본을 지울 수 있다. 앱 가드와 별개로 DB 직접 RPC도 fail-closed로 보호한다.
create or replace function public.merge_wiki_topics(
  p_source_topic_id uuid,
  p_target_topic_id uuid
) returns table (moved_items integer, conflicted_items integer)
language plpgsql
volatile
security definer
set search_path = ''
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

  perform 1 from public.wiki_topics topic
  where topic.id in (p_source_topic_id, p_target_topic_id)
  order by topic.id
  for update;

  select topic.* into v_source
  from public.wiki_topics topic where topic.id = p_source_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;
  select topic.* into v_target
  from public.wiki_topics topic where topic.id = p_target_topic_id;
  if not found then raise exception 'WIKI_TOPIC_NOT_FOUND' using errcode = 'P0002'; end if;

  if not public.is_project_admin(v_source.project_id) then
    raise exception 'WIKI_MERGE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_source.project_id <> v_target.project_id then
    raise exception 'WIKI_MERGE_CROSS_PROJECT' using errcode = '22023';
  end if;
  if v_source.origin = 'manual'
     or v_target.origin = 'manual'
     or exists (
       select 1 from public.wiki_topic_revisions revision
       where revision.topic_id in (p_source_topic_id, p_target_topic_id)
     ) then
    raise exception 'WIKI_MERGE_DOCUMENT_FORBIDDEN' using errcode = '22023';
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

  update public.wiki_topics topic
  set aliases = (
        select array_agg(distinct alias)
        from unnest(v_target.aliases || v_source.aliases || array[v_source.normalized_title]) alias
      ),
      last_changed_at = now(),
      updated_at = now()
  where topic.id = p_target_topic_id;

  insert into public.wiki_change_events (
    project_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_target.project_id, 'curate', to_jsonb(v_source), to_jsonb(v_target),
    format('merge_topic: %s → %s (%s건)', v_source.title, v_target.title, v_moved),
    v_actor
  );

  delete from public.wiki_topics topic where topic.id = p_source_topic_id;
  return query select v_moved, v_conflicted;
end
$$;

-- SECURITY DEFINER의 기본 PUBLIC EXECUTE를 먼저 제거한 뒤 필요한 역할에만 연다.
revoke all on function public.create_wiki_document(uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_wiki_document(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.verify_wiki_document(uuid, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.move_wiki_document(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.restore_wiki_document_revision(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.create_wiki_question(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.answer_wiki_question(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.review_wiki_item(uuid, text)
  from public, anon, authenticated;
revoke all on function public.submit_wiki_feedback(uuid, text, text)
  from public, anon, authenticated;
-- merge_wiki_topics는 0048/0053에서도 노출돼 있으므로 새 본문으로 교체한 뒤 권한을 재확정한다.
revoke all on function public.merge_wiki_topics(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_wiki_document(uuid, text, text, text, uuid)
  to authenticated;
grant execute on function public.save_wiki_document(uuid, text, text, text, timestamptz)
  to authenticated;
grant execute on function public.verify_wiki_document(uuid, integer, timestamptz)
  to authenticated;
grant execute on function public.move_wiki_document(uuid, uuid, integer, integer)
  to authenticated;
grant execute on function public.restore_wiki_document_revision(uuid, uuid, timestamptz)
  to authenticated;
grant execute on function public.create_wiki_question(uuid, uuid, text)
  to authenticated;
grant execute on function public.answer_wiki_question(uuid, text, uuid)
  to authenticated;
grant execute on function public.review_wiki_item(uuid, text)
  to authenticated;
grant execute on function public.submit_wiki_feedback(uuid, text, text)
  to authenticated;
grant execute on function public.merge_wiki_topics(uuid, uuid)
  to authenticated;

grant execute on function public.create_wiki_document(uuid, text, text, text, uuid)
  to service_role;
grant execute on function public.save_wiki_document(uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.verify_wiki_document(uuid, integer, timestamptz)
  to service_role;
grant execute on function public.move_wiki_document(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.restore_wiki_document_revision(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.create_wiki_question(uuid, uuid, text)
  to service_role;
grant execute on function public.answer_wiki_question(uuid, text, uuid)
  to service_role;
grant execute on function public.review_wiki_item(uuid, text)
  to service_role;
grant execute on function public.submit_wiki_feedback(uuid, text, text)
  to service_role;
grant execute on function public.merge_wiki_topics(uuid, uuid)
  to service_role;

reset search_path;

commit;
