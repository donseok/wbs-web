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

import { WikiChangeList, WikiItemCard } from '@/components/wiki/WikiShared'
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

  it('현재 지식에는 explicit이면서 active인 사실·제약·근거만 노출한다', () => {
    const data: WikiTopicDetailData = {
      available: true,
      topic: topic(),
      items: [
        item({ id: 'active-fact', statement: '표시할 명시적 사실' }),
        item({
          id: 'tentative-fact',
          statement: '숨길 잠정 사실',
          certainty: 'tentative',
        }),
        item({
          id: 'open-constraint',
          kind: 'constraint',
          statement: '숨길 열린 제약',
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

    expect(html).toContain('표시할 명시적 사실')
    expect(html).toContain('표시할 명시적 근거')
    expect(html).not.toContain('숨길 잠정 사실')
    expect(html).not.toContain('숨길 열린 제약')
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
