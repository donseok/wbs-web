// tests/migrations/0097-stage-credits-single-table.test.ts
// 크레딧 표 단일화(2026-09-16) — SQL 상수가 코드 기본값과 같고, 항목 credit_key 로 표를 고르지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const s = () => readFileSync('supabase/migrations/0097_stage_credits_single_table.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0097_stage_credits_single_table_rollback.sql', 'utf8')
const constOf = (sql: string) => {
  const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(sql)
  expect(m).not.toBeNull()
  return JSON.parse(m![1]) as Record<string, unknown>
}

describe('0097 크레딧 표 단일화', () => {
  it('SQL 기본 크레딧 상수가 코드 기본값과 같고 표는 default 하나다', () => {
    const c = constOf(s())
    expect(Object.keys(c)).toEqual(['default'])
    expect(c).toEqual(DEFAULT_STAGE_CREDITS)
  })
  it('항목 credit_key 를 읽지도, 표 선택에 쓰지도 않는다', () => {
    const body = s()
    expect(body).not.toContain('v_item_credit_key')
    expect(body).toContain('select project_id, stage, actual_pct, dev_workflow, tags')
    expect(body).toContain("v_table := coalesce(v_credits -> 'default', c_default -> 'default')")
  })
  it('security invoker 이고 service_role 만 실행한다', () => {
    const body = s()
    expect(body.split('$$')[0]).toContain('security invoker')
    expect(body).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(body).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('전이 규칙은 0096 그대로 — 사건별 단계·크레딧 키와 잠금 조건을 바꾸지 않았다', () => {
    const body = s()
    expect(body).toContain("when 'reject' then 'rw' when 'rework' then 'rw' when 'release' then 'as' end")
    expect(body).toContain("'agent' = any(coalesce(v_tags, '{}'::text[]))")
    expect(body).toContain("'reason', 'locked'")
  })
  it('rollback 은 0096 의 세 표 상수와 credit_key 분기를 되살린다', () => {
    const rb = r()
    const c = constOf(rb)
    expect(Object.keys(c).sort()).toEqual(['default', 'doc', 'if'])
    expect(rb).toContain("v_table := coalesce(v_credits -> coalesce(v_item_credit_key, 'default'), v_credits -> 'default', c_default -> 'default')")
  })
})
