-- 0080 usage_events 행동 차원의 제약·인덱스. **0079 적용 후에 적용한다.**
--
-- 왜 0079 에서 분리했는가
--   usage_events 는 이 앱에서 쓰기가 가장 잦은 테이블이다 — 로그인 사용자의 라우트 전환
--   1건당 1행이 들어온다(src/components/app/UsageTracker.tsx → src/app/api/track/route.ts).
--   0079 는 1,400줄짜리 단일 트랜잭션인데, 그 안에서 `not valid` 없는 CHECK 를 붙이면
--   전체 힙 스캔이 ACCESS EXCLUSIVE 아래에서 돌고, non-concurrent 인덱스 빌드까지 겹친
--   뒤에도 그 락이 commit 까지 유지된다. 그동안 들어오는 /api/track insert 는 전부 락을
--   기다리며 PostgREST 커넥션을 점유한다. 컴퓨트는 Micro(직접연결 60·풀러 200)이고
--   2026-08-05 에 이미 PostgREST 풀 고갈로 장애가 난 사양이다(CLAUDE.md). 풀이 마르면
--   usage 뿐 아니라 앱 전체 쿼리가 실패한다.
--   컬럼 추가 자체는 상수 기본값이라 PG11+ 고속경로(rewrite 없음)여서 0079 에 남겼다.
--   0079 의 usage_summary 등 집계 함수가 event_name 을 참조하므로 컬럼은 그쪽에 있어야
--   한다. 스캔이 도는 이 두 문장만 짧은 파일로 떼어내 락 창을 격리한다.
--
-- 적용 전 확인: 트래픽이 한산한 시간대인지, 그리고 장기 트랜잭션이 없는지.
--   select pid, state, query_start, left(query, 80) from pg_stat_activity
--    where state <> 'idle' order by query_start;
--
-- 롤백: 0080_usage_event_dimensions_rollback.sql (제약·인덱스만 제거. 데이터 소실 없음)

begin;

-- 락을 3초 안에 못 잡으면 물러난다. Postgres 락 큐는 FIFO 라, ALTER 가 장기 리더를
-- 기다리는 동안 그 뒤의 평범한 SELECT 까지 같이 멈춘다. 전량 롤백되며 이 파일은
-- 멱등이므로 그대로 재실행하면 된다.
set local lock_timeout = '3s';
set local statement_timeout = '300s';

set search_path = public, extensions;

-- 0079 가 컬럼을 만들었는지 먼저 확인한다. 순서를 뒤집어 적용하면 조용히 통과하는 대신
-- 여기서 멈춰야 한다(에러 처리 3원칙 — 모르면 중단).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usage_events'
      and column_name = 'event_name'
  ) then
    raise exception '0080 은 0079 적용 후에만 실행할 수 있다 — usage_events.event_name 이 없다';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_event_name_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_event_name_check
      check (btrim(event_name) <> '' and char_length(event_name) <= 80);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_metadata_object_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_metadata_object_check
      check (jsonb_typeof(metadata) = 'object');
  end if;
end
$$;

-- CREATE INDEX 는 SHARE 락이라 조회는 계속 되고 쓰기만 잠깐 막힌다. CONCURRENTLY 를 쓰지
-- 않은 이유: db:apply 는 파일 전문을 한 요청으로 보내고 다중 문장은 하나의 암묵 트랜잭션에
-- 묶이는데, CREATE INDEX CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다.
-- usage_events 는 90일 보존(src/lib/domain/usage.ts USAGE_RETAIN_DAYS)이라 상한이 있다.
create index if not exists usage_events_event_name_idx
  on public.usage_events (event_name, occurred_at desc);

reset search_path;

commit;

notify pgrst, 'reload schema';
