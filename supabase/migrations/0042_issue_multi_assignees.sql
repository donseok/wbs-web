-- 이슈 담당자 다중화 — 단일 assignee_member_id 컬럼 → issue_assignees 조인 테이블(회의 0013 참석자 관례).
-- 권한: 읽기 = 인증 사용자 전체 / 쓰기(insert·delete) = 멤버 전체 — 담당자는 0041 헤더가 정의한
--       '진행 필드'(멤버 전체 수정 가능)이므로 issues 의 member_update 완화와 같은 수위로 맞춘다.
--       행 세분화(작성자 한정 등)는 서버 액션(src/app/actions/issues.ts)이 강제한다.
-- 멱등: SQL Editor 반복 실행 안전(create table/index if not exists, drop policy if exists,
--       백필은 on conflict do nothing).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0041 과 동일 경로,
--       .env.local 의 SUPABASE_DB_URL 비어 있음 — pg 직결/db push 금지).
-- 적용 순서: 이 마이그레이션을 **먼저** 적용하고 **곧바로** 코드를 배포한다(0027/0041 관례) —
--       새 코드의 getIssues 가 issue_assignees 를 읽으므로 테이블이 먼저 있어야 한다.
--       주의(적용~배포 창): 구 코드는 이 구간에도 assignee_member_id 에 계속 쓰고, 백필은 적용
--       시점 1회뿐이라 그 쓰기는 조인 테이블에 반영되지 않는다 — 창에서 지정된 담당자는 배포 후
--       화면에서 사라져 보인다. 창을 분 단위로 유지하고, **배포 완료 직후 아래 4) 백필 insert 를
--       한 번 더 실행**해 창에서 새로 지정된 담당자를 회수할 것(멱등 — 담당자 '변경'(A→B)만은
--       A·B 가 함께 남는 한계가 있으므로 그 경우 화면에서 직접 정리).
-- 롤백: 0042_issue_multi_assignees_rollback.sql (담당자 2명 이상인 이슈는 1명만 남는다 — 헤더 경고 참조).
-- 주의: issues.assignee_member_id 컬럼은 **drop 하지 않는다** — 코드 롤백 시 읽을 곳이 있어야 하고,
--       drop 하면 구 코드가 배포 구간에서 매 요청 PGRST 오류를 낸다. 이 마이그레이션 이후 새 코드는
--       이 컬럼을 읽지도 쓰지도 않으므로 값은 백필 시점에 박제된 과거값이다(참조 금지). 완전 제거는
--       코드 안정화 뒤 별도 마이그레이션의 몫.

-- ── 1) 복합 FK 전제 유니크 인덱스 ──
-- (issue_id, project_id) FK 로 '조인 행의 프로젝트 = 이슈의 프로젝트'를 DB 에서 못박기 위한 전제.
-- id 가 PK 라 (id, project_id) 는 논리적으로 유니크 — 인덱스는 FK 참조 대상 요건을 채우는 형식 요건이다.
create unique index if not exists issues_id_project_uidx
  on public.issues (id, project_id);

-- 0032 소유 인덱스의 방어적 재선언(0041 과 동일한 멱등 no-op) — 신규/미적용 DB 재현용.
create unique index if not exists project_members_id_project_uidx
  on public.project_members (id, project_id);

-- ── 2) 조인 테이블 ──
-- project_id 를 비정규 보관하는 이유: 두 복합 FK 가 같은 열을 물게 해
-- '담당자의 프로젝트 = 이슈의 프로젝트'를 앱 검증 없이도 DB 가 보장하게 만든다
-- (0041 이 단일 컬럼에서 복합 FK 로 얻던 것과 같은 방어를 조인 테이블로 확장).
create table if not exists issue_assignees (
  issue_id uuid not null,
  member_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, member_id),
  constraint issue_assignees_issue_project_fk
    foreign key (issue_id, project_id)
    references issues (id, project_id)
    on delete cascade,
  -- 멤버 삭제 시 담당 행도 함께 삭제 — 0041 의 SET NULL(단일 컬럼)의 조인 테이블 대응.
  constraint issue_assignees_member_project_fk
    foreign key (member_id, project_id)
    references project_members (id, project_id)
    on delete cascade
);

-- 프로젝트 단위 일괄 조회(getIssues)와 멤버 역조회용.
create index if not exists issue_assignees_project_idx on issue_assignees(project_id);
create index if not exists issue_assignees_member_idx on issue_assignees(member_id);

-- ── 3) RLS ──
alter table issue_assignees enable row level security;

drop policy if exists read_all_issue_assignees on issue_assignees;
create policy read_all_issue_assignees on issue_assignees
  for select to authenticated using (true);

-- 담당자 지정/해제는 진행 필드 — issues 의 member_update 완화(0041 헤더)와 같은 수위.
drop policy if exists member_insert_issue_assignees on issue_assignees;
create policy member_insert_issue_assignees on issue_assignees
  for insert to authenticated
  with check (app_role() is not null);

drop policy if exists member_delete_issue_assignees on issue_assignees;
create policy member_delete_issue_assignees on issue_assignees
  for delete to authenticated
  using (app_role() is not null);

-- ── 4) 백필 — 기존 단일 담당자를 조인 행으로 ──
-- on conflict do nothing: 재실행 안전 + 이미 새 코드가 넣은 행과 충돌하지 않는다.
insert into issue_assignees (issue_id, member_id, project_id)
select id, assignee_member_id, project_id
from issues
where assignee_member_id is not null
on conflict do nothing;
