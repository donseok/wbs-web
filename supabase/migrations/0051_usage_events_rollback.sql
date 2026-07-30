-- 0051 롤백 — 사용 현황 수집을 제거한다.
--
-- 경고(데이터 소실)
--   · usage_events 에 쌓인 접속 이력이 전부 삭제된다. 복구 경로 없음.
-- 순서: 수집·화면 코드를 먼저 롤백한 뒤 이 파일을 적용한다. 새 코드가 살아 있는 상태에서
--   먼저 적용하면 /api/track 과 /usage 가 PGRST 오류를 낸다.
-- 멱등: 함수/정책/테이블이 이미 없어도 반복 실행 안전하다.

set search_path = public, extensions;

drop function if exists public.usage_summary(date, date, date);
drop function if exists public.usage_daily_actives(date, date);
drop function if exists public.usage_menu_ranking(date, date);
drop function if exists public.usage_user_rollup(date, date);

-- drop policy if exists 는 대상 테이블이 없으면 42P01 이므로 재실행을 위해 가드한다.
do $$
begin
  if to_regclass('public.usage_events') is not null then
    execute 'drop policy if exists read_usage_events on public.usage_events';
  end if;
end
$$;

-- 인덱스와 FK 는 테이블과 함께 제거된다.
drop table if exists public.usage_events;

reset search_path;
