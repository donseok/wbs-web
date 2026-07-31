-- 경고: 이 롤백은 생성된 이슈 분석 결과와 hard-delete 감사 스냅샷을 모두 삭제한다.

begin;

set search_path = public, extensions;

-- 테이블 DROP이 종속 RLS 정책도 함께 제거한다. 테이블 부재 시에도 멱등하게 성공한다.
drop index if exists public.issue_analysis_runs_project_created_idx;
drop table if exists public.issue_analysis_runs;

reset search_path;

commit;
