import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const s = () => readFileSync('supabase/migrations/0077_wbs_assignee_stage.sql', 'utf8')

describe('0077 wbs 담당자·단계·external_ref·확장 명세(결정 B)', () => {
  it('컬럼 전부 nullable/additive 추가', () => {
    expect(s()).toContain('add column if not exists assignee_member_id uuid')
    expect(s()).toMatch(/add column if not exists stage text\s+check \(stage in \('todo','as','fp','ip','im','xx'\)\)/)
    expect(s()).toContain('add column if not exists external_ref text')
    for (const col of [
      'category text', 'domain text', 'model text', 'prd_ref text', 'entry_point text', 'spec text',
    ]) expect(s()).toContain(`add column if not exists ${col}`)
    expect(s()).toMatch(/add column if not exists priority text\s+check \(priority in \('critical','high','medium','low'\)\)/)
    expect(s()).toContain('add column if not exists tags text[]')
    expect(s()).toContain('add column if not exists depends text[]')
    expect(s()).toContain("add column if not exists acceptance jsonb not null default '[]'::jsonb")
  })
  it('로스터 복합 FK — set null 대상은 assignee 컬럼만(project_id 보호)', () => {
    expect(s()).toContain('references public.project_members (id, project_id)')
    expect(s()).toContain('on delete set null (assignee_member_id)')
  })
  it('external_ref 부분 유니크 + 활성 주문 부분 유니크', () => {
    expect(s()).toMatch(/wbs_items_project_external_ref_uidx[\s\S]*where external_ref is not null/)
    expect(s()).toMatch(/agent_work_orders_active_per_item_uidx[\s\S]*where status in \('ready','claimed','reported'\)/)
  })
  it('upsert RPC — 갱신 시 stage·assignee·actual_pct 를 덮지 않는다(필드 소유권 ⑫)', () => {
    expect(s()).toContain('create or replace function public.import_wbs_upsert')
    expect(s()).toMatch(/on conflict \(project_id, external_ref\) where external_ref is not null/)
    const updateClause = s().split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })
  it('rollback 이 컬럼·인덱스·RPC 를 제거', () => {
    const r = readFileSync('supabase/migrations/0077_wbs_assignee_stage_rollback.sql', 'utf8')
    expect(r).toContain('drop function if exists public.import_wbs_upsert')
    expect(r).toContain('drop column if exists external_ref')
  })
})
