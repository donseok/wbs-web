-- supabase/migrations/0112_agent_console_claim_kinds_rollback.sql
-- ⚠ 코드(main)를 먼저 되돌린 뒤에 돌린다. 한정 PAT 의 poll 이 p_target_kinds 를 싣는 상태에서 먼저 돌리면 그 호출이 500 이다(글 전달은 한정 없는 PAT 로 계속 된다).
-- 0111 의 claim 정의(4인자)로 되돌린다.
begin;

drop function if exists public.agent_console_claim(uuid, text, text[], boolean, text[]);
create function public.agent_console_claim(
  p_owner uuid, p_host text, p_token_hashes text[], p_accept_keys boolean default false
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
         and (p.input_kind = 'text' or coalesce(p_accept_keys, false))
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

revoke all on function public.agent_console_claim(uuid, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.agent_console_claim(uuid, text, text[], boolean) to service_role;

commit;
