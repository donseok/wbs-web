import { llmConfig, type LlmConfig } from './provider'
import { fetchWithRetry } from './util'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface GeminiResp {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
}
interface OpenAIResp {
  choices?: { message?: { content?: string } }[]
}

/**
 * LLM 답변 생성. 제공자 비종속. 키가 없거나(=설정 안 됨) 오류/타임아웃이면 null 을
 * 반환하여 호출측이 결정형 답변으로 폴백하도록 한다. (UX 가 절대 끊기지 않음)
 */
export async function generateAnswer(system: string, messages: ChatMessage[]): Promise<string | null> {
  const cfg = llmConfig()
  if (!cfg.apiKey) return null
  try {
    return cfg.provider === 'openai'
      ? await openaiChat(cfg, system, messages)
      : await geminiChat(cfg, system, messages)
  } catch (e) {
    console.error('[dkbot] LLM 생성 실패 → 결정형 폴백:', e)
    return null
  }
}

/**
 * 429(무료 쿼터)·5xx 로 주 모델이 답을 못 줄 때 순서대로 시도할 폴백 모델.
 * 무료 티어 쿼터는 모델별로 별도 버킷이라, 주 모델(gemini-3.5-flash, RPM 20)이 분당 한도에
 * 걸려도 아래 모델들은 여유가 있다(2026-07-02 실 키로 두 모델 모두 200 확인).
 * - gemini-3.1-flash-lite: 3.x 세대(thinkingLevel 분기)
 * - gemini-3-flash-preview: 3.x 세대. preview 라 예고 없이 회수될 수 있으나 마지막 보루라 허용
 *   (2026-07-20 실 키로 thinkingLevel 포함 200 확인; 종전 gemini-2.5-flash-lite 는 2026-10-16 셧다운으로 교체)
 * GEMINI_FALLBACK_MODELS(콤마 구분)로 오버라이드, 빈 문자열이면 폴백 없음.
 */
const DEFAULT_GEMINI_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']

function geminiModelChain(primary: string): string[] {
  const raw = process.env.GEMINI_FALLBACK_MODELS
  const fallbacks =
    raw === undefined
      ? DEFAULT_GEMINI_FALLBACKS
      : raw.split(',').map(s => s.trim()).filter(Boolean)
  return [primary, ...fallbacks.filter(m => m !== primary)]
}

/**
 * 모델 세대별 generationConfig.
 * - Gemini 3.x(및 -latest 별칭): temperature/topP 를 보내지 않는다 — 공식 마이그레이션 가이드가
 *   제거를 명시(1.0 미만이면 루핑·품질 저하 경고). thinking 은 thinkingLevel 로만 제어
 *   (thinkingBudget 과 혼용 시 오류). RAG 근거 요약엔 심층 추론이 불필요해 low 로 고정.
 * - Gemini 2.x Flash 계열: thinkingLevel 미지원(400) → thinkingBudget:0 으로 thinking 차단.
 *   단 2.5 Pro 는 thinking 비활성화 자체가 불가(0 을 보내면 400) → thinkingConfig 미첨부.
 * - gemma 등 비-gemini 모델: thinkingConfig 미지원(400) → 미첨부.
 * - maxOutputTokens 는 thinking 토큰과의 '합산 상한'으로 동작한다. 1200 이던 시절 thinking 이
 *   예산을 소진해 답변이 MAX_TOKENS 로 잘리는 것을 실측 확인(2.5/3.5 공통) → 4096 으로 여유.
 */
function geminiGenerationConfig(model: string, maxOutputTokens = 4096): Record<string, unknown> {
  if (/^gemini-2\./.test(model)) {
    const cfg: Record<string, unknown> = { temperature: 0.3, topP: 0.9, maxOutputTokens }
    if (!model.includes('pro')) cfg.thinkingConfig = { thinkingBudget: 0 }
    return cfg
  }
  if (/^gemini-/.test(model)) {
    return { maxOutputTokens, thinkingConfig: { thinkingLevel: 'low' } }
  }
  return { temperature: 0.3, topP: 0.9, maxOutputTokens }
}

/** 주 모델 실패(429/5xx/빈 답변) 시 폴백 체인을 순서대로 시도. 전부 실패해야 상위 폴백으로. */
async function geminiChat(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<string | null> {
  let lastErr: unknown = null
  for (const model of geminiModelChain(cfg.model)) {
    try {
      const text = await geminiChatOne({ ...cfg, model }, system, messages)
      if (text) return text
      console.warn(`[dkbot] ${model} 이 빈 답변 반환 → 다음 모델 시도`)
    } catch (e) {
      lastErr = e
      console.warn(`[dkbot] ${model} 실패 → 다음 모델 시도:`, e instanceof Error ? e.message : e)
    }
  }
  if (lastErr) throw lastErr // 체인 전체 실패 — 상위 catch 가 로그 후 결정형 폴백
  return null
}

async function geminiChatOne(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<string | null> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent`
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: geminiGenerationConfig(cfg.model, cfg.maxOutputTokens),
  }
  // 비스트리밍은 전체 생성이 끝나야 응답이 오므로, maxOutputTokens 4096 완주를 감안해 타임아웃 상향.
  // (스트리밍 경로는 헤더 수신 시점에 타이머가 풀려 기본 25초로 충분)
  const res = await fetchWithRetry(
    signal =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
        body: JSON.stringify(body),
        signal,
      }),
    { timeoutMs: 50_000 },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as GeminiResp
  const cand = json.candidates?.[0]
  const parts = cand?.content?.parts ?? []
  const text = parts.map(p => p.text ?? '').join('').trim()
  // 답변 없이 MAX_TOKENS 면 thinking 이 출력 예산을 소진한 것 — 조용한 '항상 폴백' 회귀의 조기 신호.
  if (!text && cand?.finishReason === 'MAX_TOKENS')
    console.warn(`[dkbot] ${cfg.model} 답변이 MAX_TOKENS 로 비어 있음 — thinking 예산 잠식 의심`)
  return text || null
}

async function openaiChat(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<string | null> {
  const url = `${cfg.baseUrl}/chat/completions`
  const body = {
    model: cfg.model,
    temperature: 0.3,
    // 프로필에 '최대 출력 토큰'이 지정된 경우에만 보낸다 — 미지정 시 서버 기본값을 그대로 쓴다.
    ...(cfg.maxOutputTokens ? { max_tokens: cfg.maxOutputTokens } : {}),
    messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))],
  }
  const res = await fetchWithRetry(signal =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as OpenAIResp
  return (json.choices?.[0]?.message?.content ?? '').trim() || null
}

/**
 * 답변을 토큰 단위로 스트리밍. 키가 없으면 null(호출측이 결정형 단일 청크로 폴백).
 * 반환된 제너레이터는 lazy — 실제 fetch 는 첫 .next() 에서 실행되며, 오류는 순회 중 throw 된다.
 */
export async function generateAnswerStream(
  system: string,
  messages: ChatMessage[],
): Promise<AsyncGenerator<string> | null> {
  const cfg = llmConfig()
  if (!cfg.apiKey) return null
  return cfg.provider === 'openai' ? openaiStream(cfg, system, messages) : geminiStream(cfg, system, messages)
}

/** SSE 라인 버퍼에서 완성된 data: 페이로드들을 추출(부분 라인은 버퍼에 남김). */
export function drainSse(buffer: string): { payloads: string[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const payloads: string[] = []
  for (const line of lines) {
    const l = line.trim()
    if (l.startsWith('data:')) payloads.push(l.slice(5).trim())
  }
  return { payloads, rest }
}

/**
 * 스트리밍에도 동일한 모델 폴백 체인 적용. 단, 이미 토큰을 내보낸 뒤의 실패는 모델을
 * 갈아탈 수 없으므로(부분 답변 이어붙기 불가) 그대로 던져 상위의 중단 마커 처리에 맡긴다.
 * 첫 토큰 전 실패(429/5xx)·빈 스트림만 다음 모델로 넘어간다.
 */
async function* geminiStream(cfg: LlmConfig, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  let lastErr: unknown = null
  for (const model of geminiModelChain(cfg.model)) {
    let yielded = false
    try {
      for await (const chunk of geminiStreamOne({ ...cfg, model }, system, messages)) {
        yielded = true
        yield chunk
      }
      if (yielded) return
      console.warn(`[dkbot] ${model} 스트림이 빈 답변으로 종료 → 다음 모델 시도`)
    } catch (e) {
      if (yielded) throw e
      lastErr = e
      console.warn(`[dkbot] ${model} 스트림 실패 → 다음 모델 시도:`, e instanceof Error ? e.message : e)
    }
  }
  if (lastErr) throw lastErr // 전 모델 실패 — 상위(answer.ts)가 결정형 폴백
  // 전 모델이 빈 답변으로 종료: 토큰 0개로 정상 종료 → 상위가 결정형 폴백
}

async function* geminiStreamOne(cfg: LlmConfig, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:streamGenerateContent?alt=sse`
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: geminiGenerationConfig(cfg.model, cfg.maxOutputTokens),
  }
  const res = await fetchWithRetry(signal =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok || !res.body)
    throw new Error(`Gemini stream ${res.status}: ${res.ok ? '(no body)' : (await res.text()).slice(0, 300)}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let yielded = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { payloads, rest } = drainSse(buffer)
    buffer = rest
    for (const p of payloads) {
      if (!p || p === '[DONE]') continue
      try {
        const j = JSON.parse(p) as GeminiResp
        const t = (j.candidates?.[0]?.content?.parts ?? []).map(x => x.text ?? '').join('')
        if (t) {
          yielded = true
          yield t
        }
        // 텍스트를 한 글자도 못 내고 MAX_TOKENS 종료 = thinking 예산 잠식 신호(geminiChat 과 동일).
        if (!yielded && j.candidates?.[0]?.finishReason === 'MAX_TOKENS')
          console.warn(`[dkbot] ${cfg.model} 스트림이 MAX_TOKENS 로 빈 채 종료 — thinking 예산 잠식 의심`)
      } catch {
        /* 부분 JSON — 무시 */
      }
    }
  }
}

interface OpenAIDelta {
  choices?: { delta?: { content?: string } }[]
}

async function* openaiStream(cfg: LlmConfig, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const body = {
    model: cfg.model,
    temperature: 0.3,
    ...(cfg.maxOutputTokens ? { max_tokens: cfg.maxOutputTokens } : {}),
    stream: true,
    messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))],
  }
  const res = await fetchWithRetry(signal =>
    fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok || !res.body) throw new Error(`OpenAI stream ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const { payloads, rest } = drainSse(buffer)
    buffer = rest
    for (const p of payloads) {
      if (!p || p === '[DONE]') continue
      try {
        const j = JSON.parse(p) as OpenAIDelta
        const t = j.choices?.[0]?.delta?.content ?? ''
        if (t) yield t
      } catch {
        /* 부분 JSON — 무시 */
      }
    }
  }
}
