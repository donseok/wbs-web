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
  select role from public.memberships where user_id = auth.uid()
$$;

-- memberships PK 가 (user_id) 단독(0001_init.sql:21)이라 사용자당 팀은 최대 1개 → 스칼라 안전.
create or replace function public.app_team() returns uuid language sql stable as $$
  select team_id from public.memberships where user_id = auth.uid()
$$;

-- 1) 비공개 버킷 (0008_attachments.sql 패턴)
-- file_size_limit 은 storage.buckets 의 bigint 바이트 컬럼(storage-js 문서: "max file size in bytes").
-- 20971520 = 20*1024*1024 = MINUTES_FILE_MAX(src/lib/domain/minutes.ts). 두 값이 어긋나면 안 된다 —
-- 클라이언트 모달 검사(MinutesUploadModal)만 있던 걸 서버측 백스톱으로 보강한다.
-- 주의: on conflict do nothing 이라 이 한도는 버킷이 없을 때(=최초 적용)만 걸린다. 이미 만들어진
--       버킷의 한도를 바꾸려면 별도 update storage.buckets set file_size_limit=... 가 필요하다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('minutes', 'minutes', false, 20971520)
on conflict (id) do nothing;

-- 읽기/쓰기는 "인증되면 통과"다. 경로의 팀 폴더는 조직화 목적이며 보안 경계가 아니다 —
-- team_editor 가 콘솔에서 남의 팀 경로로 upload() 를 직접 부르면 객체는 올라간다.
-- 막히는 건 그다음 createMinutes 의 메타 기록(서버 액션 canCreateMinutes + 경로 prefix 검사)과
-- 아래 RLS insert_minutes 두 겹이다. UPDATE 정책이 없으므로 기존 객체 덮어쓰기는 불가능하다.
-- 삭제만은 아래 §4 에서 좁힌다 — 파괴적이고, 서버 액션을 우회해 직접 호출할 수 있기 때문이다.
-- 삭제 정책은 meeting_minutes 를 참조하므로 테이블(§2) 이 생긴 뒤에야 만들 수 있다. 반면 drop 은
-- 여기서 먼저 한다: 파일이 중간에 실패해도 구(bucket_id 만 검사하던) 삭제 정책이 남지 않는다 = fail-closed.
drop policy if exists "minutes read"   on storage.objects;
drop policy if exists "minutes insert" on storage.objects;
drop policy if exists "minutes delete" on storage.objects;
create policy "minutes read"   on storage.objects for select to authenticated using (bucket_id = 'minutes');
create policy "minutes insert" on storage.objects for insert to authenticated with check (bucket_id = 'minutes');

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
-- file_path 는 Storage 객체 키다. 두 행이 같은 객체를 가리키면 한쪽 삭제가 다른 쪽을 깨뜨리고,
-- 남의 파일을 자기 이름으로 등록하는 위조 행을 만들 수 있다.
-- (읽기 RLS 가 using(true) 라 다른 사용자의 file_path 는 누구나 조회할 수 있다.)
-- minutesStoragePath() 가 타임스탬프 프리픽스를 붙이므로 정상 업로드는 절대 충돌하지 않는다.
create unique index if not exists minutes_file_path_key on meeting_minutes(file_path);

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

-- 4) 스토리지 삭제 정책 — meeting_minutes 와 minutes_file_path_key(UNIQUE) 가 존재해야 만들 수 있다.
--    (정책 표현식의 테이블/함수 참조는 create policy 시점에 OID 로 해석되어 저장된다.)
--
-- 삭제 권한 = 그 객체를 참조하는 행을 지울 수 있는가. 확인 불가능한 가정이 하나도 없다.
--
-- 업로드는 행-먼저다(MinutesUploadModal): 행을 INSERT 해 file_path 를 UNIQUE 로 예약한 뒤
-- 객체를 올린다. 그래서 업로드 실패 시의 롤백도 행이 존재하는 상태에서 실행되고,
-- 아래 EXISTS 가 그것을 인가한다. storage.objects.owner / owner_id 는 참조하지 않는다 —
-- 어느 쪽이 채워지는지 확인할 방법이 없었고, 이제 알 필요가 없다.
--
-- 순서 의존성(중요): deleteMinutes 는 반드시 "객체 먼저, 행 나중"이어야 한다.
-- 행을 먼저 지우면 EXISTS 가 거짓이 되어 객체 삭제가 거부된다.
--
-- 결합(중요): 이 EXISTS 는 호출자 권한으로 실행되므로 read_all_minutes(using(true))에 의존한다.
create policy "minutes delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'minutes'
    and exists (
      select 1 from meeting_minutes mm
      where mm.file_path = storage.objects.name
        and (mm.created_by = auth.uid() or app_role() = 'pmo_admin')
    )
  );
