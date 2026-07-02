-- 멤버 이메일 형식 DB 계층 방어 — 앱 검증(isValidEmail)을 우회하는 SQL/PostgREST 직접 쓰기 차단.
-- 정규식은 src/lib/domain/validate.ts isValidEmail 과 동일 패턴 유지(공백·@·도메인 최소 형태만 확인).
-- 이메일은 선택 필드이므로 NULL 허용.
-- NOT VALID: 운영 DB에 기존 오염 행이 존재하므로 기존 행 검사를 건너뛰고 신규 쓰기만 검증한다.
-- 재실행 안전(SQL Editor 수동 적용 워크플로우): 기존 제약이 있으면 제거 후 다시 추가.
alter table project_members drop constraint if exists project_members_email_format;
alter table project_members
  add constraint project_members_email_format
  check (email is null or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') not valid;

-- [운영자 수동 실행 안내 — 자동 실행하지 않음]
-- 기존 오염 행 정리 후 제약을 validate 하려면 아래를 순서대로 실행:
--   update project_members
--     set email = null
--     where email is not null and email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';
--   alter table project_members validate constraint project_members_email_format;
-- 주의: 행 DELETE 금지 — attendance_records 가 member_id cascade 로 함께 삭제된다.
