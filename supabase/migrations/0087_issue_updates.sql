-- 이슈 조치/해결 경과 누적 이력 — issues.resolution_note 단일 컬럼을 대체한다.
--
-- 설계 정본: docs/superpowers/specs/2026-08-19-issue-updates-design.md
--
-- 핵심 계약
--   1) 0068 issue_attachments 패턴 복제 — project_id 비정규 + (issue_id, project_id) 복합 FK.
--      복합 FK 는 권한 외에 project_id 위조도 막는다. 전제 인덱스 issues_id_project_uidx 는
--      0042:25-26 이 이미 만들었다.
--   2) insert 를 컬럼 단위로 grant 한다. 브라우저가 anon key + 사용자 JWT 로 PostgREST 를
--      직접 때리는 경로가 실사용 중이라(src/lib/supabase/client.ts:3-6) 전 컬럼 grant 면
--      kind='status'(화면에 시스템 자동 기록으로 렌더된다)·author_name·created_at 을
--      브라우저가 정한다. kind='status' 쓰기는 service_role 전용이다.
--   3) update 도 컬럼 단위다 — archived_* 셋만. 본문 수정 금지(D6)를 DB 가 강제한다.
--      오타 정정은 취소선 + 재작성이다(0068:64-66 과 같은 판단).
--   4) archived_by 는 짝 CHECK 에서 뺀다. on delete set null 은 참조 행 UPDATE 로 구현되고
--      CHECK 가 그대로 평가되므로, 셋을 묶으면 계정 삭제가 23514 로 통째로 실패한다.
--   5) 이력 본문은 한 건당 4000자. 기존 20000(issues.ts:161)은 필드 전체 상한이었다.
--
-- 적용 순서: **0087 → 0088(백필) → 코드** 순이다.
--   이 파일이 첫 번째다. 테이블이 없는 상태로 로더가 돌면 매 요청 PGRST 오류가 로그를
--   오염시킨다(0027 사고 교훈). 백필은 여기 없고 0088 이 하는데, 그 0088 도 **코드보다 앞**이다
--   — 새 코드가 먼저 살아 있으면 첫 경과 등록 때 미러 재계산이 기존 resolution_note 를
--   덮어써 원본이 소실되고, 뒤늦게 도는 백필이 그 새 본문을 원본인 양 이관한다.
-- 멱등: table/index 는 if not exists, 정책은 drop 후 재생성(create policy 에는
--   if not exists 문법이 없어 재적용 2회차가 42710 으로 죽는다).
-- 롤백: 0087_issue_updates_rollback.sql

begin;

set search_path = public, extensions;

-- ── 1) 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.issue_updates (
  id                   uuid primary key default gen_random_uuid(),
  issue_id             uuid not null,
  project_id           uuid not null,
  -- 'note' 사람이 쓴 글 / 'status' 상태 변경 자동 기록. status 본문은 'open>resolved' 형식.
  kind                 text not null default 'note',
  -- note 에만 의미. status(open/in_progress/resolved/on_hold)와 겹치지 않는 축으로 재정의했다.
  category             text,
  body                 text not null,
  -- 멘션 대상은 project_members.id(로스터 축)다. 클라이언트에 auth uuid 가 없다
  -- (src/lib/domain/types.ts:69). 배열이라 FK 를 못 걸어 서버 액션이 선행 검증한다.
  mentioned_member_ids uuid[] not null default '{}',
  -- 신원 정본. 계정이 지워져도 이력은 남는다(0068:48-50 과 같은 계약).
  author_user_id       uuid references auth.users(id) on delete set null,
  -- 표시용 스냅샷. 판정에 쓰지 않는다 — 계정 삭제 폴백 전용.
  author_name          text not null,
  created_at           timestamptz not null default now(),
  -- 취소선(소프트 삭제). 리포에 deleted_at 을 쓰는 테이블은 없다 — archived_at 이 관례
  -- (0045 minutes, 0074 notification_recipients).
  archived_at          timestamptz,
  archived_by          uuid references auth.users(id) on delete set null,
  archived_by_name     text,
  constraint issue_updates_kind_ck check (kind in ('note','status')),
  constraint issue_updates_category_ck
    check (category is null or category in ('action','discuss','followup','etc')),
  constraint issue_updates_body_len_ck check (length(body) between 1 and 4000),
  constraint issue_updates_archive_pair_ck
    check (num_nonnulls(archived_at, archived_by_name) in (0,2)),
  constraint issue_updates_issue_project_fk
    foreign key (issue_id, project_id)
    references public.issues (id, project_id)
    on delete cascade
);

create index if not exists issue_updates_issue_created_idx
  on public.issue_updates (issue_id, created_at desc);
create index if not exists issue_updates_project_idx
  on public.issue_updates (project_id);

-- ── 2) 권한 ─────────────────────────────────────────────────────────────────
revoke all on table public.issue_updates from public, anon, authenticated;
grant select on table public.issue_updates to authenticated;
grant insert (issue_id, project_id, category, body, mentioned_member_ids,
              author_user_id, author_name)
  on table public.issue_updates to authenticated;
grant update (archived_at, archived_by, archived_by_name)
  on table public.issue_updates to authenticated;
grant delete on table public.issue_updates to authenticated;
grant all on table public.issue_updates to service_role;

-- ── 3) RLS ──────────────────────────────────────────────────────────────────
-- 이슈 계열 서버 액션은 createServerClient(anon key + 세션 쿠키)로 쓰므로 여기 정책이
-- 서버 액션 가드의 2차 방어선으로 실제 작동한다. 틀리게 쓰면 기능이 그냥 막힌다.
alter table public.issue_updates enable row level security;

drop policy if exists read_issue_updates   on public.issue_updates;
drop policy if exists insert_issue_updates on public.issue_updates;
drop policy if exists update_issue_updates on public.issue_updates;
drop policy if exists delete_issue_updates on public.issue_updates;

-- 조회 개방은 의도 — 이슈 본문·첨부와 동일하다(0041:60, 0068:96).
create policy read_issue_updates on public.issue_updates
  for select to authenticated using (true);

-- 등록: '진행 저장'과 같은 등급(멤버). uuid 위조는 여기가, 표시 필드·kind·created_at
-- 위조는 컬럼 스코프 grant 가 막는다 — 둘 다 있어야 한다.
create policy insert_issue_updates on public.issue_updates
  for insert to authenticated
  with check (public.is_project_member(project_id)
              and author_user_id = auth.uid()
              and kind = 'note'
              and archived_at is null
              and archived_by is null
              and archived_by_name is null);

-- 취소선/되돌리기: 이력 작성자 본인 또는 프로젝트 관리자.
--   can_edit_issue() 를 쓰면 안 된다 — 그건 '이슈' 작성자 기준이라 남의 코멘트를 긋게 된다.
--   with check 에 using 과 같은 술어를 그대로 쓰면 항상 참이라 archived_by 를 남의 uuid 로
--   위조할 수 있다(그 컬럼이 grant 안에 있으므로).
--   using 에 kind = 'note' 를 반드시 넣는다 — status 감사 행은 취소선을 못 긋는다는 규칙이
--   서버 액션(issueUpdates.ts)에만 있고 여기 없으면 뚫린다. 이 파일 머리(브라우저가 anon
--   key + 세션 쿠키로 PostgREST 를 직접 때리는 경로가 실사용 중)가 말하는 위협이 INSERT·
--   컬럼 grant 뿐 아니라 이 UPDATE 정책에도 그대로 적용된다: status 행은 author_user_id 가
--   상태를 바꾼 그 사용자라 using 의 첫 항을 그대로 만족하므로, kind 를 안 걸면 자기 감사
--   기록을 앱을 거치지 않고 지울 수 있다.
create policy update_issue_updates on public.issue_updates
  for update to authenticated
  using ((author_user_id = auth.uid() or public.is_project_admin(project_id))
         and kind = 'note')
  with check (
    num_nonnulls(archived_at, archived_by, archived_by_name) = 0
    or (archived_at is not null and archived_by = auth.uid())
  );

-- 완전 삭제: 프로젝트 관리자만. is_project_admin 은 0052:43-48 에서 슈퍼유저를 포함한다.
create policy delete_issue_updates on public.issue_updates
  for delete to authenticated using (public.is_project_admin(project_id));

reset search_path;

commit;
