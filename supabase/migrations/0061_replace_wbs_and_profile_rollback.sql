-- 롤백 — replace_wbs 함수만 제거한다.
--
-- project_settings.excel_profile 백필은 원복하지 않는다: 프로파일은 데이터가 아니라 설정이고, 롤백 시점
-- 사이에 사용자가 화면에서 커스텀 프로파일을 저장했을 수도 있다. excel_profile 을 일괄 '{}' 로 되돌리면
-- 그 커스텀 값을 조용히 파괴해버리므로 오히려 더 위험하다 — 그대로 둔다.
begin;
set search_path = public, extensions;

drop function if exists public.replace_wbs(uuid, jsonb, jsonb);

reset search_path;
commit;
