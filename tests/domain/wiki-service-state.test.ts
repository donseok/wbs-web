import { describe, expect, it } from 'vitest'
import { wikiAutomationState } from '@/lib/wiki/serviceState'

describe('Wiki 자동화 표시 상태', () => {
  it('서비스와 워커가 모두 명시적으로 켜졌을 때만 active다', () => {
    expect(wikiAutomationState({
      WIKI_SERVICE_ENABLED: 'true',
      WIKI_WORKER_ENABLED: 'true',
    })).toBe('active')

    expect(wikiAutomationState({
      WIKI_SERVICE_ENABLED: 'true',
      WIKI_WORKER_ENABLED: undefined,
    })).toBe('paused')
    expect(wikiAutomationState({
      WIKI_SERVICE_ENABLED: 'TRUE',
      WIKI_WORKER_ENABLED: 'true',
    })).toBe('paused')
  })
})
