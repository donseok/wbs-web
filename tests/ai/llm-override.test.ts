import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Supabase service_role 클라이언트를 가짜 테이블로 대체해 해석(resolve) 규칙만 검증한다.
// vi.mock 팩토리는 최상단으로 호이스팅되므로 상태·스파이는 vi.hoisted 로 먼저 만든다.
// (모듈 초기화 top-level await 보다 모킹이 먼저 걸려야 한다.)
const { db, createAdminClient } = vi.hoisted(() => {
  const db = {
    config: null as { mode: string; active_profile_id: number | null } | null,
    profiles: new Map<number, Record<string, unknown>>(),
    /** 조회를 임의 시점까지 붙잡아 두는 게이트 — 로드와 저장이 겹치는 경합 재현용. */
    hold: null as Promise<void> | null,
  }
  const query = (rowFor: (id: unknown) => unknown) => {
    let id: unknown = null
    const q = {
      select: () => q,
      eq: (_column: string, value: unknown) => { id = value; return q },
      maybeSingle: async () => {
        // 호출 시점에 스냅샷을 뜬다 — 대기하는 동안 DB 가 바뀌어도 이 로드는 옛 값을 본다.
        const data = rowFor(id) ?? null
        if (db.hold) await db.hold
        return { data, error: null }
      },
    }
    return q
  }
  const createAdminClient = vi.fn(() => ({
    from: (table: string) =>
      table === 'llm_config'
        ? query(() => db.config)
        : query((id) => db.profiles.get(Number(id))),
  }))
  return { db, createAdminClient }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import { llmOverrideSync, refreshLlmOverride } from '@/lib/ai/llm-override'
import { llmConfig, hasLLM } from '@/lib/ai/provider'
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL } from '@/lib/ai/endpoints'

/** 테이블 상태를 세팅한 뒤 캐시를 즉시 교체한다. */
async function setState(
  config: { mode: string; active_profile_id: number | null } | null,
  profiles: Record<number, Record<string, unknown>> = {},
) {
  db.config = config
  db.profiles = new Map(Object.entries(profiles).map(([id, row]) => [Number(id), row]))
  await refreshLlmOverride()
}

describe('llm-override 해석 규칙', () => {
  beforeEach(() => {
    // env 모드 회귀 검증을 위해 env 값을 고정한다(셸 환경에 좌우되지 않도록).
    vi.stubEnv('AI_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'env-gemini-key')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.stubEnv('GEMINI_BASE_URL', '')
    vi.stubEnv('GEMINI_MODEL', '')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it("mode='env' 는 env 로직 그대로 (회귀 없음)", async () => {
    await setState({ mode: 'env', active_profile_id: null })
    expect(llmOverrideSync()).toEqual({ mode: 'env', profile: null })
    expect(llmConfig()).toEqual({
      provider: 'gemini',
      apiKey: 'env-gemini-key',
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      model: 'gemini-3.5-flash',
    })
    expect(hasLLM()).toBe(true)
  })

  it("mode='profile' 은 프로필 값을 반환하고 env 의 provider 를 무시한다", async () => {
    vi.stubEnv('AI_PROVIDER', 'gemini')
    await setState({ mode: 'profile', active_profile_id: 7 }, {
      7: { provider: 'openai', base_url: 'http://localhost:11434/v1', model: 'llama3', auth_token: 'tok-123' },
    })
    expect(llmConfig()).toEqual({
      provider: 'openai',
      apiKey: 'tok-123',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
    })
    expect(hasLLM()).toBe(true)
  })

  it("mode='none' 은 env 키가 있어도 미구성으로 취급한다", async () => {
    await setState({ mode: 'none', active_profile_id: null })
    expect(llmConfig().apiKey).toBeUndefined()
    expect(hasLLM()).toBe(false)
    // 미구성이어도 baseUrl/model 은 유효값이라 URL 조합이 깨지지 않는다.
    expect(llmConfig().baseUrl).toBe(DEFAULT_GEMINI_BASE_URL)
  })

  it("dangling: mode='profile' 인데 active_profile_id 가 null 이면 env 폴백", async () => {
    await setState({ mode: 'profile', active_profile_id: null })
    expect(llmOverrideSync()).toEqual({ mode: 'env', profile: null })
    expect(llmConfig().apiKey).toBe('env-gemini-key')
  })

  it('dangling: 가리키는 프로필 행이 없으면 env 폴백', async () => {
    await setState({ mode: 'profile', active_profile_id: 99 }, {})
    expect(llmOverrideSync().mode).toBe('env')
    expect(hasLLM()).toBe(true)
  })

  it('빈 base_url 은 provider 기본 엔드포인트로 채워진다', async () => {
    await setState({ mode: 'profile', active_profile_id: 1 }, {
      1: { provider: 'gemini', base_url: '', model: 'gemini-3.5-flash', auth_token: 'g-key' },
    })
    expect(llmConfig().baseUrl).toBe(DEFAULT_GEMINI_BASE_URL)

    await setState({ mode: 'profile', active_profile_id: 2 }, {
      2: { provider: 'openai', base_url: null, model: 'gpt-4o-mini', auth_token: 'o-key' },
    })
    expect(llmConfig().baseUrl).toBe(DEFAULT_OPENAI_BASE_URL)
  })

  it('키 없는 openai 프로필은 placeholder apiKey 를 받는다 (빈 키 가드 회피)', async () => {
    await setState({ mode: 'profile', active_profile_id: 3 }, {
      3: { provider: 'openai', base_url: 'http://localhost:1234/v1', model: 'local-model', auth_token: null },
    })
    expect(llmConfig().apiKey).toBe('local')
    expect(hasLLM()).toBe(true)
  })

  it('키 없는 gemini 프로필은 미구성(hasLLM=false)', async () => {
    await setState({ mode: 'profile', active_profile_id: 4 }, {
      4: { provider: 'gemini', base_url: '', model: 'gemini-3.5-flash', auth_token: '' },
    })
    expect(llmConfig().apiKey).toBe('')
    expect(hasLLM()).toBe(false)
  })

  it('refreshLlmOverride() 후 즉시 반영된다', async () => {
    await setState({ mode: 'env', active_profile_id: null })
    expect(hasLLM()).toBe(true)

    db.config = { mode: 'none', active_profile_id: null }
    expect(hasLLM()).toBe(true) // 아직 캐시(TTL 미만) — 동기 접근자는 옛 값을 준다

    await refreshLlmOverride()
    expect(hasLLM()).toBe(false)
  })

  it('llm_config 행이 없으면 env 로 해석한다', async () => {
    await setState(null)
    expect(llmOverrideSync()).toEqual({ mode: 'env', profile: null })
  })

  it('저장 직후 refresh 는 진행 중이던 로드에 편승하지 않는다', async () => {
    await setState({ mode: 'env', active_profile_id: null })
    expect(hasLLM()).toBe(true)

    // TTL 백그라운드 갱신이 옛 설정을 읽는 도중에 관리자가 '선택 안함'을 저장하는 경합.
    let release = () => {}
    db.hold = new Promise<void>((resolve) => { release = () => resolve() })
    const stale = refreshLlmOverride()
    await new Promise((r) => setTimeout(r, 0)) // 진행 중 로드가 옛 값을 읽고 게이트에서 멈추게 한다

    db.config = { mode: 'none', active_profile_id: null } // 저장이 DB 에 반영된 시점
    const afterSave = refreshLlmOverride() // saveLlmConfig 가 await 하는 호출
    db.hold = null
    release()
    await Promise.all([stale, afterSave])

    // 진행 중 로드에 편승했다면 옛 스냅샷(env)이 캐시에 고착돼 true 로 남는다.
    expect(hasLLM()).toBe(false)
  })

  it('TTL 만료 시 백그라운드 갱신은 한 번만 뜬다(스탬피드 방지)', async () => {
    await setState({ mode: 'env', active_profile_id: null })
    createAdminClient.mockClear()
    // 캐시가 TTL(60초)을 넘긴 상황을 만든다.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    llmOverrideSync()
    llmOverrideSync()
    llmOverrideSync()
    await new Promise((r) => setTimeout(r, 0))
    expect(createAdminClient).toHaveBeenCalledTimes(1)
    nowSpy.mockRestore()
  })

  it('base_url 끝 슬래시는 제거된다 (연결 테스트와 실사용 URL 이 갈리지 않도록)', async () => {
    await setState({ mode: 'profile', active_profile_id: 5 }, {
      5: { provider: 'openai', base_url: 'http://llm.internal:11434/v1/', model: 'm', auth_token: 't' },
    })
    // 남겨두면 llm.ts 의 `${baseUrl}/chat/completions` 조합이 `.../v1//chat/completions` → 404 가 된다.
    expect(llmConfig().baseUrl).toBe('http://llm.internal:11434/v1')
  })

  it('max_output_tokens 는 llmConfig 에 실려 생성 상한으로 쓰인다', async () => {
    await setState({ mode: 'profile', active_profile_id: 6 }, {
      6: { provider: 'openai', base_url: '', model: 'm', auth_token: 't', max_output_tokens: 512 },
    })
    expect(llmConfig().maxOutputTokens).toBe(512)

    // 미지정(null)이면 키 자체가 없어야 한다 — llm.ts 가 모델 기본값을 쓰도록.
    await setState({ mode: 'profile', active_profile_id: 7 }, {
      7: { provider: 'openai', base_url: '', model: 'm', auth_token: 't', max_output_tokens: null },
    })
    expect(llmConfig().maxOutputTokens).toBeUndefined()
  })

  it('갱신 실패는 직전 유효 설정을 보존한다 (차단이 스스로 풀리지 않는다)', async () => {
    await setState({ mode: 'none', active_profile_id: null })
    expect(hasLLM()).toBe(false)

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createAdminClient.mockImplementationOnce(() => { throw new Error('DB 순단') })
    expect(await refreshLlmOverride()).toBe(false)

    // env 로 덮어쓰면 관리자가 건 LLM 차단이 DB 순단 한 번으로 풀리고(env 키로 외부 호출 재개)
    // 화면·응답 어디에도 신호가 없다. 갱신 실패의 계약은 '직전 유효 설정 유지'다.
    expect(llmOverrideSync()).toEqual({ mode: 'none', profile: null })
    expect(hasLLM()).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refreshLlmOverride() 는 반영 성공 여부를 돌려준다 (액션이 관리자에게 알릴 근거)', async () => {
    expect(await refreshLlmOverride()).toBe(true)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createAdminClient.mockImplementationOnce(() => { throw new Error('DB 순단') })
    expect(await refreshLlmOverride()).toBe(false)
    spy.mockRestore()
  })

  it('한 번도 성공한 적 없는 콜드스타트에서만 env 로 기동한다 (스펙 §5 승인 폴백)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = createAdminClient.getMockImplementation()
    vi.resetModules() // 모듈 초기화(top-level await)를 다시 태우기 위한 새 인스턴스
    createAdminClient.mockImplementation(() => { throw new Error('콜드스타트 DB 순단') })
    try {
      const fresh = await import('@/lib/ai/llm-override')
      expect(fresh.llmOverrideSync()).toEqual({ mode: 'env', profile: null })
    } finally {
      if (original) createAdminClient.mockImplementation(original)
      spy.mockRestore()
    }
  })
})
