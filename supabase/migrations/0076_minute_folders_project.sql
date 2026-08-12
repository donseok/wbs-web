-- 0076: minute_folders 프로젝트 소속 재편
-- 스펙: docs/superpowers/specs/2026-08-12-minutes-project-reorg-design.md
-- 회의록 보관함 트리 최상위를 프로젝트로 나누기 위해 폴더에 project_id 를 부여한다.
-- null = 미지정 영역(기존 전역 트리가 이동 없이 그대로 미지정 트리가 된다).
-- 멱등: 반복 실행 안전. 적용: npm run db:apply (Management API, db push 금지).
-- 데이터 재편철(folder_id 백필)은 SQL 이 아니라 scripts/backfill-0076.vitest.ts —
-- 라이브 resolveFolderPath 를 재사용해 두 번째 경로 해석 구현이 생기지 않게 한다.

alter table minute_folders add column if not exists project_id uuid
  references projects(id) on delete cascade;

create index if not exists minute_folders_project_idx on minute_folders (project_id);

-- 루트 이름 유니크 재편 — 시드 삽입 **전에** 전역 유니크를 해체해야 한다.
-- 프로젝트 루트(PMO 등)가 기존 전역 루트와 동명이라 순서를 바꾸면 시드가 23505 로 전멸한다.
drop index if exists minute_folders_root_name_uniq;
create unique index if not exists minute_folders_root_name_null_proj_uniq
  on minute_folders (name) where parent_id is null and project_id is null;
create unique index if not exists minute_folders_root_name_proj_uniq
  on minute_folders (project_id, name) where parent_id is null and project_id is not null;

-- 시드: 회의록이 있는 각 프로젝트에 유효 팀 마스터의 활성 팀코드 루트 생성.
-- 유효 팀 마스터 = 프로젝트 팀 행이 있으면 그것, 없으면 전역 폴백(teamsForProjectSync 규칙과 동일).
-- created_by 는 넣지 않는다(null = 시드 표식, 0043 관례 — isTeamRootFolder 판정·스쿼팅 방어).
insert into minute_folders (name, sort, project_id)
select t.code, t.sort_order, p.id
from (select distinct project_id as id from minutes where project_id is not null) p
cross join lateral (
  select code, sort_order from teams
  where active and project_id = p.id
  union all
  select code, sort_order from teams
  where active and project_id is null
    and not exists (select 1 from teams t2 where t2.project_id = p.id)
) t
where not exists (
  select 1 from minute_folders f
  where f.parent_id is null and f.project_id = p.id and f.name = t.code
);
