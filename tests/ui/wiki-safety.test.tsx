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
    ['superseded', '대체됨'],
    ['resolved', '해결됨'],
    ['archived', '보관됨'],
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

  it('현재 지식에는 explicit·active만 올리고 나머지 사실·제약은 논의 중 섹션에 남긴다', () => {
    const data: WikiTopicDetailData = {
      available: true,
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
      changes: [],
    }

    const html = renderToStaticMarkup(
      <WikiTopicDetail projectId="project-1" data={data} locale="ko" />,
    )

    // 현재 지식 섹션 = CURRENT KNOWLEDGE eyebrow 이후 다음 섹션 eyebrow 전까지.
    const current = html.slice(
      html.indexOf('CURRENT KNOWLEDGE'),
      html.indexOf('CURRENT DECISIONS'),
    )
    expect(current).toContain('표시할 명시적 사실')
    expect(current).toContain('표시할 명시적 근거')
    expect(current).not.toContain('논의 중 잠정 사실')
    expect(current).not.toContain('논의 중 열린 제약')

    // 조회는 되는데 어떤 섹션에도 없는 항목이 생기면 안 된다.
    const discussion = html.slice(html.indexOf('IN DISCUSSION'))
    expect(discussion).toContain('논의 중 잠정 사실')
    expect(discussion).toContain('논의 중 열린 제약')
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
    changes: [],
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
