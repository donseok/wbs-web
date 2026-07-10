-- 주간업무 시트 제목 자유 편집 — 레퍼런스 시트의 "ERP부분" 같은 범위 라벨은 프로젝트명이 아니므로
-- 문서 단위 자유 텍스트가 필요하다. ''이면 화면이 기본 제목(▣ 주간업무보고 - {프로젝트명}({주차}))을 합성.
-- 권한: 기존 weekly_reports update 정책(authenticated 전원)이 그대로 커버 — 정책 변경 없음.
-- 멱등: if not exists. 적용: Supabase Management API POST /v1/projects/<ref>/database/query (0023과 동일 경로).
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 코드를 배포한다(추가 컬럼이라 구버전 코드에 무해).

alter table weekly_reports add column if not exists title text not null default '';
