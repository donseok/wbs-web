import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const s = () => readFileSync('supabase/migrations/0090_wbs_agent_prompt.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0090_wbs_agent_prompt_rollback.sql', 'utf8')

/**
 * 0090 — 에이전트 프롬프트(사용자 지시문). spec 에 끼우지 않는 이유: spec 정본은 import(0077)라
 * 재업로드가 덮어써 사용자 프롬프트가 증발한다. agent_prompt 는 웹 전용 필드 — import RPC 무접촉.
 */
describe('0090 wbs_items.agent_prompt', () => {
  it('agent_prompt 컬럼이 additive 로 추가된다', () => {
    expect(s()).toContain('add column if not exists agent_prompt text')
  })

  it('함수를 재정의하지 않는다(import RPC 무접촉) — 재업로드에도 프롬프트 보존', () => {
    expect(s()).not.toMatch(/create\s+(or\s+replace\s+)?function/i)
    expect(s()).not.toMatch(/drop\s+function/i)
  })

  it('rollback 이 컬럼을 되돌린다', () => {
    expect(r()).toContain('drop column if exists agent_prompt')
  })
})
