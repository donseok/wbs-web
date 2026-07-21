import { describe, it, expect, vi, beforeEach } from 'vitest'

// next/cache · auth · Supabase 클라이언트 · 오버라이드 캐시를 모두 모킹해 액션 로직만 검증한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { createServerClient, refreshLlmOverride } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => {
    throw new Error('게이트 통과 전 createServerClient 호출 금지')
  }),
  refreshLlmOverride: vi.fn(async () => true),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getMembership: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/ai/llm-override', () => ({ refreshLlmOverride }))

import { getMembership } from '@/lib/auth'
import {
  listLlmProfiles, createLlmProfile, updateLlmProfile, deleteLlmProfile,
  getLlmConfig, saveLlmConfig, testLlmConnection, maskToken,
  type LlmProfileInput,
} from '@/app/actions/llmConfig'

const NON_ADMIN = [null, { role: 'team_editor', teamCode: 'PMO', teamId: 't1' }] as const

const VALID_INPUT: LlmProfileInput = {
  name: 'gemini-기본', preset_id: 'gemini', provider: 'gemini', model: 'gemini-3.5-flash',
}

/** 7개 액션을 인자까지 묶어 두고 게이트만 교차 검증한다(반환 유니온은 호출부에서 좁힌다). */
const ACTIONS: [string, () => Promise<unknown>][] = [
  ['listLlmProfiles', () => listLlmProfiles()],
  ['createLlmProfile', () => createLlmProfile(VALID_INPUT)],
  ['updateLlmProfile', () => updateLlmProfile(1, VALID_INPUT)],
  ['deleteLlmProfile', () => deleteLlmProfile(1)],
  ['getLlmConfig', () => getLlmConfig()],
  ['saveLlmConfig', () => saveLlmConfig({ mode: 'profile', active_profile_id: 1 })],
  ['testLlmConnection', () => testLlmConnection({ provider: 'gemini', model: 'gemini-3.5-flash' })],
]

/**
 * Supabase 체인 모킹 — from/select/update/eq ... 는 자기 자신을 돌려주고
 * single/maybeSingle 만 결과를 확정한다(액션이 쓰는 호출 순서에 맞춘 최소 구현).
 */
function makeSbChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const key of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'order', 'upsert']) {
    chain[key] = vi.fn(() => chain)
  }
  chain.single = vi.fn(async () => result)
  chain.maybeSingle = vi.fn(async () => result)
  return chain
}

const PROFILE_ROW = {
  id: 1, name: 'gemini-기본', preset_id: 'gemini', provider: 'gemini',
  base_url: null, model: 'gemini-3.5-flash', auth_token: 'AIzaSy-abcdefgh-1234',
  max_input_tokens: null, max_output_tokens: null,
}

describe('LLM 설정 서버액션 권한 게이트', () => {
  beforeEach(() => {
    createServerClient.mockClear()
    refreshLlmOverride.mockClear()
  })

  const CASES = ACTIONS.flatMap(([name, run]) => NON_ADMIN.map(m => [name, run, m] as const))

  it.each(CASES)('비-pmo_admin(%s / %#)은 거부하고 DB에 손대지 않는다', async (_name, run, membership) => {
    vi.mocked(getMembership).mockResolvedValue(membership as never)
    const res = (await run()) as { error?: string }
    expect(res.error).toBe('권한이 없습니다')
    // 게이트가 첫 줄이어야 한다 — 통과 전 클라이언트를 만들면 위 모킹이 throw 한다.
    expect(createServerClient).not.toHaveBeenCalled()
    expect(refreshLlmOverride).not.toHaveBeenCalled()
  })
})

describe('maskToken', () => {
  it('토큰이 없으면 null', async () => {
    expect(await maskToken(null)).toBeNull()
    expect(await maskToken(undefined)).toBeNull()
    expect(await maskToken('')).toBeNull()
  })

  it('8자 이하는 통째로 가린다(앞4+뒤4가 원문 전체가 되므로)', async () => {
    expect(await maskToken('12345678')).toBe('****')
    expect(await maskToken('abc')).toBe('****')
  })

  it('9자 이상은 앞4 + ... + 뒤4', async () => {
    expect(await maskToken('123456789')).toBe('1234...6789')
    expect(await maskToken('AIzaSy-abcdefgh-1234')).toBe('AIza...1234')
  })
})

describe('updateLlmProfile 키 유지 규칙', () => {
  beforeEach(() => {
    createServerClient.mockReset()
    refreshLlmOverride.mockClear()
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' } as never)
  })

  async function runUpdate(input: LlmProfileInput) {
    const chain = makeSbChain({ data: PROFILE_ROW, error: null })
    createServerClient.mockReturnValue(chain as never)
    const res = await updateLlmProfile(1, input)
    return { res, payload: chain.update.mock.calls[0][0] as Record<string, unknown> }
  }

  it('auth_token 미전송이면 update payload 에서 컬럼이 빠진다(기존 키 유지)', async () => {
    const { payload } = await runUpdate(VALID_INPUT)
    expect('auth_token' in payload).toBe(false)
  })

  it('auth_token 이 빈 문자열/공백이어도 컬럼이 빠진다', async () => {
    expect('auth_token' in (await runUpdate({ ...VALID_INPUT, auth_token: '' })).payload).toBe(false)
    expect('auth_token' in (await runUpdate({ ...VALID_INPUT, auth_token: '   ' })).payload).toBe(false)
  })

  it('auth_token 이 입력되면 트림해서 저장한다', async () => {
    const { payload } = await runUpdate({ ...VALID_INPUT, auth_token: '  new-secret-key  ' })
    expect(payload.auth_token).toBe('new-secret-key')
  })

  it('응답에는 토큰 원문 대신 마스킹만 실린다', async () => {
    const { res } = await runUpdate(VALID_INPUT)
    expect(res).toEqual({
      profile: expect.objectContaining({ has_token: true, auth_token_masked: 'AIza...1234' }),
    })
    expect(JSON.stringify(res)).not.toContain(PROFILE_ROW.auth_token)
  })
})

/** llm_config(단건)와 llm_profiles(목록)가 서로 다른 결과를 내야 하므로 전용 스텁을 쓴다. */
function makeConfigSb(
  config: { mode: string; active_profile_id: number | null } | null,
  profiles: Record<string, unknown>[],
) {
  const profilesQuery = {
    select: () => profilesQuery,
    order: async () => ({ data: profiles, error: null }),
  }
  const configQuery = {
    select: () => configQuery,
    eq: () => configQuery,
    maybeSingle: async () => ({ data: config, error: null }),
  }
  return { from: (table: string) => (table === 'llm_config' ? configQuery : profilesQuery) }
}

describe('getLlmConfig dangling 해석', () => {
  beforeEach(() => {
    createServerClient.mockReset()
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' } as never)
  })

  async function run(config: { mode: string; active_profile_id: number | null } | null, profiles = [PROFILE_ROW]) {
    createServerClient.mockReturnValue(makeConfigSb(config, profiles) as never)
    return (await getLlmConfig()) as { mode: string; active_profile_id: number | null }
  }

  it('활성 프로필이 살아 있으면 profile 모드를 그대로 돌려준다', async () => {
    expect(await run({ mode: 'profile', active_profile_id: 1 })).toMatchObject({ mode: 'profile', active_profile_id: 1 })
  })

  it("삭제로 active_profile_id 가 풀리면 화면에도 'env' 로 보여준다(런타임과 동일 해석)", async () => {
    expect(await run({ mode: 'profile', active_profile_id: null })).toMatchObject({ mode: 'env', active_profile_id: null })
  })

  it('가리키는 프로필이 목록에 없어도 env 로 해석한다', async () => {
    expect(await run({ mode: 'profile', active_profile_id: 99 })).toMatchObject({ mode: 'env', active_profile_id: null })
  })

  it("mode='none' 은 그대로 유지한다(차단 상태를 env 로 뭉개지 않는다)", async () => {
    expect(await run({ mode: 'none', active_profile_id: null })).toMatchObject({ mode: 'none' })
  })
})

describe('saveLlmConfig 반영 실패 신호', () => {
  beforeEach(() => {
    createServerClient.mockReset()
    refreshLlmOverride.mockClear()
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' } as never)
    createServerClient.mockReturnValue(makeSbChain({ data: { id: 1 }, error: null }) as never)
  })

  it('캐시 갱신까지 성공하면 warning 이 없다', async () => {
    refreshLlmOverride.mockResolvedValueOnce(true)
    expect(await saveLlmConfig({ mode: 'none' })).toEqual({ ok: true })
  })

  it('DB 저장은 됐지만 캐시 갱신이 실패하면 warning 으로 알린다(조용한 성공 금지)', async () => {
    refreshLlmOverride.mockResolvedValueOnce(false)
    const res = (await saveLlmConfig({ mode: 'none' })) as { ok: true; warning?: string }
    expect(res.ok).toBe(true)
    expect(res.warning).toContain('즉시 반영에 실패')
  })
})

describe('testLlmConnection 오류 메시지 토큰 유출', () => {
  beforeEach(() => {
    vi.mocked(getMembership).mockResolvedValue({ role: 'pmo_admin', teamCode: 'PMO', teamId: 't1' } as never)
  })

  it('200자 경계에 걸친 토큰도 잘려서 새지 않는다(자르기 전에 마스킹)', async () => {
    const token = 'sk-supersecret-0123456789'
    // 클립 경계(200자)에 토큰이 걸치도록 배치 — 자른 뒤 치환하면 앞부분이 그대로 남는다.
    const body = 'x'.repeat(180) + token + ' tail'
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 401 }))
    const res = await testLlmConnection({
      provider: 'openai', model: 'local-model', base_url: 'http://llm.internal/v1', auth_token: token,
    })
    fetchSpy.mockRestore()

    expect(res.success).toBe(false)
    expect(res.error).not.toContain(token)
    // 자른 뒤 치환하면 클립 안에 남은 토큰 앞부분(20자)이 그대로 노출된다.
    expect(res.error).not.toContain(token.slice(0, 16))
  })
})
