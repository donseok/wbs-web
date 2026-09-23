-- scripts/checks/0102_report_decisions_check.sql — 0102 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0102_report_decisions_check.sql --target staging
-- CHECK 위반은 check_violation(23514)만 잡는다. 그 밖의 SQLSTATE(예: 22023)는 그대로 올라가 검증 실패가 된다.
begin;
do $$
declare
  p uuid; o uuid; r uuid;
  d2 jsonb := '[{"key":"D1","question":"q","options":["a","b"],"chosen":0,"rationale":"r","on_reject":"x"},
                {"key":"D2","question":"q","options":["a","b"],"chosen":1,"rationale":"r","on_reject":"x"}]';
  d21 jsonb;
begin
  select id into p from public.projects order by created_at limit 1;
  assert p is not null, '검증용 프로젝트가 없다';
  -- status 는 기본값(ready)으로 둔다 — 보고 CHECK 는 주문 상태와 무관하고, claimed 로 만들면 점유 컬럼 제약에 걸릴 수 있다.
  insert into public.agent_work_orders (project_id) values (p) returning id into o;
  select jsonb_agg(jsonb_build_object('key', 'D' || g)) into d21 from generate_series(1, 21) as g;

  -- 1. 제출 안 됨(null) → decision_count null
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent)
    values (o, 'completion', 100, 's', 'chk-0102') returning id into r;
  assert (select decisions is null and decision_count is null from public.agent_work_reports where id = r),
    'null 행의 decision_count 가 null 이 아니다';
  -- 2. 0건 명시([]) → 0
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
    values (o, 'completion', 100, 's', 'chk-0102', '[]'::jsonb) returning id into r;
  assert (select decision_count = 0 from public.agent_work_reports where id = r), '[] 행의 decision_count 가 0 이 아니다';
  -- 3. 2건 → 2
  insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
    values (o, 'completion', 100, 's', 'chk-0102', d2) returning id into r;
  assert (select decision_count = 2 from public.agent_work_reports where id = r), '2건 행의 decision_count 가 2 가 아니다';
  -- 4. 객체 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', '{"a":1}'::jsonb);
    raise exception '객체 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 5. 스칼라 문자열 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', '"x"'::jsonb);
    raise exception '문자열 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 6. 21건 → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'completion', 100, 's', 'chk-0102', d21);
    raise exception '21건 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 7. progress 행의 decisions → 23514
  begin
    insert into public.agent_work_reports (work_order_id, kind, percent, summary, agent, decisions)
      values (o, 'progress', 10, 's', 'chk-0102', '[]'::jsonb);
    raise exception 'progress 행에 decisions 가 들어갔다';
  exception when check_violation then null;
  end;
  -- 8. 세션 읽기 경로(Task 사이드바·오피스 상세)가 새 컬럼을 읽을 수 있다 — 0057 의 table-level grant 가 덮는다.
  assert has_column_privilege('authenticated', 'public.agent_work_reports', 'decisions', 'SELECT'), 'authenticated 가 decisions 를 못 읽는다';
  assert has_column_privilege('authenticated', 'public.agent_work_reports', 'decision_count', 'SELECT'), 'authenticated 가 decision_count 를 못 읽는다';
  raise notice 'REPORT_DECISIONS_CHECK_OK';
end $$;
rollback;
