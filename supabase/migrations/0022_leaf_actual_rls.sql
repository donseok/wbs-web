-- 실적%(actual_pct) 입력 권한을 'activity 레벨'이 아니라 '말단(자식 없는) 항목' 기준으로 통일한다.
--
-- 배경: 롤업(src/lib/domain/rollup.ts computeNode)은 children.length===0 인 노드의 actual_pct 를
-- 그대로 rolledActualPct 로 쓴다. 반면 0002_rls.sql 의 team_update_actual 은 level='activity' 만
-- 허용해서, 자식 없는 Task(실데이터: '1-3. 프로젝트 착수 보고회(Kick-off)', '2-5. 중간보고',
-- '4-3. 마스터 플랜 수립 보고')는 롤업엔 0% 로 반영되는데 입력할 길이 없었다.
--
-- 헬퍼 의존성 주의: 0002/0004/0007 의 current_role() 은 PG 예약어라 그대로는 적용 불가한 드리프트고,
-- 프로덕션 헬퍼는 public.app_role() 이다(0012:47-48 에 기록). current_team() 은 프로덕션에 존재하지만
-- 이름 드리프트를 또 밟지 않도록 이 마이그레이션은 어느 헬퍼에도 의존하지 않고 memberships 를
-- 인라인 조회한다(0012/0013 이 택한 방식과 동일).
--
-- 남는 전제(0002 부터 동일, 여기서 넓어짐): 담당 판정은 팀 단위이고 memberships 는 사용자당 팀 하나를
-- 전역으로 갖는다(project 스코프 없음). 즉 팀 편집자는 자기 팀이 담당인 말단이면 어느 프로젝트 것이든
-- 실적%를 쓸 수 있다. 단일 프로젝트 운영에서는 노출되지 않지만, 두 번째 프로젝트를 붙이기 전에
-- item_owners → wbs_items.project_id 를 프로젝트별 멤버십과 대조하도록 이 정책을 다시 봐야 한다.

-- ── 0) 사전 확인 — 손댈 정책이 실제로 그 이름으로 있는지 ──
-- 이름이 다르면 아래 drop 이 조용한 no-op 이 되어 좁은 옛 정책이 남는다. 조용히 넘어가지 않고 멈춘다.
do $$
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'wbs_items' and p.polname = 'team_update_actual'
  ) then
    raise exception
      '0022: wbs_items 에 team_update_actual 정책이 없습니다. 실제 이름을 확인 후 이 마이그레이션을 고치세요. 확인: select polname from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname=''wbs_items'';';
  end if;
end $$;

-- ── 1) 말단 판정 헬퍼 ──
-- SECURITY DEFINER 는 재귀 회피용이 아니다(정책 안의 하위 SELECT 에는 wbs_items 의 SELECT 정책만
-- 적용되므로 인라인으로 써도 재귀하지 않는다). 목적은 read_all_items 가 나중에 좁혀지더라도
-- 말단 판정이 계속 정확하도록 RLS 를 우회하는 것. 노출값은 자식 유무 boolean 뿐이다.
-- search_path = '' + 전 객체 스키마 한정 — pg_temp 를 통한 객체 가로채기 차단(0019 와 동일 패턴).
create or replace function public.wbs_is_leaf(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.wbs_items c where c.parent_id = p_item_id)
$$;

revoke all on function public.wbs_is_leaf(uuid) from public;
grant execute on function public.wbs_is_leaf(uuid) to authenticated;

-- ── 2) team_editor 의 실적% 수정 정책: level='activity' → 말단 항목 ──
drop policy if exists team_update_actual on wbs_items;
create policy team_update_actual on wbs_items for update to authenticated
  using (
    public.wbs_is_leaf(id)
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id
        and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
    )
  )
  with check (
    public.wbs_is_leaf(id)
    and exists (
      select 1 from item_owners o
      where o.wbs_item_id = wbs_items.id
        and o.team_id = (select m.team_id from memberships m where m.user_id = auth.uid())
    )
  );

-- ── 3) 컬럼 가드: team_editor 는 실적%만 바꿀 수 있다 ──
-- RLS 에는 컬럼 단위 조건이 없다. 위 정책만으로는 담당 팀이 자기 소유 말단 행의 이름·일정·가중치까지
-- PostgREST 로 직접 바꿀 수 있다. 0002 부터 있던 구멍이고(2026-06-29 프리플라이트에서 식별·미적용),
-- 정책 범위가 activity → 모든 말단으로 넓어지는 지금 함께 막는다.
-- pmo_admin·service_role(auth.uid() null)·import_wbs 등 그 외 경로는 그대로 통과한다.
create or replace function public.guard_team_editor_actual_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select m.role into v_role from public.memberships m where m.user_id = auth.uid();
  if v_role is distinct from 'team_editor' then
    return new;
  end if;
  if (to_jsonb(new) - 'actual_pct' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'updated_at') then
    raise exception '팀 편집자는 실적%%만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
create trigger trg_guard_team_editor_actual_only
  before update on wbs_items
  for each row execute function public.guard_team_editor_actual_only();

comment on column wbs_items.actual_pct is
  '말단(자식 없는) 항목만 사용. 자식이 생기면 롤업으로 대체되고 addWbsItem/addSubAct 가 null 로 지운다.';
