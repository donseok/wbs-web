-- 0042 롤백 — issue_assignees 를 단일 컬럼으로 되돌리고 테이블을 제거한다.
--
-- 경고(데이터 축소): 담당자가 2명 이상인 이슈는 **1명만 남는다**(가장 먼저 지정된 담당자 —
--   created_at, member_id 순). 어떤 담당자가 남는지는 이 정렬 규칙이 결정하며 되돌릴 수 없다.
-- 순서: 코드 롤백(단일 담당자 코드로 복귀) → 이 파일 적용. 새 코드가 살아 있는 상태로 먼저
--   적용하면 getIssues 의 issue_assignees 조회가 매 요청 PGRST 오류를 남긴다(화면은 [] 폴백).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (정방향과 동일 경로).
-- 멱등: to_regclass 가드 + if exists 라 반복 실행 안전.

do $$
begin
  if to_regclass('public.issue_assignees') is not null then
    -- 조인 행을 단일 컬럼으로 되돌린다 — 0042 이후 새 코드는 컬럼을 갱신하지 않았으므로
    -- 컬럼의 박제값이 아니라 조인 테이블이 정본이다. 전량 다시 계산해 덮어쓴다.
    execute $q$
      update issues i
      set assignee_member_id = (
        select a.member_id
        from issue_assignees a
        where a.issue_id = i.id
        order by a.created_at, a.member_id
        limit 1
      )
    $q$;
    execute 'drop policy if exists read_all_issue_assignees on issue_assignees';
    execute 'drop policy if exists member_insert_issue_assignees on issue_assignees';
    execute 'drop policy if exists member_delete_issue_assignees on issue_assignees';
    execute 'drop table issue_assignees';
  end if;
end $$;

-- issues_id_project_uidx 는 남겨 둔다 — 다른 의존이 없고 무해하며, 재적용 시 그대로 쓴다.
