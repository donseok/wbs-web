import { describe, expect, it, vi } from 'vitest'
import { createGetSafeProjectSettingsTool } from '@/lib/ai/tools/settings'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type { ProjectSettingsRepository, ProjectSettingsSnapshot } from '@/lib/repositories/types'
import { repositoryError, repositoryOk } from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-1',
  capabilities: ['settings:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

const snapshot: ProjectSettingsSnapshot = {
  projectId: 'p1',
  name: 'D-CUBE 구축',
  startDate: '2026-01-05',
  endDate: '2026-12-31',
  baseDate: '2026-07-18',
  holidays: ['2026-05-05', '2026-08-15', '2026-10-03'],
  wbsItemCount: 120,
  memberCount: 14,
  updatedAt: '2026-07-19T00:00:00Z',
}

function settingsRepository(
  result: Awaited<ReturnType<ProjectSettingsRepository['getSafeSettings']>>,
) {
  return { getSafeSettings: vi.fn(async () => result) } satisfies ProjectSettingsRepository
}

describe('get_safe_project_settings tool', () => {
  it('returns operational facts and holiday records with a settings menu source', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const tool = createGetSafeProjectSettingsTool(repository)

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({
      ok: true,
      result: {
        status: 'ok',
        facts: {
          projectFound: true,
          projectName: 'D-CUBE 구축',
          startDate: '2026-01-05',
          endDate: '2026-12-31',
          baseDate: '2026-07-18',
          holidayCount: 3,
          wbsItemCount: 120,
          memberCount: 14,
        },
        records: [{ date: '2026-05-05' }, { date: '2026-08-15' }, { date: '2026-10-03' }],
        sources: [{
          id: 'settings:p1',
          domain: 'settings',
          entityType: 'project',
          entityId: 'p1',
          projectId: 'p1',
          title: '프로젝트 설정',
          href: '/p/p1/settings',
          updatedAt: '2026-07-19T00:00:00Z',
        }],
        asOf: context.now,
        truncated: false,
        warnings: [],
      },
    })
    if (!result.ok) throw new Error('unreachable')
    // 미주입 시 색인 facts는 존재 자체가 없어야 한다(null로도 채우지 않는다).
    expect('indexFreshness' in result.result.facts).toBe(false)
    expect('indexedDocuments' in result.result.facts).toBe(false)
  })

  it('adds index facts only when the probe is injected and succeeds', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const probe = vi.fn(async () => ({ freshness: '2026-07-19T23:00:00Z', indexed: 42 }))
    const tool = createGetSafeProjectSettingsTool(repository, probe)

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({
      ok: true,
      result: {
        facts: { indexFreshness: '2026-07-19T23:00:00Z', indexedDocuments: 42 },
        warnings: [],
      },
    })
    expect(probe).toHaveBeenCalledWith('p1')
  })

  it('keeps the settings answer intact when the index probe rejects', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const probe = vi.fn(async () => { throw new Error('index probe down') })
    const tool = createGetSafeProjectSettingsTool(repository, probe)

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({
      ok: true,
      result: { status: 'ok', facts: { projectFound: true, projectName: 'D-CUBE 구축' } },
    })
    if (!result.ok) throw new Error('unreachable')
    expect('indexFreshness' in result.result.facts).toBe(false)
    expect('indexedDocuments' in result.result.facts).toBe(false)
    expect(result.result.warnings.some(warning => warning.includes('색인'))).toBe(true)
  })

  it('treats an invisible project as a successful not-found answer', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(null))
    const tool = createGetSafeProjectSettingsTool(repository)

    await expect(tool.execute({ projectId: 'p1' }, context)).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'ok',
        facts: { projectFound: false },
        records: [],
        sources: [],
        truncated: false,
      },
    })
  })

  it('surfaces a repository failure with its operation code instead of empty settings', async () => {
    const repository = settingsRepository(
      repositoryError<ProjectSettingsSnapshot | null>('PROJECT_HOLIDAYS_READ_FAILED', true),
    )
    const tool = createGetSafeProjectSettingsTool(repository)

    await expect(tool.execute({ projectId: 'p1' }, context)).resolves.toEqual({
      ok: false,
      error: {
        code: 'DATA_SOURCE_ERROR',
        message: '데이터를 조회하지 못했습니다.',
        retryable: true,
        repositoryErrorCode: 'PROJECT_HOLIDAYS_READ_FAILED',
      },
    })
  })

  it('rejects malformed arguments before touching the repository', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const tool = createGetSafeProjectSettingsTool(repository)

    for (const args of [null, 'p1', {}, { projectId: 42 }, { projectId: '   ' }]) {
      await expect(tool.execute(args, context)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      })
    }
    expect(repository.getSafeSettings).not.toHaveBeenCalled()
  })

  it('fails closed on project scope and capability before repository access', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const tool = createGetSafeProjectSettingsTool(repository)

    await expect(
      tool.execute({ projectId: 'p2' }, context),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    await expect(
      tool.execute({ projectId: 'p1' }, { ...context, capabilities: [] }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.getSafeSettings).not.toHaveBeenCalled()
  })

  it('rejects a repository snapshot that widens the requested project scope', async () => {
    const repository = settingsRepository(
      repositoryOk<ProjectSettingsSnapshot | null>({ ...snapshot, projectId: 'p2' }),
    )
    const tool = createGetSafeProjectSettingsTool(repository)

    await expect(tool.execute({ projectId: 'p1' }, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'DATA_SOURCE_ERROR', retryable: false },
    })
  })

  it('caps holidays at 20, preferring upcoming dates then most recent past', async () => {
    // context.now(2026-07-20 KST) 기준: 과거 19건 + 미래 3건 → 미래 3건 + 최근 과거 17건.
    const past = Array.from({ length: 19 }, (_, i) =>
      `2026-06-${String(i + 1).padStart(2, '0')}`)
    const future = ['2026-08-15', '2026-10-03', '2026-12-25']
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>({
      ...snapshot,
      holidays: [...past, ...future],
    }))
    const tool = createGetSafeProjectSettingsTool(repository)

    const result = await tool.execute({ projectId: 'p1' }, context)
    if (!result.ok) throw new Error('unreachable')
    expect(result.result.status).toBe('partial')
    expect(result.result.truncated).toBe(true)
    expect(result.result.facts.holidayCount).toBe(22)
    expect(result.result.records).toHaveLength(20)
    const dates = result.result.records.map(record => record.date)
    for (const date of future) expect(dates).toContain(date)
    // 가장 오래된 과거 2건만 밀려난다.
    expect(dates).not.toContain('2026-06-01')
    expect(dates).not.toContain('2026-06-02')
    expect(dates).toEqual([...dates].sort())
    expect(result.result.warnings.some(warning => warning.includes('20건'))).toBe(true)
  })

  it('never serializes secret-shaped values into the tool result', async () => {
    const repository = settingsRepository(repositoryOk<ProjectSettingsSnapshot | null>(snapshot))
    const probe = vi.fn(async () => ({ freshness: '2026-07-19T23:00:00Z', indexed: 42 }))
    const tool = createGetSafeProjectSettingsTool(repository, probe)

    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|signed|key|secret|token|env/i)
  })
})
