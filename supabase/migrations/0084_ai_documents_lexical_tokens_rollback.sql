-- 0084 롤백: 0083 의 p_query 판본 복원

begin;

drop function if exists public.match_ai_documents_lexical(
  text[], int, uuid[], boolean, text[], text[], int
);

create function public.match_ai_documents_lexical(
  p_query text,
  match_count int default 20,
  p_project_ids uuid[] default null,
  p_include_global boolean default false,
  p_domains text[] default null,
  p_entity_types text[] default null,
  p_index_version int default 1
) returns table (
  id uuid,
  project_id uuid,
  domain text,
  entity_type text,
  entity_id text,
  chunk_no integer,
  index_version integer,
  title text,
  content text,
  content_hash text,
  href text,
  team text,
  occurred_on date,
  source_updated_at timestamptz,
  embedding_model text,
  embedding_dimensions integer,
  chunker_version text,
  indexed_at timestamptz,
  similarity float
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select
    d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
    d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
    d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
    d.chunker_version, d.indexed_at,
    greatest(
      word_similarity(p_query, d.title),
      word_similarity(p_query, d.content)
    )::float as similarity
  from public.ai_documents d
  where
    (
      (p_project_ids is not null and d.project_id = any(p_project_ids))
      or (p_include_global and d.project_id is null)
    )
    and d.index_version = p_index_version
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    and (p_query <% d.title or p_query <% d.content)
  order by similarity desc, d.occurred_on desc nulls last, d.entity_id, d.chunk_no
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
) from public, anon;
grant execute on function public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
) to authenticated, service_role;

commit;
