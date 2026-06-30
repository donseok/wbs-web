-- ============================================================================
-- DK Bot — pgvector RAG 스토리지 (WBS 작업/프로젝트 의미검색)
-- ----------------------------------------------------------------------------
-- 적용 방법(둘 중 하나):
--   1) Supabase 대시보드 → SQL Editor 에 이 파일 내용을 붙여넣고 실행
--   2) supabase db push  (supabase CLI 연결 시)
-- 전제: Supabase 프로젝트가 활성(active) 상태여야 vector 확장을 켤 수 있습니다.
-- 임베딩 차원: gemini-embedding-001 을 outputDimensionality=768 로 축소해 사용(기본 3072).
-- (제공자/모델/EMBED_DIM 변경 시 아래 vector(768) 차원도 함께 맞출 것)
-- ============================================================================

create extension if not exists vector;

create table if not exists public.wbs_embeddings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  kind        text not null check (kind in ('wbs_item', 'project', 'member')),
  ref_id      uuid,                       -- 원본 행(wbs_items.id 등). 요약 문서는 null
  content     text not null,              -- 임베딩 원문(사람이 읽는 문장)
  embedding   vector(768),
  updated_at  timestamptz not null default now()
);

create index if not exists wbs_embeddings_project_idx
  on public.wbs_embeddings (project_id);

-- 코사인 거리 기반 근접 검색 인덱스 (소규모 데이터엔 HNSW 가 학습 불필요·정확)
create index if not exists wbs_embeddings_vec_idx
  on public.wbs_embeddings using hnsw (embedding vector_cosine_ops);

alter table public.wbs_embeddings enable row level security;

-- 읽기: 인증 사용자 허용(앱이 이미 멤버십으로 접근을 통제).
-- 쓰기 정책 없음 = 익명/일반 사용자 차단. 색인(insert/delete)은 서버의 service_role 이
-- 수행하며 service_role 은 RLS 를 우회하므로 별도 쓰기 정책이 필요 없습니다.
drop policy if exists "wbs_embeddings_read" on public.wbs_embeddings;
create policy "wbs_embeddings_read" on public.wbs_embeddings
  for select to authenticated using (true);

-- ----------------------------------------------------------------------------
-- 의미검색 RPC — 쿼리 임베딩과 가까운 문서 top-N 반환.
-- p_project_id 가 null 이면 전체 프로젝트 대상(전사 질문용).
-- 서버(service_role)에서 호출 → RLS 우회, p_project_id 로 스코프 한정.
-- ----------------------------------------------------------------------------
create or replace function public.match_wbs_documents(
  query_embedding vector(768),
  match_count     int default 8,
  p_project_id    uuid default null,
  p_kinds         text[] default null
) returns table (
  id          uuid,
  project_id  uuid,
  kind        text,
  ref_id      uuid,
  content     text,
  similarity  float
)
language sql stable
as $$
  select
    e.id, e.project_id, e.kind, e.ref_id, e.content,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.wbs_embeddings e
  where e.embedding is not null
    and (p_project_id is null or e.project_id = p_project_id)
    and (p_kinds is null or e.kind = any (p_kinds))
  order by e.embedding <=> query_embedding
  limit greatest(match_count, 1)
$$;
