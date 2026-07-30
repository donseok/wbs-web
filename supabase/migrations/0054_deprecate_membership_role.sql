-- memberships.role 을 deprecated 로 박제한다. 컬럼은 삭제하지 않는다.
-- 삭제는 새 체계가 한 사이클 안정된 뒤 별도 작업으로 한다 — 지금 지우면
-- 롤백 경로(0052_rollback)가 데이터를 복원할 수 없다.

comment on column memberships.role is
  'DEPRECATED (2026-07-30, 0054). 권한 판정에 쓰지 않는다. 판정은 memberships.is_superuser + project_roles 를 본다. 신규 계정 생성 시 not null 을 채우기 위해 ''team_editor'' 를 넣는다. 삭제 시점 미정.';

comment on column memberships.is_superuser is
  '전역 등급. true 면 모든 프로젝트에 대해 관리자 권한. is_superuser() 헬퍼가 읽는다.';

comment on table project_roles is
  '프로젝트별 역할. 행이 없으면 그 프로젝트에서 조회 전용이다(viewer 값을 두지 않는 이유: "행 없음"과 "viewer 행"이 같은 뜻이 되면 판정이 갈라진다).';
