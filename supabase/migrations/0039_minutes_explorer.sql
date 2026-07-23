-- 회의록 탐색기(스펙 2026-07-23-minutes-explorer-design.md) — 카드 요약 + 회의록 즐겨찾기.
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전. 적용: Management API POST /v1/projects/<ref>/database/query (db push 금지).
--
-- 1) body_preview — STORED 생성 컬럼. 쓰기 경로(작성·본문 교체·또박또박 외부 업로드 API)를 건드리지
--    않고 항상 일관되며, 기존 행 백필도 ALTER 시 자동(테이블 수백 행 규모라 재작성 비용 무시 가능).
--    마크다운 근사 스트립: 링크/이미지→라벨, 기호 제거, 행머리 불릿 제거, 공백 접기 후 앞 240자.
--    하이픈은 날짜(2026-07-16) 훼손을 피해 행머리 불릿 위치만 제거. 표 구분선 잔해 등 경미한 노이즈 수용.
--    사용 함수(regexp_replace/left/btrim)는 모두 IMMUTABLE — 생성 컬럼 제약 충족.
alter table minutes add column if not exists body_preview text
  generated always as (
    left(
      btrim(regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(body_md, '!?\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
            '[#*_`~>|]+', '', 'g'),
          '(^|\n)\s*[-+]\s+', '\1', 'g'),
        '\s+', ' ', 'g')),
      240)
  ) stored;

-- 2) minute_favorites — 계정별 회의록 즐겨찾기. 0017 user_preferences 와 동일한 소유자 RLS 관례
--    (순수 auth.uid() — 프로덕션 app_role() drift 무관).
create table if not exists minute_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  minute_id  uuid not null references minutes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, minute_id)
);

alter table minute_favorites enable row level security;

drop policy if exists own_minute_favorites on minute_favorites;
create policy own_minute_favorites on minute_favorites
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
