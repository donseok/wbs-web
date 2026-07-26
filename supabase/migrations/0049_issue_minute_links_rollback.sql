-- 0049 롤백 — 회의록 블록 ↔ 이슈 연결과 이슈 시작일 확장을 제거한다.
--
-- 경고(데이터 소실)
--   · issue_links 의 모든 회의록 원문 연결, 원문/제목/일자 스냅샷이 삭제된다.
--   · issues.start_date 값이 전부 삭제된다. 이슈 자체와 due_date/담당자는 유지된다.
-- 순서: 회의록 이슈 등록 코드를 먼저 롤백한 뒤 이 파일을 적용한다. 새 코드가 살아 있는
--   상태에서 먼저 적용하면 RPC와 issue_links 조회가 PGRST 오류를 낸다.
-- 0045를 롤백해야 한다면 minute_versions를 참조하는 이 마이그레이션을 먼저 롤백해야 한다.
-- 멱등: 함수/정책/테이블/컬럼이 이미 없어도 반복 실행 안전하다.

set search_path = public, extensions;

drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, uuid, text,
  uuid, uuid, text, integer, text, text, text, text
);
-- 보안 리뷰 전 16인자 authenticated 오버로드가 남은 기적용 DB도 함께 정리한다.
drop function if exists public.create_issue_from_minute_block(
  uuid, text, text, text, uuid[], date, date, text,
  uuid, uuid, text, integer, text, text, text, text
);

-- drop policy if exists는 대상 테이블이 없으면 42P01이므로 재실행을 위해 가드한다.
do $$
begin
  if to_regclass('public.issue_links') is not null then
    execute 'drop policy if exists read_all_issue_links on public.issue_links';
    execute 'drop policy if exists member_insert_issue_links on public.issue_links';
  end if;
end
$$;

-- 인덱스와 FK/CHECK는 테이블과 함께 제거된다.
drop table if exists public.issue_links;

alter table if exists public.issues
  drop constraint if exists issues_date_range_check;
alter table if exists public.issues
  drop column if exists start_date;

-- issues_id_project_uidx는 0042 소유이며 issue_assignees가 계속 의존하므로 제거하지 않는다.

reset search_path;
