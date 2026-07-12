-- 회의록 뷰어 인사이트 — 블록 하이라이트(실명 공유) + AI 분류 캐시.
-- 권한: highlights = 읽기 인증 전체 / 쓰기 본인(멤버십 보유) / 삭제 본인 또는 pmo_admin.
--       insights = 읽기 인증 전체 / 쓰기 정책 없음(service_role 이 RLS 우회로 수행).
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0021과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다. Storage 정책은 건드리지 않는다.
-- 주의: 레포 0002/0004 의 current_role() 은 PG 예약어 드리프트 — 프로덕션 헬퍼는 public.app_role().

-- ── 블록 하이라이트 (앵커 = 루트 블록 인덱스 + 정규화 텍스트 FNV-1a 64 해시) ──
-- excerpt 컬럼은 의도적으로 없음: 표시 발췌는 클라이언트가 현재 본문에서 파생(위조·잔존 노출 표면 제거).
-- created_by CASCADE: 하이라이트는 개인 행위 — 탈퇴 시 집계에서 제거(minutes 의 SET NULL 관례와 다른 의도적 선택).
create table if not exists minute_highlights (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  block_index int not null check (block_index >= 0),
  block_hash text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists minute_highlights_minute_idx on minute_highlights (minute_id);
create unique index if not exists minute_highlights_user_block_idx
  on minute_highlights (minute_id, created_by, block_index);

-- ── AI 분류 캐시 (본문 교체 시 delete-and-reinsert, body_hash 로 신선도 판정) ──
-- 'none' 마커 1행(block_index=-1) = 분석 성공·항목 없음. 행 0개 = 미생성/실패(self-heal 대상).
create table if not exists minute_insights (
  id uuid primary key default gen_random_uuid(),
  minute_id uuid not null references minutes(id) on delete cascade,
  body_hash text not null,
  kind text not null check (kind in ('decision','action','deadline','risk','none')),
  label text not null default '',
  block_index int not null,
  block_hash text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists minute_insights_minute_idx on minute_insights (minute_id);
-- 동시 재생성(서버리스 인스턴스 경합) 시 중복 행 방지 — insert 는 on conflict do nothing
create unique index if not exists minute_insights_block_kind_idx
  on minute_insights (minute_id, block_index, kind);

-- ── RLS (enable 이 전제 — 없으면 기본 GRANT 로 authenticated 쓰기가 열림) ──
alter table minute_highlights enable row level security;
alter table minute_insights   enable row level security;

drop policy if exists read_all_minute_highlights on minute_highlights;
create policy read_all_minute_highlights on minute_highlights
  for select to authenticated using (true);

drop policy if exists insert_own_minute_highlights on minute_highlights;
create policy insert_own_minute_highlights on minute_highlights
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists delete_own_minute_highlights on minute_highlights;
create policy delete_own_minute_highlights on minute_highlights
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
-- UPDATE 정책 없음 — 토글은 insert/delete 만, 재매칭은 service_role(RLS 우회).

-- 인사이트: 읽기만 인증 사용자, 쓰기 정책 없음(service_role 이 RLS 우회로 수행) — 0021 minute_embeddings 미러.
drop policy if exists minute_insights_read on minute_insights;
create policy minute_insights_read on minute_insights
  for select to authenticated using (true);
