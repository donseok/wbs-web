import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  WikiChangeEvent,
  WikiItem,
  WikiTopicDetailData,
  WikiTopicSummary,
} from '@/lib/data/wiki'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: {
    href: string
    children: React.ReactNode
  }) => <a href={href} {...rest}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/project-1/wiki/topics/topic-1',
}))

import { WikiChangeList, WikiItemCard, wikiMinuteSourceHref } from '@/components/wiki/WikiShared'
import { minuteSourceHref } from '@/lib/minutes/source'
import { WikiTopicDetail } from '@/components/wiki/WikiTopicDetail'

function item(overrides: Partial<WikiItem> = {}): WikiItem {
  return {
    id: 'item-1',
    projectId: 'project-1',
    topicId: 'topic-1',
    kind: 'fact',
    statement: '현재 유효한 명시적 사실',
    lifecycleState: 'active',
    certainty: 'explicit',
    decisionState: null,
    ownerTeam: null,
    ownerMemberId: null,
    dueDate: null,
    observedAt: '2026-07-25T00:00:00.000Z',
    validFrom: null,
    validTo: null,
    origin: 'ai',
    autoUpdateLocked: false,
    reviewState: 'accepted',
    structuredData: {},
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    sources: [],
    ...overrides,
  }
}

function topic(): WikiTopicSummary {
  return {
    id: 'topic-1',
    projectId: 'project-1',
    title: 'ERP 연계',
    normalizedTitle: 'erp-연계',
    type: 'interface',
    ownerTeam: 'ERP',
    bodyMd: null,
    bodyUpdatedAt: null,
    bodyUpdatedBy: null,
    parentId: null,
    sort: 0,
    pinnedOrder: null,
    origin: 'ai',
    documentKind: null,
    verifiedAt: null,
    verifiedBy: null,
    reviewDueAt: null,
    lastChangedAt: '2026-07-25T00:00:00.000Z',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    itemCount: 4,
    activeDecisionCount: 0,
    openItemCount: 0,
    conflictCount: 0,
  }
}

function change(overrides: Partial<WikiChangeEvent> = {}): WikiChangeEvent {
  return {
    id: 'change-1',
    projectId: 'project-1',
    wikiItemId: 'item-1',
    minuteId: 'minute-1',
    minuteVersionId: 'version-2',
    changeType: 'new',
    beforeSnapshot: null,
    afterSnapshot: { statement: 'REST API 연계가 확정되었다.' },
    reason: '회의록에서 명시적으로 확인했습니다.',
    createdAt: '2026-07-25T01:00:00.000Z',
    minuteTitle: 'ERP 연계 회의',
    minuteDate: '2026-07-25',
    ...overrides,
  }
}

describe('Wiki 상태 표시 안전성', () => {
  it.each([
    ['conflicted', '상충'],
    ['superseded', '종료'],
    ['resolved', '종료'],
    ['archived', '종료'],
  ] as const)('종료 lifecycle %s는 과거 confirmed보다 우선 표시한다', (lifecycleState, label) => {
    const html = renderToStaticMarkup(
      <WikiItemCard
        locale="ko"
        item={item({
          kind: 'decision',
          lifecycleState,
          decisionState: 'confirmed',
        })}
      />,
    )

    expect(html).toContain(`>${label}</span>`)
    expect(html).not.toContain('>확정</span>')
  })

  it('문서 우선 상세에서도 현재·잠정 근거를 유실하지 않는다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      readState: 'ready',
      automationState: 'active',
      topic: topic(),
      items: [
        item({ id: 'active-fact', statement: '표시할 명시적 사실' }),
        item({
          id: 'tentative-fact',
          statement: '논의 중 잠정 사실',
          certainty: 'tentative',
        }),
        item({
          id: 'open-constraint',
          kind: 'constraint',
          statement: '논의 중 열린 제약',
          lifecycleState: 'open',
        }),
        item({
          id: 'active-rationale',
          kind: 'rationale',
          statement: '표시할 명시적 근거',
        }),
      ],
      proposals: [],
      changes: [],
      changesTruncated: false,
      dataTruncated: false,
    }

    const html = renderToStaticMarkup(
      <WikiTopicDetail projectId="project-1" data={data} locale="ko" />,
    )

    // 분류 체계를 본문보다 앞세우지 않되, 근거 항목은 하나도 유실하지 않는다.
    const evidence = html.slice(html.indexOf('SOURCE EVIDENCE'))
    expect(evidence).toContain('표시할 명시적 사실')
    expect(evidence).toContain('표시할 명시적 근거')
    expect(evidence).toContain('논의 중 잠정 사실')
    expect(evidence).toContain('논의 중 열린 제약')
  })

  it('잠정 사실은 lifecycle이 active여도 현재 유효로 표시하지 않는다', () => {
    const html = renderToStaticMarkup(
      <WikiItemCard
        locale="ko"
        item={item({ kind: 'fact', certainty: 'tentative', lifecycleState: 'active' })}
      />,
    )
    expect(html).toContain('>논의 중</span>')
    expect(html).not.toContain('>현재 유효</span>')
  })

  it('열린 질문은 구성원이 답할 수 있고 문서 이력은 복원할 수 있으며 거절 제안은 숨긴다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      readState: 'ready',
      automationState: 'active',
      topic: {
        ...topic(),
        bodyMd: '현재 문서',
        bodyUpdatedAt: '2026-07-26T00:00:00.000Z',
        documentKind: 'overview',
      },
      items: [],
      proposals: [
        item({ id: 'pending', statement: '검토할 제안', reviewState: 'pending' }),
        item({ id: 'rejected', statement: '이미 거절한 제안', reviewState: 'rejected' }),
      ],
      revisions: [{
        id: 'revision-1',
        versionNo: 1,
        title: 'ERP 연계 초안',
        bodyMd: '과거 문서',
        editedByName: '김담당',
        createdAt: '2026-07-25T00:00:00.000Z',
      }],
      questions: [{
        id: 'question-1',
        projectId: 'project-1',
        topicId: 'topic-1',
        question: '권한 신청은 누가 하나요?',
        answer: null,
        status: 'open',
        askedBy: null,
        answeredBy: null,
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
        answeredAt: null,
      }],
      changes: [],
      changesTruncated: false,
      dataTruncated: false,
    }

    const html = renderToStaticMarkup(
      <WikiTopicDetail
        projectId="project-1"
        data={data}
        locale="ko"
        canCurate
        canEditDocuments
      />,
    )

    expect(html).toContain('검토할 제안')
    expect(html).not.toContain('이미 거절한 제안')
    expect(html).toContain('답변하기')
    expect(html).toContain('이 버전 복원')
  })

  it('확장 스키마가 준비되지 않았으면 새 쓰기 UI를 노출하지 않는다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      readState: 'schema_missing',
      automationState: 'paused',
      topic: {
        ...topic(),
        bodyMd: '레거시 읽기 본문',
        bodyUpdatedAt: '2026-07-26T00:00:00.000Z',
        documentKind: 'overview',
      },
      items: [],
      proposals: [item({ id: 'pending-schema', statement: '검토할 제안', reviewState: 'pending' })],
      revisions: [{
        id: 'revision-schema', versionNo: 1, title: '이전 제목', bodyMd: '이전 문서',
        editedByName: null, createdAt: '2026-07-25T00:00:00.000Z',
      }],
      questions: [{
        id: 'question-schema', projectId: 'project-1', topicId: 'topic-1',
        question: '누가 답하나요?', answer: null, status: 'open', askedBy: null,
        answeredBy: null, createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z', answeredAt: null,
      }],
      changes: [], changesTruncated: false, dataTruncated: false,
    }

    const html = renderToStaticMarkup(
      <WikiTopicDetail
        projectId="project-1"
        data={data}
        locale="ko"
        canCurate
        canEditDocuments
        canVerifyDocuments
      />,
    )

    expect(html).toContain('프로젝트 Wiki 기능을 준비하고 있습니다')
    expect(html).not.toContain('답변하기')
    expect(html).not.toContain('이 버전 복원')
    expect(html).not.toContain('도움이 됐어요')
    expect(html).not.toContain('승인')
  })

  it('검토 기한이 지났으면 verifiedAt이 있어도 상단과 신뢰 패널 모두 재검증 필요로 표시한다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      readState: 'ready',
      automationState: 'active',
      topic: {
        ...topic(),
        bodyMd: '검증했던 문서',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        reviewDueAt: '2026-01-02T00:00:00.000Z',
      },
      items: [],
      proposals: [],
      feedback: [],
      changes: [],
      changesTruncated: false,
      dataTruncated: false,
    }
    const html = renderToStaticMarkup(
      <WikiTopicDetail projectId="project-1" data={data} locale="ko" />,
    )
    const header = html.slice(html.indexOf('<section class="card overflow-hidden">'), html.indexOf('CANONICAL DOCUMENT'))

    expect(header).toContain('재검증 필요')
    expect(header).not.toContain('검증된 문서')
    expect(html.match(/재검증 필요/g)).toHaveLength(2)
  })

  it('확장 스키마가 준비되지 않았으면 상세 새 쓰기 UI를 숨기고 경고만 보여준다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      readState: 'schema_missing',
      automationState: 'active',
      topic: {
        ...topic(),
        bodyMd: '기존 문서',
        bodyUpdatedAt: '2026-07-26T00:00:00.000Z',
      },
      items: [],
      proposals: [],
      revisions: [{
        id: 'revision-1', versionNo: 1, title: '과거 문서', bodyMd: '과거',
        editedByName: null, createdAt: '2026-07-25T00:00:00.000Z',
      }],
      questions: [{
        id: 'question-1', projectId: 'project-1', topicId: 'topic-1',
        question: '누가 답하나요?', answer: null, status: 'open', askedBy: null,
        answeredBy: null, createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z', answeredAt: null,
      }],
      feedback: [],
      changes: [],
      changesTruncated: false,
      dataTruncated: false,
    }
    const html = renderToStaticMarkup(
      <WikiTopicDetail
        projectId="project-1"
        data={data}
        locale="ko"
        canCurate
        canEditDocuments
        canVerifyDocuments
      />,
    )

    expect(html).toContain('프로젝트 Wiki 기능을 준비하고 있습니다')
    expect(html).not.toContain('>편집</button>')
    expect(html).not.toContain('>현재 내용 검증</button>')
    expect(html).not.toContain('>답변하기</button>')
    expect(html).not.toContain('>이 버전 복원</button>')
    expect(html).not.toContain('이 문서가 업무에 도움이 되었나요?')
  })

  it('변경 타임라인은 원문 당시 minute version으로 연결하고 없으면 현재 문서로 폴백한다', () => {
    const html = renderToStaticMarkup(
      <WikiChangeList
        locale="ko"
        changes={[
          change(),
          change({
            id: 'change-2',
            minuteId: 'minute-2',
            minuteVersionId: null,
          }),
        ]}
      />,
    )

    expect(html).toContain('href="/minutes/minute-1?version=version-2"')
    expect(html).toContain('href="/minutes/minute-2"')
    expect(html).not.toContain('href="/minutes/minute-2?version=')
  })
})

describe('Wiki 클라이언트 번들 격리', () => {
  it('자체 원문 링크 빌더가 lib/minutes/source와 같은 URL을 만든다', () => {
    const anchor = { blockIndex: 12, blockHash: 'fedcba9876543210', bodyHash: '0123456789abcdef' }
    expect(wikiMinuteSourceHref('minute-1', anchor))
      .toBe(minuteSourceHref('minute-1', anchor))
    expect(wikiMinuteSourceHref('minute-1', anchor, 'version-9'))
      .toBe(minuteSourceHref('minute-1', anchor, 'version-9'))
  })
})

describe('사람이 닫거나 숨긴 항목', () => {
  const closedData = (state: 'archived' | 'resolved'): WikiTopicDetailData => ({
    available: true,
    readState: 'ready',
    automationState: 'active',
    topic: topic(),
    items: [
      item({ id: 'live-fact', statement: '살아있는 사실' }),
      item({ id: 'closed-fact', statement: '닫힌 사실', lifecycleState: state }),
      item({
        id: 'closed-decision',
        kind: 'decision',
        statement: '닫힌 결정',
        lifecycleState: state,
        decisionState: 'confirmed',
      }),
    ],
    proposals: [],
    changes: [],
    changesTruncated: false,
    dataTruncated: false,
  })

  it.each(['archived', 'resolved'] as const)('%s 항목은 주제 상세 어느 섹션에도 렌더되지 않는다', (state) => {
    const html = renderToStaticMarkup(
      <WikiTopicDetail projectId="project-1" data={closedData(state)} locale="ko" />,
    )
    expect(html).toContain('살아있는 사실')
    expect(html).not.toContain('닫힌 사실')
    expect(html).not.toContain('닫힌 결정')
  })
})
