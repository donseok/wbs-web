-- ============================================================================
-- 가중치 스케일 진단 (READ ONLY) — Supabase SQL Editor 에 그대로 붙여넣어 실행.
--
-- scripts/inspect-weights.mjs 와 같은 판정을 하지만 키/의존성이 필요 없다.
-- (앱은 service_role 을 쓰지 않아 .env.local 의 키가 비어 있고, anon 키는 RLS 에
--  막혀 조용히 [] 를 돌려준다 — 그래서 REST 로는 진단이 안 된다.)
--
-- 마이그레이션 0018 실행 전 반드시 이걸 먼저 돌릴 것.
-- ============================================================================

-- ── [1] 프로젝트별 leaf 가중치 합 → 스케일 판정 ──────────────────────────────
-- 가중치는 전역 절대 지분이므로 leaf(자식 없는 행)만 합산한다.
-- 상위 행까지 더하면 트리 깊이만큼 중복된다.
with leaf as (
  select i.project_id, i.weight
    from wbs_items i
   where i.weight is not null
     and not exists (select 1 from wbs_items c where c.parent_id = i.id)
)
select
  p.name                                as project,
  count(*)                              as leaf_with_weight,
  round(sum(l.weight), 6)               as leaf_sum,
  round(min(l.weight), 6)               as min_w,
  round(max(l.weight), 6)               as max_w,
  case
    when abs(sum(l.weight) - 1)   < 0.02 then '0~1 스케일 → 0018 이 ×100 함 (정상)'
    when abs(sum(l.weight) - 100) < 1    then '이미 0~100 스케일 → 0018 이 건너뜀'
    else '⚠ 어느 모델도 아님 — 마이그레이션 보류하고 원본 확인'
  end                                   as verdict
from leaf l
join projects p on p.id = l.project_id
group by p.name
order by p.name;

-- ── [2] null + 명시값이 섞인 형제 그룹 ───────────────────────────────────────
-- 있으면 effectiveWeights 의 null 폴백 변경(null→명시값 평균)으로
-- 화면의 진척률 숫자가 실제로 바뀐다. 사장님께 먼저 알릴 것.
select
  coalesce(pa.code, '(ROOT)')                    as parent_code,
  coalesce(pa.name, '(최상위 Phase)')            as parent_name,
  count(*)                                       as siblings,
  count(ch.weight)                               as with_weight,
  count(*) - count(ch.weight)                    as null_weight
from wbs_items ch
left join wbs_items pa on pa.id = ch.parent_id
group by ch.parent_id, pa.code, pa.name
having count(ch.weight) > 0
   and count(ch.weight) < count(*)
order by parent_code;
-- 0 행 반환 = 혼합 그룹 없음 = null 폴백 변경이 아무 숫자도 바꾸지 않음 ✓

-- ── [3] 형제 합 vs 부모 가중치 (전역 절대 지분 모델 검증) ────────────────────
-- 모든 자식에 가중치가 있는 그룹만 검사. 불일치 행이 나오면 모델 가정이 틀린 것.
select
  pa.code                                        as parent_code,
  round(pa.weight, 6)                            as parent_weight,
  round(sum(ch.weight), 6)                       as children_sum,
  round(sum(ch.weight) - pa.weight, 6)           as diff
from wbs_items ch
join wbs_items pa on pa.id = ch.parent_id
where pa.weight is not null
group by pa.id, pa.code, pa.weight
having count(*) = count(ch.weight)                       -- 자식 전원이 명시값
   and abs(sum(ch.weight) - pa.weight) > 1e-6            -- 불일치만
order by abs(sum(ch.weight) - pa.weight) desc;
-- 0 행 반환 = 전역 절대 지분 모델 확인 ✓
