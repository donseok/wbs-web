import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAnswer, generateAnswerStream } from '@/lib/ai/llm'
import { fetchWithRetry, parseRetryDelayMs } from '@/lib/ai/util'

const RATE_LIMIT_BODY = JSON.stringify({
  error: { code: 429, message: 'Quota exceeded ... Please retry in 0.01s.', status: 'RESOURCE_EXHAUSTED' },
})

function json429(): Response {
  return new Response(RATE_LIMIT_BODY, { status: 429 })
}
function jsonOk(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
function sseOk(text: string): Response {
  const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })
  return new Response(`data: ${payload}\n\n`, { status: 200 })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash')
  vi.stubEnv('GEMINI_FALLBACK_MODELS', 'gemini-3.1-flash-lite')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('parseRetryDelayMs — 429 재시도 지연 파싱', () => {
  it('Google 오류 본문의 "retry in Xs"', async () => {
    expect(await parseRetryDelayMs(new Response('Please retry in 3.7s.', { status: 429 }))).toBe(3700)
  })
  it('Retry-After 헤더(초)', async () => {
    const r = new Response('', { status: 429, headers: { 'Retry-After': '2' } })
    expect(await parseRetryDelayMs(r)).toBe(2000)
  })
  it('정보 없으면 null', async () => {
    expect(await parseRetryDelayMs(new Response('nope', { status: 429 }))).toBeNull()
  })
})

describe('fetchWithRetry — 429 재시도', () => {
  it('짧은 지연이면 기다렸다 1회 재시도해 성공을 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(json429()).mockResolvedValueOnce(jsonOk('ok'))
    const res = await fetchWithRetry(signal => fetch('http://x', { signal }))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('재시도 후에도 429 면 그대로 반환(무한 대기 없음)', async () => {
    fetchMock.mockImplementation(async () => json429())
    const res = await fetchWithRetry(signal => fetch('http://x', { signal }))
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('지연 정보가 없는 429 는 재시도하지 않는다', async () => {
    fetchMock.mockImplementation(async () => new Response('slow down', { status: 429 }))
    const res = await fetchWithRetry(signal => fetch('http://x', { signal }))
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('generateAnswer — 모델 폴백 체인', () => {
  it('주 모델 429(재시도 포함) → 폴백 모델이 답하면 그 답을 반환', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('gemini-3.5-flash:')) return json429()
      if (url.includes('gemini-3.1-flash-lite:')) return jsonOk('폴백 답변')
      throw new Error(`unexpected url: ${url}`)
    })
    const out = await generateAnswer('시스템', [{ role: 'user', content: '질문' }])
    expect(out).toBe('폴백 답변')
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.includes('gemini-3.5-flash:'))).toBe(true)
    expect(urls.some(u => u.includes('gemini-3.1-flash-lite:'))).toBe(true)
  })

  it('주 모델이 빈 답변(MAX_TOKENS 등)이어도 폴백 모델을 시도한다', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('gemini-3.5-flash:'))
        return new Response(JSON.stringify({ candidates: [{ content: {}, finishReason: 'MAX_TOKENS' }] }), {
          status: 200,
        })
      return jsonOk('폴백 답변')
    })
    expect(await generateAnswer('시스템', [{ role: 'user', content: '질문' }])).toBe('폴백 답변')
  })

  it('전 모델 실패 → null (호출측 결정형 폴백)', async () => {
    fetchMock.mockImplementation(async () => json429())
    expect(await generateAnswer('시스템', [{ role: 'user', content: '질문' }])).toBeNull()
  })

  it('GEMINI_FALLBACK_MODELS="" 이면 폴백 없이 주 모델만', async () => {
    vi.stubEnv('GEMINI_FALLBACK_MODELS', '')
    fetchMock.mockImplementation(async () => json429())
    expect(await generateAnswer('시스템', [{ role: 'user', content: '질문' }])).toBeNull()
    // 429 짧은 지연 재시도(2회 호출)만 있고 다른 모델 호출은 없다
    const urls = new Set(fetchMock.mock.calls.map(c => String(c[0])))
    expect([...urls].every(u => u.includes('gemini-3.5-flash:'))).toBe(true)
  })
})

describe('generateAnswerStream — 스트림 폴백 체인', () => {
  async function collect(iter: AsyncGenerator<string>): Promise<string> {
    let out = ''
    for await (const c of iter) out += c
    return out
  }

  it('주 모델 스트림 429 → 폴백 모델 스트림으로 답한다', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('gemini-3.5-flash:')) return json429()
      return sseOk('폴백 스트림')
    })
    const iter = await generateAnswerStream('시스템', [{ role: 'user', content: '질문' }])
    expect(iter).not.toBeNull()
    expect(await collect(iter!)).toBe('폴백 스트림')
  })

  it('전 모델 실패 → 첫 순회에서 throw (호출측이 폴백 처리)', async () => {
    fetchMock.mockImplementation(async () => json429())
    const iter = await generateAnswerStream('시스템', [{ role: 'user', content: '질문' }])
    await expect(collect(iter!)).rejects.toThrow(/429/)
  })
})
