-- 어휘 점수를 매칭 토큰 개수 누적(sum)으로 바꾼다.
--
-- 운영 실측: 'MES 권한' 검색 상위 8건이 전부 담당팀 "MES" 인 WBS 일정 항목이었다.
-- 0084 의 점수식이 max(greatest(...)) over (partition by d.id) 라서 몇 개의 토큰이
-- 맞았는지가 점수에 반영되지 않는다 — 'MES' 한 토큰만 맞은 문서와 'MES'+'권한' 둘 다
-- 맞은 문서가 동점이 되고, 최신순 타이브레이커에서 최근 WBS 항목이 이겨버렸다. LLM 요약도
-- "근거에 권한 내용이 없다"고 답할 만큼 상위 결과 자체가 빗나가 있었다.
--
-- unnest(p_tokens) 조인은 (토큰 × 매칭 청크행) 조합으로 행을 만들므로, max → sum 으로
-- 바꾸면 같은 청크가 맞은 토큰마다 점수가 누적된다 — 'mes'+'권한' 둘 다 맞은 청크 ≈ 2.0 >
-- 'mes' 만 맞은 청크 ≈ 1.0. 수정은 이 window 함수 한 줄뿐이다. 반환 타입·스코프 격리
-- (project_ids/include_global)·상한(match_count 1~100)·권한(anon 배제)·두 단계 정렬
-- (안쪽 distinct on d.id / 바깥 similarity desc)은 0084 와 동일하게 유지한다.
--
-- similarity 가 이제 1.0 을 넘을 수 있다(합산이므로) — 반환 컬럼이 float 라 문제없고,
-- 소비처(lexical.ts 의 어댑터 → searchFusion 의 RRF)는 순위만 사용하므로 절대값 상한이
-- 깨져도 영향이 없다.

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
      -- 매칭된 토큰마다 점수를 누적한다 — 다중 토큰 매칭이 단일 토큰 동점에 밀리지 않도록.
      sum(greatest(
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
