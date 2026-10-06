-- supabase/migrations/0111_agent_console_keys_rollback.sql
-- 0111 을 되돌려 0109 의 정의로 돌아간다. 키 행은 지운다 — 칸을 지운 뒤 남기면 글 프롬프트처럼 읽혀 입력창에 들어간다.
-- prompt_changed 사유가 남은 행은 error 로 바꾼다(0109 의 사유 목록에 없다).
begin;

-- 이미 되돌린 뒤 다시 돌려도 멈추지 않게 칸이 있을 때만 지운다.
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'agent_console_prompts' and column_name = 'input_kind') then
    delete from public.agent_console_prompts where input_kind = 'keys';
  end if;
end $$;
update public.agent_console_prompts set reason = 'error' where reason = 'prompt_changed';

drop function if exists public.agent_console_enqueue_keys(uuid, text, text, text, text[], text, timestamptz, text);
drop index if exists public.agent_console_prompts_keys_once_idx;

alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_input_shape;
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_req_sha_check;
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_req_kind_check;
alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_input_kind_check;
alter table public.agent_console_prompts
  drop column if exists req_sha,
  drop column if exists req_since,
  drop column if exists req_kind,
  drop column if exists keys,
  drop column if exists input_kind;

alter table public.agent_console_prompts drop constraint if exists agent_console_prompts_reason_check;
alter table public.agent_console_prompts
  add constraint agent_console_prompts_reason_check check (reason is null or reason in (
    'compacting', 'stale', 'target-not-found', 'ambiguous', 'bang-in-text', 'prompt-open', 'draft-in-input', 'error'));

-- claim — 0109 의 반환 표(새 칸 없음)로 되돌린다. 반환 타입이 바뀌므로 지우고 다시 만든다.
drop function if exists public.agent_console_claim(uuid, text, text[]);
create function public.agent_console_claim(
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

-- ack — 0109 의 정의(prompt_changed 없음).
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

revoke all on function public.agent_console_claim(uuid, text, text[]) from public, anon, authenticated;
revoke all on function public.agent_console_ack(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.agent_console_claim(uuid, text, text[]) to service_role;
grant execute on function public.agent_console_ack(uuid, uuid, text, text, text, text) to service_role;

commit;
