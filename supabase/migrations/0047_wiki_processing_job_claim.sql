-- 0047 — Wiki minute job 선점을 DB 시각 기준의 원자 RPC로 통합한다.
--
-- project rebuild RPC가 방금 만든 job의 run_after는 DB clock_timestamp()로 기록된다.
-- 이를 애플리케이션 서버 시각과 비교하면 작은 clock skew만으로도 아직 due가 아닌 것으로
-- 오판할 수 있으므로, due 판정과 pending → running CAS를 같은 DB 문장 안에서 수행한다.

set search_path = public, extensions;

create or replace function public.claim_wiki_processing_job(
  p_job_id bigint,
  p_locked_by text
) returns setof public.wiki_processing_jobs
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_locked_by), '') is null or char_length(p_locked_by) > 200 then
    raise exception 'WIKI_JOB_WORKER_INVALID' using errcode = '22023';
  end if;

  update public.wiki_processing_jobs job
  set status = 'running',
      attempts = job.attempts + 1,
      locked_at = v_now,
      locked_by = p_locked_by,
      rerun_requested = false,
      updated_at = v_now
  where job.id = p_job_id
    and job.status = 'pending'
    and job.run_after <= v_now
  returning job.* into v_job;

  if found then
    return next v_job;
  end if;
  return;
end
$$;

revoke all on function public.claim_wiki_processing_job(bigint, text)
  from public, anon, authenticated;
grant execute on function public.claim_wiki_processing_job(bigint, text)
  to service_role;

reset search_path;
