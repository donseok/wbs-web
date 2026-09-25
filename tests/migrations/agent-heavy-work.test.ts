import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const up = readFileSync(new URL('../../supabase/migrations/0106_agent_heavy_work.sql', import.meta.url), 'utf8')
const down = readFileSync(new URL('../../supabase/migrations/0106_agent_heavy_work_rollback.sql', import.meta.url), 'utf8')

describe('0106 무거운 작업 표시', () => {
  it('주문·lease 에 jsonb 열을 하나씩 더한다', () => {
    expect(up).toMatch(/alter table public\.agent_work_orders add column if not exists heartbeat_heavy jsonb/)
    expect(up).toMatch(/alter table public\.agent_lead_leases add column if not exists heavy jsonb/)
  })
  it('대상은 이 holder 의 만료 전 lease 프로젝트, 주문은 claimed·id8 유일할 때만', () => {
    expect(up).toMatch(/l\.holder = p_holder and l\.expires_at >= now\(\)/)
    expect(up).toMatch(/left\(o\.id::text, 8\) = w\.id8 and o\.status = 'claimed' and o\.project_id = any\(v_proj\)/)
    expect(up).toMatch(/having count\(\*\) = 1/)
  })
  it('이 신원이 점유한 주문에만 쓰고, 행 잠금은 짧게 포기한다(renew 응답이 기다린다)', () => {
    expect(up).toMatch(/and o\.claimed_by_user_id = p_user/)
    expect(up).toMatch(/set lock_timeout = '2s'/)
  })
  it('같은 값은 다시 쓰지 않고, 이 팀장이 적었는데 목록에 없는 주문은 비운다', () => {
    expect(up.match(/is distinct from/g)?.length).toBeGreaterThanOrEqual(2)
    expect(up).toMatch(/heartbeat_heavy->>'by' = p_user::text/)
  })
  it('함수 실행은 service_role 에게만 연다', () => {
    expect(up).toMatch(/revoke all on function public\.lead_lease_heavy\(uuid, text, jsonb, jsonb\) from public, anon, authenticated/)
    expect(up).toMatch(/grant execute on function public\.lead_lease_heavy\(uuid, text, jsonb, jsonb\) to service_role/)
  })
  it('rollback 은 함수와 두 열을 지운다', () => {
    expect(down).toMatch(/drop function if exists public\.lead_lease_heavy\(uuid, text, jsonb, jsonb\)/)
    expect(down).toMatch(/drop column if exists heavy/)
    expect(down).toMatch(/drop column if exists heartbeat_heavy/)
  })
})
