-- 0048 롤백. 큐레이션 RPC와 실행 권한을 제거하고 change_type CHECK를 0045 상태로 되돌린다.
-- 주의: 'curate' 이벤트가 이미 쌓인 뒤에는 CHECK 복원이 실패한다. 그 경우 아래 정리 구문을
-- 의도적으로 실행한 뒤 다시 시도해야 하며, 사람이 남긴 정리 이력이 사라진다.
-- 이미 archive/resolve된 항목의 상태 자체는 되돌리지 않는다(운영 데이터).

set search_path = public;

drop function if exists public.merge_wiki_topics(uuid, uuid);
drop function if exists public.curate_wiki_item(uuid, text, text);
drop function if exists public.wiki_key_slug(text);

-- delete from public.wiki_change_events where change_type = 'curate';

alter table public.wiki_change_events
  drop constraint if exists wiki_change_events_change_type_check;
alter table public.wiki_change_events
  add constraint wiki_change_events_change_type_check
  check (change_type in (
    'new','reaffirm','refine','supersede','reverse','conflict','resolve','retract'
  ));

alter table public.wiki_change_events drop constraint if exists wiki_change_events_actor_fk;
alter table public.wiki_change_events drop column if exists actor_id;

reset search_path;
