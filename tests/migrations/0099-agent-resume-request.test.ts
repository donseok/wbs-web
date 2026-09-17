import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0099_agent_resume_request.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0099_agent_resume_request_rollback.sql'), 'utf8')

const COLS = ['resume_requested_at', 'resume_requested_by', 'resume_requested_host']

describe('0099 — 멈춘 좌석의 재개 요청 표식', () => {
  it('agent_work_orders 에 열 3개를 멱등하게 더한다', () => {
    const s = up()
    for (const col of COLS) expect(s).toMatch(new RegExp(`add column if not exists ${col}`))
  })
  it('요청자는 계정이 지워져도 주문을 끌고 가지 않는다', () => {
    expect(up()).toMatch(/resume_requested_by\s+uuid references auth\.users\(id\) on delete set null/)
  })
  it('watch 조회용 부분 인덱스를 둔다 — 요청이 걸린 행만 대상이다', () => {
    const s = up()
    expect(s).toContain('create index if not exists agent_work_orders_resume_idx')
    expect(s).toMatch(/where resume_requested_at is not null/)
  })
  it('상태 전이를 건드리지 않는다 — status·claimed_by 를 쓰지 않는다', () => {
    const s = up()
    expect(s).not.toMatch(/update public\.agent_work_orders/)
    expect(s).not.toMatch(/drop column if exists claimed_by/)
  })
  it('롤백은 인덱스와 열 3개를 되돌린다', () => {
    const s = down()
    expect(s).toContain('drop index if exists public.agent_work_orders_resume_idx')
    for (const col of COLS) expect(s).toMatch(new RegExp(`drop column if exists ${col}`))
  })
})
