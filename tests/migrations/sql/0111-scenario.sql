-- tests/migrations/sql/0111-scenario.sql — 0111 콘솔 키 입력의 동작 시나리오. 기대와 다르면 예외로 멈춘다.
-- 빈 데이터베이스에 바탕 → 0109 → (글 행 한 건 넣기) → 0111 을 적용한 뒤 psql -v ON_ERROR_STOP=1 로 돌린다(tests/migrations/0111-agent-console-keys.test.ts).
\set ON_ERROR_STOP 1
create or replace function pg_temp.eq(got anyelement, want anyelement, what text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', what, got, want; end if;
end $$;
create or replace function pg_temp.raises(sql text, code text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL %: no error', what;
exception when others then
  if sqlstate <> code then raise exception 'FAIL %: sqlstate % (%) want %', what, sqlstate, sqlerrm, code; end if;
end $$;
-- 시나리오 사용자 U1 의 레인 kit 에 키 행 넣기. 반환은 outcome.
create or replace function pg_temp.enqk(keys text[], sha_ch text, since text default '2026-10-06T01:00:00Z', ref text default 'kit', kind text default 'permission') returns text language sql as $$
  select outcome from public.agent_console_enqueue_keys('11111111-1111-1111-1111-111111111111', 'mbp', 'coord_lane', ref, keys, kind, since::timestamptz, repeat(sha_ch, 64))
$$;

-- 0109 시절에 넣은 글 행(pre)이 0111 뒤에도 그대로 text 행이다.
select pg_temp.eq((select input_kind || ':' || (keys is null)::text || ':' || (req_sha is null)::text from public.agent_console_prompts where text = 'pre'), 'text:true:true', 'legacy row is text');

-- 키 행 넣기: ok, text 는 사람이 읽는 표기, 만료는 60초, 같은 화면 상태는 already_sent.
select pg_temp.eq(pg_temp.enqk(array['1', 'Enter'], 'a'), 'ok', 'enqueue keys');
select pg_temp.eq((select text from public.agent_console_prompts where input_kind = 'keys'), '키: 1 Enter', 'keys text');
select pg_temp.eq((select expires_at - created_at <= interval '61 seconds' and expires_at - created_at >= interval '59 seconds' from public.agent_console_prompts where input_kind = 'keys'), true, 'keys expiry 60s');
select pg_temp.eq(pg_temp.enqk(array['2'], 'a'), 'already_sent', 'same screen state while pending');
select pg_temp.eq(pg_temp.enqk(array['2'], 'b'), 'ok', 'different sha is a different screen state');
select pg_temp.eq(pg_temp.enqk(array['2'], 'a', '2026-10-06T01:00:01Z'), 'ok', 'different since is a different screen state');

-- 검증: 목록 밖 키·5개·빈 배열·null 원소·2차원·대상 아님·입력 요청 종류 밖·sha 형식은 22023.
select pg_temp.raises($q$select pg_temp.enqk(array['0'], 'c')$q$, '22023', 'key 0');
select pg_temp.raises($q$select pg_temp.enqk(array['enter'], 'c')$q$, '22023', 'lowercase enter');
select pg_temp.raises($q$select pg_temp.enqk(array['Enter ', 'Tab'], 'c')$q$, '22023', 'key with space');
select pg_temp.raises($q$select pg_temp.enqk(array['1','2','3','4','5'], 'c')$q$, '22023', 'five keys');
select pg_temp.raises($q$select pg_temp.enqk(array[]::text[], 'c')$q$, '22023', 'no keys');
select pg_temp.raises($q$select pg_temp.enqk(array['1', null], 'c')$q$, '22023', 'null key');
select pg_temp.raises($q$select pg_temp.enqk(null, 'c')$q$, '22023', 'null keys');
select pg_temp.raises($q$select pg_temp.enqk(array['1'], 'c', kind => 'usage-limit')$q$, '22023', 'usage-limit kind');
select pg_temp.raises($q$select outcome from public.agent_console_enqueue_keys('11111111-1111-1111-1111-111111111111', 'mbp', 'team_worker', 'w1', array['1'], 'permission', now(), repeat('c', 64))$q$, '22023', 'non-lane target');
select pg_temp.raises($q$select outcome from public.agent_console_enqueue_keys('11111111-1111-1111-1111-111111111111', 'mbp', 'coord_lane', 'kit', array['1'], 'permission', now(), 'xyz')$q$, '22023', 'bad sha');
select pg_temp.raises($q$select outcome from public.agent_console_enqueue_keys('11111111-1111-1111-1111-111111111111', 'mbp', 'coord_lane', 'kit', array['1'], 'permission', null, repeat('c', 64))$q$, '22023', 'null since');

-- 표 제약(함수를 우회한 직접 삽입): keys 행은 칸이 다 있어야 하고, text 행은 키 칸이 비어야 한다.
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x','keys')$q$, '23514', 'keys row without keys');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since, req_sha) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x','keys', array['F5'], 'permission', now(), repeat('a',64))$q$, '23514', 'keys row bad key');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x','keys', array['1'], 'permission', now())$q$, '23514', 'keys row without sha');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, keys) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x', array['1'])$q$, '23514', 'text row with keys');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, req_sha) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x', repeat('a',64))$q$, '23514', 'text row with req_sha');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x','macro')$q$, '23514', 'unknown input_kind');
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since, req_sha) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','x','keys', array['1'], 'permission', now(), 'zz')$q$, '23514', 'bad sha');
-- 부분 유니크 인덱스(이중 방어): 함수를 우회해도 같은 화면 상태의 두 번째 행은 막힌다.
insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since, req_sha)
  values ('22222222-2222-2222-2222-222222222222', 'mbp', 'coord_lane', 'kit', '키: 1', 'keys', array['1'], 'permission', '2026-10-06T02:00:00Z', repeat('d', 64));
select pg_temp.raises($q$insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since, req_sha) values ('22222222-2222-2222-2222-222222222222','mbp','coord_lane','kit','키: 2','keys', array['2'], 'permission', '2026-10-06T02:00:00Z', repeat('d',64))$q$, '23505', 'unique index');

-- claim: 반환 표에 새 칸이 실리고, 글 행은 input_kind='text'·나머지 null. 오래된 순.
create temp table c1 as select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[repeat('1',64), repeat('2',64), repeat('3',64), repeat('4',64), repeat('5',64)]);
select pg_temp.eq((select string_agg(text, ',' order by token_index) from c1), 'pre,키: 1 Enter,키: 2,키: 2', 'claim oldest first incl keys');
select pg_temp.eq((select input_kind || '|' || array_to_string(keys, ',') || '|' || req_kind from c1 where text = '키: 1 Enter'), 'keys|1,Enter|permission', 'claim keys columns');
select pg_temp.eq((select req_sha = repeat('a', 64) and req_since = '2026-10-06T01:00:00Z'::timestamptz from c1 where text = '키: 1 Enter'), true, 'claim req identity');
select pg_temp.eq((select input_kind || '|' || (keys is null)::text || '|' || (req_kind is null)::text || '|' || (req_since is null)::text || '|' || (req_sha is null)::text from c1 where text = 'pre'), 'text|true|true|true|true', 'claim text row columns');

-- ack: prompt_changed 는 refused 와만. 거절하면 같은 화면 상태가 풀려 다시 답할 수 있다. sent 는 계속 막는다.
create or replace function pg_temp.ackk(keystext text, tok text, res text, rsn text, det text) returns text language sql as $$
  select outcome || '|' || coalesce(status, '-') from public.agent_console_ack('11111111-1111-1111-1111-111111111111',
    (select id from public.agent_console_prompts where text = keystext and owner = '11111111-1111-1111-1111-111111111111' order by created_at limit 1), tok, res, rsn, det)
$$;
select pg_temp.raises($q$select pg_temp.ackk('키: 1 Enter', repeat('2',64), 'sent', 'prompt_changed', null)$q$, '22023', 'prompt_changed with sent');
select pg_temp.raises($q$select pg_temp.ackk('키: 1 Enter', repeat('2',64), 'retry', 'prompt_changed', null)$q$, '22023', 'prompt_changed with retry');
select pg_temp.eq(pg_temp.ackk('키: 1 Enter', repeat('2',64), 'refused', 'prompt_changed', null), 'ok|refused', 'ack prompt_changed');
select pg_temp.eq((select reason from public.agent_console_prompts where text = '키: 1 Enter'), 'prompt_changed', 'reason stored');
select pg_temp.eq(pg_temp.enqk(array['3'], 'a'), 'ok', 're-answer after refused');
select pg_temp.eq(pg_temp.ackk('키: 3', repeat('9',64), 'sent', null, 'submitted'), 'not_found|-', 'not claimed yet / wrong token');
-- 다시 답한 키 행을 claim·sent 처리한 뒤 같은 상태는 already_sent.
create temp table c2 as select * from public.agent_console_claim('11111111-1111-1111-1111-111111111111', 'mbp', array[repeat('6',64), repeat('7',64), repeat('8',64)]);
select pg_temp.eq((select count(*)::int from c2 where input_kind = 'keys'), 1, 'claim remaining keys row');
select pg_temp.eq(pg_temp.ackk('키: 3', (select (array[repeat('6',64), repeat('7',64), repeat('8',64)])[token_index] from c2 where text = '키: 3'), 'sent', null, 'submitted'), 'ok|sent', 'ack sent keys');
select pg_temp.eq(pg_temp.enqk(array['3'], 'a'), 'already_sent', 'already_sent after sent');
-- 120초 무응답으로 unknown 이 된 키 행도 같은 상태를 막는다(입력창에 들어갔는지 모른다).
update public.agent_console_prompts set claimed_at = now() - interval '121 seconds' where text = '키: 2' and status = 'claimed';
select pg_temp.eq(pg_temp.enqk(array['9'], 'b'), 'already_sent', 'already_sent after unknown');
select pg_temp.eq((select count(*)::int from public.agent_console_prompts where status = 'unknown' and input_kind = 'keys'), 2, 'unknown after sweep');

-- 1분 5건 창을 비운다(이전 단계의 행을 과거로 민다).
update public.agent_console_prompts set created_at = now() - interval '2 minutes' where owner = '11111111-1111-1111-1111-111111111111';

-- 만료: 60초가 지난 pending 키 행은 expired 가 되어 같은 상태에 다시 답할 수 있다.
select pg_temp.eq(pg_temp.enqk(array['4'], 'e'), 'ok', 'enqueue for expiry');
update public.agent_console_prompts set expires_at = now() - interval '1 second', created_at = now() - interval '2 minutes' where input_kind = 'keys' and req_sha = repeat('e', 64);
select pg_temp.eq(pg_temp.enqk(array['4'], 'e'), 'ok', 'after expiry');

-- 한도: 1분 5건·대상당 3건은 키 행에도 같은 방식으로 걸린다.
update public.agent_console_prompts set created_at = now() - interval '2 minutes' where owner = '11111111-1111-1111-1111-111111111111';
select pg_temp.eq(pg_temp.enqk(array['1'], '1', ref => 'lane2'), 'ok', 'limit 1');
select pg_temp.eq(pg_temp.enqk(array['1'], '2', ref => 'lane2'), 'ok', 'limit 2');
select pg_temp.eq(pg_temp.enqk(array['1'], '3', ref => 'lane2'), 'ok', 'limit 3');
select pg_temp.eq(pg_temp.enqk(array['1'], '4', ref => 'lane2'), 'queue_full', 'queue_full for keys');
select pg_temp.eq(pg_temp.enqk(array['1'], '5', ref => 'lane3'), 'ok', 'limit 4');
select pg_temp.eq(pg_temp.enqk(array['1'], '6', ref => 'lane3'), 'ok', 'limit 5');
select pg_temp.eq(pg_temp.enqk(array['1'], '7', ref => 'lane4'), 'rate_limited', 'rate_limited for keys');
-- 이미 답한 상태는 한도보다 먼저 already_sent 로 답한다.
select pg_temp.eq(pg_temp.enqk(array['1'], '6', ref => 'lane3'), 'already_sent', 'already_sent before rate limit');

-- 권한: 새 함수와 다시 만든 claim·ack 모두 service_role 만 실행한다.
select pg_temp.eq(has_function_privilege('authenticated', 'public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text)', 'execute'), false, 'auth exec enqueue_keys');
select pg_temp.eq(has_function_privilege('anon', 'public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text)', 'execute'), false, 'anon exec enqueue_keys');
select pg_temp.eq(has_function_privilege('service_role', 'public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text)', 'execute'), true, 'service exec enqueue_keys');
select pg_temp.eq(has_function_privilege('authenticated', 'public.agent_console_claim(uuid, text, text[])', 'execute'), false, 'auth exec claim');
select pg_temp.eq(has_function_privilege('anon', 'public.agent_console_claim(uuid, text, text[])', 'execute'), false, 'anon exec claim');
select pg_temp.eq(has_function_privilege('public', 'public.agent_console_claim(uuid, text, text[])', 'execute'), false, 'public exec claim');
select pg_temp.eq(has_function_privilege('service_role', 'public.agent_console_claim(uuid, text, text[])', 'execute'), true, 'service exec claim');
select pg_temp.eq(has_function_privilege('authenticated', 'public.agent_console_ack(uuid, uuid, text, text, text, text)', 'execute'), false, 'auth exec ack');
select pg_temp.eq(has_function_privilege('service_role', 'public.agent_console_ack(uuid, uuid, text, text, text, text)', 'execute'), true, 'service exec ack');
select pg_temp.eq(has_table_privilege('authenticated', 'public.agent_console_prompts', 'select'), false, 'auth select');
select pg_temp.eq((select count(*)::int from pg_policies where tablename like 'agent_console_%'), 0, 'no policies');

\echo SCENARIO_OK
