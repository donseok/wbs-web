// tests/domain/wait-reason.test.ts
import { describe, expect, it } from 'vitest'
import { deriveWaitReason, STAGE_LABEL, stageText, unmetDepends, unmetDependsList, type PredecessorLike, type WatcherLike } from '@/lib/domain/waitReason'

const pred = (over: Partial<PredecessorLike> = {}): PredecessorLike => ({ external_ref: 'M/T1', code: 'TSK-04-01', name: '목록', stage: 'fp', order_approved: false, ...over })
const lookup = (rows: PredecessorLike[]) => (ref: string) => rows.find(r => r.external_ref === ref)
const watcher = (over: Partial<WatcherLike> = {}): WatcherLike => ({ agent: 'hong/mbp', user_id: 'u1', slots: 2, busy: 0, until_label: null, ...over })
const base = { depends: null, predecessorByRef: lookup([]), assignee: null, watchers: [watcher()] }

describe('stageText · STAGE_LABEL', () => {
  it('코드와 한글 라벨을 같이 쓴다. 모르는 코드는 코드만, null 은 "단계 없음"', () => {
    expect(STAGE_LABEL.im).toBe('구현')
    expect(stageText('fp')).toBe('fp(기능 계획)')
    expect(stageText('zz')).toBe('zz')
    expect(stageText(null)).toBe('단계 없음')
  })
})

describe('unmetDepends — 클레임 API dependency_not_met 와 같은 축', () => {
  it('im 이상이거나 승인된 주문이 있으면 충족, 아니면 미충족. 프로젝트에 없는 ref 도 미충족(fail-closed)', () => {
    const rows = [pred(), pred({ external_ref: 'M/T2', code: 'TSK-04-02', stage: 'im' }), pred({ external_ref: 'M/T3', code: 'TSK-04-03', stage: 'as', order_approved: true })]
    const u = unmetDepends(['M/T1', 'M/T2', 'M/T3', 'M/T9'], lookup(rows))
    expect(u.map(x => x.ref)).toEqual(['M/T1', 'M/T9'])
    expect(u[0]).toMatchObject({ found: true, code: 'TSK-04-01', name: '목록', stage: 'fp' })
    expect(u[1]).toMatchObject({ found: false })
  })
  it('depends 가 null·빈 배열이면 빈 목록', () => {
    expect(unmetDepends(null, lookup([]))).toEqual([])
    expect(unmetDepends([], lookup([]))).toEqual([])
  })
  it('목록 문구: 코드 이름(현재 단계) · 없는 항목은 ref(프로젝트에 없는 항목)', () => {
    const u = unmetDepends(['M/T1', 'M/T9'], lookup([pred()]))
    expect(unmetDependsList(u)).toBe('TSK-04-01 목록(현재 fp(기능 계획)), M/T9(프로젝트에 없는 항목)')
  })
})

describe('deriveWaitReason — 첫 일치 하나, 순서 선행 → 에이전트 꺼짐 → 바쁨 → 착수 대기', () => {
  it('선행 미충족이면 감시자가 있어도 dependency', () => {
    const r = deriveWaitReason({ ...base, depends: ['M/T1'], predecessorByRef: lookup([pred()]) })
    expect(r.kind).toBe('dependency'); expect(r.label).toBe('선행 대기')
    expect(r.text).toBe('선행 작업이 아직 끝나지 않았습니다: TSK-04-01 목록(현재 fp(기능 계획)). 선행이 im(구현) 단계 이상이 되거나 그 주문이 승인돼야 이 작업을 집어갈 수 있습니다.')
  })
  it('담당자 없음 + 감시자 0 → agent_off, 누구든 켜라는 문구', () => {
    const r = deriveWaitReason({ ...base, watchers: [] })
    expect(r.kind).toBe('agent_off'); expect(r.label).toBe('에이전트 꺼짐')
    expect(r.text).toBe('이 프로젝트를 보는 에이전트가 하나도 없습니다. 위임은 됐지만 집어갈 주체가 없어 대기 중입니다. 프로젝트 멤버 누구든 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜면 시작됩니다.')
  })
  it('담당자 있음 + 담당자 계정의 감시자 없음 → agent_off, 담당자 이름과 다른 사람 에이전트 수를 말한다', () => {
    const r = deriveWaitReason({ ...base, assignee: { name: '홍길동', user_id: 'u7' }, watchers: [watcher(), watcher({ agent: 'kim/pc', user_id: 'u2' })] })
    expect(r.kind).toBe('agent_off')
    expect(r.text).toBe('담당자 홍길동 의 에이전트가 켜져 있지 않습니다. 이 작업은 담당자가 지정돼 있어 홍길동 의 에이전트만 집어갈 수 있습니다. 홍길동 이(가) 자기 PC 에서 /dflow-team 또는 /dflow-poll 을 켜야 시작됩니다. 지금 켜진 에이전트 2개(hong/mbp, kim/pc)는 다른 사람 것이라 이 작업을 집어갈 수 없습니다.')
  })
  it('담당자 있음 + 감시자 0 → 다른 사람 문장은 붙지 않는다', () => {
    const r = deriveWaitReason({ ...base, assignee: { name: '홍길동', user_id: 'u7' }, watchers: [] })
    expect(r.text.endsWith('/dflow-poll 을 켜야 시작됩니다.')).toBe(true)
  })
  it('담당자 로스터 행에 user_id 가 없으면 어느 에이전트도 못 집는다고 덧붙인다', () => {
    const r = deriveWaitReason({ ...base, assignee: { name: '홍길동', user_id: null }, watchers: [watcher()] })
    expect(r.kind).toBe('agent_off')
    expect(r.text).toContain('담당자 계정이 로스터에 연결돼 있지 않아 어느 에이전트도 집어갈 수 없습니다. 멤버 화면에서 계정을 연결하세요.')
  })
  it('담당자 있음 + 담당자 계정의 감시자 있음 → agent_off 아님(pickup)', () => {
    const r = deriveWaitReason({ ...base, assignee: { name: '홍길동', user_id: 'u1' } })
    expect(r.kind).toBe('pickup')
  })
  it('자격 있는 감시자가 전부 busy ≥ slots → agents_busy, 누가 언제까지 바쁜지', () => {
    const r = deriveWaitReason({ ...base, watchers: [watcher({ slots: 2, busy: 2, until_label: '15:30' }), watcher({ agent: 'kim/pc', user_id: 'u2', slots: 1, busy: 1 })] })
    expect(r.kind).toBe('agents_busy'); expect(r.label).toBe('에이전트 바쁨')
    expect(r.text).toBe('에이전트 2개가 켜져 있지만 모두 다른 작업 중입니다(hong/mbp 2/2 ~15:30, kim/pc 1/1). 자리가 비면 다음 확인 주기에 자동으로 집어갑니다.')
  })
  it('slots 를 모르는(null) 감시자는 바쁘지 않다고 본다 → pickup', () => {
    const r = deriveWaitReason({ ...base, watchers: [watcher({ slots: null, busy: null })] })
    expect(r.kind).toBe('pickup'); expect(r.label).toBe('착수 대기')
    expect(r.text).toBe('집어갈 수 있는 에이전트가 있습니다(hong/mbp). 다음 확인 주기에 착수합니다. 이 상태가 오래 가면 그 에이전트의 로그를 확인하세요.')
  })
  it('pickup 목록에는 여유 있는 에이전트만 든다', () => {
    const r = deriveWaitReason({ ...base, watchers: [watcher({ slots: 1, busy: 1 }), watcher({ agent: 'kim/pc', user_id: 'u2', slots: 3, busy: 1 })] })
    expect(r.kind).toBe('pickup'); expect(r.text).toContain('(kim/pc)')
  })
})
