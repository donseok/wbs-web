import { describe, expect, it } from 'vitest'
import {
  isWikiAnalyticsEvent,
  normalizeWikiAnalyticsMetadata,
} from '@/lib/domain/wikiAnalytics'

describe('Wiki 제품 이벤트', () => {
  it('고정된 이벤트 어휘만 허용한다', () => {
    expect(isWikiAnalyticsEvent('wiki_ask_submitted')).toBe(true)
    expect(isWikiAnalyticsEvent('wiki_question_body')).toBe(false)
  })

  it('metadata는 작은 원시값만 남겨 본문·중첩 객체 유입을 막는다', () => {
    expect(normalizeWikiAnalyticsMetadata({
      result_count: 2,
      query_length: 7,
      grounded: true,
      status: 'answered',
      question: '짧아도 원문은 저장 금지',
      body: '본문 저장 금지',
      raw_question: '가'.repeat(81),
      nested: { secret: true },
      'bad-key': 'x',
    })).toEqual({ result_count: 2, query_length: 7, grounded: true, status: 'answered' })
  })
})
