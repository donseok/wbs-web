-- 0062 롤백 — Major Process 기준정보·체번·이슈 연결을 0055 시점으로 되돌린다.
--
-- ⚠️ 경고
--   * issue_major_processes(이름·번호)와 issues.major_id 연결이 전부 소실된다.
--   * 롤백 후 재적용하면 트리거가 번호를 새로 발급하므로, 삭제 전 발급분과 같은 번호가
--     같은 이름에 다시 붙는다는 보장이 없다(등록순이 바뀌면 번호도 바뀐다).
--   * RPC는 0055 시그니처(p_major_name 없음)로 복원된다. 0062 이후 앱 코드는 이 시그니처와
--     맞지 않으므로 앱도 함께 되돌려야 한다(코드 먼저, DB 나중 — runbook-rollback 관례).

begin;

set search_path = public, extensions;

-- ── 1) 0062 RPC 제거 → 0055 시그니처·본문 복원 ──────────────────────────────
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
);

create function public.create_issue_from_minute_block(
  p_project_id uuid,
  p_title text,
  p_body text,
  p_severity text,
  p_assignee_member_ids uuid[],
  p_start_date date,
  p_due_date date,
  p_mega_code text,
  p_sub_process text,
  p_owner_department text,
  p_related_systems text[],
  p_source_type text,
  p_source_detail text,
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
  issue_no bigint,
  pi_issue_code text
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_issue_id uuid;
  v_issue_no bigint;
  v_pi_issue_code text;
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
  v_related_systems text[];
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

  if not exists (
    select 1
    from public.issue_mega_areas area
    where area.code = p_mega_code and area.active
  ) then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '22023';
  end if;
  if p_sub_process is null
     or btrim(p_sub_process) = ''
     or char_length(btrim(p_sub_process)) > 200 then
    raise exception 'ISSUE_SUB_PROCESS_INVALID' using errcode = '22023';
  end if;
  if p_owner_department is null
     or btrim(p_owner_department) = ''
     or char_length(btrim(p_owner_department)) > 100 then
    raise exception 'ISSUE_OWNER_DEPARTMENT_INVALID' using errcode = '22023';
  end if;
  if p_related_systems is null
     or not public.issue_related_systems_valid(p_related_systems) then
    raise exception 'ISSUE_RELATED_SYSTEMS_INVALID' using errcode = '22023';
  end if;
  if p_source_type is distinct from 'minutes' then
    raise exception 'ISSUE_MINUTE_SOURCE_TYPE_REQUIRED' using errcode = '22023';
  end if;
  if p_source_detail is null or char_length(btrim(p_source_detail)) > 1000 then
    raise exception 'ISSUE_SOURCE_DETAIL_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(normalized.system_name order by normalized.first_ord), '{}'::text[])
    into v_related_systems
    from (
      select btrim(item.value) as system_name, min(item.ord) as first_ord
      from unnest(p_related_systems) with ordinality as item(value, ord)
      group by btrim(item.value)
    ) normalized;

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
    mega_code,
    sub_process,
    owner_department,
    related_systems,
    source_type,
    source_detail,
    created_by,
    created_by_name
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_mega_code,
    btrim(p_sub_process),
    btrim(p_owner_department),
    v_related_systems,
    'minutes',
    btrim(p_source_detail),
    p_actor_id,
    nullif(btrim(p_created_by_name), '')
  )
  returning
    created_issue.id,
    created_issue.issue_no,
    created_issue.pi_issue_code
  into v_issue_id, v_issue_no, v_pi_issue_code;

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
  pi_issue_code := v_pi_issue_code;
  return next;
end
$$;

revoke all on function public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
) to service_role;

-- ── 2) pi 코드 체번 트리거 — 0055 본문 복원(major 요구 제거) ────────────────
create or replace function public.assign_issue_analysis_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if old.mega_code is not null
       or old.mega_seq is not null
       or old.pi_issue_code is not null then
      if old.mega_code is null
         or old.mega_seq is null
         or old.pi_issue_code is null then
        raise exception 'ISSUE_CODE_INCONSISTENT' using errcode = '23514';
      end if;
      if new.project_id is distinct from old.project_id
         or new.mega_code is distinct from old.mega_code
         or new.mega_seq is distinct from old.mega_seq
         or new.pi_issue_code is distinct from old.pi_issue_code then
        raise exception 'ISSUE_CODE_IMMUTABLE' using errcode = '23514';
      end if;
      return new;
    end if;
  end if;

  if new.mega_code is null then
    if new.mega_seq is not null or new.pi_issue_code is not null then
      raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.mega_seq is not null or new.pi_issue_code is not null then
    raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  insert into public.issue_number_counters as counter (
    project_id, mega_code, last_no, updated_at
  ) values (
    new.project_id, new.mega_code, 1, now()
  )
  on conflict (project_id, mega_code) do update
    set last_no = counter.last_no + 1,
        updated_at = now()
  returning last_no into v_seq;

  new.mega_seq := v_seq;
  new.pi_issue_code :=
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, 2, '0');
  return new;
end
$$;

-- ── 3) issues.major_id 제거 ────────────────────────────────────────────────
alter table public.issues drop constraint if exists issues_major_process_fk;
alter table public.issues drop constraint if exists issues_major_requires_mega_check;
drop index if exists public.issues_project_major_idx;
alter table public.issues drop column if exists major_id;

-- ── 4) Major 테이블·트리거 제거 ────────────────────────────────────────────
drop trigger if exists trg_assign_issue_major_seq on public.issue_major_processes;
drop function if exists public.assign_issue_major_seq();
drop table if exists public.issue_major_processes;

reset search_path;

commit;
