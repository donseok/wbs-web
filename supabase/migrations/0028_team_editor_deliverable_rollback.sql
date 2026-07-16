-- 0028 롤백 — 컬럼 가드를 actual_pct 전용으로 되돌린다(0022 원본 본문).
-- 되돌린 뒤에는 팀 편집자의 산출물 편집이 다시 42501 로 막힌다. 앱의 canEditDeliverable 도
-- 함께 되돌리거나, 어포던스만 남아 저장이 실패함을 감안할 것.
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
