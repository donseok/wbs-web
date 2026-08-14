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

/** getWeeklySheet 가 쓰는 supabase 클라이언트 흉내. insert 호출을 그대로 돌려준다. */
function stubClient(oldRows: DbRow[]) {
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
  const rowsTable = { select: vi.fn(() => rowsQuery), insert }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'weekly_reports') return reportQuery
      if (table === 'weekly_report_rows') return rowsTable
      throw new Error(`unexpected table: ${table}`)
    }),
  }
  mocks.createServerClient.mockResolvedValue(client as never)
  return { insert }
}

describe('getWeeklySheet 표준 행 지연 백필', () => {
  it('이관된 시트에 빈 표준화 행 하나만 추가하고 조업과 물류 사이에 반환한다', async () => {
    // 과거 시트의 sort_order 는 주차마다 값이 다르고 중복·역전도 있다(PMO 를 백필한 주차는
    // 음수, 그 뒤 주차는 1..10). 숫자만 정렬해서는 중간에 삽입된 표준화를 제자리에 놓을 수 없다.
    const oldRows = [
      row('PMO', 100),
      row('영업', 8),
      row('구매', 8),
      row('관리회계', 900),
      row('품질', 5),
      row('생산계획', -2),
      row('조업', 30),
      row('물류', 4),
      row('설비및L2', 4),
      row('가공', 1),
    ].sort((a, b) => a.sort_order - b.sort_order)
    const { insert } = stubClient(oldRows)

    const sheet = await getWeeklySheet('project-1', '2026-08-03')

    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith([{
      report_id: REPORT_ID,
      section: '표준화',
      module: '',
      sort_order: 8,
      this_content: '',
      this_issue: '',
      next_content: '',
      next_issue: '',
    }])
    expect(sheet?.rows).toHaveLength(11)
    expect(sheet?.rows.map(r => r.section)).toEqual([
      'PMO', '영업', '구매', '관리회계', '품질', '생산계획',
      '조업', '표준화', '물류', '설비및L2', '가공',
    ])
    expect(sheet?.rows[7]).toMatchObject({
      id: 'backfill-1',
      section: '표준화',
      module: '',
      sortOrder: 8,
      thisContent: '',
      thisIssue: '',
      nextContent: '',
      nextIssue: '',
    })
  })

  it('이관 전 시트에는 조업·표준화 빈 행을 더하되 조업및표준화 행의 내용은 건드리지 않고 끝으로 민다', async () => {
    // 데이터 이관보다 코드가 먼저 배포된 창(또는 복원본)에서의 모습. 내용을 옮기는 것은
    // 백필의 일이 아니다 — 순수 추가만 하고, 옛 행은 비표준이 되어 표준 구분 뒤에 남는다.
    const oldRows = [
      row('PMO', 1), row('영업', 2), row('구매', 3), row('관리회계', 4), row('품질', 5),
      row('생산계획', 6), row('조업및표준화', 7), row('물류', 8), row('설비및L2', 9), row('가공', 10),
    ]
    const { insert } = stubClient(oldRows)

    const sheet = await getWeeklySheet('project-1', '2026-08-03')

    expect(insert).toHaveBeenCalledTimes(1)
    expect((insert.mock.calls[0][0] as Omit<DbRow, 'id'>[]).map(v => v.section)).toEqual(['조업', '표준화'])
    expect(sheet?.rows.map(r => r.section)).toEqual([
      'PMO', '영업', '구매', '관리회계', '품질', '생산계획',
      '조업', '표준화', '물류', '설비및L2', '가공', '조업및표준화',
    ])
    expect(sheet?.rows.find(r => r.section === '조업및표준화')?.thisContent).toBe('조업및표준화 기존 내용')
    expect(sheet?.rows.find(r => r.section === '조업')?.thisContent).toBe('')
  })

  it('표준 구분이 하나도 없는 완전 레거시 시트는 백필 대상이 아니다', async () => {
    const { insert } = stubClient([row('ERP', 1), row('MES', 2), row('공통', 3)])

    const sheet = await getWeeklySheet('project-1', '2026-08-03')

    expect(insert).not.toHaveBeenCalled()
    expect(sheet?.rows).toHaveLength(3)
  })
})
