-- 0075 롤백 — 실시간 계층만 제거한다. 알림 저장·폴링 경로는 무영향.

begin;

set search_path = public, extensions;

drop trigger if exists notify_recipient_broadcast on public.notification_recipients;
drop function if exists public.notify_recipient_broadcast();
drop policy if exists receive_own_notification_channel on realtime.messages;

reset search_path;

commit;
