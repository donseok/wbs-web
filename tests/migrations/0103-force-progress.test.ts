// tests/migrations/0103-force-progress.test.ts — 강제 진행(스펙 2026-09-23). SQL 조건이 도메인(forceProgress.ts)과 같은지 대조한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BOTTLENECK, STUB_DONE_STAGE } from '@/lib/domain/forceProgress'

const s = () => readFileSync('supabase/migrations/0103_force_progress.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0103_force_progress_rollback.sql', 'utf8')
const fn = (name: string) => s().split(`create or replace function public.${name}`)[1]?.split('$$;')[0] ?? ''

describe('0103 강제 진행', () => {
  it('컬럼과 제약 — depends_waived ⊆ depends, stub_for 는 부모가 있어야 하고 간선당 하나', () => {
    const b = s()
    expect(b).toContain("add column if not exists depends_waived text[] not null default '{}'")
    expect(b).toContain('add column if not exists stub_for text')
    expect(b).toContain("check (depends_waived <@ coalesce(depends, '{}'::text[]))")
    expect(b).toContain('check (stub_for is null or parent_id is not null)')
    expect(b).toMatch(/create unique index if not exists wbs_items_stub_for_uidx\s+on public\.wbs_items \(parent_id, stub_for\) where stub_for is not null/)
  })
  it('병목 설정 기본값이 도메인과 같다', () => {
    expect(s()).toContain(`force_bottleneck_min_successors int not null default ${DEFAULT_BOTTLENECK.minSuccessors}`)
    expect(s()).toContain(`force_bottleneck_min_hours int not null default ${DEFAULT_BOTTLENECK.minHours}`)
  })
  it('depends 가 바뀌면 BEFORE 트리거가 depends_waived 를 줄이고 기록한다(CHECK 보다 먼저)', () => {
    const b = s()
    expect(b).toMatch(/create trigger wbs_items_prune_waived\s+before update of depends on public\.wbs_items/)
    expect(fn('wbs_items_prune_waived')).toContain("'depends_waived'")
    // user_id null 기록이 change_logs RLS(insert_own_log)에 막혀 UPDATE 전체가 실패하지 않게
    expect(fn('wbs_items_prune_waived').split('as $$')[0]).toContain('security definer')
    expect(fn('wbs_items_prune_waived').split('as $$')[0]).toContain('set search_path = public')
  })
  it('전이 RPC 의 리프 판정은 stub 하위를 빼고 본다', () => {
    expect(fn('apply_workflow_event')).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);')
  })
  it('스텁 잔존 조건이 도메인 pendingStubs 와 같다(stage 가 xx 가 아닌 stub 하위)', () => {
    const f = fn('apply_workflow_event')
    expect(f).toContain(`where parent_id = v_item_id and stub_for is not null and stage is distinct from '${STUB_DONE_STAGE}'`)
    expect(f).toContain("(p_event = 'approve' or (p_event = 'set_stage' and p_stage = 'xx'))")
    expect(f).toContain("'reason', 'stub_pending'")
  })
  it('스텁 잔존 검사가 주문 갱신보다 앞에 있다(반쪽 승인 금지)', () => {
    const f = fn('apply_workflow_event')
    expect(f.indexOf("'stub_pending'")).toBeGreaterThan(-1)
    expect(f.indexOf("'stub_pending'")).toBeLessThan(f.indexOf('-- 주문 갱신'))
  })
  it('면제 RPC 는 후행을 잠그고, 선행 도달·계약·리프를 서버에서 다시 판정하고, 하위를 같은 트랜잭션에서 만든다', () => {
    const f = fn('set_dependency_waiver')
    expect(f).toContain('from public.wbs_items where id = p_item_id for update')
    for (const reason of ['reason_required', 'item_not_found', 'is_stub_task', 'not_leaf', 'no_ref', 'not_in_depends', 'pred_not_found', 'already_reached', 'no_contract']) {
      expect(f).toContain(`'${reason}'`)
    }
    expect(f).toContain("v_ref || '.stub.' || ")
    expect(f).toContain('insert into public.wbs_items')
    expect(f).toContain("'depends_waived'")
  })
  it('두 함수 모두 security invoker, service_role 만 실행', () => {
    const b = s()
    expect(fn('set_dependency_waiver').split('as $$')[0]).toContain('security invoker')
    expect(b).toContain('revoke all on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) from public, anon, authenticated')
    expect(b).toContain('grant execute on function public.set_dependency_waiver(uuid, text, boolean, text, uuid) to service_role')
    expect(b).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(b).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('rollback — 하위 행과 그 활성 주문을 먼저 치우고(일반 자식으로 남으면 후행이 롤업 부모가 된다) 0097 본문으로 되돌린다', () => {
    const rb = r()
    expect(rb.indexOf("update public.agent_work_orders set status = 'cancelled'")).toBeLessThan(rb.indexOf('delete from public.wbs_items where stub_for is not null'))
    expect(rb.indexOf('delete from public.wbs_items where stub_for is not null')).toBeLessThan(rb.indexOf('drop column if exists stub_for'))
    expect(rb).toContain('drop function if exists public.set_dependency_waiver(uuid, text, boolean, text, uuid)')
    expect(rb).toContain('drop trigger if exists wbs_items_prune_waived on public.wbs_items')
    expect(rb).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id);')
    expect(rb).not.toContain('stub_pending')
  })
})
