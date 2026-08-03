-- 프로젝트 초대 — "지정된 한 사람에게, 그 사람의 메일함으로만, 한 번만 가는 열쇠".
-- (설계 정본: docs/design/project-invite-spec-v2.md)
--
-- 왜
--   이 레포의 RLS 는 authenticated 전원에게 using (true) 인 SELECT 정책이 40개 넘는 테이블에
--   걸려 있다. 즉 계정 발급이 곧 전사 읽기 개방이고, project_roles 의 member 는 조회 등급이
--   아니라 쓰기 등급이다. "링크를 아는 누구나 임의 이메일로 가입"하는 초대라면 링크 한 줄의
--   유출이 곧 전사 데이터 열람 + 운영 데이터 쓰기가 된다. RLS 구조를 건드리지 않고 링크의
--   성질을 바꾸는 것이 이 설계의 해법이며, 그 강제 지점이 이 테이블과 소비 함수다.
--
-- 핵심 계약
--   1) 1회용이다. use_count/max_uses 를 두지 않는다 — redeemed_at is null 이 곧 미사용이다.
--      expires_at 은 not null 이라 무기한 링크를 만들 수 없다(유출 창 최소화).
--   2) 수신 이메일을 행에 못 박고, 소비 함수가 이메일 일치를 DB 레벨에서 강제한다. 앱 계층이
--      실수로 다른 주소를 넣어도 초대는 소비되지 않는다. 정규화 규칙(lower(btrim(...)))을
--      CHECK 로 고정해 앱의 normalizeInviteEmail 과 한 벌로 움직이게 한다.
--   3) 취소는 소프트다(revoked_at). 합류 기록(redeemed_by/redeemed_at)도 지우지 않는다 —
--      사고 때 "누가 만든 어떤 초대로 누가 언제 들어왔나"를 되짚을 유일한 근거다.
--   4) RLS 를 켜되 정책을 0개 만드는 것이 곧 계약이다. token 은 그 자체로 가입 자격이므로
--      authenticated 에게도 노출하지 않는다. 읽기·쓰기 모두 service_role(서버 액션) 전용이다.
--      RLS 는 TRUNCATE 를 막지 못하므로 기본 GRANT 를 통째로 회수한다(0051 주석과 같은 이유).
--   5) team_id 는 on delete restrict — 팀이 WBS 쓰기 범위를 결정한다. 팀이 사라진 채 남은
--      초대가 소비돼 소속 없는 합류가 생기는 경로를 만들지 않는다.
--   6) created_by/redeemed_by 는 on delete set null — 계정이 지워져도 초대·합류 사실 자체는
--      감사 기록으로 남는다(3항). 그래서 redeem 쌍 CHECK 는 **한 방향만** 금지한다:
--      (uuid, null) 즉 "합류자는 있는데 합류 시각이 없는" 상태만 거부하고, (null, timestamp)
--      즉 "합류는 있었으나 그 계정이 지워진" 상태는 허용한다. 양방향 등가로 묶으면 SET NULL 이
--      만드는 그 상태를 CHECK 가 거부해 **auth.users 삭제 자체가 실패**하고, 보상 롤백 경로
--      (계정 생성 후 후속 실패 시 deleteUser)까지 막힌다. 상세는 아래 제약 주석.
--
-- 멱등: 반복 실행 안전(create ... if not exists / create or replace).
-- 적용: Supabase Management API POST /v1/projects/<ref>/database/query (supabase db push 금지).
-- 적용 순서: 이 마이그레이션을 먼저 적용한 뒤 앱 코드를 배포한다. 코드가 먼저 나가면 모든
--   프로젝트 관리자의 설정 화면이 PGRST 오류를 낸다(0027 교훈).
-- 롤백: 0065_project_invites_rollback.sql (발급·합류 이력이 전부 소실된다).

begin;

set search_path = public, extensions;

-- ── 1) 초대 테이블 ──────────────────────────────────────────────────────────
create table if not exists public.project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  token       uuid not null unique,
  email       text not null,
  team_id     uuid not null references public.teams(id) on delete restrict,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  constraint project_invites_email_normalized check (email = lower(btrim(email)) and email <> ''),
  -- 막는 것: (redeemed_by, redeemed_at) = (uuid, null). 합류자는 적혔는데 합류 시각이 없으면
  --   "사용됨" 판정(redeemed_at is null 이 곧 미사용, 헤더 1항)과 추적(redeemed_by)이 서로
  --   다른 말을 하고, 그 행은 부분 유니크상 여전히 활성이라 같은 사람에게 초대가 또 발급된다.
  -- 허용하는 것: (null, null) 미사용 · (uuid, ts) 사용됨 · (null, ts) 합류는 있었으나 그
  --   계정이 지워진 감사 기록.
  -- 등가(=)로 묶지 말 것. redeemed_by 는 on delete set null 이므로 초대로 합류한 계정을
  --   auth.users 에서 지우면 DB 가 (null, ts) 를 만든다. 등가 CHECK 는 이를 거부해 계정 삭제
  --   트랜잭션을 통째로 실패시키고, 가입 후 후속 단계 실패 시 되돌리는 보상 경로(deleteUser)도
  --   함께 막는다. 감사 기록을 남기겠다는 헤더 3·6항이 스키마로 지켜지지 않게 된다.
  constraint project_invites_redeem_pair check (redeemed_by is null or redeemed_at is not null)
);

-- 같은 사람에게 활성 초대가 둘 생기지 않게 한다. 취소·합류한 행은 이력으로 남아야 하므로
-- 전체 유니크가 아니라 활성분만 잡는 부분 유니크다.
create unique index if not exists project_invites_active_email_uidx
  on public.project_invites (project_id, email)
  where redeemed_at is null and revoked_at is null;

-- 설정 화면의 프로젝트별 초대 목록(최신순).
create index if not exists project_invites_project_created_idx
  on public.project_invites (project_id, created_at desc);

-- ── 2) RLS — 정책 0개 + 최소 권한 ──────────────────────────────────────────
alter table public.project_invites enable row level security;

-- 정책을 하나도 두지 않는 것이 헤더 4항의 강제 수단이다. anon 이 token 을 한 줄이라도
-- 읽으면 초대 체계 전체가 무너지므로 표면 자체를 남기지 않는다.
revoke all on table public.project_invites from public, anon, authenticated;
grant all on table public.project_invites to service_role;

-- ── 3) 원자 소비 — 검증과 소비를 단일 UPDATE 로 ────────────────────────────
-- 만료·취소·이미 사용·이메일 불일치를 술어 하나로 합쳐, 확인과 소비 사이에 다른 세션이
-- 끼어드는 창을 없앤다. 반환 행이 없으면 위 넷 중 하나이며 호출자는 구분하지 않는다.
create or replace function public.consume_project_invite(
  p_token uuid, p_email text, p_user uuid
) returns table (project_id uuid, team_id uuid, invite_email text, created_by uuid)
language sql
volatile
security invoker
set search_path = public, extensions
as $$
  update public.project_invites pi
     set redeemed_by = p_user, redeemed_at = now()
   where pi.token = p_token
     and pi.redeemed_at is null
     and pi.revoked_at is null
     and pi.expires_at > now()
     and pi.email = lower(btrim(p_email))
  returning pi.project_id, pi.team_id, pi.email, pi.created_by;
$$;

revoke all on function public.consume_project_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_project_invite(uuid, text, uuid) to service_role;

-- ── 4) 적용 검증 ───────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.project_invites') is null then
    raise exception '0065 검증 실패: public.project_invites 테이블이 없습니다';
  end if;
  if to_regprocedure('public.consume_project_invite(uuid, text, uuid)') is null then
    raise exception '0065 검증 실패: consume_project_invite 함수가 없습니다';
  end if;
  if to_regclass('public.project_invites_active_email_uidx') is null then
    raise exception '0065 검증 실패: 활성 초대 부분 유니크 인덱스가 없습니다';
  end if;
  if to_regclass('public.project_invites_project_created_idx') is null then
    raise exception '0065 검증 실패: 초대 목록 조회 인덱스가 없습니다';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.project_invites'::regclass and relrowsecurity
  ) then
    raise exception '0065 검증 실패: project_invites 에 RLS 가 꺼져 있습니다';
  end if;
  -- 정책이 하나라도 생기면 token 이 authenticated 에 노출된다(헤더 4항).
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_invites'
  ) then
    raise exception '0065 검증 실패: project_invites 에 RLS 정책이 있습니다 (0개가 계약)';
  end if;
end
$$;

reset search_path;

commit;
