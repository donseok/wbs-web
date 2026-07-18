-- 0030 롤백 — AI 브리핑 캐시(project_ai_briefs)를 제거해 0030 적용 이전 상태로 되돌린다.
--
-- 안전성: 파생 캐시 전용 테이블이라 drop 해도 원본(wbs_items·스냅샷·회의록) 데이터 손실은 없다 —
--         다음 생성 요청이 LLM 1콜로 처음부터 다시 만든다.
-- 순서: 코드가 이 테이블을 읽는 상태에서 먼저 drop 하면 PostgREST 오류가 반복 로깅된다
--       (조회부는 isSchemaMissing 정직 강등 계약이라 화면은 죽지 않지만 로그가 오염됨).
--       가능하면 코드 롤백(또는 AI 브리핑 진입점 비활성) 후 적용할 것 — 0027 사고 교훈의 역방향.
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (정방향과 동일 경로,
--       db push 금지). 멱등: if exists 라 반복 실행 안전.
-- 정책(project_ai_briefs_read)·유니크 인덱스는 테이블과 함께 제거된다(별도 drop 불필요).

drop table if exists project_ai_briefs;
