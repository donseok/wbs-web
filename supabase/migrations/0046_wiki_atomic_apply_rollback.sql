-- 0046 롤백 — 원자적 Wiki 추출 반영 RPC와 event 멱등 키를 제거한다.
-- 기존 항목/근거/관계/변경 이력 및 회의록 원본은 삭제하지 않는다.

set search_path = public, extensions;

drop function if exists public.finish_wiki_project_rebuild_step(
  uuid, text, text, timestamptz
);
drop function if exists public.claim_wiki_project_rebuild_step(uuid, text, integer);
drop function if exists public.finish_wiki_processing_job(
  bigint, text, boolean, jsonb, text, timestamptz
);
drop function if exists public.request_wiki_processing_job_run(bigint, boolean, jsonb);

drop function if exists public.apply_wiki_extracted_item_atomic(
  uuid, uuid, bigint, text, integer, uuid, uuid, integer,
  text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, timestamptz, text, text, date, jsonb,
  uuid, text, timestamptz, text
);
drop function if exists public.apply_wiki_extracted_item_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, text, boolean, timestamptz, timestamptz, text,
  text, date, jsonb, uuid, text, timestamptz, text
);

drop index if exists public.wiki_change_events_idempotency_uidx;
alter table if exists public.wiki_change_events
  drop column if exists idempotency_key;

alter table if exists public.wiki_processing_jobs
  drop constraint if exists wiki_processing_jobs_apply_generation_check;
alter table if exists public.wiki_processing_jobs
  drop column if exists rerun_requested;
alter table if exists public.wiki_processing_jobs
  drop column if exists apply_generation;

reset search_path;
