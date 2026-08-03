-- 0065 롤백 — 프로젝트 초대 테이블과 소비 함수를 제거한다.
--
-- ⚠️ 경고(데이터 소실)
--   · 발급된 초대와 합류 이력("누가 만든 어떤 초대로 누가 언제 들어왔나")이 전부 사라진다.
--   · 유통 중인 초대 링크는 즉시 전부 무효가 된다.
--   · 이미 합류한 사람의 project_roles·memberships 는 이 파일이 건드리지 않는다 —
--     롤백해도 권한은 회수되지 않으므로, 회수가 필요하면 별도로 정리할 것.
-- 순서: 초대 코드를 먼저 되돌린 뒤 이 파일을 적용한다. 새 코드가 살아 있는 상태에서 먼저
--   적용하면 설정 화면과 /invite 가 PGRST 오류를 낸다(코드 먼저, DB 나중 — runbook-rollback 관례).
-- 멱등: 함수·테이블이 이미 없어도 반복 실행 안전하다.

begin;

set search_path = public, extensions;

-- 역순 — 테이블을 참조하는 함수를 먼저 지운다.
drop function if exists public.consume_project_invite(uuid, text, uuid);

-- 인덱스와 제약은 테이블과 함께 사라진다. 정책은 애초에 만들지 않았다(0065 헤더 4항).
drop table if exists public.project_invites;

reset search_path;

commit;
