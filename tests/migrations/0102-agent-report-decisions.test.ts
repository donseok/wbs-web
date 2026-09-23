// 0102 — 워커가 고른 결정 목록(과제 C). 문안만 검사한다. 실제 CHECK·생성 컬럼 동작은
// scripts/checks/0102_report_decisions_check.sql 이 스테이징에서 검증한다(Task 10).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'supabase/migrations/')
const up = () => readFileSync(join(dir, '0102_agent_report_decisions.sql'), 'utf8')
const down = () => readFileSync(join(dir, '0102_agent_report_decisions_rollback.sql'), 'utf8')

describe('0102 — agent_work_reports.decisions', () => {
  it('decisions 는 nullable jsonb 다 — default 를 두지 않는다(0건과 모름을 가르기 위해, 스펙 D2)', () => {
    const s = up()
    expect(s).toMatch(/add column if not exists decisions jsonb;/)
    expect(s).not.toMatch(/decisions jsonb[^;]*default/i)
    expect(s).not.toMatch(/decisions jsonb[^;]*not null/i)
  })
  it('CHECK 는 CASE 로 평가 순서를 고정한다 — 배열이 아닌 값이 22023 이 아니라 23514 로 거부되게', () => {
    const s = up()
    expect(s).toContain('add constraint agent_work_reports_decisions_shape check')
    expect(s).toMatch(/case when jsonb_typeof\(decisions\) = 'array'\s+then jsonb_array_length\(decisions\) <= 20 and kind = 'completion'\s+else false end/)
  })
  it('decision_count 는 jsonb_typeof 로 감싼 stored 생성 컬럼이다', () => {
    const s = up()
    expect(s).toMatch(/add column if not exists decision_count int\s+generated always as \(case when jsonb_typeof\(decisions\) = 'array' then jsonb_array_length\(decisions\) end\) stored/)
  })
  it('새 정책·grant 를 만들지 않는다 — 0057 의 RLS·table-level grant 가 덮는다', () => {
    const s = up()
    // 문(statement) 줄만 본다 — 머리 주석이 "grant select" 를 설명으로 인용한다.
    expect(s).not.toMatch(/^\s*create policy/im)
    expect(s).not.toMatch(/^\s*(grant|revoke)\b/im)
  })
  it('기존 행을 소급해 채우지 않는다(스펙 D8)', () => {
    expect(up()).not.toMatch(/update public\.agent_work_reports/i)
  })
  it('롤백은 생성 컬럼 → 제약 → 컬럼 순으로 지운다', () => {
    const s = down()
    const a = s.indexOf('drop column if exists decision_count')
    const b = s.indexOf('drop constraint if exists agent_work_reports_decisions_shape')
    const c = s.indexOf('drop column if exists decisions;')
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})
