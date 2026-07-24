-- 0044 롤백. 주의: 0044 이후 추가된 팀 행/신규 팀 회의록이 있으면 add constraint 가 실패한다
-- — 롤백 전 해당 데이터를 정리해야 한다. 코드 롤백을 먼저 배포한 뒤 적용할 것.

drop policy if exists admin_insert_teams on teams;
drop policy if exists admin_update_teams on teams;

alter table teams add constraint teams_code_check
  check (code in ('PMO','가공','ERP','MES','MDM'));
alter table minutes add constraint minutes_team_code_check
  check (team_code in ('PMO','ERP','MES','가공','MDM'));

alter table teams drop column if exists progress_visible;
alter table teams drop column if exists active;
alter table teams drop column if exists sort_order;
