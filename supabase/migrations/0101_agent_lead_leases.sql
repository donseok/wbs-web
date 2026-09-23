-- supabase/migrations/0101_agent_lead_leases.sql
-- 팀장 lease — 신원+프로젝트당 /dflow-team 팀장 하나(docs/superpowers/specs/2026-09-23-dflow-lead-lease-design.md).
-- 로컬 잠금(dflow-team.lock)은 같은 리포의 워크트리끼리만 본다. 다른 clone·다른 PC 의 같은 신원 팀장을 여기서 막는다.
-- RLS 는 켜고 정책은 두지 않는다 — 0095 가 agent_watchers 에서 지운 이유(로그인 사용자 전체가 남의 신원·host 를 읽음)가
-- 그대로 해당한다. 읽기·쓰기는 service_role(API·서버 액션)만 한다.
begin;

create table if not exists public.agent_lead_leases (
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  holder      text,                       -- '<PC ID>:<리포 경로 cksum>'. null = 비어 있음
  host        text,                       -- 표시용 hostname 슬러그
  agent       text,                       -- 표시용 '<신원>/<host>/lead'
  generation  bigint not null default 0,  -- 펜싱 토큰. 획득·인수·해제 때 오른다
  acquired_at timestamptz,
  renewed_at  timestamptz,
  expires_at  timestamptz,
  primary key (user_id, project_id)
);
alter table public.agent_lead_leases enable row level security;

-- TTL 은 여기 한 곳이다. 스킬의 갱신 주기(60초)와 연속 실패 허용(3회)이 이 값에 맞춰져 있다.
create or replace function public.lead_lease_ttl() returns interval
language sql immutable as $$ select interval '180 seconds' $$;

-- 전부 아니면 전무: 하나라도 막히면 아무것도 바꾸지 않고 막힌 행만 돌려준다.
create or replace function public.lead_lease_acquire(
  p_user uuid, p_projects uuid[], p_holder text, p_host text, p_agent text, p_takeover boolean
) returns table (project_id uuid, ok boolean, generation bigint, host text, agent text, expires_at timestamptz)
language plpgsql as $$
#variable_conflict use_column
begin
  insert into public.agent_lead_leases (user_id, project_id)
    select p_user, x from unnest(p_projects) as x
    on conflict do nothing;
  perform 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
    order by l.project_id
    for update;
  if not p_takeover and exists (
    select 1 from public.agent_lead_leases l
    where l.user_id = p_user and l.project_id = any(p_projects)
      and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
  ) then
    return query
      select l.project_id, false, l.generation, l.host, l.agent, l.expires_at
      from public.agent_lead_leases l
      where l.user_id = p_user and l.project_id = any(p_projects)
        and l.holder is not null and l.holder <> p_holder and l.expires_at >= now()
      order by l.project_id;
    return;
  end if;
  return query
    update public.agent_lead_leases l
       set holder = p_holder, host = p_host, agent = p_agent,
           generation = l.generation + 1,
           acquired_at = now(), renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
     where l.user_id = p_user and l.project_id = any(p_projects)
    returning l.project_id, true, l.generation, l.host, l.agent, l.expires_at;
end $$;

-- holder·generation 이 둘 다 맞을 때만 늘린다. 만료됐어도 아무도 가져가지 않았으면 갱신된다.
create or replace function public.lead_lease_renew(p_user uuid, p_holder text, p_leases jsonb)
returns table (project_id uuid, ok boolean, expires_at timestamptz)
language plpgsql as $$
#variable_conflict use_column
begin
  return query
    with want as (
      select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
      from jsonb_array_elements(p_leases) as e
    ), upd as (
      update public.agent_lead_leases l
         set renewed_at = now(), expires_at = now() + public.lead_lease_ttl()
        from want w
       where l.user_id = p_user and l.project_id = w.pid
         and l.holder = p_holder and l.generation = w.gen
      returning l.project_id, l.expires_at
    )
    select w.pid, (u.project_id is not null), u.expires_at
    from want w left join upd u on u.project_id = w.pid
    order by w.pid;
end $$;

-- 행을 지우지 않는다: generation 을 이어 가야 옛 팀장의 갱신이 확실히 실패한다.
create or replace function public.lead_lease_release(p_user uuid, p_holder text, p_leases jsonb)
returns integer
language plpgsql as $$
declare n integer;
begin
  with want as (
    select (e->>'project_id')::uuid as pid, (e->>'generation')::bigint as gen
    from jsonb_array_elements(p_leases) as e
  )
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
    from want w
   where l.user_id = p_user and l.project_id = w.pid
     and l.holder = p_holder and l.generation = w.gen;
  get diagnostics n = row_count;
  return n;
end $$;

-- 웹 「팀장 해제」. 권한 판정은 서버 액션이 먼저 한다 — 이 함수는 조건 없이 푼다.
create or replace function public.lead_lease_force_release(p_user uuid, p_project uuid)
returns integer
language plpgsql as $$
declare n integer;
begin
  update public.agent_lead_leases l
     set holder = null, expires_at = now(), generation = l.generation + 1
   where l.user_id = p_user and l.project_id = p_project
     and l.holder is not null and l.expires_at >= now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.lead_lease_renew(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.lead_lease_release(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.lead_lease_force_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_lease_acquire(uuid, uuid[], text, text, text, boolean) to service_role;
grant execute on function public.lead_lease_renew(uuid, text, jsonb) to service_role;
grant execute on function public.lead_lease_release(uuid, text, jsonb) to service_role;
grant execute on function public.lead_lease_force_release(uuid, uuid) to service_role;

commit;
