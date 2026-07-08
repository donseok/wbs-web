-- ============================================================================
-- 0018 롤백 — 가중치 0~100 → 0~1 복구
--
-- weight_backup_0_1 에 보존된 원본을 그대로 되돌린다. (weight * 0.01 로 역산하지
-- 않는다 — 마이그레이션 이후 PMO 가 편집한 값이 있으면 역산이 원본과 어긋난다.
-- 백업 컬럼이 유일한 진실원본이다.)
--
-- ⚠ 마이그레이션 이후 PMO 가 편집한 값은 편집 전 상태로 되돌아간다.
--    change_logs 에서 field='weight' 를 조회해 무엇이 되돌아가는지 먼저 확인할 것:
--
--      select cl.*, wi.code, wi.name
--        from change_logs cl join wbs_items wi on wi.id = cl.wbs_item_id
--       where cl.field = 'weight' and cl.created_at > '<0018 적용 시각>'
--       order by cl.created_at;
-- ============================================================================

begin;

update wbs_items
   set weight = weight_backup_0_1,
       updated_at = now()
 where weight_backup_0_1 is not null;

-- 백업 컬럼은 남겨 둔다 (재적용 대비). 완전히 정리하려면 아래 주석 해제:
-- alter table wbs_items drop column weight_backup_0_1;

-- 검증은 "0018 이 실제로 변환한 행"(백업이 있는 행)에만 적용한다.
-- 애초에 100 스케일이라 변환 대상이 아니었던 프로젝트까지 검사하면 오탐이 난다.
do $$
declare bad int;
begin
  select count(*) into bad
    from wbs_items
   where weight_backup_0_1 is not null
     and weight is not null
     and weight > 1.5;
  if bad > 0 then
    raise exception '롤백 검증 실패: 여전히 100 스케일로 보이는 행 % 개', bad;
  end if;
  raise notice '✓ 가중치 0~1 스케일로 롤백 완료';
end $$;

commit;
