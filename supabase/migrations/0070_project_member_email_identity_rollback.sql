-- 경고: 0070 이후 정본으로 수렴한 이름은 그대로 둔다. 이름 일관성을 깨는 데이터로
-- 되돌리는 것은 복구가 아니며, 행 ID/FK를 유지한 현재 데이터는 구 스키마와 호환된다.
-- 순서: 최신 앱은 update_project_member_with_identity RPC에 의존하므로
--       앱을 0070 이전 버전으로 먼저 롤백한 뒤 이 SQL을 적용한다.

begin;

set search_path = public, extensions;

alter table public.project_members
  drop constraint if exists project_members_email_name_fkey;
alter table public.project_members
  drop constraint if exists project_members_name_normalized;

drop function if exists public.update_project_member_with_identity(
  uuid, text, text, uuid, text, text
);
drop trigger if exists zz_project_member_email_identity_trg on public.project_members;
drop function if exists public.enforce_project_member_email_identity();
drop table if exists public.project_member_identities;

reset search_path;

commit;
