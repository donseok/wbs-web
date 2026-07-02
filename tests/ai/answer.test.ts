import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/provider', () => ({ hasLLM: vi.fn() }))
vi.mock('@/lib/ai/knowledge', () => ({ gatherKnowledge: vi.fn() }))
vi.mock('@/lib/ai/retrieve', () => ({ retrieveContext: vi.fn() }))
vi.mock('@/lib/ai/ensure-index', () => ({ ensureProjectIndexed: vi.fn() }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn(), generateAnswerStream: vi.fn() }))

import { hasLLM } from '@/lib/ai/provider'
import { gatherKnowledge } from '@/lib/ai/knowledge'
import { retrieveContext } from '@/lib/ai/retrieve'
import { generateAnswer, generateAnswerStream } from '@/lib/ai/llm'
import { answerQuestion, streamAnswer } from '@/lib/ai/answer'

const mHasLLM = vi.mocked(hasLLM)
const mGather = vi.mocked(gatherKnowledge)
const mRetrieve = vi.mocked(retrieveContext)
const mGen = vi.mocked(generateAnswer)
const mGenStream = vi.mocked(generateAnswerStream)

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

describe('answerQuestion — LLM ↔ 결정형 폴백', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mGather.mockResolvedValue({ text: 'KNOWLEDGE', facts: 'KNOWLEDGE', scopeProjectId: 'p1' })
    mRetrieve.mockResolvedValue([])
  })

  it('LLM 키 없으면 결정형 답변(usedLLM=false)', async () => {
    mHasLLM.mockReturnValue(false)
    const r = await answerQuestion({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(r.usedLLM).toBe(false)
    expect(r.intent).toBe('delayed')
    expect(r.answer).toBe('KNOWLEDGE')
    expect(mGen).not.toHaveBeenCalled()
  })

  it('LLM 키 있으면 LLM 답변(usedLLM=true)', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue('LLM 답변입니다')
    const r = await answerQuestion({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(r.usedLLM).toBe(true)
    expect(r.answer).toBe('LLM 답변입니다')
  })

  it('LLM 호출이 실패(null, 예: 429 쿼터)면 결정형으로 폴백', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue(null)
    const r = await answerQuestion({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(r.usedLLM).toBe(false)
    expect(r.answer).toBe('KNOWLEDGE')
  })
})

describe('streamAnswer — 스트리밍', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mGather.mockResolvedValue({ text: 'KNOWLEDGE', facts: 'KNOWLEDGE', scopeProjectId: 'p1' })
    mRetrieve.mockResolvedValue([])
  })

  it('LLM 키 없으면 결정형 답변을 단일 청크로 흘려보낸다', async () => {
    mHasLLM.mockReturnValue(false)
    const stream = await streamAnswer({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(await readAll(stream)).toBe('KNOWLEDGE')
  })

  it('토큰을 일부 보낸 뒤 끊기면 명시적 중단 마커를 덧붙인다', async () => {
    mHasLLM.mockReturnValue(true)
    mGenStream.mockResolvedValue(
      (async function* () {
        yield '안녕'
        throw new Error('연결 끊김')
      })(),
    )
    const stream = await streamAnswer({ projectId: 'p1', message: '자유 질문', history: [] })
    const text = await readAll(stream)
    expect(text).toContain('안녕')
    expect(text).toContain('⚠')
    expect(text).toContain('도중에 끊겼')
  })

  it('스트림이 토큰을 하나도 못 내면 결정형 폴백', async () => {
    mHasLLM.mockReturnValue(true)
    mGenStream.mockResolvedValue(
      (async function* () {
        /* 토큰 0개 */
      })(),
    )
    const stream = await streamAnswer({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(await readAll(stream)).toBe('KNOWLEDGE')
  })
})

describe('키워드 정확 일치(keywordHits) — 검색형 질문', () => {
  const HITS = {
    keywords: ['tft'],
    total: 1,
    lines: ['- [1. 준비] TFT R&R 확정 · 담당 PMO · 상태 완료 · 기간 2026-07-01~2026-07-07 · 실적 100%/계획 40%'],
  }
  beforeEach(() => {
    vi.clearAllMocks()
    mGather.mockResolvedValue({ text: 'KNOWLEDGE', facts: 'KNOWLEDGE', scopeProjectId: 'p1', keywordHits: HITS })
    mRetrieve.mockResolvedValue([])
  })

  it('LLM 근거([데이터])에 [키워드 정확 일치] 블록이 들어간다', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue('답')
    await answerQuestion({ projectId: 'p1', message: 'tft 단어가 들어간 항목 검색해줘', history: [] })
    const system = mGen.mock.calls[0][0] as string
    expect(system).toContain('[키워드 정확 일치]')
    expect(system).toContain('TFT R&R 확정')
  })

  it('일치 목록이 상한에 잘리면 데이터 블록에 생략 건수를 명시한다(조용한 절단 방지)', async () => {
    mGather.mockResolvedValue({
      text: 'KNOWLEDGE',
      facts: 'KNOWLEDGE',
      scopeProjectId: 'p1',
      keywordHits: { keywords: ['정의'], total: 3, lines: ['- 작업A', '- 작업B'] },
    })
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue('답')
    await answerQuestion({ projectId: 'p1', message: '정의 단어가 들어간 작업 검색', history: [] })
    const system = mGen.mock.calls[0][0] as string
    expect(system).toContain('…외 1건 생략')
  })

  it('LLM 실패 시 결정형 폴백이 정확 일치 목록으로 답한다(품질 저하 안내 없음)', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue(null)
    const r = await answerQuestion({ projectId: 'p1', message: 'tft 단어가 들어간 항목 검색해줘', history: [] })
    expect(r.answer).toContain("'tft' 가 들어간 작업 1건")
    expect(r.answer).toContain('TFT R&R 확정')
    expect(r.answer).not.toContain('⚠')
  })

  it('0건이면 없다고 답한다', async () => {
    mGather.mockResolvedValue({
      text: 'KNOWLEDGE',
      facts: 'KNOWLEDGE',
      scopeProjectId: 'p1',
      keywordHits: { keywords: ['xyz'], total: 0, lines: [] },
    })
    mHasLLM.mockReturnValue(false)
    const r = await answerQuestion({ projectId: 'p1', message: 'xyz 들어간 항목 검색해줘', history: [] })
    expect(r.answer).toContain("'xyz' 가 들어간 작업을 찾지 못했어요")
  })
})

describe('폴백 품질 저하 안내(degraded notice)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mGather.mockResolvedValue({ text: 'KNOWLEDGE', facts: 'KNOWLEDGE', scopeProjectId: 'p1' })
    mRetrieve.mockResolvedValue([])
  })

  it('LLM 설정 + 실패 + 일반 freeform → 안내 프리픽스', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue(null)
    const r = await answerQuestion({ projectId: 'p1', message: '이 프로젝트 리스크 알려줘', history: [] })
    expect(r.answer).toContain('AI 응답이 잠시 원활하지 않아')
  })

  it('LLM 미설정이면 안내 없음(원래 결정형이 기본)', async () => {
    mHasLLM.mockReturnValue(false)
    const r = await answerQuestion({ projectId: 'p1', message: '이 프로젝트 리스크 알려줘', history: [] })
    expect(r.answer).not.toContain('AI 응답이 잠시')
  })

  it('구조화 의도(지연 등)는 실패해도 안내 없음 — 결정형이 완전한 답', async () => {
    mHasLLM.mockReturnValue(true)
    mGen.mockResolvedValue(null)
    const r = await answerQuestion({ projectId: 'p1', message: '지연된 작업 알려줘', history: [] })
    expect(r.answer).toBe('KNOWLEDGE')
  })
})
