-- supabase/migrations/0111_agent_console_keys.sql
-- 에이전트 콘솔에 「키 입력」 행을 더한다 — 조정 세션의 레인 터미널에 입력 창(permission·question·choice)이 떠 있을 때
-- 웹이 허용된 키(숫자 1~9·Enter·Esc·Up·Down·Tab)만 보내 답한다. 계약: lanes/lane-summary-contract.md (C).
-- 글 프롬프트(input_kind='text')의 동작은 그대로다. 키 행은 대상 입력 요청의 (kind, since, 발췌 sha)를 함께 싣고,
-- PC 폴러가 보내기 직전에 화면을 다시 판정해 다르면 보내지 않고 prompt_changed 로 거절한다.
-- 같은 화면 상태(owner·host·대상·since·sha)에는 한 번만 답한다 — 함수 안 검사와 부분 유니크 인덱스의 이중 방어.
-- 키 행의 text 칸은 사람이 읽는 표기(예: `키: 1 Enter`)다 — 전달 상태 표가 그대로 보여 준다. 폴러는 keys 칸을 쓴다.
-- 코드와 같은 커밋에 담지 않는다(마이그레이션 분리 규칙). 동작 시나리오: tests/migrations/sql/0111-scenario.sql.
begin;

-- 열 추가 — 기존 행은 모두 text 행이 된다(default 'text', 나머지 null).
alter table public.agent_console_prompts
  add column if not exists input_kind text not null default 'text',
  add column if not exists keys       text[],
  add column if not exists req_kind   text,
  add column if not exists req_since  timestamptz,
  add column if not exists req_sha    text;

alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_input_kind_check;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_input_kind_check check (input_kind in ('text', 'keys'));
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_req_kind_check;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_req_kind_check check (req_kind is null or req_kind ~ '^[a-z-]{1,20}$');
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_req_sha_check;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_req_sha_check check (req_sha is null or req_sha ~ '^[0-9a-f]{64}$');

-- 행 모양 — keys 행은 키 1~4개(허용 목록만)와 대상 입력 요청 세 칸이 모두 있고, text 행은 그 칸이 전부 비어 있다.
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_input_shape;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_input_shape check (
    (input_kind = 'text' and keys is null and req_kind is null and req_since is null and req_sha is null)
    or (input_kind = 'keys'
        and keys is not null and array_ndims(keys) = 1 and cardinality(keys) between 1 and 4
        and keys <@ array['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab']::text[]
        and req_kind is not null and req_since is not null and req_sha is not null));

-- 거절 사유에 prompt_changed(창이 바뀌었거나 사라짐)를 더한다 — 기존 값은 그대로.
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_reason_check;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_reason_check check (reason is null or reason in (
    'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error', 'prompt_changed'));

-- 재전송 방지 — 같은 화면 상태에 살아 있거나 이미 전달됐을 수 있는 키 행(pending·claimed·sent·unknown)은 하나뿐이다.
-- refused·expired 는 입력창에 들어가지 않았으므로 빠진다(다시 답할 수 있다).
create unique index if not exists agent_console_prompts_keys_once_idx
  on public.agent_console_prompts (owner, host, target_kind, target_ref, req_since, req_sha)
  where input_kind = 'keys' and status in ('pending', 'claimed', 'sent', 'unknown');

-- 키 행 넣기(서버 액션 — 보내는 사람 = 세션 주인). agent_console_enqueue 와 같은 방식(owner 단위 advisory lock·정리·1분 5건·대상당 3건)이되
--  · 만료는 10분이 아니라 60초다 — 입력 창은 오래 열려 있지 않고, 늦게 전달된 키는 엉뚱한 창에 들어간다.
--  · 대상은 조정 레인(coord_lane)뿐, 키는 허용 목록 1~4개, 대상 입력 요청은 permission·question·choice 만 받는다(22023).
--  · 같은 화면 상태에 이미 행이 있으면 already_sent.
-- 결과: ok(id 채움) · rate_limited · queue_full · already_sent.
create or replace function public.agent_console_enqueue_keys(
  p_owner uuid, p_host text, p_kind text, p_ref text, p_keys text[],
  p_req_kind text, p_req_since timestamptz, p_req_sha text
) returns table (outcome text, id uuid)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  if p_kind is distinct from 'coord_lane' then
    raise exception 'agent_console_enqueue_keys: kind % not allowed', p_kind using errcode = '22023';
  end if;
  if p_keys is null or array_ndims(p_keys) is distinct from 1 or cardinality(p_keys) not between 1 and 4
     or not coalesce(p_keys <@ array['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Enter', 'Esc', 'Up', 'Down', 'Tab']::text[], false) then
    raise exception 'agent_console_enqueue_keys: bad keys' using errcode = '22023';
  end if;
  if p_req_kind is null or p_req_kind not in ('permission', 'question', 'choice') then
    raise exception 'agent_console_enqueue_keys: request kind % not answerable', p_req_kind using errcode = '22023';
  end if;
  if p_req_since is null or p_req_sha is null or p_req_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'agent_console_enqueue_keys: bad request identity' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agent_console:' || p_owner::text, 0));
  perform public.agent_console_sweep(p_owner);
  if exists (select 1 from public.agent_console_prompts p
              where p.owner = p_owner and p.host = p_host and p.target_kind = p_kind and p.target_ref = p_ref
                and p.input_kind = 'keys' and p.req_since = p_req_since and p.req_sha = p_req_sha
                and p.status in ('pending', 'claimed', 'sent', 'unknown')) then
    return query select 'already_sent'::text, null::uuid;
    return;
  end if;
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
  begin
    insert into public.agent_console_prompts
      (owner, host, target_kind, target_ref, text, input_kind, keys, req_kind, req_since, req_sha, expires_at)
      values (p_owner, p_host, p_kind, p_ref, '키: ' || array_to_string(p_keys, ' '), 'keys', p_keys,
              p_req_kind, p_req_since, p_req_sha, now() + interval '60 seconds')
      returning agent_console_prompts.id into v_id;
  exception when unique_violation then
    -- advisory lock 안이라 일어나지 않는 것이 정상이다 — 부분 유니크 인덱스가 마지막 방어선.
    return query select 'already_sent'::text, null::uuid;
    return;
  end;
  return query select 'ok'::text, v_id;
end $$;

-- claim — 반환 표에 input_kind·keys·req_* 를 더한다. 반환 타입이 바뀌므로 지우고 다시 만든다(권한은 아래에서 다시 건다).
-- 텍스트 행은 새 칸이 모두 null/'text' 이다.
drop function if exists public.agent_console_claim(uuid, text, text[]);
create function public.agent_console_claim(
  p_owner uuid, p_host text, p_token_hashes text[]
) returns table (id uuid, target_kind text, target_ref text, text text, expires_at timestamptz, token_index integer,
                 input_kind text, keys text[], req_kind text, req_since timestamptz, req_sha text)
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
    returning p.id, p.target_kind, p.target_ref, p.text, p.expires_at, n.rn,
              p.input_kind, p.keys, p.req_kind, p.req_since, p.req_sha;
end $$;

-- ack — 허용 사유에 prompt_changed 를 더한다. prompt_changed 는 refused 와만 쓴다(retry 는 이미 compacting 뿐).
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
       'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error', 'prompt_changed') then
    raise exception 'agent_console_ack: unknown reason %', p_reason using errcode = '22023';
  end if;
  if p_result = 'retry' and p_reason <> 'compacting' then
    raise exception 'agent_console_ack: retry reason % not allowed', p_reason using errcode = '22023';
  end if;
  if p_reason = 'prompt_changed' and p_result <> 'refused' then
    raise exception 'agent_console_ack: prompt_changed only with refused' using errcode = '22023';
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

-- 권한 — 새 함수와 다시 만든 claim 에 0109 와 같은 설정을 건다(service_role 만 실행).
revoke all on function public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.agent_console_claim(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.agent_console_ack(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text) to service_role;
grant execute on function public.agent_console_claim(uuid, text, text[]) to service_role;
grant execute on function public.agent_console_ack(uuid, uuid, text, text, text, text) to service_role;

commit;
