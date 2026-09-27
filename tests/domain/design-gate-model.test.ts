// tests/domain/design-gate-model.test.ts — 설계 상태 상태 공간 모델(BFS).
// docs/superpowers/specs/2026-09-26-design-state-model/model5.py 를 옮겼다(그 파일 머리의 "구현 계획서 판" 실행 줄과 같은 틀).
// 켠 것: 스펙 12절 수정안(Y1 완료 보고·heartbeat 의 runner, Y2 완료 보고는 ip 에서만, Y7 claimed 아님은 워커 종료,
//   L5 사람 초안은 full 에도, L6 실적 100 관문, L9 되돌림은 runner 를 비움, Y11 fetch·push 실패는 일시 제외),
//   계획 P7(재개 때 build-start 로 runner 넘겨받기)·P16(살아 있는 다른 세션이 있으면 완료 보고 거부)·L8(위임은 단계를 건드리지 않음).
// 끈 것: 조용한 워커·BLOCKED·팀장 PC 이동·import. PC 둘, 동시 워커 둘, 사람의 수기 실적 100·수동 done 은 켠다.
// 관문·판단·mine·버튼·화면 판정은 실제 designGate 함수를 부르고, 전이(스펙 4.1 사건 표의 결과)는 이 파일이 따로 적는다 —
// 전이까지 designGate 에서 가져오면 자기 자신과 대조하는 셈이 된다.
// 위반이 나오면 먼저 Python 판과 같은 전이인지 대조한다. 옮김 오류가 아니면 designGate 를 고친다.
// P13(실적을 낮추지 않음)은 전이를 이 파일이 손으로 적어서 검사할 제품 코드가 없다 — 0108 전이 RPC(apply_workflow_event)의
// greatest() 가 맡는다(이 파일은 그 계산을 흉내만 낸다).
import { describe, expect, it } from 'vitest'
import {
  canBuildStart, canClaim, canRelease, canReportCompletion, designButtons, designScreen, isMine, nextAgentAction, runnerFree,
  workerAlive, type ClaimScope, type ItemFacts, type OrderFacts, type PredsState,
} from '@/lib/domain/designGate'

type Ord = 'none' | 'ready' | 'claimed' | 'reported' | 'approved' | 'cancelled'
type PC = 'A' | 'B'
type WScope = 'full' | 'design' | 'build' | 'rework' | 'legacy'
type Worker = { sc: WScope; step: 0 | 1; own: 'L' | 'H' } | null
type Res = null | 'diedL' | 'diedH' | 'result'
type S = {
  mode: 'auto' | 'review' | 'human'; tag: boolean; ord: Ord; dst: 'none' | 'review' | 'accepted'
  cs: null | 'legacy' | 'full' | 'design' | 'build'; stage: string; pct: number; rw: boolean
  hbph: null | 'work' | 'wait'; hbage: 0 | 1; runner: PC | null; rage: 0 | 1; preds: 'met' | 'ok' | 'no'; hd: boolean
  wA: Worker; wB: Worker; wtA: boolean; wtB: boolean; resA: Res; resB: Res; excl: null | 'temp' | 'perm'; pend: boolean
}

const NOW = Date.parse('2026-09-27T12:00:00Z')
const iso = (min: number) => new Date(NOW - min * 60_000).toISOString()
const AT1 = iso(1), AT10 = iso(10), AT31 = iso(31)
const PCS: readonly PC[] = ['A', 'B']
const LEAD: PC = 'A'
const MAXW = 2
const CRED: Record<string, number> = { as: 0, ds: 10, dd: 20, ip: 30, rw: 50, im: 80, xx: 100 }
const ACTIVE: ReadonlySet<Ord> = new Set(['ready', 'claimed', 'reported'])
const geIp = (st: string) => st === 'ip' || st === 'im' || st === 'xx'
const workerLabel = (x: PC) => `u/pc${x.toLowerCase()}/w1`
const humanLabel = (x: PC) => `claude-pc${x.toLowerCase()}`
const w = (s: S, x: PC) => (x === 'A' ? s.wA : s.wB)
const wt = (s: S, x: PC) => (x === 'A' ? s.wtA : s.wtB)
const resOf = (s: S, x: PC) => (x === 'A' ? s.resA : s.resB)
const other = (x: PC): PC => (x === 'A' ? 'B' : 'A')
const mx = (p: number, k: string) => Math.max(p, CRED[k])

function setw(s: S, x: PC, p: { w?: Worker; wt?: boolean; res?: Res }): S {
  const t = { ...s }
  if (p.w !== undefined) { if (x === 'A') t.wA = p.w; else t.wB = p.w }
  if (p.wt !== undefined) { if (x === 'A') t.wtA = p.wt; else t.wtB = p.wt }
  if (p.res !== undefined) { if (x === 'A') t.resA = p.res; else t.resB = p.res }
  return t
}
const wk = (x: Worker) => (x === null ? '-' : `${x.sc}.${x.step}.${x.own}`)
const key = (s: S) => `${s.mode}|${+s.tag}|${s.ord}|${s.dst}|${s.cs ?? '-'}|${s.stage}|${s.pct}|${+s.rw}|${s.hbph ?? '-'}|${s.hbage}|`
  + `${s.runner ?? '-'}|${s.rage}|${s.preds}|${+s.hd}|${wk(s.wA)}|${wk(s.wB)}|${+s.wtA}|${+s.wtB}|${s.resA ?? '-'}|${s.resB ?? '-'}|${s.excl ?? '-'}|${+s.pend}`

// ---- 판단 재료(designGate 입력) ----
const PREDS: Record<S['preds'], PredsState> = { met: 'met', ok: 'ahead', no: 'blocked' }
const item = (s: S): ItemFacts => ({
  mode: s.mode, stage: s.stage, actualPct: s.pct, delegated: s.tag, hasApprovedOrder: s.ord === 'approved', preds: PREDS[s.preds],
})
function hbAgent(s: S): string | null {
  if (s.runner !== null && w(s, s.runner) !== null) return workerLabel(s.runner)
  if (s.wA !== null) return workerLabel('A')
  if (s.wB !== null) return workerLabel('B')
  return s.runner === null ? null : workerLabel(s.runner)
}
const order = (s: S): OrderFacts => ({
  status: s.ord === 'none' ? 'cancelled' : s.ord,
  designState: s.dst === 'none' ? null : s.dst,
  claimScope: (s.cs ?? 'legacy') as ClaimScope,
  runner: s.runner === null ? null : workerLabel(s.runner),
  runnerSeenAt: s.runner === null ? null : s.rage === 1 ? AT31 : AT10,
  lastHeartbeatAt: s.hbph === null ? null : s.hbage === 1 ? AT10 : AT1,
  heartbeatPhase: s.hbph === null ? null : s.hbph === 'wait' ? 'wait_review' : 'build',
  heartbeatAgent: s.hbph === null ? null : hbAgent(s),
  claimedBy: s.ord === 'claimed' ? workerLabel(s.runner ?? LEAD) : null,
  claimedByUserId: s.ord === 'claimed' ? 'u' : null,
})
const action = (s: S) => (s.ord === 'none' ? 'none' : nextAgentAction(item(s), order(s), NOW).action)
const mine = (s: S, x: PC, lead: boolean) => s.ord !== 'none'
  && isMine(order(s), { userId: 'u', label: lead ? workerLabel(x) : humanLabel(x), lead, filtersPass: lead ? s.tag : true }, NOW)
const activeOf = (s: S) => {
  if (!ACTIVE.has(s.ord)) return null
  const o = order(s)
  return { status: o.status, designState: o.designState, runner: o.runner, lastHeartbeatAt: o.lastHeartbeatAt, heartbeatPhase: o.heartbeatPhase, designNote: null }
}
const reportOk = (s: S, caller: string) => canReportCompletion({ stage: s.stage, isLeaf: true }, order(s), caller, NOW) === null
const unapproved = (s: S) => s.dst === 'review' || ((s.mode === 'review' || s.mode === 'human') && s.dst !== 'accepted')
const wscope = (s: S): WScope => (s.rw && s.stage === 'ip')
  ? 'rework' : ({ design: 'design', full: 'full', legacy: 'full', build: 'build' } as const)[s.cs ?? 'legacy']

// ---- 4.1 사건의 결과(전이) ----
function norm(s: S): S {  // 살아 있는 워커는 heartbeat 를 계속 보낸다(claimed 에서만 받는다)
  if (s.ord !== 'claimed') return s
  let t = s
  if (t.wA !== null || t.wB !== null) t = { ...t, hbph: 'work', hbage: 0 }
  if (t.runner !== null && w(t, t.runner) !== null) t = { ...t, rage: 0 }
  if (t.runner === null && t.rage !== 0) t = { ...t, rage: 0 }
  return t
}
function issue(t: S): S {  // D26 발행. 단계·실적은 건드리지 않는다(L8)
  if (ACTIVE.has(t.ord) || t.ord === 'approved' || geIp(t.stage) || t.pct >= 100) return t
  return { ...t, ord: 'ready', dst: 'none', cs: null, rw: false, hbph: null, hbage: 0, runner: null, rage: 0,
    wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, excl: null, pend: false }
}
function cancel(t: S): S {  // D14 — RPC cancel 사건
  if (t.ord !== 'ready' && t.ord !== 'claimed') return t
  const back = t.ord === 'claimed' || t.stage === 'dd'
  return { ...t, ord: 'cancelled', dst: 'none', cs: null, runner: null, rage: 0, stage: back ? 'as' : t.stage, pct: back ? 0 : t.pct,
    rw: false, hbph: null, hbage: 0, wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, pend: false }
}
function reopen(s: S): S | null {  // design_reopen — dd ∧ accepted 에서만, 방식과 관계없이 runner 를 비운다(L9)
  if (!(s.stage === 'dd' && s.dst === 'accepted')) return null
  if (s.mode === 'human') {
    const t: S = { ...s, stage: 'as', dst: 'none', pct: 0 }
    return s.ord === 'claimed' ? { ...t, ord: 'ready', cs: null, runner: null, rage: 0, hbph: null, hbage: 0, pend: false } : t
  }
  return { ...s, dst: 'review', runner: null, rage: 0 }
}
function designDone(s: S): S | null {
  if (s.ord !== 'claimed' || (s.stage !== 'ds' && s.stage !== 'dd')) return null
  const becameReview = s.dst === 'none' && (s.mode === 'review' || s.cs === 'design')
  const t: S = { ...s, stage: 'dd', dst: becameReview ? 'review' : s.dst, pct: mx(s.pct, 'dd'), hbph: 'wait', hbage: 0, pend: false }
  return becameReview ? { ...t, runner: null, rage: 0 } : t
}
function claim(s: S, sc: 'full' | 'design' | 'build', x: PC, own: 'L' | 'H'): S {
  const st = sc === 'build' ? 'dd' : 'ds'
  const t: S = { ...s, ord: 'claimed', cs: sc, stage: st, pct: mx(s.pct, st), runner: x, rage: 0, hbph: 'work', hbage: 0,
    rw: false, pend: false, excl: own === 'L' ? null : s.excl }
  return setw(t, x, { w: { sc, step: 0, own }, wt: true, res: null })
}
function resumeVariants(s: S, x: PC, own: 'L' | 'H'): S[] {
  const ws = wscope(s)
  const steps: (0 | 1)[] = geIp(s.stage) && ws !== 'rework' ? [0, 1] : [0]
  const free = runnerFree(order(s), own === 'L' ? workerLabel(x) : humanLabel(x), NOW)
  return steps.map(step => free
    ? { ...setw(s, x, { w: { sc: ws, step, own }, wt: true, res: null }), runner: x, rage: 0 as const }  // P7
    : setw(s, x, { res: 'result' }))                                                                   // exit 12
}
function endWorker(t: S, x: PC, res: Res, own: 'L' | 'H', p: { wt?: boolean; excl?: 'temp' | 'perm' } = {}): S {
  let u = setw(t, x, { w: null, res, ...(p.wt !== undefined ? { wt: p.wt } : {}) })
  if (own === 'L' && p.excl !== undefined && x === LEAD) u = { ...u, excl: p.excl }
  return u
}

const VIOL: string[] = []
const viol = (kind: string, s: S, lbl: string) => { if (VIOL.length < 50) VIOL.push(`${kind} — ${lbl} | ${key(s)}`) }

function transitions(s: S): S[] {
  const out: S[] = []
  const add = (t: S | null) => { if (t !== null) out.push(norm(t)) }
  // ---- 사람(웹) ----
  add(s.tag ? cancel({ ...s, tag: false }) : issue({ ...s, tag: true }))
  if (s.dst === 'none' && s.ord !== 'claimed' && s.ord !== 'reported' && s.ord !== 'approved') {
    for (const m of ['auto', 'review', 'human'] as const) if (m !== s.mode) add({ ...s, mode: m })
  }
  const btn = designButtons(item(s), activeOf(s))
  if (btn.includes('accept')) add({ ...s, dst: 'accepted', cs: 'build' })
  if (btn.includes('confirm')) {
    const t: S = { ...s, stage: 'dd', dst: 'accepted', pct: mx(s.pct, 'dd') }
    add(t)
  }
  if (btn.includes('reopen')) add(reopen(s))
  if (s.ord === 'reported') {
    add({ ...s, ord: 'approved', stage: 'xx', pct: 100 })
    add({ ...s, ord: 'claimed', stage: 'ip', pct: CRED.rw, rw: true, hbph: 'work', hbage: 1, runner: null, rage: 0 })
  }
  if (s.ord === 'approved') {
    add({ ...s, ord: 'claimed', stage: 'ip', pct: CRED.rw, rw: true, hbph: 'work', hbage: 1, runner: null, rage: 0 })
    add({ ...s, ord: 'reported', stage: 'im', pct: 80 })
  }
  add({ ...s, hd: !s.hd })
  if (!s.tag && s.ord !== 'claimed' && s.ord !== 'reported') {  // 사람의 단계 지정(dd 는 없다)·수기 실적
    for (const st of ['as', 'ds', 'ip', 'im', 'xx']) add({ ...s, stage: st, pct: CRED[st] })
    if (s.pct !== 100) add({ ...s, pct: 100 })
  }
  // ---- 사람(CLI) ----
  if (s.ord === 'claimed' && canRelease({ stage: s.stage }, order(s)) === null) {
    add({ ...s, ord: 'ready', stage: 'as', pct: 0, cs: null, runner: null, rage: 0, hbph: null, hbage: 0, pend: false, rw: false, wA: null, wB: null })
  }
  const nlive = (s.wA !== null ? 1 : 0) + (s.wB !== null ? 1 : 0)
  for (const x of PCS) {
    if (w(s, x) !== null || nlive >= MAXW) continue
    if (s.ord === 'ready') {
      for (const sc of ['full', 'design', 'build'] as const) {
        if ((sc === 'design' || sc === 'full') && s.hd) continue   // 6.3·L5 claim 전 확인 → skipped
        if (sc === 'build' && !s.hd) continue
        if (canClaim(item(s), order(s).designState, sc, sc === 'full' && s.preds !== 'met') === null) add(claim(s, sc, x, 'H'))
      }
    } else if (s.ord === 'claimed' && mine(s, x, false)) {
      for (const t of resumeVariants(s, x, 'H')) add(t)
    }
  }
  if (s.ord === 'claimed') {
    for (const x of PCS) {
      if (!reportOk(s, humanLabel(x))) continue
      if (unapproved(s)) viol('I4 완료 보고(미승인 설계)', s, `수동 done@${x}`)
      if (s.wA?.step === 1 || s.wB?.step === 1) viol('I5 완료 보고(워커가 구현 중)', s, `수동 done@${x}`)
      add({ ...s, ord: 'reported', stage: 'im', pct: mx(s.pct, 'im'), runner: null, rage: 0, rw: false })
    }
  }
  // ---- 환경 ----
  for (const p of ['met', 'ok', 'no'] as const) if (p !== s.preds) add({ ...s, preds: p })
  if (s.ord === 'claimed') {
    const live = s.wA !== null || s.wB !== null
    if (!live && s.hbage === 0 && s.hbph !== null) add({ ...s, hbage: 1 })
    if (s.runner !== null && s.rage === 0 && w(s, s.runner) === null) add({ ...s, rage: 1, hbage: live ? s.hbage : 1 })
  }
  if (s.excl === 'temp') add({ ...s, excl: null })
  // ---- 팀장(PC A 고정) ----
  if (s.excl === null && w(s, LEAD) === null && nlive < MAXW) {
    const a = action(s)
    if (s.ord === 'ready' && (a === 'full' || a === 'design' || a === 'build') && mine(s, LEAD, true)) {
      if (a === 'build' && s.mode === 'human' && !s.hd) add(reopen(s))           // 6.2 띄우기 전 검사
      else if ((a === 'design' || a === 'full') && s.hd) add({ ...s, excl: 'temp' })  // 6.2·L5 사람 초안 → 멈춤(30분)
      else if (wt(s, LEAD)) add({ ...s, excl: 'perm' })                          // worktree add 실패
      else {
        const r = canClaim(item(s), order(s).designState, a, a === 'full' && s.preds !== 'met')
        if (r !== null) { viol('I1 claim 거부', s, `팀장 action=${a} → ${r.code}`); add({ ...s, excl: 'temp' }) }
        else add(claim(s, a, LEAD, 'L'))
      }
    } else if (s.ord === 'claimed' && mine(s, LEAD, true)) {
      if (a === 'skip') {
        const row2 = geIp(s.stage) || workerAlive(order(s), NOW)
        if (row2 && wt(s, LEAD) && resOf(s, LEAD) === 'diedL') for (const t of resumeVariants(s, LEAD, 'L')) add(t)
      } else if (a === 'full' || a === 'design' || a === 'build') {
        if (wscope(s) !== a) viol('I1 범위 불일치', s, `팀장 action=${a} 워커 ${wscope(s)}`)
        for (const t of resumeVariants(s, LEAD, 'L')) add(t)
      }
    }
  }
  if (s.pend && s.ord === 'claimed' && s.dst === 'none' && wt(s, LEAD) && w(s, LEAD) === null) {  // 6.3 끝나지 않은 멈춤 이어받기
    const t = designDone(s)
    if (t !== null) add(setw(t, LEAD, { wt: false }))
  }
  // ---- 워커 ----
  for (const x of PCS) {
    const wx = w(s, x)
    if (wx === null) continue
    const { sc, step, own } = wx
    if (s.ord === 'cancelled') { add(endWorker(s, x, 'result', own)); continue }                    // exit 10
    if (s.ord !== 'claimed') { add(endWorker(s, x, 'result', own, { wt: false })); continue }       // Y7
    add(endWorker(s, x, own === 'L' ? 'diedL' : 'diedH', own))                                        // 결과 없이 죽음
    if (!runnerFree(order(s), workerLabel(x), NOW)) { add(endWorker(s, x, 'result', own)); continue } // heartbeat 409 runner_active(Y1)
    if (sc === 'design') {
      if ((s.stage === 'ds' || s.stage === 'dd') && (s.dst === 'none' || s.dst === 'review')) {
        add(endWorker(designDone(s)!, x, 'result', own, { wt: false }))                                // 설계만 멈춤
        if (!s.pend) {
          add(endWorker(s, x, 'result', own, { excl: 'temp' }))                                        // push 실패 → skipped(Y11)
          add(endWorker({ ...s, pend: true }, x, 'result', own))                                       // design-done 네트워크 실패
        }
      }
      continue
    }
    if (step === 0) {
      if (sc === 'build' && s.stage === 'dd') {
        add(endWorker(s, x, 'result', own, { excl: 'temp' }))                                          // fetch 실패 → skipped(Y11)
        const ro = reopen(s)
        if (ro !== null && ((s.mode === 'human' && !s.hd) || (s.mode !== 'human' && s.dst === 'accepted'))) {
          add(endWorker(ro, x, 'result', own, { wt: false }))                                          // 게이트 불통·선행 계약 바뀜
        }
      }
      if ((sc === 'build' || sc === 'full' || sc === 'legacy') && geIp(s.stage)) add(endWorker(s, x, 'result', own, { excl: 'perm' }))
      const r = canBuildStart(item(s), order(s), sc, workerLabel(x), NOW)
      if (r === null) {
        let t: S = s
        if (s.stage === 'ds' || s.stage === 'dd') t = { ...t, stage: 'ip', pct: mx(s.pct, 'ip') }
        if (unapproved(s)) viol('I4 build-start 통과(미승인 설계)', s, `워커@${x} ${sc}`)
        if (w(s, other(x))?.step === 1) viol('I5 build-start 통과(다른 PC 워커가 구현 중)', s, `워커@${x} ${sc}`)
        add(setw({ ...t, runner: x, rage: 0 }, x, { w: { sc, step: 1, own } }))
      } else if (r.status === 403) add(endWorker(designDone(s) ?? s, x, 'result', own))              // 선행 대기 멈춤
      else add(endWorker(s, x, 'result', own, { excl: 'temp', wt: false }))                            // exit 11·12 → skipped
    } else {
      if (reportOk(s, workerLabel(x))) {
        if (unapproved(s)) viol('I4 완료 보고(미승인 설계)', s, `워커@${x} ${sc}`)
        if (w(s, other(x))?.step === 1) viol('I5 완료 보고(다른 PC 워커도 구현 중)', s, `워커@${x} ${sc}`)
        add(endWorker({ ...s, ord: 'reported', stage: 'im', pct: mx(s.pct, 'im'), runner: null, rage: 0, rw: false }, x, 'result', own))
      }
      add(endWorker(s, x, 'result', own, { excl: 'perm' }))                                            // 설계 변경 필요·게이트 불통
    }
  }
  return out
}

function explore() {
  const ids = new Map<string, number>()
  const states: S[] = []
  const succ: number[][] = []
  const intern = (s: S) => {
    const k = key(s)
    let id = ids.get(k)
    if (id === undefined) { id = states.length; ids.set(k, id); states.push(s); succ.push([]) }
    return id
  }
  for (const mode of ['auto', 'review', 'human'] as const) for (const ord of ['none', 'ready'] as const) {
    intern({ mode, tag: false, ord, dst: 'none', cs: null, stage: 'as', pct: 0, rw: false, hbph: null, hbage: 0, runner: null, rage: 0,
      preds: 'met', hd: false, wA: null, wB: null, wtA: false, wtB: false, resA: null, resB: null, excl: null, pend: false })
  }
  for (let h = 0; h < states.length; h++) {
    const arr = succ[h]
    for (const t of transitions(states[h])) arr.push(intern(t))
  }
  return { states, succ }
}

/** ① 도달 상태마다 판단(action·mine)이 낸 범위를 관문이 받아 주는가(스펙 5.1 ①). */
function staticChecks(states: readonly S[]): string[] {
  const bad: string[] = []
  for (const s of states) {
    const a = action(s)
    if (a !== 'full' && a !== 'design' && a !== 'build') continue
    for (const x of PCS) {
      if (!mine(s, x, true)) continue
      if (s.ord === 'ready') {
        if ((a === 'build' && s.mode === 'human' && !s.hd) || ((a === 'design' || a === 'full') && s.hd)) continue
        const r = canClaim(item(s), order(s).designState, a, a === 'full' && s.preds !== 'met')
        if (r !== null) bad.push(`ready action=${a} → claim ${r.code} | ${key(s)}`)
      } else if (s.ord === 'claimed') {
        const ws = wscope(s)
        if (ws !== a) { bad.push(`claimed action=${a} ≠ 워커 범위 ${ws} | ${key(s)}`); continue }
        if (ws === 'design') { if (s.stage !== 'ds' && s.stage !== 'dd') bad.push(`claimed design 단계 ${s.stage} | ${key(s)}`); continue }
        const r = canBuildStart(item(s), order(s), ws, workerLabel(x), NOW)
        if (r !== null && !(r.status === 403 && a === 'full')) bad.push(`claimed action=${a} → build-start ${r.code} | ${key(s)}`)
      }
    }
  }
  return bad
}

/** ② 앞으로 갈 길 — 모든 전이를 허용했을 때 완료(approved)로 가지 못하는 상태(표식 없는 빈·취소 상태는 뺀다). */
function cannotFinish(states: readonly S[], succ: readonly number[][]): S[] {
  const n = states.length
  const start = new Int32Array(n + 1)
  for (const arr of succ) for (const t of arr) start[t + 1]++
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const rev = new Int32Array(start[n])
  const fill = start.slice(0, n)
  for (let u = 0; u < n; u++) for (const t of succ[u]) rev[fill[t]++] = u
  const seen = new Uint8Array(n)
  const q: number[] = []
  for (let i = 0; i < n; i++) if (states[i].ord === 'approved') { seen[i] = 1; q.push(i) }
  for (let h = 0; h < q.length; h++) {
    const t = q[h]
    for (let j = start[t]; j < start[t + 1]; j++) { const u = rev[j]; if (!seen[u]) { seen[u] = 1; q.push(u) } }
  }
  return states.filter((s, i) => !seen[i] && !((s.ord === 'none' || s.ord === 'cancelled') && !s.tag))
}

/** ③ 화면 판정 탐침 — 6차 검토가 찾은 "화면 문구가 사실과 다른 도달 상태" 중 12절이 고친 넷. */
function screenProbes(states: readonly S[]): string[] {
  const bad: string[] = []
  for (const s of states) {
    const row = designScreen({ item: item(s), active: activeOf(s), lastReview: s.rw ? 'reject' : null, nowMs: NOW })?.row ?? 0
    const live = s.wA !== null || s.wB !== null
    const progressed = geIp(s.stage) || s.pct >= 100
    if (s.ord === 'ready' && s.tag && progressed && row === 0) bad.push(`8행 없음(진행된 항목의 ready) | ${key(s)}`)
    if (s.ord === 'claimed' && s.stage === 'ds' && s.dst === 'none' && s.preds === 'no' && !live && s.hbage === 1 && row !== 12) {
      bad.push(`L14 「선행 대기(설계 중 멈춤)」 없음 | ${key(s)}`)
    }
    if (row === 5 && live) bad.push(`L2 재작업 워커가 도는데 「재작업 대기」 | ${key(s)}`)
    if (row === 7 && s.tag && progressed) bad.push(`7행 「위임 안 됨」인데 표식·진행됨 | ${key(s)}`)
  }
  return bad
}

describe('설계 상태 모델 — 도달 상태 전수(스펙 5.1)', () => {
  it('판단↔관문 0 · 미승인 구현 0 · 두 구현자 0 · 완료로 가는 길 · 화면 문구', () => {
    const { states, succ } = explore()
    expect(states.length).toBeGreaterThan(100_000)
    expect(VIOL.slice(0, 5)).toEqual([])
    expect(staticChecks(states).slice(0, 5)).toEqual([])
    expect(cannotFinish(states, succ).slice(0, 5).map(key)).toEqual([])
    expect(screenProbes(states).slice(0, 5)).toEqual([])
    expect(states.filter(s => s.ord === 'claimed' && s.wA?.step === 1 && s.wB?.step === 1).length).toBe(0)
  }, 300_000)
})
