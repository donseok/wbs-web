-- 회의록(프로젝트 스코프). 카테고리 = teams(PMO/ERP/MES/가공).
-- 파일 이중 저장: Storage 'minutes' 비공개 버킷에 원본 + DB content_md 에 마크다운 본문(.md 만).
-- 권한: 읽기 = 인증 사용자 전체 / 생성 = pmo_admin 전체·team_editor 는 자기 팀만 /
--       삭제 = 작성자(created_by) 본인 또는 pmo_admin. UPDATE 정책 없음 = 수정 금지.
-- 멱등: SQL Editor 반복 실행 안전(if not exists / drop policy if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0012/0013 과 동일 경로).
--       .env.local 의 SUPABASE_DB_URL 은 비어 있으므로 pg 직결/db push 는 사용하지 않는다.
-- 주의: 레포 0002 의 current_role()/current_team() 은 PG 예약어 드리프트로 원문 그대로 적용된 적이 없다
--       (0012_announcements.sql:47-48 참조). 프로덕션 헬퍼는 public.app_role() 이다.
--       current_team() 의 프로덕션 존재 여부를 신뢰할 수 없으므로 app_team() 을 여기서 재선언한다.

create or replace function public.app_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

-- memberships PK 가 (user_id) 단독(0001_init.sql:21)이라 사용자당 팀은 최대 1개 → 스칼라 안전.
create or replace function public.app_team() returns uuid language sql stable as $$
  select team_id from memberships where user_id = auth.uid()
$$;

-- 1) 비공개 버킷 (0008_attachments.sql 패턴)
insert into storage.buckets (id, name, public)
values ('minutes', 'minutes', false)
on conflict (id) do nothing;

-- 주의: 스토리지 레벨 정책은 0008 과 동일하게 "인증되면 통과"다. 경로의 팀 폴더는 조직화 목적이며
--       보안 경계가 아니다 — team_editor 가 콘솔에서 남의 팀 경로로 upload() 를 직접 부르면 객체는 올라간다.
--       막히는 건 그다음 createMinutes 의 메타 기록뿐이다. 실제 방어선은
--       (a) 서버 액션 canCreateMinutes, (b) 아래 RLS insert_minutes 두 겹이다.
drop policy if exists "minutes read"   on storage.objects;
drop policy if exists "minutes insert" on storage.objects;
drop policy if exists "minutes delete" on storage.objects;
create policy "minutes read"   on storage.objects for select to authenticated using (bucket_id = 'minutes');
create policy "minutes insert" on storage.objects for insert to authenticated with check (bucket_id = 'minutes');
create policy "minutes delete" on storage.objects for delete to authenticated using (bucket_id = 'minutes');

-- 2) 테이블
create table if not exists meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- 팀 4개는 삭제될 일이 없지만 restrict 로 의도를 남긴다.
  -- (memberships.team_id 의 cascade 를 복사하면 팀 행 삭제가 회의록을 지운다.)
  team_id    uuid not null references teams(id)    on delete restrict,
  -- 회의 일정을 지워도 회의록은 남는다. cascade 면 Storage 객체가 고아로 남는다(DB 는 Storage 를 모른다).
  meeting_id uuid          references meetings(id) on delete set null,
  minutes_date date not null,
  title text not null,
  file_path text not null,          -- storage object key
  file_name text not null,          -- 다운로드 시 원본 파일명 복원
  size bigint,
  mime text,
  content_md text,                  -- .md 원문 전문. 비-md 는 null
  -- 목록 쿼리가 본문 컬럼을 건드리지 않고 "바로보기 가능" 여부를 알 수 있게 한다.
  has_md boolean generated always as (content_md is not null) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  -- updated_at 없음: 수정 경로가 없으니 항상 created_at 과 같은 값이 된다.
  constraint minutes_title_len check (char_length(title) between 1 and 200),
  -- "본문은 마크다운 파일에만 있다"를 DB 가 강제. isMarkdownFile() 이 받는 확장자와 일치해야 한다.
  constraint minutes_md_only  check (content_md is null or file_path ~* '\.(md|markdown)$')
);

-- 목록 쿼리(where project_id = ? order by minutes_date desc, created_at desc)를 완전히 덮는다.
create index if not exists minutes_project_date_idx on meeting_minutes(project_id, minutes_date desc, created_at desc);
-- meeting_id 는 1단계에서 항상 NULL 이다(컬럼만 두고 UI 는 나중). 부분 인덱스라 빈 상태 비용은 0.
create index if not exists minutes_meeting_idx      on meeting_minutes(meeting_id) where meeting_id is not null;

alter table meeting_minutes enable row level security;

-- 3) RLS
drop policy if exists read_all_minutes on meeting_minutes;
create policy read_all_minutes on meeting_minutes for select to authenticated using (true);

drop policy if exists insert_minutes on meeting_minutes;
create policy insert_minutes on meeting_minutes for insert to authenticated
  with check (
    created_by = auth.uid()
    and (app_role() = 'pmo_admin' or (app_role() = 'team_editor' and team_id = app_team()))
  );

drop policy if exists delete_minutes on meeting_minutes;
create policy delete_minutes on meeting_minutes for delete to authenticated
  using (created_by = auth.uid() or app_role() = 'pmo_admin');

-- UPDATE 정책을 만들지 않는다 = RLS 기본 거부 = 수정 금지(스펙 §2).
