import { describe, expect, it, vi } from 'vitest'
import { createCompareWeeklySheetsTool, createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryOk, type WeeklyRepository, type WeeklySheetSnapshot,
} from '@/lib/repositories/types'

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

function snapshot(sections: string[]): WeeklySheetSnapshot {
  return {
    report: {
      id: 'r1', projectId: 'p1', weekStart: '2026-07-20',
      title: '2026-07-20 주간업무', updatedAt: '2026-07-20T01:00:00Z',
    },
    rows: sections.map((section, i) => ({
      id: `row-${i}`, reportId: 'r1', section, module: '', sortOrder: i + 1,
      thisContent: `${section} 업무`, thisIssue: '', nextContent: '', nextIssue: '',
      updatedAt: '2026-07-20T02:00:00Z',
    })),
  }
}

describe('MES 팀 필터가 조업·표준화를 모두 잡는다', () => {
  // 매칭은 문자열 완전일치라, 구분을 쪼개고 팀 매핑을 안 고치면 오류가 아니라 '조회 건수 감소'로
  // 나타난다 — 사람이 알아채기 가장 어려운 실패다. 폐지된 통합 구분도 계속 잡혀야 한다.
  it('조업·표준화·조업및표준화 셋 다 MES 로 조회된다', async () => {
    const sheet = snapshot(['PMO', '영업', '조업', '표준화', '조업및표준화', '물류'])
    const repo: WeeklyRepository = { getSheet: vi.fn(async () => repositoryOk(sheet)) }

    const mes = await createGetWeeklySheetTool(repo).execute(
      { projectId: 'p1', weekStart: '2026-07-20', team: 'MES' }, context,
    )

    expect(mes.ok && mes.result.records.map((r: { section: string }) => r.section))
      .toEqual(['조업', '표준화', '조업및표준화', '물류'])
  })
})
