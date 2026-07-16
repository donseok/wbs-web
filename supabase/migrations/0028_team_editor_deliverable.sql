-- 팀 편집자가 자기 담당(말단) 항목의 '산출물(deliverable)'을 직접 수정할 수 있게 컬럼 가드를 넓힌다.
--
-- 배경: 0022 의 guard_team_editor_actual_only 트리거는 team_editor 의 wbs_items 변경을
-- actual_pct 로만 제한했다(그 외 컬럼 변경 시 42501). 산출물 파일 첨부(deliverable_attachments)는
-- 이미 담당팀에게 열려 있는데(attachments.canAttach) 산출물 텍스트만 PMO 전용으로 남아 비대칭이었다.
-- 이 마이그레이션은 컬럼 화이트리스트에 deliverable 을 추가해 대칭을 맞춘다.
--
-- 범위(변경 없음): 행 접근은 여전히 team_update_actual 정책(wbs_is_leaf + 담당)이 관장한다.
-- 즉 팀 편집자는 '자기 담당 말단' 행의 actual_pct·deliverable 만 바꿀 수 있고, 비말단·이름·일정·
-- 가중치·구조는 그대로 PMO 전용이다. pmo_admin·service_role(auth.uid() null) 경로는 계속 전량 통과.
-- 앱 레이어(canEditDeliverable)도 같은 말단+담당 규칙을 쓴다(silent no-op 방지).

-- ── 0) 사전 확인 — 넓힐 함수/트리거가 실제로 있는지 ──
-- 없으면 아래 replace 가 새 함수를 만들지만 트리거가 안 걸려 조용히 무력화된다. 멈춘다.
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'wbs_items' and t.tgname = 'trg_guard_team_editor_actual_only'
  ) then
    raise exception
      '0028: wbs_items 에 trg_guard_team_editor_actual_only 트리거가 없습니다(0022 미적용?). 확인 후 진행하세요.';
  end if;
end $$;

-- ── 1) 컬럼 가드 확장: actual_pct → actual_pct + deliverable ──
-- 시그니처 동일 → 기존 트리거가 그대로 이 새 본문을 가리킨다(트리거 재생성 불필요).
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
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '팀 편집자는 실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
