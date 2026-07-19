import { describe, expect, it, vi } from 'vitest'
import { createCompareWeeklySheetsTool, createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type { WeeklyRepository } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-1',
  capabilities: ['weekly:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

// 인자 검증 단계 테스트 — 저장소에 도달하면 안 된다.
const repository: WeeklyRepository = {
  getSheet: vi.fn(async () => {
    throw new Error('검증 실패 인자가 저장소까지 내려왔다')
  }),
}

describe('주간업무 봇 도구 team 필터 검증', () => {
  it('MDM은 매핑된 구분이 없음을 명시적으로 안내한다 — 조용한 빈 결과 금지', async () => {
    const result = await createGetWeeklySheetTool(repository).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'MDM' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect((result as { error: { message: string } }).error.message).toContain('구분')
    expect(repository.getSheet).not.toHaveBeenCalled()
  })

  it('compare_weekly_sheets도 MDM을 동일하게 거절한다', async () => {
    const result = await createCompareWeeklySheetsTool(repository).execute(
      { projectId: 'p1', fromWeekStart: '2026-07-13', toWeekStart: '2026-07-20', team: 'MDM' }, context,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect((result as { error: { message: string } }).error.message).toContain('구분')
  })

  it('미지의 팀은 기존 문구로 거절한다', async () => {
    const result = await createGetWeeklySheetTool(repository).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'QA' }, context,
    )
    expect(result).toMatchObject({
      ok: false, error: { code: 'INVALID_ARGUMENT', message: '알 수 없는 담당팀입니다.' },
    })
  })
})
