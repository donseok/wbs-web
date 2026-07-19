-- 0035 롤백 — 전제: MDM 데이터가 없어야 안전하다.
-- minutes.team_code='MDM' 행이 있으면 CHECK 재추가가 실패하고(fail-loud),
-- MDM 팀에 멤버십/담당(item_owners)이 있으면 teams 행 삭제가 FK로 실패한다 — 의도된 보호.

begin;

alter table minutes drop constraint minutes_team_code_check;
alter table minutes add constraint minutes_team_code_check
  check (team_code in ('PMO','ERP','MES','가공'));

delete from teams where code = 'MDM';

alter table teams drop constraint teams_code_check;
alter table teams add constraint teams_code_check
  check (code in ('PMO','가공','ERP','MES'));

commit;
