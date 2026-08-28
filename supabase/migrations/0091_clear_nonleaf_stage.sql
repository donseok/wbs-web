-- 0091: 상위 항목에 잘못 찍힌 개발 워크플로 단계(stage) 정리
--
-- 개발 워크플로 단계는 최종단계(자식 없는 리프)의 것이다. 주문은 처음부터 리프에만 나갔고
-- (ensureOrderForWorkflowLeaf 의 not_leaf), stage 도 리프의 상태를 뜻한다. 그런데 배정 자동
-- 전이(setWbsAssignee·setWbsAssigneeCascade → transitionStage)에 리프 검사가 없어 상위 항목에도
-- 'as' 가 찍혔다. WBS 그리드에 단계 칩을 붙이자 그 값들이 상위 행에 그대로 드러났다.
--
-- 코드 쪽 구멍은 같은 브랜치에서 막았다(transitionStage·setWbsStage 리프 게이트). 이 마이그레이션은
-- 이미 찍힌 값을 지운다. 지우지 않으면 화면이 계속 없는 단계를 보여준다.
--
-- 되돌릴 수 없다 — 어떤 값이 있었는지 남기려고 change_logs 에 기록을 함께 넣는다.
-- 상위 항목의 stage 는 자식에서 파생된 값이 아니라 잘못 찍힌 값이므로 재계산으로 복원할 수 없다.

insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
select null, w.id, 'stage', w.stage, null
from public.wbs_items w
where w.stage is not null
  and exists (select 1 from public.wbs_items c where c.parent_id = w.id);

update public.wbs_items w
   set stage = null,
       updated_at = now()
 where w.stage is not null
   and exists (select 1 from public.wbs_items c where c.parent_id = w.id);
