import { describe, it, expect } from 'vitest'
import type { ComputedItem } from '@/lib/domain/types'
import { buildPortfolio, type PortfolioProjectInput } from '@/lib/domain/portfolio'
import { canViewPortfolio } from '@/lib/authz/portfolioAccess'
import type { Actor } from '@/lib/domain/authz'

const leaf = (over: Partial<ComputedItem>): ComputedItem => ({
  id: Math.random().toString(36).slice(2), parentId: 'p', code: 'x', sortOrder: 0,
  name: '작업', biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'in_progress', children: [], depth: 0, ...over,
})

const mkInput = (over: Partial<PortfolioProjectInput>): PortfolioProjectInput => ({
  projectId: 'p1', name: '프로젝트', isPrivate: false,
  startDate: '2026-01-01', endDate: '2026-12-31', baseDate: null, today: '2026-08-18',
  items: [leaf({ plannedPct: 50, rolledActualPct: 50 })], milestoneKeywords: ['보고회'], leaders: [], ...over,
})

describe('canViewPortfolio', () => {
  const actor = (isSuperuser: boolean): Actor =>
    ({ userId: 'u', teamCode: null, teamId: null, isSuperuser, projectRoles: new Map(), rosterTeams: new Map() } as unknown as Actor)
  it('슈퍼유저만 true, null(판정 불가)은 fail-closed', () => {
    expect(canViewPortfolio(actor(true))).toBe(true)
    expect(canViewPortfolio(actor(false))).toBe(false)
    expect(canViewPortfolio(null)).toBe(false)
  })
})

describe('buildPortfolio — 행 산출', () => {
  it('items null(조회 실패) → degraded 행: lifecycle unknown, exec null', () => {
    const m = buildPortfolio([mkInput({ items: null })])
    expect(m.rows[0].degraded).toBe(true)
    expect(m.rows[0].lifecycle).toBe('unknown')
    expect(m.rows[0].exec).toBeNull()
    expect(m.totals.degraded).toBe(1)
  })
  it('정상 행 — exec 신호·진척이 정본 함수 결과 그대로 실린다', () => {
    // planned 50 vs actual 50 → 편차 0 → progress green
    const m = buildPortfolio([mkInput({})])
    expect(m.rows[0].degraded).toBe(false)
    expect(m.rows[0].exec!.progress.variance).toBe(0)
    expect(m.rows[0].exec!.progress.signal).toBe('green')
  })
  it('SPI — schedule.label onTrack 이면 actual/planned 소수 2자리, 조기 가드(early)면 null', () => {
    const onTrack = buildPortfolio([mkInput({ items: [leaf({ plannedPct: 50, rolledActualPct: 45 })] })])
    expect(onTrack.rows[0].spi).toBe(0.9)
    const early = buildPortfolio([mkInput({ items: [leaf({ plannedPct: 3, rolledActualPct: 1 })] })])
    expect(early.rows[0].spi).toBeNull()
  })
  it('생애 상태 — 종료일 경과 + 전 리프 done → done, 미완 리프 있으면 overdue', () => {
    const done = buildPortfolio([mkInput({
      endDate: '2026-06-30', items: [leaf({ status: 'done', rolledActualPct: 100, plannedPct: 100 })],
    })])
    expect(done.rows[0].lifecycle).toBe('done')
    const overdue = buildPortfolio([mkInput({
      endDate: '2026-06-30', items: [leaf({ status: 'in_progress', rolledActualPct: 90, plannedPct: 100 })],
    })])
    expect(overdue.rows[0].lifecycle).toBe('overdue')
  })
})

describe('buildPortfolio — 정렬', () => {
  // 신호 정렬 픽스처는 날짜 null → scheduleModel 이 neutral 이 되어 overall 신호를
  // progress 신호만으로 통제한다(날짜가 있으면 장기 프로젝트에서 편차 -5도 SPI slip>14 로
  // schedule red 가 되어 amber 픽스처가 amber 가 아니게 된다 — 프리플라이트 Ruling 1).
  // 셋 다 lifecycle 'ready'(날짜 없음) 동일 그룹이므로 신호 순서만 검증된다.
  const red = mkInput({ projectId: 'r', name: 'RED', startDate: null, endDate: null, items: [leaf({ plannedPct: 65, rolledActualPct: 50 })] })
  const amber = mkInput({ projectId: 'a', name: 'AMBER', startDate: null, endDate: null, items: [leaf({ plannedPct: 55, rolledActualPct: 50 })] })
  const green = mkInput({ projectId: 'g', name: 'GREEN', startDate: null, endDate: null, items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] })
  it('신호 심각도 순: red → amber → green', () => {
    const m = buildPortfolio([green, red, amber])
    expect(m.rows.map(r => r.projectId)).toEqual(['r', 'a', 'g'])
  })
  it('degraded(확인 불가)는 실패를 묻지 않도록 최상단', () => {
    // degraded 는 lifecycle unknown(그룹 0) + rank -1 — ready 그룹의 green 보다 앞선다
    const m = buildPortfolio([green, mkInput({ projectId: 'd', items: null })])
    expect(m.rows[0].projectId).toBe('d')
  })
  it('생애 그룹 — active 가 앞, ready 는 다음, done 은 맨 뒤', () => {
    // activeGreen: 기간 내 + 편차 0 + SPI 1(slip 0) → 전 신호 green, lifecycle active
    const activeGreen = mkInput({ projectId: 'g', items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] })
    const ready = mkInput({ projectId: 'rd', startDate: '2026-10-01', endDate: '2026-12-31', items: [leaf({})] })
    const doneP = mkInput({
      projectId: 'dn', endDate: '2026-06-30',
      items: [leaf({ status: 'done', rolledActualPct: 100, plannedPct: 100 })],
    })
    const m = buildPortfolio([doneP, ready, activeGreen])
    expect(m.rows.map(r => r.projectId)).toEqual(['g', 'rd', 'dn'])
  })
  it('동신호 동그룹은 편차 오름차순(더 나쁜 게 먼저)', () => {
    const worse = mkInput({ projectId: 'w', startDate: null, endDate: null, items: [leaf({ plannedPct: 58, rolledActualPct: 50 })] })  // -8, amber
    const better = mkInput({ projectId: 'b', startDate: null, endDate: null, items: [leaf({ plannedPct: 54, rolledActualPct: 50 })] }) // -4, amber
    const m = buildPortfolio([better, worse])
    expect(m.rows.map(r => r.projectId)).toEqual(['w', 'b'])
  })
})

describe('buildPortfolio — totals·milestones', () => {
  it('totals — 신호 분포는 정상 행만, overdue 는 lifecycle 기준', () => {
    const m = buildPortfolio([
      mkInput({ projectId: 'g', items: [leaf({ plannedPct: 50, rolledActualPct: 50 })] }),
      mkInput({ projectId: 'o', endDate: '2026-06-30', items: [leaf({ rolledActualPct: 50, plannedPct: 100 })] }),
      mkInput({ projectId: 'd', items: null }),
    ])
    expect(m.totals.count).toBe(3)
    expect(m.totals.degraded).toBe(1)
    expect(m.totals.overdue).toBe(1)
    expect(m.totals.red + m.totals.amber + m.totals.green + m.totals.neutral).toBe(2) // 정상 행 2건만
  })
  it('milestones — 프로젝트명 부착 + 날짜 오름차순 통합', () => {
    const m = buildPortfolio([
      mkInput({ projectId: 'p1', name: 'P1', items: [leaf({ name: '최종 보고회', plannedEnd: '2026-10-01' })], milestoneKeywords: ['보고회'] }),
      mkInput({ projectId: 'p2', name: 'P2', items: [leaf({ name: '착수 보고회', plannedEnd: '2026-09-01' })], milestoneKeywords: ['보고회'] }),
    ])
    expect(m.milestones.map(x => x.projectName)).toEqual(['P2', 'P1'])
  })
  it('키워드 빈 배열 + 일반 리프 → 마일스톤 0건이 정답', () => {
    const m = buildPortfolio([mkInput({ milestoneKeywords: [], items: [leaf({ name: '일반작업', plannedEnd: '2026-09-01' })] })])
    expect(m.milestones).toHaveLength(0)
  })
})
