-- 이슈 첨부파일 — 전용 버킷 + 전용 메타 테이블 + 편집 게이트.
--
-- 설계 정본: docs/superpowers/specs/2026-08-05-issue-attachments-design.md
--
-- 핵심 계약
--   1) 뷰어가 아니라 보관·전달이다. 확장자를 제한하지 않으므로 allowed_mime_types 를 두지 않는다.
--   2) 파일당 상한 50MB(52,428,800) = Supabase 프로젝트 전역 업로드 상한과 같은 값. 이보다 크게
--      잡아도 전역 상한에서 잘리므로 이것이 대시보드를 건드리지 않고 쓸 수 있는 최대치다.
--      버킷에 **명시**한다 — null 로 두면 전역 설정이 바뀔 때 조용히 따라 움직인다.
--   3) 개수 상한 10개는 여기 없다. 서버 액션이 검사한다 — 첨부 추가에 경합이 생길 상황이 아니라
--      트리거를 얹을 값어치가 없다.
--   4) project_id 를 비정규 보관한다. 목록 배지 쿼리가 .eq('project_id', …) 한 방이 되고
--      RLS 를 서브쿼리 없이 쓸 수 있다. issue_assignees(0042)·issue_links 가 이미 같은 형태다.
--   5) 복합 FK 는 권한 외에 project_id 위조도 막는다 — (issue_id, project_id) 쌍이 issues 에
--      실재해야 하므로 올바른 issue_id 에 남의 project_id 를 붙일 수 없다.
--   6) update 권한도 update 정책도 만들지 않는다. 첨부 교체 = 삭제 + 재업로드(0036 과 같은 판단).
--
-- 적용 순서: **이 마이그레이션을 먼저 적용한 뒤 코드를 배포한다.** 테이블이 없는 상태로
--   getIssues 가 돌면 매 요청 PGRST 오류가 로그를 오염시킨다(0027 사고 교훈).
--   반대로 이 마이그레이션만 적용된 상태는 무해하다 — 아무도 쓰지 않는 빈 테이블일 뿐이다.
-- 멱등: table/index/function 은 if not exists / or replace, 정책은 drop 후 재생성. 버킷은
--   on conflict do update 라 재적용 때 상한이 수렴한다(0021 의 do nothing 은 그러지 못한다).
-- 롤백: 0068_issue_attachments_rollback.sql (업로드된 파일 자체는 남긴다 — 사유는 그 파일에).

begin;

set search_path = public, extensions;

-- ── 1) 전용 버킷 ────────────────────────────────────────────────────────────
-- 기존 버킷 재사용(deliverables)을 기각한 이유: 버킷 단위 상한을 이슈용으로 따로 걸 수 없다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('issue-attachments', 'issue-attachments', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
                               public          = excluded.public;

-- ── 2) 메타 테이블 ──────────────────────────────────────────────────────────
-- 복합 FK 의 전제인 issues_id_project_uidx 는 0042:25-26 이 이미 만들었다(0049:43 재선언).
create table if not exists public.issue_attachments (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null,
  project_id  uuid not null,
  -- 원본 파일명(한글 포함). 다운로드 시 이 이름으로 복원한다.
  file_name   text not null,
  -- storage object 경로 '<issue_id>/<ts>-<safe>'. 유니크 — 한 객체가 두 메타 행에 붙지 못한다.
  file_path   text not null unique,
  size        bigint,
  mime        text,
  -- 계정이 지워져도 첨부는 남는다. 다만 그 이슈의 '작성자' 게이트는 영구 소멸하고
  -- 관리자만 만질 수 있게 된다(NULL = auth.uid() 는 false) — 권한 누수가 아니다.
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint issue_attachments_issue_project_fk
    foreign key (issue_id, project_id)
    references public.issues (id, project_id)
    on delete cascade
);

create index if not exists issue_attachments_issue_idx
  on public.issue_attachments (issue_id, created_at desc);
create index if not exists issue_attachments_project_idx
  on public.issue_attachments (project_id);

revoke all on table public.issue_attachments from public, anon, authenticated;
grant select, insert, delete on table public.issue_attachments to authenticated;
grant all on table public.issue_attachments to service_role;

-- ── 3) 편집 게이트 ──────────────────────────────────────────────────────────
-- 이슈 수정 권한과 같은 정의(작성자 또는 프로젝트 관리자). is_project_admin 은 0052:43-48 에서
-- 이미 슈퍼유저를 포함한다. app_role() 은 프로젝트 무관 shim 이라 쓰지 않는다 —
-- 그걸 쓰면 A 프로젝트 멤버가 B 프로젝트 첨부를 쓰는 구멍이 열린다(0053 이 이미 갈아끼운 축).
-- security definer + search_path = '' 는 0052:34 의 pg_temp 가로채기 차단 패턴이라
-- 본문에서 스키마를 전부 정규화한다.
create or replace function public.can_edit_issue(iid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.issues i
    where i.id = iid
      and (i.created_by = auth.uid() or public.is_project_admin(i.project_id))
  )
$$;

revoke all on function public.can_edit_issue(uuid) from public, anon, authenticated;
grant execute on function public.can_edit_issue(uuid) to authenticated;

-- ── 4) 메타 RLS ─────────────────────────────────────────────────────────────
-- 이슈 계열 서버 액션은 createServerClient(anon key + 세션 쿠키)로 쓰므로 여기 정책이
-- 서버 액션 가드의 2차 방어선으로 실제 작동한다. 뒤집어 말하면 틀리게 쓰면 기능이 그냥 막힌다.
alter table public.issue_attachments enable row level security;

drop policy if exists read_issue_attachments   on public.issue_attachments;
drop policy if exists insert_issue_attachments on public.issue_attachments;
drop policy if exists delete_issue_attachments on public.issue_attachments;

-- 조회 개방은 의도다 — 다운로드는 로그인 사용자 전체다(상세 모달이 무검사로 열리는 것과 일치).
create policy read_issue_attachments on public.issue_attachments
  for select to authenticated using (true);
create policy insert_issue_attachments on public.issue_attachments
  for insert to authenticated with check (public.can_edit_issue(issue_id));
create policy delete_issue_attachments on public.issue_attachments
  for delete to authenticated using (public.can_edit_issue(issue_id));

-- ── 5) 스토리지 객체 정책 ───────────────────────────────────────────────────
-- 경로 첫 세그먼트가 issue_id 라는 규약을 이용한다(0036:19-29 가 deliverables 에 쓴 형태).
-- read 만 0036 과 다르게 넓다: 다운로드가 로그인 전체이기도 하고,
-- storage-js 의 remove() 가 objects 에 delete 와 **select 를 함께** 요구하기 때문이다.
-- read 를 좁히면 업로드 실패 시 보상 삭제가 — 그것도 에러 없이 — 조용히 실패한다.
drop policy if exists "issue-attachments read"   on storage.objects;
drop policy if exists "issue-attachments insert" on storage.objects;
drop policy if exists "issue-attachments delete" on storage.objects;

create policy "issue-attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'issue-attachments');
create policy "issue-attachments insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-attachments'
              and public.can_edit_issue(split_part(name, '/', 1)::uuid));
create policy "issue-attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'issue-attachments'
         and public.can_edit_issue(split_part(name, '/', 1)::uuid));

reset search_path;

commit;
