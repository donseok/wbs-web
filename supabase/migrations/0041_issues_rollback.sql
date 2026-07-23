-- 0041 롤백 — issues 테이블을 제거해 0041 적용 이전 상태로 되돌린다.
--
-- 경고(데이터 소실): 등록된 모든 이슈(제목/본문/상태/조치 경과/resolved_at)가 함께 사라진다.
--   issue_no 발번 시퀀스도 테이블과 함께 제거되므로 재적용 시 #1 부터 다시 시작한다 —
--   소급 발번 불가(스펙 §2). 필요하면 drop 전에 백업할 것.
-- 순서: 코드가 이 테이블을 읽는 상태에서 먼저 drop 하면 getIssues 가 매 요청 PGRST 오류를
--       로그에 남긴다(읽기 계층은 실패 시 [] 폴백이라 화면은 죽지 않는다). 가능하면 코드 롤백 후 적용할 것.
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (정방향과 동일 경로,
--       db push 금지). 멱등: if exists 라 반복 실행 안전.
-- 주의: project_members_id_project_uidx 는 drop 하지 않는다 — 0032 소유이며
--       attendance_member_project_fk 가 의존한다(drop 시도 시 dependent objects 오류).

-- 정책 drop 은 테이블 존재를 전제한다(drop policy if exists 의 if exists 는 정책만 커버 —
-- 테이블이 이미 없으면 42P01). 재실행 안전을 위해 to_regclass 로 감싼다.
do $$
begin
  if to_regclass('public.issues') is not null then
    execute 'drop policy if exists read_all_issues on issues';
    execute 'drop policy if exists insert_own_issues on issues';
    execute 'drop policy if exists member_update_issues on issues';
    execute 'drop policy if exists delete_own_issues on issues';
  end if;
end $$;

drop table if exists issues;
