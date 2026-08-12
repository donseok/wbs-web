-- 알림 실시간 push — 수신자 행 INSERT 시 본인 private 채널로 broadcast.
--
-- 핵심 계약
--   1) postgres_changes 를 쓰지 않는다 — 구독자 수 비례 RLS 재검사가 Micro 컴퓨트(2vCPU 공유·1GB)에
--      불리하다. realtime.send(broadcast) 는 송신 1회로 끝난다.
--   2) 송신은 향상 계층이다 — 실패해도 알림 저장(INSERT)을 실패시키지 않는다(예외 삼킴).
--   3) 채널은 private — realtime.messages 의 select 정책이 본인 토픽만 허용한다.
--   4) user_id 없는 수신자(계정 미링크 로스터)는 송신 대상이 없으므로 생략.
--
-- 멱등: 반복 실행 안전. 적용: Supabase Management API(0074 와 동일).
-- 롤백: 0075_notification_realtime_rollback.sql (실시간만 꺼진다 — 저장·폴링은 무영향).

begin;

set search_path = public, extensions;

create or replace function public.notify_recipient_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('recipient_id', new.id, 'event_id', new.event_id),
        'new_notification',
        'user-' || new.user_id::text || '-notifications',
        true  -- private 채널
      );
    exception when others then
      null;  -- 송신 실패는 삼킨다 — 본 INSERT 를 지키는 것이 우선
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_recipient_broadcast on public.notification_recipients;
create trigger notify_recipient_broadcast
  after insert on public.notification_recipients
  for each row execute function public.notify_recipient_broadcast();

-- private 채널 수신 인가 — 본인 토픽만.
drop policy if exists receive_own_notification_channel on realtime.messages;
create policy receive_own_notification_channel on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'user-' || (select auth.uid())::text || '-notifications'
    and extension = 'broadcast'
  );

reset search_path;

commit;
