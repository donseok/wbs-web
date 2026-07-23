-- 회의록 폴더 디렉토리(스펙 2026-07-23-minutes-folders-design.md) — 실폴더 트리 + 소속.
-- 멱등: SQL Editor 반복 실행 안전. 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지).
--
-- 미분류는 실제 행이 아니라 minutes.folder_id null 이다. 폴더 삭제 시 하위 폴더는 cascade,
-- 소속 회의록은 set null 로 미분류에 자동 강등된다(데이터 소실 없음).
create table if not exists minute_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  parent_id  uuid references minute_folders(id) on delete cascade,
  sort       int not null default 100,  -- 시드(0~9) 뒤에 정렬되도록 사용자 생성 기본값 100
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 부모 안 이름 중복 금지 — 루트(parent null)와 하위를 부분 인덱스 2개로 커버
create unique index if not exists minute_folders_root_name_uniq
  on minute_folders (name) where parent_id is null;
create unique index if not exists minute_folders_child_name_uniq
  on minute_folders (parent_id, name) where parent_id is not null;

alter table minutes add column if not exists folder_id
  uuid references minute_folders(id) on delete set null;
create index if not exists minutes_folder_idx on minutes (folder_id);

-- 기본 10구분 시드(주간업무 WEEKLY_SECTIONS 순서). created_by null → RLS 상 pmo_admin 만 관리.
-- on conflict 는 부분 유니크 인덱스를 타깃하지 못하므로 not exists 로 멱등 처리.
insert into minute_folders (name, sort)
select v.name, v.sort
from (values
  ('PMO',0),('영업',1),('구매',2),('관리회계',3),('품질',4),
  ('생산계획',5),('조업및표준화',6),('물류',7),('설비및L2',8),('가공',9)
) as v(name, sort)
where not exists (
  select 1 from minute_folders f where f.parent_id is null and f.name = v.name
);

alter table minute_folders enable row level security;

-- 읽기: 전 구성원 / 생성: 본인 명의 / 수정·삭제: 생성자 or pmo_admin (0021 minutes 관례, 헬퍼 app_role())
drop policy if exists read_all_minute_folders on minute_folders;
create policy read_all_minute_folders on minute_folders
  for select to authenticated using (true);

drop policy if exists insert_own_minute_folders on minute_folders;
create policy insert_own_minute_folders on minute_folders
  for insert to authenticated
  with check (created_by = auth.uid() and app_role() is not null);

drop policy if exists update_own_minute_folders on minute_folders;
create policy update_own_minute_folders on minute_folders
  for update to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin')
  with check (created_by = auth.uid() or app_role() = 'pmo_admin');

drop policy if exists delete_own_minute_folders on minute_folders;
create policy delete_own_minute_folders on minute_folders
  for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');
