-- 회의록 기반 Living Wiki 기반 스키마.
--
-- 핵심 계약
--   1) minutes 는 증거 원본이다. 본문 교체 이력은 minute_versions 에 append-only 로 보존한다.
--   2) wiki_* 지식은 service_role 이 자동 생성하고 authenticated 는 읽기만 한다.
--   3) wiki_processing_jobs 는 내부 워커 전용이며 일반 사용자에게 노출하지 않는다.
--   4) 새 회의록이 과거 지식을 덮어쓰더라도 원본·출처·change event 는 삭제하지 않는다.
--
-- 멱등: add/create/index/policy 는 반복 실행 안전하게 작성했다. 백필은 ON CONFLICT DO NOTHING.
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 Wiki 처리 코드를 배포한다.
-- 롤백: 0045_minutes_wiki_rollback.sql (Wiki 파생 데이터와 회의록 버전 이력이 소실되므로 헤더 경고 확인).

set search_path = public, extensions;

-- ── 1) 회의록의 프로젝트·실제 회차·보관 상태 ──
-- FK 를 열 정의와 분리해, 개발 DB에 컬럼만 먼저 생긴 상태에서도 재실행으로 수렴시킨다.
alter table public.minutes add column if not exists project_id uuid;
alter table public.minutes add column if not exists meeting_occurrence_date date;
alter table public.minutes add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.minutes'::regclass
      and conname = 'minutes_project_fk'
  ) then
    alter table public.minutes
      add constraint minutes_project_fk
      foreign key (project_id) references public.projects(id) on delete set null;
  end if;
end $$;

-- 연결 회의가 정본이다. 기존 행만 백필하며 이미 명시된 project_id 는 덮어쓰지 않는다.
update public.minutes mi
set project_id = me.project_id
from public.meetings me
where mi.meeting_id = me.id
  and mi.project_id is null;

-- 반복 회의의 과거 회차를 시간순으로 배치할 수 있게, 연결된 기존 회의록은 회의록 일자를
-- 실제 회차 일자의 최선값으로 사용한다. 미연결 회의록은 null 을 유지해 불확실성을 숨기지 않는다.
update public.minutes
set meeting_occurrence_date = minute_date
where meeting_id is not null
  and meeting_occurrence_date is null;

create index if not exists minutes_project_occurrence_idx
  on public.minutes (project_id, meeting_occurrence_date desc, minute_date desc)
  where archived_at is null;
create index if not exists minutes_project_archived_idx
  on public.minutes (project_id, archived_at)
  where archived_at is not null;

-- ── 2) 회의록 append-only 버전 ──
create table if not exists public.minute_versions (
  id              uuid primary key default gen_random_uuid(),
  minute_id       uuid not null,
  version_no      integer not null check (version_no > 0),
  body_md         text not null,
  body_hash       text not null check (body_hash <> ''),
  -- 본문 버전 시점의 표시/귀속 메타 스냅샷. 이후 minutes 메타가 바뀌어도 과거 뷰가 흔들리지 않는다.
  title            text not null,
  minute_date      date not null,
  team_code        text not null,
  project_id       uuid,
  meeting_id       uuid,
  meeting_occurrence_date date,
  file_name       text,
  file_path       text,
  file_size       bigint check (file_size is null or file_size >= 0),
  file_mime       text,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  constraint minute_versions_minute_fk
    foreign key (minute_id) references public.minutes(id) on delete restrict,
  constraint minute_versions_minute_version_unique unique (minute_id, version_no),
  -- 출처/큐의 (version, minute) 복합 FK가 서로 다른 회의록 버전을 가리키지 못하게 한다.
  constraint minute_versions_id_minute_unique unique (id, minute_id)
);

-- 과거 0045 초안의 minute_versions가 이미 생긴 부분 적용 DB도 현재 minutes 값으로 최선 백필한다.
alter table public.minute_versions add column if not exists title text;
alter table public.minute_versions add column if not exists minute_date date;
alter table public.minute_versions add column if not exists team_code text;
alter table public.minute_versions add column if not exists project_id uuid;
alter table public.minute_versions add column if not exists meeting_id uuid;
alter table public.minute_versions add column if not exists meeting_occurrence_date date;

update public.minute_versions mv
set title = coalesce(mv.title, mi.title),
    minute_date = coalesce(mv.minute_date, mi.minute_date),
    team_code = coalesce(mv.team_code, mi.team_code),
    project_id = coalesce(mv.project_id, mi.project_id),
    meeting_id = coalesce(mv.meeting_id, mi.meeting_id),
    meeting_occurrence_date = coalesce(mv.meeting_occurrence_date, mi.meeting_occurrence_date)
from public.minutes mi
where mi.id = mv.minute_id
  and (mv.title is null or mv.minute_date is null or mv.team_code is null);

alter table public.minute_versions alter column title set not null;
alter table public.minute_versions alter column minute_date set not null;
alter table public.minute_versions alter column team_code set not null;

create index if not exists minute_versions_minute_created_idx
  on public.minute_versions (minute_id, version_no desc);

-- JS fnv1a64(src/lib/minutes/blocks.ts)와 같은 UTF-16 code-unit FNV-1a.
-- 기존 회의록 v1 백필도 향후 앱이 만드는 body_hash 및 원문 앵커와 같은 알고리즘을 쓴다.
create or replace function public.wiki_fnv1a64(p_text text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  v_hash       bigint := -3750763034362895579; -- 0xcbf29ce484222325 의 signed bigint 표현
  v_prime      constant numeric := 1099511628211;
  v_modulus    constant numeric := 18446744073709551616; -- 2^64
  v_sign       constant numeric := 9223372036854775808;  -- 2^63
  v_product    numeric;
  v_codepoint  integer;
  v_unit       integer;
  v_low_unit   integer;
  v_index      integer;
begin
  if p_text = '' then
    return 'cbf29ce484222325';
  end if;

  for v_index in 1..char_length(p_text) loop
    v_codepoint := ascii(substr(p_text, v_index, 1));

    -- JavaScript charCodeAt 은 U+10000 이상 문자를 surrogate pair 두 단위로 순회한다.
    if v_codepoint > 65535 then
      v_unit := 55296 + ((v_codepoint - 65536) / 1024);
      v_low_unit := 56320 + mod(v_codepoint - 65536, 1024);
    else
      v_unit := v_codepoint;
      v_low_unit := null;
    end if;

    v_hash := v_hash # v_unit::bigint;
    v_product := mod(v_hash::numeric * v_prime, v_modulus);
    if v_product < 0 then v_product := v_product + v_modulus; end if;
    if v_product >= v_sign then
      v_hash := (v_product - v_modulus)::bigint;
    else
      v_hash := v_product::bigint;
    end if;

    if v_low_unit is not null then
      v_hash := v_hash # v_low_unit::bigint;
      v_product := mod(v_hash::numeric * v_prime, v_modulus);
      if v_product < 0 then v_product := v_product + v_modulus; end if;
      if v_product >= v_sign then
        v_hash := (v_product - v_modulus)::bigint;
      else
        v_hash := v_product::bigint;
      end if;
    end if;
  end loop;

  return lpad(to_hex(v_hash), 16, '0');
end
$$;

revoke all on function public.wiki_fnv1a64(text) from public, anon, authenticated;
grant execute on function public.wiki_fnv1a64(text) to service_role;

-- minute_files.body 는 partial unique index 로 회의록당 최대 1행이지만, 과거/부분 적용 DB에도
-- 결정적인 결과를 내도록 LATERAL + 최신순 LIMIT 1 을 사용한다.
insert into public.minute_versions (
  minute_id, version_no, body_md, body_hash,
  title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
  file_name, file_path, file_size, file_mime,
  created_by, created_by_name, created_at
)
select
  mi.id,
  1,
  mi.body_md,
  public.wiki_fnv1a64(mi.body_md),
  mi.title,
  mi.minute_date,
  mi.team_code,
  mi.project_id,
  mi.meeting_id,
  mi.meeting_occurrence_date,
  body_file.file_name,
  body_file.file_path,
  body_file.size,
  body_file.mime,
  mi.created_by,
  mi.created_by_name,
  mi.created_at
from public.minutes mi
left join lateral (
  select mf.file_name, mf.file_path, mf.size, mf.mime
  from public.minute_files mf
  where mf.minute_id = mi.id
    and mf.role = 'body'
  order by mf.created_at desc, mf.id desc
  limit 1
) body_file on true
on conflict (minute_id, version_no) do nothing;

-- 초기 초안의 CASCADE FK를 RESTRICT로 재작성한다. 모든 minute에 v1이 있으므로 service_role의
-- 실수성 hard-delete도 DB가 거절하고 archive RPC만 정상 제거 경로로 남는다.
alter table public.minute_versions
  drop constraint if exists minute_versions_minute_id_fkey;
alter table public.minute_versions
  drop constraint if exists minute_versions_minute_fk;
alter table public.minute_versions
  add constraint minute_versions_minute_fk
  foreign key (minute_id) references public.minutes(id) on delete restrict;

-- append 이후 행 자체도 service_role을 포함해 UPDATE/DELETE할 수 없다. DROP TABLE 롤백은
-- row trigger를 실행하지 않으므로 운영 롤백을 방해하지 않는다.
create or replace function public.minute_versions_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  -- auth.users 삭제의 기존 SET NULL 계약은 계정 정리를 막지 않도록 유일한 예외로 둔다.
  if tg_op = 'UPDATE'
     and old.created_by is not null
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  raise exception 'MINUTE_VERSION_IMMUTABLE' using errcode = '55000';
end
$$;

revoke all on function public.minute_versions_reject_mutation()
  from public, anon, authenticated;
grant execute on function public.minute_versions_reject_mutation()
  to service_role;

drop trigger if exists minute_versions_immutable_trg on public.minute_versions;
create trigger minute_versions_immutable_trg
before update or delete on public.minute_versions
for each row execute function public.minute_versions_reject_mutation();

-- 과거 버전이 참조하는 Storage 객체는 업로더도 직접 지울 수 없게 WORM 가드를 건다.
-- 첨부/실패한 선업로드 객체는 version 참조가 없으므로 기존 owner/admin 삭제 UX를 유지한다.
drop policy if exists "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'minutes'
    and (owner = auth.uid() or app_role() = 'pmo_admin')
    and not exists (
      select 1
      from public.minute_versions mv
      where mv.file_path = storage.objects.name
    )
  );

-- ── 3) 프로젝트 Wiki 주제 ──
create table if not exists public.wiki_topics (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null check (btrim(title) <> ''),
  normalized_title text not null check (normalized_title <> ''),
  aliases          text[] not null default '{}'::text[],
  type             text not null default 'general'
                     check (type in ('process','system','interface','data','policy','glossary','general')),
  owner_team       text references public.teams(code) on update cascade on delete set null,
  last_changed_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint wiki_topics_project_title_unique unique (project_id, normalized_title),
  constraint wiki_topics_id_project_unique unique (id, project_id)
);

create index if not exists wiki_topics_project_changed_idx
  on public.wiki_topics (project_id, last_changed_at desc);

-- ── 4) 원자적 지식 항목 ──
create table if not exists public.wiki_items (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  topic_id            uuid not null,
  kind                text not null
                        check (kind in ('decision','fact','action','question','risk','constraint','rationale')),
  statement           text not null check (btrim(statement) <> ''),
  statement_hash      text not null check (statement_hash <> ''),
  knowledge_key       text not null check (knowledge_key <> ''),
  lifecycle_state     text not null default 'active'
                        check (lifecycle_state in ('active','open','resolved','superseded','conflicted','archived')),
  certainty           text not null
                        check (certainty in ('explicit','tentative')),
  decision_state      text
                        check (decision_state is null or decision_state in ('proposed','tentative','confirmed','reversed')),
  owner_team          text references public.teams(code) on update cascade on delete set null,
  owner_member_id     uuid,
  due_date            date,
  observed_at         timestamptz,
  valid_from          timestamptz,
  valid_to            timestamptz,
  origin              text not null default 'ai'
                        check (origin in ('ai','manual')),
  auto_update_locked  boolean not null default false,
  structured_data     jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(structured_data) = 'object'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint wiki_items_valid_range check (
    valid_to is null or valid_from is null or valid_to >= valid_from
  ),
  constraint wiki_items_topic_project_fk
    foreign key (topic_id, project_id)
    references public.wiki_topics (id, project_id),
  constraint wiki_items_owner_project_fk
    foreign key (owner_member_id, project_id)
    references public.project_members (id, project_id)
    on delete set null (owner_member_id)
);

create index if not exists wiki_items_project_state_changed_idx
  on public.wiki_items (project_id, lifecycle_state, updated_at desc);
create index if not exists wiki_items_topic_kind_state_idx
  on public.wiki_items (topic_id, kind, lifecycle_state);
create index if not exists wiki_items_knowledge_key_idx
  on public.wiki_items (project_id, knowledge_key, observed_at desc);
create index if not exists wiki_items_statement_hash_idx
  on public.wiki_items (project_id, statement_hash);
create index if not exists wiki_items_open_due_idx
  on public.wiki_items (project_id, due_date)
  where due_date is not null and lifecycle_state in ('active','open','conflicted');
create index if not exists wiki_items_owner_member_idx
  on public.wiki_items (owner_member_id, lifecycle_state)
  where owner_member_id is not null;

-- ── 5) 지식 ↔ 불변 원문 근거 ──
create table if not exists public.wiki_item_sources (
  id                  uuid primary key default gen_random_uuid(),
  wiki_item_id        uuid not null references public.wiki_items(id) on delete cascade,
  minute_id           uuid not null references public.minutes(id) on delete cascade,
  minute_version_id   uuid not null,
  body_hash           text not null check (body_hash <> ''),
  block_index         integer not null check (block_index >= 0),
  block_hash          text not null check (block_hash <> ''),
  evidence_excerpt    text not null default '',
  relation            text not null
                        check (relation in ('supports','contradicts','resolves')),
  retracted_at        timestamptz,
  retraction_reason   text,
  created_at          timestamptz not null default now(),
  constraint wiki_item_sources_version_minute_fk
    foreign key (minute_version_id, minute_id)
    references public.minute_versions (id, minute_id)
    on delete cascade,
  constraint wiki_item_sources_source_unique
    unique (wiki_item_id, minute_version_id, block_index, relation)
);

-- 과거 0045 초안에 철회 열이 없던 부분 적용 DB도 반복 실행으로 수렴한다.
alter table public.wiki_item_sources add column if not exists retracted_at timestamptz;
alter table public.wiki_item_sources add column if not exists retraction_reason text;

-- 이전 초안의 nullable version/source-key/SET NULL FK를 현재 불변 provenance 계약으로 수렴한다.
update public.wiki_item_sources wis
set minute_version_id = (
  select mv.id
  from public.minute_versions mv
  where mv.minute_id = wis.minute_id
    and mv.body_hash = wis.body_hash
  order by mv.version_no desc
  limit 1
)
where wis.minute_version_id is null;

do $$
begin
  if exists (
    select 1 from public.wiki_item_sources wis where wis.minute_version_id is null
  ) then
    raise exception 'WIKI_SOURCE_VERSION_BACKFILL_FAILED'
      using hint = 'body_hash와 일치하는 minute_versions 행을 먼저 복구한 뒤 0045를 재실행하세요.';
  end if;
end $$;

alter table public.wiki_item_sources alter column minute_version_id set not null;
alter table public.wiki_item_sources
  drop constraint if exists wiki_item_sources_version_minute_fk;
alter table public.wiki_item_sources
  add constraint wiki_item_sources_version_minute_fk
  foreign key (minute_version_id, minute_id)
  references public.minute_versions (id, minute_id)
  on delete cascade;
alter table public.wiki_item_sources
  drop constraint if exists wiki_item_sources_source_unique;
alter table public.wiki_item_sources
  add constraint wiki_item_sources_source_unique
  unique (wiki_item_id, minute_version_id, block_index, relation);

create index if not exists wiki_item_sources_item_idx
  on public.wiki_item_sources (wiki_item_id, created_at);
create index if not exists wiki_item_sources_minute_idx
  on public.wiki_item_sources (minute_id, block_index);
create index if not exists wiki_item_sources_active_item_idx
  on public.wiki_item_sources (wiki_item_id)
  where retracted_at is null;

-- ── 6) 지식 관계와 자동 변경 이력 ──
create table if not exists public.wiki_item_relations (
  id            uuid primary key default gen_random_uuid(),
  from_item_id  uuid not null references public.wiki_items(id) on delete cascade,
  to_item_id    uuid not null references public.wiki_items(id) on delete cascade,
  relation      text not null
                  check (relation in ('confirms','supersedes','contradicts','implements','blocks','depends_on')),
  created_at    timestamptz not null default now(),
  constraint wiki_item_relations_not_self check (from_item_id <> to_item_id),
  constraint wiki_item_relations_edge_unique unique (from_item_id, to_item_id, relation)
);

create index if not exists wiki_item_relations_to_idx
  on public.wiki_item_relations (to_item_id, relation);

create table if not exists public.wiki_change_events (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  wiki_item_id     uuid references public.wiki_items(id) on delete set null,
  minute_id        uuid references public.minutes(id) on delete set null,
  -- source_id는 편의 조인, 아래 복제 provenance는 source 행이 향후 운영 정리돼도 남는 감사 앵커다.
  source_id        uuid,
  minute_version_id uuid,
  source_body_hash text,
  source_block_index integer,
  source_block_hash text,
  change_type      text not null
                     constraint wiki_change_events_change_type_check
                     check (change_type in ('new','reaffirm','refine','supersede','reverse','conflict','resolve','retract')),
  before_snapshot  jsonb
                     check (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot   jsonb
                     check (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object'),
  reason           text not null default '',
  created_at       timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS가 과거 0045 초안을 만난 경우에도 새 provenance 열/제약으로 수렴한다.
alter table public.wiki_change_events add column if not exists source_id uuid;
alter table public.wiki_change_events add column if not exists minute_version_id uuid;
alter table public.wiki_change_events add column if not exists source_body_hash text;
alter table public.wiki_change_events add column if not exists source_block_index integer;
alter table public.wiki_change_events add column if not exists source_block_hash text;

update public.wiki_change_events event
set wiki_item_id = coalesce(event.wiki_item_id, source.wiki_item_id),
    minute_id = coalesce(event.minute_id, source.minute_id),
    minute_version_id = source.minute_version_id,
    source_body_hash = source.body_hash,
    source_block_index = source.block_index,
    source_block_hash = source.block_hash
from public.wiki_item_sources source
where source.id = event.source_id
  and (
    event.minute_version_id is null
    or event.source_body_hash is null
    or event.source_block_index is null
    or event.source_block_hash is null
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_change_events'::regclass
      and conname = 'wiki_change_events_source_fk'
  ) then
    alter table public.wiki_change_events
      add constraint wiki_change_events_source_fk
      foreign key (source_id) references public.wiki_item_sources(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_change_events'::regclass
      and conname = 'wiki_change_events_source_block_check'
  ) then
    alter table public.wiki_change_events
      add constraint wiki_change_events_source_block_check
      check (source_block_index is null or source_block_index >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wiki_change_events'::regclass
      and conname = 'wiki_change_events_source_provenance_check'
  ) then
    alter table public.wiki_change_events
      add constraint wiki_change_events_source_provenance_check
      check (
        source_id is null
        or (
          minute_version_id is not null
          and source_body_hash is not null
          and source_block_index is not null
          and source_block_hash is not null
        )
      );
  end if;
end $$;

-- version UUID는 source 삭제 후에도 감사값으로 남아야 하므로 FK로 지우지 않는다.
alter table public.wiki_change_events
  drop constraint if exists wiki_change_events_version_fk;

-- 과거 초안의 자동 생성 CHECK도 허용 집합에 retract가 포함되도록 명시적으로 교체한다.
alter table public.wiki_change_events
  drop constraint if exists wiki_change_events_change_type_check;
alter table public.wiki_change_events
  add constraint wiki_change_events_change_type_check
  check (change_type in ('new','reaffirm','refine','supersede','reverse','conflict','resolve','retract'));

-- source_id만 받은 앱 insert도 같은 statement 안에서 immutable provenance를 복제한다.
-- 값까지 함께 보낸 경우에는 source와 정확히 일치하는지 검증해 위조/교차 연결을 막는다.
create or replace function public.wiki_change_events_copy_source_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_source public.wiki_item_sources%rowtype;
  v_item_project_id uuid;
begin
  if new.source_id is null then
    return new;
  end if;

  select wis.* into v_source
  from public.wiki_item_sources wis
  where wis.id = new.source_id;
  if not found then
    raise exception 'WIKI_CHANGE_SOURCE_NOT_FOUND' using errcode = '23503';
  end if;

  if new.wiki_item_id is not null and new.wiki_item_id <> v_source.wiki_item_id then
    raise exception 'WIKI_CHANGE_SOURCE_ITEM_MISMATCH' using errcode = '23514';
  end if;
  if new.minute_id is not null and new.minute_id <> v_source.minute_id then
    raise exception 'WIKI_CHANGE_SOURCE_MINUTE_MISMATCH' using errcode = '23514';
  end if;
  if new.minute_version_id is not null and new.minute_version_id <> v_source.minute_version_id then
    raise exception 'WIKI_CHANGE_SOURCE_VERSION_MISMATCH' using errcode = '23514';
  end if;
  if new.source_body_hash is not null and new.source_body_hash <> v_source.body_hash then
    raise exception 'WIKI_CHANGE_SOURCE_BODY_MISMATCH' using errcode = '23514';
  end if;
  if new.source_block_index is not null and new.source_block_index <> v_source.block_index then
    raise exception 'WIKI_CHANGE_SOURCE_BLOCK_MISMATCH' using errcode = '23514';
  end if;
  if new.source_block_hash is not null and new.source_block_hash <> v_source.block_hash then
    raise exception 'WIKI_CHANGE_SOURCE_BLOCK_HASH_MISMATCH' using errcode = '23514';
  end if;
  select wi.project_id into v_item_project_id
  from public.wiki_items wi
  where wi.id = v_source.wiki_item_id;
  if new.project_id <> v_item_project_id then
    raise exception 'WIKI_CHANGE_SOURCE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  new.wiki_item_id := coalesce(new.wiki_item_id, v_source.wiki_item_id);
  new.minute_id := coalesce(new.minute_id, v_source.minute_id);
  new.minute_version_id := v_source.minute_version_id;
  new.source_body_hash := v_source.body_hash;
  new.source_block_index := v_source.block_index;
  new.source_block_hash := v_source.block_hash;
  return new;
end
$$;

revoke all on function public.wiki_change_events_copy_source_provenance()
  from public, anon, authenticated;
grant execute on function public.wiki_change_events_copy_source_provenance()
  to service_role;

drop trigger if exists wiki_change_events_source_provenance_trg
  on public.wiki_change_events;
create trigger wiki_change_events_source_provenance_trg
before insert or update of source_id on public.wiki_change_events
for each row execute function public.wiki_change_events_copy_source_provenance();

create index if not exists wiki_change_events_project_created_idx
  on public.wiki_change_events (project_id, created_at desc);
create index if not exists wiki_change_events_item_created_idx
  on public.wiki_change_events (wiki_item_id, created_at desc)
  where wiki_item_id is not null;
create index if not exists wiki_change_events_minute_idx
  on public.wiki_change_events (minute_id)
  where minute_id is not null;
create index if not exists wiki_change_events_source_idx
  on public.wiki_change_events (source_id)
  where source_id is not null;

-- ── 7) durable processing queue ──
-- project_id + minute_id + body_hash 가 멱등 키다. 같은 회의록이 다른 프로젝트로
-- 재귀속되는 경우는 별도 작업으로 남기되, 같은 프로젝트·본문의 중복 작업은 만들지 않는다.
create table if not exists public.wiki_processing_jobs (
  id                  bigint generated by default as identity primary key,
  project_id          uuid not null references public.projects(id) on delete cascade,
  minute_id           uuid not null references public.minutes(id) on delete cascade,
  minute_version_id   uuid not null,
  body_hash           text not null check (body_hash <> ''),
  status              text not null default 'pending'
                        check (status in ('pending','running','done','dead_letter')),
  attempts            integer not null default 0 check (attempts >= 0),
  max_attempts        integer not null default 5 check (max_attempts > 0),
  run_after           timestamptz not null default now(),
  locked_at           timestamptz,
  locked_by           text,
  last_error          text,
  model               text not null default '',
  prompt_version      text not null default '',
  payload             jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(payload) = 'object'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint wiki_processing_jobs_version_minute_fk
    foreign key (minute_version_id, minute_id)
    references public.minute_versions (id, minute_id)
    on delete cascade,
  constraint wiki_processing_jobs_project_version_unique unique (project_id, minute_version_id)
);

-- 초기 초안의 nullable version + (minute_id,body_hash) 키도 project/version 기반 큐 계약으로 수렴.
update public.wiki_processing_jobs job
set minute_version_id = (
  select mv.id
  from public.minute_versions mv
  where mv.minute_id = job.minute_id
    and mv.body_hash = job.body_hash
  order by mv.version_no desc
  limit 1
)
where job.minute_version_id is null;

do $$
begin
  if exists (
    select 1 from public.wiki_processing_jobs job where job.minute_version_id is null
  ) then
    raise exception 'WIKI_JOB_VERSION_BACKFILL_FAILED'
      using hint = 'body_hash와 일치하는 minute_versions 행을 먼저 복구한 뒤 0045를 재실행하세요.';
  end if;
end $$;

alter table public.wiki_processing_jobs alter column minute_version_id set not null;
alter table public.wiki_processing_jobs
  drop constraint if exists wiki_processing_jobs_version_minute_fk;
alter table public.wiki_processing_jobs
  add constraint wiki_processing_jobs_version_minute_fk
  foreign key (minute_version_id, minute_id)
  references public.minute_versions (id, minute_id)
  on delete cascade;
alter table public.wiki_processing_jobs
  drop constraint if exists wiki_processing_jobs_minute_body_unique;
alter table public.wiki_processing_jobs
  drop constraint if exists wiki_processing_jobs_project_version_unique;
alter table public.wiki_processing_jobs
  add constraint wiki_processing_jobs_project_version_unique
  unique (project_id, minute_version_id);

create index if not exists wiki_processing_jobs_claim_idx
  on public.wiki_processing_jobs (status, run_after, id);
create index if not exists wiki_processing_jobs_locked_idx
  on public.wiki_processing_jobs (locked_at)
  where status = 'running';

-- 회의록 프로젝트 이동/보관 시 검색 색인 scope 변경을 generation-CAS 규약으로 남긴다.
-- 0033의 범용 upsert는 실행 중 job의 lease를 즉시 풀기 때문에, 늦게 끝난 구세대 worker가
-- tombstone 뒤에 과거 문서를 다시 쓸 수 있다. 이 helper는 running lease를 유지한 채
-- generation만 올려 complete CAS가 반드시 최신 작업을 pending으로 되돌리게 한다.
create or replace function public.queue_minute_ai_index_scope_change(
  p_project_id uuid,
  p_minute_id uuid,
  p_operation text,
  p_run_after timestamptz default now()
) returns bigint
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_job_id bigint;
  v_job_key text :=
    'v1:' || coalesce(p_project_id::text, 'global')
      || ':minutes:minute:' || p_minute_id::text;
begin
  if p_minute_id is null or p_operation not in ('upsert', 'delete') then
    raise exception 'MINUTE_INDEX_SCOPE_CHANGE_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs as job (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  ) values (
    v_job_key, p_operation, p_project_id, 'minutes', 'minute', p_minute_id::text,
    '{}'::jsonb, 'pending', 0, coalesce(p_run_after, now()), null, null, 0, now()
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    project_id = excluded.project_id,
    domain = excluded.domain,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    status = case when job.status = 'running' then 'running' else 'pending' end,
    attempts = case when job.status = 'running' then job.attempts else 0 end,
    run_after = case
      when job.status = 'running' then job.run_after
      else excluded.run_after
    end,
    locked_at = case when job.status = 'running' then job.locked_at else null end,
    last_error = null,
    generation = job.generation + 1,
    updated_at = now()
  returning job.id into v_job_id;

  return v_job_id;
end
$$;

revoke all on function public.queue_minute_ai_index_scope_change(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.queue_minute_ai_index_scope_change(
  uuid, uuid, text, timestamptz
) to service_role;

-- lease 만료 뒤에도 살아 있는 구세대 색인 worker가 tombstone 이후 문서를 쓰는 마지막
-- 경합은 queue CAS만으로 막을 수 없다. 실제 ai_documents write 시점에 원본 회의록의
-- 현재 project/archive scope를 다시 검증해 stale scope 쓰기 자체를 원자 거부한다.
create or replace function public.guard_minute_ai_document_scope()
returns trigger
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_minute_project_id uuid;
  v_archived_at timestamptz;
begin
  if new.domain <> 'minutes' or new.entity_type <> 'minute' then
    return new;
  end if;
  if new.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'AI_MINUTE_DOCUMENT_ENTITY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
  into v_minute_project_id, v_archived_at
  from public.minutes minute
  where minute.id = new.entity_id::uuid
  -- UPDATE/UPSERT가 ai_documents row를 먼저 잠근 상태에서 metadata/archive가 반대로
  -- minute→document를 잠글 수 있으므로 기다리지 않고 worker 재시도로 넘긴다.
  for share nowait;
  if not found
     or v_archived_at is not null
     or v_minute_project_id is distinct from new.project_id then
    raise exception 'AI_MINUTE_DOCUMENT_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists ai_documents_minute_scope_guard_trg on public.ai_documents;
create trigger ai_documents_minute_scope_guard_trg
before insert or update on public.ai_documents
for each row execute function public.guard_minute_ai_document_scope();

-- 프로젝트별 1행 orchestration queue. 철회와 동일 트랜잭션에는 이 얇은 요청만 남기고,
-- 0046의 keyset step worker가 활성 회의록을 한 건씩 시간순으로 기존 minute queue에
-- 연결한다. 따라서 회의록 수와 serverless 실행시간에 무관하게 중단 지점부터 재개된다.
create table if not exists public.wiki_project_rebuild_jobs (
  project_id                uuid primary key references public.projects(id) on delete cascade,
  status                    text not null default 'pending'
                              check (status in ('pending','running','done','dead_letter')),
  generation                bigint not null default 1 check (generation > 0),
  reset_generation          bigint,
  rerun_requested           boolean not null default false,
  cursor_observed_sort      timestamp,
  cursor_minute_id          uuid,
  step_observed_sort        timestamp,
  step_minute_id            uuid,
  step_minute_version_id    uuid,
  step_rebuild_generation   bigint,
  step_wiki_job_id          bigint,
  step_wiki_apply_generation integer,
  attempts                  integer not null default 0 check (attempts >= 0),
  max_attempts              integer not null default 5 check (max_attempts > 0),
  run_after                 timestamptz not null default now(),
  locked_at                 timestamptz,
  locked_by                 text,
  last_error                text,
  reason                    text not null default '프로젝트 Wiki 재구성',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint wiki_project_rebuild_cursor_pair check (
    (cursor_observed_sort is null and cursor_minute_id is null)
    or (cursor_observed_sort is not null and cursor_minute_id is not null)
  ),
  constraint wiki_project_rebuild_step_bundle check (
    (
      step_observed_sort is null
      and step_minute_id is null
      and step_minute_version_id is null
      and step_rebuild_generation is null
      and step_wiki_job_id is null
      and step_wiki_apply_generation is null
    )
    or (
      step_observed_sort is not null
      and step_minute_id is not null
      and step_minute_version_id is not null
      and step_rebuild_generation is not null
      and step_wiki_job_id is not null
      and step_wiki_apply_generation is not null
    )
  )
);

alter table public.wiki_project_rebuild_jobs
  add column if not exists reset_generation bigint;

create index if not exists wiki_project_rebuild_jobs_claim_idx
  on public.wiki_project_rebuild_jobs (status, run_after, updated_at);

create or replace function public.request_wiki_project_rebuild(
  p_project_id uuid,
  p_reason text default '프로젝트 Wiki 재구성'
) returns bigint
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_generation bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_project_id is null then
    return null;
  end if;

  insert into public.wiki_project_rebuild_jobs as rebuild (
    project_id, status, generation, rerun_requested,
    cursor_observed_sort, cursor_minute_id,
    step_observed_sort, step_minute_id, step_minute_version_id,
    step_rebuild_generation, step_wiki_job_id, step_wiki_apply_generation,
    attempts, run_after, locked_at, locked_by, last_error, reason, updated_at
  ) values (
    p_project_id, 'pending', 1, false,
    null, null, null, null, null, null, null, null,
    0, v_now, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), '프로젝트 Wiki 재구성'),
    v_now
  )
  on conflict (project_id) do update set
    generation = rebuild.generation + 1,
    rerun_requested = case when rebuild.status = 'running' then true else false end,
    status = case when rebuild.status = 'running' then 'running' else 'pending' end,
    cursor_observed_sort = case
      when rebuild.status = 'running' then rebuild.cursor_observed_sort else null
    end,
    cursor_minute_id = case
      when rebuild.status = 'running' then rebuild.cursor_minute_id else null
    end,
    step_observed_sort = case
      when rebuild.status = 'running' then rebuild.step_observed_sort else null
    end,
    step_minute_id = case
      when rebuild.status = 'running' then rebuild.step_minute_id else null
    end,
    step_minute_version_id = case
      when rebuild.status = 'running' then rebuild.step_minute_version_id else null
    end,
    step_rebuild_generation = case
      when rebuild.status = 'running' then rebuild.step_rebuild_generation else null
    end,
    step_wiki_job_id = case
      when rebuild.status = 'running' then rebuild.step_wiki_job_id else null
    end,
    step_wiki_apply_generation = case
      when rebuild.status = 'running' then rebuild.step_wiki_apply_generation else null
    end,
    attempts = case when rebuild.status = 'running' then rebuild.attempts else 0 end,
    run_after = case when rebuild.status = 'running' then rebuild.run_after else v_now end,
    locked_at = case when rebuild.status = 'running' then rebuild.locked_at else null end,
    locked_by = case when rebuild.status = 'running' then rebuild.locked_by else null end,
    last_error = null,
    reason = excluded.reason,
    updated_at = v_now
  returning rebuild.generation into v_generation;

  return v_generation;
end
$$;

revoke all on function public.request_wiki_project_rebuild(uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_wiki_project_rebuild(uuid, text)
  to service_role;

-- 시간축 끝에 추가된 새 회의록은 current AI 상태를 reset하지 않고 기존 cursor 뒤에
-- 이어 붙인다. pending/running full rebuild가 이미 있으면 그 세대와 reset 요구를 그대로
-- 보존하고, done job만 cursor를 유지한 채 다시 pending으로 연다.
create or replace function public.request_wiki_project_append(
  p_project_id uuid,
  p_reason text default '프로젝트 Wiki 시간순 추가'
) returns bigint
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_generation bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_project_id is null then
    return null;
  end if;

  insert into public.wiki_project_rebuild_jobs as append_job (
    project_id, status, generation, reset_generation, rerun_requested,
    cursor_observed_sort, cursor_minute_id,
    step_observed_sort, step_minute_id, step_minute_version_id,
    step_rebuild_generation, step_wiki_job_id, step_wiki_apply_generation,
    attempts, run_after, locked_at, locked_by, last_error, reason, updated_at
  ) values (
    p_project_id, 'pending', 1, 1, false,
    null, null, null, null, null, null, null, null,
    0, v_now, null, null, null,
    coalesce(nullif(btrim(p_reason), ''), '프로젝트 Wiki 시간순 추가'),
    v_now
  )
  on conflict (project_id) do update set
    status = case
      when append_job.status = 'running' then 'running' else 'pending'
    end,
    -- full rebuild 도중 들어온 forward append는 generation/rerun/cursor/step을 건드리지
    -- 않는다. 현재 세대의 keyset이 마지막에 새 회의록을 자연스럽게 선택한다.
    attempts = case when append_job.status = 'running' then append_job.attempts else 0 end,
    run_after = case when append_job.status = 'running' then append_job.run_after else v_now end,
    locked_at = case when append_job.status = 'running' then append_job.locked_at else null end,
    locked_by = case when append_job.status = 'running' then append_job.locked_by else null end,
    last_error = null,
    reason = excluded.reason,
    updated_at = v_now
  returning append_job.generation into v_generation;

  -- poison step 때문에 project와 bound minute job이 함께 dead-letter였던 경우, 새 forward
  -- append가 project row만 깨워 같은 죽은 step을 반복하지 않도록 bound job도 같은
  -- apply generation에서 재시도 가능하게 연다. 이미 커밋된 item은 idempotency key로 재사용된다.
  update public.wiki_processing_jobs job
  set status = 'pending',
      attempts = 0,
      run_after = v_now,
      locked_at = null,
      locked_by = null,
      last_error = null,
      updated_at = v_now
  where job.id = (
      select append_job.step_wiki_job_id
      from public.wiki_project_rebuild_jobs append_job
      where append_job.project_id = p_project_id
    )
    and job.status = 'dead_letter';

  return v_generation;
end
$$;

revoke all on function public.request_wiki_project_append(uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_wiki_project_append(uuid, text)
  to service_role;

-- 배포 이전에 존재하던 프로젝트 회의록도 새 Wiki에 최초 반영한다. 이미 운영 중인
-- 프로젝트 job은 건드리지 않아 migration 재실행이 진행 cursor를 되돌리지 않는다.
insert into public.wiki_project_rebuild_jobs (
  project_id, status, generation, reason
)
select distinct
  minute.project_id,
  'pending',
  1,
  '기존 회의록 프로젝트 Wiki 최초 구성'
from public.minutes minute
where minute.project_id is not null
  and minute.archived_at is null
on conflict (project_id) do nothing;

-- ── 8) 근거 철회 + 원자 회의록 쓰기 RPC ──
-- 일반 사용자의 minutes 직접 쓰기를 닫기 전에, 모든 정상 쓰기 경로를 service-role 전용 함수로
-- 제공한다. 함수 하나의 실행은 PostgreSQL 트랜잭션 하나이므로 반쪽 minute/version/file/wiki
-- 상태가 커밋되지 않는다.

-- 한 회의록에서 파생된 활성 근거를 soft-retract한다. refine/reverse/supersede는 source 하나만
-- 떼어서는 이전 상태를 안전하게 역산할 수 없으므로, 대상 source가 붙은 AI 항목은 남은 근거
-- 유무와 무관하게 archived로 닫는다. manual/locked 항목은 보존하고 별도 rebuild가 current를 재구성한다.
create or replace function public.retract_minute_wiki_sources(
  p_minute_id uuid,
  p_reason text default '회의록 근거 철회'
) returns table (
  retracted_source_count integer,
  archived_item_count integer,
  change_event_count integer
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_reason text := coalesce(nullif(btrim(p_reason), ''), '회의록 근거 철회');
  v_item_ids uuid[];
  v_item_id uuid;
  v_before public.wiki_items%rowtype;
  v_after public.wiki_items%rowtype;
  v_source_id uuid;
  v_version_id uuid;
  v_body_hash text;
  v_block_index integer;
  v_block_hash text;
  v_project_id uuid;
begin
  select mi.project_id into v_project_id
  from public.minutes mi
  where mi.id = p_minute_id;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- project rebuild row를 Wiki item/source보다 먼저 잠근다. rebuild reset과 같은
  -- 순서를 사용하므로 철회가 item을 잡은 채 project claim을 기다리는 역순 deadlock을
  -- 만들지 않는다. 철회와 durable 복구 요청도 여전히 한 트랜잭션이다.
  perform public.request_wiki_project_rebuild(v_project_id, v_reason);

  select coalesce(array_agg(distinct wis.wiki_item_id), '{}'::uuid[])
  into v_item_ids
  from public.wiki_item_sources wis
  where wis.minute_id = p_minute_id
    and wis.retracted_at is null;

  update public.wiki_item_sources wis
  set retracted_at = v_now,
      retraction_reason = v_reason
  where wis.minute_id = p_minute_id
    and wis.retracted_at is null;
  get diagnostics retracted_source_count = row_count;

  archived_item_count := 0;
  change_event_count := 0;

  foreach v_item_id in array v_item_ids loop
    select wi.* into v_before
    from public.wiki_items wi
    where wi.id = v_item_id
    for update;

    if found
       and v_before.origin = 'ai'
       and v_before.lifecycle_state <> 'archived'
       and not v_before.auto_update_locked then
      -- 이 철회를 대표하는 정확한 source를 골라 event trigger가 provenance를 복제하게 한다.
      select wis.id, wis.minute_version_id, wis.body_hash, wis.block_index, wis.block_hash
      into v_source_id, v_version_id, v_body_hash, v_block_index, v_block_hash
      from public.wiki_item_sources wis
      where wis.wiki_item_id = v_item_id
        and wis.minute_id = p_minute_id
        and wis.retracted_at = v_now
      order by wis.created_at desc, wis.id desc
      limit 1;

      update public.wiki_items wi
      set lifecycle_state = 'archived',
          updated_at = v_now
      where wi.id = v_item_id
      returning wi.* into v_after;

      insert into public.wiki_change_events (
        project_id, wiki_item_id, minute_id, source_id,
        minute_version_id, source_body_hash, source_block_index, source_block_hash,
        change_type, before_snapshot, after_snapshot, reason, created_at
      ) values (
        v_before.project_id, v_item_id, p_minute_id, v_source_id,
        v_version_id, v_body_hash, v_block_index, v_block_hash,
        'retract', to_jsonb(v_before), to_jsonb(v_after), v_reason, v_now
      );

      archived_item_count := archived_item_count + 1;
      change_event_count := change_event_count + 1;

      update public.wiki_topics wt
      set last_changed_at = v_now,
          updated_at = v_now
      where wt.id = v_before.topic_id;
    end if;
  end loop;

  return next;
end
$$;

revoke all on function public.retract_minute_wiki_sources(uuid, text)
  from public, anon, authenticated;
grant execute on function public.retract_minute_wiki_sources(uuid, text)
  to service_role;

-- 메타데이터 갱신 공용 RPC. JSON key 부재=유지, key의 JSON null=해제다.
-- project가 바뀌면 이전 프로젝트에서 파생된 근거 철회와 미완료 job 정리까지 같은 트랜잭션이다.
-- 이전 commit 함수가 metadata 함수의 row type에 의존하므로 return 열 변경 전에 먼저 제거한다.
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text, jsonb
);
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text
);
drop function if exists public.update_minute_metadata_with_wiki_retraction(uuid, jsonb);

create or replace function public.update_minute_metadata_with_wiki_retraction(
  p_minute_id uuid,
  p_metadata jsonb
) returns table (
  old_project_id uuid,
  new_project_id uuid,
  updated_at timestamptz,
  wiki_rebuild_required boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_meeting_project_id uuid;
  v_index_project_id uuid;
  v_lock_project_id uuid;
  v_chronology_changed boolean := false;
  v_index_content_changed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_metadata) as metadata_key(key_name)
    where key_name not in (
      'minute_date', 'team_code', 'title', 'meeting_id',
      'project_id', 'meeting_occurrence_date', 'folder_id'
    )
  ) then
    raise exception 'MINUTE_METADATA_KEY_NOT_ALLOWED' using errcode = '22023';
  end if;

  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute.archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  v_original_minute := v_minute;

  old_project_id := v_minute.project_id;

  if v_metadata ? 'minute_date' then
    v_minute.minute_date := nullif(v_metadata->>'minute_date', '')::date;
  end if;
  if v_metadata ? 'team_code' then
    v_minute.team_code := nullif(btrim(v_metadata->>'team_code'), '');
  end if;
  if v_metadata ? 'title' then
    v_minute.title := nullif(btrim(v_metadata->>'title'), '');
  end if;
  if v_metadata ? 'meeting_id' then
    v_minute.meeting_id := nullif(v_metadata->>'meeting_id', '')::uuid;
  end if;
  if v_metadata ? 'project_id' then
    v_minute.project_id := nullif(v_metadata->>'project_id', '')::uuid;
  end if;
  if v_metadata ? 'meeting_occurrence_date' then
    v_minute.meeting_occurrence_date :=
      nullif(v_metadata->>'meeting_occurrence_date', '')::date;
  end if;
  if v_metadata ? 'folder_id' then
    v_minute.folder_id := nullif(v_metadata->>'folder_id', '')::uuid;
  end if;

  if v_minute.minute_date is null
     or v_minute.team_code is null
     or v_minute.title is null
     or char_length(v_minute.title) > 200 then
    raise exception 'MINUTE_METADATA_REQUIRED' using errcode = '23502';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = v_minute.team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_minute.meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = v_minute.meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_minute.project_id is null then
      v_minute.project_id := v_meeting_project_id;
    elsif v_minute.project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    if (v_metadata ? 'meeting_id') and not (v_metadata ? 'meeting_occurrence_date') then
      v_minute.meeting_occurrence_date := v_minute.minute_date;
    end if;
  else
    v_minute.meeting_occurrence_date := null;
  end if;

  new_project_id := v_minute.project_id;
  v_chronology_changed :=
    old_project_id is not distinct from new_project_id
    and (
      v_original_minute.minute_date is distinct from v_minute.minute_date
      or v_original_minute.meeting_occurrence_date
         is distinct from v_minute.meeting_occurrence_date
    );
  v_index_content_changed :=
    v_original_minute.title is distinct from v_minute.title
    or v_original_minute.team_code is distinct from v_minute.team_code
    or v_original_minute.minute_date is distinct from v_minute.minute_date
    or v_original_minute.meeting_occurrence_date
       is distinct from v_minute.meeting_occurrence_date
    or old_project_id is distinct from new_project_id;

  if old_project_id is distinct from new_project_id or v_chronology_changed then
    -- A→B와 B→A 이동이 동시에 실행돼도 두 project rebuild row를 항상 UUID 오름차순으로
    -- 먼저 확보한다. 이후 retract(old)→request(new)가 역순 row lock cycle을 만들지 않는다.
    for v_lock_project_id in
      select scope.project_id
      from (
        select old_project_id as project_id
        union
        select new_project_id as project_id
      ) scope
      where scope.project_id is not null
      order by scope.project_id
    loop
      insert into public.wiki_project_rebuild_jobs (
        project_id, status, generation, reason
      ) values (
        v_lock_project_id, 'pending', 1, '회의록 메타데이터 변경 준비'
      )
      on conflict (project_id) do nothing;

      perform 1
      from public.wiki_project_rebuild_jobs rebuild
      where rebuild.project_id = v_lock_project_id
      for update;
    end loop;

    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      case
        when old_project_id is distinct from new_project_id
          then '회의록 프로젝트 재귀속으로 기존 Wiki 근거를 철회했습니다.'
        else '회의록 시간축 변경으로 기존 Wiki 근거를 철회했습니다.'
      end
    );
    update public.wiki_processing_jobs job
    set status = 'done',
        locked_at = null,
        locked_by = null,
        last_error = null,
        payload = job.payload || jsonb_build_object(
          'retracted',
          true,
          'reason',
          case
            when old_project_id is distinct from new_project_id
              then 'project_reassigned'
            else 'chronology_changed'
          end
        ),
        updated_at = v_now
    where job.minute_id = p_minute_id
      and job.project_id is not distinct from old_project_id
      and job.status <> 'done';
  end if;

  update public.minutes mi
  set minute_date = v_minute.minute_date,
      team_code = v_minute.team_code,
      title = v_minute.title,
      meeting_id = v_minute.meeting_id,
      project_id = v_minute.project_id,
      meeting_occurrence_date = v_minute.meeting_occurrence_date,
      folder_id = v_minute.folder_id,
      updated_at = v_now
  where mi.id = p_minute_id;

  if old_project_id is distinct from new_project_id then
    -- 검색 문서도 현재 scope와 함께 움직인다. 모든 기존 scope의 파생 문서를 먼저
    -- 제거하고, 과거 scope에는 CAS-safe delete tombstone을, 새 scope에는 upsert를
    -- 남겨 실행 중이던 구세대 worker가 뒤늦게 끝나도 최종 상태가 다시 수렴하게 한다.
    delete from public.ai_documents
    where domain = 'minutes'
      and entity_type = 'minute'
      and entity_id = p_minute_id::text;

    for v_index_project_id in
      select distinct scope.project_id
      from (
        select job.project_id
        from public.ai_index_jobs job
        where job.domain = 'minutes'
          and job.entity_type = 'minute'
          and job.entity_id = p_minute_id::text
        union all
        select old_project_id
      ) scope
    loop
      perform public.queue_minute_ai_index_scope_change(
        v_index_project_id,
        p_minute_id,
        'delete',
        v_now
      );
    end loop;

    -- project_id NULL도 검색 계층의 명시적 global scope다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );

    -- old 프로젝트 요청은 위 retract가 이미 같은 트랜잭션에 남겼다. update 뒤에는
    -- 새 scope도 별도 generation으로 요청해 이동한 회의록을 최신 버전으로 포함한다.
    perform public.request_wiki_project_rebuild(
      new_project_id,
      '회의록 프로젝트 재귀속 후 새 프로젝트 Wiki 재구성'
    );
  elsif v_index_content_changed then
    -- 같은 scope의 제목/팀/일자 변경은 stable key를 유지한 채 검색 문서를 교체한다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );
  end if;

  updated_at := v_now;
  wiki_rebuild_required :=
    old_project_id is distinct from new_project_id or v_chronology_changed;
  return next;
end
$$;

revoke all on function public.update_minute_metadata_with_wiki_retraction(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_minute_metadata_with_wiki_retraction(uuid, jsonb)
  to service_role;

-- 회의록 + v1 + 선택적 현재 body 파일 포인터를 원자 생성한다.
-- backdated rebuild OUT 열이 추가된 개발 초안을 재실행해도 return type 충돌 없이 수렴한다.
drop function if exists public.create_minute_with_version(
  uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text,
  text, text, bigint, text
);

create or replace function public.create_minute_with_version(
  p_minute_id uuid,
  p_minute_date date,
  p_team_code text,
  p_title text,
  p_body_md text,
  p_body_hash text,
  p_meeting_id uuid,
  p_project_id uuid,
  p_meeting_occurrence_date date,
  p_folder_id uuid,
  p_external_id text,
  p_actor_id uuid,
  p_actor_name text,
  p_file_name text default null,
  p_file_path text default null,
  p_file_size bigint default null,
  p_file_mime text default null
) returns table (
  minute_id uuid,
  version_id uuid,
  version_no integer,
  body_hash text,
  created_at timestamptz,
  updated_at timestamptz,
  wiki_rebuild_required boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_minute_id uuid := coalesce(p_minute_id, gen_random_uuid());
  v_project_id uuid := p_project_id;
  v_occurrence_date date := p_meeting_occurrence_date;
  v_meeting_project_id uuid;
  v_created_at timestamptz;
  v_reset_required boolean := false;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
begin
  if p_minute_date is null
     or nullif(btrim(p_team_code), '') is null
     or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 200
     or p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_CREATE_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_external_id is not null
     and (p_external_id = '' or char_length(p_external_id) > 128) then
    raise exception 'MINUTE_EXTERNAL_ID_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (v_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = p_meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_project_id is null then
      v_project_id := v_meeting_project_id;
    elsif v_project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    v_occurrence_date := coalesce(v_occurrence_date, p_minute_date);
  else
    v_occurrence_date := null;
  end if;

  if v_project_id is not null then
    -- 같은 프로젝트의 동시 생성도 commit 순서와 시간축 판정을 일치시킨다.
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wiki-project-chronology:' || v_project_id::text, 0)
    );
  end if;
  -- advisory lock을 얻은 뒤 시각을 고정해 같은 프로젝트 동시 생성의 observed_sort와
  -- commit 순서가 어긋나지 않게 한다.
  v_created_at := clock_timestamp();

  -- 프로젝트 회의록은 생성 순서와 after()/cron 실행 순서가 다를 수 있다. 개별 job을
  -- 즉시 적용하지 않고 durable project keyset queue로 보낸다. 기존 시간축 끝보다 앞에
  -- 삽입되는 경우만 full reset하고, 정상 forward append는 완료 cursor 뒤에 이어 붙인다.
  wiki_rebuild_required := v_project_id is not null;
  if v_project_id is not null then
    v_reset_required := exists (
      select 1
      from public.minutes existing
      where existing.project_id = v_project_id
        and existing.archived_at is null
        and (
          (
            coalesce(existing.meeting_occurrence_date, existing.minute_date)::timestamp
            + (existing.created_at at time zone 'UTC')::time
          ),
          existing.id
        ) > (
          (
            coalesce(v_occurrence_date, p_minute_date)::timestamp
            + (v_created_at at time zone 'UTC')::time
          ),
          v_minute_id
        )
    );
  end if;

  insert into public.minutes as new_minute (
    id, minute_date, team_code, title, body_md,
    meeting_id, project_id, meeting_occurrence_date, folder_id, external_id,
    created_by, created_by_name, created_at, updated_at
  ) values (
    v_minute_id, p_minute_date, p_team_code, btrim(p_title), p_body_md,
    p_meeting_id, v_project_id, v_occurrence_date, p_folder_id, p_external_id,
    p_actor_id, p_actor_name, v_created_at, v_created_at
  )
  returning new_minute.id, new_minute.created_at, new_minute.updated_at
  into minute_id, created_at, updated_at;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name, created_at
  ) values (
    v_minute_id, 1, p_body_md, p_body_hash,
    btrim(p_title), p_minute_date, p_team_code, v_project_id, p_meeting_id, v_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name, v_created_at
  )
  returning new_version.id into version_id;

  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      v_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  if wiki_rebuild_required then
    if v_reset_required then
      perform public.request_wiki_project_rebuild(
        v_project_id,
        '과거 시점 회의록 추가 후 프로젝트 Wiki 전체 재구성'
      );
    else
      perform public.request_wiki_project_append(
        v_project_id,
        '새 회의록 프로젝트 Wiki 시간순 추가'
      );
    end if;
  end if;

  version_no := 1;
  body_hash := p_body_hash;
  return next;
end
$$;

revoke all on function public.create_minute_with_version(
  uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text,
  text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.create_minute_with_version(
  uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text,
  text, text, bigint, text
) to service_role;

-- 이전 0045 초안의 9-인자 overload가 남아 PostgREST 함수 선택을 모호하게 만들지 않게 제거한다.
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text
);
-- OUT 열(wiki_rebuild_required)이 추가된 개발 초안을 재실행해도 return type 충돌 없이 수렴한다.
drop function if exists public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text, jsonb
);

-- Storage 업로드는 DB 트랜잭션 밖에서 선행할 수 있지만, 기존 current snapshot 보존부터
-- 새 version/current pointer/metadata 갱신까지는 모두 한 트랜잭션으로 커밋한다.
create or replace function public.commit_minute_body_version(
  p_minute_id uuid,
  p_body_md text,
  p_body_hash text,
  p_file_name text,
  p_file_path text,
  p_file_size bigint,
  p_file_mime text,
  p_actor_id uuid,
  p_actor_name text,
  p_metadata jsonb default '{}'::jsonb
) returns table (
  version_id uuid,
  version_no integer,
  body_hash text,
  wiki_rebuild_required boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_latest_hash text;
  v_current_hash text;
  v_body_changed boolean := false;
  v_next_version integer;
  v_metadata_rebuild_required boolean := false;
  v_snapshot_created_at timestamptz;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
  v_current_file public.minute_files%rowtype;
begin
  if p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_VERSION_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (p_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute.archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  v_original_minute := v_minute;
  v_snapshot_created_at := v_minute.updated_at;

  -- 메타 갱신(프로젝트 변경 시 Wiki 철회 포함)은 같은 outer transaction 안에서 실행된다.
  if coalesce(p_metadata, '{}'::jsonb) <> '{}'::jsonb then
    select metadata_result.wiki_rebuild_required
    into v_metadata_rebuild_required
    from public.update_minute_metadata_with_wiki_retraction(
      p_minute_id,
      p_metadata
    ) metadata_result;
    select mi.* into v_minute
    from public.minutes mi
    where mi.id = p_minute_id;
  elsif p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;

  v_current_hash := public.wiki_fnv1a64(v_original_minute.body_md);
  v_body_changed := v_current_hash is distinct from p_body_hash;
  wiki_rebuild_required :=
    v_metadata_rebuild_required
    or v_body_changed;
  if v_body_changed then
    -- 새 본문에서 삭제된 문장이 과거 source 때문에 현재 지식으로 남지 않도록,
    -- 이전 버전의 활성 근거를 새 버전 append와 같은 트랜잭션에서 먼저 철회한다.
    -- 공유 근거/변경 관계를 섣불리 역산하지 않고 영향 항목을 보수적으로 archive한 뒤,
    -- 호출자가 프로젝트의 활성 최신 버전을 시간순으로 재처리해 current를 복원한다.
    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      '회의록 본문 새 버전으로 이전 Wiki 근거를 철회했습니다.'
    );
  end if;

  select mv.body_hash
  into v_latest_hash
  from public.minute_versions mv
  where mv.minute_id = p_minute_id
  order by mv.version_no desc
  limit 1;

  select coalesce(max(mv.version_no), 0) + 1
  into v_next_version
  from public.minute_versions mv
  where mv.minute_id = p_minute_id;

  -- 버전이 있더라도 current body가 latest와 다르면 과거 직접 UPDATE/부분 실패 흔적이다.
  -- 새 본문을 쓰기 전에 현재 포인터의 파일 메타와 함께 별도 snapshot으로 먼저 보존한다.
  if v_latest_hash is null or v_latest_hash is distinct from v_current_hash then
    select mf.* into v_current_file
    from public.minute_files mf
    where mf.minute_id = p_minute_id and mf.role = 'body'
    order by mf.created_at desc, mf.id desc
    limit 1;

    insert into public.minute_versions (
      minute_id, version_no, body_md, body_hash,
      title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
      file_name, file_path, file_size, file_mime,
      created_by, created_by_name, created_at
    ) values (
      p_minute_id, v_next_version, v_original_minute.body_md, v_current_hash,
      v_original_minute.title, v_original_minute.minute_date, v_original_minute.team_code,
      v_original_minute.project_id, v_original_minute.meeting_id,
      v_original_minute.meeting_occurrence_date,
      v_current_file.file_name, v_current_file.file_path, v_current_file.size, v_current_file.mime,
      v_original_minute.created_by, v_original_minute.created_by_name,
      coalesce(v_snapshot_created_at, now())
    );
    v_next_version := v_next_version + 1;
  end if;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name
  ) values (
    p_minute_id, v_next_version, p_body_md, p_body_hash,
    v_minute.title, v_minute.minute_date, v_minute.team_code,
    v_minute.project_id, v_minute.meeting_id, v_minute.meeting_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name
  )
  returning new_version.id into version_id;

  -- minute_files.body는 current pointer다. 파일 없는 external replace도 이전 포인터를 명시적으로 뺀다.
  delete from public.minute_files
  where minute_id = p_minute_id and role = 'body';
  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      p_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  update public.minutes
  set body_md = p_body_md, updated_at = clock_timestamp()
  where id = p_minute_id;

  version_no := v_next_version;
  body_hash := p_body_hash;
  return next;
end
$$;

revoke all on function public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.commit_minute_body_version(
  uuid, text, text, text, text, bigint, text, uuid, text, jsonb
) to service_role;

-- 삭제 대신 archive한다. 원본 minutes/minute_versions/Storage는 유지하고 Wiki 근거만 철회한다.
create or replace function public.archive_minute_with_wiki_retraction(
  p_minute_id uuid,
  p_reason text default '회의록 보관 처리'
) returns table (
  archived_at timestamptz,
  retracted_source_count integer,
  archived_item_count integer,
  change_event_count integer
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_minute public.minutes%rowtype;
  v_now timestamptz := clock_timestamp();
  v_counts record;
  v_index_project_id uuid;
begin
  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select r.* into v_counts
  from public.retract_minute_wiki_sources(
    p_minute_id,
    coalesce(nullif(btrim(p_reason), ''), '회의록 보관 처리')
  ) r;

  update public.minutes mi
  set archived_at = coalesce(mi.archived_at, v_now),
      share_enabled = false,
      updated_at = v_now
  where mi.id = p_minute_id
  returning mi.archived_at into archived_at;

  update public.wiki_processing_jobs job
  set status = 'done',
      locked_at = null,
      locked_by = null,
      last_error = null,
      payload = job.payload || jsonb_build_object('archived', true),
      updated_at = v_now
  where job.minute_id = p_minute_id
    and job.status <> 'done';

  -- 원본/버전/파일은 보존하되 검색·챗용 파생 벡터/문서는 즉시 제거한다.
  delete from public.minute_embeddings
  where minute_id = p_minute_id;

  delete from public.ai_documents
  where domain = 'minutes'
    and entity_type = 'minute'
    and entity_id = p_minute_id::text;

  -- 현재 scope뿐 아니라 과거 프로젝트 이동 흔적의 모든 scope에 CAS-safe tombstone을
  -- 남긴다. 실행 중인 구세대 upsert는 lease를 유지한 채 generation mismatch로
  -- 재실행되어 최종 delete로 수렴한다.
  for v_index_project_id in
    select distinct scope.project_id
    from (
      select job.project_id
      from public.ai_index_jobs job
      where job.domain = 'minutes'
        and job.entity_type = 'minute'
        and job.entity_id = p_minute_id::text
      union all
      select v_minute.project_id
    ) scope
  loop
    perform public.queue_minute_ai_index_scope_change(
      v_index_project_id,
      p_minute_id,
      'delete',
      v_now
    );
  end loop;

  retracted_source_count := coalesce(v_counts.retracted_source_count, 0);
  archived_item_count := coalesce(v_counts.archived_item_count, 0);
  change_event_count := coalesce(v_counts.change_event_count, 0);
  return next;
end
$$;

revoke all on function public.archive_minute_with_wiki_retraction(uuid, text)
  from public, anon, authenticated;
grant execute on function public.archive_minute_with_wiki_retraction(uuid, text)
  to service_role;

-- ── 9) RLS + 최소 권한 ──
alter table public.minute_versions       enable row level security;
alter table public.wiki_topics          enable row level security;
alter table public.wiki_items           enable row level security;
alter table public.wiki_item_sources    enable row level security;
alter table public.wiki_item_relations  enable row level security;
alter table public.wiki_change_events   enable row level security;
alter table public.wiki_processing_jobs enable row level security;
alter table public.wiki_project_rebuild_jobs enable row level security;

-- minutes 원본 행의 직접 INSERT/UPDATE/DELETE를 닫는다. 소유권 검사는 서버 액션에서 하고,
-- 실제 쓰기는 위 service-role RPC만 수행해야 version/wiki 철회와 원자성을 우회할 수 없다.
drop policy if exists insert_own_minutes on public.minutes;
drop policy if exists update_own_minutes on public.minutes;
drop policy if exists delete_own_minutes on public.minutes;
revoke all on table public.minutes from public, anon, authenticated;
grant select on table public.minutes to authenticated;
grant all on table public.minutes to service_role;

-- minute_files의 body 행은 create/commit RPC만 쓴다. 사용자는 attachment 행만 부모 소유권
-- 범위에서 추가·수정·삭제할 수 있고 role을 body로 바꿀 수도 없다.
drop policy if exists own_write_minute_files on public.minute_files;
drop policy if exists attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files
  for insert to authenticated
  with check (
    role = 'attachment'
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and mi.archived_at is null
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  );
drop policy if exists attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files
  for update to authenticated
  using (
    role = 'attachment'
    and exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and mi.archived_at is null
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  )
  with check (
    role = 'attachment'
    and exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and mi.archived_at is null
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  );
drop policy if exists attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files
  for delete to authenticated
  using (
    role = 'attachment'
    and exists (
      select 1 from public.minutes mi
      where mi.id = minute_id
        and mi.archived_at is null
        and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  );
revoke all on table public.minute_files from public, anon, authenticated;
grant select, insert, update, delete on table public.minute_files to authenticated;
grant all on table public.minute_files to service_role;

-- 회의록 버전: 인증 사용자 전체 읽기. 쓰기는 검증된 서버 액션/RPC의 service_role만 수행한다.
-- authenticated INSERT를 열면 REST 직접 호출로 임의 version_no/body_hash/file_path를 주입할 수 있다.
drop policy if exists minute_versions_read on public.minute_versions;
create policy minute_versions_read on public.minute_versions
  for select to authenticated using (true);
drop policy if exists minute_versions_owner_insert on public.minute_versions;

-- 자동 Wiki 산출물: 앱 사용자에게는 읽기만. 쓰기 정책 없음 = service_role 전용.
drop policy if exists wiki_topics_read on public.wiki_topics;
create policy wiki_topics_read on public.wiki_topics
  for select to authenticated using (true);
drop policy if exists wiki_items_read on public.wiki_items;
create policy wiki_items_read on public.wiki_items
  for select to authenticated using (true);
drop policy if exists wiki_item_sources_read on public.wiki_item_sources;
create policy wiki_item_sources_read on public.wiki_item_sources
  for select to authenticated using (true);
drop policy if exists wiki_item_relations_read on public.wiki_item_relations;
create policy wiki_item_relations_read on public.wiki_item_relations
  for select to authenticated using (true);
drop policy if exists wiki_change_events_read on public.wiki_change_events;
create policy wiki_change_events_read on public.wiki_change_events
  for select to authenticated using (true);

revoke all on table public.minute_versions from public, anon, authenticated;
grant select on table public.minute_versions to authenticated;
grant all on table public.minute_versions to service_role;

revoke all on table public.wiki_topics from public, anon, authenticated;
revoke all on table public.wiki_items from public, anon, authenticated;
revoke all on table public.wiki_item_sources from public, anon, authenticated;
revoke all on table public.wiki_item_relations from public, anon, authenticated;
revoke all on table public.wiki_change_events from public, anon, authenticated;
grant select on table public.wiki_topics to authenticated;
grant select on table public.wiki_items to authenticated;
grant select on table public.wiki_item_sources to authenticated;
grant select on table public.wiki_item_relations to authenticated;
grant select on table public.wiki_change_events to authenticated;
grant all on table public.wiki_topics to service_role;
grant all on table public.wiki_items to service_role;
grant all on table public.wiki_item_sources to service_role;
grant all on table public.wiki_item_relations to service_role;
grant all on table public.wiki_change_events to service_role;

-- 내부 큐는 0031 ai_index_jobs 관례대로 authenticated SELECT 도 열지 않는다.
revoke all on table public.wiki_processing_jobs from public, anon, authenticated;
grant all on table public.wiki_processing_jobs to service_role;
revoke all on table public.wiki_project_rebuild_jobs from public, anon, authenticated;
grant all on table public.wiki_project_rebuild_jobs to service_role;

do $$
declare
  v_sequence text;
begin
  v_sequence := pg_get_serial_sequence('public.wiki_processing_jobs', 'id');
  if v_sequence is not null then
    execute format(
      'revoke all on sequence %s from public, anon, authenticated',
      v_sequence::regclass
    );
    execute format(
      'grant usage, select on sequence %s to service_role',
      v_sequence::regclass
    );
  end if;
end $$;

reset search_path;
