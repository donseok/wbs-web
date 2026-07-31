import { describe, expect, it } from 'vitest'
import {
  countWikiViews,
  filterWikiEntries,
  isCurrentWikiKnowledge,
  isDiscussingWikiItem,
  isUnsettledWikiKnowledge,
  matchesWikiQuery,
  matchesWikiTopicQuery,
  sortWikiEntries,
  type WikiExplorerEntry,
} from '@/lib/domain/wikiView'

function entry(overrides: Partial<WikiExplorerEntry> = {}): WikiExplorerEntry {
  return {
    id: 'item-1',
    topicId: 'topic-1',
    topicTitle: 'ERP 연계',
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
  it('잠정이거나 닫히지 않은 지식은 현재 지식이 아니라 미확정으로 분류한다', () => {
    expect(isCurrentWikiKnowledge(entry())).toBe(true)
    expect(isCurrentWikiKnowledge(entry({ certainty: 'tentative' }))).toBe(false)
    expect(isCurrentWikiKnowledge(entry({ lifecycleState: 'open' }))).toBe(false)
    expect(isUnsettledWikiKnowledge(entry({ certainty: 'tentative' }))).toBe(true)
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'open' }))).toBe(true)
    // 액션·질문·리스크는 열린 항목 그룹이 따로 담는다.
    expect(isUnsettledWikiKnowledge(entry({ kind: 'action', lifecycleState: 'open' }))).toBe(false)
  })

  it('사실·결정·액션 어느 종류든 살아있는 항목은 최소 한 뷰에 포함된다', () => {
    const items = [
      entry({ id: 'a', kind: 'fact', certainty: 'tentative', lifecycleState: 'open' }),
      entry({ id: 'b', kind: 'decision', decisionState: 'tentative', lifecycleState: 'open' }),
      entry({ id: 'c', kind: 'decision', decisionState: 'confirmed' }),
      entry({ id: 'd', kind: 'action', lifecycleState: 'open', decisionState: null }),
      entry({ id: 'e', kind: 'constraint', lifecycleState: 'conflicted' }),
    ]
    for (const item of items) {
      const views = (['decision', 'open', 'discussing', 'conflict'] as const)
        .filter((view) => filterWikiEntries([item], { view, kind: 'all', query: '' }).length === 1)
      expect(views.length, `${item.id}가 어떤 뷰에도 없다`).toBeGreaterThan(0)
    }
  })

  it('논의 중 뷰는 잠정 지식과 미확정 결정을 담고 상충·종료 항목은 제외한다', () => {
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative' }))).toBe(true)
    expect(isDiscussingWikiItem(entry({ kind: 'decision', decisionState: 'proposed' }))).toBe(true)
    expect(isDiscussingWikiItem(entry({ kind: 'decision', decisionState: 'confirmed' }))).toBe(false)
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative', lifecycleState: 'resolved' }))).toBe(false)
    expect(isDiscussingWikiItem(entry({ certainty: 'tentative', lifecycleState: 'conflicted' }))).toBe(false)
  })

  it('뷰 건수는 필터와 무관하게 전체 기준으로 센다', () => {
    const counts = countWikiViews([
      entry({ id: 'a', kind: 'decision', decisionState: 'confirmed' }),
      entry({ id: 'b', kind: 'action', lifecycleState: 'open', decisionState: null }),
      entry({ id: 'c', certainty: 'tentative' }),
    ])
    expect(counts).toMatchObject({ all: 3, decision: 1, open: 1, discussing: 1, conflict: 0 })
  })

  it('검색은 문장·주제·담당팀·근거 발췌를 토큰 AND로 본다', () => {
    const target = entry({
      statement: 'UAT는 8월에 진행한다.',
      sources: [{ relation: 'supports', evidenceExcerpt: '품질팀이 시나리오를 준비한다.' }],
    })
    expect(matchesWikiQuery(target, 'uat 8월')).toBe(true)
    expect(matchesWikiQuery(target, 'ERP 연계')).toBe(true)
    expect(matchesWikiQuery(target, '품질팀')).toBe(true)
    expect(matchesWikiQuery(target, 'uat 9월')).toBe(false)
    expect(matchesWikiQuery(target, '   ')).toBe(true)
  })

  it('열린 항목은 기한 있는 것부터, 그 외에는 최근 변경순으로 정렬한다', () => {
    const list = [
      entry({ id: 'no-due', dueDate: null, updatedAt: '2026-07-27T00:00:00.000Z' }),
      entry({ id: 'late', dueDate: '2026-08-30', updatedAt: '2026-07-20T00:00:00.000Z' }),
      entry({ id: 'soon', dueDate: '2026-08-01', updatedAt: '2026-07-10T00:00:00.000Z' }),
    ]
    expect(sortWikiEntries(list, 'open').map((item) => item.id)).toEqual(['soon', 'late', 'no-due'])
    expect(sortWikiEntries(list, 'all').map((item) => item.id)).toEqual(['no-due', 'late', 'soon'])
  })

  it('주제 검색은 제목·담당팀·유형을 함께 본다', () => {
    const topic = { title: '야드 관리 시스템', ownerTeam: '물류', type: 'system' }
    expect(matchesWikiTopicQuery(topic, '야드')).toBe(true)
    expect(matchesWikiTopicQuery(topic, '물류 시스템')).toBe(true)
    expect(matchesWikiTopicQuery(topic, 'system')).toBe(true)
    expect(matchesWikiTopicQuery(topic, '배차')).toBe(false)
  })
})

describe('사람이 닫거나 숨긴 항목 — 되돌릴 수 있어야 한다', () => {
  it('완료·숨김 항목은 전용 뷰 밖 어떤 목록에도 섞이지 않는다', () => {
    for (const state of ['resolved', 'archived'] as const) {
      const closed = entry({ lifecycleState: state })
      for (const view of ['all', 'decision', 'open', 'discussing', 'conflict'] as const) {
        expect(
          filterWikiEntries([closed], { view, kind: 'all', query: '' }),
          `${state} 가 ${view} 뷰에 섞임`,
        ).toHaveLength(0)
      }
    }
  })

  it('완료·숨김 항목은 각자의 전용 뷰에서 반드시 보인다', () => {
    expect(filterWikiEntries([entry({ lifecycleState: 'resolved' })], { view: 'resolved', kind: 'all', query: '' })).toHaveLength(1)
    expect(filterWikiEntries([entry({ lifecycleState: 'archived' })], { view: 'archived', kind: 'all', query: '' })).toHaveLength(1)
  })

  it('미확정 지식 그룹도 닫힌 항목을 다시 끌어올리지 않는다', () => {
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'archived', certainty: 'tentative' }))).toBe(false)
    expect(isUnsettledWikiKnowledge(entry({ lifecycleState: 'resolved', certainty: 'tentative' }))).toBe(false)
  })

  it('집계는 닫힌 항목을 살아있는 수에 넣지 않는다', () => {
    const counts = countWikiViews([
      entry({ id: 'a' }),
      entry({ id: 'b', lifecycleState: 'resolved' }),
      entry({ id: 'c', lifecycleState: 'archived' }),
    ])
    expect(counts).toMatchObject({ all: 1, resolved: 1, archived: 1 })
  })
})
