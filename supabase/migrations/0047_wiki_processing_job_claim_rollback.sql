-- 0047 롤백 — DB 시각 기반 Wiki minute job 선점 RPC만 제거한다.

set search_path = public, extensions;

drop function if exists public.claim_wiki_processing_job(bigint, text);

reset search_path;
