-- 이슈 분석서 AI 실행 결과 캐시/감사 스냅샷.
--
-- 원칙:
--   1) 입력 해시 + 프롬프트 버전이 같으면 같은 실행 행을 재사용한다.
--   2) 이슈가 나중에 hard delete 되어도 어떤 입력으로 생성했는지 확인할 수 있도록
--      input_snapshot 을 독립 보존한다.
--   3) 프로젝트 멤버는 읽기만 가능하고 쓰기는 service_role 서버 경로만 수행한다.

begin;

set search_path = public, extensions;

create table if not exists public.issue_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  input_hash text not null
    check (input_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text not null
    check (length(trim(prompt_version)) between 1 and 100),
  model text not null
    check (length(trim(model)) between 1 and 200),
  status text not null default 'ready'
    check (status in ('ready', 'failed')),
  analysis_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(analysis_json) = 'object'),
  input_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_snapshot) = 'object'),
  issue_count integer not null default 0
    check (issue_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint issue_analysis_runs_input_unique
    unique (project_id, input_hash, prompt_version)
);

create index if not exists issue_analysis_runs_project_created_idx
  on public.issue_analysis_runs (project_id, created_at desc);

alter table public.issue_analysis_runs enable row level security;

drop policy if exists issue_analysis_runs_select_project_members
  on public.issue_analysis_runs;
create policy issue_analysis_runs_select_project_members
  on public.issue_analysis_runs
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- 브라우저 클라이언트에는 SELECT 만 열고, INSERT/UPDATE/DELETE 정책은 만들지 않는다.
revoke all on table public.issue_analysis_runs from public, anon, authenticated;
grant select on table public.issue_analysis_runs to authenticated;
grant all on table public.issue_analysis_runs to service_role;

reset search_path;

commit;
