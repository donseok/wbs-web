set search_path = public, extensions;

drop function if exists public.match_ai_documents(vector, int, uuid[], boolean, text[], text[], text, date, date, int);
drop function if exists public.replace_ai_document_chunks(uuid, text, text, text, integer, timestamptz, timestamptz, jsonb);
drop table if exists public.ai_index_jobs;
drop table if exists public.ai_documents;

reset search_path;
