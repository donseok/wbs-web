-- 0091: announcements.milestone_date — 공지를 대시보드 마일스톤 타임라인에 찍을 날짜
--
-- 배경(2026-08-28 사용자 요청): 타임라인은 WBS 리프(키워드·하루짜리+산출물)만 보므로 공지는 원래
-- 표시 대상이 아니었다(같은 이름의 WBS 항목이 우연히 있을 때만 보이는 것처럼 됐다). 공지 폼의
-- '마일스톤 타임라인에 표시' 체크가 이 컬럼을 채운다. 게시 기간(publish_from/to)은 노출 창이지
-- 행사일이 아니라 별도 날짜가 필요하다. null = 표시 안 함(체크 해제). 기본값·NOT NULL 제약 없음 — 기존
-- 행은 전부 null 로 남아 화면 변화 0(표시할 공지는 사용자가 고른다).
alter table public.announcements
  add column if not exists milestone_date date;

comment on column public.announcements.milestone_date is
  '대시보드 마일스톤 타임라인에 찍을 날짜 — null 이면 표시 안 함(공지 폼 체크박스)';
