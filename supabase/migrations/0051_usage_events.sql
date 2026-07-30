-- 사용 현황(접속 로그·메뉴 사용량) 수집.
--
-- 핵심 계약
--   1) 쓰기는 service_role(/api/track) 전용이다. INSERT/UPDATE/DELETE 정책을 만들지 않는
--      것이 곧 쓰기 차단이다. 읽기만 authenticated 에 연다.
--   2) "초기 전원 공개 → 이후 관리자 전용" 전환의 **DB 쪽**은 read_usage_events 정책 한 줄
--      교체로 끝난다. 다만 전환이 끝나려면 앱 쪽 게이트(src/lib/authz/usageAccess.ts 의
--      canViewUsage)도 함께 바꿔야 한다 — 사용자 현황 표는 service_role 로 auth.users 를
--      읽으므로 RLS 를 타지 않고 그 함수가 유일한 관문이다. 정책만 바꾸면 차트는 비지만
--      계정 목록(이메일·마지막 로그인)은 그대로 노출된다.
--      GRANT 를 회수하는 0031·0050 방식은 되돌리기가 파괴적이라 쓰지 않는다.
--   3) app_role()/current_team() 에 의존하지 않는다 — 진행 중인 권한 3단 재설계가
--      app_role() 을 shim 으로 재정의할 예정이라 하드 의존은 충돌 지점이 된다.
--      (0017/0039 가 순수 auth.uid() 만 쓰는 이유와 같다.)
--   4) 집계 RPC 는 SECURITY INVOKER(기본값)다. 호출자의 RLS 가 그대로 적용되므로
--      위 2)의 정책 한 줄이 화면과 RPC 양쪽의 단일 관문이 된다.
--   5) 일자 버킷은 Asia/Seoul 기준이되, 술어는 occurred_at 범위 비교로 쓴다.
--      (occurred_at at time zone ...)::date = X 형태는 인덱스를 못 쓴다.
--   6) user_id 는 on delete cascade — 개인 활동 데이터이고 보존이 90일이라 감사
--      아카이브가 아니다. minute_highlights(0025) 가 같은 이유로 택한 선례를 따른다.
--      project_id 는 on delete set null — 프로젝트가 지워져도 접속 사실은 남는다.
--
-- 멱등: 반복 실행 안전(create ... if not exists / create or replace / drop policy if exists).
-- 적용: Supabase Management API POST /v1/projects/<ref>/database/query.
--       SUPABASE_DB_URL 이 비어 있어 pg 직결/supabase db push 는 쓰지 않는다.
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 수집·화면 코드를 배포한다(0027 PGRST 교훈).
-- 롤백: 0051_usage_events_rollback.sql (수집된 접속 이력이 전부 소실된다).
-- updated_at 트리거를 만들지 않는다 — 이 테이블은 append-only 다.

set search_path = public, extensions;

-- ── 1) 이벤트 테이블 ──
create table if not exists public.usage_events (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  menu_key    text not null,
  path        text not null,
  project_id  uuid references public.projects(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_occurred_idx on public.usage_events (occurred_at desc);
create index if not exists usage_events_user_idx     on public.usage_events (user_id, occurred_at desc);
create index if not exists usage_events_menu_idx     on public.usage_events (menu_key, occurred_at desc);

-- ── 2) RLS ──
alter table public.usage_events enable row level security;

drop policy if exists read_usage_events on public.usage_events;
create policy read_usage_events on public.usage_events
  for select
  to authenticated
  using (true);
-- INSERT/UPDATE/DELETE 정책 없음 = 쓰기는 service_role 만.

revoke all on public.usage_events from anon;
grant select on public.usage_events to authenticated;
revoke insert, update, delete on public.usage_events from anon, authenticated;

-- bigserial 시퀀스도 함께 잠근다(쓰기 권한이 없으므로 필요 없지만 표면을 남기지 않는다).
do $$
declare seq text := pg_get_serial_sequence('public.usage_events', 'id');
begin
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
  end if;
end
$$;

-- ── 3) 집계 RPC (SECURITY INVOKER — 호출자 RLS 적용) ──

-- last_event_at 만 기간 밖 전체를 본다: 화면의 '수집 상태'(수집이 끊겼는가) 판정용이다.
create or replace function public.usage_summary(p_from date, p_to date, p_today date)
returns table (total_events bigint, active_users bigint, today_users bigint, last_event_at timestamptz)
language sql
stable
as $$
  select
    (select count(*) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')),
    (select count(distinct user_id) from public.usage_events
       where occurred_at >= (p_today::timestamp at time zone 'Asia/Seoul')
         and occurred_at <  ((p_today + 1)::timestamp at time zone 'Asia/Seoul')),
    (select max(occurred_at) from public.usage_events);
$$;

create or replace function public.usage_daily_actives(p_from date, p_to date)
returns table (d date, active_users integer, events integer)
language sql
stable
as $$
  select (occurred_at at time zone 'Asia/Seoul')::date,
         count(distinct user_id)::int,
         count(*)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by 1
  order by 1;
$$;

create or replace function public.usage_menu_ranking(p_from date, p_to date)
returns table (menu_key text, events integer, active_users integer)
language sql
stable
as $$
  select menu_key,
         count(*)::int,
         count(distinct user_id)::int
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by menu_key
  order by 2 desc, 1;
$$;

create or replace function public.usage_user_rollup(p_from date, p_to date)
returns table (user_id uuid, events integer, active_days integer, last_at timestamptz)
language sql
stable
as $$
  select user_id,
         count(*)::int,
         count(distinct (occurred_at at time zone 'Asia/Seoul')::date)::int,
         max(occurred_at)
  from public.usage_events
  where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  group by user_id;
$$;

-- 접속 횟수 — 로그인이 서버에 기록되지 않으므로 무활동 간격으로 유도한다(스펙 §6).
-- 반드시 **사용자별로** 끊어야 한다: 전 사용자 이벤트를 한 줄로 섞으면 동시 사용 중에는
-- 어떤 두 이벤트 사이에도 30분 간격이 생기지 않아 접속 수가 1로 붕괴한다.
-- lag() 를 user_id 로 partition 해 각 사용자의 '세션 시작' 행만 센다.
create or replace function public.usage_sessions(p_from date, p_to date, p_gap_minutes integer default 30)
returns integer
language sql
stable
as $$
  with ordered as (
    select user_id,
           occurred_at,
           lag(occurred_at) over (partition by user_id order by occurred_at) as prev_at
    from public.usage_events
    where occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and occurred_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
  )
  select count(*)::int
  from ordered
  where prev_at is null
     or occurred_at - prev_at > make_interval(mins => p_gap_minutes);
$$;

grant execute on function public.usage_summary(date, date, date) to authenticated;
grant execute on function public.usage_daily_actives(date, date)  to authenticated;
grant execute on function public.usage_menu_ranking(date, date)   to authenticated;
grant execute on function public.usage_user_rollup(date, date)    to authenticated;
grant execute on function public.usage_sessions(date, date, integer) to authenticated;

reset search_path;
