import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 목록의 클립 배지(fileCount)는 **첨부 수**다 — 본문 .md 파일을 세지 않는다.
 *
 * 배경: LIST_COLS 가 `minute_files(count)` 를 쓰던 동안 배지는 본문 파일까지 셌다.
 * 2026-09-26 실측으로 운영의 minute_files 23행이 전부 role='body' 였고, 첨부는 0건인데
 * 23건의 회의록이 `📎 1` 을 달고 있었다 — 배지가 100% 거짓이었다.
 *
 * 고치는 방법이 하나로 정해진 이유(스테이징 PostgREST 실측):
 *   - `select=minute_id,count()` 집계 → PGRST123 "aggregate functions is not allowed" (비활성)
 *   - `minute_files(count)` + 임베드 필터 → **필터가 무시된다**(!inner 를 붙여도 자식 없는
 *     부모가 그대로 남는다). 이 길로 고치면 배지가 조용히 다시 본문을 센다.
 *   - `minute_files(id)` 비집계 임베드 + 임베드 필터 → 정확히 동작하고 부모도 유지된다.
 *     PostgREST max_rows(1000)는 top-level 행에만 걸리므로 절단 위험도 없다.
 *
 * 그래서 이 테스트는 두 가지를 못 박는다 — (1) 임베드가 집계가 아니어야 하고,
 * (2) 목록 쿼리 **전부**가 role 필터를 걸어야 한다. 필터를 빼먹은 목록 함수가 하나라도
 * 생기면 그 화면의 배지만 조용히 본문을 세기 시작한다.
 */

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: vi.fn(async () => new Set<string>()) }))

import { getMinutesExplorer, getMinutesPage, searchMinutes } from '@/lib/data/minutes'

type Row = Record<string, unknown>

function minuteRow(id: string, attachmentRows: Row[]): Row {
  return {
    id, minute_date: '2026-09-01', team_code: 'ERP', title: `회의 ${id}`,
    meeting_id: null, project_id: null, meeting_occurrence_date: null, archived_at: null,
    created_by: 'u1', created_by_name: '홍길동',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    body_preview: '', folder_id: null, external_id: null,
    minute_files: attachmentRows, meetings: null, projects: null,
  }
}

/** select 문자열과 eq 인자를 기록하는 thenable 빌더. */
function spyDb(rows: Row[], folderRows: Row[] = []) {
  const selects: string[] = []
  const eqs: unknown[][] = []
  const from = vi.fn((table: string) => {
    const result = table === 'minutes'
      ? { data: rows, error: null }
      : { data: folderRows, error: null }
    const b: Record<string, unknown> & { then?: unknown } = {}
    for (const m of ['is', 'gte', 'lte', 'or', 'order', 'limit', 'not', 'in']) {
      b[m] = vi.fn(() => b)
    }
    b.select = vi.fn((cols: unknown) => {
      if (table === 'minutes') selects.push(String(cols))
      return b
    })
    b.eq = vi.fn((...a: unknown[]) => { if (table === 'minutes') eqs.push(a); return b })
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej)
    return b
  })
  return { from, selects, eqs }
}

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { consoleError.mockRestore() })

describe('클립 배지는 첨부만 센다', () => {
  it('첨부 임베드가 집계(count)가 아니라 행을 가져온다', async () => {
    const db = spyDb([minuteRow('m1', [])])
    mocks.createServerClient.mockResolvedValue(db)

    await getMinutesPage('2026-09-01', '2026-09-30', null)

    // `minute_files(count)` 는 임베드 필터가 무시되는 형태라 쓸 수 없다(스테이징 실측).
    expect(db.selects[0]).not.toContain('minute_files(count)')
    expect(db.selects[0]).toContain('minute_files(')
  })

  it('본문 파일만 있는 회의록의 배지는 0이다', async () => {
    // 임베드에 role 필터가 걸리므로 본문 파일은 애초에 임베드 배열에 오지 않는다.
    const db = spyDb([minuteRow('m1', [])])
    mocks.createServerClient.mockResolvedValue(db)

    const [minute] = await getMinutesPage('2026-09-02', '2026-09-30', null)

    expect(minute.fileCount).toBe(0)
  })

  it('첨부 2개면 배지는 2다', async () => {
    const db = spyDb([minuteRow('m1', [{ id: 'f1' }, { id: 'f2' }])])
    mocks.createServerClient.mockResolvedValue(db)

    const [minute] = await getMinutesPage('2026-09-03', '2026-09-30', null)

    expect(minute.fileCount).toBe(2)
  })

  it('탐색기 리프에도 같은 첨부 수가 실린다', async () => {
    const db = spyDb([minuteRow('m1', [{ id: 'f1' }])])
    mocks.createServerClient.mockResolvedValue(db)

    const data = await getMinutesExplorer()

    expect(data?.leaves[0]?.fileCount).toBe(1)
  })

  // 불변식 — 목록 쿼리가 하나라도 필터를 빼먹으면 그 화면만 조용히 본문을 센다.
  it.each([
    ['getMinutesPage', () => getMinutesPage('2026-09-04', '2026-09-30', null)],
    ['searchMinutes', () => searchMinutes('설계', null)],
    ['getMinutesExplorer', () => getMinutesExplorer()],
  ])('%s 는 임베드를 role=attachment 로 한정한다', async (_name, run) => {
    const db = spyDb([minuteRow('m1', [])])
    mocks.createServerClient.mockResolvedValue(db)

    await run()

    expect(db.eqs).toEqual(expect.arrayContaining([['minute_files.role', 'attachment']]))
  })
})
