import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0094_agent_heartbeat.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0094_agent_heartbeat_rollback.sql'), 'utf8')

describe('0094 — heartbeat 열과 agent_watchers (좌석표 v1 스펙 §3-1)', () => {
  it('agent_work_orders 에 heartbeat 열 4개를 멱등하게 더한다', () => {
    const s = up()
    for (const col of ['last_heartbeat_at', 'heartbeat_phase', 'heartbeat_agent', 'heartbeat_note']) {
      expect(s).toMatch(new RegExp(`add column if not exists ${col}`))
    }
  })
  it('agent_watchers 는 (user_id, agent) 유일, RLS 켬, select 정책만 둔다', () => {
    const s = up()
    expect(s).toContain('create table if not exists public.agent_watchers')
    expect(s).toContain('unique (user_id, agent)')
    expect(s).toContain('alter table public.agent_watchers enable row level security')
    expect(s).toMatch(/create policy agent_watchers_select on public\.agent_watchers\s+for select/)
    expect(s).not.toMatch(/for (insert|update|delete)/)
  })
  it('롤백은 정책·테이블·열 4개를 되돌린다', () => {
    const s = down()
    expect(s).toContain('drop policy if exists agent_watchers_select')
    expect(s).toContain('drop table if exists public.agent_watchers')
    for (const col of ['last_heartbeat_at', 'heartbeat_phase', 'heartbeat_agent', 'heartbeat_note']) {
      expect(s).toMatch(new RegExp(`drop column if exists ${col}`))
    }
  })
})
