-- 0046 — 회의록 추출 결과를 항목/근거/관계/변경 이력까지 한 트랜잭션으로 반영한다.
--
-- LLM 호출과 topic 생성은 트랜잭션 밖에서 수행할 수 있지만, 기존 항목 판정 이후의 모든
-- 지식 변경은 이 service-role RPC 하나를 거쳐야 한다. 같은 지식 키는 transaction-scoped
-- advisory lock으로 직렬화하고, 앱이 읽었던 current id/hash를 잠금 안에서 다시 검증한다.

set search_path = public, extensions;

-- 동일 추출 입력의 재시도에서 change event가 중복 생성되지 않게 한다.
-- 과거 event는 NULL로 남겨 기존 감사 이력을 훼손하지 않는다.
alter table public.wiki_change_events
  add column if not exists idempotency_key text;

create unique index if not exists wiki_change_events_idempotency_uidx
  on public.wiki_change_events (idempotency_key)
  where idempotency_key is not null;

-- force rebuild와 실행 중 worker 완료가 경합해도 요청을 잃지 않도록 generation을 payload
-- 바깥의 잠금 가능한 열로 승격한다. running 중 force는 generation을 올리고 rerun만 예약한다.
alter table public.wiki_processing_jobs
  add column if not exists apply_generation integer not null default 0;
alter table public.wiki_processing_jobs
  add column if not exists rerun_requested boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.wiki_processing_jobs'::regclass
      and conname = 'wiki_processing_jobs_apply_generation_check'
  ) then
    alter table public.wiki_processing_jobs
      add constraint wiki_processing_jobs_apply_generation_check
      check (apply_generation >= 0);
  end if;
end $$;

-- 이 migration 전에 payload 기반 generation 코드가 잠시 실행된 DB도 같은 상태로 수렴한다.
update public.wiki_processing_jobs job
set apply_generation = (job.payload ->> 'applyGeneration')::integer
where job.apply_generation = 0
  and (job.payload ->> 'applyGeneration') ~ '^[0-9]{1,9}$';

update public.wiki_processing_jobs job
set payload = jsonb_set(
  job.payload,
  '{applyGeneration}',
  to_jsonb(job.apply_generation),
  true
);

create or replace function public.request_wiki_processing_job_run(
  p_job_id bigint,
  p_force boolean,
  p_payload jsonb
) returns table (
  job_id bigint,
  status text,
  apply_generation integer,
  rerun_requested boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'WIKI_JOB_REQUEST_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_job_id
  for update;
  if not found then
    raise exception 'WIKI_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(p_force, false) then
    if v_job.apply_generation = 2147483647 then
      raise exception 'WIKI_JOB_GENERATION_EXHAUSTED' using errcode = '22003';
    end if;

    update public.wiki_processing_jobs job
    set apply_generation = v_job.apply_generation + 1,
        rerun_requested = case when v_job.status = 'running' then true else false end,
        status = case when v_job.status = 'running' then 'running' else 'pending' end,
        attempts = case when v_job.status = 'running' then v_job.attempts else 0 end,
        run_after = case when v_job.status = 'running' then v_job.run_after else v_now end,
        locked_at = case when v_job.status = 'running' then v_job.locked_at else null end,
        locked_by = case when v_job.status = 'running' then v_job.locked_by else null end,
        last_error = null,
        payload = (
          (v_job.payload || v_payload) - 'summary' - 'skipped'
        ) || jsonb_build_object('applyGeneration', v_job.apply_generation + 1),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  elsif v_job.status = 'dead_letter' then
    -- 운영 재시도는 이미 커밋된 item RPC를 재사용해야 하므로 generation을 유지한다.
    update public.wiki_processing_jobs job
    set status = 'pending',
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (
          (v_job.payload || v_payload) - 'summary' - 'skipped'
        ) || jsonb_build_object('applyGeneration', v_job.apply_generation),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;
  end if;

  job_id := v_job.id;
  status := v_job.status;
  apply_generation := v_job.apply_generation;
  rerun_requested := v_job.rerun_requested;
  return next;
end
$$;

revoke all on function public.request_wiki_processing_job_run(bigint, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.request_wiki_processing_job_run(bigint, boolean, jsonb)
  to service_role;

-- 프로젝트 rebuild의 다음 회의록 1건을 keyset cursor로 선점하고, 그 단계가 사용할
-- minute job generation까지 같은 트랜잭션에서 한 번만 예약한다. step binding은
-- project finish가 성공할 때까지 남으므로 네트워크 오류/lease 회수에서도 force
-- generation을 중복 증가시키지 않는다.
create or replace function public.claim_wiki_project_rebuild_step(
  p_project_id uuid,
  p_locked_by text,
  p_lease_seconds integer
) returns table (
  claimed_project_id uuid,
  rebuild_generation bigint,
  minute_id uuid,
  minute_version_id uuid,
  wiki_job_id bigint,
  wiki_apply_generation integer,
  body_md text,
  observed_sort timestamp,
  finished boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_candidate record;
  v_wiki_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(1, least(coalesce(p_lease_seconds, 900), 3600));
  v_existing_job boolean;
  v_version_body text;
begin
  if nullif(btrim(p_locked_by), '') is null or char_length(p_locked_by) > 200 then
    raise exception 'WIKI_PROJECT_REBUILD_WORKER_INVALID' using errcode = '22023';
  end if;

  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where (p_project_id is null or rebuild.project_id = p_project_id)
    and (
      (rebuild.status = 'pending' and rebuild.run_after <= v_now)
      or (
        rebuild.status = 'running'
        and rebuild.locked_at < v_now - make_interval(secs => v_lease_seconds)
      )
    )
  order by rebuild.run_after, rebuild.updated_at, rebuild.project_id
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;

  -- 실행 중 들어온 새 rebuild 요청은 과거 cursor/step보다 우선한다.
  if v_rebuild.rerun_requested then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'pending',
        rerun_requested = false,
        cursor_observed_sort = null,
        cursor_minute_id = null,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id
    returning rebuild.* into v_rebuild;
  end if;

  -- 새 generation의 첫 claim은 기존 live 자동 지식을 soft-reset한다. 단순히 live 상태
  -- 위에서 과거→현재를 replay하면 과거 입력이 현재 항목과 거짓 충돌하고 중복 current가
  -- 남을 수 있다. project row UPDATE lock을 잡은 채 정확히 한 번 reset하며, apply RPC도
  -- 같은 row를 SHARE lock하므로 reset 전후에 구 worker mutation이 끼어들 수 없다.
  if v_rebuild.reset_generation is distinct from v_rebuild.generation then
    insert into public.wiki_change_events (
      project_id, wiki_item_id, minute_id, source_id,
      change_type, before_snapshot, after_snapshot, reason,
      idempotency_key, created_at
    )
    select
      item.project_id,
      item.id,
      null,
      null,
      'retract',
      to_jsonb(item),
      to_jsonb(item) || jsonb_build_object(
        'lifecycle_state', 'archived',
        'updated_at', v_now
      ),
      '프로젝트 Wiki 시간순 재구성 전 자동 지식을 초기화했습니다.',
      'wiki-project-reset-v1:' || v_rebuild.project_id::text
        || ':' || v_rebuild.generation::text || ':' || item.id::text,
      v_now
    from public.wiki_items item
    where item.project_id = v_rebuild.project_id
      and item.origin = 'ai'
      and not item.auto_update_locked
      and item.lifecycle_state in ('active', 'open', 'conflicted')
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing;

    update public.wiki_item_sources source
    set retracted_at = v_now,
        retraction_reason = '프로젝트 Wiki 시간순 재구성 전 자동 지식 초기화'
    where source.retracted_at is null
      and exists (
        select 1
        from public.wiki_items item
        where item.id = source.wiki_item_id
          and item.project_id = v_rebuild.project_id
          and item.origin = 'ai'
          and not item.auto_update_locked
          and item.lifecycle_state in ('active', 'open', 'conflicted')
      );

    update public.wiki_items item
    set lifecycle_state = 'archived',
        updated_at = v_now
    where item.project_id = v_rebuild.project_id
      and item.origin = 'ai'
      and not item.auto_update_locked
      and item.lifecycle_state in ('active', 'open', 'conflicted');

    update public.wiki_topics topic
    set last_changed_at = v_now,
        updated_at = v_now
    where topic.project_id = v_rebuild.project_id;

    update public.wiki_project_rebuild_jobs rebuild
    set status = 'pending',
        reset_generation = rebuild.generation,
        cursor_observed_sort = null,
        cursor_minute_id = null,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id
    returning rebuild.* into v_rebuild;
  end if;

  -- 이전 시도에서 minute job은 예약했지만 project cursor commit만 실패한 경우,
  -- 같은 binding을 그대로 돌려준다. finish가 minute job done을 DB에서 확인한다.
  if v_rebuild.step_wiki_job_id is not null then
    select version.body_md into v_version_body
    from public.minute_versions version
    where version.id = v_rebuild.step_minute_version_id
      and version.minute_id = v_rebuild.step_minute_id;
    if not found then
      raise exception 'WIKI_PROJECT_REBUILD_BOUND_VERSION_MISSING' using errcode = 'P0002';
    end if;

    update public.wiki_project_rebuild_jobs rebuild
    set status = 'running',
        locked_at = v_now,
        locked_by = p_locked_by,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id;

    claimed_project_id := v_rebuild.project_id;
    rebuild_generation := v_rebuild.step_rebuild_generation;
    minute_id := v_rebuild.step_minute_id;
    minute_version_id := v_rebuild.step_minute_version_id;
    wiki_job_id := v_rebuild.step_wiki_job_id;
    wiki_apply_generation := v_rebuild.step_wiki_apply_generation;
    body_md := v_version_body;
    observed_sort := v_rebuild.step_observed_sort;
    finished := false;
    return next;
    return;
  end if;

  select candidate.* into v_candidate
  from (
    select
      minute.id as minute_id,
      minute.title,
      minute.minute_date,
      minute.meeting_occurrence_date,
      minute.created_at as minute_created_at,
      version.id as minute_version_id,
      version.version_no,
      version.body_hash,
      version.body_md,
      version.created_at as version_created_at,
      (
        coalesce(minute.meeting_occurrence_date, minute.minute_date)::timestamp
        + (minute.created_at at time zone 'UTC')::time
      ) as observed_sort
    from public.minutes minute
    join lateral (
      select latest.id, latest.version_no, latest.body_hash, latest.body_md, latest.created_at
      from public.minute_versions latest
      where latest.minute_id = minute.id
      order by latest.version_no desc
      limit 1
    ) version on true
    where minute.project_id = v_rebuild.project_id
      and minute.archived_at is null
  ) candidate
  where v_rebuild.cursor_observed_sort is null
     or (candidate.observed_sort, candidate.minute_id)
        > (v_rebuild.cursor_observed_sort, v_rebuild.cursor_minute_id)
  order by candidate.observed_sort, candidate.minute_id
  limit 1;

  if not found then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'done',
        rerun_requested = false,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id;

    claimed_project_id := v_rebuild.project_id;
    rebuild_generation := v_rebuild.generation;
    minute_id := null;
    minute_version_id := null;
    wiki_job_id := null;
    wiki_apply_generation := null;
    body_md := null;
    observed_sort := null;
    finished := true;
    return next;
    return;
  end if;

  select job.* into v_wiki_job
  from public.wiki_processing_jobs job
  where job.project_id = v_rebuild.project_id
    and job.minute_version_id = v_candidate.minute_version_id
  for update;
  v_existing_job := found;

  if not v_existing_job then
    insert into public.wiki_processing_jobs as job (
      project_id, minute_id, minute_version_id, body_hash,
      status, attempts, run_after, locked_at, locked_by, last_error,
      prompt_version, apply_generation, rerun_requested, payload, updated_at
    ) values (
      v_rebuild.project_id,
      v_candidate.minute_id,
      v_candidate.minute_version_id,
      v_candidate.body_hash,
      'pending',
      0,
      v_now,
      null,
      null,
      null,
      'wiki-v1',
      0,
      false,
      jsonb_build_object(
        'applyGeneration', 0,
        'minute', jsonb_build_object(
          'projectId', v_rebuild.project_id,
          'title', v_candidate.title,
          'minuteDate', v_candidate.minute_date,
          'meetingOccurrenceDate', v_candidate.meeting_occurrence_date,
          'createdAt', v_candidate.minute_created_at
        ),
        'version', jsonb_build_object(
          'id', v_candidate.minute_version_id,
          'versionNo', v_candidate.version_no,
          'createdAt', v_candidate.version_created_at
        ),
        'projectRebuildGeneration', v_rebuild.generation
      ),
      v_now
    )
    on conflict on constraint wiki_processing_jobs_project_version_unique do nothing
    returning job.* into v_wiki_job;

    if not found then
      select job.* into v_wiki_job
      from public.wiki_processing_jobs job
      where job.project_id = v_rebuild.project_id
        and job.minute_version_id = v_candidate.minute_version_id
      for update;
      if not found then
        raise exception 'WIKI_PROJECT_REBUILD_MINUTE_JOB_RACE' using errcode = '40001';
      end if;
      v_existing_job := true;
    end if;
  end if;

  if v_existing_job then
    if v_wiki_job.apply_generation = 2147483647 then
      raise exception 'WIKI_JOB_GENERATION_EXHAUSTED' using errcode = '22003';
    end if;

    update public.wiki_processing_jobs job
    set apply_generation = v_wiki_job.apply_generation + 1,
        rerun_requested = case when v_wiki_job.status = 'running' then true else false end,
        status = case when v_wiki_job.status = 'running' then 'running' else 'pending' end,
        attempts = case when v_wiki_job.status = 'running' then v_wiki_job.attempts else 0 end,
        run_after = case when v_wiki_job.status = 'running' then v_wiki_job.run_after else v_now end,
        locked_at = case when v_wiki_job.status = 'running' then v_wiki_job.locked_at else null end,
        locked_by = case when v_wiki_job.status = 'running' then v_wiki_job.locked_by else null end,
        last_error = null,
        payload = (
          (v_wiki_job.payload - 'summary' - 'skipped')
          || jsonb_build_object(
            'minute', jsonb_build_object(
              'projectId', v_rebuild.project_id,
              'title', v_candidate.title,
              'minuteDate', v_candidate.minute_date,
              'meetingOccurrenceDate', v_candidate.meeting_occurrence_date,
              'createdAt', v_candidate.minute_created_at
            ),
            'version', jsonb_build_object(
              'id', v_candidate.minute_version_id,
              'versionNo', v_candidate.version_no,
              'createdAt', v_candidate.version_created_at
            ),
            'projectRebuildGeneration', v_rebuild.generation,
            'applyGeneration', v_wiki_job.apply_generation + 1
          )
        ),
        updated_at = v_now
    where job.id = v_wiki_job.id
    returning job.* into v_wiki_job;
  end if;

  update public.wiki_project_rebuild_jobs rebuild
  set status = 'running',
      step_observed_sort = v_candidate.observed_sort,
      step_minute_id = v_candidate.minute_id,
      step_minute_version_id = v_candidate.minute_version_id,
      step_rebuild_generation = v_rebuild.generation,
      step_wiki_job_id = v_wiki_job.id,
      step_wiki_apply_generation = v_wiki_job.apply_generation,
      locked_at = v_now,
      locked_by = p_locked_by,
      last_error = null,
      updated_at = v_now
  where rebuild.project_id = v_rebuild.project_id;

  claimed_project_id := v_rebuild.project_id;
  rebuild_generation := v_rebuild.generation;
  minute_id := v_candidate.minute_id;
  minute_version_id := v_candidate.minute_version_id;
  wiki_job_id := v_wiki_job.id;
  wiki_apply_generation := v_wiki_job.apply_generation;
  body_md := v_candidate.body_md;
  observed_sort := v_candidate.observed_sort;
  finished := false;
  return next;
end
$$;

revoke all on function public.claim_wiki_project_rebuild_step(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_wiki_project_rebuild_step(uuid, text, integer)
  to service_role;

-- bound minute job이 실제로 같은(또는 더 최신) generation에서 done인 경우에만 cursor를
-- 전진한다. project 요청 경합은 cursor를 처음으로 되돌리고, pending/running minute
-- job은 step binding을 보존한 채 짧게 재시도한다.
create or replace function public.finish_wiki_project_rebuild_step(
  p_project_id uuid,
  p_locked_by text,
  p_last_error text,
  p_retry_at timestamptz
) returns table (
  rebuilt_project_id uuid,
  rebuild_status text,
  rebuild_generation bigint,
  cursor_advanced boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_wiki_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_error text := coalesce(nullif(btrim(p_last_error), ''), 'MINUTE_JOB_NOT_DONE');
begin
  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where rebuild.project_id = p_project_id
    and rebuild.status = 'running'
    and rebuild.locked_by = p_locked_by
  for update;
  if not found then
    raise exception 'WIKI_PROJECT_REBUILD_LEASE_LOST' using errcode = '40001';
  end if;

  if v_rebuild.rerun_requested
     or v_rebuild.generation is distinct from v_rebuild.step_rebuild_generation then
    update public.wiki_project_rebuild_jobs rebuild
    set status = 'pending',
        rerun_requested = false,
        cursor_observed_sort = null,
        cursor_minute_id = null,
        step_observed_sort = null,
        step_minute_id = null,
        step_minute_version_id = null,
        step_rebuild_generation = null,
        step_wiki_job_id = null,
        step_wiki_apply_generation = null,
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = v_now
    where rebuild.project_id = v_rebuild.project_id
    returning rebuild.* into v_rebuild;
    cursor_advanced := false;

  else
    select job.* into v_wiki_job
    from public.wiki_processing_jobs job
    where job.id = v_rebuild.step_wiki_job_id;

    if found
       and v_wiki_job.status = 'done'
       and v_wiki_job.apply_generation >= v_rebuild.step_wiki_apply_generation then
      update public.wiki_project_rebuild_jobs rebuild
      set status = 'pending',
          cursor_observed_sort = v_rebuild.step_observed_sort,
          cursor_minute_id = v_rebuild.step_minute_id,
          step_observed_sort = null,
          step_minute_id = null,
          step_minute_version_id = null,
          step_rebuild_generation = null,
          step_wiki_job_id = null,
          step_wiki_apply_generation = null,
          attempts = 0,
          run_after = v_now + interval '1 millisecond',
          locked_at = null,
          locked_by = null,
          last_error = null,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := true;

    elsif found and v_wiki_job.status in ('pending', 'running') then
      update public.wiki_project_rebuild_jobs rebuild
      set status = 'pending',
          step_wiki_apply_generation = greatest(
            rebuild.step_wiki_apply_generation,
            v_wiki_job.apply_generation
          ),
          run_after = coalesce(p_retry_at, v_now + interval '5 seconds'),
          locked_at = null,
          locked_by = null,
          last_error = v_error,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := false;

    else
      v_attempts := v_rebuild.attempts + 1;
      update public.wiki_project_rebuild_jobs rebuild
      set status = case
            when v_attempts >= rebuild.max_attempts then 'dead_letter'
            else 'pending'
          end,
          attempts = v_attempts,
          run_after = case
            when v_attempts >= rebuild.max_attempts then rebuild.run_after
            else coalesce(p_retry_at, v_now + interval '1 minute')
          end,
          locked_at = null,
          locked_by = null,
          last_error = v_error,
          updated_at = v_now
      where rebuild.project_id = v_rebuild.project_id
      returning rebuild.* into v_rebuild;
      cursor_advanced := false;
    end if;
  end if;

  rebuilt_project_id := v_rebuild.project_id;
  rebuild_status := v_rebuild.status;
  rebuild_generation := v_rebuild.generation;
  return next;
end
$$;

revoke all on function public.finish_wiki_project_rebuild_step(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_wiki_project_rebuild_step(
  uuid, text, text, timestamptz
) to service_role;

-- worker 종료와 force 요청을 같은 row lock으로 직렬화한다.
-- force가 먼저면 rerun_requested를 보고 pending으로 되돌리고, finish가 먼저면 뒤의 force가
-- done 행을 새 generation pending으로 바꾸므로 어느 순서에서도 재실행 요청이 사라지지 않는다.
create or replace function public.finish_wiki_processing_job(
  p_job_id bigint,
  p_locked_by text,
  p_succeeded boolean,
  p_payload jsonb,
  p_last_error text,
  p_retry_at timestamptz
) returns table (
  job_id bigint,
  status text,
  apply_generation integer,
  rerun_requested boolean
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_now timestamptz := clock_timestamp();
  v_dead boolean;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'WIKI_JOB_FINISH_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_job_id
    and job.status = 'running'
    and job.locked_by = p_locked_by
  for update;
  if not found then
    raise exception 'WIKI_JOB_LEASE_LOST' using errcode = '40001';
  end if;

  if v_job.rerun_requested then
    update public.wiki_processing_jobs job
    set status = 'pending',
        attempts = 0,
        run_after = v_now,
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (
          v_job.payload - 'summary' - 'skipped'
        ) || jsonb_build_object(
          'applyGeneration', v_job.apply_generation,
          'previousRun', v_payload
        ),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  elsif coalesce(p_succeeded, false) then
    update public.wiki_processing_jobs job
    set status = 'done',
        locked_at = null,
        locked_by = null,
        last_error = null,
        rerun_requested = false,
        payload = (v_job.payload || v_payload)
          || jsonb_build_object('applyGeneration', v_job.apply_generation),
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;

  else
    v_dead := v_job.attempts >= v_job.max_attempts;
    update public.wiki_processing_jobs job
    set status = case when v_dead then 'dead_letter' else 'pending' end,
        run_after = case when v_dead then job.run_after else coalesce(p_retry_at, v_now) end,
        locked_at = null,
        locked_by = null,
        last_error = coalesce(nullif(btrim(p_last_error), ''), 'UNKNOWN'),
        rerun_requested = false,
        updated_at = v_now
    where job.id = v_job.id
    returning job.* into v_job;
  end if;

  job_id := v_job.id;
  status := v_job.status;
  apply_generation := v_job.apply_generation;
  rerun_requested := v_job.rerun_requested;
  return next;
end
$$;

revoke all on function public.finish_wiki_processing_job(
  bigint, text, boolean, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finish_wiki_processing_job(
  bigint, text, boolean, jsonb, text, timestamptz
) to service_role;

-- lease fencing 인자가 추가되기 전 개발 overload를 제거해 PostgREST 선택을 단일화한다.
drop function if exists public.apply_wiki_extracted_item_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, text, boolean, timestamptz, timestamptz, text,
  text, date, jsonb, uuid, text, timestamptz, text
);

create or replace function public.apply_wiki_extracted_item_atomic(
  p_project_id uuid,
  p_topic_id uuid,
  p_wiki_job_id bigint,
  p_job_locked_by text,
  p_apply_generation integer,
  p_minute_id uuid,
  p_minute_version_id uuid,
  p_minute_version_no integer,
  p_body_hash text,
  p_kind text,
  p_statement text,
  p_statement_hash text,
  p_knowledge_key text,
  p_certainty text,
  p_decision_state text,
  p_source_relation text,
  p_requested_change text,
  p_can_auto_apply boolean,
  p_observed_at timestamptz,
  p_valid_from timestamptz,
  p_owner_team text,
  p_owner_name text,
  p_due_date date,
  p_sources jsonb,
  p_expected_current_id uuid,
  p_expected_current_hash text,
  p_expected_current_updated_at timestamptz,
  p_idempotency_key text
) returns table (
  outcome text,
  wiki_item_id uuid,
  source_id uuid,
  change_event_id uuid,
  applied_change_type text
)
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute_project_id uuid;
  v_minute_archived_at timestamptz;
  v_version_body_hash text;
  v_latest_version_no integer;
  v_latest_body_hash text;
  v_rebuild public.wiki_project_rebuild_jobs%rowtype;
  v_job public.wiki_processing_jobs%rowtype;
  v_current public.wiki_items%rowtype;
  v_target public.wiki_items%rowtype;
  v_has_current boolean := false;
  v_can_auto boolean := coalesce(p_can_auto_apply, false);
  v_must_conflict boolean := false;
  v_is_replay boolean := false;
  v_close_at timestamptz := coalesce(p_valid_from, p_observed_at);
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_applied_change text;
  v_outcome text;
  v_reason text;
  v_relation_to_current text;
  v_event public.wiki_change_events%rowtype;
  v_source_record record;
  v_source_id uuid;
  v_first_source_id uuid;
begin
  -- RPC 경계에서도 열거값, 길이, 원본 version을 검증한다. service key 유출이나 앱 버그가
  -- 있어도 다른 프로젝트/버전의 provenance를 연결할 수 없어야 한다.
  if p_project_id is null
     or p_topic_id is null
     or p_wiki_job_id is null
     or nullif(btrim(p_job_locked_by), '') is null
     or p_apply_generation is null
     or p_apply_generation < 0
     or p_minute_id is null
     or p_minute_version_id is null
     or p_minute_version_no is null
     or p_minute_version_no < 1 then
    raise exception 'WIKI_APPLY_SCOPE_INVALID' using errcode = '22023';
  end if;
  if p_kind is null
     or p_kind not in ('decision','fact','action','question','risk','constraint','rationale') then
    raise exception 'WIKI_APPLY_KIND_INVALID' using errcode = '22023';
  end if;
  if p_certainty is null or p_certainty not in ('explicit','tentative') then
    raise exception 'WIKI_APPLY_CERTAINTY_INVALID' using errcode = '22023';
  end if;
  if p_decision_state is not null
     and p_decision_state not in ('proposed','tentative','confirmed','reversed') then
    raise exception 'WIKI_APPLY_DECISION_STATE_INVALID' using errcode = '22023';
  end if;
  if p_kind <> 'decision' and p_decision_state is not null then
    raise exception 'WIKI_APPLY_DECISION_STATE_KIND_MISMATCH' using errcode = '22023';
  end if;
  if p_source_relation is null
     or p_source_relation not in ('supports','contradicts','resolves') then
    raise exception 'WIKI_APPLY_SOURCE_RELATION_INVALID' using errcode = '22023';
  end if;
  if p_requested_change is null or p_requested_change not in (
    'new','reaffirm','refine','supersede','reverse','conflict','resolve'
  ) then
    raise exception 'WIKI_APPLY_CHANGE_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_statement), '') is null
     or char_length(p_statement) > 1000
     or nullif(btrim(p_knowledge_key), '') is null
     or char_length(p_knowledge_key) > 160
     or nullif(btrim(p_body_hash), '') is null
     or nullif(btrim(p_statement_hash), '') is null
     or char_length(coalesce(p_owner_name, '')) > 100
     -- statement_hash는 앱의 NFKC/space/dash/문장부호/lower 정규화 결과 해시다.
     -- PostgreSQL에서 그 정규화를 어설프게 재현하지 않고 wire format만 검증한다.
     or p_statement_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'WIKI_APPLY_CONTENT_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 1000 then
    raise exception 'WIKI_APPLY_IDEMPOTENCY_KEY_INVALID' using errcode = '22023';
  end if;
  if p_sources is null
     or jsonb_typeof(p_sources) <> 'array'
     or jsonb_array_length(p_sources) < 1
     or jsonb_array_length(p_sources) > 8 then
    raise exception 'WIKI_APPLY_SOURCES_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where jsonb_typeof(source.value) <> 'object'
       or jsonb_typeof(source.value -> 'block_index') is distinct from 'number'
       or (source.value ->> 'block_index') !~ '^[0-9]+$'
       or jsonb_typeof(source.value -> 'block_hash') is distinct from 'string'
       or nullif(source.value ->> 'block_hash', '') is null
       or jsonb_typeof(source.value -> 'evidence_excerpt') is distinct from 'string'
       or char_length(source.value ->> 'evidence_excerpt') > 1000
  ) then
    raise exception 'WIKI_APPLY_SOURCE_ENTRY_INVALID' using errcode = '22023';
  end if;
  if (
    select count(*) <> count(distinct (source.value ->> 'block_index')::integer)
    from jsonb_array_elements(p_sources) source(value)
  ) then
    raise exception 'WIKI_APPLY_SOURCE_DUPLICATE' using errcode = '22023';
  end if;

  if p_expected_current_id is not null
     and nullif(btrim(p_expected_current_hash), '') is null then
    raise exception 'WIKI_APPLY_EXPECTED_CURRENT_INVALID' using errcode = '22023';
  end if;

  select mi.project_id, mi.archived_at
  into v_minute_project_id, v_minute_archived_at
  from public.minutes mi
  where mi.id = p_minute_id
  for share;
  if not found then
    raise exception 'WIKI_APPLY_MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null or v_minute_project_id is distinct from p_project_id then
    raise exception 'WIKI_APPLY_MINUTE_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  -- minute → project rebuild → job 순서로 SHARE lock을 잡는다. rebuild generation이
  -- pending/running/dead-letter인 동안에는 그 generation의 exact bound step만 쓸 수
  -- 있다. reset 이전 구 worker와 순서 밖의 일반 job은 item mutation 전에 차단된다.
  select rebuild.* into v_rebuild
  from public.wiki_project_rebuild_jobs rebuild
  where rebuild.project_id = p_project_id
  for share;
  if found
     and v_rebuild.status <> 'done'
     and not (
       v_rebuild.status = 'running'
       and v_rebuild.generation = v_rebuild.step_rebuild_generation
       and v_rebuild.step_wiki_job_id = p_wiki_job_id
       and v_rebuild.step_wiki_apply_generation = p_apply_generation
     ) then
    raise exception 'WIKI_PROJECT_REBUILD_FENCE' using errcode = '40001';
  end if;

  -- lease 회수/force/새 worker 완료가 먼저였다면 stale worker는 mutation 없이 끝난다.
  select job.* into v_job
  from public.wiki_processing_jobs job
  where job.id = p_wiki_job_id
    and job.project_id = p_project_id
    and job.minute_id = p_minute_id
    and job.minute_version_id = p_minute_version_id
    and job.status = 'running'
    and job.locked_by = p_job_locked_by
    and job.apply_generation = p_apply_generation
  for share;
  if not found then
    raise exception 'WIKI_JOB_LEASE_LOST' using errcode = '40001';
  end if;

  select mv.body_hash
  into v_version_body_hash
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id
    and mv.version_no = p_minute_version_no;
  if not found then
    raise exception 'WIKI_APPLY_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_version_body_hash is distinct from p_body_hash then
    raise exception 'WIKI_APPLY_VERSION_HASH_MISMATCH' using errcode = '23514';
  end if;
  select latest.version_no, latest.body_hash
  into v_latest_version_no, v_latest_body_hash
  from public.minute_versions latest
  where latest.minute_id = p_minute_id
  order by latest.version_no desc
  limit 1;
  if v_latest_version_no > p_minute_version_no
     and v_latest_body_hash is distinct from p_body_hash then
    -- minutes 행의 SHARE lock을 잡은 상태에서 검사하므로, 이 판정과 item commit 사이에
    -- 내용이 다른 새 version을 만드는 minute commit RPC가 끼어들 수 없다. 파일 연결
    -- 등 동일 body의 새 version은 기존 immutable source를 그대로 사용해도 의미가 같다.
    raise exception 'WIKI_STALE_MINUTE_VERSION' using errcode = '55000';
  end if;

  perform 1
  from public.wiki_topics topic
  where topic.id = p_topic_id
    and topic.project_id = p_project_id;
  if not found then
    raise exception 'WIKI_APPLY_TOPIC_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if p_owner_team is not null and not exists (
    select 1 from public.teams team
    where team.code = p_owner_team and team.active
  ) then
    raise exception 'WIKI_APPLY_OWNER_TEAM_INVALID' using errcode = '23503';
  end if;

  -- project/topic/kind/knowledge-key가 같은 모든 자동 반영을 커밋까지 직렬화한다.
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_project_id::text || ':' || p_topic_id::text || ':' || p_kind || ':' || p_knowledge_key,
      0
    )
  );

  -- 같은 추출 입력이 이미 커밋됐다면 item/event는 다시 만들지 않는다. 아래 공통 source
  -- upsert는 계속 실행하여 soft-retracted source도 안전하게 재활성화한다.
  select event.* into v_event
  from public.wiki_change_events event
  where event.idempotency_key = p_idempotency_key;
  if found then
    if v_event.project_id is distinct from p_project_id
       or v_event.minute_id is distinct from p_minute_id
       or v_event.minute_version_id is distinct from p_minute_version_id
       or coalesce(
         v_event.after_snapshot ->> 'knowledge_key',
         v_event.before_snapshot ->> 'knowledge_key'
       ) is distinct from p_knowledge_key then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_COLLISION' using errcode = '23505';
    end if;
    if v_event.wiki_item_id is null then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_TARGET_MISSING' using errcode = '55000';
    end if;

    select item.* into v_target
    from public.wiki_items item
    where item.id = v_event.wiki_item_id;
    if not found
       or v_target.project_id is distinct from p_project_id
       or v_target.topic_id is distinct from p_topic_id
       or v_target.kind is distinct from p_kind
       or v_target.knowledge_key is distinct from p_knowledge_key then
      raise exception 'WIKI_APPLY_IDEMPOTENCY_TARGET_MISMATCH' using errcode = '23514';
    end if;

    v_is_replay := true;
    v_applied_change := v_event.change_type;
    v_outcome := case
      when v_event.change_type = 'reaffirm' then 'reaffirmed'
      when v_event.change_type = 'conflict' then 'conflicted'
      when v_event.change_type = 'new'
        and v_event.after_snapshot ->> 'lifecycle_state' = 'conflicted' then 'conflicted'
      when v_event.change_type = 'new' then 'created'
      else 'changed'
    end;
  else
    select item.* into v_current
    from public.wiki_items item
    where item.project_id = p_project_id
      and item.topic_id = p_topic_id
      and item.kind = p_kind
      and item.knowledge_key = p_knowledge_key
      and item.lifecycle_state in ('active','open','conflicted')
    order by item.updated_at desc, item.id desc
    limit 1
    for update;
    v_has_current := found;

    -- 앱이 분류에 사용한 current와 잠금 안의 current가 다르면 stale 판정을 적용하지 않는다.
    -- SQLSTATE 40001은 호출자가 전체 판정/RPC를 안전하게 재시도할 수 있는 명시적 신호다.
    if p_expected_current_id is null and v_has_current then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'expected no current item, but one now exists';
    elsif p_expected_current_id is not null and not v_has_current then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'expected current item no longer exists';
    elsif p_expected_current_id is not null and (
      v_current.id is distinct from p_expected_current_id
      or v_current.statement_hash is distinct from p_expected_current_hash
      or (
        p_expected_current_updated_at is not null
        and v_current.updated_at is distinct from p_expected_current_updated_at
      )
    ) then
      raise exception 'WIKI_CURRENT_RACE'
        using errcode = '40001', detail = 'current item id/hash/version changed';
    end if;

    if v_has_current then
      v_before_snapshot := jsonb_build_object(
        'id', v_current.id,
        'project_id', v_current.project_id,
        'topic_id', v_current.topic_id,
        'kind', v_current.kind,
        'statement', v_current.statement,
        'statement_hash', v_current.statement_hash,
        'knowledge_key', v_current.knowledge_key,
        'lifecycle_state', v_current.lifecycle_state,
        'certainty', v_current.certainty,
        'decision_state', v_current.decision_state
      );

      -- 수동 항목은 잠금 플래그와 무관하게 AI가 변경하지 않는다. 동일 statement의
      -- reaffirm 근거만 아래 분기에서 추가할 수 있고, 다른 명시적 내용은 conflict로 보존한다.
      if v_current.origin = 'manual' then
        v_can_auto := false;
      end if;

      -- 앱의 결정형 gate 결과를 신뢰하되, 파괴적 변경의 핵심 조건은 DB에서도 다시
      -- 계산한다. manual/locked/tentative/과거 입력은 service 호출 버그가 있어도
      -- current를 못 바꾼다.
      if p_requested_change in ('refine','supersede','reverse','resolve')
         and (
           v_current.auto_update_locked
           or p_certainty <> 'explicit'
           or (
             coalesce(v_current.valid_from, v_current.observed_at) is not null
             and (
               v_close_at is null
               or v_close_at < coalesce(v_current.valid_from, v_current.observed_at)
             )
           )
         ) then
        v_can_auto := false;
      end if;

      -- 같은 회의록의 더 최신 immutable version이 이미 이 항목을 뒷받침하면, 오래된
      -- version의 파괴적 refine/supersede/reverse/resolve를 다시 허용하지 않는다.
      if exists (
        select 1
        from public.wiki_item_sources source
        join public.minute_versions version
          on version.id = source.minute_version_id
         and version.minute_id = source.minute_id
        where source.wiki_item_id = v_current.id
          and source.minute_id = p_minute_id
          and source.retracted_at is null
          and version.version_no > p_minute_version_no
      ) then
        v_can_auto := false;
      end if;
    end if;

    -- 동일 statement는 모델 분류보다 우선하여 항상 reaffirm으로 수렴한다.
    if v_has_current and (
      v_current.statement_hash = p_statement_hash
      or p_requested_change = 'reaffirm'
    ) then
      v_target := v_current;
      v_after_snapshot := v_before_snapshot;
      v_applied_change := 'reaffirm';
      v_outcome := 'reaffirmed';
      v_reason := '후속 회의록에서 동일한 명시적 근거를 확인했습니다.';

    elsif v_has_current
       and p_requested_change in ('resolve','reverse')
       and v_can_auto then
      update public.wiki_items item
      set lifecycle_state = case
            when p_requested_change = 'reverse' then 'superseded'
            else 'resolved'
          end,
          decision_state = case
            when p_requested_change = 'reverse' then 'reversed'
            else item.decision_state
          end,
          updated_at = v_now
      where item.id = v_current.id
      returning item.* into v_target;

      v_applied_change := p_requested_change;
      v_outcome := 'changed';
      v_reason := case
        when p_requested_change = 'reverse'
          then '회의록에 기존 결정의 철회가 명시되었습니다.'
        else '회의록에 완료 또는 해소가 명시되었습니다.'
      end;

    else
      v_must_conflict := v_has_current and (
        p_requested_change = 'conflict'
        or (not v_can_auto and p_certainty = 'explicit')
      );

      if v_has_current and (p_certainty = 'tentative' or v_must_conflict) then
        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case when v_must_conflict then 'conflicted' else 'open' end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        if v_must_conflict then
          v_relation_to_current := 'contradicts';
          v_applied_change := 'conflict';
          v_outcome := 'conflicted';
          v_reason := '기존 지식과 상충하거나 자동 갱신 잠금이 있어 별도 항목으로 보존했습니다.';
        else
          v_applied_change := 'new';
          v_outcome := 'created';
          v_reason := '잠정 표현이므로 현재 지식을 바꾸지 않고 열린 항목으로 추가했습니다.';
        end if;

      elsif v_has_current
         and p_requested_change = 'refine'
         and v_can_auto then
        update public.wiki_items item
        set statement = p_statement,
            statement_hash = p_statement_hash,
            certainty = p_certainty,
            decision_state = p_decision_state,
            owner_team = coalesce(p_owner_team, item.owner_team),
            due_date = p_due_date,
            observed_at = p_observed_at,
            valid_from = p_valid_from,
            updated_at = v_now
        where item.id = v_current.id
        returning item.* into v_target;

        v_applied_change := 'refine';
        v_outcome := 'changed';
        v_reason := '후속 회의록의 명시적 보완 내용으로 현재 지식을 정교화했습니다.';

      elsif v_has_current
         and p_requested_change = 'supersede'
         and v_can_auto then
        if v_close_at is null then
          raise exception 'WIKI_APPLY_SUPERSEDE_TIME_REQUIRED' using errcode = '22023';
        end if;
        if v_current.valid_from is not null and v_close_at < v_current.valid_from then
          raise exception 'WIKI_APPLY_SUPERSEDE_TIME_INVALID' using errcode = '22023';
        end if;

        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case
            when p_source_relation = 'contradicts' then 'conflicted'
            when p_certainty = 'tentative' then 'open'
            when p_kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        update public.wiki_items item
        set lifecycle_state = 'superseded',
            -- 처리 시각이 아니라 회의록이 명시한 효력 시점(없으면 관찰 시점)으로 닫는다.
            valid_to = v_close_at,
            updated_at = v_now
        where item.id = v_current.id;

        v_relation_to_current := 'supersedes';
        v_applied_change := 'supersede';
        v_outcome := 'changed';
        v_reason := '후속 회의록의 명시적 변경 내용으로 현재 지식을 교체했습니다.';

      else
        -- current가 없거나 semantic relation이 unrelated/new인 독립 지식이다.
        insert into public.wiki_items (
          project_id, topic_id, kind, statement, statement_hash, knowledge_key,
          lifecycle_state, certainty, decision_state, owner_team, due_date,
          observed_at, valid_from, origin, structured_data
        ) values (
          p_project_id, p_topic_id, p_kind, p_statement, p_statement_hash, p_knowledge_key,
          case
            when p_source_relation = 'contradicts' then 'conflicted'
            when p_certainty = 'tentative' then 'open'
            when p_kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          p_certainty, p_decision_state, p_owner_team, p_due_date,
          p_observed_at, p_valid_from, 'ai',
          case
            when nullif(btrim(p_owner_name), '') is null then '{}'::jsonb
            else jsonb_build_object('owner_name', p_owner_name)
          end
        )
        returning * into v_target;

        -- 기존 코드의 unrelated/new 계약처럼 독립 항목 event에는 before를 싣지 않는다.
        v_before_snapshot := null;
        v_applied_change := 'new';
        v_outcome := case
          when v_target.lifecycle_state = 'conflicted' then 'conflicted'
          else 'created'
        end;
        v_reason := case
          when p_certainty = 'explicit'
            then '회의록에서 새로운 명시적 지식을 추출했습니다.'
          else '회의록에서 새로운 열린 논의 항목을 추출했습니다.'
        end;
      end if;
    end if;

    v_after_snapshot := coalesce(v_after_snapshot, jsonb_build_object(
      'id', v_target.id,
      'project_id', v_target.project_id,
      'topic_id', v_target.topic_id,
      'kind', v_target.kind,
      'statement', v_target.statement,
      'statement_hash', v_target.statement_hash,
      'knowledge_key', v_target.knowledge_key,
      'lifecycle_state', v_target.lifecycle_state,
      'certainty', v_target.certainty,
      'decision_state', v_target.decision_state
    ));

    if v_relation_to_current is not null and v_target.id <> v_current.id then
      insert into public.wiki_item_relations (
        from_item_id, to_item_id, relation
      ) values (
        v_target.id, v_current.id, v_relation_to_current
      )
      on conflict on constraint wiki_item_relations_edge_unique do nothing;
    end if;
  end if;

  -- target item에 모든 evidence source를 붙인다. unique source는 재사용하고, 철회된 동일
  -- source는 되살린다. 같은 키인데 immutable provenance가 다르면 조용히 덮지 않고 실패한다.
  for v_source_record in
    select source.value, source.ordinality
    from jsonb_array_elements(p_sources) with ordinality source(value, ordinality)
    order by source.ordinality
  loop
    v_source_id := null;
    insert into public.wiki_item_sources as existing_source (
      wiki_item_id, minute_id, minute_version_id, body_hash,
      block_index, block_hash, evidence_excerpt, relation
    ) values (
      v_target.id,
      p_minute_id,
      p_minute_version_id,
      p_body_hash,
      (v_source_record.value ->> 'block_index')::integer,
      v_source_record.value ->> 'block_hash',
      v_source_record.value ->> 'evidence_excerpt',
      p_source_relation
    )
    on conflict on constraint wiki_item_sources_source_unique
    do update set
      retracted_at = null,
      retraction_reason = null
    where existing_source.minute_id = excluded.minute_id
      and existing_source.body_hash = excluded.body_hash
      and existing_source.block_hash = excluded.block_hash
      and existing_source.evidence_excerpt = excluded.evidence_excerpt
    returning existing_source.id into v_source_id;

    if v_source_id is null then
      raise exception 'WIKI_APPLY_SOURCE_PROVENANCE_MISMATCH' using errcode = '23514';
    end if;
    v_first_source_id := coalesce(v_first_source_id, v_source_id);
  end loop;

  if not v_is_replay then
    insert into public.wiki_change_events (
      project_id, wiki_item_id, minute_id, source_id,
      change_type, before_snapshot, after_snapshot, reason, idempotency_key, created_at
    ) values (
      p_project_id, v_target.id, p_minute_id, v_first_source_id,
      v_applied_change, v_before_snapshot, v_after_snapshot, v_reason,
      p_idempotency_key, v_now
    )
    on conflict (idempotency_key) where idempotency_key is not null
    do nothing
    returning * into v_event;

    if not found then
      select event.* into v_event
      from public.wiki_change_events event
      where event.idempotency_key = p_idempotency_key;
      if not found
         or v_event.project_id is distinct from p_project_id
         or v_event.wiki_item_id is distinct from v_target.id then
        raise exception 'WIKI_APPLY_EVENT_IDEMPOTENCY_MISMATCH' using errcode = '23505';
      end if;
    end if;
  end if;

  update public.wiki_topics topic
  set last_changed_at = v_now,
      updated_at = v_now
  where topic.id = p_topic_id
    and topic.project_id = p_project_id;

  outcome := v_outcome;
  wiki_item_id := v_target.id;
  source_id := v_first_source_id;
  change_event_id := v_event.id;
  applied_change_type := v_applied_change;
  return next;
end
$$;

revoke all on function public.apply_wiki_extracted_item_atomic(
  uuid, uuid, bigint, text, integer, uuid, uuid, integer,
  text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, timestamptz, text, text, date, jsonb,
  uuid, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_wiki_extracted_item_atomic(
  uuid, uuid, bigint, text, integer, uuid, uuid, integer,
  text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, timestamptz, text, text, date, jsonb,
  uuid, text, timestamptz, text
) to service_role;

reset search_path;
