import { describe, expect, it } from 'vitest'
import {
  WIKI_CHANGE_TYPES,
  WIKI_ITEM_KINDS,
  WIKI_LIFECYCLE_STATES,
  WIKI_PROCESSING_STATUSES,
  WIKI_TOPIC_TYPES,
  buildWikiKnowledgeKey,
  canAutoApplyWikiChange,
  classifyWikiChange,
  compareWikiTemporalOrder,
  initialWikiLifecycleState,
  normalizeWikiKnowledgeKey,
  normalizeWikiStatement,
  normalizeWikiTitle,
  previousWikiLifecycleAfterChange,
  wikiStatementHash,
  type WikiComparableItem,
  type WikiIncomingItem,
  type WikiSemanticRelation,
} from '@/lib/domain/wiki'

function existing(overrides: Partial<WikiComparableItem> = {}): WikiComparableItem {
  return {
    statement: 'UAT 일정은 8월 20일이다.',
    knowledgeKey: 'erp-mes:decision:uat-date',
    certainty: 'explicit',
    observedAt: '2026-07-20T00:00:00+09:00',
    validFrom: null,
    autoUpdateLocked: false,
    ...overrides,
  }
}

function incoming(overrides: Partial<WikiIncomingItem> = {}): WikiIncomingItem {
  return {
    statement: 'UAT 일정은 8월 27일이다.',
    knowledgeKey: 'erp-mes:decision:uat-date',
    certainty: 'explicit',
    observedAt: '2026-07-27T00:00:00+09:00',
    validFrom: null,
    ...overrides,
  }
}

describe('Wiki enum 상수 — DB CHECK와 동일한 값', () => {
  it('topic/item/lifecycle/change 값을 빠짐없이 제공한다', () => {
    expect(WIKI_TOPIC_TYPES).toEqual([
      'process', 'system', 'interface', 'data', 'policy', 'glossary', 'general',
    ])
    expect(WIKI_ITEM_KINDS).toEqual([
      'decision', 'fact', 'action', 'question', 'risk', 'constraint', 'rationale',
    ])
    expect(WIKI_LIFECYCLE_STATES).toEqual([
      'active', 'open', 'resolved', 'superseded', 'conflicted', 'archived',
    ])
    expect(WIKI_CHANGE_TYPES).toEqual([
      'new', 'reaffirm', 'refine', 'supersede', 'reverse', 'conflict', 'resolve', 'retract',
    ])
    expect(WIKI_PROCESSING_STATUSES).toEqual(['pending', 'running', 'done', 'dead_letter'])
  })
})

describe('Wiki 문자열 정규화', () => {
  it('topic은 NFKC·공백·대시·구분자·대소문자를 수렴시킨다', () => {
    expect(normalizeWikiTitle('  ＥＲＰ  –  MES / 인터페이스  '))
      .toBe('erp-mes/인터페이스')
    expect(normalizeWikiTitle('ERP-MES/인터페이스'))
      .toBe('erp-mes/인터페이스')
  })

  it('statement는 공백/마침표/대소문자 표기 차이를 수렴시키되 내용은 보존한다', () => {
    expect(normalizeWikiStatement('  UAT 일정은\n  8월 27일이다。 '))
      .toBe('uat 일정은 8월 27일이다')
    expect(normalizeWikiStatement('UAT 일정은 8월 20일이 아니다.'))
      .not.toBe(normalizeWikiStatement('UAT 일정은 8월 20일이다.'))
  })

  it('knowledge key는 한글·숫자는 유지하고 구분자를 단일 하이픈으로 만든다', () => {
    expect(normalizeWikiKnowledgeKey(' UAT 일정 / 최종안 ')).toBe('uat-일정-최종안')
    expect(buildWikiKnowledgeKey('ERP–MES', 'decision', 'UAT 일정'))
      .toBe('erp-mes:decision:uat-일정')
    expect(buildWikiKnowledgeKey('데이터 이관', 'risk'))
      .toBe('데이터-이관:risk:risk')
  })

  it('동일 정규화 문장은 같은 16자리 hash를 갖는다', () => {
    expect(wikiStatementHash('UAT 일정 확정.')).toBe(wikiStatementHash('  uat 일정 확정。 '))
    expect(wikiStatementHash('UAT 일정 변경.')).not.toBe(wikiStatementHash('UAT 일정 확정.'))
    expect(wikiStatementHash('테스트')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('compareWikiTemporalOrder — 늦게 업로드된 과거 회의 보호', () => {
  it('실제 ISO instant를 비교하므로 offset이 달라도 정확하다', () => {
    expect(compareWikiTemporalOrder(
      existing({ observedAt: '2026-07-20T09:00:00+09:00' }),
      incoming({ observedAt: '2026-07-20T00:30:00Z' }),
    )).toBe(1)
  })

  it('incoming이 과거이면 -1, 같은 시점이면 0', () => {
    expect(compareWikiTemporalOrder(existing(), incoming({ observedAt: '2026-07-15T00:00:00+09:00' })))
      .toBe(-1)
    expect(compareWikiTemporalOrder(existing(), incoming({ observedAt: existing().observedAt })))
      .toBe(0)
  })

  it('observedAt이 없으면 validFrom을 사용하고, 둘 다 없으면 동시로 본다', () => {
    expect(compareWikiTemporalOrder(
      existing({ observedAt: null, validFrom: '2026-07-20' }),
      incoming({ observedAt: null, validFrom: '2026-07-21' }),
    )).toBe(1)
    expect(compareWikiTemporalOrder(
      existing({ observedAt: null, validFrom: null }),
      incoming({ observedAt: null, validFrom: null }),
    )).toBe(0)
  })

  it('명시된 validFrom은 observedAt보다 우선해 실제 효력 순서를 결정한다', () => {
    expect(compareWikiTemporalOrder(
      existing({
        observedAt: '2026-07-20T00:00:00Z',
        validFrom: '2026-08-01T00:00:00Z',
      }),
      incoming({
        observedAt: '2026-07-27T00:00:00Z',
        validFrom: null,
      }),
    )).toBe(-1)
    expect(compareWikiTemporalOrder(
      existing({
        observedAt: '2026-07-30T00:00:00Z',
        validFrom: '2026-08-01T00:00:00Z',
      }),
      incoming({
        observedAt: '2026-07-21T00:00:00Z',
        validFrom: '2026-08-02T00:00:00Z',
      }),
    )).toBe(1)
  })

  it('잘못된 observedAt은 유효한 validFrom으로 폴백한다', () => {
    expect(compareWikiTemporalOrder(
      existing({ observedAt: 'invalid', validFrom: '2026-07-20' }),
      incoming({ observedAt: 'invalid', validFrom: '2026-07-21' }),
    )).toBe(1)
  })

  it('한쪽만 유효 시점이 있으면 시점이 명시된 입력을 최신으로 취급한다', () => {
    expect(compareWikiTemporalOrder(
      existing({ observedAt: null, validFrom: null }),
      incoming({ observedAt: '2026-07-21T00:00:00Z' }),
    )).toBe(1)
    expect(compareWikiTemporalOrder(
      existing(),
      incoming({ observedAt: null, validFrom: null }),
    )).toBe(-1)
  })
})

describe('classifyWikiChange — 제한된 의미 관계를 안전하게 분류', () => {
  it('기존 항목이 없으면 new', () => {
    expect(classifyWikiChange(null, incoming())).toBe('new')
  })

  it('문장 정규화 hash가 같거나 same/confirms이면 reaffirm', () => {
    expect(classifyWikiChange(
      existing(),
      incoming({ statement: ' uat 일정은 8월 20일이다。 ' }),
    )).toBe('reaffirm')
    expect(classifyWikiChange(existing(), incoming(), 'same')).toBe('reaffirm')
    expect(classifyWikiChange(existing(), incoming(), 'confirms')).toBe('reaffirm')
  })

  it.each<[WikiSemanticRelation, string]>([
    ['refines', 'refine'],
    ['supersedes', 'supersede'],
    ['reverses', 'reverse'],
    ['contradicts', 'conflict'],
    ['resolves', 'resolve'],
    ['unrelated', 'new'],
  ])('%s 관계를 %s change로 매핑한다', (relation, change) => {
    expect(classifyWikiChange(existing(), incoming(), relation)).toBe(change)
  })

  it('관계가 불명확한 같은 key의 다른 값은 conflict, 다른 key는 new', () => {
    expect(classifyWikiChange(existing(), incoming())).toBe('conflict')
    expect(classifyWikiChange(
      existing(),
      incoming({ knowledgeKey: 'erp-mes:risk:night-alert' }),
    )).toBe('new')
  })
})

describe('canAutoApplyWikiChange — 결재 없는 자동 반영 안전장치', () => {
  it('new/reaffirm은 현재 결정을 파괴하지 않으므로 허용한다', () => {
    expect(canAutoApplyWikiChange('new', null, incoming({ certainty: 'tentative' }))).toBe(true)
    expect(canAutoApplyWikiChange('reaffirm', existing({ autoUpdateLocked: true }), incoming())).toBe(true)
  })

  it('conflict는 AI가 자동 해결하지 않는다', () => {
    expect(canAutoApplyWikiChange('conflict', existing(), incoming())).toBe(false)
  })

  it('고정된 항목은 변경하지 않는다', () => {
    expect(canAutoApplyWikiChange(
      'supersede',
      existing({ autoUpdateLocked: true }),
      incoming(),
    )).toBe(false)
  })

  it('tentative 발화는 기존 현재값을 refine/supersede/reverse/resolve/retract하지 않는다', () => {
    for (const change of ['refine', 'supersede', 'reverse', 'resolve', 'retract'] as const) {
      expect(canAutoApplyWikiChange(
        change,
        existing(),
        incoming({ certainty: 'tentative' }),
      )).toBe(false)
    }
  })

  it('명시적 최신 발화만 기존 상태 변경을 자동 적용한다', () => {
    expect(canAutoApplyWikiChange('supersede', existing(), incoming())).toBe(true)
    expect(canAutoApplyWikiChange(
      'supersede',
      existing(),
      incoming({ observedAt: '2026-07-15T00:00:00+09:00' }),
    )).toBe(false)
    expect(canAutoApplyWikiChange(
      'supersede',
      existing(),
      incoming({ observedAt: existing().observedAt }),
    )).toBe(true)
  })
})

describe('Wiki lifecycle 순수 규칙', () => {
  it('action/question/risk는 open, 나머지는 active로 시작한다', () => {
    for (const kind of ['action', 'question', 'risk'] as const) {
      expect(initialWikiLifecycleState(kind)).toBe('open')
    }
    for (const kind of ['decision', 'fact', 'constraint', 'rationale'] as const) {
      expect(initialWikiLifecycleState(kind)).toBe('active')
    }
  })

  it('기존 항목의 대체·철회/해결/충돌 상태만 전환하고 나머지는 유지한다', () => {
    expect(previousWikiLifecycleAfterChange('active', 'supersede')).toBe('superseded')
    expect(previousWikiLifecycleAfterChange('active', 'reverse')).toBe('superseded')
    expect(previousWikiLifecycleAfterChange('open', 'resolve')).toBe('resolved')
    expect(previousWikiLifecycleAfterChange('active', 'retract')).toBe('archived')
    expect(previousWikiLifecycleAfterChange('active', 'conflict')).toBe('conflicted')
    expect(previousWikiLifecycleAfterChange('open', 'refine')).toBe('open')
    expect(previousWikiLifecycleAfterChange('active', 'reaffirm')).toBe('active')
  })
})
