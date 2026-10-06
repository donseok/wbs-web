import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const flat = readFileSync(join(dir, '0112_agent_console_claim_kinds.sql'), 'utf8').replace(/\s+/g, ' ')
const down = readFileSync(join(dir, '0112_agent_console_claim_kinds_rollback.sql'), 'utf8')
const flatDown = down.replace(/\s+/g, ' ')
const flat0111 = readFileSync(join(dir, '0111_agent_console_keys.sql'), 'utf8').replace(/\s+/g, ' ')

describe('0112 — claim 대상 종류 제한 정적 검사', () => {
  it('4인자 claim 을 지우고 p_target_kinds(기본 null)를 더한 5인자로 다시 만든다', () => {
    expect(flat).toContain('drop function if exists public.agent_console_claim(uuid, text, text[], boolean);')
    expect(flat).toContain('p_accept_keys boolean default false, p_target_kinds text[] default null')
  })
  it('종류 제한은 null 이면 통과, 아니면 목록 안만 집는다 — 빈 배열은 아무것도 집지 않는다', () => {
    expect(flat).toContain('and (p_target_kinds is null or p.target_kind = any(p_target_kinds))')
  })
  it('나머지 동작은 0111 과 같다 — 글 행·키 행 조건, 건너뛰기 잠금, 반환 칸', () => {
    for (const piece of [
      "and (p.input_kind = 'text' or coalesce(p_accept_keys, false))",
      'order by p.created_at, p.id limit v_n for update skip locked',
      "set status = 'claimed', claim_token_hash = p_token_hashes[n.rn], claimed_at = now(), attempts = p.attempts + 1",
      'returning p.id, p.target_kind, p.target_ref, p.text, p.expires_at, n.rn, p.input_kind, p.keys, p.req_kind, p.req_since, p.req_sha;',
    ]) {
      expect(flat0111).toContain(piece)
      expect(flat).toContain(piece)
    }
  })
  it('service_role 만 실행한다', () => {
    expect(flat).toContain('revoke all on function public.agent_console_claim(uuid, text, text[], boolean, text[]) from public, anon, authenticated;')
    expect(flat).toContain('grant execute on function public.agent_console_claim(uuid, text, text[], boolean, text[]) to service_role;')
  })
  it('롤백은 5인자를 지우고 0111 의 4인자 정의로 돌아간다', () => {
    expect(flatDown).toContain('drop function if exists public.agent_console_claim(uuid, text, text[], boolean, text[]);')
    expect(flatDown).toContain('p_owner uuid, p_host text, p_token_hashes text[], p_accept_keys boolean default false ) returns table')
    expect(down.replace(/--[^\n]*/g, '')).not.toContain('p_target_kinds')
    expect(flatDown).toContain('grant execute on function public.agent_console_claim(uuid, text, text[], boolean) to service_role;')
  })
})
