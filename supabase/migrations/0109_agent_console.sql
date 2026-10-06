-- supabase/migrations/0109_agent_console.sql
-- 에이전트 콘솔 — 오피스(좌석표)에서 세션에 프롬프트를 보내고, 세션의 최근 화면(끝 40줄)을 본다.
-- 계약 정본: dmes-standard .claude/skills/dflow-work/references/api-contract.md §2.12(로컬 폴러는 coordinator contract.md §4.1).
-- 서버는 대기열과 화면 한 장만 맡고, 전달은 PC 마다 도는 폴러가 맡는다.
-- RLS 는 켜고 정책은 두지 않는다(0095 선례) — 본문·화면은 세션 주인의 것이고, 읽기·쓰기는 service_role(API·서버 액션)만 한다.
-- claim 토큰은 원문을 저장하지 않는다 — 앱이 만든 무작위 토큰의 sha256 hex 만 받는다(원문은 poll 응답에 한 번만 실린다).
-- 동작 시나리오: tests/migrations/sql/0109-scenario.sql(로컬 Postgres 로 돌린다 — tests/migrations/0109-agent-console.test.ts).
begin;

create table if not exists public.agent_console_prompts (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null references auth.users(id) on delete cascade,
  -- 대상 PC 슬러그. 서버가 좌석 키(<신원>/<host>/<slot>)에서 파생한다 — 클라이언트 값은 받지 않는다(0099 선례).
  host             text not null check (host ~ '^[a-z0-9-]{1,63}$'),
  target_kind      text not null check (target_kind in ('coord_lead', 'coord_lane', 'team_lead', 'team_worker')),
  target_ref       text not null check (target_ref ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- 정리된 본문. 길이는 코드포인트(char_length)로 잰다.
  text             text not null check (char_length(text) between 1 and 2000 and position('!' in text) = 0),
  status           text not null default 'pending'
                   check (status in ('pending', 'claimed', 'sent', 'refused', 'expired', 'unknown')),
  claim_token_hash text check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  attempts         integer not null default 0,
  claimed_at       timestamptz,
  acked_at         timestamptz,
  -- 최종 상태(sent·refused·expired·unknown)가 된 시각 — 7일 정리의 기준이다.
  finished_at      timestamptz,
  result_detail    text check (result_detail is null or result_detail in ('turn_started', 'submitted', 'accepted')),
  -- 폴러가 돌려준 사유(계약 §2.12 표). 표시용이지만 목록 밖 값은 받지 않는다.
  reason           text check (reason is null or reason in (
                     'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '10 minutes',
  -- claimed 이면 토큰과 집은 시각이 있어야 한다(120초 판정·ack 대조의 재료).
  check (status <> 'claimed' or (claim_token_hash is not null and claimed_at is not null))
);
alter table public.agent_console_prompts enable row level security;

-- poll: owner·host 의 pending 을 오래된 순으로. 전달 상태 표: 대상별. 1분 건수: owner.
create index if not exists agent_console_prompts_poll_idx
  on public.agent_console_prompts (owner, host, status, created_at);
create index if not exists agent_console_prompts_target_idx
  on public.agent_console_prompts (owner, host, target_kind, target_ref, created_at desc);
create index if not exists agent_console_prompts_owner_created_idx
  on public.agent_console_prompts (owner, created_at);
-- 정리(sweep)는 host 를 보지 않는다 — 살아 있는 행만 담는 부분 인덱스로 owner 의 전 이력을 훑지 않게 한다.
create index if not exists agent_console_prompts_live_idx
  on public.agent_console_prompts (owner, status, claimed_at) where status in ('pending', 'claimed');
-- 7일 정리 — 최종 행만.
create index if not exists agent_console_prompts_finished_idx
  on public.agent_console_prompts (owner, finished_at) where finished_at is not null;

create table if not exists public.agent_console_screens (
  owner       uuid not null references auth.users(id) on delete cascade,
  host        text not null check (host ~ '^[a-z0-9-]{1,63}$'),
  target_kind text not null check (target_kind in ('coord_lead', 'coord_lane', 'team_lead', 'team_worker')),
  target_ref  text not null check (target_ref ~ '^[A-Za-z0-9._:-]{1,64}$'),
  -- 끝 40줄, 합계 8KB(UTF-8 바이트) 이하, 빈 칸(NULL) 없음. 폴러가 비밀 모양 문자열을 가린 뒤 올린다.
  -- 앱(screen 라우트)은 항목마다 이보다 엄격하게 먼저 거른다 — 여기는 마지막 방어선이다.
  lines       text[] not null check (
                cardinality(lines) <= 40 and array_position(lines, null) is null
                and octet_length(array_to_string(lines, '')) <= 8192),
  sha         text not null check (sha ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null,
  updated_at  timestamptz not null default now(),
  primary key (owner, host, target_kind, target_ref)
);
alter table public.agent_console_screens enable row level security;
-- 24시간 갱신이 없는 화면을 지우는 데 쓴다.
create index if not exists agent_console_screens_updated_idx on public.agent_console_screens (updated_at);

-- 테이블은 service_role 만 만진다 — RLS 는 TRUNCATE 를 막지 못하므로 기본 권한도 거둔다.
revoke all on table public.agent_console_prompts from public, anon, authenticated;
revoke all on table public.agent_console_screens from public, anon, authenticated;

-- 게으른 상태 전이 — 별도 크론 없이 poll·보내기·ack 가 부를 때마다 이 owner 의 행만 정리한다.
-- 만료 지난 pending → expired, claimed 로 120초 응답이 없으면 → unknown(입력창에 들어갔는지 모르므로 다시 보내지 않는다).
-- 최종 상태가 된 지 7일이 지난 행은 지운다.
create or replace function public.agent_console_sweep(p_owner uuid) returns void
language sql set search_path = '' as $$
  update public.agent_console_prompts
     set status = 'expired', finished_at = now()
   where owner = p_owner and status = 'pending' and expires_at < now();
  update public.agent_console_prompts
     set status = 'unknown', finished_at = now()
   where owner = p_owner and status = 'claimed' and claimed_at < now() - interval '120 seconds';
  delete from public.agent_console_prompts
   where owner = p_owner and status in ('sent', 'refused', 'expired', 'unknown')
     and coalesce(finished_at, created_at) < now() - interval '7 days';
$$;

-- 대기열에 넣기(서버 액션 — 보내는 사람 = 세션 주인). 1분 5건·대상당 pending+claimed 3건은 owner 단위 advisory lock 안에서
-- 세어 동시 요청이 한도를 넘지 못하게 한다(READ COMMITTED 에서 문장마다 새 스냅샷 — STABLE 로 바꾸지 않는다).
-- 결과: ok(id 채움) · rate_limited · queue_full.
create or replace function public.agent_console_enqueue(
  p_owner uuid, p_host text, p_kind text, p_ref text, p_text text
) returns table (outcome text, id uuid)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('agent_console:' || p_owner::text, 0));
  perform public.agent_console_sweep(p_owner);
  if (select count(*) from public.agent_console_prompts p
       where p.owner = p_owner and p.created_at > now() - interval '1 minute') >= 5 then
    return query select 'rate_limited'::text, null::uuid;
    return;
  end if;
  if (select count(*) from public.agent_console_prompts p
       where p.owner = p_owner and p.host = p_host and p.target_kind = p_kind and p.target_ref = p_ref
         and p.status in ('pending', 'claimed')) >= 3 then
    return query select 'queue_full'::text, null::uuid;
    return;
  end if;
  insert into public.agent_console_prompts (owner, host, target_kind, target_ref, text)
    values (p_owner, p_host, p_kind, p_ref, p_text)
    returning agent_console_prompts.id into v_id;
  return query select 'ok'::text, v_id;
end $$;

-- poll — 이 owner·host 의 만료 전 pending 을 오래된 순으로 최대 cardinality(p_token_hashes)건(1~10) 한 문장으로 claimed 로 바꾼다.
-- 행마다 p_token_hashes[n](앱이 만든 토큰의 sha256)을 붙이고 n(token_index, 1부터)을 돌려준다 — 앱은 그 번호로 원문 토큰을
-- 짝짓고, 돌려받는 행의 순서는 정해지지 않으므로 token_index 로 정렬해 오래된 순을 지킨다.
-- skip locked: 같은 행을 두 폴러가 받을 수 없다. 한 번에 집은 행은 claimed_at 이 같아 120초 창을 함께 쓴다.
create or replace function public.agent_console_claim(
  p_owner uuid, p_host text, p_token_hashes text[]
) returns table (id uuid, target_kind text, target_ref text, text text, expires_at timestamptz, token_index integer)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_n integer := coalesce(cardinality(p_token_hashes), 0);
begin
  if v_n < 1 or v_n > 10 then
    raise exception 'agent_console_claim: token count % out of range 1..10', v_n using errcode = '22023';
  end if;
  perform public.agent_console_sweep(p_owner);
  return query
    with locked as materialized (
      select p.id, p.created_at from public.agent_console_prompts p
       where p.owner = p_owner and p.host = p_host and p.status = 'pending' and p.expires_at >= now()
       order by p.created_at, p.id
       limit v_n
       for update skip locked
    ), numbered as (
      select l.id, row_number() over (order by l.created_at, l.id)::integer as rn from locked l
    )
    update public.agent_console_prompts p
       set status = 'claimed', claim_token_hash = p_token_hashes[n.rn], claimed_at = now(), attempts = p.attempts + 1
      from numbered n
     where p.id = n.id
    returning p.id, p.target_kind, p.target_ref, p.text, p.expires_at, n.rn;
end $$;

-- ack — 토큰이 맞는 claimed 행에만 결과를 쓴다. 먼저 정리를 돌려 120초가 지난 claimed 를 unknown 으로 닫는다 — unknown 은
-- 최종이라 늦은 ack 는 시점과 상관없이 conflict 로 끝난다(되살리지 않는다).
-- 결과: ok · already(같은 결과를 다시 ack — 멱등) · conflict(claimed 가 아닌데 다른 결과) · not_found(없음·남의 행·토큰 불일치).
-- retry 는 만료 전이면 pending(토큰 비움), 지났으면 expired. retry 뒤 같은 토큰은 더는 통하지 않는다 — 폴러는 retry 재호출의
-- not_found 를 이미 반영된 것으로 본다(계약 §4.1). 계약 규칙(사유 필수·retry 는 compacting 만·detail 값)은 22023 으로 거절한다.
create or replace function public.agent_console_ack(
  p_owner uuid, p_id uuid, p_token_hash text, p_result text, p_reason text, p_detail text
) returns table (outcome text, status text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_status text;
begin
  if p_result is null or p_result not in ('sent', 'refused', 'retry') then
    raise exception 'agent_console_ack: bad result %', p_result using errcode = '22023';
  end if;
  if p_result in ('refused', 'retry') and p_reason is null then
    raise exception 'agent_console_ack: % needs a reason', p_result using errcode = '22023';
  end if;
  if p_reason is not null and p_reason not in (
       'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error') then
    raise exception 'agent_console_ack: unknown reason %', p_reason using errcode = '22023';
  end if;
  if p_result = 'retry' and p_reason <> 'compacting' then
    raise exception 'agent_console_ack: retry reason % not allowed', p_reason using errcode = '22023';
  end if;
  if p_detail is not null and (p_result <> 'sent' or p_detail not in ('turn_started', 'submitted', 'accepted')) then
    raise exception 'agent_console_ack: bad detail %', p_detail using errcode = '22023';
  end if;
  perform public.agent_console_sweep(p_owner);
  update public.agent_console_prompts p
     set status = case when p_result = 'retry' then (case when p.expires_at >= now() then 'pending' else 'expired' end)
                       else p_result end,
         claim_token_hash = case when p_result = 'retry' then null else p.claim_token_hash end,
         claimed_at = case when p_result = 'retry' then null else p.claimed_at end,
         acked_at = now(),
         finished_at = case when p_result = 'retry' and p.expires_at >= now() then null else now() end,
         reason = p_reason,
         result_detail = p_detail
   where p.id = p_id and p.owner = p_owner and p.claim_token_hash = p_token_hash and p.status = 'claimed'
  returning p.status into v_status;
  if found then
    return query select 'ok'::text, v_status;
    return;
  end if;
  select p.status into v_status from public.agent_console_prompts p
   where p.id = p_id and p.owner = p_owner and p.claim_token_hash = p_token_hash;
  if not found then
    return query select 'not_found'::text, null::text;
  elsif v_status = p_result then
    return query select 'already'::text, v_status;
  else
    return query select 'conflict'::text, v_status;
  end if;
end $$;

revoke all on function public.agent_console_sweep(uuid) from public, anon, authenticated;
revoke all on function public.agent_console_enqueue(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.agent_console_claim(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.agent_console_ack(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.agent_console_sweep(uuid) to service_role;
grant execute on function public.agent_console_enqueue(uuid, text, text, text, text) to service_role;
grant execute on function public.agent_console_claim(uuid, text, text[]) to service_role;
grant execute on function public.agent_console_ack(uuid, uuid, text, text, text, text) to service_role;

commit;
