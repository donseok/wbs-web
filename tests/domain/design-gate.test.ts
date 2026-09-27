// tests/domain/design-gate.test.ts — 설계 상태 관문·판단·화면 판정.
// 스펙 docs/superpowers/specs/2026-09-26-design-state-dev-auto-design.md 3·5절(12절이 우선), 계획서 P4·P5·P8·P16.
import { describe, expect, it } from 'vitest'
import {
  BLOCKED_MAX_AGE_MS, RUNNER_STALE_MS, alreadyProgressed, canBuildStart, canClaim, canDesignDone, canRelease,
  canReportCompletion, designButtons, designModeChangeBlock, designPushWarning, designScreen, isMine, isWorkerLabel,
  listFilterPass, nextAgentAction, parseWpList, pcOfLabel, predsState, runnerFree, toClaimScope, toDesignMode,
  toDesignState, workerAlive, type ItemFacts, type OrderFacts, type ScreenOrder,
} from '@/lib/domain/designGate'

const NOW = Date.parse('2026-09-27T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const item = (o: Partial<ItemFacts> = {}): ItemFacts => ({
  mode: 'auto', stage: 'as', actualPct: 0, delegated: true, hasApprovedOrder: false, preds: 'met', ...o,
})
const order = (o: Partial<OrderFacts> = {}): OrderFacts => ({
  status: 'ready', designState: null, claimScope: 'legacy', runner: null, runnerSeenAt: null,
  lastHeartbeatAt: null, heartbeatPhase: null, heartbeatAgent: null, claimedBy: null, claimedByUserId: null, ...o,
})
const claimed = (o: Partial<OrderFacts> = {}) =>
  order({ status: 'claimed', claimedBy: 'hong/mbp/w1', claimedByUserId: 'u-1', runner: 'hong/mbp/w1', runnerSeenAt: ago(1), ...o })

describe('값 정규화', () => {
  it('모르는 값·null 은 auto·없음·legacy 로 본다(D17·D8)', () => {
    expect(toDesignMode(undefined)).toBe('auto')
    expect(toDesignMode('human')).toBe('human')
    expect(toDesignState('nope')).toBeNull()
    expect(toDesignState('accepted')).toBe('accepted')
    expect(toClaimScope(null)).toBe('legacy')
    expect(toClaimScope('design')).toBe('design')
  })
})

describe('pcOfLabel·isWorkerLabel(P5, L1, Y9)', () => {
  it.each([
    ['hong/mbp/w1', 'mbp'], ['HONG/MBP/w2', 'mbp'], ['hong/mbp/poll', 'mbp'], ['claude-mbp', 'mbp'],
    ['legacy-agent', 'legacy-agent'], ['', null], [null, null],
  ])('%s → %s', (label, pc) => { expect(pcOfLabel(label)).toBe(pc) })
  it('팀원 라벨만 참', () => {
    expect(isWorkerLabel('hong/mbp/w1')).toBe(true)
    expect(isWorkerLabel('hong/mbp/w12')).toBe(true)
    expect(isWorkerLabel('hong/mbp/poll')).toBe(false)
    expect(isWorkerLabel('claude-mbp')).toBe(false)
    expect(isWorkerLabel(null)).toBe(false)
  })
})

describe('predsState(D15)', () => {
  it('없으면 met, 모두 dd·ip 면 ahead, 하나라도 그 밖이면 blocked', () => {
    expect(predsState([])).toBe('met')
    expect(predsState([{ stage: 'ip' }, { stage: 'dd' }])).toBe('ahead')
    expect(predsState([{ stage: 'ds' }])).toBe('blocked')
    expect(predsState([{ stage: null }])).toBe('blocked')
    expect(predsState([{ stage: 'as' }, { stage: 'ip' }])).toBe('blocked')
  })
})

describe('alreadyProgressed(D26, L6)', () => {
  it('단계 ip 이상·실적 100·approved 주문 중 하나면 참', () => {
    expect(alreadyProgressed(item({ stage: 'ip' }))).toBe(true)
    expect(alreadyProgressed(item({ actualPct: 100 }))).toBe(true)
    expect(alreadyProgressed(item({ hasApprovedOrder: true }))).toBe(true)
    expect(alreadyProgressed(item({ stage: 'dd', actualPct: 20 }))).toBe(false)
  })
})

describe('workerAlive(5.3 2행, Y12)', () => {
  it('5분 안의 작업 phase 는 살아 있다', () => {
    expect(workerAlive({ lastHeartbeatAt: ago(2), heartbeatPhase: 'build' }, NOW)).toBe(true)
    expect(workerAlive({ lastHeartbeatAt: ago(6), heartbeatPhase: 'build' }, NOW)).toBe(false)
  })
  it('BLOCKED 는 2 TICK(60분)까지만 살아 있다', () => {
    expect(BLOCKED_MAX_AGE_MS).toBe(60 * 60_000)
    expect(workerAlive({ lastHeartbeatAt: ago(50), heartbeatPhase: 'blocked' }, NOW)).toBe(true)
    expect(workerAlive({ lastHeartbeatAt: ago(61), heartbeatPhase: 'blocked' }, NOW)).toBe(false)
  })
  it('대기 phase 와 신호 없음은 살아 있지 않다', () => {
    expect(workerAlive({ lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_review' }, NOW)).toBe(false)
    expect(workerAlive({ lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_pred' }, NOW)).toBe(false)
    expect(workerAlive({ lastHeartbeatAt: null, heartbeatPhase: null }, NOW)).toBe(false)
  })
})

describe('runnerFree(D25)', () => {
  it('runner 없음·같은 PC(다른 슬롯·수동 세션)·30분 넘게 조용함이면 참', () => {
    expect(RUNNER_STALE_MS).toBe(30 * 60_000)
    expect(runnerFree({ runner: null, runnerSeenAt: null }, 'kim/pc2/w1', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(1) }, 'hong/mbp/w2', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(1) }, 'claude-mbp', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(10) }, 'hong/pc2/w1', NOW)).toBe(false)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: ago(31) }, 'hong/pc2/w1', NOW)).toBe(true)
    expect(runnerFree({ runner: 'hong/mbp/w1', runnerSeenAt: null }, 'hong/pc2/w1', NOW)).toBe(true)
  })
})

describe('nextAgentAction — 5.3 판단표 1~12행', () => {
  const a = (i: Partial<ItemFacts>, o: Partial<OrderFacts>) => nextAgentAction(item(i), order(o), NOW)
  it.each([
    ['1 reported', {}, { status: 'reported' as const }, 'skip'],
    ['1 approved', {}, { status: 'approved' as const }, 'skip'],
    ['1 cancelled', {}, { status: 'cancelled' as const }, 'skip'],
    ['2 claimed·ip', { stage: 'ip' }, { status: 'claimed' as const }, 'skip'],
    ['2 claimed·ds·살아 있음', { stage: 'ds' }, { status: 'claimed' as const, lastHeartbeatAt: ago(1), heartbeatPhase: 'design' }, 'skip'],
    ['3 ready·ip', { stage: 'ip' }, {}, 'skip'],
    ['3 ready·실적 100(L6)', { actualPct: 100 }, {}, 'skip'],
    ['3 ready·approved 주문', { hasApprovedOrder: true }, {}, 'skip'],
    ['4 review', { stage: 'dd' }, { status: 'claimed' as const, designState: 'review' as const, lastHeartbeatAt: ago(1), heartbeatPhase: 'wait_review' }, 'wait'],
    ['5 accepted·as', { stage: 'as', mode: 'human' }, { designState: 'accepted' as const }, 'skip'],
    ['6 accepted·선행 ahead', { stage: 'dd', mode: 'human', preds: 'ahead' }, { designState: 'accepted' as const }, 'wait'],
    ['7 accepted·dd·met', { stage: 'dd', mode: 'human' }, { designState: 'accepted' as const }, 'build'],
    ['8 claimed·as', { stage: 'as' }, { status: 'claimed' as const }, 'skip'],
    ['8 design·blocked', { stage: 'ds', mode: 'review', preds: 'blocked' }, { status: 'claimed' as const, claimScope: 'design' as const }, 'wait'],
    ['8 design·ahead', { stage: 'ds', mode: 'review', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'design' as const }, 'design'],
    ['8 full·dd·ahead', { stage: 'dd', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'full' as const }, 'wait'],
    ['8 full·ds·ahead', { stage: 'ds', preds: 'ahead' }, { status: 'claimed' as const, claimScope: 'full' as const }, 'full'],
    ['8 legacy·ds·met', { stage: 'ds' }, { status: 'claimed' as const, claimScope: 'legacy' as const }, 'full'],
    ['8 build·설계 상태 없음', { stage: 'dd', mode: 'human' }, { status: 'claimed' as const, claimScope: 'build' as const }, 'skip'],
    ['9 human', { mode: 'human' }, {}, 'skip'],
    ['10 blocked', { preds: 'blocked' }, {}, 'wait'],
    ['11 review·ahead', { mode: 'review', preds: 'ahead' }, {}, 'design'],
    ['12 auto·met', {}, {}, 'full'],
  ] as const)('%s', (_n, i, o, want) => { expect(a(i as Partial<ItemFacts>, o as Partial<OrderFacts>).action).toBe(want) })
  it('12행·8행 full 은 선행 미충족이면 depsUnmet 을 켠다(설계 선행 경로)', () => {
    expect(a({ preds: 'ahead' }, {})).toMatchObject({ action: 'full', depsUnmet: true })
    expect(a({}, {})).toMatchObject({ action: 'full', depsUnmet: false })
    expect(a({ stage: 'ds', preds: 'ahead' }, { status: 'claimed', claimScope: 'full' })).toMatchObject({ depsUnmet: true })
  })
  it('사유 문장을 싣는다', () => {
    expect(a({ mode: 'human' }, {}).reason).toBe('사람 설계 대기')
  })
})

describe('isMine(5.3, Y9)', () => {
  const req = (o: Partial<{ userId: string; label: string | null; lead: boolean; filtersPass: boolean }> = {}) =>
    ({ userId: 'u-1', label: 'hong/mbp/w3', lead: false, filtersPass: true, ...o })
  it('ready 는 목록 거르기만 본다', () => {
    expect(isMine(order(), req(), NOW)).toBe(true)
    expect(isMine(order(), req({ filtersPass: false }), NOW)).toBe(false)
  })
  it('claimed 는 같은 신원 ∧ runnerFree', () => {
    expect(isMine(claimed(), req(), NOW)).toBe(true)
    expect(isMine(claimed({ claimedByUserId: 'u-2' }), req(), NOW)).toBe(false)
    expect(isMine(claimed(), req({ label: 'hong/pc2/w1' }), NOW)).toBe(false)
    expect(isMine(claimed({ runnerSeenAt: ago(31) }), req({ label: 'hong/pc2/w1' }), NOW)).toBe(true)
  })
  it('팀장 요청은 claimed 에도 거르기와 팀원 라벨을 요구한다(Y9)', () => {
    expect(isMine(claimed({ claimedBy: 'claude-mbp', runner: 'claude-mbp' }), req({ lead: true }), NOW)).toBe(false)
    expect(isMine(claimed(), req({ lead: true, filtersPass: false }), NOW)).toBe(false)
    expect(isMine(claimed(), req({ lead: true }), NOW)).toBe(true)
  })
  it('reported·approved·cancelled 는 거짓', () => {
    expect(isMine(order({ status: 'reported' }), req(), NOW)).toBe(false)
  })
})

describe('canClaim — 5.2 claim 관문', () => {
  it('이미 진행된 항목은 모든 범위에서 409 design_gate(D26·L6)', () => {
    for (const i of [item({ stage: 'ip' }), item({ actualPct: 100 }), item({ hasApprovedOrder: true })]) {
      expect(canClaim(i, null, 'full', false)).toMatchObject({ status: 409, code: 'design_gate' })
    }
  })
  it('full·legacy 는 auto ∧ 설계 상태 없음', () => {
    expect(canClaim(item(), null, 'full', false)).toBeNull()
    expect(canClaim(item({ mode: 'review' }), null, 'full', false)).toMatchObject({ code: 'design_gate' })
    expect(canClaim(item({ mode: 'human' }), null, 'legacy', false)).toMatchObject({ code: 'design_gate' })
  })
  it('full 의 선행: design_first 없으면 403, 있으면 ahead 만 통과', () => {
    expect(canClaim(item({ preds: 'ahead' }), null, 'full', false)).toMatchObject({ status: 403, code: 'dependency_not_met' })
    expect(canClaim(item({ preds: 'ahead' }), null, 'full', true)).toBeNull()
    expect(canClaim(item({ preds: 'blocked' }), null, 'full', true)).toMatchObject({ status: 403, reason: 'design_first_too_early' })
  })
  it('design 은 auto·review ∧ 설계 상태 없음, 선행 미충족이면 설계 선행으로 본다', () => {
    expect(canClaim(item({ mode: 'review', preds: 'ahead' }), null, 'design', false)).toBeNull()
    expect(canClaim(item({ mode: 'review', preds: 'blocked' }), null, 'design', false)).toMatchObject({ reason: 'design_first_too_early' })
    expect(canClaim(item({ mode: 'human' }), null, 'design', false)).toMatchObject({ code: 'design_gate' })
  })
  it('build 는 human ∧ accepted ∧ dd, design_first 무시', () => {
    expect(canClaim(item({ mode: 'human', stage: 'dd' }), 'accepted', 'build', false)).toBeNull()
    expect(canClaim(item({ mode: 'human', stage: 'dd', preds: 'ahead' }), 'accepted', 'build', true)).toMatchObject({ status: 403, code: 'dependency_not_met' })
    expect(canClaim(item({ mode: 'human', stage: 'dd' }), null, 'build', false)).toMatchObject({ status: 409, code: 'design_not_accepted' })
    expect(canClaim(item({ mode: 'review', stage: 'dd' }), 'accepted', 'build', false)).toMatchObject({ code: 'design_not_accepted' })
  })
})

describe('canBuildStart — 5.2 build-start 관문(P4 순서: runner → 설계 → 선행)', () => {
  const bs = (i: Partial<ItemFacts>, o: Partial<OrderFacts>, scope: 'full' | 'build' | 'rework' | 'legacy', caller = 'hong/mbp/w1') =>
    canBuildStart(item(i), claimed(o), scope, caller, NOW)
  it('claimed 가 아니면 409 design_gate(Y7)', () => {
    expect(canBuildStart(item({ stage: 'dd' }), order({ status: 'ready' }), 'build', 'hong/mbp/w1', NOW))
      .toMatchObject({ status: 409, code: 'design_gate' })
  })
  it('다른 PC 가 30분 안에 신호를 냈으면 409 runner_active — 설계 검사보다 먼저', () => {
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'review' }, 'build', 'kim/pc2/w1')).toMatchObject({ code: 'runner_active' })
  })
  it('full: auto ∧ 설계 상태 없음 ∧ claim_scope full·legacy, 단계 ds·dd(ip 이상은 멱등)', () => {
    expect(bs({ stage: 'ds' }, { claimScope: 'full' }, 'full')).toBeNull()
    expect(bs({ stage: 'ip', preds: 'blocked' }, { claimScope: 'legacy' }, 'full')).toBeNull()
    expect(bs({ stage: 'ds', mode: 'review' }, { claimScope: 'design' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ds' }, { claimScope: 'design' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'as' }, { claimScope: 'full' }, 'full')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ds', preds: 'ahead' }, { claimScope: 'full' }, 'full')).toMatchObject({ status: 403, code: 'dependency_not_met' })
  })
  it('build: accepted, 단계 dd(ip 이상은 멱등)', () => {
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toBeNull()
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'review', claimScope: 'build' }, 'build')).toMatchObject({ code: 'design_not_accepted' })
    expect(bs({ stage: 'ds', mode: 'human' }, { designState: 'accepted', claimScope: 'build' }, 'build')).toMatchObject({ code: 'design_gate' })
  })
  it('rework: 단계 ip ∧ (accepted 이거나 auto·설계 상태 없음)(Y2), 선행은 보지 않는다', () => {
    expect(bs({ stage: 'ip', preds: 'blocked' }, {}, 'rework')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, { designState: 'accepted' }, 'rework')).toBeNull()
    expect(bs({ stage: 'ip', mode: 'review' }, {}, 'rework')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'dd', mode: 'review' }, { designState: 'accepted' }, 'rework')).toMatchObject({ code: 'design_gate' })
  })
  it('legacy: ip 이상은 review 만 거부, ip 미만은 full 과 같다', () => {
    expect(bs({ stage: 'ip' }, { designState: 'review' }, 'legacy')).toMatchObject({ code: 'design_gate' })
    expect(bs({ stage: 'ip' }, {}, 'legacy')).toBeNull()
    expect(bs({ stage: 'ds' }, { claimScope: 'legacy' }, 'legacy')).toBeNull()
    expect(bs({ stage: 'ds', mode: 'review' }, { claimScope: 'legacy' }, 'legacy')).toMatchObject({ code: 'design_gate' })
  })
})

describe('canReportCompletion(Y1·Y2·W23·P16)', () => {
  const leaf = (stage: string | null) => ({ stage, isLeaf: true })
  it('설계 검토 대기면 409 design_gate', () => {
    expect(canReportCompletion(leaf('ip'), claimed({ designState: 'review' }), 'hong/mbp/w1', NOW)).toMatchObject({ code: 'design_gate' })
  })
  it('리프는 단계 ip 에서만(Y2) — 부모·지워진 항목은 단계를 보지 않는다', () => {
    expect(canReportCompletion(leaf('ds'), claimed(), 'hong/mbp/w1', NOW)).toMatchObject({ code: 'design_gate' })
    expect(canReportCompletion(leaf('ip'), claimed(), 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion({ stage: 'as', isLeaf: false }, claimed(), 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion(null, claimed(), 'hong/mbp/w1', NOW)).toBeNull()
  })
  it('runner 가 다른 PC 면 30분이 지나도 409 runner_active(Y1) — 넘겨받기는 heartbeat·build-start 몫', () => {
    expect(canReportCompletion(leaf('ip'), claimed({ runnerSeenAt: ago(90) }), 'kim/pc2/w1', NOW)).toMatchObject({ code: 'runner_active' })
    expect(canReportCompletion(leaf('ip'), claimed({ runner: null }), 'kim/pc2/w1', NOW)).toBeNull()
    expect(canReportCompletion(leaf('ip'), claimed(), 'claude-mbp', NOW)).toBeNull()
  })
  it('다른 세션이 살아 있으면 409 runner_active(P16)', () => {
    const o = claimed({ heartbeatAgent: 'hong/mbp/w1', lastHeartbeatAt: ago(1), heartbeatPhase: 'build' })
    expect(canReportCompletion(leaf('ip'), o, 'claude-mbp', NOW)).toMatchObject({ code: 'runner_active' })
    expect(canReportCompletion(leaf('ip'), o, 'hong/mbp/w1', NOW)).toBeNull()
    expect(canReportCompletion(leaf('ip'), { ...o, lastHeartbeatAt: ago(6) }, 'claude-mbp', NOW)).toBeNull()
  })
})

describe('canRelease(D13)·canDesignDone', () => {
  it('설계 상태가 있거나 설계만 하던 주문이 ds·dd 면 409 design_gate', () => {
    expect(canRelease({ stage: 'dd' }, claimed({ designState: 'accepted' }))).toMatchObject({ code: 'design_gate' })
    expect(canRelease({ stage: 'ds' }, claimed({ claimScope: 'design' }))).toMatchObject({ code: 'design_gate' })
    expect(canRelease({ stage: 'as' }, claimed({ claimScope: 'design' }))).toBeNull()
    expect(canRelease(null, claimed({ claimScope: 'design' }))).toBeNull()
    expect(canRelease({ stage: 'ds' }, claimed({ claimScope: 'full' }))).toBeNull()
  })
  it('design-done 은 claimed ∧ 단계 ip 미만', () => {
    expect(canDesignDone({ stage: 'ds' }, claimed())).toBeNull()
    expect(canDesignDone({ stage: 'ip' }, claimed())).toMatchObject({ code: 'design_gate' })
    expect(canDesignDone({ stage: 'ds' }, order())).toMatchObject({ code: 'design_gate' })
  })
})

describe('designModeChangeBlock(4.1 설계 방식 변경)', () => {
  it('설계 상태가 있거나 claimed·reported·approved 주문이 있으면 사유를 낸다', () => {
    expect(designModeChangeBlock({ designState: 'accepted', orderStatuses: ['ready'] })).toMatch(/설계가/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['claimed'] })).toMatch(/에이전트가 작업 중/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['approved'] })).toMatch(/승인된 주문/)
    expect(designModeChangeBlock({ designState: null, orderStatuses: ['ready', 'cancelled'] })).toBeNull()
  })
  it('reported·approved 를 가장 먼저 본다 — 검수 대기가 설계 상태·claimed 뒤에 가려지지 않는다', () => {
    // 설계 상태가 accepted 여도 주문이 reported 면 진짜 이유(완료 보고 대기)가 먼저 나와야 한다 —
    // 「설계 되돌리기」도 「중단」도 reported 주문에는 안 통하기 때문(RPC 는 ready·claimed 만 받는다).
    expect(designModeChangeBlock({ designState: 'accepted', orderStatuses: ['reported'] })).toMatch(/완료 보고/)
    expect(designModeChangeBlock({ designState: 'review', orderStatuses: ['claimed', 'approved'] })).toMatch(/완료 보고|승인/)
  })
  it('설계 상태가 있으면(=reported·approved 는 없다는 뜻) 문구가 위임 해제를 가리킨다 — 그때는 실제로 통하는 길이라서', () => {
    expect(designModeChangeBlock({ designState: 'review', orderStatuses: ['claimed'] })).toMatch(/위임을 해제/)
    expect(designModeChangeBlock({ designState: 'accepted', orderStatuses: [] })).toMatch(/위임을 해제/)
  })
})

describe('designButtons(7절, P8)', () => {
  const s = (o: Partial<ScreenOrder>): ScreenOrder => ({
    status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, ...o,
  })
  it('설계 승인: claimed ∧ review ∧ dd', () => {
    expect(designButtons(item({ stage: 'dd', mode: 'review' }), s({ status: 'claimed', designState: 'review' }))).toEqual(['accept'])
    expect(designButtons(item({ stage: 'ds', mode: 'review' }), s({ status: 'claimed', designState: 'review' }))).toEqual([])
  })
  it('설계 확정: ready ∧ human ∧ 표식 ∧ 단계 as·ds·없음 ∧ 설계 상태 없음', () => {
    expect(designButtons(item({ mode: 'human' }), s({}))).toEqual(['confirm'])
    expect(designButtons(item({ mode: 'human', stage: null }), s({}))).toEqual(['confirm'])
    expect(designButtons(item({ mode: 'human', delegated: false }), s({}))).toEqual([])
    expect(designButtons(item({ mode: 'human', actualPct: 100 }), s({}))).toEqual([])
  })
  it('설계 되돌리기: accepted ∧ dd ∧ 주문 status 가 ready·claimed 일 때만(reopen RPC 는 그 둘만 받는다, 0108)', () => {
    expect(designButtons(item({ stage: 'dd', mode: 'human' }), s({ designState: 'accepted' }))).toEqual(['reopen'])
    expect(designButtons(item({ stage: 'dd', mode: 'human' }), s({ status: 'claimed', designState: 'accepted' }))).toEqual(['reopen'])
    expect(designButtons(item({ stage: 'ip', mode: 'human' }), s({ status: 'claimed', designState: 'accepted' }))).toEqual([])
    // reported·approved 는 stage 가 dd 로 얼어 있어도(부모 항목처럼) 버튼을 보이지 않는다 — 눌러도 RPC 가 매번 conflict.
    expect(designButtons(item({ stage: 'dd', mode: 'human' }), s({ status: 'reported', designState: 'accepted' }))).toEqual([])
    expect(designButtons(item({ stage: 'dd', mode: 'review' }), s({ status: 'approved', designState: 'accepted' }))).toEqual([])
  })
  it('활성 주문이 없으면 버튼 없음', () => {
    expect(designButtons(item({ mode: 'human' }), null)).toEqual([])
  })
})

describe('designScreen — 3절 판정표(12절 L2·L14, P8)', () => {
  const s = (o: Partial<ScreenOrder>): ScreenOrder => ({
    status: 'ready', designState: null, runner: null, lastHeartbeatAt: null, heartbeatPhase: null, designNote: null, ...o,
  })
  const row = (i: Partial<ItemFacts>, o: Partial<ScreenOrder> | null, lastReview: 'approve' | 'reject' | null = null) =>
    designScreen({ item: item(i), active: o === null ? null : s(o), lastReview, nowMs: NOW })
  it.each([
    ['1', { stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'review', designNote: '절 누락' }, 1, '설계 검토 대기'],
    ['2 review', { stage: 'dd', mode: 'review', preds: 'ahead' }, { status: 'claimed', designState: 'accepted' }, 2, '선행 대기(설계 승인됨)'],
    ['2 human', { stage: 'dd', mode: 'human', preds: 'ahead' }, { designState: 'accepted' }, 2, '선행 대기(설계 확정됨)'],
    ['3', { stage: 'dd', mode: 'human' }, { designState: 'accepted' }, 3, '구현 대기(설계 확정됨)'],
    ['4 선행', { stage: 'dd', preds: 'ahead' }, { status: 'claimed' }, 4, '설계 완료·선행 대기'],
    ['4 구현', { stage: 'dd' }, { status: 'claimed' }, 4, '설계 완료·구현 대기'],
    ['12(L14)', { stage: 'ds', preds: 'blocked' }, { status: 'claimed' }, 12, '선행 대기(설계 중 멈춤)'],
    ['6', { mode: 'human' }, {}, 6, '사람 설계 대기'],
    ['6 단계 없음(P8)', { mode: 'human', stage: null }, {}, 6, '사람 설계 대기'],
    ['7', { mode: 'human', delegated: false }, null, 7, '사람 설계 대기(위임 안 됨)'],
    ['8', { stage: 'ip' }, {}, 8, '위임 보류(단계가 이미 진행됨)'],
    ['8 실적 100', { actualPct: 100 }, {}, 8, '위임 보류(단계가 이미 진행됨)'],
    ['9', { hasApprovedOrder: true, stage: 'im' }, null, 9, '위임 보류(승인된 주문 있음)'],
    ['10', { stage: 'ip' }, null, 10, '위임 보류(단계가 이미 진행됨)'],
    ['11', { mode: 'review', preds: 'blocked' }, {}, 11, '선행 대기'],
  ] as const)('%s행', (_n, i, o, wantRow, wantLabel) => {
    const r = row(i as Partial<ItemFacts>, o as Partial<ScreenOrder> | null)
    expect(r?.row).toBe(wantRow)
    expect(r?.label).toBe(wantLabel)
  })
  it('1행은 되돌림 사유를 note 로 싣고 「설계 승인」 버튼을 준다', () => {
    const r = row({ stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'review', designNote: '절 누락' })
    expect(r).toMatchObject({ note: '절 누락', buttons: ['accept'] })
  })
  it('3행은 다른 PC 가 살아서 돌면 라벨을 붙인다(workerAlive)', () => {
    expect(row({ stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'accepted', runner: 'kim/pc2/w1', lastHeartbeatAt: ago(1), heartbeatPhase: 'build' })?.label)
      .toBe('구현 대기(설계 승인됨) · kim/pc2/w1 가 도는 중')
  })
  it('3행은 runner 가 있어도 heartbeat 가 죽었으면(prepare 중 죽어 build-start 전) 꼬리를 붙이지 않는다 — 확인 필요 띠(끊김)·허브(무응답)와 반대로 말하지 않는다', () => {
    expect(row({ stage: 'dd', mode: 'review' }, { status: 'claimed', designState: 'accepted', runner: 'kim/pc2/w1', lastHeartbeatAt: ago(10), heartbeatPhase: 'prepare' })?.label)
      .toBe('구현 대기(설계 승인됨)')
  })
  it('5행 재작업 대기는 살아 있는 heartbeat 가 없을 때만(L2)', () => {
    expect(row({ stage: 'ip' }, { status: 'claimed' }, 'reject')?.row).toBe(5)
    expect(row({ stage: 'ip' }, { status: 'claimed', lastHeartbeatAt: ago(1), heartbeatPhase: 'build' }, 'reject')).toBeNull()
  })
  it('사람 설계 대기(6·7행)는 이미 진행된 항목에 걸리지 않는다', () => {
    expect(row({ mode: 'human', delegated: true, actualPct: 100 }, null)?.row).toBe(10)
  })
  it('정상 완료·첫 구현은 어느 행에도 걸리지 않는다', () => {
    expect(row({ stage: 'xx', hasApprovedOrder: true }, null)).toBeNull()
    expect(row({ stage: 'ip', mode: 'review' }, { status: 'claimed', designState: 'accepted' })).toBeNull()
  })
})

describe('designPushWarning(Y13)', () => {
  it('승인·확정된 설계로 구현 중이면 push 금지를 알린다', () => {
    expect(designPushWarning(item({ stage: 'ip', mode: 'review' }), { status: 'claimed', designState: 'accepted' })).toMatch(/push 하지 마세요/)
    expect(designPushWarning(item({ stage: 'dd', mode: 'review' }), { status: 'claimed', designState: 'accepted' })).toBeNull()
  })
})

describe('parseWpList·listFilterPass(poll.sh filter_ok 와 같은 규칙)', () => {
  it('WP 목록을 정규화하고 형식 오류는 invalid', () => {
    expect(parseWpList('WP-02,dict/WP-3')).toEqual(['WP-2', 'dict/WP-3'])
    expect(parseWpList('')).toBeNull()
    expect(parseWpList(null)).toBeNull()
    expect(parseWpList('WP-x')).toBe('invalid')
  })
  it('태그와 WP 로 거른다', () => {
    const it2 = { tags: ['agent'], externalRef: 'dict/TSK-02-05' }
    expect(listFilterPass(it2, { requireTag: 'agent', wp: null })).toBe(true)
    expect(listFilterPass(it2, { requireTag: 'other', wp: null })).toBe(false)
    expect(listFilterPass(it2, { requireTag: null, wp: ['WP-2'] })).toBe(true)
    expect(listFilterPass(it2, { requireTag: null, wp: ['dict/WP-2'] })).toBe(true)
    expect(listFilterPass(it2, { requireTag: null, wp: ['mes/WP-2'] })).toBe(false)
    expect(listFilterPass({ tags: null, externalRef: 'TSK-03-01' }, { requireTag: null, wp: ['WP-2'] })).toBe(false)
    expect(listFilterPass({ tags: null, externalRef: null }, { requireTag: null, wp: null })).toBe(true)
  })
})
