-- 로그인 계정(auth.users) ↔ 프로젝트 멤버(project_members) 구조적 연결.
--
-- 배경: 0013 이 '내 회의' 본인 식별을 위해 email 문자열 매칭을 도입했으나
--   (a) FK 가 없어 이메일이 한 글자만 달라도 조용히 연결이 끊기고,
--   (b) 유일한 소비자 getMyMemberIds 가 .ilike() 를 쏘아 lower(email) 함수형 인덱스를
--       쓸 수 없었으며(ILIKE = ~~* 술어는 해당 인덱스와 매치 불가 → 죽은 인덱스),
--   (c) 계정을 만들어도 멤버 행이 생기지 않아 대다수가 '내 회의' 빈 화면을 봤다.
--
-- 설계 유지: user_id 는 NULL 허용 — 0003 의 의도("외부 인력/협력사도 등록 가능하도록
-- auth.users 와 강결합하지 않는다")를 깨지 않는다. 로그인하지 않는 외부 인력은
-- user_id NULL 로 남으며 getMyMemberIds 를 호출할 일도 없다.
--
-- 재실행 안전(SQL Editor 수동 적용 워크플로우). 롤백은 0019_..._rollback.sql.

alter table project_members
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ── 이메일 소문자 정규화(at rest) ────────────────────────────────────────────
-- 이후 조회는 email = $1 등식이 되어 평범한 btree 인덱스를 탄다(ILIKE 는 못 탔다).
update project_members
   set email = lower(trim(email))
 where email is not null and email <> lower(trim(email));

-- ── 기존 행 백필: 이메일이 일치하는 계정을 찾아 연결 ─────────────────────────
update project_members pm
   set user_id = u.id
  from auth.users u
 where pm.user_id is null
   and pm.email is not null
   and lower(u.email) = pm.email;

-- ── 중복 멤버 행 차단 ───────────────────────────────────────────────────────
-- 근태 unique 가 (member_id, date) 라 '사람 단위'가 아니다. 같은 사람이 한 프로젝트에
-- 두 행으로 존재하면 같은 날 '연차'와 '출근'이 동시에 저장되고, 주간보고 근태표와
-- 참석자 피커에 동일인이 두 줄로 찍히며 attendeeCount 가 부풀려진다.
create unique index if not exists project_members_project_email_uidx
  on project_members (project_id, email) where email is not null;
create unique index if not exists project_members_project_user_uidx
  on project_members (project_id, user_id) where user_id is not null;

-- ── 인덱스 정리 ─────────────────────────────────────────────────────────────
-- 0013 의 lower(email) 함수형 인덱스는 ILIKE 술어가 쓸 수 없어 죽어 있었다.
-- 소문자 정규화 후에는 평범한 btree 가 email = $1 을 커버한다.
drop index if exists project_members_email_lower_idx;
create index if not exists project_members_email_idx
  on project_members (email) where email is not null;
create index if not exists project_members_user_idx
  on project_members (user_id) where user_id is not null;

-- ── 쓰기 시 정규화 + 자동 연결 ──────────────────────────────────────────────
-- 멤버를 먼저 등록하고 계정을 나중에 만드는 순서도 있으므로 양방향 트리거를 둔다.
create or replace function project_members_normalize_link()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;
  if new.user_id is null and new.email is not null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_normalize_link_trg on project_members;
create trigger project_members_normalize_link_trg
before insert or update on project_members
for each row execute function project_members_normalize_link();

-- 계정이 나중에 생기는 경우: 같은 이메일의 미연결 멤버 행을 잇는다.
create or replace function auth_user_link_project_members()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is null then return new; end if;
  update project_members pm
     set user_id = new.id
   where pm.user_id is null
     and pm.email is not null
     and pm.email = lower(new.email);
  return new;
exception when others then
  -- 계정 생성(GoTrue)을 절대 막지 않는다. 연결 실패는 멤버 화면의 '계정 미연결' 배지로 드러난다.
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_members on auth.users;
create trigger on_auth_user_created_link_members
after insert on auth.users
for each row execute function auth_user_link_project_members();
