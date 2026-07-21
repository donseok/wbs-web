-- 0038 롤백 — LLM 프로필/전역 설정 테이블을 제거해 0038 적용 이전 상태로 되돌린다.
--
-- 경고(데이터 소실): 등록된 모든 LLM 프로필과 활성 선택(mode/active_profile_id)이 함께 사라진다.
--   auth_token 은 이 테이블에만 존재하므로 복구 수단이 없다 — 필요하면 drop 전에 백업할 것.
--   롤백 후 서버는 env 모드(AI_PROVIDER / GEMINI_API_KEY / LLM_BASE_URL 등)로 되돌아간다.
--   특히 mode='none'(LLM 기능 차단)으로 운영 중이었다면 롤백 즉시 env 키로 LLM 호출이 재개된다.
-- 순서: 코드가 이 테이블을 읽는 상태에서 먼저 drop 하면 캐시 로더가 매 갱신마다 PGRST 오류를
--       로그에 남긴다(로더는 실패 시 env 폴백이라 화면은 죽지 않는다). 가능하면 코드 롤백 후 적용할 것.
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (정방향과 동일 경로,
--       db push 금지). 멱등: if exists 라 반복 실행 안전.
-- 순서 주의: llm_config 가 llm_profiles 를 FK 로 참조하므로 llm_config 를 먼저 drop 한다.

-- 정책 drop 은 테이블 존재를 전제한다(drop policy if exists 의 if exists 는 정책만 커버 —
-- 테이블이 이미 없으면 42P01). 재실행 안전을 위해 to_regclass 로 감싼다.
do $$
begin
  if to_regclass('public.llm_config') is not null then
    execute 'drop policy if exists admin_all_llm_config on llm_config';
  end if;
  if to_regclass('public.llm_profiles') is not null then
    execute 'drop policy if exists admin_all_llm_profiles on llm_profiles';
  end if;
end $$;

drop table if exists llm_config;
drop table if exists llm_profiles;
