-- 회의록 보관함 (전역) — .md 업로드 전용, 일자×담당(PMO/ERP/MES/가공) 정리 + pgvector 질의.
-- 권한: 읽기 = 인증 사용자 전체 / 생성 = 멤버십 보유자 본인 / 수정·삭제 = 작성자 또는 pmo_admin (0013 패턴).
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0013과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

create extension if not exists vector;

-- ── 회의록 본체 ──
create table if not exists minutes (
  id uuid primary key default gen_random_uuid(),
  minute_date date not null,
  team_code text not null check (team_code in ('PMO','ERP','MES','가공')),
  title text not null,
  body_md text not null default '',
  meeting_id uuid references meetings(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists minutes_date_idx on minutes (minute_date desc);
create index if not exists minutes_team_date_idx on minutes (team_code, minute_date desc);

-- ── 원본 .md + 첨부 메타 ──
create table if not exists minute_files (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  role text not null check (role in ('body','attachment')),
  file_name text not null,
  file_path text not null,
  size bigint not null,
  mime text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists minute_files_minute_idx on minute_files (minute_id);
create unique index if not exists minute_files_one_body_idx on minute_files (minute_id) where role = 'body';

-- ── 횡단 검색용 벡터 (wbs_embeddings 와 분리 — WBS 재색인의 delete+reinsert 에 휩쓸리지 않게) ──
create table if not exists minute_embeddings (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768) not null,
  updated_at timestamptz not null default now()
);
create index if not exists minute_embeddings_minute_idx on minute_embeddings (minute_id);
create index if not exists minute_embeddings_vec_idx
  on minute_embeddings using hnsw (embedding vector_cosine_ops);

-- ── Storage 버킷 (비공개, 20MB 실물 강제) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('minutes', 'minutes', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'minutes');
drop policy if exists "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'minutes');
drop policy if exists "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes');

-- ── RLS ──
alter table minutes           enable row level security;
alter table minute_files      enable row level security;
alter table minute_embeddings enable row level security;

drop policy if exists read_all_minutes on minutes;
create policy read_all_minutes on minutes for select to authenticated using (true);

drop policy if exists insert_own_minutes on minutes;
create policy insert_own_minutes on minutes
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_minutes on minutes;
create policy update_own_minutes on minutes
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_minutes on minutes;
create policy delete_own_minutes on minutes
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists read_all_minute_files on minute_files;
create policy read_all_minute_files on minute_files for select to authenticated using (true);

drop policy if exists own_write_minute_files on minute_files;
create policy own_write_minute_files on minute_files
  for all to authenticated
  using (exists (select 1 from minutes mi where mi.id = minute_id
                 and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')))
  with check (exists (select 1 from minutes mi where mi.id = minute_id
                 and (mi.created_by = auth.uid() or app_role() = 'pmo_admin')));

-- 임베딩: 읽기만 인증 사용자, 쓰기 정책 없음(service_role 이 RLS 우회로 수행).
drop policy if exists minute_embeddings_read on minute_embeddings;
create policy minute_embeddings_read on minute_embeddings
  for select to authenticated using (true);

-- ── 매치 RPC (0010 match_wbs_documents 미러 + 담당/기간 필터, minutes 조인) ──
create or replace function public.match_minute_documents(
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
