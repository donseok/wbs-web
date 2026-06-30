import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedTexts } from '@/lib/ai/embeddings'

function geminiOk(values: number[]) {
  return { ok: true, status: 200, json: async () => ({ embedding: { values } }) }
}

describe('embedTexts — 차원 검증 (Gemini)', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('EMBED_DIM', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('빈 입력은 키 없이도 빈 배열', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(await embedTexts([], 'RETRIEVAL_QUERY')).toEqual([])
  })

  it('키가 없으면 null(의미검색 비활성)', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedTexts(['hello'], 'RETRIEVAL_QUERY')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('기대 차원(768)을 반환하면 벡터를 그대로 돌려준다', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const vec = new Array(768).fill(0.01)
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk(vec)))
    const out = await embedTexts(['hello'], 'RETRIEVAL_DOCUMENT')
    expect(out).not.toBeNull()
    expect(out![0]).toHaveLength(768)
  })

  it('모델이 차원을 무시하고 다른 길이를 반환하면 null + 명확한 로그(배치 insert 실패 선제 차단)', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk(new Array(5).fill(0.5))))
    const errSpy = vi.spyOn(console, 'error')
    const out = await embedTexts(['hello'], 'RETRIEVAL_DOCUMENT')
    expect(out).toBeNull()
    const logged = errSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toMatch(/차원 불일치/)
  })

  it('EMBED_DIM 오버라이드 차원도 검증한다', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubEnv('EMBED_DIM', '4')
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk([0.1, 0.2, 0.3, 0.4])))
    const out = await embedTexts(['hello'], 'RETRIEVAL_QUERY')
    expect(out![0]).toHaveLength(4)
  })
})
