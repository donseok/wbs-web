-- 진척 추세(스냅샷) 기능 제거 — 대시보드 추세 카드 삭제에 따른 스키마 정리.
-- 정책·인덱스는 테이블과 함께 자동 삭제된다.
drop table if exists progress_snapshots cascade;
