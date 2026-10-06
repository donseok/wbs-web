import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0110_agent_watcher_summary.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0110_agent_watcher_summary_rollback.sql'), 'utf8')

describe('0110 — agent_watchers 요약 칸 세 개', () => {
  it('summary·lead_summary·input_request 를 널 허용 jsonb 로 멱등하게 더한다', () => {
    const s = up()
    for (const col of ['summary', 'lead_summary', 'input_request']) {
      expect(s).toMatch(new RegExp(`add column if not exists ${col} jsonb`))
      expect(s).not.toMatch(new RegExp(`${col} jsonb not null`))
    }
  })
  it('칸마다 객체 모양·크기 상한 CHECK 를 두고 정책은 건드리지 않는다', () => {
    const s = up()
    for (const c of ['summary_shape', 'lead_summary_shape', 'input_request_shape']) expect(s).toContain(`agent_watchers_${c}`)
    expect(s).toContain("jsonb_typeof(summary) = 'object'")
    expect(s).not.toMatch(/create policy|drop policy/)
    expect(s.trim().startsWith('--') && /\nbegin;\n/.test(s) && /commit;\s*$/.test(s)).toBe(true)
  })
  it('롤백은 제약과 칸 세 개를 되돌린다', () => {
    const s = down()
    for (const c of ['summary_shape', 'lead_summary_shape', 'input_request_shape']) expect(s).toContain(`drop constraint if exists agent_watchers_${c}`)
    for (const col of ['summary', 'lead_summary', 'input_request']) expect(s).toContain(`drop column if exists ${col}`)
  })
})
