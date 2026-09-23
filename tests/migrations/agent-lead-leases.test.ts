import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const up = readFileSync(new URL('../../supabase/migrations/0101_agent_lead_leases.sql', import.meta.url), 'utf8')
const down = readFileSync(new URL('../../supabase/migrations/0101_agent_lead_leases_rollback.sql', import.meta.url), 'utf8')

describe('0101 agent_lead_leases', () => {
  it('(user_id, project_id) 기본키와 RLS 를 켜고 정책은 두지 않는다(0095 와 같은 판단)', () => {
    expect(up).toMatch(/create table if not exists public\.agent_lead_leases/)
    expect(up).toMatch(/primary key \(user_id, project_id\)/)
    expect(up).toMatch(/alter table public\.agent_lead_leases enable row level security/)
    expect(up).not.toMatch(/create policy/i)
  })
  it('TTL 은 lead_lease_ttl() 한 곳에만 180초로 둔다', () => {
    expect(up).toMatch(/function public\.lead_lease_ttl\(\)[\s\S]*interval '180 seconds'/)
    expect(up.match(/180 seconds/g)).toHaveLength(1)
  })
  it('함수 넷은 대상 행을 for update 로 잠그거나 조건부 update 로 CAS 한다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release']) {
      expect(up).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`))
    }
    expect(up).toMatch(/for update/)
  })
  it('함수 실행은 service_role 에게만 연다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release']) {
      expect(up).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`))
      expect(up).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`))
    }
  })
  it('rollback 은 함수와 테이블을 지운다', () => {
    for (const fn of ['lead_lease_acquire', 'lead_lease_renew', 'lead_lease_release', 'lead_lease_force_release', 'lead_lease_ttl']) {
      expect(down).toMatch(new RegExp(`drop function if exists public\\.${fn}\\(`))
    }
    expect(down).toMatch(/drop table if exists public\.agent_lead_leases/)
  })
})
