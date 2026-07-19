import { describe, expect, it, vi } from 'vitest'
import {
  createListAnnouncementsTool,
  createSearchAnnouncementsTool,
} from '@/lib/ai/tools/announcements'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import {
  repositoryError,
  repositoryOk,
  type AnnouncementListSnapshot,
  type AnnouncementRepository,
  type AnnouncementRepositoryRecord,
} from '@/lib/repositories/types'

const context: ToolExecutionContext = {
  userId: 'user-1',
  role: 'team_editor',
  teamId: 'team-erp',
  capabilities: ['announcements:read'],
  allowedProjectIds: ['p1'],
  pageContext: null,
  now: '2026-07-20T09:00:00+09:00',
  timezone: 'Asia/Seoul',
}

const LONG_TAIL = 'TAIL_SECRET_MARKER'

const announcements: AnnouncementRepositoryRecord[] = [
  {
    id: 'a1', projectId: 'p1', title: '정기 점검 안내',
    body: `시스템 점검은 7월 21일 22시에 진행됩니다. ${'상세 안내 문구 '.repeat(40)}${LONG_TAIL}`,
    category: 'important', isPinned: true, publishFrom: '2026-07-01', publishTo: '2026-07-31',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
  },
  {
    id: 'a2', projectId: 'p1', title: '상반기 워크숍 후기',
    body: '6월 워크숍 후기와 사진을 공유합니다.',
    category: 'event', isPinned: false, publishFrom: '2026-06-01', publishTo: '2026-06-30',
    createdAt: '2026-06-01T00:00:00Z', updatedAt: null,
  },
  {
    id: 'a3', projectId: 'p1', title: '문의 채널 안내 (FAQ)',
    body: '문의는 게시판 댓글로 남겨 주세요.',
    category: 'general', isPinned: false, publishFrom: null, publishTo: null,
    createdAt: '2026-05-01T00:00:00Z', updatedAt: null,
  },
]

function repo(
  records: AnnouncementRepositoryRecord[] = announcements,
  truncated = false,
): AnnouncementRepository {
  return {
    listAnnouncements: vi.fn(async () =>
      repositoryOk<AnnouncementListSnapshot>({ records, truncated })),
  }
}

describe('announcement tools', () => {
  it('lists announcements with counts and focus deep links', async () => {
    const repository = repo()
    const result = await createListAnnouncementsTool(repository).execute({ projectId: 'p1' }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(repository.listAnnouncements).toHaveBeenCalledWith('p1', 50)
    expect(result.result.facts).toMatchObject({
      totalMatched: 3, returned: 3, pinnedCount: 1, activeCount: 2,
    })
    expect(result.result.records.map(record => record.id)).toEqual(['a1', 'a2', 'a3'])
    expect(result.result.sources[0]).toMatchObject({
      id: 'announcement:a1', domain: 'announcements', entityType: 'announcement',
      entityId: 'a1', projectId: 'p1', title: '정기 점검 안내',
      href: '/p/p1/announcements?focus=a1', updatedAt: '2026-07-02T00:00:00Z',
    })
    expect(result.result.truncated).toBe(false)
    expect(result.result.status).toBe('ok')
  })

  it('applies pinnedOnly, category, and activeOn publication-window filters', async () => {
    const tool = createListAnnouncementsTool(repo())

    const pinned = await tool.execute({ projectId: 'p1', pinnedOnly: true }, context)
    expect(pinned.ok && pinned.result.records.map(record => record.id)).toEqual(['a1'])

    const events = await tool.execute({ projectId: 'p1', category: 'event' }, context)
    expect(events.ok && events.result.records.map(record => record.id)).toEqual(['a2'])

    const active = await tool.execute({ projectId: 'p1', activeOn: '2026-06-15' }, context)
    expect(active.ok && active.result.records.map(record => record.id)).toEqual(['a2', 'a3'])
    expect(active.ok && active.result.facts).toMatchObject({ totalMatched: 2, activeCount: 2 })
  })

  it('treats a valid empty board as success, not an error', async () => {
    const result = await createListAnnouncementsTool(repo([])).execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({
      ok: true,
      result: { status: 'ok', facts: { totalMatched: 0, returned: 0, pinnedCount: 0, activeCount: 0 } },
    })
  })

  it('surfaces repository failures with the storage-neutral error code', async () => {
    const failing: AnnouncementRepository = {
      listAnnouncements: vi.fn(async () =>
        repositoryError<AnnouncementListSnapshot>('ANNOUNCEMENTS_READ_FAILED', true)),
    }
    for (const tool of [createListAnnouncementsTool(failing), createSearchAnnouncementsTool(failing)]) {
      await expect(tool.execute({ projectId: 'p1', query: '점검' }, context)).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'DATA_SOURCE_ERROR',
          retryable: true,
          repositoryErrorCode: 'ANNOUNCEMENTS_READ_FAILED',
        },
      })
    }
  })

  it('rejects invalid arguments before touching the repository', async () => {
    const repository = repo()
    const list = createListAnnouncementsTool(repository)
    const search = createSearchAnnouncementsTool(repository)

    const invalidCalls = [
      list.execute(null, context),
      list.execute({}, context),
      list.execute({ projectId: 'p1', category: 'urgent' }, context),
      list.execute({ projectId: 'p1', activeOn: '2026-13-01' }, context),
      list.execute({ projectId: 'p1', pinnedOnly: 'yes' }, context),
      list.execute({ projectId: 'p1', limit: 0 }, context),
      search.execute({ projectId: 'p1' }, context),
      search.execute({ projectId: 'p1', query: '   ' }, context),
      search.execute({ projectId: 'p1', query: 'a'.repeat(201) }, context),
      search.execute({ projectId: 'p1', query: '점검', category: 'urgent' }, context),
    ]
    for (const result of await Promise.all(invalidCalls)) {
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    }
    expect(repository.listAnnouncements).not.toHaveBeenCalled()
  })

  it('fails closed on project scope and capability before repository access', async () => {
    const repository = repo()
    const list = createListAnnouncementsTool(repository)
    const search = createSearchAnnouncementsTool(repository)

    await expect(list.execute(
      { projectId: 'p1' }, { ...context, allowedProjectIds: [] },
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    await expect(search.execute(
      { projectId: 'p1', query: '점검' }, { ...context, capabilities: [] },
    )).resolves.toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } })
    expect(repository.listAnnouncements).not.toHaveBeenCalled()
  })

  it('rejects repository rows that widen the requested project scope', async () => {
    const rogue = repo([{ ...announcements[0], projectId: 'p2', title: '범위 밖 공지' }])

    const result = await createListAnnouncementsTool(rogue).execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('범위 밖 공지')
  })

  it('never serializes the full body or sensitive fields', async () => {
    const result = await createListAnnouncementsTool(repo()).execute({ projectId: 'p1' }, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const excerpt = result.result.records[0].bodyExcerpt
    expect(excerpt).toBeTruthy()
    expect((excerpt ?? '').length).toBeLessThanOrEqual(300)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(LONG_TAIL)
    expect(serialized).not.toMatch(/email|file_path|signed/i)
  })

  it('marks partial results when the limit or the scan window truncates', async () => {
    const limited = await createListAnnouncementsTool(repo()).execute(
      { projectId: 'p1', limit: 1 }, context,
    )
    expect(limited.ok && limited.result).toMatchObject({
      status: 'partial',
      truncated: true,
      facts: { totalMatched: 3, returned: 1 },
    })
    expect(limited.ok && limited.result.warnings.length).toBeGreaterThan(0)

    const scanned = await createListAnnouncementsTool(repo(announcements, true)).execute(
      { projectId: 'p1' }, context,
    )
    expect(scanned.ok && scanned.result).toMatchObject({ status: 'partial', truncated: true })
    expect(scanned.ok && scanned.result.warnings.join(' ')).toContain('50건')
  })

  it('searches title/body case-insensitively and excerpts around the match', async () => {
    const search = createSearchAnnouncementsTool(repo())

    const byTitle = await search.execute({ projectId: 'p1', query: 'faq' }, context)
    expect(byTitle.ok && byTitle.result.records.map(record => record.id)).toEqual(['a3'])

    const deepMatch = await search.execute({ projectId: 'p1', query: 'tail_secret' }, context)
    expect(deepMatch.ok).toBe(true)
    if (!deepMatch.ok) return
    expect(deepMatch.result.records.map(record => record.id)).toEqual(['a1'])
    const excerpt = deepMatch.result.records[0].bodyExcerpt ?? ''
    expect(excerpt).toContain(LONG_TAIL)
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(300)
  })

  it('combines the category filter with search and returns zero cleanly', async () => {
    const search = createSearchAnnouncementsTool(repo())

    const filtered = await search.execute(
      { projectId: 'p1', query: '안내', category: 'general' }, context,
    )
    expect(filtered.ok && filtered.result.records.map(record => record.id)).toEqual(['a3'])

    const none = await search.execute({ projectId: 'p1', query: '존재하지않는검색어' }, context)
    expect(none).toMatchObject({
      ok: true,
      result: { status: 'ok', facts: { totalMatched: 0, returned: 0 } },
    })
  })
})
