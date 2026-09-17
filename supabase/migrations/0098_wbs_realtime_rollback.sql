-- 0098 롤백 — 실시간 계층만 제거한다.
-- 저장·조회·기존 갱신 경로(revalidatePath, 경로 전환 재조회)는 무영향이다. 구독은 조용히
-- 아무것도 받지 못하게 되고, 화면은 실시간 이전의 동작으로 돌아간다.

begin;

set search_path = public, extensions;

drop trigger if exists wbs_items_broadcast on public.wbs_items;
drop function if exists public.wbs_items_broadcast();
drop policy if exists receive_project_wbs_channel on realtime.messages;

reset search_path;

commit;
