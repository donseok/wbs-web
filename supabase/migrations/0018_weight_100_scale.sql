-- ============================================================================
-- 0018 — 가중치 스케일 0~1 → 0~100
--
-- 배경: weight 는 "전역 절대 지분"이다. 프로젝트 전체 leaf 합 = 1.0 이고,
--       형제 그룹의 합은 부모의 weight 와 같다. (형제 합 = 1.0 이 아님)
--       화면에 0.0455 처럼 보이던 값을 4.55 로 읽히게 한다.
--
-- 안전장치:
--   1) weight_backup_0_1 컬럼에 원본을 보존한다 (롤백용, 삭제하지 않음).
--   2) 이미 마이그레이션된 프로젝트는 건너뛴다 (재실행 안전 / idempotent).
--   3) 트랜잭션 + 사후 검증. 검증 실패 시 전체 롤백.
--
-- 롤백: 0018_weight_100_scale_rollback.sql
--
-- ⚠ 실행 전 확인: node scripts/inspect-weights.mjs  (읽기 전용 진단)
--    "leaf 전역 합 ≈ 1.0" 판정이 나와야 이 마이그레이션이 올바르다.
-- ============================================================================

begin;

-- ── 1) 원본 보존 컬럼 ────────────────────────────────────────────────────────
alter table wbs_items add column if not exists weight_backup_0_1 numeric;

-- 변환 대상 프로젝트 = leaf 가중치 합이 1.5 이하인 프로젝트(= 아직 0~1 스케일).
-- leaf(자식 없는 항목) 기준으로 합산한다. 상위까지 더하면 트리 깊이만큼 중복된다.
-- 이미 100 스케일인 프로젝트는 여기서 자동으로 빠지므로 재실행이 안전하다.
create temporary table _weight_target on commit drop as
  select i.project_id
    from wbs_items i
   where i.weight is not null
     and not exists (select 1 from wbs_items c where c.parent_id = i.id)
   group by i.project_id
  having sum(i.weight) <= 1.5;

-- 백업은 "실제로 변환할 행"에만 남긴다.
-- (변환하지 않은 100 스케일 행까지 백업하면, 롤백 시 그 행을 0~1 원본으로
--  오인해 되돌리려 하다가 검증에 걸린다 — 실제로 밟았던 함정.)
update wbs_items w
   set weight_backup_0_1 = w.weight
  from _weight_target t
 where w.project_id = t.project_id
   and w.weight is not null
   and w.weight_backup_0_1 is null;

-- ── 2) 스케일 변환 ───────────────────────────────────────────────────────────
update wbs_items w
   set weight = w.weight * 100,
       updated_at = now()
  from _weight_target t
 where w.project_id = t.project_id
   and w.weight is not null;

-- ── 3) 사후 검증 — 실패하면 전체 롤백 ────────────────────────────────────────
do $$
declare
  bad_row   int;
  bad_proj  int;
begin
  -- 3a) 모든 값이 0~100 범위 안에 있는가
  select count(*) into bad_row
    from wbs_items
   where weight is not null and (weight < 0 or weight > 100);
  if bad_row > 0 then
    raise exception '검증 실패: weight 가 0~100 범위를 벗어난 행 % 개', bad_row;
  end if;

  -- 3b) 프로젝트별 leaf 합이 100 근처인가 (반올림 잔차 ±1 허용)
  select count(*) into bad_proj
    from (
      select i.project_id, sum(i.weight) as s
        from wbs_items i
       where i.weight is not null
         and not exists (select 1 from wbs_items c where c.parent_id = i.id)
       group by i.project_id
    ) q
   where abs(q.s - 100) > 1;
  if bad_proj > 0 then
    raise exception '검증 실패: leaf 가중치 합이 100 이 아닌 프로젝트 % 개', bad_proj;
  end if;

  raise notice '✓ 가중치 0~100 스케일 변환 완료 (원본은 weight_backup_0_1 에 보존)';
end $$;

commit;
