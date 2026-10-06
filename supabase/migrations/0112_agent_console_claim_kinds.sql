-- supabase/migrations/0112_agent_console_claim_kinds.sql
-- 콘솔 poll 의 claim 에 「대상 종류 제한」 인자를 더한다 — 프로젝트 한정 PAT 가 프로젝트 없는 보조 대상(조정 세션 칸:
-- coord_lead·coord_lane)의 행만 집게 하려는 것이다. 프롬프트 행에는 프로젝트가 없어 한정 PAT 가 team 대상 행까지 집어 삼키면 안 된다.
-- p_target_kinds 가 null(기본)이면 지금과 같다 — 한정 없는 PAT 의 호출 모양은 바뀌지 않는다. 집지 않은 행은 pending 으로 남는다.
-- 반환 표·나머지 동작은 0111 과 같다. 코드와 같은 커밋에 담지 않는다(마이그레이션 분리 규칙).
begin;

drop function if exists public.agent_console_claim(uuid, text, text[], boolean);
create function public.agent_console_claim(
  p_owner uuid, p_host text, p_token_hashes text[], p_accept_keys boolean default false, p_target_kinds text[] default null
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
  -- 빈 배열은 아무 종류도 집지 않는 것과 같다(null 과 다르다) — 호출자 실수가 전체 허용으로 번지지 않게 한다.
  perform public.agent_console_sweep(p_owner);
  return query
    with locked as materialized (
      select p.id, p.created_at from public.agent_console_prompts p
       where p.owner = p_owner and p.host = p_host and p.status = 'pending' and p.expires_at >= now()
         and (p.input_kind = 'text' or coalesce(p_accept_keys, false))
         and (p_target_kinds is null or p.target_kind = any(p_target_kinds))
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

revoke all on function public.agent_console_claim(uuid, text, text[], boolean, text[]) from public, anon, authenticated;
grant execute on function public.agent_console_claim(uuid, text, text[], boolean, text[]) to service_role;

commit;
