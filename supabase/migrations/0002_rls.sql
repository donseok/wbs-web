alter table projects enable row level security;
alter table wbs_items enable row level security;
alter table item_owners enable row level security;
alter table holidays enable row level security;
alter table change_logs enable row level security;
alter table memberships enable row level security;
alter table teams enable row level security;

-- 헬퍼: 현재 사용자의 role / team
create or replace function current_role() returns text language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;
create or replace function current_team() returns uuid language sql stable as $$
  select team_id from memberships where user_id = auth.uid()
$$;

-- 로그인 사용자는 모두 읽기 가능
create policy read_all_projects on projects for select to authenticated using (true);
create policy read_all_items on wbs_items for select to authenticated using (true);
create policy read_all_owners on item_owners for select to authenticated using (true);
create policy read_all_holidays on holidays for select to authenticated using (true);
create policy read_all_logs on change_logs for select to authenticated using (true);
create policy read_all_memberships on memberships for select to authenticated using (true);
create policy read_all_teams on teams for select to authenticated using (true);

-- PMO admin: 전체 쓰기
create policy pmo_write_items on wbs_items for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');
create policy pmo_write_projects on projects for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');
create policy pmo_write_holidays on holidays for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');
create policy pmo_write_owners on item_owners for all to authenticated
  using (current_role() = 'pmo_admin') with check (current_role() = 'pmo_admin');

-- team_editor: 자기 팀이 담당(primary/support)인 activity의 actual_pct만 수정
create policy team_update_actual on wbs_items for update to authenticated
  using (
    level = 'activity'
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id and o.team_id = current_team()
    )
  )
  with check (
    level = 'activity'
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id and o.team_id = current_team()
    )
  );

-- 변경 이력은 로그인 사용자 본인 기록만 insert
create policy insert_own_log on change_logs for insert to authenticated
  with check (user_id = auth.uid());
