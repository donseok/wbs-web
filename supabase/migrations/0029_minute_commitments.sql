-- 회의록 약속 추출·확인 — AI 후보를 사람의 확인 이력과 분리해 영속 저장한다.
-- 권한: 읽기 = 인증 사용자 전체 / 생성·삭제 = service_role 전용 / 확인 수정 = 회의록 작성자 또는 pmo_admin.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 코드를 배포한다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

-- 본문/회의일 변경을 DB가 원자적으로 추적한다. 애플리케이션이 수동 증가시키지 않아도
-- 어떤 UPDATE 경로에서든 약속 후보의 source revision이 stale이 된다.
alter table minutes
  add column if not exists commitment_revision bigint not null default 0;

create or replace function bump_minute_commitment_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.body_md is distinct from new.body_md
     or old.minute_date is distinct from new.minute_date then
    new.commitment_revision := old.commitment_revision + 1;
  else
    new.commitment_revision := old.commitment_revision;
  end if;
  return new;
end;
$$;

drop trigger if exists minutes_commitment_revision_trigger on minutes;
create trigger minutes_commitment_revision_trigger
  before update on minutes
  for each row execute function bump_minute_commitment_revision();

create table if not exists minute_commitments (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,

  -- 추출·중복 제거 키. body_hash/block 앵커는 현재 원문과의 정합성을 fail-closed 로 판정한다.
  body_hash text not null,
  -- 본문뿐 아니라 회의일/해석 timezone 이 바뀐 경우 상대 기한을 다시 검토하게 하는 키.
  context_hash text not null,
  source_revision bigint not null,
  commitment_hash text not null,
  commitment_text text not null
    check (char_length(trim(commitment_text)) between 1 and 500),

  -- 모델이 지목한 정확한 근거 문구. 저장 전 서버가 현재 블록에 실제 포함되는지 검증한다.
  source_quote text not null
    check (char_length(trim(source_quote)) between 1 and 2000),
  block_index int not null check (block_index >= 0),
  block_hash text not null,

  -- 원문 담당자 표현 + 정규화된 담당팀. 프로젝트 밖 인물도 있으므로 개인 FK는 두지 않는다.
  owner_name text check (owner_name is null or char_length(trim(owner_name)) between 1 and 120),
  owner_team text check (owner_team is null or owner_team in ('PMO','ERP','MES','가공')),
  owner_unassigned boolean not null default false,

  -- 원문 기한 표현은 보존하고, 확실히 해석된 경우에만 ISO date 를 함께 기록한다.
  due_text text check (due_text is null or char_length(trim(due_text)) between 1 and 120),
  due_date date,
  due_undecided boolean not null default false,

  review_status text not null default 'pending'
    check (review_status in ('pending','confirmed','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- pending 후보에는 감사 필드가 없어야 하고, 처리 상태에는 처리 시각을 강제한다.
  constraint minute_commitments_review_audit_check check (
    (review_status = 'pending'
      and reviewed_by is null and reviewed_by_name is null and reviewed_at is null)
    or
    (review_status in ('confirmed','rejected') and reviewed_at is not null)
  ),
  constraint minute_commitments_owner_resolution_check check (
    not (owner_unassigned and (owner_name is not null or owner_team is not null))
  ),
  constraint minute_commitments_due_resolution_check check (
    not (due_undecided and due_date is not null)
  )
);

create index if not exists minute_commitments_minute_status_idx
  on minute_commitments (minute_id, review_status, created_at);

create index if not exists minute_commitments_confirmed_due_idx
  on minute_commitments (due_date)
  where review_status = 'confirmed' and due_date is not null;

-- 같은 source revision·근거 블록의 같은 약속은 재시도/서버리스 경합에서도 한 행만 유지한다.
-- commitment_hash 에 구조화 필드를 포함해 한 블록 안의 서로 다른 약속은 각각 보존한다.
create unique index if not exists minute_commitments_source_item_idx
  on minute_commitments (minute_id, source_revision, block_index, commitment_hash);

alter table minute_commitments enable row level security;

drop policy if exists minute_commitments_read on minute_commitments;
create policy minute_commitments_read on minute_commitments
  for select to authenticated using (true);

-- 후보/근거/감사 컬럼의 직접 변조를 막는다. 쓰기는 아래 service_role 전용 RPC 두 개만 사용한다.
drop policy if exists minute_commitments_review on minute_commitments;
revoke insert, update, delete on minute_commitments from anon, authenticated;
grant select on minute_commitments to authenticated;

-- 현재 revision을 잠근 한 트랜잭션 안에서 새 후보를 기록하고 이전 pending만 교체한다.
-- 같은 회의록의 동시 run은 minutes 행 잠금에서 직렬화되어 서로의 후보를 지울 수 없다.
create or replace function replace_minute_commitment_candidates(
  p_minute_id uuid,
  p_expected_revision bigint,
  p_body_hash text,
  p_context_hash text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid commitment candidate payload';
  end if;

  select commitment_revision
    into v_revision
    from minutes
    where id = p_minute_id
    for update;
  if not found or v_revision is distinct from p_expected_revision then
    return jsonb_build_object('status', 'changed', 'count', 0);
  end if;

  insert into minute_commitments (
    minute_id, body_hash, context_hash, source_revision,
    commitment_hash, commitment_text, source_quote, block_index, block_hash,
    owner_name, owner_team, owner_unassigned, due_text, due_date, due_undecided
  )
  select
    p_minute_id, p_body_hash, p_context_hash, p_expected_revision,
    x.commitment_hash, x.commitment_text, x.source_quote, x.block_index, x.block_hash,
    x.owner_name, x.owner_team, false, x.due_text, x.due_date, false
  from jsonb_to_recordset(p_items) as x(
    commitment_hash text,
    commitment_text text,
    source_quote text,
    block_index int,
    block_hash text,
    owner_name text,
    owner_team text,
    due_text text,
    due_date date
  )
  on conflict (minute_id, source_revision, block_index, commitment_hash) do nothing;

  delete from minute_commitments c
  where c.minute_id = p_minute_id
    and c.review_status = 'pending'
    and (
      c.source_revision <> p_expected_revision
      or not exists (
        select 1
        from jsonb_to_recordset(p_items) as keep_item(
          commitment_hash text,
          commitment_text text,
          source_quote text,
          block_index int,
          block_hash text,
          owner_name text,
          owner_team text,
          due_text text,
          due_date date
        )
        where keep_item.block_index = c.block_index
          and keep_item.commitment_hash = c.commitment_hash
      )
    );

  return jsonb_build_object('status', 'ready', 'count', jsonb_array_length(p_items));
end;
$$;

-- 확인/제외/다시 검토 역시 minutes revision 잠금과 상태 전이를 한 트랜잭션에서 수행한다.
create or replace function transition_minute_commitment_review(
  p_commitment_id uuid,
  p_status text,
  p_commitment_text text,
  p_owner_name text,
  p_owner_team text,
  p_owner_unassigned boolean,
  p_due_date date,
  p_due_undecided boolean,
  p_reviewer_id uuid,
  p_reviewer_name text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_minute_id uuid;
  v_minute_revision bigint;
  v_source_revision bigint;
  v_current_status text;
begin
  if p_status not in ('pending','confirmed','rejected') then return 'invalid'; end if;

  -- 잠금 순서는 replace RPC와 동일하게 minutes → minute_commitments 로 고정한다.
  select minute_id into v_minute_id
    from minute_commitments where id = p_commitment_id;
  if not found then return 'missing'; end if;

  select commitment_revision into v_minute_revision
    from minutes where id = v_minute_id for update;
  if not found then return 'missing'; end if;

  select source_revision, review_status
    into v_source_revision, v_current_status
    from minute_commitments
    where id = p_commitment_id and minute_id = v_minute_id
    for update;
  if not found then return 'missing'; end if;

  if p_status = 'pending' then
    if v_current_status not in ('confirmed','rejected') then return 'conflict'; end if;
    update minute_commitments set
      review_status = 'pending', reviewed_by = null, reviewed_by_name = null,
      reviewed_at = null, updated_at = now()
    where id = p_commitment_id;
    return 'pending';
  end if;

  if v_current_status <> 'pending' then return 'conflict'; end if;
  if p_reviewer_id is null then return 'invalid'; end if;

  if p_status = 'confirmed' then
    if v_source_revision is distinct from v_minute_revision then return 'stale'; end if;
    if nullif(trim(p_commitment_text), '') is null then return 'invalid'; end if;
    if not (
      nullif(trim(p_owner_name), '') is not null
      or p_owner_team is not null
      or coalesce(p_owner_unassigned, false)
    ) then return 'incomplete'; end if;
    if not (p_due_date is not null or coalesce(p_due_undecided, false)) then return 'incomplete'; end if;

    update minute_commitments set
      commitment_text = trim(p_commitment_text),
      owner_name = nullif(trim(p_owner_name), ''),
      owner_team = p_owner_team,
      owner_unassigned = coalesce(p_owner_unassigned, false),
      due_date = p_due_date,
      due_undecided = coalesce(p_due_undecided, false),
      review_status = 'confirmed',
      reviewed_by = p_reviewer_id,
      reviewed_by_name = p_reviewer_name,
      reviewed_at = now(),
      updated_at = now()
    where id = p_commitment_id;
    return 'confirmed';
  end if;

  update minute_commitments set
    review_status = 'rejected',
    reviewed_by = p_reviewer_id,
    reviewed_by_name = p_reviewer_name,
    reviewed_at = now(),
    updated_at = now()
  where id = p_commitment_id;
  return 'rejected';
end;
$$;

revoke all on function replace_minute_commitment_candidates(uuid,bigint,text,text,jsonb) from public;
revoke all on function transition_minute_commitment_review(uuid,text,text,text,text,boolean,date,boolean,uuid,text) from public;
grant execute on function replace_minute_commitment_candidates(uuid,bigint,text,text,jsonb) to service_role;
grant execute on function transition_minute_commitment_review(uuid,text,text,text,text,boolean,date,boolean,uuid,text) to service_role;
