-- 회의록 외부 링크 공유 — share_token(비로그인 열람 토큰) / share_enabled(토글).
-- 멱등: 반복 실행 안전. RLS 무변경 — anon 정책을 추가하지 않는다(공개 조회는
-- /share/minutes/[token] 서버 컴포넌트가 service_role 로 정확 일치 조회만 수행).
alter table minutes add column if not exists share_token uuid;
alter table minutes add column if not exists share_enabled boolean not null default false;

create unique index if not exists idx_minutes_share_token
  on minutes(share_token) where share_token is not null;
