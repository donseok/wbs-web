import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0095_agent_watchers_no_select.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0095_agent_watchers_no_select_rollback.sql'), 'utf8')

describe('0095 — agent_watchers select 정책 제거(최종 리뷰 Important)', () => {
  it('up 은 select 정책을 지우기만 하고 다시 만들지 않는다', () => {
    const s = up()
    expect(s).toContain('drop policy if exists agent_watchers_select')
    expect(s).not.toContain('create policy')
  })
  it('down 은 select 정책을 원래대로 되돌린다', () => {
    const s = down()
    expect(s).toContain('drop policy if exists agent_watchers_select')
    expect(s).toMatch(/create policy agent_watchers_select on public\.agent_watchers\s+for select to authenticated using \(true\)/)
  })
})
