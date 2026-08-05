-- 0068 롤백 — 이슈 첨부의 메타·정책·게이트를 되돌린다.
--
-- ⚠️ **업로드된 파일 자체는 지우지 않는다.** storage.objects/storage.buckets 를 건드리지 않으므로
--    버킷과 파일은 그대로 남는다. 되돌릴 수 없는 사용자 데이터를 롤백이 파괴해서는 안 된다.
--    메타 테이블이 사라지므로 남은 객체는 고아가 되고, 정책도 사라져 service_role 로만 접근된다.
--    파일까지 정리하려면 롤백 후 아래를 **의도적으로** 실행할 것(복구 불가):
--      delete from storage.objects where bucket_id = 'issue-attachments';
--      delete from storage.buckets where id = 'issue-attachments';
--
-- 재적용은 안전하다 — 0068 의 버킷 insert 가 on conflict do update 라 상한이 다시 수렴하고,
-- 남아 있던 객체는 그대로 쓰인다(다만 메타가 없어 화면에는 보이지 않는다).
--
-- 순서가 중요하다: 스토리지 정책이 can_edit_issue 에 의존하므로 **정책을 먼저** 지운다.
-- 반대로 하면 의존성 때문에 drop function 이 실패한다.

begin;

set search_path = public, extensions;

-- 1) 스토리지 객체 정책 — 함수보다 먼저.
drop policy if exists "issue-attachments read"   on storage.objects;
drop policy if exists "issue-attachments insert" on storage.objects;
drop policy if exists "issue-attachments delete" on storage.objects;

-- 2) 메타 정책. 테이블과 함께 사라지지만 명시적으로 지워 순서 의존을 없앤다.
drop policy if exists read_issue_attachments   on public.issue_attachments;
drop policy if exists insert_issue_attachments on public.issue_attachments;
drop policy if exists delete_issue_attachments on public.issue_attachments;

-- 3) 메타 테이블(첨부 기록이 소실된다 — 위 경고 참조).
drop table if exists public.issue_attachments;

-- 4) 편집 게이트. 0068 이 신설한 함수라 되돌리면 사라진다(이전 버전이 없다).
drop function if exists public.can_edit_issue(uuid);

reset search_path;

commit;
