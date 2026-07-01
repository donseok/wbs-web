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
