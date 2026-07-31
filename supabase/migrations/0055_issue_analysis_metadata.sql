-- 이슈 분석서 메타 + PI-I-{Mega}-{일련번호} 체번.
--
-- 핵심 계약
--   1) 기존 issues.id(UUID)와 전역 issue_no(identity)는 호환용으로 그대로 유지한다.
--   2) 신규 업무키 pi_issue_code는 프로젝트+Mega별 원자 카운터로 DB에서만 발급한다.
--      MAX(mega_seq)+1은 동시 등록에 취약하므로 사용하지 않는다.
--   3) 기존 이슈는 미분류(null) 상태를 허용한다. 최초 mega_code 지정 시 한 번만 체번하며,
--      발급 뒤 project_id/mega_code/mega_seq/pi_issue_code는 변경할 수 없다.
--   4) 회의록 파생 생성은 service_role 전용 RPC 한 트랜잭션에서 분석 메타와 원문 링크까지 저장한다.
--
-- 적용 순서
--   이 마이그레이션을 먼저 적용한 뒤 IssueInput 확장 코드를 배포한다. 추가 컬럼은 기존 행과
--   구 일반 이슈 코드에 호환된다. 단, 구 회의록 RPC 오버로드는 의도적으로 제거하므로
--   마이그레이션과 새 앱 배포 사이에는 회의록 파생 등록이 거부된다. 두 단계를 연속 적용한다.
-- 멱등: table/column/index/function은 반복 실행 안전하고, 정책·트리거는 drop 후 재생성한다.
-- 롤백: 0055_issue_analysis_metadata_rollback.sql. 분석 메타/업무키/카운터가 소실되므로 경고 확인.

begin;

set search_path = public, extensions;

-- ── 1) Mega 기준정보 ────────────────────────────────────────────────────────
create table if not exists public.issue_mega_areas (
  code        text primary key,
  name        text not null,
  sort_order  integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint issue_mega_areas_code_check check (code ~ '^[0-9]{2}$'),
  constraint issue_mega_areas_name_check check (btrim(name) <> ''),
  constraint issue_mega_areas_sort_unique unique (sort_order)
);

insert into public.issue_mega_areas (code, name, sort_order, active)
values
  ('00', '기준관리',   0, true),
  ('01', '손익관리',   1, true),
  ('02', '영업',       2, true),
  ('03', '품질·설계',  3, true),
  ('04', '생산계획',   4, true),
  ('05', '조업',       5, true),
  ('06', '출하',       6, true),
  ('07', '원가',       7, true)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = excluded.active,
    updated_at = now();

alter table public.issue_mega_areas enable row level security;
drop policy if exists read_all_issue_mega_areas on public.issue_mega_areas;
create policy read_all_issue_mega_areas on public.issue_mega_areas
  for select to authenticated using (true);

revoke all on table public.issue_mega_areas from public, anon, authenticated;
grant select on table public.issue_mega_areas to authenticated;
grant all on table public.issue_mega_areas to service_role;

-- ── 2) issues 분석 메타 ─────────────────────────────────────────────────────
alter table public.issues add column if not exists mega_code text;
alter table public.issues add column if not exists mega_seq bigint;
alter table public.issues add column if not exists pi_issue_code text;
alter table public.issues add column if not exists sub_process text not null default '';
alter table public.issues add column if not exists owner_department text not null default '';
alter table public.issues add column if not exists related_systems text[] not null default '{}'::text[];
alter table public.issues add column if not exists source_type text;
alter table public.issues add column if not exists source_detail text not null default '';

-- CHECK에서 배열 원소를 검증하기 위한 불변 순수 함수. 관련 테이블을 읽지 않는다.
create or replace function public.issue_related_systems_valid(systems text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select systems is not null
     and cardinality(systems) <= 20
     and not exists (
       select 1
       from unnest(systems) as entry(value)
       where entry.value is null
          or btrim(entry.value) = ''
          or char_length(btrim(entry.value)) > 100
     )
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_mega_area_fk'
  ) then
    alter table public.issues
      add constraint issues_mega_area_fk
      foreign key (mega_code) references public.issue_mega_areas(code)
      on update restrict on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_analysis_code_consistency_check'
  ) then
    alter table public.issues
      add constraint issues_analysis_code_consistency_check check (
        (
          mega_code is null
          and mega_seq is null
          and pi_issue_code is null
        )
        or (
          mega_code is not null
          and mega_seq is not null
          and mega_seq > 0
          and pi_issue_code =
            'PI-I-' || mega_code || '-' || lpad(mega_seq::text, 2, '0')
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_analysis_metadata_check'
  ) then
    alter table public.issues
      add constraint issues_analysis_metadata_check check (
        char_length(sub_process) <= 200
        and char_length(owner_department) <= 100
        and public.issue_related_systems_valid(related_systems)
        and char_length(source_detail) <= 1000
        and (
          source_type is null
          or source_type in (
            'minutes', 'interview', 'deliverable',
            'as_is_analysis', 'data_analysis', 'other'
          )
        )
        and (
          mega_code is null
          or (
            btrim(sub_process) <> ''
            and btrim(owner_department) <> ''
            and source_type is not null
          )
        )
      );
  end if;
end
$$;

create unique index if not exists issues_project_mega_seq_uidx
  on public.issues (project_id, mega_code, mega_seq)
  where mega_code is not null and mega_seq is not null;
create unique index if not exists issues_project_pi_code_uidx
  on public.issues (project_id, pi_issue_code)
  where pi_issue_code is not null;
create index if not exists issues_project_mega_idx
  on public.issues (project_id, mega_code, mega_seq)
  where mega_code is not null;

-- ── 3) 프로젝트+Mega 원자 카운터 ────────────────────────────────────────────
create table if not exists public.issue_number_counters (
  project_id uuid not null references public.projects(id) on delete cascade,
  mega_code  text not null references public.issue_mega_areas(code)
             on update restrict on delete restrict,
  last_no    bigint not null check (last_no > 0),
  updated_at timestamptz not null default now(),
  primary key (project_id, mega_code)
);

alter table public.issue_number_counters enable row level security;
-- 일반 사용자는 카운터 값을 읽거나 써서 다음 번호를 예측·선점할 필요가 없다.
revoke all on table public.issue_number_counters from public, anon, authenticated;
grant all on table public.issue_number_counters to service_role;

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

  -- insert와 기존 미분류 이슈의 최초 분류 모두 seq/code 직접 주입을 허용하지 않는다.
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

revoke all on function public.assign_issue_analysis_code()
  from public, anon, authenticated;

drop trigger if exists trg_assign_issue_analysis_code on public.issues;
create trigger trg_assign_issue_analysis_code
  before insert or update on public.issues
  for each row execute function public.assign_issue_analysis_code();

-- ── 4) 회의록 블록 이슈 생성 RPC 교체 ──────────────────────────────────────
-- 0049 현재 오버로드와 보안 리뷰 전 오버로드를 모두 없애 구 인자 경로로 메타 체번을
-- 우회하지 못하게 한다.
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, uuid, text,
  uuid, uuid, text, integer, text, text, text, text
);
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, text,
  uuid, uuid, text, integer, text, text, text, text
);
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text[], text, text,
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

reset search_path;

commit;
