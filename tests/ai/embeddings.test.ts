import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedTexts, embedDocuments } from '@/lib/ai/embeddings'

function geminiOk(values: number[]) {
  return { ok: true, status: 200, json: async () => ({ embedding: { values } }) }
}
function bodyText(init: { body?: unknown }): string {
  return JSON.parse(String(init.body)).content.parts[0].text
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

describe('embedDocuments — 항목 단위 실패 격리 (재색인)', () => {
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

  it('키 없으면 null, 빈 입력은 []', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(await embedDocuments(['a'], 'RETRIEVAL_DOCUMENT')).toBeNull()
    expect(await embedDocuments([], 'RETRIEVAL_DOCUMENT')).toEqual([])
  })

  it('한 항목이 실패(400)해도 나머지 성공분은 벡터로, 실패분은 null 로 정렬해 반환', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const good = new Array(768).fill(0.01)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body?: unknown }) =>
        bodyText(init) === 'bad'
          ? { ok: false, status: 400, text: async () => 'input too long' }
          : geminiOk(good),
      ),
    )
    const out = await embedDocuments(['a', 'bad', 'c'], 'RETRIEVAL_DOCUMENT')
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(3)
    expect(out![0]).toHaveLength(768)
    expect(out![1]).toBeNull() // 400 → 그 항목만 건너뜀
    expect(out![2]).toHaveLength(768)
  })

  it('차원이 틀린 항목만 null, 정상 항목은 유지', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    const good = new Array(768).fill(0.01)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body?: unknown }) =>
        bodyText(init) === 'short' ? geminiOk([0.1, 0.2]) : geminiOk(good),
      ),
    )
    const out = await embedDocuments(['ok', 'short'], 'RETRIEVAL_DOCUMENT')
    expect(out![0]).toHaveLength(768)
    expect(out![1]).toBeNull()
  })
})
