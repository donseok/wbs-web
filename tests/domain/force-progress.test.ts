// 강제 진행(스펙 2026-09-23) 순수 판정 — 스텁 잔존(F6·F13)·하위 ref(§3.5)·계약(F4)·면제 가능·병목(F14).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOTTLENECK, STUB_DONE_STAGE, WAIVE_BLOCK_TEXT, blockedSinceMs, bottleneckText, findBottlenecks, hasContract,
  isStubRow, lastRefSegment, pendingStubs, stubBadgeText, stubLabel, stubPendingByItem, stubPendingLock, stubTaskName, stubTaskRef,
  validateBottleneckSettings, waiveBlock,
} from '@/lib/domain/forceProgress'

const sub = (id: string, stubFor: string, stage: string | null) => ({ id, stubFor, externalRef: `m/TSK-02.stub.${lastRefSegment(stubFor)}`, stage })

describe('스텁 잔존 — 승인 잠금과 표시가 같은 함수', () => {
  it('xx 가 아닌 stub 하위가 있으면 잔존이다', () => {
    expect(STUB_DONE_STAGE).toBe('xx')
    const subs = [sub('s1', 'm/TSK-01', 'ip'), sub('s2', 'm/TSK-03', 'xx'), sub('s3', 'm/TSK-04', null)]
    expect(pendingStubs(subs).map(s => s.id)).toEqual(['s1', 's3'])
    expect(stubPendingLock(subs)).toBe(true)
    expect(stubPendingLock([sub('s2', 'm/TSK-03', 'xx')])).toBe(false)
    expect(stubPendingLock([])).toBe(false)
  })
  it('문구·배지·ref·이름', () => {
    expect(stubLabel('mdm/TSK-03-01')).toBe('스텁 잔존: TSK-03-01 대체')
    expect(stubBadgeText(1)).toBe('스텁 잔존')
    expect(stubBadgeText(2)).toBe('스텁 잔존 2')
    expect(stubTaskRef('mdm/TSK-03-02', 'mdm/TSK-03-01')).toBe('mdm/TSK-03-02.stub.TSK-03-01')
    expect(stubTaskName({ code: 'TSK-03-01', name: '주문 서비스' })).toBe('스텁 제거·실연결: TSK-03-01 주문 서비스')
  })
  it('stub_for 로 행을 판별한다(레벨·이름이 아니다)', () => {
    expect(isStubRow({ stub_for: 'm/TSK-01' })).toBe(true)
    expect(isStubRow({ stub_for: null })).toBe(false)
    expect(isStubRow({})).toBe(false)
  })
  it('하위 ref 의 마지막 칸은 dflow.sh 작업 폴더 규칙([A-Za-z0-9._-])을 통과한다', () => {
    expect(lastRefSegment(stubTaskRef('mdm/TSK-03-02', 'core/TSK-01-01'))).toMatch(/^[A-Za-z0-9._-]+$/)
  })
})

describe('계약(F4)과 면제 가능 판정', () => {
  it('spec 본문 또는 acceptance 1건 이상이 계약이다', () => {
    expect(hasContract({ spec: '## API\n...', acceptance: [] })).toBe(true)
    expect(hasContract({ spec: '  ', acceptance: ['응답 200'] })).toBe(true)
    expect(hasContract({ spec: null, acceptance: [] })).toBe(false)
    expect(hasContract({ spec: '', acceptance: null })).toBe(false)
  })
  const succ = { externalRef: 'm/TSK-02', depends: ['m/TSK-01'], dependsWaived: [], stubFor: null, hasNormalChildren: false }
  const pred = { stage: 'ip', orderApproved: false, actualPct: 30, spec: '계약', acceptance: [] }
  it('정상 경우는 null', () => {
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred })).toBeNull()
  })
  it('차단 사유를 우선순위대로 돌려준다', () => {
    expect(waiveBlock({ successor: { ...succ, stubFor: 'm/X' }, predRef: 'm/TSK-01', pred })).toBe('is_stub_task')
    expect(waiveBlock({ successor: { ...succ, hasNormalChildren: true }, predRef: 'm/TSK-01', pred })).toBe('not_leaf')
    expect(waiveBlock({ successor: { ...succ, externalRef: null }, predRef: 'm/TSK-01', pred })).toBe('no_ref')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-09', pred })).toBe('not_in_depends')
    expect(waiveBlock({ successor: { ...succ, dependsWaived: ['m/TSK-01'] }, predRef: 'm/TSK-01', pred })).toBe('already_waived')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...pred, stage: 'im' } })).toBe('already_reached')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...pred, spec: null } })).toBe('no_contract')
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: null })).toBe('no_contract')
    expect(WAIVE_BLOCK_TEXT.no_contract).toBe('선행 계약 없음')
  })
  it('로더가 계산한 hasContract 가 있으면 그것을 쓴다(spec 본문을 클라이언트로 보내지 않는 경로)', () => {
    const lite = { stage: 'ip', orderApproved: false, actualPct: 30 }
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...lite, hasContract: true } })).toBeNull()
    expect(waiveBlock({ successor: succ, predRef: 'm/TSK-01', pred: { ...lite, hasContract: false } })).toBe('no_contract')
  })
})

describe('병목(F14)', () => {
  const H = 3600_000
  it('기본값은 3건·4시간', () => {
    expect(DEFAULT_BOTTLENECK).toEqual({ minSuccessors: 3, minHours: 4 })
  })
  it('막힌 시각 = max(주문 updated_at, 계획 시작일 00:00 KST)', () => {
    expect(blockedSinceMs('2026-09-20T00:00:00Z', null)).toBe(Date.parse('2026-09-20T00:00:00Z'))
    expect(blockedSinceMs('2026-09-20T00:00:00Z', '2026-09-22')).toBe(Date.parse('2026-09-22T00:00:00+09:00'))
  })
  it('한 선행이 N건 이상을 T시간 넘게 막을 때만 제안한다 — T 는 가장 오래 막힌 후속 기준', () => {
    const now = Date.parse('2026-09-23T12:00:00Z')
    const blocked = [
      { itemId: 'a', unmetRefs: ['m/P1'], blockedSinceMs: now - 6 * H },
      { itemId: 'b', unmetRefs: ['m/P1'], blockedSinceMs: now - 1 * H },
      { itemId: 'c', unmetRefs: ['m/P1', 'm/P2'], blockedSinceMs: now - 1 * H },
      { itemId: 'd', unmetRefs: ['m/P2'], blockedSinceMs: now - 9 * H },
    ]
    const r = findBottlenecks(blocked, now, DEFAULT_BOTTLENECK)
    expect(r).toEqual([{ predRef: 'm/P1', successorIds: ['a', 'b', 'c'], hours: 6 }])
    expect(bottleneckText(r[0], 'TSK-03-01')).toBe('선행 TSK-03-01 이 후속 3건을 막고 있습니다(6시간째)')
    expect(findBottlenecks(blocked, now, { minSuccessors: 3, minHours: 7 })).toEqual([])
  })
  it('설정 검증 — 1 이상 정수', () => {
    expect(validateBottleneckSettings({ minSuccessors: 2, minHours: 8 })).toEqual({ ok: true, value: { minSuccessors: 2, minHours: 8 } })
    expect(validateBottleneckSettings({ minSuccessors: 0, minHours: 8 }).ok).toBe(false)
    expect(validateBottleneckSettings({ minSuccessors: 2.5, minHours: 8 }).ok).toBe(false)
    expect(validateBottleneckSettings(null).ok).toBe(false)
  })
})

describe('stubPendingByItem — raw 행에서 부모별 잔존 목록', () => {
  it('xx 가 아닌 stub 하위만 부모 id 로 묶는다', () => {
    const m = stubPendingByItem([
      { id: 'succ', parent_id: 'wp' },
      { id: 's1', parent_id: 'succ', stub_for: 'm/TSK-01', stage: 'ip' },
      { id: 's2', parent_id: 'succ', stub_for: 'm/TSK-02', stage: 'xx' },
      { id: 'c', parent_id: 'succ', stage: 'ip' },
    ])
    expect(m.get('succ')).toEqual([{ subTaskId: 's1', label: '스텁 잔존: TSK-01 대체' }])
    expect(m.has('wp')).toBe(false)
  })
})
