-- 알림함(inbox) 저장 계층 — 개인 알림 이벤트/수신자.
--
-- 핵심 계약 (스펙: docs/superpowers/specs/2026-08-11-notification-inbox-design.md)
--   1) 쓰기는 service_role 전용이다. INSERT/UPDATE/DELETE 정책을 만들지 않는 것이 곧 쓰기 차단이다.
--      발행(emit)·읽음 처리 전부 서버 액션 가드가 유일한 관문이다(0051/0057 관례).
--   2) 전체 알림(공지)은 여기 저장하지 않는다 — 기존 announcements + announcement_seen(0012)이
--      이미 그 구조라 재사용한다. audience 'project'/'global' 값은 훗날을 위한 예약이다.
--   3) 수신자 키는 이원 — 프로젝트 사건은 member_id(로스터 축, 0019 user_id nullable 함정 회피),
--      프로젝트 밖 사건(system.* 계열)만 user_id 직접. CHECK 로 최소 한 축을 강제한다.
--   4) 배지는 unseen(seen_at is null) 카운트다 — 카운터 컬럼을 두지 않는다(드리프트 원천).
--   5) retention: 읽은 지 90일 지난 수신자 행과 고아 이벤트만 purge — 안읽음은 보존한다.
--
-- 멱등: 반복 실행 안전. 적용: Supabase Management API POST /v1/projects/<ref>/database/query.
-- 적용 순서: 이 마이그레이션 먼저, 발행·화면 코드는 다음 배포(0027 PGRST 교훈).
-- 롤백: 0074_notification_inbox_rollback.sql (수신 이력이 전부 소실된다).

begin;

set search_path = public, extensions;

create table if not exists public.notification_events (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  category      text not null check (category in ('work','issue','meeting','announce','system')),
  audience      text not null default 'direct' check (audience in ('direct','project','global')),
  project_id    uuid null references public.projects(id) on delete cascade,
  actor_user_id uuid null,
  entity_type   text null,
  entity_id     uuid null,
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text null,
  created_at    timestamptz not null default now()
);

create unique index if not exists notification_events_dedupe
  on public.notification_events (dedupe_key) where dedupe_key is not null;
create index if not exists notification_events_project
  on public.notification_events (project_id, created_at desc);

create table if not exists public.notification_recipients (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.notification_events(id) on delete cascade,
  -- 프로젝트 사건의 수신자 키. on delete cascade — 로스터에서 빠진 사람의 알림은 의미를 잃는다.
  member_id   uuid null references public.project_members(id) on delete cascade,
  -- 발행 시점의 계정 링크 스냅샷(realtime 채널 키) 겸 프로젝트 밖 사건의 수신자 키.
  user_id     uuid null references auth.users(id) on delete cascade,
  seen_at     timestamptz null,
  read_at     timestamptz null,
  archived_at timestamptz null,
  created_at  timestamptz not null default now(),
  constraint notification_recipients_identity check (member_id is not null or user_id is not null)
);

-- 같은 이벤트 중복 수신 불가 — 수신자 축별 부분 유니크.
create unique index if not exists notification_recipients_by_member
  on public.notification_recipients (event_id, member_id) where member_id is not null;
create unique index if not exists notification_recipients_by_user
  on public.notification_recipients (event_id, user_id) where member_id is null;
-- 배지(unseen) 카운트 전용.
create index if not exists notification_recipients_badge
  on public.notification_recipients (user_id) where seen_at is null;
-- 피드 조회.
create index if not exists notification_recipients_feed
  on public.notification_recipients (user_id, created_at desc);

-- ── RLS ──
alter table public.notification_events enable row level security;
alter table public.notification_recipients enable row level security;

drop policy if exists read_notification_recipients on public.notification_recipients;
create policy read_notification_recipients on public.notification_recipients
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists read_notification_events on public.notification_events;
create policy read_notification_events on public.notification_events
  for select to authenticated
  using (
    exists (
      select 1 from public.notification_recipients r
      where r.event_id = notification_events.id and r.user_id = auth.uid()
    )
    or (audience = 'project' and public.is_project_member(project_id))
    or audience = 'global'
  );
-- INSERT/UPDATE/DELETE 정책 없음 = 쓰기는 service_role 만.

revoke all on table public.notification_events from public, anon, authenticated;
grant select on table public.notification_events to authenticated;
grant all on table public.notification_events to service_role;

revoke all on table public.notification_recipients from public, anon, authenticated;
grant select on table public.notification_recipients to authenticated;
grant all on table public.notification_recipients to service_role;

-- ── retention: 읽은 지 retention_days 지난 수신자 행 + 수신자가 0이 된 direct 이벤트 purge ──
create or replace function public.purge_read_notifications(retention_days int default 90)
returns table (recipients_deleted bigint, events_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  rc bigint; ec bigint;
begin
  delete from public.notification_recipients
    where read_at is not null and read_at < now() - make_interval(days => retention_days);
  get diagnostics rc = row_count;
  delete from public.notification_events e
    where e.audience = 'direct'
      and e.created_at < now() - make_interval(days => retention_days)
      and not exists (select 1 from public.notification_recipients r where r.event_id = e.id);
  get diagnostics ec = row_count;
  return query select rc, ec;
end;
$$;

revoke execute on function public.purge_read_notifications(int) from public, anon, authenticated;
grant execute on function public.purge_read_notifications(int) to service_role;

reset search_path;

commit;
