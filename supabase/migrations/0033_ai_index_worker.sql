-- DK Bot v2 Phase 2 — 증분 색인 워커용 큐 원자 연산(0031 ai_index_jobs 확장).
-- 전부 service_role 전용이며 0031의 권한/RLS 관례를 그대로 유지한다.
-- generation은 CAS 기준점: 같은 job_key에 새 변경이 enqueue될 때마다 +1 되고,
-- 워커는 claim 시점 generation으로 complete/fail을 시도한다. 불일치면 done/백오프
-- 대신 pending으로 복귀해 최신 세대를 재처리한다.
--
-- [tombstone 이중 방어] delete가 최신 generation이면 뒤늦게 도착한 구세대 upsert는
-- ① 여기 CAS에 걸려 pending으로 재실행되고, 재실행 시 콘텐츠 로더가 원본 부재를
--   확인해 delete로 수렴한다(로더 null → delete 규약).
-- ② 문서 쪽은 replace_ai_document_chunks(0031)의 source_updated_at/indexed_at
--   가드가 오래된 재청킹의 덮어쓰기를 별도로 차단한다.

set search_path = public, extensions;

alter table public.ai_index_jobs
  add column if not exists generation bigint not null default 0;

-- 새 변경 enqueue. 같은 job_key면 pending 복귀 + attempts 0 + generation+1.
-- run_after가 없으면 즉시 실행 가능(now()).
create or replace function public.upsert_ai_index_jobs(p_jobs jsonb) returns integer
language plpgsql volatile security invoker
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'AI_INDEX_JOBS_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  )
  select
    x.job_key, x.operation, x.project_id, x.domain, x.entity_type, x.entity_id,
    coalesce(x.payload, '{}'::jsonb), 'pending', 0, coalesce(x.run_after, now()),
    null, null, 0, now()
  from jsonb_to_recordset(p_jobs) as x(
    job_key text,
    operation text,
    project_id uuid,
    domain text,
    entity_type text,
    entity_id text,
    payload jsonb,
    run_after timestamptz
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    run_after = excluded.run_after,
    locked_at = null,
    last_error = null,
    generation = public.ai_index_jobs.generation + 1,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_ai_index_jobs(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ai_index_jobs(jsonb) to service_role;

-- 원자적 claim + 만료 lease 회수. (pending·run_after 도래) 또는 (running·lease 만료)
-- 행을 FOR UPDATE SKIP LOCKED로 선점해 경쟁 워커 간 중복 처리를 막는다.
create or replace function public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer)
returns setof public.ai_index_jobs
language sql volatile security invoker
set search_path = public, extensions
as $$
  update public.ai_index_jobs j
  set status = 'running', locked_at = now(), updated_at = now()
  where j.id in (
    select c.id
    from public.ai_index_jobs c
    where (c.status = 'pending' and c.run_after <= now())
       or (
         c.status = 'running'
         and c.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       )
    order by c.run_after, c.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  returning j.*;
$$;

revoke all on function public.claim_ai_index_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ai_index_jobs(integer, integer) to service_role;

-- 완료 CAS: 처리 중 새 generation이 끼어들었으면 done 대신 pending 복귀(재처리).
-- 반환값 = generation 일치 여부(행이 running이 아니면 false).
create or replace function public.complete_ai_index_job(p_id bigint, p_generation bigint)
returns boolean
language plpgsql volatile security invoker
set search_path = public, extensions
as $$
declare
  v_applied boolean;
begin
  update public.ai_index_jobs
  set status = case when generation = p_generation then 'done' else 'pending' end,
      locked_at = null,
      updated_at = now()
  where id = p_id and status = 'running'
  returning (generation = p_generation) into v_applied;
  return coalesce(v_applied, false);
end;
$$;

revoke all on function public.complete_ai_index_job(bigint, bigint) from public, anon, authenticated;
grant execute on function public.complete_ai_index_job(bigint, bigint) to service_role;

-- 실패 CAS: generation 일치 시에만 워커가 계산한 백오프(p_attempts/p_status/p_run_after)를
-- 적용한다. 불일치면 구세대 실패가 최신 세대의 attempts를 소모하지 않도록
-- pending 복귀 + attempts 유지 + 즉시 재실행으로 되돌린다.
-- p_last_error는 정제된 진단 코드만 허용(원문 오류 문장 금지 — 호출측 safeIndexJobErrorCode).
create or replace function public.fail_ai_index_job(
  p_id bigint,
  p_generation bigint,
  p_attempts integer,
  p_status text,
  p_run_after timestamptz,
  p_last_error text
) returns boolean
language plpgsql volatile security invoker
set search_path = public, extensions
as $$
declare
  v_applied boolean;
begin
  if p_status not in ('pending', 'dead_letter') or p_attempts is null or p_attempts < 0 then
    raise exception 'AI_INDEX_JOB_FAILURE_INVALID' using errcode = '22023';
  end if;

  update public.ai_index_jobs
  set status = case when generation = p_generation then p_status else 'pending' end,
      attempts = case when generation = p_generation then p_attempts else attempts end,
      run_after = case when generation = p_generation then coalesce(p_run_after, now()) else now() end,
      locked_at = null,
      last_error = p_last_error,
      updated_at = now()
  where id = p_id and status = 'running'
  returning (generation = p_generation) into v_applied;
  return coalesce(v_applied, false);
end;
$$;

revoke all on function public.fail_ai_index_job(
  bigint, bigint, integer, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.fail_ai_index_job(
  bigint, bigint, integer, text, timestamptz, text
) to service_role;

reset search_path;
