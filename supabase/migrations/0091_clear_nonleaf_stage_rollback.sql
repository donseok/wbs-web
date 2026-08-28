-- 0091 rollback — 0091 이 남긴 change_logs 기록에서 상위 항목의 stage 를 되돌린다.
--
-- 0091 은 값을 지우는 마이그레이션이라 스키마 되돌리기가 아니라 데이터 복원이다.
-- 복원 재료는 0091 이 같은 트랜잭션에서 넣은 change_logs(user_id is null, field='stage',
-- new_value is null) 뿐이다. 그 행을 지웠다면 복원할 수 없다.
-- 같은 조건의 기록이 여러 번 쌓였을 수 있어 항목별 최신 1건만 쓴다.

update public.wbs_items w
   set stage = src.old_value,
       updated_at = now()
  from (
    select distinct on (l.wbs_item_id) l.wbs_item_id, l.old_value
      from public.change_logs l
     where l.field = 'stage' and l.user_id is null and l.new_value is null
     order by l.wbs_item_id, l.at desc
  ) src
 where w.id = src.wbs_item_id
   and w.stage is null;
