-- 0067 — 회의록 wiki job 선점에 **리스 만료 회수**를 넣는다.
--
-- 0047 의 claim 은 `status = 'pending'` 만 선점한다. 그래서 워커가 job 을 running 으로
-- 잡은 뒤 죽으면(서버리스 타임아웃·인스턴스 종료·프로세스 강제 종료) 그 job 은 **영구히**
-- running 에 남는다. 회수하는 코드가 리포 어디에도 없다.
--
-- 게다가 0046 의 재적재 경로는 running 인 job 을 만나면 status 를 유지한 채
-- `rerun_requested = true` 만 켠다(0046 §92-97). 즉 그 회의록에 대한 이후 모든 요청이
-- **영원히 돌지 않을 job 에 플래그만 얹는다.** 회의록 한 건의 위키 반영이 조용히 멈춘다.
--
-- 같은 파일의 프로젝트 rebuild claim 은 이미 `locked_at < now() - lease` 로 회수한다
-- (0046 §180-181). 0033 의 AI 인덱스 워커도 마찬가지다. 회의록 job 만 빠져 있던 것이라
-- 이 마이그레이션은 새 정책이 아니라 **누락된 일관성의 복구**다.
--
-- 회수가 안전한 이유: claim 은 호출마다 고유 `locked_by` 토큰을 발급하고, 적용 RPC
-- (`apply_wiki_extracted_item_atomic`)는 `p_job_locked_by` 가 현재 lease 와 다르면
-- WIKI_JOB_LEASE_LOST 로 거부한다. 회수된 뒤 늦게 깨어난 옛 워커는 아무것도 쓰지 못한다.
-- 이 방어가 이미 있었기 때문에 회수만 없던 상태였다.

set search_path = public, extensions;

create or replace function public.claim_wiki_processing_job(
  p_job_id bigint,
  p_locked_by text,
  p_lease_seconds integer default 900
) returns setof public.wiki_processing_jobs
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  v_job public.wiki_processing_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  -- 0046 의 rebuild claim 과 같은 범위로 묶는다(최소 1초, 최대 1시간).
  v_lease_seconds integer := greatest(1, least(coalesce(p_lease_seconds, 900), 3600));
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
    and (
      -- 정상 경로 — 대기 중이고 due 가 된 job
      (job.status = 'pending' and job.run_after <= v_now)
      -- 회수 경로 — running 인데 lease 가 만료된 job(워커가 죽은 것으로 본다).
      -- locked_at is null 은 회수 대상에서 제외한다: 언제부터 붙잡혔는지 알 수 없는데
      -- 회수하면 방금 시작한 job 을 빼앗을 수 있다. 모르면 건드리지 않는다.
      or (
        job.status = 'running'
        and job.locked_at is not null
        and job.locked_at < v_now - make_interval(secs => v_lease_seconds)
      )
    )
  returning job.* into v_job;

  if found then
    return next v_job;
  end if;
  return;
end
$$;

-- 0047 의 2인자 시그니처는 남겨두지 않는다 — default 를 준 3인자가 같은 호출을 모두 받는다.
-- 남겨두면 PostgREST 가 오버로드 모호성으로 PGRST203 을 낼 수 있다.
drop function if exists public.claim_wiki_processing_job(bigint, text);

revoke all on function public.claim_wiki_processing_job(bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_wiki_processing_job(bigint, text, integer)
  to service_role;

reset search_path;
