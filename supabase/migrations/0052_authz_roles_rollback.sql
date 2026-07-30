-- 0052 롤백. app_role()·가드 트리거를 0022/0036 시점 정의로 되돌린다.
-- (아래 정의는 2026-07-29 프로덕션 pg_get_functiondef 원문과 동일하다.)

begin;

drop trigger if exists trg_guard_non_admin_column_scope on wbs_items;
drop function if exists public.guard_non_admin_column_scope();

create or replace function public.guard_team_editor_actual_only()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
begin
  select m.role into v_role from public.memberships m where m.user_id = auth.uid();
  if v_role is distinct from 'team_editor' then
    return new;
  end if;
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '팀 편집자는 실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_team_editor_actual_only on wbs_items;
create trigger trg_guard_team_editor_actual_only
  before update on wbs_items
  for each row execute function public.guard_team_editor_actual_only();

create or replace function public.app_role() returns text
language sql stable as $$
  select role from memberships where user_id = auth.uid()
$$;

drop table if exists project_roles;
alter table memberships drop column if exists is_superuser;

drop function if exists public.is_project_member(uuid);
drop function if exists public.is_project_admin(uuid);
drop function if exists public.is_superuser();
drop function if exists public.can_read_project(uuid);

commit;
