import { describe, it, expect } from 'vitest'
import {
  issueKpis, issueStatusCounts, issueMegaBreakdown, issueTrend, issueQueue,
  DUE_SOON_DAYS, RESOLVED_WINDOW_DAYS, TREND_WEEKS, QUEUE_LIMIT,
  type DashboardIssue,
} from '@/lib/domain/issueDashboard'
import { ISSUE_MEGA_AREAS } from '@/lib/domain/issueAnalysis'

const TODAY = '2026-08-28' // 금요일 — 주 시작(월)은 08-24

let seq = 0
function issue(over: Partial<DashboardIssue> = {}): DashboardIssue {
  seq += 1
  return {
    id: `i${seq}`, issueNo: seq, piIssueCode: `PI-00-${String(seq).padStart(3, '0')}`, megaCode: '00',
    title: `이슈 ${seq}`, status: 'open', severity: 'medium', dueDate: null, resolvedAt: null,
    createdAt: '2026-07-01T00:00:00+00:00', ...over,
  }
}

describe('issueKpis', () => {
  it('미해결 = 열림+진행중+보류, 해결은 제외', () => {
    const k = issueKpis([
      issue({ status: 'open' }), issue({ status: 'in_progress' }), issue({ status: 'on_hold' }), issue({ status: 'resolved' }),
    ], TODAY)
    expect(k.total).toBe(4)
    expect(k.unresolved).toBe(3)
  })

  it('지연 = 기한 경과(당일 제외) + 미해결 — 해결된 이슈의 지난 기한은 세지 않는다', () => {
    const k = issueKpis([
      issue({ dueDate: '2026-08-27' }),                        // 어제 → 지연
      issue({ dueDate: '2026-08-28' }),                        // 오늘 → 지연 아님
      issue({ dueDate: '2026-08-01', status: 'resolved', resolvedAt: '2026-08-02T00:00:00+00:00' }),
      issue({ dueDate: null }),
    ], TODAY)
    expect(k.overdue).toBe(1)
  })

  it('심각·미해결 = severity high 이면서 미해결', () => {
    const k = issueKpis([
      issue({ severity: 'high' }), issue({ severity: 'high', status: 'on_hold' }),
      issue({ severity: 'high', status: 'resolved', resolvedAt: '2026-08-20T00:00:00+00:00' }), issue({ severity: 'medium' }),
    ], TODAY)
    expect(k.highUnresolved).toBe(2)
  })

  it('최근 7일 해결 = 오늘 포함 7일 창(today-6 ~ today), 서울 날짜 기준', () => {
    expect(RESOLVED_WINDOW_DAYS).toBe(7)
    const k = issueKpis([
      issue({ status: 'resolved', resolvedAt: '2026-08-21T16:00:00+00:00' }), // = 08-22 KST → 창 시작일, 포함
      issue({ status: 'resolved', resolvedAt: '2026-08-21T14:59:00+00:00' }), // = 08-21 KST → 제외
      issue({ status: 'resolved', resolvedAt: '2026-08-28T05:00:00+00:00' }), // 오늘 → 포함
      issue({ status: 'resolved', resolvedAt: null }),                        // 결측 → 제외
    ], TODAY)
    expect(k.resolved7d).toBe(2)
  })
})

describe('issueStatusCounts', () => {
  it('네 상태 키를 항상 갖고 0 을 채운다', () => {
    expect(issueStatusCounts([])).toEqual({ open: 0, in_progress: 0, on_hold: 0, resolved: 0 })
    expect(issueStatusCounts([issue({ status: 'resolved' }), issue({ status: 'resolved' }), issue()]))
      .toEqual({ open: 1, in_progress: 0, on_hold: 0, resolved: 2 })
  })
})

describe('issueMegaBreakdown', () => {
  it('8개 Mega 를 코드순 고정으로 돌려주고, 이슈 없는 영역은 total 0 · resolvedPct null', () => {
    const rows = issueMegaBreakdown([issue({ megaCode: '05' })])
    expect(rows.map(r => r.code)).toEqual(ISSUE_MEGA_AREAS.map(a => a.code))
    const ops = rows.find(r => r.code === '05')!
    expect(ops.total).toBe(1)
    expect(ops.counts.open).toBe(1)
    expect(rows.find(r => r.code === '00')).toMatchObject({ total: 0, resolvedPct: null })
  })

  it('미분류(megaCode null) 이슈가 있을 때만 마지막에 code null 행을 붙인다', () => {
    expect(issueMegaBreakdown([issue()]).some(r => r.code === null)).toBe(false)
    const rows = issueMegaBreakdown([issue({ megaCode: null }), issue({ megaCode: null, status: 'resolved' })])
    const last = rows[rows.length - 1]
    expect(last.code).toBeNull()
    expect(last).toMatchObject({ total: 2, resolvedPct: 50 })
  })

  it('resolvedPct 는 정수 반올림', () => {
    const rows = issueMegaBreakdown([
      issue({ megaCode: '03', status: 'resolved' }), issue({ megaCode: '03' }), issue({ megaCode: '03' }),
    ])
    expect(rows.find(r => r.code === '03')!.resolvedPct).toBe(33)
  })
})

describe('issueTrend', () => {
  it('기본 12주, 월요일 시작, 마지막 주는 오늘이 속한 주', () => {
    expect(TREND_WEEKS).toBe(12)
    const t = issueTrend([issue()], TODAY)
    expect(t.points).toHaveLength(12)
    expect(t.points[11].weekStart).toBe('2026-08-24')
    expect(t.points[11].weekEnd).toBe('2026-08-30')
    expect(t.points[0].weekStart).toBe('2026-06-08')
  })

  it('오늘이 일요일이면 그 주의 월요일이 마지막 주 시작', () => {
    const t = issueTrend([issue()], '2026-08-30')
    expect(t.points[11].weekStart).toBe('2026-08-24')
  })

  it('등록 누적은 창 이전 등록분을 포함하고, 해결 누적은 해결 상태의 해결일 기준', () => {
    const t = issueTrend([
      issue({ createdAt: '2026-01-05T00:00:00+00:00' }),                                                          // 창 이전
      issue({ createdAt: '2026-08-10T00:00:00+00:00', status: 'resolved', resolvedAt: '2026-08-20T00:00:00+00:00' }),
      issue({ createdAt: '2026-08-26T00:00:00+00:00' }),
      // resolvedAt 이 남아 있어도 status 가 resolved 가 아니면 해결로 세지 않는다(재오픈 방어)
      issue({ createdAt: '2026-08-01T00:00:00+00:00', status: 'open', resolvedAt: '2026-08-05T00:00:00+00:00' }),
    ], TODAY)
    const at = (weekStart: string) => t.points.find(p => p.weekStart === weekStart)!
    expect(at('2026-06-08')).toMatchObject({ created: 1, resolved: 0, backlog: 1 })
    expect(at('2026-08-10')).toMatchObject({ created: 3, resolved: 0 })
    expect(at('2026-08-17')).toMatchObject({ created: 3, resolved: 1, backlog: 2 })
    expect(at('2026-08-24')).toMatchObject({ created: 4, resolved: 1, backlog: 3 })
    expect(t.max).toBe(4)
  })

  it('주별 증감(createdNew·resolvedNew)은 그 주 안에 등록·해결된 건수 — 누적 차와 일치', () => {
    const t = issueTrend([
      issue({ createdAt: '2026-08-10T00:00:00+00:00', status: 'resolved', resolvedAt: '2026-08-20T00:00:00+00:00' }),
      issue({ createdAt: '2026-08-12T00:00:00+00:00' }),
      issue({ createdAt: '2026-08-26T00:00:00+00:00' }),
    ], TODAY)
    const at = (weekStart: string) => t.points.find(p => p.weekStart === weekStart)!
    expect(at('2026-08-10')).toMatchObject({ createdNew: 2, resolvedNew: 0 })
    expect(at('2026-08-17')).toMatchObject({ createdNew: 0, resolvedNew: 1 })
    expect(at('2026-08-24')).toMatchObject({ createdNew: 1, resolvedNew: 0 })
    // 창 이전 등록분은 첫 주 증감에 섞이지 않는다(누적에만 포함)
    const t2 = issueTrend([issue({ createdAt: '2026-01-05T00:00:00+00:00' })], TODAY)
    expect(t2.points[0]).toMatchObject({ created: 1, createdNew: 0 })
  })

  it('타임스탬프는 서울 날짜로 버킷팅한다 — UTC 일요일 15:30 은 KST 월요일', () => {
    const t = issueTrend([issue({ createdAt: '2026-08-23T15:30:00Z' })], TODAY)
    const at = (weekStart: string) => t.points.find(p => p.weekStart === weekStart)!
    expect(at('2026-08-17').created).toBe(0)
    expect(at('2026-08-24').created).toBe(1)
  })

  it('이슈 0건이면 empty', () => {
    expect(issueTrend([], TODAY).empty).toBe(true)
    expect(issueTrend([issue()], TODAY).empty).toBe(false)
  })

  it('weeks 인자로 창 길이를 바꿀 수 있다', () => {
    expect(issueTrend([issue()], TODAY, 4).points.map(p => p.weekStart))
      .toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'])
  })
})

describe('issueQueue', () => {
  it('지연은 경과일 내림차순 먼저, 그다음 임박은 D-day 오름차순', () => {
    const q = issueQueue([
      issue({ id: 'soon5', dueDate: '2026-09-02' }),
      issue({ id: 'over3', dueDate: '2026-08-25' }),
      issue({ id: 'soon0', dueDate: '2026-08-28' }),
      issue({ id: 'over14', dueDate: '2026-08-14' }),
    ], TODAY)
    expect(q.rows.map(r => [r.issue.id, r.kind, r.days])).toEqual([
      ['over14', 'overdue', 14], ['over3', 'overdue', 3], ['soon0', 'dueSoon', 0], ['soon5', 'dueSoon', 5],
    ])
    expect(q.overdueCount).toBe(2)
    expect(q.dueSoonCount).toBe(2)
  })

  it('해결·기한 없음·D-8 이후는 제외', () => {
    expect(DUE_SOON_DAYS).toBe(7)
    const q = issueQueue([
      issue({ dueDate: '2026-08-01', status: 'resolved', resolvedAt: '2026-08-02T00:00:00+00:00' }),
      issue({ dueDate: null }),
      issue({ dueDate: '2026-09-05' }), // D-8
      issue({ dueDate: '2026-09-04' }), // D-7 → 포함
    ], TODAY)
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0].days).toBe(7)
  })

  it('같은 일수면 심각도 높음이 앞', () => {
    const q = issueQueue([
      issue({ id: 'low', dueDate: '2026-08-20', severity: 'low' }),
      issue({ id: 'high', dueDate: '2026-08-20', severity: 'high' }),
    ], TODAY)
    expect(q.rows.map(r => r.issue.id)).toEqual(['high', 'low'])
  })

  it('상한(기본 5)을 넘는 건수는 hiddenCount 로 알린다 — 조용히 자르지 않는다', () => {
    expect(QUEUE_LIMIT).toBe(5)
    const many = Array.from({ length: 7 }, (_, i) => issue({ dueDate: `2026-08-${String(10 + i).padStart(2, '0')}` }))
    const q = issueQueue(many, TODAY)
    expect(q.rows).toHaveLength(5)
    expect(q.hiddenCount).toBe(2)
    expect(issueQueue(many, TODAY, 10).hiddenCount).toBe(0)
  })
})
