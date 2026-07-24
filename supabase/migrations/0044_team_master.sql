-- 팀 런타임 마스터(스펙 2026-07-24-team-master-design.md): 메타 컬럼 추가 + CHECK 하드코딩 철거
-- + pmo_admin 쓰기 정책. 검증은 앱 계층(lib/teams/master 대조)으로 이동. 구코드에도 무해
-- (추가 컬럼·제약 완화뿐). 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지).
-- 멱등: 반복 실행 안전.

alter table teams add column if not exists sort_order int not null default 0;
alter table teams add column if not exists active boolean not null default true;
alter table teams add column if not exists progress_visible boolean not null default true;

update teams set sort_order = v.sort
from (values ('PMO', 0), ('ERP', 1), ('MES', 2), ('가공', 3), ('MDM', 4)) as v(code, sort)
where teams.code = v.code;

-- 대시보드 '팀별 진척현황' MDM 제외 규칙(기존 PROGRESS_TEAMS 하드코딩)의 데이터화.
update teams set progress_visible = false where code = 'MDM';

alter table teams drop constraint if exists teams_code_check;
alter table minutes drop constraint if exists minutes_team_code_check;

-- 읽기는 0002 read_all_teams(authenticated) 유지. 쓰기는 PMO 관리자만.
-- delete 정책은 만들지 않는다 — 삭제 대신 비활성화(active=false, 데이터 보존, 사용자 결정 2026-07-24).
drop policy if exists admin_insert_teams on teams;
create policy admin_insert_teams on teams for insert to authenticated with check (app_role() = 'pmo_admin');
drop policy if exists admin_update_teams on teams;
create policy admin_update_teams on teams for update to authenticated
  using (app_role() = 'pmo_admin') with check (app_role() = 'pmo_admin');
