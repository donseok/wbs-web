import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { getWeeklySheet } from '@/lib/data/weeklySheet'

type DbRow = {
  id: string
  report_id: string
  section: string
  module: string
  sort_order: number
  this_content: string
  this_issue: string
  next_content: string
  next_issue: string
}

const REPORT_ID = 'report-1'

function row(section: string, sortOrder: number): DbRow {
  return {
    id: `row-${section}`,
    report_id: REPORT_ID,
    section,
    module: '',
    sort_order: sortOrder,
    this_content: `${section} 기존 내용`,
    this_issue: '',
    next_content: '',
    next_issue: '',
  }
}

describe('getWeeklySheet 표준 행 지연 백필', () => {
  it('기존 10행에 빈 재무회계 행 하나만 추가하고 관리회계와 품질 사이에 반환한다', async () => {
    // 과거 시트의 sort_order는 중복·역전돼 있다. 새 행도 품질과 5로 충돌하므로
    // 숫자만 정렬해서는 재무회계를 요구된 업무 순서에 놓을 수 없다.
    const oldRows = [
      row('PMO', 100),
      row('영업', 8),
      row('구매', 8),
      row('관리회계', 900),
      row('품질', 5),
      row('생산계획', -2),
      row('조업및표준화', 30),
      row('물류', 4),
      row('설비및L2', 4),
      row('가공', 1),
    ].sort((a, b) => a.sort_order - b.sort_order)

    const reportQuery: Record<string, unknown> = {}
    reportQuery.select = vi.fn(() => reportQuery)
    reportQuery.eq = vi.fn(() => reportQuery)
    reportQuery.maybeSingle = vi.fn(async () => ({
      data: {
        id: REPORT_ID,
        project_id: 'project-1',
        week_start: '2026-08-03',
        title: '기존 주간업무',
      },
      error: null,
    }))

    const rowsQuery: Record<string, unknown> = {}
    rowsQuery.eq = vi.fn(() => rowsQuery)
    rowsQuery.order = vi.fn(async () => ({ data: oldRows, error: null }))

    const insert = vi.fn((values: Omit<DbRow, 'id'>[]) => ({
      select: vi.fn(async () => ({
        data: values.map((value, i) => ({ id: `backfill-${i + 1}`, ...value })),
        error: null,
      })),
    }))
    const rowsTable = {
      select: vi.fn(() => rowsQuery),
      insert,
    }
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'weekly_reports') return reportQuery
        if (table === 'weekly_report_rows') return rowsTable
        throw new Error(`unexpected table: ${table}`)
      }),
    }
    mocks.createServerClient.mockResolvedValue(client as never)

    const sheet = await getWeeklySheet('project-1', '2026-08-03')

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith([{
      report_id: REPORT_ID,
      section: '재무회계',
      module: '',
      sort_order: 5,
      this_content: '',
      this_issue: '',
      next_content: '',
      next_issue: '',
    }])
    expect(sheet?.rows).toHaveLength(11)
    expect(sheet?.rows.map(r => r.section)).toEqual([
      'PMO', '영업', '구매', '관리회계', '재무회계', '품질', '생산계획',
      '조업및표준화', '물류', '설비및L2', '가공',
    ])
    expect(sheet?.rows[4]).toMatchObject({
      id: 'backfill-1',
      section: '재무회계',
      module: '',
      sortOrder: 5,
      thisContent: '',
      thisIssue: '',
      nextContent: '',
      nextIssue: '',
    })
  })
})
