-- tests/migrations/sql/0109-scenario.sql — 0109 에이전트 콘솔의 동작 시나리오. 기대와 다르면 예외로 멈춘다.
-- 빈 데이터베이스에 0109 를 적용한 뒤 psql -v ON_ERROR_STOP=1 로 돌린다(tests/migrations/0109-agent-console.test.ts).
-- 바탕(auth.users·Supabase 역할)은 tests/migrations/sql/supabase-base.sql 이 만든다.
\set ON_ERROR_STOP 1
create or replace function pg_temp.eq(got anyelement, want anyelement, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if;
end $$;
create or replace function pg_temp.enq(t text, k text, r text) returns text language sql as $$
  select outcome from public.agent_console_enqueue('11111111-1111-1111-1111-111111111111', 'mbp', k, r, t)
$$;
create or replace function pg_temp.pid(t text) returns uuid language sql as $$
  select id from public.agent_console_prompts where text = t
$$;
create or replace function pg_temp.ack(t text, tok text, res text, rsn text, det text) returns text language sql as $$
  select outcome || '|' || coalesce(status, '-') from public.agent_console_ack('11111111-1111-1111-1111-111111111111', pg_temp.pid(t), tok, res, rsn, det)
$$;
create or replace function pg_temp.raises(sql text, code text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL %: no error', what;
exception when others then
  if sqlstate <> code then raise exception 'FAIL %: sqlstate % want %', what, sqlstate, code; end if;
end $$;

-- 넣기: 같은 대상 3건까지, 4건째 queue_full. 1분 5건까지, 6건째 rate_limited.
select pg_temp.eq(pg_temp.enq('one', 'coord_lane', 'kit'), 'ok', 'enqueue 1');
select pg_temp.eq(pg_temp.enq('two', 'coord_lane', 'kit'), 'ok', 'enqueue 2');
select pg_temp.eq(pg_temp.enq('three', 'coord_lane', 'kit'), 'ok', 'enqueue 3');
select pg_temp.eq(pg_temp.enq('four', 'coord_lane', 'kit'), 'queue_full', 'queue_full');
select pg_temp.eq(pg_temp.enq('five', 'team_lead', 'lead'), 'ok', 'enqueue 4th in minute');
select pg_temp.eq(pg_temp.enq('six', 'team_worker', 'w1'), 'ok', 'enqueue 5th in minute');
select pg_temp.eq(pg_temp.enq('seven', 'team_worker', 'w2'), 'rate_limited', 'rate_limited');

-- 검사 제약: 느낌표·2001자·참조 형식·host 형식·목록 밖 사유는 거절, 2000자(코드포인트)는 받는다.
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text) values ('22222222-2222-2222-2222-222222222222','mbp','team_lead','lead','hi!')$q$, '23514', 'bang');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text) values ('22222222-2222-2222-2222-222222222222','mbp','team_lead','lead', repeat('가', 2001))$q$, '23514', 'too long');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text) values ('22222222-2222-2222-2222-222222222222','mbp','team_lead','임시','x')$q$, '23514', 'ref');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text) values ('22222222-2222-2222-2222-222222222222','MBP','team_lead','lead','x')$q$, '23514', 'host');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, reason) values ('22222222-2222-2222-2222-222222222222','mbp','team_lead','lead','x','whatever')$q$, '23514', 'reason');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, status) values ('22222222-2222-2222-2222-222222222222','mbp','team_lead','lead','x','claimed')$q$, '23514', 'claimed without token');
insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text)
  values ('22222222-2222-2222-2222-222222222222', 'mbp', 'team_lead', 'lead', repeat('가', 2000));

-- claim: 오래된 순, token_index 와 저장된 해시가 짝이 맞는다. 다음 claim 은 다른 행만 받는다.
create temp table c1 as select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[repeat('a',64), repeat('b',64)]);
select pg_temp.eq((select string_agg(text, ',' order by token_index) from c1), 'one,two', 'claim oldest first');
select pg_temp.eq((select count(*) from c1 c join public.agent_console_prompts p on p.id = c.id
                   where p.claim_token_hash = (array[repeat('a',64), repeat('b',64)])[c.token_index])::int, 2, 'token pairing');
select pg_temp.eq((select string_agg(text, ',') from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[repeat('c',64)])), 'three', 'claim next');
select pg_temp.eq((select count(*) from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'other', array[repeat('d',64)]))::int, 0, 'other host');
select pg_temp.eq((select count(*) from public.agent_console_claim('22222222-2222-2222-2222-222222222222', 'mbp', array[repeat('e',64)]))::int, 1, 'other owner own row');
select pg_temp.raises($q$select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[]::text[])$q$, '22023', 'zero tokens');
select pg_temp.raises($q$select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array_fill(repeat('f',64), array[11]))$q$, '22023', 'eleven tokens');

-- ack: sent ok → 같은 결과 already → 다른 결과 conflict, 토큰 불일치·남의 행 not_found. 계약 규칙 위반은 22023.
select pg_temp.eq(pg_temp.ack('one', repeat('a',64), 'sent', null, 'submitted'), 'ok|sent', 'ack sent');
select pg_temp.eq(pg_temp.ack('one', repeat('a',64), 'sent', null, 'submitted'), 'already|sent', 'ack already');
select pg_temp.eq(pg_temp.ack('one', repeat('a',64), 'refused', 'error', null), 'conflict|sent', 'ack conflict');
select pg_temp.eq(pg_temp.ack('two', repeat('z',64), 'sent', null, null), 'not_found|-', 'ack wrong token');
select pg_temp.eq((select outcome from public.agent_console_ack('22222222-2222-2222-2222-222222222222', pg_temp.pid('two'), repeat('b',64), 'sent', null, null)), 'not_found', 'ack other owner');
select pg_temp.raises($q$select pg_temp.ack('two', repeat('b',64), null, null, null)$q$, '22023', 'null result');
select pg_temp.raises($q$select pg_temp.ack('two', repeat('b',64), 'refused', null, null)$q$, '22023', 'refused without reason');
select pg_temp.raises($q$select pg_temp.ack('two', repeat('b',64), 'retry', 'stale', null)$q$, '22023', 'retry non-compacting');
select pg_temp.raises($q$select pg_temp.ack('two', repeat('b',64), 'sent', null, 'typed')$q$, '22023', 'bad detail');
select pg_temp.raises($q$select pg_temp.ack('two', repeat('b',64), 'refused', 'whatever', null)$q$, '22023', 'unknown reason');

-- retry: 만료 전이면 pending(토큰·집은 시각 비움), 같은 retry 를 다시 부르면 not_found. 만료 뒤 retry 는 expired.
select pg_temp.eq(pg_temp.ack('two', repeat('b',64), 'retry', 'compacting', null), 'ok|pending', 'retry pending');
select pg_temp.eq((select claim_token_hash is null and claimed_at is null and finished_at is null from public.agent_console_prompts where text = 'two'), true, 'retry cleared');
select pg_temp.eq(pg_temp.ack('two', repeat('b',64), 'retry', 'compacting', null), 'not_found|-', 'retry repeat');
update public.agent_console_prompts set expires_at = now() - interval '1 second' where text = 'three';
select pg_temp.eq(pg_temp.ack('three', repeat('c',64), 'retry', 'compacting', null), 'ok|expired', 'retry after expiry');

-- 120초가 지난 claimed 는 늦은 ack 가 와도 unknown 으로 닫히고 되살아나지 않는다(ack 가 먼저 정리한다).
create temp table c2 as select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[repeat('1',64), repeat('2',64)]);
select pg_temp.eq((select string_agg(text, ',' order by token_index) from c2), 'two,five', 'reclaim after retry');
update public.agent_console_prompts set claimed_at = now() - interval '121 seconds' where text = 'five';
select pg_temp.eq(pg_temp.ack('five', repeat('2',64), 'sent', null, 'accepted'), 'conflict|unknown', 'late ack');

-- 정리: 만료 pending → expired, 최종 7일 지난 행 삭제.
update public.agent_console_prompts set expires_at = now() - interval '1 second' where text = 'six';
update public.agent_console_prompts set finished_at = now() - interval '8 days' where text = 'one';
select public.agent_console_sweep('11111111-1111-1111-1111-111111111111');
select pg_temp.eq((select string_agg(text || ':' || status, ',' order by created_at) from public.agent_console_prompts
                   where owner = '11111111-1111-1111-1111-111111111111'),
                  'two:claimed,three:expired,five:unknown,six:expired', 'sweep');

-- 화면: 40줄 받고 41줄·8KB 초과·NULL 칸은 거절, 같은 키는 덮어쓴다.
insert into public.agent_console_screens (owner, host, target_kind, target_ref, lines, sha, captured_at)
  values ('11111111-1111-1111-1111-111111111111', 'mbp', 'coord_lane', 'kit', array_fill('x'::text, array[40]), repeat('0',64), now());
select pg_temp.raises($q$insert into public.agent_console_screens (owner, host, target_kind, target_ref, lines, sha, captured_at) values ('11111111-1111-1111-1111-111111111111','mbp','coord_lane','k2', array_fill('x'::text, array[41]), repeat('0',64), now())$q$, '23514', '41 lines');
select pg_temp.raises($q$insert into public.agent_console_screens (owner, host, target_kind, target_ref, lines, sha, captured_at) values ('11111111-1111-1111-1111-111111111111','mbp','coord_lane','k3', array[repeat('가', 2731)], repeat('0',64), now())$q$, '23514', '8KB');
select pg_temp.raises($q$insert into public.agent_console_screens (owner, host, target_kind, target_ref, lines, sha, captured_at) values ('11111111-1111-1111-1111-111111111111','mbp','coord_lane','k4', array['a', null], repeat('0',64), now())$q$, '23514', 'null line');
insert into public.agent_console_screens (owner, host, target_kind, target_ref, lines, sha, captured_at)
  values ('11111111-1111-1111-1111-111111111111', 'mbp', 'coord_lane', 'kit', array['y'], repeat('1',64), now())
  on conflict (owner, host, target_kind, target_ref) do update set lines = excluded.lines, sha = excluded.sha, updated_at = now();
select pg_temp.eq((select count(*)::int || ':' || max(lines[1]) from public.agent_console_screens), '1:y', 'screen upsert');

-- 권한: authenticated 는 함수도 테이블도 못 만지고, 정책은 없다.
select pg_temp.eq(has_function_privilege('authenticated', 'public.agent_console_claim(uuid, text, text[])', 'execute'), false, 'auth exec');
select pg_temp.eq(has_function_privilege('service_role', 'public.agent_console_claim(uuid, text, text[])', 'execute'), true, 'service exec');
select pg_temp.eq(has_table_privilege('authenticated', 'public.agent_console_prompts', 'select'), false, 'auth select');
select pg_temp.eq(has_table_privilege('authenticated', 'public.agent_console_screens', 'truncate'), false, 'auth truncate');
select pg_temp.eq((select count(*)::int from pg_policies where tablename like 'agent_console_%'), 0, 'no policies');

\echo SCENARIO_OK
