/** fetch 에 타임아웃을 거는 래퍼. 초과 시 AbortError 로 reject. */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms = 25_000,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** 배열을 size 단위로 분할. */
export function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

// 일시적 게이트웨이/과부하 상태.
const TRANSIENT_STATUS = new Set([500, 502, 503, 504])

// 429 재시도로 기다려 줄 최대 시간. 무료 티어 분당(RPM) 한도는 수 초 내에 풀리므로
// (실측: gemini-3.5-flash "retry in 0.3~3.8s") 이 이하면 기다렸다 재시도하는 편이
// 결정형 폴백보다 훨씬 낫다. 이보다 길면(일일 한도 소진 등) 곧장 폴백/모델 교체.
const MAX_429_WAIT_MS = 6_000

/** 429 응답에서 서버가 알려준 재시도 지연(ms)을 파싱. Retry-After 헤더 또는
 *  Google 오류 본문의 "retry in Xs"/"retryDelay":"Xs" 문구. 알 수 없으면 null. */
export async function parseRetryDelayMs(res: Response): Promise<number | null> {
  const rawHeader = res.headers.get('retry-after')
  if (rawHeader !== null) {
    const header = Number(rawHeader)
    if (Number.isFinite(header) && header >= 0) return header * 1000
  }
  try {
    const text = await res.clone().text()
    const m = text.match(/retry in ([\d.]+)s/i) ?? text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i)
    if (m) return Math.ceil(Number(m[1]) * 1000)
  } catch {
    /* 본문 없음/스트림 소비 불가 — 지연 정보 없음으로 처리 */
  }
  return null
}

/**
 * withTimeout(fetch) 에 짧은 재시도를 더한 래퍼. non-ok 응답을 throw 하지 않고
 * 그대로 반환한다(상태 해석은 호출측 책임).
 * - 500/502/503/504: 지수 백오프로 retries 회 재시도.
 * - 429: 서버가 알려준 지연이 MAX_429_WAIT_MS 이하일 때만 그만큼 기다렸다 1회 재시도
 *   (분당 한도는 수 초면 풀림). 지연 정보가 없거나 길면 재시도 없이 반환 → 호출측이
 *   모델 폴백 체인/결정형 답변으로 이어간다.
 */
export async function fetchWithRetry(
  make: (signal: AbortSignal) => Promise<Response>,
  { retries = 1, baseMs = 700, timeoutMs }: { retries?: number; baseMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  let retried429 = false
  for (let attempt = 0; ; attempt++) {
    const res = await withTimeout(make, timeoutMs)
    if (res.ok) return res
    if (res.status === 429 && !retried429) {
      const delay = await parseRetryDelayMs(res)
      if (delay !== null && delay <= MAX_429_WAIT_MS) {
        retried429 = true
        attempt-- // 429 재시도는 별도 예산(retried429) — 5xx 백오프 횟수를 소모하지 않는다
        await sleep(delay + 250) // 서버 창이 확실히 열리도록 여유를 더한다
        continue
      }
      return res
    }
    if (!TRANSIENT_STATUS.has(res.status) || attempt >= retries) return res
    await sleep(baseMs * 2 ** attempt)
  }
}
