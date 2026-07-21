'use server'
import { revalidatePath } from 'next/cache'
import { getMembership, getSession } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase/server'
import { refreshLlmOverride } from '@/lib/ai/llm-override'
import { normalizeBaseUrl } from '@/lib/ai/endpoints'

export type LlmMode = 'env' | 'profile' | 'none'

/** 목록/상세 응답 — auth_token 원문은 절대 포함하지 않는다(마스킹 + 보유 여부만). */
export interface LlmProfileMasked {
  id: number
  name: string
  preset_id: string
  provider: 'gemini' | 'openai'
  base_url: string | null
  model: string
  max_input_tokens: number | null
  max_output_tokens: number | null
  has_token: boolean
  auth_token_masked: string | null
}

export interface LlmProfileInput {
  name: string
  preset_id: string
  provider: 'gemini' | 'openai'
  base_url?: string
  model: string
  auth_token?: string // 빈 문자열/미전송 = "변경 없음"(update 시 컬럼 자체를 제외)
  max_input_tokens?: number
  max_output_tokens?: number
}

export interface TestLlmInput {
  provider: 'gemini' | 'openai'
  model: string
  base_url?: string
  auth_token?: string
  profile_id?: number // auth_token 이 비어 있을 때 저장된 키를 서버에서 폴백 조회
}

/**
 * 성공 응답. warning 은 "DB 저장은 됐지만 이 인스턴스의 런타임 캐시 갱신이 실패했다"는 신호다 —
 * 삼키면 관리자가 '선택 안함'을 저장하고도 최대 60초간 LLM 이 계속 도는 것을 모른 채 넘어간다.
 */
export interface ActionOk {
  ok: true
  warning?: string
}

const NO_PERMISSION = '권한이 없습니다'
const REFRESH_WARNING = '저장은 됐지만 즉시 반영에 실패했습니다 — 최대 1분 내 자동 반영됩니다.'
const CONFIG_PATH = '/admin/llm-config'
/** auth_token 은 select 하지만 응답에는 마스킹만 싣는다(아래 toMasked). */
const PROFILE_COLUMNS =
  'id, name, preset_id, provider, base_url, model, auth_token, max_input_tokens, max_output_tokens'

type ProfileRow = {
  id: number | string
  name: string
  preset_id: string
  provider: 'gemini' | 'openai'
  base_url: string | null
  model: string
  auth_token: string | null
  max_input_tokens: number | null
  max_output_tokens: number | null
}

/** accounts.ts 의 isAdmin 은 모듈 로컬(export 안 됨) — 같은 판정을 여기 복제한다. RLS 는 이중 방어. */
async function isAdmin(): Promise<boolean> {
  const m = await getMembership()
  return m?.role === 'pmo_admin'
}

function maskSync(token: string | null | undefined): string | null {
  if (!token) return null
  // 8자 이하는 앞4+뒤4가 원문 전체와 같아지므로(짧은 키·로컬 더미) 통째로 가린다.
  if (token.length <= 8) return '****'
  return `${token.slice(0, 4)}...${token.slice(-4)}`
}

/**
 * 토큰 마스킹(순수 함수). 'use server' 파일은 async 함수만 export 할 수 있어 async 래퍼로 노출한다
 * — 내부 호출은 동기 maskSync 를 쓰고, 이 export 는 단위 테스트가 규칙을 직접 검증하기 위한 것이다.
 */
export async function maskToken(token: string | null | undefined): Promise<string | null> {
  return maskSync(token)
}

function toMasked(row: ProfileRow): LlmProfileMasked {
  return {
    id: Number(row.id),
    name: row.name,
    preset_id: row.preset_id,
    provider: row.provider,
    base_url: row.base_url ?? null,
    model: row.model,
    max_input_tokens: row.max_input_tokens ?? null,
    max_output_tokens: row.max_output_tokens ?? null,
    has_token: !!row.auth_token,
    auth_token_masked: maskSync(row.auth_token),
  }
}

/**
 * 저장할 base_url — 앞뒤 공백과 **끝 슬래시**를 제거한다. 빈값은 null(= 기본 엔드포인트 사용).
 * 정규화를 저장 시점에 해 두면 DB 값이 하나로 모여 로더·연결 테스트가 갈릴 여지가 없다.
 */
function normalizeStored(baseUrl: string | undefined): string | null {
  return (baseUrl ?? '').trim().replace(/\/+$/, '') || null
}

/** 선택 입력 숫자 — 빈값/NaN 은 null(컬럼 비우기). */
function normNumber(v: number | undefined | null): number | null {
  if (v === undefined || v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** §7 검증표. 통과면 null, 실패면 사용자 문구. */
function validateProfile(input: LlmProfileInput): string | null {
  if (!input?.name?.trim()) return '프로필 이름을 입력하세요'
  if (!input?.model?.trim()) return '모델을 입력하세요'
  if (input.provider !== 'gemini' && input.provider !== 'openai') return '유효하지 않은 provider입니다'
  if (!input.preset_id?.trim()) return '프리셋을 선택하세요'
  return null
}

/** name unique 위반(23505)만 사용자 문구로 번역하고, 나머지는 원문을 그대로 드러낸다(조용한 실패 금지). */
function translateWriteError(err: { code?: string; message: string }): string {
  if (err.code === '23505') return '이미 같은 이름의 프로필이 있습니다'
  return err.message
}

export async function listLlmProfiles(): Promise<{ profiles: LlmProfileMasked[] } | { error: string }> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  const sb = await createServerClient()
  const { data, error } = await sb.from('llm_profiles').select(PROFILE_COLUMNS).order('name')
  // 조회 실패를 빈 목록으로 폴백하면 '프로필이 하나도 없음'과 구별되지 않고,
  // 관리자가 같은 이름으로 다시 만들다 23505 로 튕긴다 — 실패는 그대로 표시한다.
  if (error) return { error: '프로필 목록을 불러오지 못했습니다: ' + error.message }
  return { profiles: ((data ?? []) as unknown as ProfileRow[]).map(toMasked) }
}

export async function createLlmProfile(
  input: LlmProfileInput,
): Promise<{ profile: LlmProfileMasked } | { error: string }> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  const invalid = validateProfile(input)
  if (invalid) return { error: invalid }

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('llm_profiles')
    .insert({
      name: input.name.trim(),
      preset_id: input.preset_id.trim(),
      provider: input.provider,
      base_url: normalizeStored(input.base_url),
      model: input.model.trim(),
      // 생성 시 빈값은 '키 없음'이 맞다(Ollama/LM Studio 등 키 불필요 프리셋) — null 저장.
      auth_token: input.auth_token?.trim() || null,
      max_input_tokens: normNumber(input.max_input_tokens),
      max_output_tokens: normNumber(input.max_output_tokens),
    })
    .select(PROFILE_COLUMNS)
    .single()
  if (error) return { error: translateWriteError(error) }
  revalidatePath(CONFIG_PATH)
  return { profile: toMasked(data as unknown as ProfileRow) }
}

export async function updateLlmProfile(
  id: number,
  input: LlmProfileInput,
): Promise<{ profile: LlmProfileMasked } | { error: string }> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  const invalid = validateProfile(input)
  if (invalid) return { error: invalid }

  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    preset_id: input.preset_id.trim(),
    provider: input.provider,
    base_url: normalizeStored(input.base_url),
    model: input.model.trim(),
    max_input_tokens: normNumber(input.max_input_tokens),
    max_output_tokens: normNumber(input.max_output_tokens),
    updated_at: new Date().toISOString(), // updated_at 트리거 없음 — 앱이 직접 갱신(0038 주석)
  }
  // 키 유지 규칙: 빈 문자열/미전송이면 컬럼을 payload 에서 아예 뺀다.
  // (편집 폼은 기존 키를 되채우지 않으므로, 빈값을 그대로 저장하면 저장 버튼 한 번에 키가 지워진다)
  const token = input.auth_token?.trim()
  if (token) payload.auth_token = token

  const sb = await createServerClient()
  const { data, error } = await sb
    .from('llm_profiles')
    .update(payload)
    .eq('id', id)
    .select(PROFILE_COLUMNS)
    .single()
  if (error) return { error: translateWriteError(error) }
  revalidatePath(CONFIG_PATH)
  return { profile: toMasked(data as unknown as ProfileRow) }
}

export async function deleteLlmProfile(id: number): Promise<ActionOk | { error: string }> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  const sb = await createServerClient()
  const { error } = await sb.from('llm_profiles').delete().eq('id', id)
  if (error) return { error: error.message }
  // FK on delete set null 이 active_profile_id 를 풀어준다 — 캐시가 삭제된 프로필을
  // TTL(60초) 동안 계속 쓰지 않도록 즉시 재로딩한다.
  const applied = await refreshLlmOverride()
  revalidatePath(CONFIG_PATH)
  return applied ? { ok: true } : { ok: true, warning: REFRESH_WARNING }
}

export async function getLlmConfig(): Promise<
  { mode: LlmMode; active_profile_id: number | null; profiles: LlmProfileMasked[] } | { error: string }
> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  const sb = await createServerClient()
  const [cfgRes, listRes] = await Promise.all([
    sb.from('llm_config').select('mode, active_profile_id').eq('id', 1).maybeSingle(),
    sb.from('llm_profiles').select(PROFILE_COLUMNS).order('name'),
  ])
  // 설정 행을 못 읽었는데 'env'로 폴백하면 '선택 안함'으로 저장해 둔 서버가 화면상 env 로 보이고,
  // 그 상태로 저장 버튼을 누르면 의도치 않게 LLM 이 다시 열린다 — 실패는 화면에 드러낸다.
  if (cfgRes.error) return { error: 'LLM 설정을 불러오지 못했습니다: ' + cfgRes.error.message }
  if (listRes.error) return { error: '프로필 목록을 불러오지 못했습니다: ' + listRes.error.message }

  const row = cfgRes.data as { mode?: string; active_profile_id?: number | null } | null
  const profiles = ((listRes.data ?? []) as unknown as ProfileRow[]).map(toMasked)
  const rawMode = (row?.mode ?? 'env') as LlmMode
  const rawId = row?.active_profile_id
  const activeId = rawId === null || rawId === undefined ? null : Number(rawId)

  // dangling(활성 프로필이 삭제돼 FK 가 null 로 푼 상태) 해석을 런타임 로더(llm-override)와
  // 일치시킨다. 저장된 mode 를 그대로 돌려주면 화면은 '프로필 선택'인데 서버는 env 로 도는
  // 불일치가 생기고, 그 상태로 저장을 누르면 '유효하지 않은 프로필입니다'로 반려된다.
  const dangling = rawMode === 'profile' && (activeId === null || !profiles.some(p => p.id === activeId))
  return {
    mode: dangling ? 'env' : rawMode,
    active_profile_id: dangling ? null : activeId,
    profiles,
  }
}

export async function saveLlmConfig(input: {
  mode: LlmMode
  active_profile_id?: number | null
}): Promise<ActionOk | { error: string }> {
  if (!(await isAdmin())) return { error: NO_PERMISSION }
  if (input?.mode !== 'env' && input?.mode !== 'profile' && input?.mode !== 'none') {
    return { error: '유효하지 않은 설정입니다' }
  }

  const sb = await createServerClient()
  let activeProfileId: number | null = null
  if (input.mode === 'profile') {
    if (input.active_profile_id === null || input.active_profile_id === undefined) {
      return { error: '유효하지 않은 프로필입니다' }
    }
    const { data, error } = await sb
      .from('llm_profiles')
      .select('id')
      .eq('id', input.active_profile_id)
      .maybeSingle()
    // 쓰기 직전의 존재 확인 — 조회가 깨졌을 때 '없음'으로 취급하면 정상 프로필이 반려되고,
    // 통과시키면 dangling 참조가 저장된다. 둘 다 나쁘므로 원인을 밝혀 중단한다.
    if (error) return { error: '프로필을 확인할 수 없어 저장을 중단했습니다: ' + error.message }
    if (!data) return { error: '유효하지 않은 프로필입니다' }
    activeProfileId = Number(input.active_profile_id)
  }

  const user = await getSession()
  const { error } = await sb.from('llm_config').upsert(
    {
      id: 1, // 싱글톤
      mode: input.mode,
      // env/none 은 활성 프로필 개념이 없다 — 남겨두면 다음 'profile' 전환이 옛 값을 물고 온다.
      active_profile_id: activeProfileId,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) return { error: error.message }
  // 저장 즉시 반영(안 하면 이 인스턴스도 TTL 만료까지 옛 설정으로 LLM 을 호출한다).
  const applied = await refreshLlmOverride()
  revalidatePath(CONFIG_PATH)
  return applied ? { ok: true } : { ok: true, warning: REFRESH_WARNING }
}

/** 응답 본문/에러에 키가 에코될 수 있으므로 입력 토큰 문자열을 마스킹하고 길이도 제한한다. */
function redact(text: string, token: string | null): string {
  // 치환을 **먼저** 한다 — 자른 뒤에 치환하면 200자 경계에 걸친 토큰이 잘려 매칭에 실패하고
  // 앞부분이 그대로 화면·RSC 응답에 남는다.
  const masked = token ? text.split(token).join(maskSync(token) ?? '****') : text
  return masked.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * 저장 전에도 실행 가능한 연결 테스트. 실사용 경로(lib/ai/llm.ts)와 같은 URL·헤더 규칙으로
 * 1회만 호출한다 — util.ts 의 fetchWithRetry 는 429 백오프까지 붙어 있어 "빠른 실패 표시"라는
 * 이 버튼의 목적과 맞지 않으므로 쓰지 않는다.
 */
export async function testLlmConnection(
  input: TestLlmInput,
): Promise<{ success: boolean; error?: string }> {
  if (!(await isAdmin())) return { success: false, error: NO_PERMISSION }
  if (input?.provider !== 'gemini' && input?.provider !== 'openai') {
    return { success: false, error: '유효하지 않은 provider입니다' }
  }
  const model = input.model?.trim()
  if (!model) return { success: false, error: '모델을 입력하세요' }

  let token = input.auth_token?.trim() || null
  // 편집 중 키를 다시 입력하지 않아도 테스트되도록 저장된 키로 폴백(관리자 세션이라 RLS 로 읽힌다).
  if (!token && input.profile_id !== undefined && input.profile_id !== null) {
    const sb = await createServerClient()
    const { data, error } = await sb
      .from('llm_profiles')
      .select('auth_token')
      .eq('id', input.profile_id)
      .maybeSingle()
    if (error) return { success: false, error: '저장된 키를 확인할 수 없습니다: ' + error.message }
    token = ((data?.auth_token as string | null) ?? null) || null
  }

  // 런타임 로더(llm-override)와 **같은 헬퍼**를 쓴다 — 정규화가 갈리면 '테스트는 성공인데
  // 실사용만 404' 라는 재현 불가 버그가 된다.
  const baseUrl = normalizeBaseUrl(input.provider, input.base_url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res =
      input.provider === 'gemini'
        ? await fetch(`${baseUrl}/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': token ?? '' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 8 },
            }),
            signal: controller.signal,
          })
        : await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // 키 불필요 서버(Ollama/LM Studio)는 이 값을 무시한다 — 헤더를 빼는 것보다
              // 항상 보내는 편이 실사용 경로(llm.ts)의 placeholder 키 동작과 같아진다.
              Authorization: `Bearer ${token ?? 'local'}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 8,
            }),
            signal: controller.signal,
          })
    if (res.ok) return { success: true }
    const body = await res.text().catch(() => '')
    const label = input.provider === 'gemini' ? 'Gemini' : 'OpenAI'
    return { success: false, error: `${label} ${res.status}: ${redact(body, token)}` }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { success: false, error: '연결 시간이 초과되었습니다(10초)' }
    }
    return { success: false, error: redact(e instanceof Error ? e.message : String(e), token) }
  } finally {
    clearTimeout(timer)
  }
}
