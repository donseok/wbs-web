import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 왜 이 테스트가 있나 — 2026-08-18.
// "지금 운영이 무슨 모델을 쓰고 있나"는 코드·env·DB 세 곳이 겹쳐 결정되는데 화면 어디에도
// 안 나와서, 모델을 올린 뒤 사람이 확인할 방법이 없었다. activeModelInfo() 가 그 답을 만든다.
// 가장 중요한 계약은 **API 키를 절대 싣지 않는 것**과, **프로필 오버라이드가 생성 모델만
// 덮고 임베딩은 env 그대로**라는 비대칭을 정직하게 드러내는 것이다.
//
// llm-override 는 모듈 초기화에 top-level await 가 있어 vi.mock 이 먼저 걸려야 한다
// (tests/ai/llm-override.test.ts 와 같은 vi.hoisted 패턴).
const { db, createAdminClient } = vi.hoisted(() => {
  const db = {
    config: null as { mode: string; active_profile_id: number | null } | null,
    profiles: new Map<number, Record<string, unknown>>(),
  }
  const query = (rowFor: (id: unknown) => unknown) => {
    let id: unknown = null
    const q = {
      select: () => q,
      eq: (_column: string, value: unknown) => { id = value; return q },
      maybeSingle: async () => ({ data: rowFor(id) ?? null, error: null }),
    }
    return q
  }
  const createAdminClient = vi.fn(() => ({
    from: (table: string) =>
      table === 'llm_config' ? query(() => db.config) : query((id) => db.profiles.get(Number(id))),
  }))
  return { db, createAdminClient }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { refreshLlmOverride } from '@/lib/ai/llm-override'
import { activeModelInfo } from '@/lib/ai/health'

async function setState(
  config: { mode: string; active_profile_id: number | null } | null,
  profiles: Record<number, Record<string, unknown>> = {},
) {
  db.config = config
  db.profiles = new Map(Object.entries(profiles).map(([id, row]) => [Number(id), row]))
  await refreshLlmOverride()
}

beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'gemini')
  vi.stubEnv('GEMINI_API_KEY', 'env-gemini-key')
  vi.stubEnv('GOOGLE_API_KEY', '')
  vi.stubEnv('GEMINI_MODEL', '')
  vi.stubEnv('GEMINI_EMBED_MODEL', '')
  vi.stubEnv('GEMINI_FALLBACK_MODELS', '')
  vi.stubEnv('EMBED_DIM', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('activeModelInfo — 지금 실제로 쓰이는 모델', () => {
  it("mode='env': provider.ts 의 현행 기본값을 그대로 보고한다", async () => {
    await setState({ mode: 'env', active_profile_id: null })
    const info = await activeModelInfo()
    expect(info.source).toBe('env')
    expect(info.provider).toBe('gemini')
    // 기본값을 올릴 때 이 단언이 같이 깨지는 것이 정상이다(조용한 변경 방지).
    expect(info.llm).toBe('gemini-3.7-flash')
    expect(info.embedding).toBe('gemini-embedding-001')
    expect(info.embeddingDim).toBe(768)
  })

  it("mode='env': GEMINI_MODEL 오버라이드가 있으면 그 값을 보고한다", async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.6-flash')
    await setState({ mode: 'env', active_profile_id: null })
    expect((await activeModelInfo()).llm).toBe('gemini-3.6-flash')
  })

  it('폴백 체인을 주 모델 제외하고 순서대로 보고한다', async () => {
    // 변수 자체를 없애야 "미설정 → 코드 기본 배열" 경로를 탄다(빈 문자열은 '폴백 없음'이라 다르다).
    vi.stubEnv('GEMINI_FALLBACK_MODELS', undefined)
    await setState({ mode: 'env', active_profile_id: null })
    const info = await activeModelInfo()
    expect(info.llmFallbacks).toEqual(['gemini-3.5-flash-lite', 'gemini-3.6-flash'])
    expect(info.llmFallbacks).not.toContain(info.llm) // 주 모델은 체인에서 뺀다
  })

  it('GEMINI_FALLBACK_MODELS="" 면 폴백 없음으로 보고한다', async () => {
    vi.stubEnv('GEMINI_FALLBACK_MODELS', '')
    await setState({ mode: 'env', active_profile_id: null })
    expect((await activeModelInfo()).llmFallbacks).toEqual([])
  })

  it("mode='profile': 생성은 프로필 값, **임베딩은 env 그대로**라는 비대칭을 드러낸다", async () => {
    await setState(
      { mode: 'profile', active_profile_id: 7 },
      { 7: { id: 7, provider: 'openai', base_url: '', model: 'gpt-4o-mini', auth_token: 'sk-x' } },
    )
    const info = await activeModelInfo()
    expect(info.source).toBe('profile')
    expect(info.provider).toBe('openai')
    expect(info.llm).toBe('gpt-4o-mini')
    // 프로필은 임베딩을 덮지 않는다 — 여기가 갈리는 것을 관리자가 알아야 한다.
    expect(info.embeddingProvider).toBe('gemini')
    expect(info.embedding).toBe('gemini-embedding-001')
  })

  it("mode='none': LLM 차단 상태를 source 로 알리되 모델 이름은 계속 보여준다", async () => {
    await setState({ mode: 'none', active_profile_id: null })
    const info = await activeModelInfo()
    expect(info.source).toBe('none')
    expect(info.llm).toBe('gemini-3.7-flash') // 껐을 뿐 설정은 그대로 — 되돌릴 때 뭐가 켜지는지 보여야 한다
  })

  it('⚠️ API 키·토큰을 절대 싣지 않는다', async () => {
    await setState(
      { mode: 'profile', active_profile_id: 7 },
      { 7: { id: 7, provider: 'gemini', base_url: '', model: 'gemini-3.7-flash', auth_token: 'super-secret-token' } },
    )
    const serialized = JSON.stringify(await activeModelInfo())
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('env-gemini-key')
    expect(serialized).not.toMatch(/apiKey|auth_token|authToken/i)
  })
})
