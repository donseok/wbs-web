-- 0069: agent_runners — 사용자 PAT(user_pat)·머신 러너(runner) 겸용 자격증명 테이블.
-- 코퍼스 docs/design/agent-coding-platform/21-multi-client-model.md 초안에 합류하되 두 곳 수정:
--   ① name 전역 unique → unique(owner_user_id, name): 사용자별 PAT 공존 시 이름 선점 충돌 방지.
--   ② owner_user_id on delete cascade 유지: 소유자 소멸 = 자격증명 즉시 소멸(잔존 행 = 고아 credential).
--      에이전트 활동 감사는 토큰 행이 아니라 usage 이벤트 몫.
-- token_hash 는 sha256(전체 토큰) hex. 평문은 발급 응답 1회만 존재한다.
-- 멱등: 반복 실행 안전(0057 관례).

begin;

set search_path = public, extensions;

create table if not exists public.agent_runners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'user_pat'
    check (kind in ('user_pat','runner')),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_prefix text not null unique,
  token_hash text not null,
  -- null = 전 프로젝트(멤버십 게이트는 별도). 슈퍼유저 PAT 는 발급 규칙으로 지정 강제(§2.2).
  project_id uuid references public.projects(id) on delete cascade,
  scopes text[] not null default '{work:read}',
  enabled boolean not null default true,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

create index if not exists agent_runners_owner_idx on public.agent_runners (owner_user_id);

-- RLS: 정책 0개 — authenticated 는 이 테이블을 어떤 경로로도 읽지 못한다(token_hash 비노출).
-- 발급·목록·폐기는 전부 세션 가드를 통과한 서버 액션이 service_role 로 수행한다.
alter table public.agent_runners enable row level security;

revoke all on table public.agent_runners from public, anon, authenticated;
grant all on table public.agent_runners to service_role;

reset search_path;

commit;
