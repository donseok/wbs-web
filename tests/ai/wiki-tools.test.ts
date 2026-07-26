import { describe, expect, it } from 'vitest'
import { createGetWikiTopicTool, createSearchWikiTool } from '@/lib/ai/tools/wiki'
import { createFakeRepositories } from './golden/fake-repositories'
import {
  ALLOWED_PROJECT_IDS,
  BETA_MARKER,
  NOW,
  PROJECT_ALPHA,
  PROJECT_BETA,
  TEST_USER_ID,
} from './golden/fixtures'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'

function context(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    userId: TEST_USER_ID,
    role: 'pm',
    teamId: 'team-erp',
    capabilities: ['wiki:read'],
    allowedProjectIds: [...ALLOWED_PROJECT_IDS],
    pageContext: null,
    now: NOW,
    timezone: 'Asia/Seoul',
    ...overrides,
  }
}

const repositories = createFakeRepositories()
const searchWiki = createSearchWikiTool(repositories.wiki)
const getTopic = createGetWikiTopicTool(repositories.wiki)

describe('search_wiki', () => {
  it('접근 불가 프로젝트는 저장소까지 가지 않고 거절한다', async () => {
    const result = await searchWiki.execute({ projectId: PROJECT_BETA }, context())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ACCESS_DENIED')
  })

  it('capability가 없으면 거절한다', async () => {
    const result = await searchWiki.execute(
      { projectId: PROJECT_ALPHA },
      context({ capabilities: ['minutes:read'] }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ACCESS_DENIED')
  })

  it('타 프로젝트 지식은 결과·출처 어디에도 새지 않는다', async () => {
    const result = await searchWiki.execute({ projectId: PROJECT_ALPHA }, context())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.result)).not.toContain(BETA_MARKER)
  })

  it('상태를 화면과 같은 규칙으로 분류해 확정과 논의 중을 섞지 않는다', async () => {
    const result = await searchWiki.execute({ projectId: PROJECT_ALPHA }, context())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byId = new Map(result.result.records.map(record => [record.id, record]))
    expect(byId.get('wiki-item-alpha-1')?.status).toBe('current')
    expect(byId.get('wiki-item-alpha-2')?.status).toBe('open')
    expect(result.result.facts).toMatchObject({ current: 1, open: 1, conflicted: 0 })
  })

  it('Wiki 항목과 근거 회의록을 모두 출처로 남긴다', async () => {
    const result = await searchWiki.execute({ projectId: PROJECT_ALPHA }, context())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const domains = new Set(result.result.sources.map(source => source.domain))
    expect(domains.has('wiki')).toBe(true)
    expect(domains.has('minutes')).toBe(true)
    const wikiSource = result.result.sources.find(source => source.domain === 'wiki')
    expect(wikiSource?.href).toBe(`/p/${PROJECT_ALPHA}/wiki/topics/wiki-topic-alpha-1`)
  })

  it('알 수 없는 kind는 조회 전에 반려한다', async () => {
    const result = await searchWiki.execute(
      { projectId: PROJECT_ALPHA, kind: 'todo' },
      context(),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
  })

  it('결과가 없으면 회의록 원문 검색이 필요할 수 있다고 알린다', async () => {
    const result = await searchWiki.execute(
      { projectId: PROJECT_ALPHA, query: '존재하지 않는 내용' },
      context(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.records).toHaveLength(0)
    expect(result.result.warnings.join(' ')).toContain('회의록 원문')
  })

  it('조회 실패를 빈 결과로 위장하지 않는다', async () => {
    const failing = createFakeRepositories({ fail: ['WIKI_ITEMS_READ_FAILED'] })
    const result = await createSearchWikiTool(failing.wiki)
      .execute({ projectId: PROJECT_ALPHA }, context())

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('DATA_SOURCE_ERROR')
      expect(result.error.repositoryErrorCode).toBe('WIKI_ITEMS_READ_FAILED')
    }
  })
})

describe('get_wiki_topic', () => {
  it('topicId도 title도 없으면 반려한다', async () => {
    const result = await getTopic.execute({ projectId: PROJECT_ALPHA }, context())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
  })

  it('제목 일부로 주제를 찾아 현재 지식을 함께 반환한다', async () => {
    const result = await getTopic.execute(
      { projectId: PROJECT_ALPHA, title: '연계' },
      context(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.facts).toMatchObject({
      found: true,
      topicId: 'wiki-topic-alpha-1',
      matched: 2,
    })
  })

  it('주제를 못 찾아도 Wiki 홈 출처와 함께 정직하게 빈 결과를 준다', async () => {
    const result = await getTopic.execute(
      { projectId: PROJECT_ALPHA, title: '없는 주제' },
      context(),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.facts).toMatchObject({ found: false, matched: 0 })
    expect(result.result.sources[0].href).toBe(`/p/${PROJECT_ALPHA}/wiki`)
    expect(result.result.warnings).toHaveLength(1)
  })

  it('허용되지 않은 프로젝트의 주제는 조회할 수 없다', async () => {
    const result = await getTopic.execute(
      { projectId: PROJECT_BETA, topicId: 'wiki-topic-beta-1' },
      context(),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ACCESS_DENIED')
  })
})
