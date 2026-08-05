import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 위키 자동 반영 중단 스위치(2026-08-05 사용자 지시)의 가드.
 *
 * 회의록 저장·외부 API 업로드·크론 워커가 전부 이 6개 진입점을 거친다. 하나라도 새면
 * "멈췄다"가 거짓이 되므로, **DB 클라이언트를 아예 만들지 않는 것**까지 확인한다
 * (반환값만 보면 내부에서 이미 쓰기를 하고 나서 null 을 준 경우를 못 잡는다).
 */

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(() => { throw new Error('중단 상태에서 DB 접근') }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn(() => { throw new Error('중단 상태에서 LLM 호출') }) }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: () => true }))

import {
  wikiServiceEnabled,
  enqueueMinuteWikiProcessing,
  enqueueAndProcessMinuteWiki,
  processMinuteWikiJob,
  processWikiProjectRebuildStep,
  rebuildProjectWikiFromActiveMinutes,
  runWikiWorkerOnce,
} from '@/lib/ai/wiki-ingest'

const ARGS = {
  projectId: 'p1', minuteId: 'm1', minuteVersionId: 'v1', bodyMd: '# 본문',
}

describe('위키 자동 반영 중단 스위치', () => {
  const saved = process.env.WIKI_SERVICE_ENABLED
  beforeEach(() => {
    vi.clearAllMocks()
    // 프로덕션과 같은 조건 — env 가 붙어 있어도 스위치가 이긴다
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    delete process.env.WIKI_SERVICE_ENABLED
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.WIKI_SERVICE_ENABLED
    else process.env.WIKI_SERVICE_ENABLED = saved
  })

  it('기본값은 꺼짐 — env 미설정이면 중단이다(로컬·프리뷰·새 배포에서 조용히 되살아나지 않는다)', () => {
    expect(wikiServiceEnabled()).toBe(false)
  })

  it("'true' 문자열일 때만 켜진다", () => {
    process.env.WIKI_SERVICE_ENABLED = 'TRUE'
    expect(wikiServiceEnabled()).toBe(false)
    process.env.WIKI_SERVICE_ENABLED = '1'
    expect(wikiServiceEnabled()).toBe(false)
    process.env.WIKI_SERVICE_ENABLED = 'true'
    expect(wikiServiceEnabled()).toBe(true)
  })

  it('6개 진입점이 전부 무동작으로 빠지고 DB 클라이언트를 만들지 않는다', async () => {
    expect(await enqueueMinuteWikiProcessing(ARGS)).toBeNull()
    expect(await enqueueAndProcessMinuteWiki(ARGS)).toBeUndefined()
    expect(await processMinuteWikiJob(1)).toBeNull()
    expect(await processWikiProjectRebuildStep('p1'))
      .toEqual({ attempted: false, completed: false, finished: false })
    expect(await rebuildProjectWikiFromActiveMinutes('p1')).toBeUndefined()
    expect(await runWikiWorkerOnce(5)).toEqual({ attempted: 0, completed: 0 })

    // 핵심 단언 — 하나라도 DB 를 건드렸으면 mock 이 throw 했을 것이다
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('크론이 부르는 워커도 막힌다 — 배치가 도는 유일한 경로다', async () => {
    expect(await runWikiWorkerOnce()).toEqual({ attempted: 0, completed: 0 })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
