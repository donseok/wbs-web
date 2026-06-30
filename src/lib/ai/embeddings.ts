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
// 한 문서가 지나치게 길면 임베딩 API 가 400(토큰 초과)을 내 색인을 막을 수 있다. WBS 문서는
// 보통 짧지만, 안전망으로 항목별로 잘라 보낸다(초과분만 손실, 항목 단위 실패 격리와 병행).
const MAX_EMBED_CHARS = 8000

/**
 * 텍스트 1건씩을 임베딩으로 변환하되 항목 단위로 실패를 격리한다.
 * - 키가 없으면 호출 자체를 하지 않으므로 상위에서 cfg.apiKey 로 선판단한다.
 * - 개별 항목 실패(429 소진·400·차원 불일치·네트워크)는 해당 인덱스를 null 로 두고 계속 진행한다.
 * 반환 배열은 입력과 1:1 정렬된다(성공=number[], 실패=null).
 */
async function embedBatch(cfg: EmbedConfig, texts: string[], taskType: EmbedTaskType): Promise<(number[] | null)[]> {
  const capped = texts.map(t => (t.length > MAX_EMBED_CHARS ? t.slice(0, MAX_EMBED_CHARS) : t))
  return cfg.provider === 'openai' ? openaiEmbed(cfg, capped) : geminiEmbed(cfg, capped, taskType)
}

/** 차원 검증: 모델이 outputDimensionality/dimensions 를 무시하면 다른 길이를 돌려줄 수 있다.
 *  vector(768) 컬럼에 그대로 넣으면 insert 가 실패하므로 여기서 선제 차단한다(불일치 → null + 로그). */
function checkDim(cfg: EmbedConfig, v: number[] | undefined, idx: number): number[] | null {
  if (v && v.length === cfg.dim) return v
  console.error(
    `[dkbot] 임베딩 차원 불일치(항목 #${idx} 건너뜀): 모델 '${cfg.model}' 가 ${v?.length ?? 0}차원을 반환(기대 ${cfg.dim}). ` +
      `EMBED_DIM·임베딩 모델·마이그레이션 vector(...) 차원을 일치시키세요.`,
  )
  return null
}

/**
 * 쿼리 임베딩(strict). 단건 검색용 — 그 한 건이 실패하면 의미검색을 끄는 게 맞으므로 null 을 반환한다.
 * 빈 입력은 빈 배열, 키 없으면 null.
 */
export async function embedTexts(texts: string[], taskType: EmbedTaskType): Promise<number[][] | null> {
  if (texts.length === 0) return []
  const cfg = embedConfig()
  if (!cfg.apiKey) return null
  const vecs = await embedBatch(cfg, texts, taskType)
  if (vecs.some(v => v === null)) return null // 검색 쿼리는 전부 성공해야 의미가 있다
  return vecs as number[][]
}

/**
 * 문서 임베딩(lenient). 재색인용 — 일부 항목이 실패해도 성공분은 살린다.
 * 반환: 입력과 1:1 정렬된 (number[] | null)[]. 키가 없을 때만 전체 null.
 */
export async function embedDocuments(
  texts: string[],
  taskType: EmbedTaskType,
): Promise<(number[] | null)[] | null> {
  if (texts.length === 0) return []
  const cfg = embedConfig()
  if (!cfg.apiKey) return null
  return embedBatch(cfg, texts, taskType)
}

async function geminiEmbed(
  cfg: EmbedConfig,
  texts: string[],
  taskType: EmbedTaskType,
): Promise<(number[] | null)[]> {
  // gemini-embedding-001 은 동기 batchEmbedContents 를 지원하지 않으므로 embedContent(단건)을
  // 제한적 동시성으로 호출한다. outputDimensionality 로 vector(768) 차원에 맞춘다.
  // 항목별 try/catch 로 한 건의 실패가 전체 색인을 무너뜨리지 않게 한다.
  const out: (number[] | null)[] = new Array(texts.length)
  let next = 0
  async function worker() {
    while (next < texts.length) {
      const i = next++
      try {
        out[i] = checkDim(cfg, await geminiEmbedOne(cfg, texts[i], taskType), i)
      } catch (e) {
        console.error(`[dkbot] 임베딩 항목 실패(건너뜀) #${i}:`, e instanceof Error ? e.message : e)
        out[i] = null
      }
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

async function openaiEmbed(cfg: EmbedConfig, texts: string[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = []
  for (const batch of chunked(texts, 100)) {
    try {
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
      const data = json.data ?? []
      for (let i = 0; i < batch.length; i++) out.push(checkDim(cfg, data[i]?.embedding, out.length))
    } catch (e) {
      console.error('[dkbot] OpenAI 임베딩 배치 실패(건너뜀):', e instanceof Error ? e.message : e)
      for (let i = 0; i < batch.length; i++) out.push(null) // 배치 실패 → 해당 항목들만 건너뜀
    }
  }
  return out
}
