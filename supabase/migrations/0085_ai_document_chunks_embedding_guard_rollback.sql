-- 0085 롤백 — replace_ai_document_chunks 를 0031 판본(null 보호 없음)으로 되돌린다.
-- 데이터는 건드리지 않는다. 롤백 후에는 재백필 시 클로버가 재발할 수 있음에 유의.
set search_path = public, extensions;

create or replace function public.replace_ai_document_chunks(
  p_project_id uuid,
  p_domain text,
  p_entity_type text,
  p_entity_id text,
  p_index_version integer,
  p_source_updated_at timestamptz,
  p_indexed_at timestamptz,
  p_documents jsonb
) returns integer
language plpgsql volatile security invoker
set search_path = public, extensions
as $$
declare
  v_count integer;
  v_distinct_count integer;
  v_min_chunk integer;
  v_max_chunk integer;
  v_existing_source timestamptz;
  v_existing_indexed timestamptz;
begin
  if jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) = 0 then
    raise exception 'AI_DOCUMENT_CHUNKS_INVALID' using errcode = '22023';
  end if;

  select count(*), count(distinct x.chunk_no), min(x.chunk_no), max(x.chunk_no)
    into v_count, v_distinct_count, v_min_chunk, v_max_chunk
  from jsonb_to_recordset(p_documents) as x(chunk_no integer);
  if v_count <> v_distinct_count or v_min_chunk <> 0 or v_max_chunk <> v_count - 1 then
    raise exception 'AI_DOCUMENT_CHUNKS_NON_CONTIGUOUS' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_project_id::text, 'global') || '|' || p_domain || '|' ||
    p_entity_type || '|' || p_entity_id || '|' || p_index_version::text,
    0
  ));

  select max(source_updated_at), max(indexed_at)
    into v_existing_source, v_existing_indexed
  from public.ai_documents
  where project_id is not distinct from p_project_id
    and domain = p_domain
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and index_version = p_index_version;

  if v_existing_source is not null and (
    p_source_updated_at is null
    or v_existing_source > p_source_updated_at
    or (v_existing_source = p_source_updated_at and v_existing_indexed > p_indexed_at)
  ) then
    return 0;
  end if;
  if v_existing_source is null and v_existing_indexed > p_indexed_at then
    return 0;
  end if;

  insert into public.ai_documents (
    project_id, domain, entity_type, entity_id, chunk_no, index_version,
    title, content, content_hash, href, team, occurred_on, source_updated_at,
    embedding_model, embedding_dimensions, chunker_version, embedding, indexed_at
  )
  select
    p_project_id, p_domain, p_entity_type, p_entity_id, x.chunk_no, p_index_version,
    x.title, x.content, x.content_hash, x.href, x.team, x.occurred_on,
    p_source_updated_at, x.embedding_model, x.embedding_dimensions,
    x.chunker_version,
    case when x.embedding is null or x.embedding = 'null'::jsonb
      then null else (x.embedding::text)::vector(768) end,
    p_indexed_at
  from jsonb_to_recordset(p_documents) as x(
    chunk_no integer,
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
    embedding jsonb
  )
  on conflict (project_scope, domain, entity_type, entity_id, chunk_no, index_version)
  do update set
    project_id = excluded.project_id,
    title = excluded.title,
    content = excluded.content,
    content_hash = excluded.content_hash,
    href = excluded.href,
    team = excluded.team,
    occurred_on = excluded.occurred_on,
    source_updated_at = excluded.source_updated_at,
    embedding_model = excluded.embedding_model,
    embedding_dimensions = excluded.embedding_dimensions,
    chunker_version = excluded.chunker_version,
    embedding = excluded.embedding,
    indexed_at = excluded.indexed_at;

  delete from public.ai_documents
  where project_id is not distinct from p_project_id
    and domain = p_domain
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and index_version = p_index_version
    and chunk_no >= v_count;

  return v_count;
end;
$$;

revoke all on function public.replace_ai_document_chunks(
  uuid, text, text, text, integer, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_ai_document_chunks(
  uuid, text, text, text, integer, timestamptz, timestamptz, jsonb
) to service_role;

reset search_path;
