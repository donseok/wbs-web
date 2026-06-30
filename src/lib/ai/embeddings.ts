import { embedConfig, type EmbedConfig } from './provider'
import { chunked, sleep, withTimeout } from './util'

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

interface GeminiEmbedResp {
  embedding?: { values?: number[] }
}
interface OpenAIEmbedResp {
  data?: { embedding?: number[] }[]
}

const GEMINI_EMBED_CONCURRENCY = 5

/**
 * 텍스트들을 임베딩 벡터로 변환. 키가 없거나 오류면 null(=의미검색 비활성, 구조화 질의만 사용).
 * 빈 배열 입력은 빈 배열을 반환한다.
 */
export async function embedTexts(texts: string[], taskType: EmbedTaskType): Promise<number[][] | null> {
  if (texts.length === 0) return []
  const cfg = embedConfig()
  if (!cfg.apiKey) return null
  try {
    const vecs =
      cfg.provider === 'openai' ? await openaiEmbed(cfg, texts) : await geminiEmbed(cfg, texts, taskType)
    // 차원 검증: 모델이 outputDimensionality/dimensions 를 무시·미지원하면 빈 배열이나 다른 길이를
    // 돌려줄 수 있다. vector(768) 컬럼에 그대로 넣으면 insert 시점에 배치 전체가 실패하므로,
    // 여기서 명확한 메시지로 선제 차단한다(catch → null → 색인 skip / 의미검색 비활성).
    for (const v of vecs) {
      if (v.length !== cfg.dim) {
        throw new Error(
          `임베딩 차원 불일치: 모델 '${cfg.model}' 가 ${v.length}차원을 반환(기대 ${cfg.dim}). ` +
            `EMBED_DIM·임베딩 모델·마이그레이션 vector(...) 차원을 일치시키세요.`,
        )
      }
    }
    return vecs
  } catch (e) {
    console.error('[dkbot] 임베딩 실패:', e)
    return null
  }
}

async function geminiEmbed(cfg: EmbedConfig, texts: string[], taskType: EmbedTaskType): Promise<number[][]> {
  // gemini-embedding-001 은 동기 batchEmbedContents 를 지원하지 않으므로 embedContent(단건)을
  // 제한적 동시성으로 호출한다. outputDimensionality 로 vector(768) 차원에 맞춘다.
  const out: number[][] = new Array(texts.length)
  let next = 0
  async function worker() {
    while (next < texts.length) {
      const i = next++
      out[i] = await geminiEmbedOne(cfg, texts[i], taskType)
    }
  }
  const workers = Math.min(GEMINI_EMBED_CONCURRENCY, texts.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return out
}

async function geminiEmbedOne(cfg: EmbedConfig, text: string, taskType: EmbedTaskType): Promise<number[]> {
  const url = `${cfg.baseUrl}/models/${cfg.model}:embedContent`
  const body = {
    model: `models/${cfg.model}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: cfg.dim,
  }
  // 일시적 레이트리밋(429)·과부하(503)는 지수 백오프로 재시도 → 색인이 한 번에 중단되지 않도록.
  for (let attempt = 0; ; attempt++) {
    const res = await withTimeout(signal =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
        body: JSON.stringify(body),
        signal,
      }),
    )
    if (res.ok) {
      const json = (await res.json()) as GeminiEmbedResp
      return json.embedding?.values ?? []
    }
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await sleep(800 * 2 ** attempt) // 0.8s → 1.6s → 3.2s
      continue
    }
    throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
}

async function openaiEmbed(cfg: EmbedConfig, texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (const batch of chunked(texts, 100)) {
    const res = await withTimeout(signal =>
      fetch(`${cfg.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        // dimensions: vector(768) 컬럼과 차원을 맞춘다(text-embedding-3-* 지원). 미지원 모델이면 무시됨.
        body: JSON.stringify({ model: cfg.model, input: batch, dimensions: cfg.dim }),
        signal,
      }),
    )
    if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const json = (await res.json()) as OpenAIEmbedResp
    for (const d of json.data ?? []) out.push(d.embedding ?? [])
  }
  return out
}
