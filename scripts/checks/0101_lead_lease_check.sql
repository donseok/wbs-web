-- scripts/checks/0101_lead_lease_check.sql — 0101 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0101_lead_lease_check.sql --target staging
begin;
do $$
declare
  u uuid; p uuid; p2 uuid; g1 bigint; g2 bigint; gb bigint; r record; n integer;
  ha text := '00000000-0000-4000-8000-00000000000a:1';
  hb text := '00000000-0000-4000-8000-00000000000b:2';
begin
  select id into u from auth.users order by created_at limit 1;
  select id into p from public.projects order by created_at limit 1;
  assert u is not null and p is not null, '검증용 사용자·프로젝트가 없다';
  select id into p2 from public.projects where id <> p order by created_at limit 1;
  assert p2 is not null, '검증용 두 번째 프로젝트가 없다';
  delete from public.agent_lead_leases where user_id = u and project_id = p;
  delete from public.agent_lead_leases where user_id = u and project_id = p2;

  -- 1. 빈 행 획득
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', false);
  assert r.ok and r.generation = 1, '빈 행 획득 실패';
  g1 := r.generation;
  -- 2. 다른 holder 는 막힌다(바뀐 것 없음)
  select * into r from public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  assert not r.ok and r.host = 'pc-a', '다른 holder 가 막히지 않았다';
  assert (select generation from public.agent_lead_leases where user_id = u and project_id = p) = g1, '막힘이 행을 바꿨다';
  -- 2b. 여러 프로젝트 중 하나라도 막히면 전부 아니면 전무 — 막힌 행만 오고 나머지 프로젝트는 손대지 않는다
  select count(*) into n from public.lead_lease_acquire(u, array[p, p2], hb, 'pc-b', 'x/pc-b/lead', false);
  assert n = 1, '여러 프로젝트 acquire 가 막힌 행만 돌려주지 않았다(반환 행 수 != 1)';
  select * into r from public.lead_lease_acquire(u, array[p, p2], hb, 'pc-b', 'x/pc-b/lead', false);
  assert not r.ok and r.project_id = p, '여러 프로젝트 all-or-nothing 이 막힌 p 행을 돌려주지 않았다';
  assert (select holder is null and generation = 0 from public.agent_lead_leases where user_id = u and project_id = p2), '막힌 all-or-nothing 이 p2 를 건드렸다(삽입만 되고 그대로여야 한다)';
  -- 3. 같은 holder 재획득은 즉시, generation 이 오르고 옛 generation renew 는 lost
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', false);
  assert r.ok and r.generation = g1 + 1, '같은 holder 재획득 실패';
  g2 := r.generation;
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g1)));
  assert not r.ok, '옛 generation renew 가 성공했다';
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2)));
  assert r.ok, '현재 generation renew 가 실패했다';
  -- 4. 만료됐지만 안 뺏긴 lease 의 renew 는 성공
  update public.agent_lead_leases set expires_at = now() - interval '1 minute' where user_id = u and project_id = p;
  select * into r from public.lead_lease_renew(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2)));
  assert r.ok, '만료됐지만 안 뺏긴 lease 의 renew 가 실패했다';
  -- 5. 만료 뒤에는 다른 holder 가 얻는다
  update public.agent_lead_leases set expires_at = now() - interval '1 minute' where user_id = u and project_id = p;
  select * into r from public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  assert r.ok and r.generation = g2 + 1, '만료 뒤 획득 실패';
  -- 6. takeover 는 살아 있는 lease 도 빼앗는다
  select * into r from public.lead_lease_acquire(u, array[p], ha, 'pc-a', 'x/pc-a/lead', true);
  assert r.ok and r.generation = g2 + 2, 'takeover 실패';
  -- 7. release 는 holder·generation 이 둘 다 맞을 때만, generation 을 올린다
  n := public.lead_lease_release(u, hb, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2 + 2)));
  assert n = 0, '남의 release 가 풀었다';
  n := public.lead_lease_release(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2 + 1)));
  assert n = 0, '옛 generation 의 release 가 풀었다';
  n := public.lead_lease_release(u, ha, jsonb_build_array(jsonb_build_object('project_id', p, 'generation', g2 + 2)));
  assert n = 1, 'release 실패';
  assert (select holder is null and generation = g2 + 3 from public.agent_lead_leases where user_id = u and project_id = p), 'release 뒤 상태가 틀렸다';
  -- 8. force_release 는 살아 있는 lease 만 풀고, 풀 때 generation 을 1 올린다
  n := public.lead_lease_force_release(u, p);
  assert n = 0, '빈 lease 를 force_release 가 셌다';
  perform public.lead_lease_acquire(u, array[p], hb, 'pc-b', 'x/pc-b/lead', false);
  select generation into gb from public.agent_lead_leases where user_id = u and project_id = p;
  n := public.lead_lease_force_release(u, p);
  assert n = 1, 'force_release 실패';
  assert (select generation from public.agent_lead_leases where user_id = u and project_id = p) = gb + 1, 'force_release 가 generation 을 1 올리지 않았다';
  raise notice 'LEAD_LEASE_CHECK_OK';
end $$;
rollback;
