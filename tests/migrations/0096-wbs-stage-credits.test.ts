// tests/migrations/0096-wbs-stage-credits.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'
import { AGENT_HELD_ORDER_STATUSES } from '@/lib/domain/agentWork'

const s = () => readFileSync('supabase/migrations/0096_wbs_stage_credits.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0096_wbs_stage_credits_rollback.sql', 'utf8')

describe('0096 진척·단계·크레딧 — 크레딧 컬럼·fp 제거·원자 전이 RPC', () => {
  it('stage_credits jsonb 컬럼을 additive 로 추가한다', () => {
    expect(s()).toContain('alter table public.project_settings add column if not exists stage_credits jsonb')
  })
  it('fp→ip 이관이 CHECK 재정의보다 먼저이고, CHECK 에 fp 가 없다', () => {
    const body = s()
    const mig = body.indexOf("update public.wbs_items set stage = 'ip' where stage = 'fp'")
    const chk = body.indexOf("add constraint wbs_items_stage_check check (stage in ('as','ip','im','xx'))")
    expect(mig).toBeGreaterThan(-1)
    expect(chk).toBeGreaterThan(mig)
  })
  it('import RPC 가 stage fp 를 ip 로 정규화하고, 재업로드가 stage·assignee·actual_pct 를 덮지 않는다(⑫)', () => {
    expect(s()).toContain("case when v_node->>'stage' in ('', 'todo') then null when v_node->>'stage' = 'fp' then 'ip' else v_node->>'stage' end")
    const updateClause = s().split('create or replace function public.import_wbs_upsert')[1].split('do update set')[1] ?? ''
    for (const kept of ['stage', 'assignee_member_id', 'actual_pct']) {
      expect(updateClause.split('returning')[0]).not.toContain(`${kept} =`)
    }
  })
  it('apply_workflow_event 는 security invoker 이고 service_role 만 실행한다', () => {
    const body = s()
    const fn = body.split('create or replace function public.apply_workflow_event')[1] ?? ''
    expect(fn.split('$$')[0]).toContain('security invoker')
    expect(body).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(body).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('SQL 기본 크레딧 상수는 0096 당시의 세 표다(단일화는 0097 이 한다)', () => {
    const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(s())
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual({
      default: { as: 0, ip: 30, rw: 50, im: 80, xx: 100 },
      if: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
      doc: { as: 0, ip: 20, rw: 30, im: 50, xx: 100 },
    })
  })
  it('RPC 가 항목·주문 행을 for update 로 잠그고 사건별 기대 status 로 CAS 한다', () => {
    const body = s()
    expect(body).toContain('from public.wbs_items where id = v_item_id for update')
    expect(body).toContain('from public.agent_work_orders where id = p_order_id for update')
    expect(body).toContain("when 'approve' then 'reported'")
    expect(body).toContain("'conflict', true")
  })
  it('record 변수를 쓰지 않는다 — 항목이 지워진 주문 경로에서 미할당 record 참조로 죽지 않게', () => {
    const fn = s().split('create or replace function public.apply_workflow_event')[1] ?? ''
    expect(fn).not.toMatch(/\s+record;/)
  })
  it('set_stage 잠금 조건이 도메인 stageLockedForHuman 과 같다(위임 태그 ∨ claimed·reported)', () => {
    const body = s()
    expect(body).toContain("'agent' = any(coalesce(v_tags, '{}'::text[]))")
    expect(body).toContain(`status in (${AGENT_HELD_ORDER_STATUSES.map(x => `'${x}'`).join(',')})`)
    expect(body).toContain("'reason', 'locked'")
  })
  it('rollback 이 함수·컬럼을 지우고 CHECK 를 fp 포함으로, import RPC 를 0089 본문으로 되돌린다', () => {
    const rb = r()
    expect(rb).toContain('drop function if exists public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)')
    expect(rb).toContain('drop column if exists stage_credits')
    expect(rb).toMatch(/add constraint wbs_items_stage_check check \(stage in \('as','fp','ip','im','xx'\)\)/)
    expect(rb).toContain("case when v_node->>'stage' in ('', 'todo') then null else v_node->>'stage' end")
    expect(rb).not.toContain("= 'fp' then 'ip'")
  })
})
