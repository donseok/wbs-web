import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSession = vi.fn(async (): Promise<unknown> => ({ user: { id: 'u1' } }))
vi.mock('@/lib/auth', () => ({ getSession: (...a: unknown[]) => getSession(...(a as [])) }))
const loadWeeklyRows = vi.fn(async (): Promise<unknown[]> => [])
vi.mock('@/lib/data/weeklySheet', () => ({
  loadWeeklyRows: (...a: unknown[]) => loadWeeklyRows(...(a as [])),
  // actions/weekly.ts가 같은 모듈에서 함께 임포트하는 이름들 — 모킹 필수
  getWeeklySheet: vi.fn(),
  findCarryOverSource: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { previewWeeklyFormat } from '@/app/actions/weekly'

describe('previewWeeklyFormat — DB 저장 상태 기준 양식 검사', () => {
  beforeEach(() => {
    getSession.mockClear()
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    loadWeeklyRows.mockClear()
    loadWeeklyRows.mockResolvedValue([])
  })

  it('미로그인 거부', async () => {
    getSession.mockResolvedValueOnce(null)
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({ ok: false, error: '로그인 필요' })
    expect(loadWeeklyRows).not.toHaveBeenCalled()
  })

  it('빈 시트 → 빈 edits', async () => {
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({ ok: true, edits: [] })
    expect(loadWeeklyRows).toHaveBeenCalledWith('r1')
  })

  it('변경 있는 행 → edits 반환', async () => {
    loadWeeklyRows.mockResolvedValueOnce([{
      id: 'a', reportId: 'r1', section: 'PMO', module: '', sortOrder: 1,
      thisContent: '-메모', thisIssue: '', nextContent: '', nextIssue: '',
    }])
    expect(await previewWeeklyFormat('p1', 'r1')).toEqual({
      ok: true,
      edits: [{ rowId: 'a', cellKey: 'this_content', section: 'PMO', before: '-메모', after: '  -. 메모' }],
    })
  })

  it('조회 실패 → ok:false + 사람이 읽는 에러(에러 삼킴 금지)', async () => {
    loadWeeklyRows.mockRejectedValueOnce(new Error('boom'))
    const res = await previewWeeklyFormat('p1', 'r1')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('양식 검사')
  })
})
