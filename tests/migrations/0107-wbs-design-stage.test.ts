// tests/migrations/0107-wbs-design-stage.test.ts — 설계 단계(ds)·설계 선행 claim·build_start(스펙 2026-09-26 §6).
// SQL 이 도메인(stageLabels·stageCredits)과 같은지, 전이 RPC 가 0103 본문에서 정해진 곳만 바뀌었는지 대조한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STAGE_CODES } from '@/lib/domain/stageLabels'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const s = () => readFileSync('supabase/migrations/0107_wbs_design_stage.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0107_wbs_design_stage_rollback.sql', 'utf8')
const base = () => readFileSync('supabase/migrations/0103_force_progress.sql', 'utf8')
const fnOf = (sql: string) => sql.split('create or replace function public.apply_workflow_event')[1]?.split('$$;')[0] ?? ''
const fn = () => fnOf(s())
const constOf = (sql: string) => {
  const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(sql)
  expect(m).not.toBeNull()
  return JSON.parse(m![1]) as Record<string, unknown>
}
const q = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(',')

describe('0107 설계 단계 ds', () => {
  it('단계 CHECK 가 도메인 STAGE_CODES 와 같다(ds 포함)', () => {
    expect([...STAGE_CODES]).toContain('ds')
    expect(s()).toContain(`add constraint wbs_items_stage_check check (stage in (${q(STAGE_CODES)}))`)
  })
  it('SQL 기본 크레딧 상수가 코드 기본값과 같다(ds 10)', () => {
    expect(constOf(fn())).toEqual(DEFAULT_STAGE_CREDITS)
    expect(DEFAULT_STAGE_CREDITS.default.ds).toBe(10)
  })
  it('사건 목록에 build_start 가 있고 주문 사건이다', () => {
    const f = fn()
    expect(f).toContain("p_event not in ('assign','unassign','claim','report_completion','approve','unapprove','reject','rework','release','set_stage','build_start')")
    expect(f).toContain("v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start');")
  })
  it('claim 의 p_stage 는 null 또는 ds 만 받는다', () => {
    expect(fn()).toContain("if p_event = 'claim' and p_stage is not null and p_stage <> 'ds' then")
  })
  it('build_start 는 claimed 에서만, 점유자 일치 조건은 report_completion·release 와 같다', () => {
    const f = fn()
    expect(f).toContain("when 'build_start' then 'claimed'")
    expect(f).toContain("(p_event in ('report_completion','release','build_start') and p_agent_user_id is not null and v_order_claimed_by_user is distinct from p_agent_user_id)")
    expect(f).toContain("(p_event in ('report_completion','release','build_start') and p_agent is not null and v_order_claimed_by is distinct from p_agent)")
  })
  it('build_start 는 주문 행을 고치지 않는다(status 불변)', () => {
    const upd = fn().split('-- 주문 갱신')[1].split('-- 단계·실적 결정')[0]
    expect(upd).toContain("elsif p_event <> 'build_start' then")
  })
  it('claim 은 p_stage=ds 면 ds·크레딧 ds, 아니면 종전 ip', () => {
    const f = fn()
    expect(f).toContain("when 'claim' then case when p_stage = 'ds' then 'ds' else 'ip' end")
    // 단계와 크레딧 키 두 곳
    expect(f.split("when 'claim' then case when p_stage = 'ds' then 'ds' else 'ip' end").length - 1).toBe(2)
  })
  it('build_start 는 ds 일 때만 ip·크레딧 ip, ip 이상이면 아무것도 바꾸지 않는다(멱등)', () => {
    const f = fn()
    expect(f).toContain("elsif p_event = 'build_start' then")
    expect(f).toContain("if v_old_stage = 'ds' then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip';")
    expect(f).toContain("elsif v_old_stage is null or v_old_stage not in ('ip','im','xx') then v_skipped := 'stage';")
  })
  it('set_stage 허용 값이 도메인 STAGE_CODES 와 같다', () => {
    expect(fn()).toContain(`if p_stage is not null and p_stage not in (${q(STAGE_CODES)}) then`)
  })
  it('도달(reached_first) 판정은 im·xx 그대로다 — ds 는 도달이 아니다', () => {
    expect(fn()).toContain("v_reached_first := coalesce(v_new_stage in ('im','xx'), false) and not coalesce(v_old_stage in ('im','xx'), false);")
  })
  it('0103 의 나머지 규칙을 그대로 가진다 — stub 하위 제외 리프·스텁 잔존 거부·잠금·record 금지', () => {
    const f = fn()
    expect(f).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);')
    expect(f).toContain("'reason', 'stub_pending'")
    expect(f).toContain("'agent' = any(coalesce(v_tags, '{}'::text[]))")
    expect(f).toContain("'reason', 'locked'")
    expect(f).not.toMatch(/\s+record;/)
    expect(f.split('as $$')[0]).toContain('security invoker')
  })
  it('security invoker, service_role 만 실행', () => {
    const b = s()
    expect(b).toContain('revoke all on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated')
    expect(b).toContain('grant execute on function public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid) to service_role')
  })
  it('한 트랜잭션이다', () => {
    expect(s()).toMatch(/^begin;$/m)
    expect(s()).toMatch(/^commit;$/m)
  })
})

describe('0107 rollback', () => {
  it('ds 행을 ip 로 옮긴 뒤 CHECK 를 ds 없이 되돌린다', () => {
    const rb = r()
    const move = rb.indexOf("update public.wbs_items set stage = 'ip' where stage = 'ds'")
    const chk = rb.indexOf("add constraint wbs_items_stage_check check (stage in ('as','ip','im','xx'))")
    expect(move).toBeGreaterThan(-1)
    expect(chk).toBeGreaterThan(move)
  })
  it('크레딧 표의 ds 키를 지운다 — 옛 코드의 검증이 모르는 키로 저장을 거부하지 않게', () => {
    expect(r()).toContain("(stage_credits -> 'default') - 'ds'")
  })
  it('전이 RPC 를 0103 본문과 글자 그대로 같게 되돌린다', () => {
    expect(fnOf(r())).toBe(fnOf(base()))
    expect(fnOf(r())).not.toContain('build_start')
  })
})
