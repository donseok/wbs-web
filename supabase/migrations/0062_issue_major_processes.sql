-- 이슈 Major Process 기준정보 + 프로젝트×Mega별 등록순 체번(01, 02, 03…).
--
-- 핵심 계약 (표준 이슈 분석서 템플릿 실측 — docs/superpowers/specs/2026-08-01-issue-major-process-design.md)
--   1) 이슈 ID(pi_issue_code = PI-I-{Mega}-{일련번호}) 체계는 변경하지 않는다. Major는
--      같은 Mega 코드를 공유하는 별도 체번(`{mega}.{seq2}` 표기, 예: 02.01 기준정보)이다.
--   2) major_seq는 (project_id, mega_code) 범위에서 등록순 1부터. PPT 프로세스 정의
--      페이지가 번호를 그대로 노출하므로 결번 없이 이어져야 한다. 0055의 카운터 테이블
--      대신 트리거 안 advisory xact lock + MAX+1을 쓴다 — 잠금으로 직렬화되므로 0055가
--      금지한 "동시 등록에 취약한 MAX+1"이 아니며, 이름 유니크 충돌로 번호만 소모되는
--      결번이 구조적으로 생기지 않는다.
--   3) 같은 이름 재등록은 기존 Major 재사용(dedupe 키 = project+mega+btrim(name)).
--   4) issues.major_id는 레거시(0062 이전 분류) 이슈에 한해 null 허용. pi 코드가 새로
--      체번되는 순간(insert 또는 최초 Mega 분류)부터는 필수다.
--   5) 회의록 파생 생성 RPC는 p_major_name을 받아 한 트랜잭션에서 resolve-or-create 한다.
--
-- 적용 순서
--   이 마이그레이션을 먼저 적용한 뒤 Major 입력 코드를 배포한다. 0055와 같은 트레이드오프로
--   구 RPC 시그니처를 제거하므로, 적용~배포 사이에는 회의록 파생 등록이 거부된다(연속 적용).
--   구 앱의 일반 등록(createIssue)도 major_id 없이 insert 하므로 트리거가 거부한다 —
--   두 단계를 반드시 연속으로 적용할 것.
-- 멱등: table/column/index/function은 반복 실행 안전, 정책·트리거·제약은 drop/조건부 재생성.
-- 롤백: 0062_issue_major_processes_rollback.sql (Major 데이터·이슈 연결이 소실되므로 경고 확인).

begin;

set search_path = public, extensions;

-- ── 1) Major Process 기준정보 ───────────────────────────────────────────────
create table if not exists public.issue_major_processes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  mega_code   text not null references public.issue_mega_areas(code)
              on update restrict on delete restrict,
  major_seq   bigint not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint issue_major_processes_seq_check check (major_seq > 0),
  constraint issue_major_processes_name_check check (
    btrim(name) <> ''
    and name = btrim(name)
    and char_length(name) <= 100
    -- 번호 정본은 major_seq 체번이다. '02.01 주문관리'처럼 번호가 이름에 박히면
    -- dedupe 키가 갈라져 같은 Major가 이중 체번된다(앱·RPC 검증과 같은 패턴).
    and name !~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+'
  ),
  constraint issue_major_processes_project_mega_seq_key unique (project_id, mega_code, major_seq),
  constraint issue_major_processes_project_mega_name_key unique (project_id, mega_code, name),
  -- issues 복합 FK의 참조 대상 — major가 이슈와 같은 프로젝트·같은 Mega임을 선언적으로 보장
  constraint issue_major_processes_identity_key unique (id, project_id, mega_code)
);

create index if not exists issue_major_processes_project_idx
  on public.issue_major_processes (project_id, mega_code, major_seq);

-- ── 2) 체번 트리거 — 직접 주입 거부, 발급 후 project/mega/seq 불변 ──────────
create or replace function public.assign_issue_major_seq()
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
    if new.project_id is distinct from old.project_id
       or new.mega_code is distinct from old.mega_code
       or new.major_seq is distinct from old.major_seq then
      raise exception 'ISSUE_MAJOR_IMMUTABLE' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.major_seq is not null then
    raise exception 'ISSUE_MAJOR_SEQ_MANAGED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  -- 유니크 키·dedupe 비교의 기준을 저장 전에 한 곳에서 고정한다.
  new.name := btrim(new.name);

  -- (project, mega) 단위 직렬화 후 MAX+1 — 트랜잭션 종료까지 잠금이 유지되어
  -- 동시 등록에도 안전하고, 유니크 충돌로 번호만 소모되는 결번이 없다(헤더 2항).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'issue_major:' || new.project_id::text || ':' || new.mega_code, 0
    )
  );
  select coalesce(max(mp.major_seq), 0) + 1
    into v_seq
    from public.issue_major_processes mp
   where mp.project_id = new.project_id
     and mp.mega_code = new.mega_code;

  new.major_seq := v_seq;
  return new;
end
$$;

revoke all on function public.assign_issue_major_seq()
  from public, anon, authenticated;

drop trigger if exists trg_assign_issue_major_seq on public.issue_major_processes;
create trigger trg_assign_issue_major_seq
  before insert or update on public.issue_major_processes
  for each row execute function public.assign_issue_major_seq();

-- ── 3) RLS — 읽기 전체(이슈 관례), 생성은 멤버십 보유자, 개명·삭제 경로 없음 ──
alter table public.issue_major_processes enable row level security;

drop policy if exists read_all_issue_major_processes on public.issue_major_processes;
create policy read_all_issue_major_processes on public.issue_major_processes
  for select to authenticated using (true);

-- 트리거가 definer라 카운팅은 되지만, 정책·grant에서 update/delete를 아예 열지 않아
-- 발급된 번호·이름이 화면 밖 경로로 바뀌는 일을 막는다(개명은 향후 관리 기능에서).
drop policy if exists insert_issue_major_processes on public.issue_major_processes;
create policy insert_issue_major_processes on public.issue_major_processes
  for insert to authenticated
  with check (public.is_project_member(project_id));

revoke all on table public.issue_major_processes from public, anon, authenticated;
grant select, insert on table public.issue_major_processes to authenticated;
grant all on table public.issue_major_processes to service_role;

-- ── 4) issues.major_id + 정합 제약 ──────────────────────────────────────────
alter table public.issues add column if not exists major_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_major_process_fk'
  ) then
    alter table public.issues
      add constraint issues_major_process_fk
      foreign key (major_id, project_id, mega_code)
      references public.issue_major_processes (id, project_id, mega_code)
      on update restrict on delete restrict;
  end if;

  -- 복합 FK는 mega_code가 null이면 검사를 건너뛴다(MATCH SIMPLE) — 미분류 이슈에
  -- major만 달리는 구멍을 별도 check로 막는다.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.issues'::regclass
      and conname = 'issues_major_requires_mega_check'
  ) then
    alter table public.issues
      add constraint issues_major_requires_mega_check check (
        major_id is null or mega_code is not null
      );
  end if;
end
$$;

create index if not exists issues_project_major_idx
  on public.issues (project_id, major_id)
  where major_id is not null;

-- ── 5) pi 코드 체번 트리거 확장 — 새 체번부터 major 필수 ────────────────────
-- 0055 본문 + "체번 시 major_id 요구" 한 조각. 이미 체번된 레거시 이슈의 major_id
-- 변경(백필·오분류 교정)은 허용하고, mega 불변 규칙은 기존 그대로 유지한다.
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
      -- 0062: 체번된 이슈의 major 연결을 도로 끊는 것은 금지한다(헤더 계약 4항).
      -- 백필(null→값)과 교정(값→값)은 그대로 허용된다.
      if old.major_id is not null and new.major_id is null then
        raise exception 'ISSUE_MAJOR_UNSET_FORBIDDEN' using errcode = '23514';
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

  -- 0062: pi 코드가 새로 체번되는 행은 Major Process 분류를 함께 갖춰야 한다.
  -- (레거시 분류 이슈의 기존 행 갱신은 위 UPDATE 불변 분기에서 이미 반환됐다.)
  if new.major_id is null then
    raise exception 'ISSUE_MAJOR_REQUIRED' using errcode = '23514';
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

-- ── 6) 회의록 블록 이슈 생성 RPC — p_major_name 추가(구 시그니처 제거, 0055 관례) ──
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
);

create or replace function public.create_issue_from_minute_block(
  p_project_id uuid,
  p_title text,
  p_body text,
  p_severity text,
  p_assignee_member_ids uuid[],
  p_start_date date,
  p_due_date date,
  p_mega_code text,
  p_major_name text,
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
  v_major_id uuid;
  v_major_name text;
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
  if p_major_name is null
     or btrim(p_major_name) = ''
     or char_length(btrim(p_major_name)) > 100
     or btrim(p_major_name) ~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+' then
    raise exception 'ISSUE_MAJOR_NAME_INVALID' using errcode = '22023';
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

  -- Major resolve-or-create — 같은 이름은 기존 체번 재사용, 새 이름은 트리거가
  -- advisory lock 아래 다음 번호를 발급한다. 경합으로 유니크 충돌이 나면 승자를 재조회.
  v_major_name := btrim(p_major_name);
  select mp.id
    into v_major_id
    from public.issue_major_processes mp
   where mp.project_id = p_project_id
     and mp.mega_code = p_mega_code
     and mp.name = v_major_name;
  if not found then
    begin
      insert into public.issue_major_processes (project_id, mega_code, name)
      values (p_project_id, p_mega_code, v_major_name)
      returning id into v_major_id;
    exception when unique_violation then
      select mp.id
        into v_major_id
        from public.issue_major_processes mp
       where mp.project_id = p_project_id
         and mp.mega_code = p_mega_code
         and mp.name = v_major_name;
      if not found then
        raise exception 'ISSUE_MAJOR_RESOLVE_FAILED' using errcode = '55000';
      end if;
    end;
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    mega_code,
    major_id,
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
    v_major_id,
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
  text, text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date,
  text, text, text, text, text[], text, text,
  uuid, text, uuid, uuid, text, integer, text, text, text, text
) to service_role;

reset search_path;

commit;
