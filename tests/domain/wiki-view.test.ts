import { describe, expect, it } from 'vitest'
import {
  countWikiViews,
  filterWikiEntries,
  isCurrentWikiKnowledge,
  isDiscussingWikiItem,
  isUnsettledWikiKnowledge,
  getWikiTopicTrustState,
  matchesWikiQuery,
  matchesWikiTopicQuery,
  sortWikiEntries,
  wikiSearchFallbacks,
  wikiTopicSearchFallbacks,
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

  it('사람이 쓴 문서 본문과 문서 유형도 주제 검색 대상으로 본다', () => {
    const topic = {
      title: '현장 운영',
      ownerTeam: null,
      type: 'general',
      bodyMd: '장애 발생 시 우선 재처리 큐의 적체 여부를 확인한다.',
      documentKind: 'runbook',
    }
    expect(matchesWikiTopicQuery(topic, '재처리 적체')).toBe(true)
    expect(matchesWikiTopicQuery(topic, 'runbook')).toBe(true)
    expect(matchesWikiTopicQuery(topic, 'faq')).toBe(false)
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

describe('검색 0건 회복 경로', () => {
  // Baymard: 0건 화면의 "검색 팁"은 안티패턴이고, 키워드를 하나씩 뺀 대안을 각각의
  // 건수와 함께 제시하는 것이 권장안이다. 건수를 함께 주는 이유는 "눌렀다가 또 0건이면
  // 어쩌지" 하는 주저를 없애기 위해서다.
  const entry = (over: Partial<WikiExplorerEntry> & { id: string }): WikiExplorerEntry => ({
    topicId: 't1',
    topicTitle: '결제 모듈',
    kind: 'decision',
    statement: '카드 결제는 PG 사를 통해 처리한다',
    lifecycleState: 'active',
    certainty: 'explicit',
    decisionState: 'accepted',
    ownerTeam: null,
    dueDate: null,
    updatedAt: '2026-08-01T00:00:00Z',
    sources: [],
    ...over,
  })

  // 주제명을 서로 다르게 둬야 토큰별 건수가 명확해진다.
  const entries = [
    entry({ id: 'a' }),
    entry({
      id: 'b',
      topicTitle: '환불 정책',
      statement: '환불은 7일 이내만 가능하다',
      kind: 'constraint',
    }),
  ]

  it('토큰 하나를 뺀 대안을 건수와 함께 돌려준다', () => {
    const got = wikiSearchFallbacks(entries, { view: 'all', kind: 'all', query: '결제 존재하지않는말' })
    expect(got).toEqual([
      { kind: 'drop-token', query: '결제', droppedToken: '존재하지않는말', count: 1 },
    ])
  })

  it('건수가 많은 대안을 먼저 놓고 0건 대안은 버린다', () => {
    const got = wikiSearchFallbacks(entries, { view: 'all', kind: 'all', query: '결제 환불' })
    // '결제'만 남기면 a 1건, '환불'만 남기면 b 1건 — 둘 다 살아남는다.
    expect(got.map((f) => f.droppedToken).sort()).toEqual(['결제', '환불'])
    expect(got.every((f) => f.count > 0)).toBe(true)
  })

  it('필터가 걸려 있으면 검색어를 버리기 전에 필터 해제를 먼저 제안한다', () => {
    const got = wikiSearchFallbacks(entries, { view: 'all', kind: 'action', query: '결제' })
    expect(got[0]).toEqual({ kind: 'drop-filters', query: '결제', droppedToken: '', count: 1 })
  })

  it('토큰이 하나뿐이고 필터도 없으면 제안할 것이 없다', () => {
    // 여기서 억지 제안을 만들면 "전체 보기"와 다를 바 없어 사용자를 속이게 된다.
    expect(wikiSearchFallbacks(entries, { view: 'all', kind: 'all', query: '없는말' })).toEqual([])
  })

  it('대안은 최대 3개까지만 준다', () => {
    const got = wikiSearchFallbacks(entries, {
      view: 'all', kind: 'all', query: '결제 환불 카드 PG 없는말',
    })
    expect(got.length).toBeLessThanOrEqual(3)
  })
})

describe('wikiTopicSearchFallbacks', () => {
  const topics = [
    { title: '결제 모듈', ownerTeam: 'PG팀', type: 'general', bodyMd: '카드 승인 절차', documentKind: 'runbook' },
    { title: '환불 정책', ownerTeam: 'CS팀', type: 'general', bodyMd: '환불 기준을 정리한다', documentKind: 'reference' },
  ]

  it('본문(bodyMd)까지 훑어 대안 건수를 센다', () => {
    // 주제 검색은 제목뿐 아니라 본문도 매칭한다 — 대안 건수도 같은 기준이어야
    // 눌렀을 때 실제로 그만큼 나온다.
    const got = wikiTopicSearchFallbacks(topics, '승인 없는말')
    expect(got).toEqual([
      { kind: 'drop-token', query: '승인', droppedToken: '없는말', count: 1 },
    ])
  })

  it('토큰이 하나뿐이면 제안하지 않는다', () => {
    expect(wikiTopicSearchFallbacks(topics, '없는말')).toEqual([])
  })

  it('0건 대안은 버리고 건수 내림차순으로 최대 3개만 준다', () => {
    const got = wikiTopicSearchFallbacks(topics, '결제 환불 없는말1 없는말2')
    expect(got.every((fallback) => fallback.count > 0)).toBe(true)
    expect(got.length).toBeLessThanOrEqual(3)
    expect(got).toEqual([...got].sort((left, right) => right.count - left.count))
  })
})
