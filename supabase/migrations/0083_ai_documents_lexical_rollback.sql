-- 0083 역연산. 색인 데이터는 건드리지 않는다 — 인덱스와 함수만 되돌린다.
-- pg_trgm 확장은 남긴다(다른 곳이 쓰기 시작했을 수 있고, 드롭은 의존 객체를 깨뜨린다).

begin;

drop function if exists public.match_ai_documents_lexical(
  text, int, uuid[], boolean, text[], text[], int
);
drop index if exists public.ai_documents_content_trgm_idx;
drop index if exists public.ai_documents_title_trgm_idx;

commit;
