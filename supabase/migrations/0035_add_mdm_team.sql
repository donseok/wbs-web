-- 구분(team)에 MDM 신설 (또박또박 연동 F6 — docs/design/dflow-minutes-upload-api-spec.md §9.8)
-- 팀 코드셋은 3계층(DB CHECK / TS 상수·유니온 / CSS 토큰) — 이 파일은 DB 계층, 코드 계층은 같은 배포에 포함.
-- 주의: 프로덕션 적용은 Management API 경로(레포 기록용). 레포 ≠ 프로덕션 드리프트 이력이 있으므로
--       적용 전 pg_constraint 에서 실제 제약명(teams_code_check, minutes_team_code_check)을 확인할 것.

begin;

-- 1) teams.code CHECK 교체(0014가 만든 named 제약 — drop→재추가 선례 그대로) + MDM 팀 행 추가
alter table teams drop constraint teams_code_check;
alter table teams add constraint teams_code_check
  check (code in ('PMO','가공','ERP','MES','MDM'));

insert into teams (code, name) values ('MDM','MDM')
  on conflict (code) do nothing;

-- 2) minutes.team_code CHECK 교체(0021 인라인 무명 제약 — PG 자동명 minutes_team_code_check)
alter table minutes drop constraint minutes_team_code_check;
alter table minutes add constraint minutes_team_code_check
  check (team_code in ('PMO','ERP','MES','가공','MDM'));

commit;
