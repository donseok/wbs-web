-- 0055 롤백 — 이슈 분석서 메타와 PI 이슈 ID 체번을 제거하고 0049 RPC를 복원한다.
--
-- 경고(데이터 소실)
--   · 모든 이슈의 mega_code/mega_seq/pi_issue_code, Sub Process, 주관부서,
--     관련 시스템, 이슈 원천 정보가 영구 삭제된다.
--   · 프로젝트+Mega 카운터도 삭제되므로 이후 0055를 다시 적용하면 번호가 01부터 재시작한다.
-- 적용 순서: 먼저 애플리케이션을 0055 이전 IssueInput/RPC 계약으로 되돌린 뒤 실행한다.
-- 멱등: 신규 객체가 이미 없어도 반복 실행 가능하며, 구 0049 RPC는 create or replace로 복원한다.

begin;

set search_path = public, extensions;

-- 신규 23인자 RPC부터 닫아 구 코드와 신 코드가 동시에 호출되는 창을 없앤다.
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
);
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, text,
  uuid, uuid, text, integer, text, text, text, text
);

drop trigger if exists trg_assign_issue_analysis_code on public.issues;
drop function if exists public.assign_issue_analysis_code();

drop index if exists public.issues_project_mega_idx;
drop index if exists public.issues_project_pi_code_uidx;
drop index if exists public.issues_project_mega_seq_uidx;

alter table public.issues drop constraint if exists issues_analysis_metadata_check;
alter table public.issues drop constraint if exists issues_analysis_code_consistency_check;
alter table public.issues drop constraint if exists issues_mega_area_fk;

alter table public.issues drop column if exists source_detail;
alter table public.issues drop column if exists source_type;
alter table public.issues drop column if exists related_systems;
alter table public.issues drop column if exists owner_department;
alter table public.issues drop column if exists sub_process;
alter table public.issues drop column if exists pi_issue_code;
alter table public.issues drop column if exists mega_seq;
alter table public.issues drop column if exists mega_code;

drop table if exists public.issue_number_counters;
drop table if exists public.issue_mega_areas;
drop function if exists public.issue_related_systems_valid(text[]);

-- 0049의 service_role 전용 17인자 계약을 그대로 복원한다. 이슈·담당자·원문 링크는
-- 여전히 한 함수 호출의 한 트랜잭션에서 생성된다.
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

commit;
