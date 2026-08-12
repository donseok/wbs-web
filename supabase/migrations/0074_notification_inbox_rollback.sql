-- 0074 롤백 — 알림함 신규 객체만 제거한다. 기존 테이블은 0074 가 건드리지 않았으므로 복원 대상 없음.
-- ⚠️ 수신 이력(안읽음 포함)이 전부 소실된다.

begin;

set search_path = public, extensions;

drop function if exists public.purge_read_notifications(int);
drop table if exists public.notification_recipients;
drop table if exists public.notification_events;

reset search_path;

commit;
