import 'server-only'

// ============================================================================
// 서버 전역 LLM 설정(관리 화면 `/admin/llm-config`)의 런타임 캐시.
//
// provider.ts 의 llmConfig()/hasLLM() 은 동기 함수이고 lib/ai 전반에서 동기 호출된다.
// DB 조회를 위해 async 로 바꾸면 콜사이트 전체에 await 전파가 일어나므로,
// 설정을 인메모리 캐시에 담아 두고 동기 접근자를 제공한다.
//
// service_role(createAdminClient)로 읽는 이유: llm_profiles/llm_config 는 RLS 가
// pmo_admin 전용이라 일반 사용자 요청 중의 LLM 호출에서는 토큰을 읽을 수 없다.
// 토큰을 다루므로 `server-only` 로 클라이언트 번들 유입을 차단한다.
// ============================================================================

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeBaseUrl } from './endpoints'

export interface LlmOverride {
  mode: 'env' | 'profile' | 'none'
  /** baseUrl/apiKey 는 로드 시점에 해석이 끝난 값이다(undefined 금지 — URL 조합 안전). */
  profile: {
    provider: 'gemini' | 'openai'
    apiKey: string
    baseUrl: string
    model: string
    maxOutputTokens?: number
  } | null
}

const TTL_MS = 60_000
const LOAD_TIMEOUT_MS = 3_000
/** 로드 실패 후 재시도 간격 — 실패에 TTL 전체를 물리면 stale 구간이 불필요하게 길어진다. */
const RETRY_MS = 10_000

/**
 * **한 번도 성공한 적 없을 때만** 쓰는 기본값 = 이식 전과 동일한 env 동작.
 * 스펙 §5 가 승인한 fail-open 은 이 콜드스타트 한 건뿐이다(가용성 우선).
 */
const ENV_FALLBACK: LlmOverride = { mode: 'env', profile: null }

let cache: LlmOverride = ENV_FALLBACK
/** 한 번이라도 DB 로드에 성공했는가 — 실패 시 '직전 유효 설정 보존 vs env 기동'을 가르는 기준. */
let everLoaded = false
/** 다음 갱신을 시도해도 되는 시각(성공 → +TTL, 실패 → +RETRY). */
let nextRefreshAt = 0
/** 로드 직렬화 큐 — 동시 로드가 끝나는 순서에 따라 옛 스냅샷이 캐시를 덮는 것을 막는다. */
let queue: Promise<unknown> = Promise.resolve()
/** TTL 만료로 뜬 백그라운드 갱신 1건(요청 폭주 시 DB 스탬피드 방지용 코얼레싱). */
let background: Promise<unknown> | null = null

type Admin = ReturnType<typeof createAdminClient>

/** 캐시에 넣기 전에 값 정규화(해석)를 모두 끝낸다 — 소비측 분기를 없애기 위함. */
async function fetchOverride(admin: Admin): Promise<LlmOverride> {
  const { data: cfg, error } = await admin
    .from('llm_config')
    .select('mode, active_profile_id')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const mode = cfg?.mode === 'profile' || cfg?.mode === 'none' ? cfg.mode : 'env'
  if (mode !== 'profile') return { mode, profile: null }

  // 활성 프로필이 삭제되면 FK 가 active_profile_id 를 null 로 만든다 → env 로 안전 폴백.
  const activeId = cfg?.active_profile_id
  if (activeId === null || activeId === undefined) return ENV_FALLBACK

  const { data: row, error: profileError } = await admin
    .from('llm_profiles')
    .select('provider, base_url, model, auth_token, max_output_tokens')
    .eq('id', activeId)
    .maybeSingle()
  if (profileError) throw new Error(profileError.message)
  if (!row) return ENV_FALLBACK

  const provider: 'gemini' | 'openai' = row.provider === 'openai' ? 'openai' : 'gemini'
  // 빈 base_url 은 Gemini/OpenAI 프리셋의 정상 케이스 — 기본 엔드포인트로 채운다.
  // 끝 슬래시 제거까지 이 헬퍼가 담당한다(액션·연결 테스트와 동일 규칙).
  const baseUrl = normalizeBaseUrl(provider, row.base_url)
  const token = String(row.auth_token ?? '').trim()
  // 키 불필요 서버(Ollama/LM Studio)는 Authorization 값을 무시한다. 빈 문자열로 두면
  // llm.ts 의 `if (!cfg.apiKey) return null` 가드에 걸려 조용히 무동작이 되므로 placeholder 를 넣는다.
  // gemini 는 키가 필수라 폴백 없이 빈 문자열 유지 → hasLLM() 이 미구성으로 처리한다.
  const apiKey = token || (provider === 'openai' ? 'local' : '')

  const maxOutput = Number(row.max_output_tokens)
  return {
    mode: 'profile',
    profile: {
      provider,
      apiKey,
      baseUrl,
      model: String(row.model ?? ''),
      ...(Number.isFinite(maxOutput) && maxOutput > 0 ? { maxOutputTokens: maxOutput } : {}),
    },
  }
}

/** 남은 타이머는 반드시 해제한다 — 안 하면 Node 프로세스가 타임아웃까지 종료되지 않는다. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`LLM 설정 로드 ${ms}ms 초과`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** 성공하면 캐시 교체 후 true. 절대 throw 하지 않는다(큐가 실패로 고착되지 않도록). */
async function load(): Promise<boolean> {
  try {
    // createAdminClient() 는 env 미설정 시 동기 throw 한다. 타이머를 걸기 전에 먼저 호출해
    // 테스트·빌드 환경에서 3초를 기다리지 않고 즉시 폴백하도록 한다.
    const admin = createAdminClient()
    cache = await withTimeout(fetchOverride(admin), LOAD_TIMEOUT_MS)
    everLoaded = true
    nextRefreshAt = Date.now() + TTL_MS
    return true
  } catch (err) {
    // 토큰이 섞일 여지가 없도록 메시지만 남긴다(auth_token 절대 로그 금지).
    const message = err instanceof Error ? err.message : String(err)
    // **직전 유효 설정을 버리지 않는다.** 이미 mode='none'/'profile' 을 알고 있는 인스턴스가
    // DB 순단 한 번으로 env 로 되돌아가면, 관리자가 건 LLM 차단이 스스로 풀리고(env 키로 외부
    // 호출 재개) 화면·응답 어디에도 신호가 없다. 스펙 §5 가 승인한 env 폴백은 콜드스타트뿐이고,
    // 갱신 실패 시의 값은 "직전 유효 설정(stale)"로 규정돼 있다.
    if (!everLoaded) {
      cache = ENV_FALLBACK
      console.error('[llm-override] 최초 설정 로드 실패 — 환경변수 기본값으로 기동:', message)
    } else {
      console.error('[llm-override] 설정 갱신 실패 — 직전 설정을 유지합니다:', message)
    }
    // 실패해도 시각을 밀어 둔다 — DB 순단 시 매 요청이 재조회를 트리거하는 것을 막는다.
    nextRefreshAt = Date.now() + RETRY_MS
    return false
  }
}

/**
 * DB 즉시 재조회 + 캐시 교체. saveLlmConfig/deleteLlmProfile 에서 await 한다.
 * 반환값은 "최신 DB 상태가 이 인스턴스에 반영됐는가" — false 면 호출측이 관리자에게 알려야 한다.
 */
export async function refreshLlmOverride(): Promise<boolean> {
  // 진행 중인 로드에 편승하지 않는다: 그 로드는 이 호출을 유발한 쓰기보다 **먼저** DB 를 읽었을 수
  // 있어(TTL 갱신과 저장이 겹치는 경합), 편승하면 저장 직후 캐시가 옛 값으로 확정된 채 TTL 60초를
  // 간다 — '선택 안함' 저장이 조용히 무시되는 fail-open 이다. 대신 큐에 이어 붙여 항상 쓰기 이후
  // 스냅샷을 한 번 더 읽고, 직렬화로 완료 순서가 뒤집히는 것도 함께 막는다.
  const next = queue.then(load, load)
  // 큐 자체는 항상 성공 상태로 유지한다 — 한 번의 실패가 이후 모든 갱신을 막지 않도록.
  queue = next.then(() => {}, () => {})
  return next
}

/**
 * 동기 접근자. 항상 현재 캐시를 즉시 반환하고, TTL 만료 시 백그라운드 갱신만 트리거한다.
 * 서버리스에서 백그라운드 프라미스가 죽어도 다음 요청이 다시 트리거하므로 안전하다
 * (stale 값은 직전 유효 설정일 뿐 fail-open 이 아니다 — load() 의 실패 경로가 이를 보장한다).
 */
export function llmOverrideSync(): LlmOverride {
  if (!background && Date.now() >= nextRefreshAt) {
    // 한 번에 하나만 띄운다 — 만료 직후 몰리는 요청마다 로드를 걸면 DB 스탬피드가 된다.
    // fire-and-forget 이므로 unhandled rejection 방지를 위해 catch 를 반드시 붙인다.
    background = refreshLlmOverride()
      .catch(() => false)
      .finally(() => { background = null })
  }
  return cache
}

// 모듈 초기화에서 최초 1회를 await 한다. lazy 로드면 콜드스타트 인스턴스가
// '선택 안함(none)' 저장 상태를 모른 채 env 키로 LLM 을 호출하는 fail-open 이 생긴다.
await refreshLlmOverride()
