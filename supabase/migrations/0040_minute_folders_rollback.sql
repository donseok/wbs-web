-- 0040 롤백 — minutes.folder_id 컬럼과 minute_folders 테이블 제거.
-- 경고(데이터 소실): 모든 폴더와 회의록의 폴더 배정이 사라지며 복구 수단이 없다.
-- 순서: 코드가 folder_id·minute_folders 를 조회(LIST_COLS·탐색기)하는 상태에서 먼저 drop 하면
--   회의록 목록·트리가 PostgREST 42703/42P01 로 통째로 죽는다 — 반드시 코드 롤백 후 적용할 것.
-- 적용: Management API POST /v1/projects/<ref>/database/query. 멱등: if exists.
do $$
begin
  if to_regclass('public.minute_folders') is not null then
    execute 'drop policy if exists read_all_minute_folders on minute_folders';
    execute 'drop policy if exists insert_own_minute_folders on minute_folders';
    execute 'drop policy if exists update_own_minute_folders on minute_folders';
    execute 'drop policy if exists delete_own_minute_folders on minute_folders';
  end if;
end $$;
alter table minutes drop column if exists folder_id;
drop table if exists minute_folders;
