import { describe, expect, it } from 'vitest'
import {
  isActiveWikiDecision,
  isConflictedWikiItem,
  isOpenWikiItem,
  type WikiItem,
} from '@/lib/data/wiki'

function item(overrides: Partial<WikiItem> = {}): WikiItem {
  return {
    id: 'item-1',
    projectId: 'project-1',
    topicId: 'topic-1',
    kind: 'decision',
    statement: 'ERP가 오류 재처리를 담당한다.',
    lifecycleState: 'active',
    certainty: 'explicit',
    decisionState: 'confirmed',
    ownerTeam: 'ERP',
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

describe('Wiki UI 상태 집계', () => {
  it('확정된 활성 결정만 현재 결정으로 센다', () => {
    expect(isActiveWikiDecision(item())).toBe(true)
    expect(isActiveWikiDecision(item({ decisionState: 'tentative' }))).toBe(false)
    expect(isActiveWikiDecision(item({ decisionState: 'reversed' }))).toBe(false)
    expect(isActiveWikiDecision(item({ lifecycleState: 'conflicted' }))).toBe(false)
    expect(isActiveWikiDecision(item({ lifecycleState: 'superseded' }))).toBe(false)
  })

  it('액션·질문·리스크는 닫히기 전까지만 열린 항목으로 센다', () => {
    expect(isOpenWikiItem(item({ kind: 'action', lifecycleState: 'open', decisionState: null }))).toBe(true)
    expect(isOpenWikiItem(item({ kind: 'question', lifecycleState: 'resolved', decisionState: null }))).toBe(false)
    expect(isOpenWikiItem(item({ kind: 'fact', lifecycleState: 'open', decisionState: null }))).toBe(false)
  })

  it('상충 상태뿐 아니라 contradicts 원문 근거도 상충으로 표시한다', () => {
    expect(isConflictedWikiItem(item({ lifecycleState: 'conflicted' }))).toBe(true)
    expect(isConflictedWikiItem(item({
      sources: [{
        id: 'source-1',
        wikiItemId: 'item-1',
        minuteId: 'minute-1',
        minuteVersionId: null,
        bodyHash: '0123456789abcdef',
        blockIndex: 3,
        blockHash: 'fedcba9876543210',
        evidenceExcerpt: '기존 안과 다른 일정으로 진행한다.',
        relation: 'contradicts',
        createdAt: '2026-07-25T00:00:00.000Z',
        minuteTitle: '통합 회의',
        minuteDate: '2026-07-25',
      }],
    }))).toBe(true)
  })
})
