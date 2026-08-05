-- 0067 롤백 — claim_wiki_processing_job 을 0047 의 2인자·회수 없음 버전으로 되돌린다.
--
-- 되돌리면 워커가 죽어 running 에 남은 job 은 다시 **영구 정체**한다(0067 헤더 참조).
-- 롤백 후에는 아래 한 줄로 남은 좀비 job 을 수동 회수해야 한다:
--   update public.wiki_processing_jobs
--      set status='pending', locked_by=null, locked_at=null, run_after=now(), updated_at=now()
--    where status='running' and locked_at < now() - interval '15 minutes';

set search_path = public, extensions;

drop function if exists public.claim_wiki_processing_job(bigint, text, integer);

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
