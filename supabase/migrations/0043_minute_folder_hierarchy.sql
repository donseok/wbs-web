-- 회의록 폴더 하이어라키 재편(플랜 2026-07-24-minutes-folder-hierarchy.md) — 최상위를 팀코드
-- 5축(PMO/ERP/MES/가공/MDM)으로 정렬하고, 0040 시드 10구분 중 8개를 ERP/MES 하위로 재배치한다.
-- 미분류(folder_id null)에 쌓인 회의록은 팀코드 → 동명 시드 루트 폴더로 백필(폴더 지정분은 불변).
--
-- 시드 고정: 2~4단계는 created_by is null(시드)만 만진다 — 동명 사용자 루트 폴더(스쿼팅)가
-- 재배치·백필 대상을 하이재킹하지 못하게. 1단계는 이름만 검사(동명 사용자 루트가 있으면 시드
-- 삽입을 건너뛰고 이후 단계가 자연히 no-op → apply-0043.mjs VERIFY가 소리 내어 실패한다).
--
-- 재실행: 구조 단계(1~3)는 멱등. 4단계 백필은 재실행 시 그 시점의 미분류 잔량도 재편철하므로
-- 1회성 적용 후 재실행하지 않는 것을 전제로 한다(재실행해도 데이터 소실은 없음).
-- 적용: Management API(scripts/apply-0043.mjs, db push 금지). 코드 배포 **전에** 적용할 것.

-- 1) 새 루트 폴더: ERP·MES·MDM — 시드와 동일하게 created_by null(pmo_admin만 관리, 0040 RLS).
insert into minute_folders (name, sort)
select v.name, v.sort
from (values ('ERP', 1), ('MES', 2), ('MDM', 4)) as v(name, sort)
where not exists (
  select 1 from minute_folders f where f.parent_id is null and f.name = v.name
);

-- 2) 시드 재배치: 영업/구매/관리회계 → ERP, 품질/생산계획/조업및표준화/물류/설비및L2 → MES.
--    시드(created_by null)인 현재 루트만 이동(멱등) + 대상 부모에 동명 자식이 있으면 건너뜀.
update minute_folders c
set parent_id = p.id, sort = v.sort, updated_at = now()
from (values
  ('영업', 'ERP', 0), ('구매', 'ERP', 1), ('관리회계', 'ERP', 2),
  ('품질', 'MES', 0), ('생산계획', 'MES', 1), ('조업및표준화', 'MES', 2),
  ('물류', 'MES', 3), ('설비및L2', 'MES', 4)
) as v(child, parent, sort)
join minute_folders p on p.parent_id is null and p.name = v.parent and p.created_by is null
where c.parent_id is null and c.name = v.child and c.created_by is null
  and not exists (
    select 1 from minute_folders d where d.parent_id = p.id and d.name = v.child
  );

-- 3) 루트 정렬 확정: PMO 0 · ERP 1 · MES 2 · 가공 3 · MDM 4 (TEAM_CODES 순서와 일치).
update minute_folders f
set sort = v.sort, updated_at = now()
from (values ('PMO', 0), ('ERP', 1), ('MES', 2), ('가공', 3), ('MDM', 4)) as v(name, sort)
where f.parent_id is null and f.name = v.name and f.created_by is null
  and f.sort is distinct from v.sort;

-- 4) 미분류 백필: 팀코드와 동명인 시드 루트 폴더로 편철. updated_at 은 건드리지 않는다 —
--    내용 변경이 아닌 조직 백필이 외부 연동(또박또박 GET updated_at)에 갱신으로 비치면 안 됨.
update minutes m
set folder_id = f.id
from minute_folders f
where m.folder_id is null and f.parent_id is null and f.name = m.team_code
  and f.created_by is null;
