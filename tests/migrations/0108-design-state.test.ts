// tests/migrations/0108-design-state.test.ts — 설계 상태(스펙 2026-09-26-design-state-dev-auto-design.md, 계획 P1~P3·P12·P13).
// SQL 이 도메인(designGate·stageLabels·stageCredits)과 같은지, 전이 RPC 가 0107 본문에서 정해진 곳만 바뀌었는지 대조한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLAIM_SCOPES, DESIGN_MODES, DESIGN_STATES } from '@/lib/domain/designGate'
import { HUMAN_STAGE_CODES, STAGE_CODES } from '@/lib/domain/stageLabels'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const s = () => readFileSync('supabase/migrations/0108_design_state.sql', 'utf8')
const r = () => readFileSync('supabase/migrations/0108_design_state_rollback.sql', 'utf8')
const prev = () => readFileSync('supabase/migrations/0107_wbs_design_stage.sql', 'utf8')
const fnOf = (sql: string) => sql.split('create or replace function public.apply_workflow_event')[1]?.split('$$;')[0] ?? ''
const fn = () => fnOf(s())
const q = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(',')
const NEW_SIG = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid, text, jsonb, text, text, text)'
const OLD_SIG = 'public.apply_workflow_event(text, uuid, uuid, uuid, text, text, uuid)'

describe('0108 칸과 CHECK', () => {
  it('단계 CHECK 가 도메인 STAGE_CODES 와 같다(dd 포함)', () => {
    expect(s()).toContain(`add constraint wbs_items_stage_check check (stage in (${q(STAGE_CODES)}))`)
  })
  it('설계 방식·설계 상태·claim 범위 CHECK 가 designGate 상수와 같다', () => {
    expect(s()).toContain(`check (design_mode in (${q(DESIGN_MODES)}))`)
    expect(s()).toContain(`check (design_state is null or design_state in (${q(DESIGN_STATES)}))`)
    expect(s()).toContain(`check (claim_scope is null or claim_scope in (${q(CLAIM_SCOPES)}))`)
  })
  it('design_mode 는 NOT NULL DEFAULT auto(D17)', () => {
    expect(s()).toContain("add column if not exists design_mode text not null default 'auto'")
  })
})

describe('0108 전이 RPC', () => {
  it('옛 7인자 함수를 지우고 12인자로 만들며 service_role 만 실행한다(P2)', () => {
    const b = s()
    expect(b.indexOf(`drop function if exists ${OLD_SIG};`)).toBeGreaterThan(-1)
    expect(b.indexOf(`drop function if exists ${OLD_SIG};`)).toBeLessThan(b.indexOf('create or replace function public.apply_workflow_event'))
    expect(b).toContain(`revoke all on function ${NEW_SIG} from public, anon, authenticated;`)
    expect(b).toContain(`grant execute on function ${NEW_SIG} to service_role;`)
    expect(b).toContain("notify pgrst, 'reload schema';")
  })
  it('SQL 기본 크레딧 상수가 코드 기본값과 같다(dd 20)', () => {
    const m = /c_default\s+constant\s+jsonb\s*:=\s*'(\{[\s\S]*?\})'::jsonb/.exec(fn())
    expect(m).not.toBeNull()
    expect(JSON.parse(m![1])).toEqual(DEFAULT_STAGE_CREDITS)
  })
  it('사건 목록에 새 사건 다섯이 있고, 주문 사건에 넷이 든다', () => {
    const f = fn()
    const flat = (x: string) => x.replace(/\s+/g, ' ')
    expect(f).toContain("'design_done','design_accept','design_reopen','cancel','set_design_mode'")
    expect(flat(f)).toContain("v_is_order_event := p_event in ('claim','report_completion','approve','unapprove','reject','rework','release','build_start', 'design_done','design_accept','design_reopen','cancel');")
  })
  it('완료 보고는 검토 대기면·리프가 ip 가 아니면 design_gate(Y2·W23), 반납은 D13 조건이면 design_gate', () => {
    const f = fn()
    expect(f).toContain("if p_event = 'report_completion' and (v_order_design_state = 'review'")
    expect(f).toContain("or (v_item_found and v_is_leaf and v_old_stage is distinct from 'ip')) then")
    expect(f).toContain("if p_event = 'release' and (v_order_design_state is not null")
    expect(f).toContain("or (v_order_claim_scope = 'design' and v_item_found and v_old_stage in ('ds','dd'))) then")
  })
  it('사람의 set_stage 는 dd 를 받지 않는다(HUMAN_STAGE_CODES)', () => {
    expect(fn()).toContain(`if p_stage is not null and p_stage not in (${q(HUMAN_STAGE_CODES)}) then`)
  })
  it('CAS 키 다섯(P1) — JSON null 은 "없음"과 비교된다', () => {
    const f = fn()
    for (const k of ['design_state', 'claim_scope', 'runner']) {
      expect(f).toContain(`(p_cas is not null and p_cas ? '${k}' and v_order_${k === 'runner' ? 'runner' : k} is distinct from (p_cas ->> '${k}'))`)
    }
    expect(f).toContain("(p_cas is not null and p_cas ? 'runner_seen_at' and v_order_runner_seen is distinct from (p_cas ->> 'runner_seen_at')::timestamptz)")
    expect(f).toContain("if v_is_order_event and p_cas is not null and p_cas ? 'design_mode' and v_item_found")
  })
  it('claim 은 범위로 단계를 정하고 claim_scope·runner 를 적는다(D8·D25)', () => {
    const f = fn()
    expect(f).toContain('claim_scope = v_scope, runner = coalesce(p_runner, p_agent), runner_seen_at = v_now')
    expect(f).toContain("if v_scope in ('full','design') then v_new_stage := 'ds'; v_credit_key := 'ds';")
    expect(f).toContain("elsif v_scope = 'build' then v_new_stage := 'dd'; v_credit_key := 'dd';")
    expect(f).toContain("else v_new_stage := case when p_stage = 'ds' then 'ds' else 'ip' end; v_credit_key := v_new_stage;")
  })
  it('build_start 는 ds·dd 에서만 ip, runner 를 호출자로 적는다', () => {
    const f = fn()
    expect(f).toContain("if v_old_stage in ('ds','dd') then v_apply := true; v_new_stage := 'ip'; v_credit_key := 'ip'; v_keep_max := true;")
    expect(f).toContain('set runner = coalesce(p_runner, p_agent, runner), runner_seen_at = v_now, updated_at = v_now')
  })
  it('완료 보고·해제·취소는 runner 를 비운다', () => {
    const f = fn()
    expect(f).toContain("set status = 'reported', runner = null, runner_seen_at = null, updated_at = v_now")
    expect(f).toContain('claim_scope = null, runner = null, runner_seen_at = null,')
    expect(f).toContain("set status = 'cancelled', claimed_by = null, claimed_by_user_id = null, claimed_at = null,")
  })
  it('승인·반려·재작업·승인 취소는 status 만 바꾸고 설계 상태·claim_scope·runner 는 그대로 둔다(4.1 — review·human 재작업이 build 범위로 돈다, D21·6.5)', () => {
    const sec = fn().split('-- 주문 갱신')[1]?.split('-- 단계·실적 결정')[0] ?? ''
    // 주문 갱신의 사건 갈래(들여쓰기 4칸의 if·elsif)다. reject·rework 에 따로 갈래를 두면 이 목록이 달라진다.
    expect([...sec.matchAll(/\n {4}(?:if|elsif) (p_event[^\n]*) then/g)].map(m => m[1])).toEqual([
      "p_event = 'claim'", "p_event = 'release'", "p_event = 'build_start'", "p_event = 'report_completion'",
      "p_event = 'cancel'", "p_event = 'design_done'", "p_event = 'design_accept'", "p_event = 'design_reopen'",
    ])
    // 나머지 사건(approve·reject·unapprove·rework)이 가는 마지막 else 는 status 만 바꾼다.
    const rest = sec.split(/\n {4}else\n/).at(-1) ?? ''
    expect(rest).toContain('update public.agent_work_orders set status = v_next, updated_at = v_now where id = p_order_id;')
    expect(rest).not.toMatch(/claim_scope|design_state|runner/)
  })
  it('design_done — review 는 방식 review 이거나 claim_scope design 일 때, review 가 되면 runner 를 비운다', () => {
    const f = fn()
    expect(f).toContain("if v_order_design_state is null and (v_design_mode = 'review' or v_order_claim_scope = 'design') then v_new_design_state := 'review'; end if;")
    expect(f).toContain("heartbeat_phase = case when v_new_design_state = 'review' then 'wait_review' else 'wait_pred' end,")
  })
  it('design_accept ① claimed 는 claim_scope 를 build 로, ② ready 는 단계 dd·실적 dd', () => {
    const f = fn()
    expect(f).toContain("claim_scope = case when v_order_status = 'claimed' then 'build' else claim_scope end,")
    expect(f).toContain("if v_order_status = 'ready' then v_apply := true; v_new_stage := 'dd'; v_credit_key := 'dd'; v_keep_max := true; end if;")
  })
  it('design_reopen — human 은 as·실적 as·claimed 면 ready 로, 그 밖은 review 로, 둘 다 runner 를 비운다(L9)', () => {
    const f = fn()
    expect(f).toContain("if v_design_mode = 'human' and v_order_design_state = 'accepted' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;")
    expect(f).toContain("set design_state = 'review', design_note = p_note, runner = null, runner_seen_at = null, updated_at = v_now")
  })
  it('cancel — claimed 이거나 단계 dd 면 as 로(D14), 직전 status 를 돌려준다(P3)', () => {
    const f = fn()
    expect(f).toContain("if v_order_status = 'claimed' or v_old_stage = 'dd' then v_apply := true; v_new_stage := 'as'; v_credit_key := 'as'; end if;")
    expect(f).toContain("'prev_status', case when v_is_order_event then v_order_status end,")
  })
  it('set_design_mode — 주문 행을 먼저 잠그고 항목을 잠근다(P3), 설계 상태·진행 주문이 있으면 거부', () => {
    const f = fn()
    const lockOrders = f.indexOf('perform 1 from public.agent_work_orders where wbs_item_id = p_item_id order by id for update;')
    const lockItem = f.indexOf('select design_mode into v_design_mode from public.wbs_items where id = p_item_id for update;')
    expect(lockOrders).toBeGreaterThan(-1)
    expect(lockItem).toBeGreaterThan(lockOrders)
    expect(f).toContain("'reason', 'design_mode_locked'")
  })
  it('앞으로 가는 사건은 실적을 낮추지 않는다(D19·P13)', () => {
    expect(fn()).toContain('if v_keep_max and v_new_pct is not null and v_old_pct is not null and v_old_pct > v_new_pct then v_new_pct := v_old_pct; end if;')
    expect(fn()).toContain("v_keep_max := p_event in ('report_completion','approve');")
  })
  it('dd 크레딧 채움은 greatest(ds, least(20, ip-5))(D18·P12)', () => {
    expect(fn()).toContain('v_new_pct := greatest(v_ds, least(20, v_ip - 5));')
  })
  it('0107 의 나머지 규칙을 그대로 가진다 — stub 하위 제외 리프·스텁 잔존 거부·잠금·record 금지', () => {
    const f = fn()
    expect(f).toContain('v_is_leaf := not exists (select 1 from public.wbs_items where parent_id = v_item_id and stub_for is null);')
    expect(f).toContain("'reason', 'stub_pending'")
    expect(f).toContain("'agent' = any(coalesce(v_tags, '{}'::text[]))")
    expect(f).toContain("'reason', 'locked'")
    expect(f).not.toMatch(/\s+record;/)
    expect(f.split('as $$')[0]).toContain('security invoker')
  })
})

describe('0108 데이터 이전(8절·L4·L12·D26)', () => {
  it('claimed·ds·wait_review 는 review·design·dd, wait_pred 는 dd 로(리프만)', () => {
    const b = s()
    expect(b).toContain("where o.status = 'claimed' and i.stage = 'ds' and o.heartbeat_phase in ('wait_review','wait_pred')")
    expect(b).toContain("set design_state = 'review', claim_scope = 'design', runner = null, runner_seen_at = null where id = r.order_id;")
  })
  it('나머지 claimed 는 claim_scope legacy, runner 는 heartbeat_agent 먼저(L12)', () => {
    expect(s()).toContain('runner = coalesce(runner, heartbeat_agent, claimed_by),')
    expect(s()).toContain("claim_scope = coalesce(claim_scope, 'legacy'),")
  })
  it('이미 진행된 항목의 ready 주문을 취소하고 이력을 남긴다(D26)', () => {
    expect(s()).toContain("'agent_order', 'ready', 'cancelled(0108 D26)'")
  })
  it('한 트랜잭션이다', () => {
    expect(s()).toMatch(/^begin;$/m)
    expect(s()).toMatch(/^commit;$/m)
  })
})

describe('0108 rollback', () => {
  it('dd 행을 ds 로 옮긴 뒤 CHECK 를 dd 없이 되돌린다', () => {
    const rb = r()
    const move = rb.indexOf("update public.wbs_items set stage = 'ds' where stage = 'dd';")
    const chk = rb.indexOf("add constraint wbs_items_stage_check check (stage in ('as','ds','ip','im','xx'))")
    expect(move).toBeGreaterThan(-1)
    expect(chk).toBeGreaterThan(move)
  })
  it('크레딧 표의 dd 키를 지운다', () => {
    expect(r()).toContain("(stage_credits -> 'default') - 'dd'")
  })
  it('새 12인자 함수를 지우고 0107 본문을 글자 그대로 되살린다', () => {
    expect(r()).toContain(`drop function if exists ${NEW_SIG};`)
    expect(fnOf(r())).toBe(fnOf(prev()))
    expect(r()).toContain(`grant execute on function ${OLD_SIG} to service_role;`)
  })
  it('새 칸을 지운다', () => {
    for (const c of ['design_mode', 'design_state', 'claim_scope', 'design_note', 'runner_seen_at']) expect(r()).toContain(`drop column if exists ${c}`)
  })
})
