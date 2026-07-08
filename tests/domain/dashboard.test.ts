import { describe, it, expect } from 'vitest'
import { progressSignal } from '@/lib/domain/dashboard'
import { scheduleModel } from '@/lib/domain/dashboard'
// riskModel·detectMilestones는 파일 하단에서 이미 import 한다(중복 선언 방지).
import { attentionLeaves, milestoneLeaves } from '@/lib/domain/dashboard'
import { computeTree } from '@/lib/domain/rollup'
import { collectLeaves } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'

describe('progressSignal (편차 %p)', () => {
  it('편차 ≥ -2 → green', () => {
    expect(progressSignal(0)).toBe('green')
    expect(progressSignal(-2)).toBe('green')   // 경계: green 소유
  })
  it('-10 ≤ 편차 < -2 → amber', () => {
    expect(progressSignal(-3)).toBe('amber')
    expect(progressSignal(-10)).toBe('amber')  // 경계: amber 소유
  })
  it('편차 < -10 → red', () => {
    expect(progressSignal(-11)).toBe('red')
  })
})

const sched = (over: Partial<Parameters<typeof scheduleModel>[0]> = {}) =>
  scheduleModel({ startDate: '2026-01-01', endDate: '2026-04-10', today: '2026-02-20', overallActual: 49, overallPlanned: 50, ...over })
// start~end 캘린더 totalDays = 100

describe('scheduleModel', () => {
  it('날짜 없으면 neutral/none', () => {
    const r = scheduleModel({ startDate: null, endDate: null, today: '2026-02-20', overallActual: 10, overallPlanned: 10 })
    expect(r.signal).toBe('neutral'); expect(r.label).toBe('none'); expect(r.projectedEnd).toBeNull()
  })
  it('완료(actual≥100) → green/done, slip·projectedEnd 숨김', () => {
    const r = sched({ overallActual: 100, overallPlanned: 100, today: '2026-05-01' })
    expect(r.signal).toBe('green'); expect(r.label).toBe('done'); expect(r.slipDays).toBeNull(); expect(r.projectedEnd).toBeNull()
  })
  it('계획<5% → neutral/early', () => {
    expect(sched({ overallPlanned: 3, overallActual: 1 }).label).toBe('early')
    expect(sched({ overallPlanned: 3, overallActual: 1 }).signal).toBe('neutral')
  })
  it('경과<15% 바닥 → neutral/early', () => {
    const r = sched({ today: '2026-01-05' }) // elapsed 5 < max(14, 15)
    expect(r.label).toBe('early'); expect(r.signal).toBe('neutral')
  })
  it('정상(slip≤3) → green', () => {
    expect(sched({ overallActual: 49, overallPlanned: 50 }).signal).toBe('green') // SPI .98 → slip 2
  })
  it('주의(3<slip≤14) → amber', () => {
    expect(sched({ overallActual: 45, overallPlanned: 50 }).signal).toBe('amber') // slip 11
  })
  it('위험(slip>14) → red', () => {
    expect(sched({ overallActual: 40, overallPlanned: 50 }).signal).toBe('red') // slip 25
  })
  it('종료일 경과+미완료 → red (slip이 amber라도)', () => {
    const r = sched({ today: '2026-05-01', overallActual: 90, overallPlanned: 100 })
    expect(r.signal).toBe('red')
  })
  it('clamp — actual 극소면 projectedDuration 상한(3×), slip=2×total', () => {
    const r = sched({ overallActual: 2, overallPlanned: 40 }) // SPI .05 → raw 2000
    expect(r.slipDays).toBe(200) // 300 - 100
    expect(r.signal).toBe('red')
  })
})

import { detectMilestones } from '@/lib/domain/dashboard'
import type { ComputedItem } from '@/lib/domain/types'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', level: 'activity', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], ...over,
})

describe('detectMilestones', () => {
  const today = '2026-07-08'
  it('키워드 매칭 + 임박(D-14 이내) → amber', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-17', sortOrder: 1 })], today)
    expect(r.name).toBe('중간보고'); expect(r.signal).toBe('amber'); expect(r.dday).toBe(9)
  })
  it('여유(D-15+) → green', () => {
    const r = detectMilestones([leaf({ name: '착수보고회', plannedEnd: '2026-08-01' })], today)
    expect(r.signal).toBe('green')
  })
  it('단일일 + 산출물 → 감지', () => {
    const r = detectMilestones([leaf({ name: '워크샵', plannedStart: '2026-07-20', plannedEnd: '2026-07-20', deliverable: '결과보고' })], today)
    expect(r.name).toBe('워크샵')
  })
  it('날짜 null + 산출물 리프는 감지 안 함(null===null 함정 방지)', () => {
    const r = detectMilestones([leaf({ name: '일반작업', deliverable: '산출물', plannedStart: null, plannedEnd: null })], today)
    expect(r.name).toBeNull(); expect(r.signal).toBe('neutral')
  })
  it('지연 마일스톤(예정일 경과+미완료) → red', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-01', status: 'delayed' })], today)
    expect(r.overdue).toBe(true); expect(r.signal).toBe('red')
  })
  it('완료된 마일스톤은 제외', () => {
    const r = detectMilestones([leaf({ name: '중간보고', plannedEnd: '2026-07-20', status: 'done' })], today)
    expect(r.name).toBeNull()
  })
  it('미감지 → neutral', () => {
    expect(detectMilestones([leaf({ name: '일반작업', plannedEnd: '2026-07-20' })], today).signal).toBe('neutral')
  })
  it('다음 마일스톤 동점은 sortOrder로 결정', () => {
    const r = detectMilestones([
      leaf({ name: '중간보고 B', plannedEnd: '2026-07-20', sortOrder: 5 }),
      leaf({ name: '중간보고 A', plannedEnd: '2026-07-20', sortOrder: 2 }),
    ], today)
    expect(r.name).toBe('중간보고 A')
  })
})

import { delayedLeaves, dueSoonLeaves } from '@/lib/domain/dashboard'

describe('delayedLeaves / dueSoonLeaves', () => {
  const today = '2026-07-08'
  it('delayedLeaves — status delayed만', () => {
    const ls = [leaf({ status: 'delayed' }), leaf({ status: 'in_progress' }), leaf({ status: 'delayed' })]
    expect(delayedLeaves(ls)).toHaveLength(2)
  })
  it('dueSoonLeaves — 미완료 & 7일 내 마감(오늘 이후)', () => {
    const ls = [
      leaf({ status: 'in_progress', plannedEnd: '2026-07-10' }),   // D+2 ✓
      leaf({ status: 'in_progress', plannedEnd: '2026-07-20' }),   // D+12 ✗
      leaf({ status: 'done', plannedEnd: '2026-07-09' }),          // done ✗
      leaf({ status: 'in_progress', plannedEnd: '2026-07-01' }),   // 과거 ✗
      leaf({ status: 'in_progress', plannedEnd: null }),           // 날짜없음 ✗
    ]
    expect(dueSoonLeaves(ls, today)).toHaveLength(1)
  })
})

import { riskModel } from '@/lib/domain/dashboard'

const phase = (over: Partial<ComputedItem>): ComputedItem =>
  leaf({ level: 'phase', parentId: null, ...over })

describe('riskModel', () => {
  const today = '2026-07-08'
  it('지연 0 → green', () => {
    expect(riskModel([phase({ status: 'in_progress', children: [leaf({ status: 'in_progress' })] })], today).signal).toBe('green')
  })
  it('지연 1~3 → amber', () => {
    const r = phase({ weight: null, status: 'in_progress', children: [leaf({ status: 'delayed' }), leaf({ status: 'delayed' })] })
    expect(riskModel([r], today).signal).toBe('amber')
    expect(riskModel([r], today).delayed).toBe(2)
  })
  it('지연 4+ → red', () => {
    const r = phase({ children: Array.from({ length: 4 }, () => leaf({ status: 'delayed' })) })
    expect(riskModel([r], today).signal).toBe('red')
  })
  it('최상위 가중 Phase 지연 → 한 단계 격상(green→amber)', () => {
    // 지연 리프 0(→green)이지만 최상위 가중 Phase 자체가 delayed → amber
    const top = phase({ weight: 3, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    const other = phase({ weight: 1, status: 'in_progress', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([top, other], today).topWeightDelayed).toBe(true)
    expect(riskModel([top, other], today).signal).toBe('amber')
  })
  it('가중치 전부 null → 격상 없음', () => {
    const a = phase({ weight: null, status: 'delayed', children: [leaf({ status: 'in_progress' })] })
    expect(riskModel([a], today).topWeightDelayed).toBe(false)
    expect(riskModel([a], today).signal).toBe('green')
  })
})

import { overallSignal, buildExecSummary } from '@/lib/domain/dashboard'

describe('overallSignal (worst-of, neutral 제외)', () => {
  it('모두 green → green', () => { expect(overallSignal(['green', 'green', 'green', 'green'])).toBe('green') })
  it('하나라도 red → red', () => { expect(overallSignal(['green', 'red', 'amber', 'neutral'])).toBe('red') })
  it('진척 green + 일정 red 충돌 → red', () => { expect(overallSignal(['green', 'red'])).toBe('red') })
  it('neutral만 있으면 green', () => { expect(overallSignal(['neutral', 'neutral'])).toBe('green') })
  it('최악이 amber → amber', () => { expect(overallSignal(['green', 'amber', 'neutral'])).toBe('amber') })
})

describe('buildExecSummary', () => {
  const today = '2026-07-08'
  it('4개 하위 모델 + 종합 판정을 조립', () => {
    const items = [phase({
      weight: null, plannedPct: 40, rolledActualPct: 20, status: 'delayed',
      children: [leaf({ status: 'delayed', plannedEnd: '2026-07-20' })],
    })]
    const r = buildExecSummary(items, { startDate: '2026-01-01', endDate: '2026-12-31', today })
    expect(r.progress.actual).toBe(20)
    expect(r.progress.planned).toBe(40)
    expect(r.progress.variance).toBe(-20)
    expect(r.progress.signal).toBe('red')       // -20 < -10
    expect(r.overall.signal).toBe('red')         // worst-of
    expect(r.risk.delayed).toBe(1)
  })
})

// 코드 품질 리뷰 보강 — 경계값·필드 집계 고정
describe('보강 — 경계·필드 검증', () => {
  const today = '2026-07-08'
  it('scheduleModel — 계획 앞섬(SPI>1) → green, slip 음수', () => {
    const r = sched({ overallActual: 70, overallPlanned: 50 })
    expect(r.signal).toBe('green')
    expect(r.slipDays).toBeLessThanOrEqual(0)
  })
  it('dueSoonLeaves — 정확히 D+7 경계는 포함', () => {
    const ls = [leaf({ status: 'in_progress', plannedEnd: '2026-07-15' })] // today +7일
    expect(dueSoonLeaves(ls, today)).toHaveLength(1)
  })
  it('detectMilestones — 지연이 다가오는 예정보다 우선', () => {
    const r = detectMilestones([
      leaf({ name: '중간보고 예정', plannedEnd: '2026-07-20', sortOrder: 1 }),
      leaf({ name: '착수보고 지연', plannedEnd: '2026-07-01', status: 'delayed', sortOrder: 2 }),
    ], today)
    expect(r.name).toBe('착수보고 지연'); expect(r.overdue).toBe(true); expect(r.signal).toBe('red')
  })
  it('riskModel — dueSoon 필드 집계', () => {
    const r = phase({ children: [
      leaf({ status: 'in_progress', plannedEnd: '2026-07-10' }), // D+2 임박
      leaf({ status: 'delayed' }),                                // 날짜 없음 → dueSoon 아님
    ] })
    expect(riskModel([r], today).dueSoon).toBe(1)
  })
})

const H2 = new Set<string>()
const r = (o: Partial<WbsRow> & { id: string }): WbsRow => ({
  parentId: null, level: 'activity', code: o.id, sortOrder: 0, name: o.id,
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [], ...o,
})
const TODAY = '2026-07-09'

// x: 마감 지남 + 0% → delayed, dueSoon 아님
// y: 07-13 마감(D-4) + 0% → delayed(계획 미달) AND dueSoon  ← 중복 케이스
// z: 07-13 마감 + 100% → done, 어느 쪽도 아님
// w: 08-01 마감, 아직 시작 전 → 어느 쪽도 아님
const attRows: WbsRow[] = [
  r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
  r({ id: 'x', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07' }),
  r({ id: 'y', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', sortOrder: 1 }),
  r({ id: 'z', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', actualPct: 100, sortOrder: 2 }),
  r({ id: 'w', parentId: 'P', plannedStart: '2026-07-27', plannedEnd: '2026-08-01', sortOrder: 3 }),
]

describe('attentionLeaves — 지연 ∪ 마감임박 중복 제거', () => {
  const leaves = collectLeaves(computeTree(attRows, TODAY, H2))

  it('y는 delayed이자 dueSoon이지만 한 번만 센다', () => {
    expect(attentionLeaves(leaves, TODAY).map(l => l.id).sort()).toEqual(['x', 'y'])
  })

  it('riskModel.attention은 고유 건수, delayed+dueSoon은 중복 포함', () => {
    const m = riskModel(computeTree(attRows, TODAY, H2), TODAY)
    expect(m.delayed).toBe(2)
    expect(m.dueSoon).toBe(1)
    expect(m.attention).toBe(2)   // 3이 아니다
  })

  it('signal은 delayed만 읽으므로 attention 추가로 변하지 않는다', () => {
    expect(riskModel(computeTree(attRows, TODAY, H2), TODAY).signal).toBe('amber')
  })
})

describe('scheduleModel.earlyFloor', () => {
  it('max(14, round(totalDays * 0.15))', () => {
    const a = scheduleModel({ startDate: '2026-07-01', endDate: '2026-12-31', today: '2026-07-09', overallActual: 1, overallPlanned: 6 })
    expect(a.earlyFloor).toBe(28)   // totalDays 184 → round(27.6)
    expect(a.label).toBe('early')   // elapsed 9 < 28
    expect(a.projectedEnd).toBeNull()

    const b = scheduleModel({ startDate: '2026-01-01', endDate: '2026-02-01', today: '2026-01-05', overallActual: 1, overallPlanned: 6 })
    expect(b.earlyFloor).toBe(14)   // totalDays 32 → round(4.8)=5 → max(14,5)
  })

  it('날짜 없으면 earlyFloor 0', () => {
    expect(scheduleModel({ startDate: null, endDate: null, today: TODAY, overallActual: 0, overallPlanned: 0 }).earlyFloor).toBe(0)
  })
})

describe('milestoneLeaves', () => {
  const msRows: WbsRow[] = [
    r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-12-31' }),
    r({ id: 'kick', parentId: 'P', name: '1-3. 프로젝트 착수 보고회(Kick-off)', plannedStart: '2026-07-10', plannedEnd: '2026-07-10' }),
    r({ id: 'mid', parentId: 'P', name: '2-5. 중간보고', plannedStart: '2026-09-17', plannedEnd: '2026-09-17', sortOrder: 1 }),
    r({ id: 'donems', parentId: 'P', name: '착수보고 준비', plannedStart: '2026-07-01', plannedEnd: '2026-07-02', actualPct: 100, sortOrder: 2 }),
    r({ id: 'plain', parentId: 'P', name: '일반 작업', plannedStart: '2026-07-01', plannedEnd: '2026-07-30', sortOrder: 3 }),
  ]
  const tree = computeTree(msRows, TODAY, H2)

  it('완료된 마일스톤도 포함한다 (detectMilestones와 다르다)', () => {
    expect(milestoneLeaves(tree).map(l => l.id)).toEqual(['donems', 'kick', 'mid'])
  })

  it('마일스톤이 아닌 항목은 제외한다', () => {
    expect(milestoneLeaves(tree).map(l => l.id)).not.toContain('plain')
  })

  it('plannedEnd 오름차순', () => {
    const ends = milestoneLeaves(tree).map(l => l.plannedEnd)
    expect([...ends].sort()).toEqual(ends)
  })

  it('detectMilestones는 여전히 미완료 중 다음 하나만 반환한다', () => {
    const m = detectMilestones(tree, TODAY)
    expect(m.name).toBe('1-3. 프로젝트 착수 보고회(Kick-off)')  // donems는 done이라 제외
    expect(m.dday).toBe(1)
  })
})

/* ExecSummary 리스크 타일이 표시하는 산술 — 헤드라인과 부제가 서로 모순되지 않아야 한다.
   타일: value = attention, sub = `지연 {delayed} · 임박 {attention - delayed}`.
   따라서 delayed + (attention - delayed) === attention 이 눈으로도 성립해야 한다. */
describe('리스크 타일 산술: 지연 + 임박(지연 아님) === 고유 건수', () => {
  // pureDue: 07-06..07-10 업무일 5, 07-09까지 4 → planned 80. actual 80 → in_progress + dueSoon.
  const tileRows: WbsRow[] = [
    r({ id: 'P', level: 'phase', plannedStart: '2026-07-01', plannedEnd: '2026-08-31' }),
    r({ id: 'x', parentId: 'P', plannedStart: '2026-07-01', plannedEnd: '2026-07-07' }),
    r({ id: 'y', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-13', sortOrder: 1 }),
    r({ id: 'pureDue', parentId: 'P', plannedStart: '2026-07-06', plannedEnd: '2026-07-10', actualPct: 80, sortOrder: 2 }),
  ]
  const m = riskModel(computeTree(tileRows, TODAY, H2), TODAY)

  it('겹치는 y를 한 번만 세어 attention < delayed + dueSoon', () => {
    expect(m.delayed).toBe(2)              // x, y
    expect(m.dueSoon).toBe(2)              // y, pureDue
    expect(m.attention).toBe(3)            // x, y, pureDue — 4가 아니다
  })

  it('부제의 임박 = attention - delayed 는 음수가 될 수 없고, 합이 헤드라인과 같다', () => {
    const dueSoonOnly = m.attention - m.delayed
    expect(dueSoonOnly).toBe(1)            // pureDue 하나
    expect(m.delayed + dueSoonOnly).toBe(m.attention)
    expect(dueSoonOnly).toBeGreaterThanOrEqual(0)
  })

  it('불변식: delayed ≤ attention ≤ delayed + dueSoon', () => {
    expect(m.attention).toBeGreaterThanOrEqual(m.delayed)
    expect(m.attention).toBeLessThanOrEqual(m.delayed + m.dueSoon)
  })
})
