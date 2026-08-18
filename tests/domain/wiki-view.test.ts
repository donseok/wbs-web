import { describe, expect, it } from 'vitest'
import {
  isCurrentWikiKnowledge,
  isDiscussingWikiItem,
  isUnsettledWikiKnowledge,
  getWikiTopicTrustState,
  type WikiViewItem,
} from '@/lib/domain/wikiView'

function entry(overrides: Partial<WikiViewItem> = {}): WikiViewItem {
  return {
    kind: 'fact',
    statement: 'ERP와 MES는 REST로 연계한다.',
    lifecycleState: 'active',
    certainty: 'explicit',
    decisionState: null,
    ownerTeam: 'ERP',
    dueDate: null,
    updatedAt: '2026-07-25T00:00:00.000Z',
    sources: [],
    ...overrides,
  }
}

describe('Wiki 표시 규칙', () => {
  it('문서 신뢰 상태는 상충·오래됨·검토기한을 verifiedAt보다 우선한다', () => {
    const now = Date.parse('2026-08-13T00:00:00.000Z')
    const verified = {
      verifiedAt: '2026-08-01T00:00:00.000Z',
      reviewDueAt: '2026-09-01T00:00:00.000Z',
      hasConflict: false,
      hasUnresolvedOutdatedFeedback: false,
    }

    expect(getWikiTopicTrustState(verified, now)).toBe('verified')
    expect(getWikiTopicTrustState({ ...verified, hasConflict: true }, now)).toBe('conflict')
    expect(getWikiTopicTrustState({ ...verified, hasUnresolvedOutdatedFeedback: true }, now)).toBe('review_due')
    expect(getWikiTopicTrustState({ ...verified, reviewDueAt: '2026-08-13T00:00:00.000Z' }, now)).toBe('review_due')
    expect(getWikiTopicTrustState({ ...verified, reviewDueAt: null }, now)).toBe('unverified')
    expect(getWikiTopicTrustState({ ...verified, verifiedAt: null }, now)).toBe('unverified')
  })

  it('잠정이거나 닫히지 않은 지식은 현재 지식이 아니라 미확정으로 분류한다', () => {
    expect(isCurrentWikiKnowledge(entry())).toBe(true)
    expect(isCurrentWikiKnowledge(entry({ certainty: 'tentative' }))).toBe(false)
    expect(isCurrentWikiKnowledge(entry({ lifecycleState: 'open' }))).toBe(false)
    expect(isUnsettledWikiKnowledge(entry({ certainty: 'tentative' }))).toBe(true)
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'open' }))).toBe(true)
    // 액션·질문·리스크는 열린 항목 그룹이 따로 담는다.
    expect(isUnsettledWikiKnowledge(entry({ kind: 'action', lifecycleState: 'open' }))).toBe(false)
  })

  it('논의 중 그룹은 잠정 지식과 미확정 결정을 담고 상충·종료 항목은 제외한다', () => {
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative' }))).toBe(true)
    expect(isDiscussingWikiItem(entry({ kind: 'decision', decisionState: 'proposed' }))).toBe(true)
    expect(isDiscussingWikiItem(entry({ kind: 'decision', decisionState: 'confirmed' }))).toBe(false)
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative', lifecycleState: 'resolved' }))).toBe(false)
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative', lifecycleState: 'conflicted' }))).toBe(false)
  })
})

describe('사람이 닫거나 숨긴 항목 — 되돌릴 수 있어야 한다', () => {
  it('미확정 지식 그룹도 닫힌 항목을 다시 끌어올리지 않는다', () => {
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'archived', certainty: 'tentative' }))).toBe(false)
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'resolved', certainty: 'tentative' }))).toBe(false)
  })
})
