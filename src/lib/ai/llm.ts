import { llmConfig, type LlmConfig } from './provider'
import { fetchWithRetry } from './util'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface GeminiResp {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
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

async function geminiChat(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<string | null> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:generateContent`
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.3, topP: 0.9, maxOutputTokens: 1200 },
  }
  const res = await fetchWithRetry(signal =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as GeminiResp
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const text = parts.map(p => p.text ?? '').join('').trim()
  return text || null
}

async function openaiChat(cfg: LlmConfig, system: string, messages: ChatMessage[]): Promise<string | null> {
  const url = `${cfg.baseUrl}/chat/completions`
  const body = {
    model: cfg.model,
    temperature: 0.3,
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

async function* geminiStream(cfg: LlmConfig, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:streamGenerateContent?alt=sse`
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.3, topP: 0.9, maxOutputTokens: 1200 },
  }
  const res = await fetchWithRetry(signal =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
      body: JSON.stringify(body),
      signal,
    }),
  )
  if (!res.ok || !res.body) throw new Error(`Gemini stream ${res.status}`)
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
        const j = JSON.parse(p) as GeminiResp
        const t = (j.candidates?.[0]?.content?.parts ?? []).map(x => x.text ?? '').join('')
        if (t) yield t
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
