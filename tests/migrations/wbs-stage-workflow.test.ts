import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const s = () => readFileSync('supabase/migrations/0079_wbs_stage_workflow.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0079_wbs_stage_workflow_rollback.sql', 'utf8')

describe('0079 stage 워크플로 재설계 — todo 제거·dev_workflow 플래그·RPC v2.1', () => {
  it("기존 'todo' 행 NULL 이관이 CHECK 재정의보다 먼저 나온다", () => {
    const body = s()
    const migrateIdx = body.indexOf("update public.wbs_items set stage = null where stage = 'todo'")
    const checkIdx = body.indexOf('add constraint wbs_items_stage_check')
    expect(migrateIdx).toBeGreaterThan(-1)
    expect(checkIdx).toBeGreaterThan(-1)
    expect(migrateIdx).toBeLessThan(checkIdx)
  })

  it("CHECK 제약에 'todo' 가 없다", () => {
    expect(s()).toMatch(/add constraint wbs_items_stage_check check \(stage in \('as','fp','ip','im','xx'\)\)/)
    expect(s()).not.toMatch(/wbs_items_stage_check check \(stage in \([^)]*'todo'/)
  })

  it('dev_workflow 컬럼이 not null default false 로 additive 추가된다', () => {
    expect(s()).toContain('add column if not exists dev_workflow boolean not null default false')
  })

  it("RPC 가 stage 'todo' 를 NULL 로 정규화하는 case 식을 포함한다", () => {
    expect(s()).toContain("case when v_node->>'stage' in ('', 'todo') then null else v_node->>'stage' end")
  })

  it('RPC 가 dev_workflow 를 upsert 한다(insert 값 식 + on conflict set)', () => {
    const body = s()
    expect(body).toContain("coalesce((v_node->>'dev_workflow')::boolean, false)")
    const updateClause = body.split('do update set')[1] ?? ''
    expect(updateClause.split('returning')[0]).toContain('dev_workflow = excluded.dev_workflow')
  })

  it('RPC 갱신 시 stage·assignee·actual_pct 는 여전히 덮지 않는다(필드 소유권 ⑫ 유지)', () => {
    const updateClause = s().split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })

  it('rollback 이 dev_workflow 컬럼을 제거하고 CHECK 를 0077 형태로 복원한다', () => {
    expect(r()).toContain('drop column if exists dev_workflow')
    expect(r()).toMatch(/add constraint wbs_items_stage_check check \(stage in \('todo','as','fp','ip','im','xx'\)\)/)
  })

  it('rollback 이 RPC 를 0077 본문(정규화 case 식 없음)으로 되돌린다', () => {
    expect(r()).toContain('create or replace function public.import_wbs_upsert')
    expect(r()).not.toContain("case when v_node->>'stage' in ('', 'todo')")
    expect(r()).toContain("nullif(v_node->>'stage','')")
  })
})
