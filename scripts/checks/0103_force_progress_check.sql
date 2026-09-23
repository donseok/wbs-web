-- scripts/checks/0103_force_progress_check.sql — 0103 리허설 동작 검증. 트랜잭션 안에서 돌고 끝에 롤백한다.
-- 실행: npm run db:apply -- scripts/checks/0103_force_progress_check.sql --target staging
begin;
do $$
declare
  u uuid; p uuid; v_pred uuid; v_succ uuid; v_order uuid; v_sub uuid; r jsonb; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into p from public.projects order by created_at limit 1;
  assert u is not null and p is not null, '검증용 사용자·프로젝트가 없다';

  insert into public.wbs_items (project_id, code, sort_order, name, external_ref, dev_workflow, spec)
    values (p, 'TSK-Z-01', 9001, '검증 선행', 'zz0103/TSK-Z-01', true, '## API 계약') returning id into v_pred;
  insert into public.wbs_items (project_id, code, sort_order, name, external_ref, dev_workflow, depends, stage, actual_pct)
    values (p, 'TSK-Z-02', 9002, '검증 후행', 'zz0103/TSK-Z-02', true, array['zz0103/TSK-Z-01'], 'im', 80) returning id into v_succ;
  insert into public.agent_work_orders (project_id, wbs_item_id, status, created_by)
    values (p, v_succ, 'reported', u) returning id into v_order;

  -- 1. 사유 없으면 거부
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, ' ', u);
  assert r->>'reason' = 'reason_required', '사유 없음이 통과했다';
  -- 2. 면제 → 하위 Task 생성(같은 트랜잭션)
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, '병목 해소', u);
  assert (r->>'ok')::boolean and (r->>'sub_task_created')::boolean, '면제 실패: ' || r::text;
  v_sub := (r->>'sub_task_id')::uuid;
  assert (select depends_waived = array['zz0103/TSK-Z-01'] from public.wbs_items where id = v_succ), 'depends_waived 미기록';
  assert (select external_ref = 'zz0103/TSK-Z-02.stub.TSK-Z-01' and stub_for = 'zz0103/TSK-Z-01' and parent_id = v_succ
                 and depends = array['zz0103/TSK-Z-01', 'zz0103/TSK-Z-02'] and dev_workflow
            from public.wbs_items where id = v_sub), '하위 Task 속성이 틀렸다';
  -- 3. 재면제는 하위를 새로 만들지 않는다
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', true, '재시도', u);
  assert not (r->>'sub_task_created')::boolean and (r->>'sub_task_id')::uuid = v_sub, '재면제가 하위를 또 만들었다';
  -- 4. 후행은 여전히 리프: 실적·단계 그대로, 승인은 stub_pending 으로 거부되고 주문은 reported 그대로
  assert (select stage = 'im' and actual_pct = 80 from public.wbs_items where id = v_succ), '후행 단계·실적이 바뀌었다';
  r := public.apply_workflow_event('approve', u, null, v_order);
  assert r->>'reason' = 'stub_pending', '스텁 잔존 승인이 통과했다: ' || r::text;
  assert (select status = 'reported' from public.agent_work_orders where id = v_order), '거부된 승인이 주문을 바꿨다';
  -- 5. 하위 xx 뒤 승인은 단계 xx·실적 100 을 한 번에(skipped 없음)
  update public.wbs_items set stage = 'xx' where id = v_sub;
  r := public.apply_workflow_event('approve', u, null, v_order);
  assert (r->>'ok')::boolean and r->>'stage' = 'xx' and (r->>'actual_pct')::numeric = 100 and r->>'skipped' is null,
    '하위 xx 뒤 승인이 반쪽이다: ' || r::text;
  -- 6. 해제는 하위를 남긴다
  r := public.set_dependency_waiver(v_succ, 'zz0103/TSK-Z-01', false, '선행 도착', u);
  assert (r->>'changed')::boolean, '해제 실패';
  assert exists (select 1 from public.wbs_items where id = v_sub), '해제가 하위를 지웠다';
  -- 7. depends 에서 빠지면 트리거가 depends_waived 를 줄이고 기록한다
  update public.wbs_items set depends_waived = array['zz0103/TSK-Z-01'] where id = v_succ;
  select count(*) into n from public.change_logs where wbs_item_id = v_succ and field = 'depends_waived';
  update public.wbs_items set depends = '{}' where id = v_succ;
  assert (select depends_waived = '{}'::text[] from public.wbs_items where id = v_succ), '트리거가 줄이지 않았다';
  assert (select count(*) from public.change_logs where wbs_item_id = v_succ and field = 'depends_waived') = n + 1, '축소 기록 없음';
  -- 8. 하위 Task 의 간선은 면제할 수 없다
  r := public.set_dependency_waiver(v_sub, 'zz0103/TSK-Z-01', true, 'x', u);
  assert r->>'reason' = 'is_stub_task', '하위의 간선이 면제됐다';
  raise notice 'FORCE_PROGRESS_CHECK_OK';
end $$;
rollback;
