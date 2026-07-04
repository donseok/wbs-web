-- 계정별 UI 설정 동기화 — 로컬 우선 + 서버 동기화.
-- user_preferences: 전역 설정(요약접기/사이드바/테마/언어) 사용자당 1행 JSONB.
-- user_wbs_state : WBS 트리 접힘 상태 (사용자, 프로젝트)당 1행 (announcement_seen 과 동일 형태).
-- RLS: 본인 행만. 순수 auth.uid() 사용(프로덕션 app_role() drift 무관).
-- 멱등: SQL Editor 에 여러 번 붙여넣어도 안전. 적용: Management API POST /v1/projects/<ref>/database/query.

create table if not exists user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists user_wbs_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  collapsed  jsonb not null default '[]'::jsonb,  -- 접힌 노드 id 문자열 배열
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table user_preferences enable row level security;
alter table user_wbs_state   enable row level security;

drop policy if exists own_user_preferences on user_preferences;
create policy own_user_preferences on user_preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_user_wbs_state on user_wbs_state;
create policy own_user_wbs_state on user_wbs_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
