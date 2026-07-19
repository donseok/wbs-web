import { describe, expect, it, vi } from 'vitest'
import { createGetMemberWorkloadTool, createListMembersTool } from '@/lib/ai/tools/members'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type {
  MemberRepository,
  MemberRepositoryRecord,
  WbsBotRepository,
  WbsProjectSnapshot,
} from '@/lib/repositories/types'
import { repositoryError, repositoryOk } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-1',
  capabilities: ['members:read', 'wbs:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-22T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

const memberRows: MemberRepositoryRecord[] = [
  {
    id: 'member-1', projectId: 'p1', name: '김ERP', teamCode: 'ERP', role: 'admin',
    title: 'ERP 리드', hasAccount: true, createdAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 'member-2', projectId: 'p1', name: '이ERP', teamCode: 'ERP', role: 'contributor',
    title: null, hasAccount: false, createdAt: '2026-07-02T00:00:00Z',
  },
  {
    id: 'member-3', projectId: 'p1', name: '박MES', teamCode: 'MES', role: 'contributor',
    title: null, hasAccount: true, createdAt: '2026-07-03T00:00:00Z',
  },
  {
    id: 'member-4', projectId: 'p1', name: '최PMO', teamCode: 'PMO', role: 'admin',
    title: 'PM', hasAccount: true, createdAt: '2026-07-04T00:00:00Z',
  },
  {
    id: 'member-5', projectId: 'p1', name: '신입', teamCode: null, role: 'contributor',
    title: null, hasAccount: false, createdAt: '2026-07-05T00:00:00Z',
  },
]

function memberRepository(rows: MemberRepositoryRecord[]): MemberRepository {
  return { listMembers: vi.fn(async () => repositoryOk(rows)) }
}

// baseDate 2026-07-22(수) 기준: 07-20~07-24 계획 구간의 planned=60이라
// actual 30은 delayed, 70은 in_progress, 100은 done으로 결정적으로 판정된다.
const wbsSnapshot: WbsProjectSnapshot = {
  projectId: 'p1',
  baseDate: '2026-07-22',
  holidays: [],
  dependencies: [],
  items: [
    {
      id: 'phase-1', projectId: 'p1', parentId: null, level: 'phase', code: '1', sortOrder: 1,
      name: '구축', biz: null, deliverable: null, plannedStart: '2026-07-13', plannedEnd: '2026-07-24',
      weight: null, actualPct: null, owners: [], updatedAt: null,
    },
    {
      id: 'e1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.1', sortOrder: 1,
      name: 'ERP 설계', biz: null, deliverable: null, plannedStart: '2026-07-13', plannedEnd: '2026-07-17',
      weight: null, actualPct: 100, owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: null,
    },
    {
      id: 'e2', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.2', sortOrder: 2,
      name: 'ERP 개발', biz: null, deliverable: null, plannedStart: '2026-07-20', plannedEnd: '2026-07-24',
      weight: null, actualPct: 30, owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: null,
    },
    {
      id: 'm1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.3', sortOrder: 3,
      name: 'MES 개발', biz: null, deliverable: null, plannedStart: '2026-07-20', plannedEnd: '2026-07-24',
      weight: null, actualPct: 70, owners: [{ team: 'MES', kind: 'primary' }], updatedAt: null,
    },
    {
      id: 'u1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.4', sortOrder: 4,
      name: '미배정 작업', biz: null, deliverable: null, plannedStart: '2026-07-23', plannedEnd: '2026-07-24',
      weight: null, actualPct: 0, owners: [], updatedAt: null,
    },
    {
      // support 담당만 있는 leaf는 primary 미배정으로 취급되어야 한다.
      id: 's1', projectId: 'p1', parentId: 'phase-1', level: 'task', code: '1.5', sortOrder: 5,
      name: '지원 전용 작업', biz: null, deliverable: null, plannedStart: '2026-07-23', plannedEnd: '2026-07-24',
      weight: null, actualPct: 0, owners: [{ team: 'PMO', kind: 'support' }], updatedAt: null,
    },
  ],
}

function wbsRepository(
  result: Awaited<ReturnType<WbsBotRepository['getProjectSnapshot']>>,
): WbsBotRepository {
  return {
    getProjectSnapshot: vi.fn(async () => result),
    getChangeLog: vi.fn(),
    listAttachmentMetadata: vi.fn(),
  }
}

describe('list_members tool', () => {
  it('returns members with a single members-menu source and no email anywhere', async () => {
    const repository = memberRepository(memberRows)
    const result = await createListMembersTool(repository).execute({ projectId: 'p1' }, context)

    expect(result.ok && result.result.records).toHaveLength(5)
    if (result.ok) {
      expect(result.result.facts).toMatchObject({ memberCount: 5, returned: 5 })
      expect(result.result.sources).toHaveLength(1)
      expect(result.result.sources[0]).toMatchObject({
        domain: 'members', entityType: 'project', entityId: 'p1', href: '/p/p1/members',
      })
      expect(result.result.truncated).toBe(false)
      expect(result.result.asOf).toBe(context.now)
    }
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|signed/i)
  })

  it('filters by team and role', async () => {
    const tool = createListMembersTool(memberRepository(memberRows))

    const byTeam = await tool.execute({ projectId: 'p1', team: 'ERP' }, context)
    expect(byTeam.ok && byTeam.result.records.map(record => record.name)).toEqual(['김ERP', '이ERP'])

    const byRole = await tool.execute({ projectId: 'p1', role: 'admin' }, context)
    expect(byRole.ok && byRole.result.records.map(record => record.name)).toEqual(['김ERP', '최PMO'])

    const combined = await tool.execute({ projectId: 'p1', team: 'ERP', role: 'contributor' }, context)
    expect(combined.ok && combined.result.records.map(record => record.name)).toEqual(['이ERP'])
    if (combined.ok) expect(combined.result.facts).toMatchObject({ memberCount: 1, returned: 1 })
  })

  it('keeps a valid zero-member project as a successful empty result', async () => {
    const result = await createListMembersTool(memberRepository([])).execute({ projectId: 'p1' }, context)

    expect(result).toMatchObject({
      ok: true,
      result: { status: 'ok', facts: { memberCount: 0, returned: 0 }, records: [], truncated: false },
    })
  })

  it('truncates above the limit and says so', async () => {
    const result = await createListMembersTool(memberRepository(memberRows)).execute(
      { projectId: 'p1', limit: 2 }, context,
    )

    expect(result.ok && result.result.records).toHaveLength(2)
    if (result.ok) {
      expect(result.result).toMatchObject({ status: 'partial', truncated: true })
      expect(result.result.facts).toMatchObject({ memberCount: 5, returned: 2 })
      expect(result.result.warnings).toEqual(['멤버 5명 중 2명만 반환했습니다.'])
    }
  })

  it('rejects invalid arguments before touching the repository', async () => {
    const repository = memberRepository(memberRows)
    const tool = createListMembersTool(repository)

    const results = await Promise.all([
      tool.execute(null, context),
      tool.execute({}, context),
      tool.execute({ projectId: 'p1', team: 'QA' }, context),
      tool.execute({ projectId: 'p1', role: 'owner' }, context),
      tool.execute({ projectId: 'p1', limit: 0 }, context),
    ])
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    }
    expect(repository.listMembers).not.toHaveBeenCalled()
  })

  it('fails closed on project scope and capability before repository access', async () => {
    const repository = memberRepository(memberRows)
    const tool = createListMembersTool(repository)

    const outOfScope = await tool.execute({ projectId: 'p2' }, context)
    const noCapability = await tool.execute({ projectId: 'p1' }, { ...context, capabilities: [] })
    for (const result of [outOfScope, noCapability]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    }
    expect(repository.listMembers).not.toHaveBeenCalled()
  })

  it('keeps a repository failure distinct from an empty member list', async () => {
    const repository: MemberRepository = {
      listMembers: vi.fn(async () => repositoryError<MemberRepositoryRecord[]>('MEMBERS_READ_FAILED', true)),
    }
    await expect(createListMembersTool(repository).execute({ projectId: 'p1' }, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', retryable: true, repositoryErrorCode: 'MEMBERS_READ_FAILED' },
    })
  })

  it('rejects repository rows that widen the requested project scope without leaking them', async () => {
    const rogue = memberRepository([{ ...memberRows[0], projectId: 'p2', name: '다른 프로젝트 멤버' }])
    const result = await createListMembersTool(rogue).execute({ projectId: 'p1' }, context)

    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('다른 프로젝트 멤버')
  })
})

describe('get_member_workload tool', () => {
  it('aggregates leaf tasks per team with member names and never invents personal assignments', async () => {
    const tool = createGetMemberWorkloadTool(memberRepository(memberRows), wbsRepository(repositoryOk(wbsSnapshot)))
    const result = await tool.execute({ projectId: 'p1' }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.facts).toMatchObject({
      projectFound: true, memberCount: 5, totalLeafTasks: 5, returned: 4, calculationDate: '2026-07-22',
    })
    expect(result.result.records).toEqual([
      {
        projectId: 'p1', teamCode: 'PMO', memberNames: ['최PMO'], taskCount: 0,
        doneCount: 0, delayedCount: 0, inProgressCount: 0, notStartedCount: 0, avgActualPct: null,
      },
      {
        projectId: 'p1', teamCode: 'ERP', memberNames: ['김ERP', '이ERP'], taskCount: 2,
        doneCount: 1, delayedCount: 1, inProgressCount: 0, notStartedCount: 0, avgActualPct: 65,
      },
      {
        projectId: 'p1', teamCode: 'MES', memberNames: ['박MES'], taskCount: 1,
        doneCount: 0, delayedCount: 0, inProgressCount: 1, notStartedCount: 0, avgActualPct: 70,
      },
      {
        projectId: 'p1', teamCode: null, memberNames: ['신입'], taskCount: 2,
        doneCount: 0, delayedCount: 0, inProgressCount: 0, notStartedCount: 2, avgActualPct: 0,
      },
    ])
    expect(result.result.warnings).toContain('개인별 담당 데이터가 등록되지 않아 팀 단위로 집계했습니다.')
    expect(result.result.sources.map(source => source.href)).toEqual(['/p/p1/members', '/p/p1/wbs'])
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|signed/i)
  })

  it('filters aggregation to one team while keeping project-wide leaf totals', async () => {
    const tool = createGetMemberWorkloadTool(memberRepository(memberRows), wbsRepository(repositoryOk(wbsSnapshot)))
    const result = await tool.execute({ projectId: 'p1', team: 'ERP' }, context)

    expect(result.ok && result.result.records).toHaveLength(1)
    if (result.ok) {
      expect(result.result.records[0]).toMatchObject({ teamCode: 'ERP', taskCount: 2, avgActualPct: 65 })
      expect(result.result.facts).toMatchObject({ memberCount: 2, totalLeafTasks: 5, returned: 1 })
    }
  })

  it('keeps a missing project distinct from a repository failure', async () => {
    const tool = createGetMemberWorkloadTool(memberRepository(memberRows), wbsRepository(repositoryOk(null)))
    const result = await tool.execute({ projectId: 'p1' }, context)

    expect(result).toMatchObject({
      ok: true,
      result: {
        status: 'ok',
        facts: { projectFound: false, memberCount: 0, totalLeafTasks: 0, returned: 0 },
        records: [],
      },
    })
  })

  it('refuses to combine a partial success when either repository fails', async () => {
    const failedMembers: MemberRepository = {
      listMembers: vi.fn(async () => repositoryError<MemberRepositoryRecord[]>('MEMBERS_READ_FAILED', true)),
    }
    const membersFailed = await createGetMemberWorkloadTool(
      failedMembers, wbsRepository(repositoryOk(wbsSnapshot)),
    ).execute({ projectId: 'p1' }, context)
    expect(membersFailed).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'MEMBERS_READ_FAILED' },
    })

    const wbsFailed = await createGetMemberWorkloadTool(
      memberRepository(memberRows),
      wbsRepository(repositoryError<WbsProjectSnapshot | null>('WBS_ITEMS_READ_FAILED', true)),
    ).execute({ projectId: 'p1' }, context)
    expect(wbsFailed).toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'WBS_ITEMS_READ_FAILED' },
    })
    // 멤버 조회가 성공했더라도 실패 응답에 멤버 데이터가 섞여 나가면 안 된다.
    expect(JSON.stringify(wbsFailed)).not.toContain('김ERP')
  })

  it('rejects scope-widening rows from either repository', async () => {
    const rogueMembers = await createGetMemberWorkloadTool(
      memberRepository([{ ...memberRows[0], projectId: 'p2', name: '다른 프로젝트 멤버' }]),
      wbsRepository(repositoryOk(wbsSnapshot)),
    ).execute({ projectId: 'p1' }, context)
    expect(rogueMembers).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    expect(JSON.stringify(rogueMembers)).not.toContain('다른 프로젝트 멤버')

    const rogueWbs = await createGetMemberWorkloadTool(
      memberRepository(memberRows),
      wbsRepository(repositoryOk({ ...wbsSnapshot, projectId: 'p2' })),
    ).execute({ projectId: 'p1' }, context)
    expect(rogueWbs).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
  })

  it('fails closed on access and validates arguments before repository access', async () => {
    const members = memberRepository(memberRows)
    const wbs = wbsRepository(repositoryOk(wbsSnapshot))
    const tool = createGetMemberWorkloadTool(members, wbs)

    const results = await Promise.all([
      tool.execute({ projectId: 'p2' }, context),
      tool.execute({ projectId: 'p1' }, { ...context, capabilities: ['wbs:read'] }),
      tool.execute({}, context),
      tool.execute({ projectId: 'p1', team: '품질' }, context),
    ])
    expect(results[0]).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(results[1]).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(results[2]).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(results[3]).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(members.listMembers).not.toHaveBeenCalled()
    expect(wbs.getProjectSnapshot).not.toHaveBeenCalled()
  })
})
