-- 0039 롤백 — body_preview 생성 컬럼과 minute_favorites 테이블 제거.
-- 경고(데이터 소실): 모든 사용자의 즐겨찾기 별이 사라지며 복구 수단이 없다.
--   body_preview 는 생성 컬럼이라 소실 데이터 없음(재적용 시 자동 재계산).
-- 순서: 코드가 body_preview 를 조회(LIST_COLS)하는 상태에서 먼저 drop 하면 회의록 목록·트리가
--   PostgREST 42703 으로 통째로 죽는다 — 반드시 코드 롤백(이전 배포로 되돌림) 후 적용할 것.
-- 적용: Management API POST /v1/projects/<ref>/database/query (정방향과 동일 경로, db push 금지).
-- 멱등: if exists 라 반복 실행 안전.
do $$
begin
  if to_regclass('public.minute_favorites') is not null then
    execute 'drop policy if exists own_minute_favorites on minute_favorites';
  end if;
end $$;
drop table if exists minute_favorites;
alter table minutes drop column if exists body_preview;
