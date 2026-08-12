import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('0072 claimed_by_user_id', () => {
  const s = () => readFileSync('supabase/migrations/0072_agent_order_claim_owner.sql', 'utf8')
  it('컬럼·인덱스 선언', () => {
    expect(s()).toContain("add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null")
    expect(s()).toMatch(/create index if not exists agent_work_orders_claim_owner_idx/)
  })
  it('rollback 이 컬럼을 제거', () => {
    expect(readFileSync('supabase/migrations/0072_agent_order_claim_owner_rollback.sql', 'utf8'))
      .toContain('drop column if exists claimed_by_user_id')
  })
})
describe('0073 evidence', () => {
  const s = () => readFileSync('supabase/migrations/0073_agent_order_evidence.sql', 'utf8')
  it('jsonb not null default 로 백필 불필요', () => {
    expect(s()).toContain("add column if not exists evidence jsonb not null default '{}'::jsonb")
  })
  it('rollback 이 컬럼을 제거', () => {
    expect(readFileSync('supabase/migrations/0073_agent_order_evidence_rollback.sql', 'utf8'))
      .toContain('drop column if exists evidence')
  })
})
