-- 회의록 블록 → 이슈 원문 연결.
--
-- 핵심 계약
--   1) issue_links 는 현재 minute_block 링크만 저장한다. 향후 다른 출처 타입은 별도
--      마이그레이션에서 CHECK/nullable FK 계약을 함께 확장한다.
--   2) 이슈와 담당자와 원문 링크는 service_role 전용
--      create_issue_from_minute_block RPC 한 트랜잭션에서 만든다.
--   3) 제목/일자/버전 번호/body_hash 는 클라이언트 입력을 신뢰하지 않고 불변
--      minute_versions 행에서 스냅샷한다.
--   4) manual 링크는 같은 블록에서 여러 이슈를 만들 수 있으므로 source_key 는 조회
--      인덱스만 두고 UNIQUE 로 강제하지 않는다.
--   5) source_project_id 는 링크 대상 프로젝트가 아니라 해당 과거 버전의 프로젝트
--      스냅샷이다. 과거 미지정 버전이면 null 을 그대로 보존한다.
--
-- 멱등: 컬럼/테이블/인덱스/정책/함수는 반복 실행 안전하게 작성했다.
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 회의록 이슈 등록 코드를 배포한다.
-- 롤백: 0049_issue_minute_links_rollback.sql
--   (모든 회의록-이슈 연결과 issues.start_date 값이 소실되므로 경고 확인).

set search_path = public, extensions;

-- ── 1) 이슈 실제 기간 ──
alter table public.issues
  add column if not exists start_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_date_range_check'
  ) then
    alter table public.issues
      add constraint issues_date_range_check
      check (start_date is null or due_date is null or start_date <= due_date);
  end if;
end
$$;

-- issue_links.project_id 가 부모 이슈의 프로젝트와 다를 수 없게 하는 복합 FK 전제.
-- 0042 소유 인덱스지만 신규/부분 적용 DB의 재현성을 위해 같은 이름으로 방어적 선언한다.
create unique index if not exists issues_id_project_uidx
  on public.issues (id, project_id);

-- ── 2) 이슈 ↔ 불변 회의록 블록 출처 ──
create table if not exists public.issue_links (
  id                    uuid primary key default gen_random_uuid(),
  issue_id              uuid not null,
  project_id            uuid not null,
  link_type              text not null default 'minute_block',
  minute_id              uuid not null,
  minute_version_id      uuid not null,
  minute_version_no      integer not null,
  source_project_id      uuid,
  minute_title_snapshot  text not null,
  minute_date_snapshot   date not null,
  body_hash              text not null,
  block_index            integer not null,
  block_hash             text not null,
  excerpt_snapshot       text not null,
  source_kind            text not null default 'manual',
  source_key             text,
  created_at             timestamptz not null default now(),

  constraint issue_links_issue_project_fk
    foreign key (issue_id, project_id)
    references public.issues (id, project_id)
    on delete cascade,
  -- 0045의 minute_versions_id_minute_unique(id, minute_id)를 사용해, 다른 회의록의
  -- version id와 minute id를 섞은 링크를 DB에서 거절한다.
  constraint issue_links_version_minute_fk
    foreign key (minute_version_id, minute_id)
    references public.minute_versions (id, minute_id)
    on delete restrict,
  constraint issue_links_link_type_check
    check (link_type = 'minute_block'),
  constraint issue_links_version_no_check
    check (minute_version_no > 0),
  constraint issue_links_body_hash_check
    check (btrim(body_hash) <> ''),
  constraint issue_links_block_index_check
    check (block_index >= 0),
  constraint issue_links_block_hash_check
    check (btrim(block_hash) <> ''),
  constraint issue_links_excerpt_check
    check (btrim(excerpt_snapshot) <> ''),
  constraint issue_links_source_kind_check
    check (source_kind in ('manual', 'action', 'risk')),
  constraint issue_links_source_key_check
    check (source_key is null or btrim(source_key) <> ''),
  -- 같은 이슈에 같은 블록 출처가 실수로 중복 연결되는 것만 막는다. issue_id가
  -- 다르면 같은 manual 블록에서 여러 이슈를 만드는 요구를 그대로 허용한다.
  constraint issue_links_issue_source_unique
    unique (
      issue_id, minute_version_id, block_index, block_hash, source_kind
    )
);

-- 보안 리뷰 전 0049가 이미 적용된 DB도 현재 계약으로 수렴시킨다.
-- source_project_id는 과거 version의 귀속 스냅샷이므로 nullable이며 target project와
-- 같다는 기존 CHECK를 제거한다. 기존 링크도 불변 version 행의 값으로 바로잡는다.
alter table public.issue_links
  alter column source_project_id drop not null;
alter table public.issue_links
  drop constraint if exists issue_links_project_match_check;

update public.issue_links link
set source_project_id = version.project_id
from public.minute_versions version
where version.id = link.minute_version_id
  and version.minute_id = link.minute_id
  and link.source_project_id is distinct from version.project_id;

-- 이슈 상세의 출처 목록, 회의록 블록의 역링크, source_key 중복 안내용.
create index if not exists issue_links_issue_created_idx
  on public.issue_links (issue_id, created_at);
create index if not exists issue_links_minute_block_idx
  on public.issue_links (
    minute_id, minute_version_id, block_index, block_hash, created_at
  );
create index if not exists issue_links_project_created_idx
  on public.issue_links (project_id, created_at desc);
create index if not exists issue_links_source_key_idx
  on public.issue_links (source_key)
  where source_key is not null;

-- ── 3) RLS + 최소 권한 ──
alter table public.issue_links enable row level security;

drop policy if exists read_all_issue_links on public.issue_links;
create policy read_all_issue_links on public.issue_links
  for select to authenticated
  using (true);

-- 구 0049의 authenticated 직접 INSERT 경로를 기적용 DB에서도 닫는다.
drop policy if exists member_insert_issue_links on public.issue_links;

-- 링크는 생성 후 원문 증거 스냅샷으로 취급한다. authenticated UPDATE/DELETE 권한과
-- INSERT/UPDATE/DELETE 정책을 주지 않으며, 부모 이슈 삭제 때 FK CASCADE 로만 함께 제거된다.
revoke all on table public.issue_links from public, anon, authenticated;
grant select on table public.issue_links to authenticated;
grant all on table public.issue_links to service_role;

-- ── 4) 원자적 회의록 블록 이슈 등록 RPC ──
-- 보안 리뷰 전 authenticated에 열렸던 16인자 오버로드를 먼저 제거한다. 새 함수와
-- 이름이 같아도 시그니처가 다르면 그대로 호출 가능하므로 REVOKE만으로는 충분하지 않다.
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, text,
  uuid, uuid, text, integer, text, text, text, text
);

create or replace function public.create_issue_from_minute_block(
  p_project_id uuid,
  p_title text,
  p_body text,
  p_severity text,
  p_assignee_member_ids uuid[],
  p_start_date date,
  p_due_date date,
  p_actor_id uuid,
  p_created_by_name text,
  p_minute_id uuid,
  p_minute_version_id uuid,
  p_body_hash text,
  p_block_index integer,
  p_block_hash text,
  p_excerpt_snapshot text,
  p_source_kind text,
  p_source_key text
) returns table (
  issue_id uuid,
  issue_no bigint
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_issue_id uuid;
  v_issue_no bigint;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_current_project_id uuid;
  v_minute_archived_at timestamptz;
  v_minute_title text;
  v_minute_date date;
  v_minute_version_no integer;
  v_assignee_input_count integer;
  v_assignee_unique_count integer;
  v_valid_assignee_count integer;
begin
  if p_project_id is null then
    raise exception 'ISSUE_PROJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'ISSUE_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ISSUE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'ISSUE_TITLE_TOO_LONG' using errcode = '22023';
  end if;
  if p_body is null then
    raise exception 'ISSUE_BODY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_body) > 20000 then
    raise exception 'ISSUE_BODY_TOO_LONG' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('high', 'medium', 'low') then
    raise exception 'ISSUE_SEVERITY_INVALID' using errcode = '22023';
  end if;
  if p_start_date is not null
     and p_due_date is not null
     and p_start_date > p_due_date then
    raise exception 'ISSUE_DATE_RANGE_INVALID' using errcode = '22023';
  end if;

  if p_assignee_member_ids is null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;
  v_assignee_input_count := cardinality(p_assignee_member_ids);
  if v_assignee_input_count > 20 then
    raise exception 'ISSUE_ASSIGNEES_TOO_MANY' using errcode = '22023';
  end if;
  if array_position(p_assignee_member_ids, null) is not null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;

  if p_minute_id is null or p_minute_version_id is null then
    raise exception 'MINUTE_VERSION_REQUIRED' using errcode = '22023';
  end if;
  if p_body_hash is null or btrim(p_body_hash) = '' then
    raise exception 'MINUTE_BODY_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_block_index is null or p_block_index < 0 then
    raise exception 'MINUTE_BLOCK_INDEX_INVALID' using errcode = '22023';
  end if;
  if p_block_hash is null or btrim(p_block_hash) = '' then
    raise exception 'MINUTE_BLOCK_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_excerpt_snapshot is null or btrim(p_excerpt_snapshot) = '' then
    raise exception 'MINUTE_BLOCK_EXCERPT_REQUIRED' using errcode = '22023';
  end if;
  if p_source_kind is null
     or p_source_kind not in ('manual', 'action', 'risk') then
    raise exception 'MINUTE_SOURCE_KIND_INVALID' using errcode = '22023';
  end if;
  if p_source_key is not null and btrim(p_source_key) = '' then
    raise exception 'MINUTE_SOURCE_KEY_INVALID' using errcode = '22023';
  end if;

  -- 현재 회의록 행을 잠가 archive/프로젝트 재귀속과 이슈 생성이 엇갈리지 않게 한다.
  -- 프로젝트 미지정 회의록은 서버 액션이 선택한 target project를 허용한다.
  select minute.project_id, minute.archived_at
  into v_current_project_id, v_minute_archived_at
  from public.minutes minute
  where minute.id = p_minute_id
  for share;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  if v_current_project_id is not null
     and v_current_project_id <> p_project_id then
    raise exception 'MINUTE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  -- version id와 minute id를 함께 조회해 출처 교차 혼입을 막는다. minute_versions는
  -- append-only이므로 잠금 없이도 이후 스냅샷 값이 바뀌지 않는다.
  select
    mv.body_hash,
    mv.project_id,
    mv.title,
    mv.minute_date,
    mv.version_no
  into
    v_version_body_hash,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_minute_version_no
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id;

  if not found then
    raise exception 'MINUTE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body_hash <> v_version_body_hash then
    raise exception 'MINUTE_BODY_STALE' using errcode = '22023';
  end if;

  -- 중복 id는 한 담당자로 정규화하되, null/원소 수 제한은 위에서 원본 배열 기준으로
  -- 먼저 검증해 비정상적으로 큰 요청이 DISTINCT 비용을 우회하지 못하게 한다.
  select count(distinct member_id)
  into v_assignee_unique_count
  from unnest(p_assignee_member_ids) as assignee(member_id);

  select count(*)
  into v_valid_assignee_count
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.id in (
      select distinct member_id
      from unnest(p_assignee_member_ids) as assignee(member_id)
    );

  if v_valid_assignee_count <> v_assignee_unique_count then
    raise exception 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' using errcode = '22023';
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    created_by,
    created_by_name
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_actor_id,
    nullif(btrim(p_created_by_name), '')
  )
  returning created_issue.id, created_issue.issue_no
  into v_issue_id, v_issue_no;

  insert into public.issue_assignees (
    issue_id,
    member_id,
    project_id
  )
  select
    v_issue_id,
    assignee.member_id,
    p_project_id
  from (
    select distinct member_id
    from unnest(p_assignee_member_ids) as input(member_id)
  ) assignee;

  insert into public.issue_links (
    issue_id,
    project_id,
    link_type,
    minute_id,
    minute_version_id,
    minute_version_no,
    source_project_id,
    minute_title_snapshot,
    minute_date_snapshot,
    body_hash,
    block_index,
    block_hash,
    excerpt_snapshot,
    source_kind,
    source_key
  ) values (
    v_issue_id,
    p_project_id,
    'minute_block',
    p_minute_id,
    p_minute_version_id,
    v_minute_version_no,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_version_body_hash,
    p_block_index,
    p_block_hash,
    p_excerpt_snapshot,
    p_source_kind,
    p_source_key
  );

  issue_id := v_issue_id;
  issue_no := v_issue_no;
  return next;
end
$$;

revoke all on function public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, uuid, text,
  uuid, uuid, text, integer, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, uuid, text,
  uuid, uuid, text, integer, text, text, text, text
) to service_role;

reset search_path;
