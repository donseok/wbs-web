-- 임베딩 클로버 방지 (운영 실측 2026-08-14: embedding 808 → 664 → 651, 청크 883·문서 40 불변).
--
-- 원인: 백필을 재실행하면 같은 문서를 다시 청크화해 replace_ai_document_chunks 를 호출한다.
-- 이때 항목 단위로 임베딩이 실패한 청크(429 소진·400·차원 불일치·네트워크, embeddings.ts:21)는
-- embedding = null 로 넘어오는데, 기존 0031 의 ON CONFLICT DO UPDATE 가 이를 무조건 덮어써
-- 이전에 성공했던 온전한 임베딩까지 null 로 지워버렸다.
--
-- 수정: 새 embedding 이 null 이고 content_hash 가 그대로면(본문이 안 바뀌었으면) 기존
-- non-null embedding 을 유지한다. content_hash 가 바뀌었으면 본문이 달라진 것이므로
-- 옛 본문의 임베딩을 새 본문에 붙이지 않도록 null 로 덮어쓴다(의도적 무효화).
--
-- 함수 나머지 로직(advisory lock·chunk 연속성 검증·source_updated_at 가드·꼬리 삭제)은
-- 0031 과 동일 — embedding 컬럼의 ON CONFLICT 대입식 한 줄만 바뀐다.
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
    -- 클로버 방지: 새 임베딩이 null 인데 본문이 그대로면(content_hash 동일) 기존 값을 지키고,
    -- 본문이 달라졌으면(content_hash 변경) 옛 임베딩을 새 본문에 붙이지 않도록 null 로 둔다.
    embedding = case
      when excluded.embedding is null and ai_documents.content_hash = excluded.content_hash
        then ai_documents.embedding
      else excluded.embedding
    end,
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
