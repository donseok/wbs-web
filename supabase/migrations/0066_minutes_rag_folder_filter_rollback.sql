-- 0066 롤백 — p_folder_ids 를 제거하고 0021 원형으로 되돌린다.
drop function if exists public.match_minute_documents(vector(768), int, text, date, date, uuid[]);

create function public.match_minute_documents(
  query_embedding vector(768),
  match_count     int default 8,
  p_team          text default null,
  p_date_from     date default null,
  p_date_to       date default null
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
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
