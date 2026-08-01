-- 0064: wbs_items.level 컬럼 drop — 범용 WBS 코어 마무리(설계 §11 단계 6, Plan D Task 5).
--
-- level 은 0059(CHECK 해제) 이후 DEPRECATED 기록용으로만 남아 있었다. 깊이의 진실은 parent_id 트리이며,
-- Plan A(코어)·C(N단 UI)·D(비-UI 소비처 depth 전환)가 모든 판독을 depth+levelLabels 로 옮겼고 0063 이
-- 두 RPC 의 insert 에서 level 을 제거했다. 이 시점에 프로덕션 코드·RPC 어디도 level 을 읽거나 쓰지 않는다.
--
-- ⚠️ 반드시 코드(Tasks 1~3)가 프로덕션에 배포되고 0063 이 적용된 뒤에 실행할 것. level 을 판독하는
-- 코드가 하나라도 살아 있으면 이 drop 으로 그 경로가 깨진다(fail-closed 로 확인 후 적용).
begin;
set search_path = public, extensions;

alter table public.wbs_items drop column if exists level;

reset search_path;
commit;
