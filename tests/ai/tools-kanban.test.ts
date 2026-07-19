import { describe, expect, it, vi } from 'vitest'
import { createGetKanbanViewTool, type KanbanColumnRecord } from '@/lib/ai/tools/kanban'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type {
  RepositoryResult,
  WbsBotRepository,
  WbsProjectSnapshot,
  WbsRepositoryItem,
} from '@/lib/repositories/types'
import { repositoryError, repositoryOk } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-1',
  capabilities: ['kanban:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

function item(overrides: Partial<WbsRepositoryItem> & { id: string }): WbsRepositoryItem {
  return {
    projectId: 'p1', parentId: null, level: 'task', code: '', sortOrder: 1,
    name: overrides.id, biz: null, deliverable: null, plannedStart: null, plannedEnd: null,
    weight: null, actualPct: null, owners: [], updatedAt: null,
    ...overrides,
  }
}

// baseDate 2026-07-20(월) 기준 상태: task-1=done, task-2=delayed(30<60),
// task-3=in_progress(50>=20), task-4/task-5=not_started(미래 시작)
const snapshot: WbsProjectSnapshot = {
  projectId: 'p1',
  baseDate: '2026-07-20',
  holidays: [],
  items: [
    item({ id: 'phase-1', level: 'phase', code: '1', name: '구축' }),
    item({
      id: 'task-1', parentId: 'phase-1', code: '1.1', name: 'ERP 설계', sortOrder: 1,
      plannedStart: '2026-07-13', plannedEnd: '2026-07-17', actualPct: 100,
      owners: [{ team: 'ERP', kind: 'primary' }], updatedAt: '2026-07-17T00:00:00Z',
    }),
    item({
      id: 'task-2', parentId: 'phase-1', code: '1.2', name: 'MES 인터페이스', sortOrder: 2,
      plannedStart: '2026-07-13', plannedEnd: '2026-07-24', actualPct: 30,
      owners: [{ team: 'MES', kind: 'primary' }, { team: 'ERP', kind: 'support' }],
    }),
    item({
      id: 'task-3', parentId: 'phase-1', code: '1.3', name: 'ERP 개발', sortOrder: 3,
      plannedStart: '2026-07-20', plannedEnd: '2026-07-24', actualPct: 50,
      owners: [{ team: 'ERP', kind: 'primary' }],
    }),
    item({
      id: 'task-4', parentId: 'phase-1', code: '1.4', name: '미배정 작업', sortOrder: 4,
      plannedStart: '2026-07-27', plannedEnd: '2026-07-31', actualPct: 0,
    }),
    item({ id: 'phase-2', level: 'phase', code: '2', name: '오픈', sortOrder: 2 }),
    item({
      id: 'task-5', parentId: 'phase-2', code: '2.1', name: '오픈 준비', sortOrder: 1,
      plannedStart: '2026-08-03', plannedEnd: '2026-08-07', actualPct: 0,
      owners: [{ team: 'PMO', kind: 'primary' }],
    }),
  ],
  dependencies: [],
}

function botRepository(result: RepositoryResult<WbsProjectSnapshot | null>) {
  return {
    getProjectSnapshot: vi.fn(async () => result),
    // 칸반 도구는 스냅샷 외 어떤 조회도 호출하지 않는다 — 호출되면 즉시 실패시킨다.
    getChangeLog: vi.fn(async () => { throw new Error('칸반 도구는 변경 이력을 조회하지 않는다') }),
    listAttachmentMetadata: vi.fn(async () => { throw new Error('칸반 도구는 첨부 메타데이터를 조회하지 않는다') }),
  } satisfies WbsBotRepository
}

function columnByKey(records: KanbanColumnRecord[], key: string): KanbanColumnRecord | undefined {
  return records.find(record => record.columnKey === key)
}

describe('get_kanban_view', () => {
  it('returns the status board by default with distribution facts and focus-deep-linked sources', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const result = await createGetKanbanViewTool(repository).execute({ projectId: 'p1' }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.facts).toMatchObject({
      projectFound: true,
      totalCards: 5,
      notStartedCount: 2,
      inProgressCount: 1,
      delayedCount: 1,
      doneCount: 1,
      returned: 5,
      calculationDate: '2026-07-20',
    })
    expect(result.result.records.map(record => record.columnKey))
      .toEqual(['not_started', 'in_progress', 'delayed', 'done'])
    expect(columnByKey(result.result.records, 'not_started')).toMatchObject({
      columnTitle: '시작전', count: 2,
    })
    expect(columnByKey(result.result.records, 'done')?.cards).toEqual([{
      id: 'task-1', code: '1.1', name: 'ERP 설계', status: 'done',
      team: 'ERP', plannedEnd: '2026-07-17', actualPct: 100,
    }])

    // 출처 = 칸반 메뉴 루트 1건 + 카드당 1건(?focus= 필수). 루트는 실제 보기(view)를 복원한다.
    expect(result.result.sources[0]).toMatchObject({
      id: 'kanban:p1', domain: 'kanban', entityType: 'project', entityId: 'p1',
      href: '/p/p1/kanban?view=status', updatedAt: null,
    })
    const cardSources = result.result.sources.slice(1)
    expect(cardSources).toHaveLength(5)
    for (const source of cardSources) {
      expect(source.href).toBe(`/p/p1/wbs?focus=${source.entityId}`)
    }
    expect(cardSources.find(source => source.entityId === 'task-1')?.updatedAt)
      .toBe('2026-07-17T00:00:00Z')
    expect(repository.getChangeLog).not.toHaveBeenCalled()
    expect(repository.listAttachmentMetadata).not.toHaveBeenCalled()
  })

  it('groups by phase and by owner, sending unassigned cards to 미배정', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const tool = createGetKanbanViewTool(repository)

    const phase = await tool.execute({ projectId: 'p1', view: 'phase' }, context)
    expect(phase.ok).toBe(true)
    if (phase.ok) {
      expect(phase.result.records.map(record => record.columnTitle)).toEqual(['구축', '오픈'])
      expect(columnByKey(phase.result.records, 'phase-1')?.count).toBe(4)
      expect(columnByKey(phase.result.records, 'phase-2')?.count).toBe(1)
    }

    const owner = await tool.execute({ projectId: 'p1', view: 'owner' }, context)
    expect(owner.ok).toBe(true)
    if (owner.ok) {
      expect(owner.result.records.map(record => record.columnKey))
        .toEqual(['PMO', 'ERP', 'MES', '가공', 'MDM', '미배정'])
      expect(columnByKey(owner.result.records, 'ERP')?.cards.map(card => card.id))
        .toEqual(['task-1', 'task-3'])
      expect(columnByKey(owner.result.records, '미배정')?.cards.map(card => card.id))
        .toEqual(['task-4'])
      // support 담당은 컬럼 배치에 포함되지 않는다
      expect(columnByKey(owner.result.records, 'ERP')?.cards.map(card => card.id))
        .not.toContain('task-2')
      expect(owner.result.facts.totalCards).toBe(5)
    }
  })

  it('applies team filter on primary owners only and status filter on card status', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const tool = createGetKanbanViewTool(repository)

    const byTeam = await tool.execute({ projectId: 'p1', team: 'ERP' }, context)
    expect(byTeam.ok).toBe(true)
    if (byTeam.ok) {
      // task-2는 ERP support라 제외 — primary만 매칭
      expect(byTeam.result.facts).toMatchObject({
        totalCards: 2, doneCount: 1, inProgressCount: 1, delayedCount: 0, notStartedCount: 0,
      })
      expect(columnByKey(byTeam.result.records, 'delayed')?.count).toBe(0)
    }

    const byStatus = await tool.execute({ projectId: 'p1', view: 'phase', status: 'delayed' }, context)
    expect(byStatus.ok).toBe(true)
    if (byStatus.ok) {
      expect(byStatus.result.facts.totalCards).toBe(1)
      expect(columnByKey(byStatus.result.records, 'phase-1')?.cards.map(card => card.id))
        .toEqual(['task-2'])
      expect(columnByKey(byStatus.result.records, 'phase-2')?.count).toBe(0)
    }
  })

  it('caps cards per column and reports truncation honestly', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const result = await createGetKanbanViewTool(repository).execute(
      { projectId: 'p1', cardLimit: 1 }, context,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.truncated).toBe(true)
    expect(result.result.status).toBe('partial')
    expect(result.result.warnings.length).toBeGreaterThan(0)
    const notStarted = columnByKey(result.result.records, 'not_started')
    expect(notStarted?.count).toBe(2)
    expect(notStarted?.cards).toHaveLength(1)
    expect(result.result.facts).toMatchObject({ totalCards: 5, returned: 4 })
  })

  it('clamps cardLimit above the maximum to 10', async () => {
    const manyTasks: WbsProjectSnapshot = {
      projectId: 'p1', baseDate: '2026-07-20', holidays: [], dependencies: [],
      items: [
        item({ id: 'phase-1', level: 'phase', code: '1', name: '구축' }),
        ...Array.from({ length: 12 }, (_, index) => item({
          id: `task-${index}`, parentId: 'phase-1', code: `1.${index}`, sortOrder: index,
          plannedStart: '2026-08-03', plannedEnd: '2026-08-07', actualPct: 0,
        })),
      ],
    }
    const result = await createGetKanbanViewTool(botRepository(repositoryOk(manyTasks))).execute(
      { projectId: 'p1', cardLimit: 50 }, context,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(columnByKey(result.result.records, 'not_started')?.cards).toHaveLength(10)
    expect(result.result.truncated).toBe(true)
  })

  it('treats an empty project as a valid empty board', async () => {
    const empty: WbsProjectSnapshot = {
      projectId: 'p1', baseDate: null, holidays: [], items: [], dependencies: [],
    }
    const result = await createGetKanbanViewTool(botRepository(repositoryOk(empty))).execute(
      { projectId: 'p1' }, context,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.facts).toMatchObject({ projectFound: true, totalCards: 0, returned: 0 })
    expect(result.result.records).toHaveLength(4)
    expect(result.result.records.every(record => record.count === 0)).toBe(true)
    expect(result.result.sources).toHaveLength(1)
  })

  it('reports a missing project as ok with projectFound=false', async () => {
    const result = await createGetKanbanViewTool(botRepository(repositoryOk(null))).execute(
      { projectId: 'p1' }, context,
    )
    expect(result).toMatchObject({
      ok: true,
      result: { facts: { projectFound: false, totalCards: 0, returned: 0 }, records: [], sources: [] },
    })
  })

  it('propagates repository failure without masking it as empty', async () => {
    const result = await createGetKanbanViewTool(
      botRepository(repositoryError('WBS_ITEMS_READ_FAILED', true)),
    ).execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'DATA_SOURCE_ERROR',
        retryable: true,
        repositoryErrorCode: 'WBS_ITEMS_READ_FAILED',
      },
    })
  })

  it('rejects invalid arguments before touching the repository', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const tool = createGetKanbanViewTool(repository)
    const invalidCalls: unknown[] = [
      'not-an-object',
      {},
      { projectId: 'p1', view: 'timeline' },
      { projectId: 'p1', team: 'QA' },
      { projectId: 'p1', status: 'blocked' },
      { projectId: 'p1', cardLimit: 0 },
      { projectId: 'p1', cardLimit: 1.5 },
      { projectId: 'p1', cardLimit: '5' },
      { projectId: 'p1', view: 7 },
    ]
    for (const args of invalidCalls) {
      await expect(tool.execute(args, context)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      })
    }
    expect(repository.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('fails closed on project scope and capability before repository access', async () => {
    const repository = botRepository(repositoryOk(snapshot))
    const tool = createGetKanbanViewTool(repository)

    await expect(tool.execute({ projectId: 'p2' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'ACCESS_DENIED' },
    })
    await expect(
      tool.execute({ projectId: 'p1' }, { ...context, capabilities: ['wbs:read'] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getProjectSnapshot).not.toHaveBeenCalled()
  })

  it('rejects repository rows that widen the requested project scope', async () => {
    const tool1 = createGetKanbanViewTool(botRepository(repositoryOk({ ...snapshot, projectId: 'p2' })))
    await expect(tool1.execute({ projectId: 'p1' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'DATA_SOURCE_ERROR' },
    })

    const rogueItems: WbsProjectSnapshot = {
      ...snapshot,
      items: [...snapshot.items, item({ id: 'rogue-1', projectId: 'p2' })],
    }
    const tool2 = createGetKanbanViewTool(botRepository(repositoryOk(rogueItems)))
    await expect(tool2.execute({ projectId: 'p1' }, context)).resolves.toMatchObject({
      ok: false, error: { code: 'DATA_SOURCE_ERROR' },
    })
  })

  it('never serializes PII or storage internals', async () => {
    const result = await createGetKanbanViewTool(botRepository(repositoryOk(snapshot))).execute(
      { projectId: 'p1' }, context,
    )
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|filePath|signed|note/i)
  })
})
