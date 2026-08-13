-- 0080 rollback. 제약과 인덱스만 되돌린다 — 데이터 소실은 없다.
--
-- 주의: usage_events.event_name / metadata 컬럼 자체는 0079 가 만들었으므로 여기서
-- 내리지 않는다. 컬럼까지 되돌리려면 0079_wiki_memory_rollback.sql 을 쓴다(그쪽은 제품
-- 이벤트 행 삭제를 포함하므로 데이터 소실 경고를 반드시 읽을 것).

begin;

set local lock_timeout = '3s';

set search_path = public, extensions;

drop index if exists public.usage_events_event_name_idx;

alter table public.usage_events
  drop constraint if exists usage_events_metadata_object_check;
alter table public.usage_events
  drop constraint if exists usage_events_event_name_check;

reset search_path;

commit;

notify pgrst, 'reload schema';
