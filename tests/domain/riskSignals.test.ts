import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import type { SnapshotPoint } from '@/lib/domain/trend'
import {
  detectRiskSignals, riskFingerprint,
  OVERLOAD_ACTIVE_MIN, STALE_ACTION_DAYS,
  type MinuteActionSignal, type RiskSignalInput, type RiskSignalReport,
} from '@/lib/domain/riskSignals'

/* ── 픽스처 — dashboard.test.ts leaf 관례 + 지문 검증을 위한 결정적 id ── */
let seq = 0
const leaf = (over: Partial<ComputedItem> = {}): ComputedItem => ({
  id: `L${seq++}`, parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], plannedPct: 0, rolledActualPct: 0,
  achievement: null, status: 'in_progress', children: [], ...over,
})
const snap = (date: string, actual: number, planned: number): SnapshotPoint => ({ date, actual, planned })
const msig = (over: Partial<MinuteActionSignal> = {}): MinuteActionSignal => ({
  id: 'i1', minuteId: 'm1', bodyHash: 'bh', kind: 'action', label: '액션 항목',
  blockIndex: 2, blockHash: 'blk', minuteTitle: '주간회의', minuteDate: '2026-07-01', ...over,
})

const TODAY = '2026-07-15'
const input = (over: Partial<RiskSignalInput> = {}): RiskSignalInput => ({
  items: [], today: TODAY, realToday: TODAY, snapshots: [],
  startDate: null, endDate: null, minuteSignals: [], ...over,
})
const run = (over: Partial<RiskSignalInput> = {}) => detectRiskSignals(input(over))
const find = (r: RiskSignalReport, kind: string) => r.signals.find(s => s.kind === kind)

/* ═══ ① delay_trend — SPI 꼬리 3점 연속 하락 + 현재 < 0.9 ═══ */
describe('delay_trend', () => {
  // 0.95 → 0.92 → 0.85
  const falling = [snap('2026-07-01', 38, 40), snap('2026-07-05', 46, 50), snap('2026-07-10', 51, 60)]

  it('연속 하락 + SPI<0.9 → red 발화, spiPct 정수화', () => {
    const s = find(run({ snapshots: falling }), 'delay_trend')!
    expect(s.severity).toBe('red')
    expect(s.metrics.spiPct).toBe(85)
    expect(s.evidence).toEqual([])   // 프로젝트 수준 지표 — 항목 근거 없음
  })
  it('경계: 현재 SPI 정확히 0.90 → 비발화 (SpiPanel delayed 경계 미러)', () => {
    const snaps = [snap('2026-07-01', 38, 40), snap('2026-07-05', 46, 50), snap('2026-07-10', 54, 60)] // 0.9
    expect(find(run({ snapshots: snaps }), 'delay_trend')).toBeUndefined()
  })
  it('비단조(중간 반등) → 현재<0.9여도 비발화', () => {
    const snaps = [snap('2026-07-01', 38, 40), snap('2026-07-05', 34, 40), snap('2026-07-10', 44, 50)] // 0.95, 0.85, 0.88
    expect(find(run({ snapshots: snaps }), 'delay_trend')).toBeUndefined()
  })
  it('표본 2점 이하 → 비발화', () => {
    expect(find(run({ snapshots: falling.slice(1) }), 'delay_trend')).toBeUndefined()
  })
  it('planned<5 시점은 시계열에서 제외(trend.ts 가드 미러) — 가드 통과분 3점이면 발화', () => {
    const snaps = [snap('2026-06-20', 2, 3), ...falling] // 첫 점은 가드 제외 → 꼬리는 falling 3점
    expect(find(run({ snapshots: snaps }), 'delay_trend')).toBeDefined()
    const short = [snap('2026-06-20', 2, 3), ...falling.slice(1)] // 가드 제외 후 2점 → 비발화
    expect(find(run({ snapshots: short }), 'delay_trend')).toBeUndefined()
  })
  it("이원화: WBS 신호는 today(base_date) 기준 — today 이후 스냅샷은 realToday 이전이라도 제외", () => {
    // today=07-08이면 07-10 스냅샷 제외 → 2점뿐 → 비발화 (realToday=07-15는 무관)
    expect(find(run({ snapshots: falling, today: '2026-07-08', realToday: TODAY }), 'delay_trend')).toBeUndefined()
  })

  /* trendSparse — 캐비앗 판정도 신호와 같은 시계열을 봐야 한다(카드-엔진 모순 차단) */
  it('trendSparse: 유효 표본 3점 이상이면 false, 미만이면 true', () => {
    expect(run({ snapshots: falling }).trendSparse).toBe(false)
    expect(run({ snapshots: falling.slice(1) }).trendSparse).toBe(true)
    expect(run().trendSparse).toBe(true)  // 스냅샷 전무
  })
  it('trendSparse: planned<5 가드로 제외된 표본은 세지 않는다 — 신호 판정과 동일 표본', () => {
    // 원시 3점이지만 가드 통과는 2점 → sparse(신호도 같은 이유로 비발화)
    const r = run({ snapshots: [snap('2026-06-20', 2, 3), ...falling.slice(1)] })
    expect(r.trendSparse).toBe(true)
    expect(find(r, 'delay_trend')).toBeUndefined()
  })
  it('trendSparse: today 이후 스냅샷 제외 후 판정 — 표본 충분이었다가 부족해지면 true', () => {
    expect(run({ snapshots: falling, today: '2026-07-08' }).trendSparse).toBe(true)
  })
})

/* ═══ ② deadline_stall — 7일 내 마감 + 계획 대비 갭>0 ═══ */
describe('deadline_stall', () => {
  it('갭 5%p → amber, evidence는 wbs_item 참조', () => {
    const items = [leaf({ id: 'a', name: '설계검토', plannedEnd: '2026-07-18', plannedPct: 40, rolledActualPct: 35 })]
    const s = find(run({ items }), 'deadline_stall')!
    expect(s.severity).toBe('amber')
    expect(s.metrics.count).toBe(1)
    expect(s.evidence).toEqual([{ type: 'wbs_item', itemId: 'a', label: '설계검토' }])
  })
  it('경계: 갭 10%p → amber, 11%p → red (progressSignal 경계 재사용)', () => {
    const at = (gap: number) =>
      find(run({ items: [leaf({ plannedEnd: '2026-07-18', plannedPct: 50 + gap, rolledActualPct: 50 })] }), 'deadline_stall')!
    expect(at(10).severity).toBe('amber')
    expect(at(11).severity).toBe('red')
  })
  it('갭≤0(계획 수준 도달) → 비발화', () => {
    const items = [leaf({ plannedEnd: '2026-07-18', plannedPct: 40, rolledActualPct: 40 })]
    expect(find(run({ items }), 'deadline_stall')).toBeUndefined()
  })
  it('FP 노이즈 갭(1e-10)은 round1로 0 처리 → 비발화', () => {
    const items = [leaf({ plannedEnd: '2026-07-18', plannedPct: 50.0000000001, rolledActualPct: 50 })]
    expect(find(run({ items }), 'deadline_stall')).toBeUndefined()
  })
  it('마감이 7일 밖이면 비발화 (dueSoonLeaves 위임)', () => {
    const items = [leaf({ plannedEnd: '2026-07-27', plannedPct: 50, rolledActualPct: 10 })]
    expect(find(run({ items }), 'deadline_stall')).toBeUndefined()
  })
})

/* ═══ ③ owner_overload — 팀별 지연 집중 / 활성 편중 ═══ */
describe('owner_overload', () => {
  const owned = (team: 'PMO' | 'ERP' | 'MES' | '가공', over: Partial<ComputedItem> = {}) =>
    leaf({ owners: [{ team, kind: 'primary' }], ...over })

  it('한 팀 지연 3건 집중 → amber, 4건 → red (riskModel red 경계 미러)', () => {
    const balanced = [...Array.from({ length: 3 }, () => owned('PMO')), ...Array.from({ length: 3 }, () => owned('MES'))]
    const r3 = run({ items: [...Array.from({ length: 3 }, () => owned('ERP', { status: 'delayed' })), ...balanced] })
    const s3 = find(r3, 'owner_overload')!
    expect(s3.id).toBe('owner_overload:ERP')
    expect(s3.severity).toBe('amber')
    expect(s3.metrics.delayedCount).toBe(3)

    const balanced4 = [...Array.from({ length: 4 }, () => owned('PMO')), ...Array.from({ length: 4 }, () => owned('MES'))]
    const r4 = run({ items: [...Array.from({ length: 4 }, () => owned('ERP', { status: 'delayed' })), ...balanced4] })
    expect(find(r4, 'owner_overload')!.severity).toBe('red')
  })
  it('지연 2건 + 균형 잡힌 활성 → 비발화', () => {
    const items = [
      ...Array.from({ length: 2 }, () => owned('ERP', { status: 'delayed' })),
      ...Array.from({ length: 2 }, () => owned('PMO')),
      ...Array.from({ length: 2 }, () => owned('MES')),
    ]
    expect(find(run({ items }), 'owner_overload')).toBeUndefined()
  })
  it('활성 리프 = 배정 팀 평균 × 2 경계에서 발화, 그 미만은 비발화', () => {
    // ERP 8 / PMO 2 / MES 2 → 평균 4, 임계 8 → ERP 발화(지연 0 → amber)
    const fire = [
      ...Array.from({ length: 8 }, () => owned('ERP')),
      ...Array.from({ length: 2 }, () => owned('PMO')),
      ...Array.from({ length: 2 }, () => owned('MES')),
    ]
    const s = find(run({ items: fire }), 'owner_overload')!
    expect(s.id).toBe('owner_overload:ERP')
    expect(s.severity).toBe('amber')
    expect(s.metrics.activeCount).toBe(8)
    // ERP 7 / PMO 2 / MES 2 → 평균 3.67, 임계 7.33 → 비발화
    const noFire = [
      ...Array.from({ length: 7 }, () => owned('ERP')),
      ...Array.from({ length: 2 }, () => owned('PMO')),
      ...Array.from({ length: 2 }, () => owned('MES')),
    ]
    expect(find(run({ items: noFire }), 'owner_overload')).toBeUndefined()
  })
  it(`표본 바닥: 활성 ${OVERLOAD_ACTIVE_MIN}건 미만이면 비율을 충족해도 비발화`, () => {
    // ERP 3 활성 vs PMO 1건 완료 → 평균 1.5, 임계 3 충족하지만 바닥(4) 미달
    const small = [
      ...Array.from({ length: 3 }, () => owned('ERP')),
      owned('PMO', { status: 'done' }),
    ]
    expect(find(run({ items: small }), 'owner_overload')).toBeUndefined()
    // ERP 4 활성 vs PMO 2건 완료 → 평균 2, 임계 4 = 바닥 4 → 발화
    const enough = [
      ...Array.from({ length: 4 }, () => owned('ERP')),
      ...Array.from({ length: 2 }, () => owned('PMO', { status: 'done' })),
    ]
    expect(find(run({ items: enough }), 'owner_overload')).toBeDefined()
  })
  it('support 소유도 집계(teamProgress 소유 판정과 동일)', () => {
    const items = [
      ...Array.from({ length: 3 }, () => leaf({ owners: [{ team: 'ERP', kind: 'support' }], status: 'delayed' })),
      ...Array.from({ length: 3 }, () => owned('PMO')),
      ...Array.from({ length: 3 }, () => owned('MES')),
    ]
    expect(find(run({ items }), 'owner_overload')!.id).toBe('owner_overload:ERP')
  })
})

/* ═══ ④ overdue_accumulation — delayAging 경계 그대로 ═══ */
describe('overdue_accumulation', () => {
  it('경과 1건(3일) → amber', () => {
    const s = find(run({ items: [leaf({ plannedEnd: '2026-07-12' })] }), 'overdue_accumulation')!
    expect(s.severity).toBe('amber')
    expect(s.metrics.total).toBe(1)
  })
  it('경계: 경과 14일 → amber(d8_14), 15일 → red(d15plus)', () => {
    const r14 = find(run({ items: [leaf({ plannedEnd: '2026-07-01' })] }), 'overdue_accumulation')!
    expect(r14.metrics.d8_14).toBe(1)
    expect(r14.severity).toBe('amber')
    const r15 = find(run({ items: [leaf({ plannedEnd: '2026-06-30' })] }), 'overdue_accumulation')!
    expect(r15.metrics.d15plus).toBe(1)
    expect(r15.severity).toBe('red')
  })
  it('경과 4건이면 전부 단기라도 red (riskModel 경계 미러)', () => {
    const items = Array.from({ length: 4 }, () => leaf({ plannedEnd: '2026-07-13' }))
    expect(find(run({ items }), 'overdue_accumulation')!.severity).toBe('red')
  })
  it('done·마감 전이면 비발화, evidence는 경과일 내림차순', () => {
    const items = [
      leaf({ id: 'new', name: '최근경과', plannedEnd: '2026-07-13' }),
      leaf({ id: 'old', name: '장기경과', plannedEnd: '2026-06-01' }),
      leaf({ plannedEnd: '2026-07-01', status: 'done' }),
      leaf({ plannedEnd: '2026-07-30' }),
    ]
    const s = find(run({ items }), 'overdue_accumulation')!
    expect(s.metrics.total).toBe(2)
    expect(s.evidence.map(e => e.itemId)).toEqual(['old', 'new'])
  })
})

/* ═══ ⑤ meeting_action_stale — realToday 기준 7일 경과 ═══ */
describe('meeting_action_stale', () => {
  it(`경계: ${STALE_ACTION_DAYS}일 경과 → 발화(amber), 6일 → 비발화`, () => {
    const at7 = run({ minuteSignals: [msig({ minuteDate: '2026-07-08' })] })
    const s = find(at7, 'meeting_action_stale')!
    expect(s.severity).toBe('amber')
    expect(s.metrics.count).toBe(1)
    const at6 = run({ minuteSignals: [msig({ minuteDate: '2026-07-09' })] })
    expect(find(at6, 'meeting_action_stale')).toBeUndefined()
  })
  it('kind가 action·deadline만 대상 — decision·risk·none은 오래돼도 제외', () => {
    const r = run({
      minuteSignals: [
        msig({ id: 'd1', kind: 'decision', minuteDate: '2026-06-01' }),
        msig({ id: 'r1', kind: 'risk', minuteDate: '2026-06-01' }),
        msig({ id: 'n1', kind: 'none', minuteDate: '2026-06-01' }),
      ],
    })
    expect(find(r, 'meeting_action_stale')).toBeUndefined()
  })
  it('evidence는 minute_block 참조(원문 앵커 정합)', () => {
    const r = run({ minuteSignals: [msig({ minuteId: 'm9', blockIndex: 4, blockHash: 'h4', label: '견적 회신', minuteDate: '2026-07-01' })] })
    expect(find(r, 'meeting_action_stale')!.evidence).toEqual([
      { type: 'minute_block', minuteId: 'm9', blockIndex: 4, blockHash: 'h4', label: '견적 회신' },
    ])
  })
  it('이원화: 경과일은 realToday 기준 — base_date(today)가 과거여도 왜곡되지 않는다', () => {
    // today=06-01(base_date)라면 41일 경과로 오발화했을 상황 — realToday 기준 3일이라 비발화
    const fresh = run({ today: '2026-06-01', realToday: TODAY, minuteSignals: [msig({ minuteDate: '2026-07-12' })] })
    expect(find(fresh, 'meeting_action_stale')).toBeUndefined()
    // realToday 기준 14일 경과 → 발화 (today와 무관)
    const stale = run({ today: '2026-06-01', realToday: TODAY, minuteSignals: [msig({ minuteDate: '2026-07-01' })] })
    expect(find(stale, 'meeting_action_stale')).toBeDefined()
  })
})

/* ═══ 종합 리포트 — overall worst-of + hygiene 패스스루 ═══ */
describe('RiskSignalReport 종합', () => {
  it('신호 0건 → signals [], overall green, 지문은 빈 상태에서도 안정', () => {
    const a = run(); const b = run()
    expect(a.signals).toEqual([])
    expect(a.overall).toBe('green')
    expect(a.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(a.fingerprint).toBe(b.fingerprint)
  })
  it('amber·red 혼재 → overall red (overallSignal worst-of)', () => {
    const r = run({
      items: [leaf({ plannedEnd: '2026-07-12' })],                       // overdue 1건 → amber
      minuteSignals: [msig({ minuteDate: '2026-07-01' })],               // stale → amber
      snapshots: [snap('2026-07-01', 38, 40), snap('2026-07-05', 46, 50), snap('2026-07-10', 51, 60)], // → red
    })
    expect(r.signals.length).toBe(3)
    expect(r.overall).toBe('red')
  })
  it('amber만 → overall amber, today는 입력 그대로 유지', () => {
    const r = run({ items: [leaf({ plannedEnd: '2026-07-12' })] })
    expect(r.overall).toBe('amber')
    expect(r.today).toBe(TODAY)
  })
  it('hygiene은 dataHygiene 패스스루 — 무신호여도 데이터 품질 캐비앗 제공', () => {
    const r = run({ items: [leaf({ owners: [], plannedStart: '2026-07-01', plannedEnd: '2026-07-30' })] })
    expect(r.hygiene.noOwner).toBe(1)
    expect(r.hygiene.clean).toBe(false)
  })
})

/* ═══ fingerprint — 캐시 재생성 키의 안정성 ═══ */
describe('riskFingerprint', () => {
  const stallInput = (plannedPct: number) => input({
    items: [leaf({ id: 'fixed', name: '고정작업', plannedEnd: '2026-07-18', plannedPct, rolledActualPct: 50 })],
  })

  it('같은 입력 → 같은 지문 (결정성)', () => {
    const mixed = () => input({
      items: [
        leaf({ id: 'a', plannedEnd: '2026-07-12' }),
        leaf({ id: 'b', plannedEnd: '2026-07-18', plannedPct: 60, rolledActualPct: 40 }),
      ],
      minuteSignals: [msig({ minuteDate: '2026-07-01' })],
    })
    expect(detectRiskSignals(mixed()).fingerprint).toBe(detectRiskSignals(mixed()).fingerprint)
  })
  it('지표 변화(경과 1건→2건) → 지문 변화', () => {
    const one = run({ items: [leaf({ id: 'a', plannedEnd: '2026-07-12' })] })
    const two = run({ items: [leaf({ id: 'a', plannedEnd: '2026-07-12' }), leaf({ id: 'b', plannedEnd: '2026-07-13' })] })
    expect(one.fingerprint).not.toBe(two.fingerprint)
  })
  it('소수점 미세 변화(갭 12.3→12.4%p)는 정수화로 지문 불변', () => {
    const a = detectRiskSignals(stallInput(62.3))
    const b = detectRiskSignals(stallInput(62.4))
    expect(find(a, 'deadline_stall')!.metrics.maxGapPp).not.toBe(find(b, 'deadline_stall')!.metrics.maxGapPp)
    expect(a.fingerprint).toBe(b.fingerprint)
  })
  it('단순 하루 경과(버킷·멤버십 불변)는 지문 불변 — 경과일은 표시 전용', () => {
    const items = [leaf({ id: 'a', plannedEnd: '2026-07-10' })]
    const d0 = run({ items, today: '2026-07-15', realToday: '2026-07-15' }) // 경과 5일(d1_7)
    const d1 = run({ items, today: '2026-07-16', realToday: '2026-07-16' }) // 경과 6일(d1_7)
    expect(find(d0, 'overdue_accumulation')!.metrics.maxOverdueDays).toBe(5)
    expect(find(d1, 'overdue_accumulation')!.metrics.maxOverdueDays).toBe(6)
    expect(d0.fingerprint).toBe(d1.fingerprint)
  })
  it('심각도 전이(경과 14일→15일, amber→red)는 지문 변화', () => {
    const items = [leaf({ id: 'a', plannedEnd: '2026-07-01' })]
    const amber = run({ items, today: '2026-07-15', realToday: '2026-07-15' })
    const red = run({ items, today: '2026-07-16', realToday: '2026-07-16' })
    expect(find(amber, 'overdue_accumulation')!.severity).toBe('amber')
    expect(find(red, 'overdue_accumulation')!.severity).toBe('red')
    expect(amber.fingerprint).not.toBe(red.fingerprint)
  })
  it('riskFingerprint 단독 — 신호 순서와 무관(정렬 정규화)', () => {
    const r = run({
      items: [leaf({ id: 'a', plannedEnd: '2026-07-12' })],
      minuteSignals: [msig({ minuteDate: '2026-07-01' })],
    })
    expect(riskFingerprint([...r.signals].reverse())).toBe(r.fingerprint)
  })
})
