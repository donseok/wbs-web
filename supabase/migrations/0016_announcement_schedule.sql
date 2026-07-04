-- 공지사항 게시 기간(from ~ to) — 지정 기간에만 노출.
-- 두 컬럼 모두 date(Asia/Seoul 기준 'YYYY-MM-DD 자정' 경계). nullable:
--   신규 공지는 폼에서 두 값 필수이나, 0012 시점의 기존 행은 값이 없다 →
--   null = 무기한(상시 노출)으로 해석해 legacy 공지가 그대로 살아있게 한다.
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전 (if not exists / drop constraint if exists).
-- 적용: Supabase Management API — POST /v1/projects/<ref>/database/query (0012와 동일 경로).

alter table announcements add column if not exists publish_from date;
alter table announcements add column if not exists publish_to date;

-- from <= to 강제 (한쪽이라도 null 이면 통과 — 무기한 경계 허용)
alter table announcements drop constraint if exists announcements_publish_range_chk;
alter table announcements add constraint announcements_publish_range_chk
  check (publish_from is null or publish_to is null or publish_from <= publish_to);

-- 티커/대시보드의 '게시중' 필터( publish_to >= today )를 돕는 부분 인덱스.
create index if not exists announcements_publish_window_idx
  on announcements(project_id, publish_to);
