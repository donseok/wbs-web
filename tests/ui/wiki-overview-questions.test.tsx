import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WikiOverviewData, WikiQuestion } from '@/lib/data/wiki'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/project-1/wiki',
}))

import { WikiOverview } from '@/components/wiki/WikiOverview'

function answeredQuestion(id = 'answered-1'): WikiQuestion {
  return {
    id,
    projectId: 'project-1',
    topicId: null,
    question: id === 'answered-1' ? '배포 승인자는 누구인가요?' : `질문 ${id}`,
    answer: id === 'answered-1' ? '프로젝트 오너와 운영 리드가 함께 승인합니다.' : `답변 ${id}`,
    status: 'answered',
    askedBy: null,
    answeredBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    answeredAt: '2026-08-02T00:00:00.000Z',
  }
}

function overview(overrides: Partial<WikiOverviewData> = {}): WikiOverviewData {
  return {
    available: true,
    readState: 'ready',
    automationState: 'active',
    topics: [],
    items: [],
    proposals: [],
    changes: [],
    changesTruncated: false,
    dataTruncated: false,
    questions: [answeredQuestion()],
    feedback: [],
    summary: {
      topicCount: 0,
      activeDecisionCount: 0,
      openItemCount: 0,
      conflictCount: 0,
      lastChangedAt: null,
    },
    ...overrides,
  }
}

describe('Wiki 답변된 질문', () => {
  it('완료된 Q&A를 접근 가능한 섹션에 렌더하고 딥링크 anchor를 보존한다', () => {
    const html = renderToStaticMarkup(
      <WikiOverview projectId="project-1" data={overview()} locale="ko" />,
    )

    expect(html).toContain('aria-labelledby="wiki-answered-questions-title"')
    expect(html).toContain('id="wiki-question-answered-1"')
    expect(html).toContain('배포 승인자는 누구인가요?')
    expect(html).toContain('프로젝트 오너와 운영 리드가 함께 승인합니다.')
  })

  it('최신 10건만 렌더하고 전체 건수와 숨은 건수를 알린다', () => {
    const questions = Array.from({ length: 12 }, (_, index) => answeredQuestion(`answer-${index}`))
    const html = renderToStaticMarkup(
      <WikiOverview projectId="project-1" data={overview({ questions })} locale="ko" />,
    )

    expect(html).toContain('>12</span>')
    expect(html).toContain('id="wiki-question-answer-0"')
    expect(html).toContain('id="wiki-question-answer-9"')
    expect(html).not.toContain('id="wiki-question-answer-10"')
    expect(html).toContain('답변된 질문 2건이 더 있습니다')
  })

  it('Ask가 지정한 오래된 답변은 최신 10건 밖이어도 실제 anchor에 렌더한다', () => {
    const questions = Array.from({ length: 12 }, (_, index) => answeredQuestion(`answer-${index}`))
    const html = renderToStaticMarkup(
      <WikiOverview
        projectId="project-1"
        data={overview({ questions })}
        locale="ko"
        highlightQuestionId="answer-11"
      />,
    )

    expect(html).toContain('id="wiki-question-answer-11"')
    expect(html).toContain('답변 answer-11')
    expect(html).not.toContain('id="wiki-question-answer-9"')
  })

  it('확장 스키마가 준비되지 않았으면 구성원이어도 새 문서 쓰기를 노출하지 않는다', () => {
    const html = renderToStaticMarkup(
      <WikiOverview
        projectId="project-1"
        data={overview({ readState: 'schema_missing', questions: [] })}
        locale="ko"
        canEditDocuments
      />,
    )

    expect(html).toContain('프로젝트 지식 기능을 준비하고 있습니다')
    expect(html).not.toContain('>새 문서</button>')
  })

  it('확장 스키마 준비 전에는 멤버에게도 새 문서·질문 쓰기를 제안하지 않는다', () => {
    const data = overview()
    data.readState = 'schema_missing'
    data.questions = []
    const html = renderToStaticMarkup(
      <WikiOverview projectId="project-1" data={data} locale="ko" canEditDocuments canCurate canMergeTopics />,
    )

    expect(html).toContain('프로젝트 지식 기능을 준비하고 있습니다')
    expect(html).not.toContain('새 문서')
    expect(html).not.toContain('질문으로 남기기')
  })
})
