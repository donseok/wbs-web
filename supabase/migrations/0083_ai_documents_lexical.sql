-- 어휘 검색 다리. 벡터(match_ai_documents)가 어휘 불일치를 풀고, 이쪽이
-- 고유명사·ID·약어 같은 정확 검색을 맡는다.
--
-- 왜 word_similarity 인가 (2026-08-14 스테이징 실측):
--   similarity() 는 전체 trigram 수로 나누므로 검색어를 정확히 품고 있어도
--   문장이 길면 점수가 깎인다. 실데이터에서 순위가 뒤집혔다 —
--   '발주 자동화' 를 품은 긴 문장 0.143 < 짧은 문장 0.233.
--   word_similarity 는 "검색어가 문장 안에 있는가" 를 보므로 길이에 무관하다.

begin;

create extension if not exists pg_trgm;

-- gin_trgm_ops 는 한글에서도 ILIKE '%…%' 와 <% 를 모두 가속한다
-- (실측: Seq Scan cost 141.74 → Bitmap Index Scan 35.40).
create index if not exists ai_documents_title_trgm_idx
  on public.ai_documents using gin (title gin_trgm_ops);
create index if not exists ai_documents_content_trgm_idx
  on public.ai_documents using gin (content gin_trgm_ops);

drop function if exists public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
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
    -- NULL/빈 스코프는 절대 "전 프로젝트" 를 뜻하지 않는다(match_ai_documents 와 동일 계약).
    (
      (p_project_ids is not null and d.project_id = any(p_project_ids))
      or (p_include_global and d.project_id is null)
    )
    and d.index_version = p_index_version
    and (p_domains is null or d.domain = any(p_domains))
    and (p_entity_types is null or d.entity_type = any(p_entity_types))
    -- <% 는 gin_trgm_ops 인덱스를 탄다. 임계값은 pg_trgm.word_similarity_threshold(기본 0.6).
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
