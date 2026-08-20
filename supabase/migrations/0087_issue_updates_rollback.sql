-- 0087 롤백 — issue_updates 를 통째로 제거한다.
-- 주의: 이력 데이터가 함께 사라진다. 0088 백필까지 적용한 뒤 되돌리는 경우
-- issues.resolution_note 는 원래 값 그대로 남아 있으므로(0088 은 그 컬럼을 건드리지 않는다)
-- 화면은 롤백 직후 예전 동작으로 정확히 복귀한다.

begin;

drop policy if exists read_issue_updates   on public.issue_updates;
drop policy if exists insert_issue_updates on public.issue_updates;
drop policy if exists update_issue_updates on public.issue_updates;
drop policy if exists delete_issue_updates on public.issue_updates;

drop table if exists public.issue_updates;

commit;
