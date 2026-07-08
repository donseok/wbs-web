-- 로그인 계정(auth.users) ↔ 프로젝트 멤버(project_members) 구조적 연결.
--
-- 배경: 0013 이 '내 회의' 본인 식별을 위해 email 문자열 매칭을 도입했으나
--   (a) FK 가 없어 이메일이 어긋나면 조용히 연결이 끊기고 DB·앱 어디서도 드러나지 않으며,
--   (b) 유일한 소비자 getMyMemberIds 가 .ilike() 를 쏘아 lower(email) 함수형 인덱스를
--       쓸 수 없었고(ILIKE = ~~* 술어는 해당 인덱스와 매치 불가 → 죽은 인덱스),
--   (c) 같은 사람이 한 프로젝트에 두 행으로 들어가는 것을 막는 제약이 없었다
--       (근태 unique 는 (member_id,date) 라 '사람 단위'가 아니다).
--
-- 설계 유지: user_id 는 NULL 허용 — 0003 의 의도("외부 인력/협력사도 등록 가능하도록
-- auth.users 와 강결합하지 않는다")를 깨지 않는다. 로그인하지 않는 외부 인력은
-- user_id NULL 로 남으며 getMyMemberIds 를 호출할 일도 없다.
--
-- auth.users 에는 트리거를 걸지 않는다. postgres 롤이 걸 수는 있지만(실측 확인),
-- 실패하는 트리거는 GoTrue 회원가입 전체를 막고, 이를 막으려 exception 을 삼키면
-- 연결 실패가 조용해진다. 계정→멤버 방향 연결은 앱(actions/accounts.ts createOne)이
-- 명시적으로 수행하고, 놓친 행은 멤버 보드의 '계정 미연결' 배지로 드러낸다.
--
-- 적용 순서: 이 마이그레이션을 **먼저** 적용한 뒤 코드를 배포한다.
-- (코드가 먼저 뜨면 user_id 컬럼이 없어 project_members 조회가 400 → 멤버/내 회의가 빈다.)
-- 롤백은 0019_..._rollback.sql. 재실행 안전. 트랜잭션으로 감싸 실행할 것.

-- ── 0) 사전 점검 — 부분 유니크 인덱스를 만들 수 없는 상태면 명확히 멈춘다 ──────
-- (create unique index 는 중복 데이터에 대해 idempotent 하지 않다.)
do $$
declare dup_count int;
begin
  select count(*) into dup_count from (
    select project_id, lower(trim(email)) e
      from project_members
     where email is not null and trim(email) <> ''
     group by 1, 2 having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception '0019 중단: 같은 프로젝트에 이메일이 중복된 멤버 행이 % 조 있습니다. 먼저 정리하세요. (행 DELETE 금지 — attendance_records/meeting_attendees 가 cascade 로 함께 삭제됩니다. updateMember 로 병합하세요.)', dup_count;
  end if;
end $$;

alter table project_members
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ── 1) 이메일 정규화(at rest) ───────────────────────────────────────────────
-- 소문자로 저장하면 조회가 email = $1 등식이 되어 평범한 btree 를 탄다(ILIKE 는 못 탔다).
-- 빈 문자열은 NULL 로 — 0011 의 형식 CHECK(이미 validated)에 걸리지 않게 하고,
-- 부분 유니크 인덱스에 '' 가 두 개 들어가는 것도 막는다.
update project_members set email = null where email is not null and trim(email) = '';
update project_members set email = lower(trim(email))
 where email is not null and email <> lower(trim(email));

-- ── 2) 기존 행 백필: 이메일이 일치하는 계정을 찾아 연결 ─────────────────────
-- deleted_at 계정은 제외하고, 만에 하나 lower(email) 이 중복이면 가장 먼저 만들어진
-- 계정으로 결정적으로 고른다(UPDATE ... FROM 의 임의 선택을 피한다).
update project_members pm
   set user_id = c.id
  from (
    select distinct on (lower(u.email)) lower(u.email) as email, u.id
      from auth.users u
     where u.email is not null and u.deleted_at is null
     order by lower(u.email), u.created_at
  ) c
 where pm.user_id is null and pm.email is not null and pm.email = c.email;

-- ── 3) 중복 멤버 행 차단 ────────────────────────────────────────────────────
create unique index if not exists project_members_project_email_uidx
  on project_members (project_id, email) where email is not null;
create unique index if not exists project_members_project_user_uidx
  on project_members (project_id, user_id) where user_id is not null;

-- ── 4) 인덱스 정리 ──────────────────────────────────────────────────────────
-- 0013 의 lower(email) 함수형 인덱스는 ILIKE 술어가 쓸 수 없어 죽어 있었다.
drop index if exists project_members_email_lower_idx;
create index if not exists project_members_email_idx
  on project_members (email) where email is not null;
create index if not exists project_members_user_idx
  on project_members (user_id) where user_id is not null;

-- ── 5) 쓰기 시 정규화 + 자동 연결/재해석 ────────────────────────────────────
-- SECURITY DEFINER: authenticated 롤은 auth.users 를 읽을 수 없다.
-- search_path = '' + 전 객체 스키마 한정 — pg_temp 를 통한 객체 가로채기 차단.
create or replace function public.project_members_normalize_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
    if new.email = '' then new.email := null; end if;
  end if;

  -- 이메일이 바뀌면 기존 링크를 재해석한다. 그러지 않으면 퇴사자 계정이 후임자의
  -- 멤버 행에 남아 남의 '내 회의'를 보게 된다.
  -- 단, 호출자가 user_id 를 명시적으로 함께 지정했다면 그 의도를 존중한다.
  if tg_op = 'UPDATE'
     and new.email is distinct from old.email
     and new.user_id is not distinct from old.user_id then
    new.user_id := null;
  end if;

  if new.user_id is null and new.email is not null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = new.email and u.deleted_at is null
     order by u.created_at
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_normalize_link_trg on project_members;
create trigger project_members_normalize_link_trg
before insert or update on project_members
for each row execute function public.project_members_normalize_link();
