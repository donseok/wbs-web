import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAnswer } from '@/lib/ai/llm'

// 왜 이 테스트가 있나 — 2026-08-18 공식 문서 실측.
// gemini-3.7-flash / 3.6-flash / 3.5-flash-lite 는 temperature·topP·topK 를 **에러 없이 무시**한다
// (deprecated 2026-07-21). 반면 지금까지 쓰던 gemini-3.5-flash 는 그 무시 목록에 없어 실제로 먹혔다.
// 즉 모델 문자열만 갈아끼우면 예외 하나 없이 출력 성격이 달라진다 — 빌드·린트·타입체크로는 절대 안 잡힌다.
// llm.ts 의 geminiGenerationConfig() 세대 분기가 그 방어선이므로, 여기서 페이로드로 못박는다.
//
// 3.x 는 thinkingLevel 로만 thinking 을 제어한다(thinkingBudget 과 혼용 시 400).
// 3.7 은 minimal 을 받지 않는다(실 키 실측: 400 "Thinking level MINIMAL is not supported") —
// 코드가 'low' 를 쓰는 이유이자, 임의로 minimal 로 낮추면 안 되는 이유다.

const fetchMock = vi.fn<typeof fetch>()

function jsonOk(text = '답변'): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

interface SentConfig {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number }
}

/** 주어진 모델로 1회 호출시켜 실제로 나간 generationConfig 를 돌려준다. */
async function sentConfigFor(model: string): Promise<SentConfig> {
  vi.stubEnv('GEMINI_MODEL', model)
  fetchMock.mockResolvedValue(jsonOk())
  await generateAnswer('시스템', [{ role: 'user', content: '질문' }], {
    allowModelFallback: false,
    retries: 0,
    retryRateLimit: false,
  })
  expect(fetchMock).toHaveBeenCalled()
  const [url, init] = fetchMock.mock.calls[0]
  expect(String(url)).toContain(`${model}:`)
  return (JSON.parse(String(init?.body)) as { generationConfig: SentConfig }).generationConfig
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  vi.stubEnv('GEMINI_FALLBACK_MODELS', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('geminiGenerationConfig — 모델 세대별 전송 파라미터', () => {
  // 3.7 은 2026-08-18 기준 기본 모델이다. 여기가 깨지면 전 AI 경로의 출력 성격이 바뀐다.
  for (const model of ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite']) {
    it(`${model}: temperature·topP·topK 를 보내지 않고 thinkingLevel 로만 제어한다`, async () => {
      const cfg = await sentConfigFor(model)
      expect(cfg.temperature).toBeUndefined()
      expect(cfg.topP).toBeUndefined()
      expect(cfg.topK).toBeUndefined()
      expect(cfg.thinkingConfig?.thinkingLevel).toBe('low')
      // thinkingBudget 과 섞으면 400 이다 — 절대 같이 나가면 안 된다.
      expect(cfg.thinkingConfig?.thinkingBudget).toBeUndefined()
      expect(cfg.maxOutputTokens).toBeTypeOf('number')
    })
  }

  it('3.7 은 minimal 을 지원하지 않으므로 thinkingLevel 을 minimal 로 보내지 않는다', async () => {
    const cfg = await sentConfigFor('gemini-3.7-flash')
    expect(cfg.thinkingConfig?.thinkingLevel).not.toBe('minimal')
  })

  it('gemini-2.x: thinkingLevel 미지원(400) → thinkingBudget 0 + 샘플링 파라미터 유지', async () => {
    const cfg = await sentConfigFor('gemini-2.5-flash')
    expect(cfg.temperature).toBe(0.3)
    expect(cfg.topP).toBe(0.9)
    expect(cfg.thinkingConfig?.thinkingBudget).toBe(0)
    expect(cfg.thinkingConfig?.thinkingLevel).toBeUndefined()
  })

  it('gemini-2.5-pro: thinking 비활성화 자체가 불가 → thinkingConfig 를 붙이지 않는다', async () => {
    const cfg = await sentConfigFor('gemini-2.5-pro')
    expect(cfg.thinkingConfig).toBeUndefined()
    expect(cfg.temperature).toBe(0.3)
  })

  it('비-gemini 모델(gemma): thinkingConfig 미지원(400) → 붙이지 않는다', async () => {
    const cfg = await sentConfigFor('gemma-4-31b-it')
    expect(cfg.thinkingConfig).toBeUndefined()
    expect(cfg.temperature).toBe(0.3)
    expect(cfg.topP).toBe(0.9)
  })
})
