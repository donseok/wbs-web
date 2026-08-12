-- 0076 롤백 — 프로젝트 소속 폴더 재편 원복.
-- 순서가 중요하다: ① 프로젝트 루트 삭제(cascade 로 하위 폴더 전부 삭제,
-- minutes.folder_id 는 on delete set null 로 미분류 강등 — 본문 데이터 소실 없음)
-- ② 그 다음에야 전역 루트 유니크를 복원할 수 있다(동명 프로젝트 루트가 남아 있으면 실패)
-- ③ 컬럼 drop. 편철 위치 복원은 outputs/ 의 백필 스냅샷으로 별도 스크립트 실행.
delete from minute_folders where project_id is not null and parent_id is null;

drop index if exists minute_folders_root_name_proj_uniq;
drop index if exists minute_folders_root_name_null_proj_uniq;
create unique index if not exists minute_folders_root_name_uniq
  on minute_folders (name) where parent_id is null;

drop index if exists minute_folders_project_idx;
alter table minute_folders drop column if exists project_id;
