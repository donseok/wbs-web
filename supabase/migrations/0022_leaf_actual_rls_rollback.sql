-- 0022 되돌리기 — activity 전용 정책으로 복귀(0002 의 의도, 단 프로덕션 헬퍼 이름 기준).
-- 주의: 되돌리면 자식 없는 Task 의 실적%는 다시 입력 불가가 된다(이미 입력된 값은 DB 에 남는다).

drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
drop function if exists public.guard_team_editor_actual_only();

drop policy if exists team_update_actual on wbs_items;
create policy team_update_actual on wbs_items for update to authenticated
  using (
    level = 'activity'
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id
        and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
    )
  )
  with check (
    level = 'activity'
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id
        and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
    )
  );

drop function if exists public.wbs_is_leaf(uuid);

comment on column wbs_items.actual_pct is null;
