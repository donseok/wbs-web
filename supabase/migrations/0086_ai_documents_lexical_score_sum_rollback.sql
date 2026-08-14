-- 0086 롤백 — match_ai_documents_lexical 을 0084 판본(max 점수식)으로 되돌린다.
-- 데이터는 건드리지 않는다. 롤백 후에는 다중 토큰 매칭 우대가 사라짐에 유의.

begin;

drop function if exists public.match_ai_documents_lexical(
  text[], int, uuid[], boolean, text[], text[], int
);

create function public.match_ai_documents_lexical(
  p_tokens text[],
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
    s.id, s.project_id, s.domain, s.entity_type, s.entity_id, s.chunk_no,
    s.index_version, s.title, s.content, s.content_hash, s.href, s.team,
    s.occurred_on, s.source_updated_at, s.embedding_model, s.embedding_dimensions,
    s.chunker_version, s.indexed_at, s.similarity
  from (
    select distinct on (d.id)
      d.id, d.project_id, d.domain, d.entity_type, d.entity_id, d.chunk_no,
      d.index_version, d.title, d.content, d.content_hash, d.href, d.team,
      d.occurred_on, d.source_updated_at, d.embedding_model, d.embedding_dimensions,
      d.chunker_version, d.indexed_at,
      max(greatest(
        word_similarity(t, d.title),
        word_similarity(t, d.content)
      )) over (partition by d.id) as similarity
    from unnest(coalesce(p_tokens[1:8], array[]::text[])) as t
    join public.ai_documents d
      on (
        -- NULL/빈 스코프는 절대 "전 프로젝트" 를 뜻하지 않는다(0083 과 동일 계약).
        (
          (p_project_ids is not null and d.project_id = any(p_project_ids))
          or (p_include_global and d.project_id is null)
        )
        and d.index_version = p_index_version
        and (p_domains is null or d.domain = any(p_domains))
        and (p_entity_types is null or d.entity_type = any(p_entity_types))
        -- <%  는 gin_trgm_ops 인덱스를 탄다(각 토큰이 제목 또는 본문의 단어를 포함).
        and (t <% d.title or t <% d.content)
      )
    where array_length(p_tokens, 1) > 0
    order by d.id, similarity desc
  ) s
  order by s.similarity desc, s.occurred_on desc nulls last, s.entity_id, s.chunk_no
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.match_ai_documents_lexical(
  text[], int, uuid[], boolean, text[], text[], int
) from public, anon;
grant execute on function public.match_ai_documents_lexical(
  text[], int, uuid[], boolean, text[], text[], int
) to authenticated, service_role;

commit;
