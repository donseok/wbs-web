import { describe, it, expect } from 'vitest'
import { progressSignal } from '@/lib/domain/dashboard'
import { scheduleModel } from '@/lib/domain/dashboard'

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

import {
  progressMatrix, varianceRanking, milestoneTimeline, delayAging, dataHygiene,
} from '@/lib/domain/dashboard'

describe('progressMatrix (Phase × 팀)', () => {
  const TEAMS = ['PMO', 'ERP', 'MES', '가공'] as const
  const phase = leaf({
    name: 'Phase1', rolledActualPct: 40, plannedPct: 50,
    children: [
      leaf({ owners: [{ team: 'ERP', kind: 'primary' }], rolledActualPct: 60, plannedPct: 70 }),
      leaf({ owners: [{ team: 'ERP', kind: 'support' }, { team: 'MES', kind: 'primary' }], rolledActualPct: 20, plannedPct: 30 }),
    ],
  })
  it('셀 = 담당 leaf 평균(primary+support 모두), 무배정 팀은 null', () => {
    const rows = progressMatrix([phase], TEAMS)
    expect(rows).toHaveLength(1)
    expect(rows[0].cells[0]).toBeNull()                                    // PMO
    expect(rows[0].cells[1]).toEqual({ pct: 40, planned: 50, count: 2 })   // ERP: (60+20)/2
    expect(rows[0].cells[2]).toEqual({ pct: 20, planned: 30, count: 1 })   // MES
    expect(rows[0].cells[3]).toBeNull()                                    // 가공
  })
  it('행 요약 = Phase 롤업값과 편차', () => {
    const r = progressMatrix([phase], TEAMS)[0]
    expect(r.overall).toBe(40); expect(r.planned).toBe(50); expect(r.variance).toBe(-10)
  })
})

describe('varianceRanking (마감 전 따라잡기 후보)', () => {
  const today = '2026-07-09'
  it('done·기한경과·편차≤0 제외, 편차 내림차순', () => {
    const out = varianceRanking([
      leaf({ name: 'A', plannedPct: 50, rolledActualPct: 30, plannedEnd: '2026-07-20' }),          // gap 20
      leaf({ name: 'B', plannedPct: 40, rolledActualPct: 35, plannedEnd: null }),                  // gap 5, 마감 없음 → 포함
      leaf({ name: 'C', plannedPct: 80, rolledActualPct: 10, plannedEnd: '2026-07-01' }),          // 기한경과 → 제외
      leaf({ name: 'D', plannedPct: 50, rolledActualPct: 50, plannedEnd: '2026-07-20' }),          // gap 0 → 제외
      leaf({ name: 'E', status: 'done', plannedPct: 50, rolledActualPct: 100, plannedEnd: '2026-07-20' }), // done → 제외
    ], today)
    expect(out.map(e => e.item.name)).toEqual(['A', 'B'])
    expect(out[0].gapPp).toBe(20); expect(out[1].gapPp).toBe(5)
  })
  it('limit 적용', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      leaf({ name: `T${i}`, plannedPct: 50, rolledActualPct: 50 - (i + 1), plannedEnd: '2026-08-01' }))
    expect(varianceRanking(many, today)).toHaveLength(8)
  })
})

describe('milestoneTimeline (완료 포함 전체)', () => {
  const today = '2026-07-09'
  it('done/overdue/upcoming 분류 + 날짜순 정렬', () => {
    const out = milestoneTimeline([
      leaf({ name: '착수보고', plannedEnd: '2026-06-01', status: 'done' }),
      leaf({ name: '중간보고', plannedEnd: '2026-07-01', status: 'in_progress' }),
      leaf({ name: '최종 선정', plannedEnd: '2026-07-20', status: 'not_started' }),
      leaf({ name: '일반 작업', plannedEnd: '2026-07-15', status: 'in_progress' }),  // 키워드/단일일+산출물 아님 → 제외
    ], today)
    expect(out.map(m => m.name)).toEqual(['착수보고', '중간보고', '최종 선정'])
    expect(out.map(m => m.status)).toEqual(['done', 'overdue', 'upcoming'])
    expect(out[2].dday).toBe(11)
  })
  it('단일일 + 산출물 leaf도 감지', () => {
    const out = milestoneTimeline([
      leaf({ name: '워크샵', plannedStart: '2026-07-20', plannedEnd: '2026-07-20', deliverable: '결과보고' }),
    ], today)
    expect(out).toHaveLength(1)
  })
})

describe('delayAging (기한 경과 에이징)', () => {
  const today = '2026-07-09'
  it('버킷 경계: 1~7 / 8~14 / 15+', () => {
    const m = delayAging([
      leaf({ name: 'a', plannedEnd: '2026-07-08', plannedPct: 50, rolledActualPct: 10 }), // 1일
      leaf({ name: 'b', plannedEnd: '2026-07-02', plannedPct: 50, rolledActualPct: 10 }), // 7일
      leaf({ name: 'c', plannedEnd: '2026-07-01', plannedPct: 50, rolledActualPct: 10 }), // 8일
      leaf({ name: 'd', plannedEnd: '2026-06-24', plannedPct: 50, rolledActualPct: 10 }), // 15일
    ], today)
    expect(m.d1_7).toBe(2); expect(m.d8_14).toBe(1); expect(m.d15plus).toBe(1); expect(m.total).toBe(4)
  })
  it('done·마감 전·마감 없음 제외, 리스트는 경과일 내림차순', () => {
    const m = delayAging([
      leaf({ name: 'done', plannedEnd: '2026-07-01', status: 'done' }),
      leaf({ name: 'future', plannedEnd: '2026-07-20' }),
      leaf({ name: 'nodate', plannedEnd: null }),
      leaf({ name: 'old', plannedEnd: '2026-06-01', plannedPct: 80, rolledActualPct: 10 }),
      leaf({ name: 'new', plannedEnd: '2026-07-08', plannedPct: 50, rolledActualPct: 10 }),
    ], today)
    expect(m.total).toBe(2)
    expect(m.list.map(e => e.item.name)).toEqual(['old', 'new'])
    expect(m.list[0].overdue).toBe(38)
  })
})

describe('dataHygiene (계획 데이터 품질)', () => {
  it('담당 누락·기간 미설정 leaf 카운트', () => {
    const m = dataHygiene([
      leaf({ owners: [], plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
      leaf({ owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: null, plannedEnd: null }),
    ])
    expect(m.noOwner).toBe(1); expect(m.noDates).toBe(1); expect(m.clean).toBe(false)
  })
  it('가중치 혼재: 형제 그룹 내 일부만 null → 그룹당 1 카운트, 전부 null은 정상', () => {
    const mixedRoots = dataHygiene([leaf({ weight: 1 }), leaf({ weight: null })])
    expect(mixedRoots.mixedWeight).toBe(1)
    const allNull = dataHygiene([leaf({ weight: null }), leaf({ weight: null })])
    expect(allNull.mixedWeight).toBe(0)
    const mixedChildren = dataHygiene([
      leaf({ weight: 1, children: [leaf({ weight: 2 }), leaf({ weight: null })] }),
      leaf({ weight: 1 }),
    ])
    expect(mixedChildren.mixedWeight).toBe(1) // 루트 그룹은 전부 non-null, 자식 그룹만 혼재
  })
  it('전부 정상이면 clean', () => {
    const m = dataHygiene([leaf({ owners: [{ team: 'ERP', kind: 'primary' }], plannedStart: '2026-07-01', plannedEnd: '2026-07-10' })])
    expect(m.clean).toBe(true)
  })
})
