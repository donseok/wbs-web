-- 0033 롤백 — 워커 RPC와 generation 컬럼을 대칭으로 제거한다.
-- 0031(ai_index_jobs 테이블 자체)은 건드리지 않는다.

set search_path = public, extensions;

drop function if exists public.fail_ai_index_job(bigint, bigint, integer, text, timestamptz, text);
drop function if exists public.complete_ai_index_job(bigint, bigint);
drop function if exists public.claim_ai_index_jobs(integer, integer);
drop function if exists public.upsert_ai_index_jobs(jsonb);

alter table public.ai_index_jobs drop column if exists generation;

reset search_path;
