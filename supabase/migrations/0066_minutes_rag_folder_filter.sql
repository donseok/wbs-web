-- 0066: 회의록 RAG 검색에 폴더 필터 추가 (설계: docs/superpowers/specs/2026-08-04-minutes-chat-folder-filter-design.md)
--
-- 챗 '전체 회의록' 범위가 팀(team_code)까지만 좁혀져 하위 폴더 단위 질문이 불가능했다.
-- p_folder_ids(자기+자손 id 배열, 서버가 확장)를 받아 벡터 검색도 폴더 범위를 존중한다.
--
-- ⚠ create or replace 는 파라미터가 다르면 교체가 아니라 오버로드를 만든다 —
--   5인자/6인자 두 함수가 공존하면 기본값 때문에 PostgREST 호출이 모호해지므로 먼저 drop.
drop function if exists public.match_minute_documents(vector(768), int, text, date, date);

create function public.match_minute_documents(
  query_embedding vector(768),
  match_count     int default 8,
  p_team          text default null,
  p_date_from     date default null,
  p_date_to       date default null,
  p_folder_ids    uuid[] default null
) returns table (
  minute_id   uuid,
  chunk_index int,
  content     text,
  minute_date date,
  team_code   text,
  title       text,
  similarity  float
)
language sql stable
as $$
  select
    e.minute_id, e.chunk_index, e.content,
    m.minute_date, m.team_code, m.title,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.minute_embeddings e
  join public.minutes m on m.id = e.minute_id
  where (p_team is null or m.team_code = p_team)
    and (p_date_from is null or m.minute_date >= p_date_from)
    and (p_date_to   is null or m.minute_date <= p_date_to)
    and (p_folder_ids is null or m.folder_id = any(p_folder_ids))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
