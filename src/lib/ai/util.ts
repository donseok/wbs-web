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

// 일시적 게이트웨이/과부하 상태. 429(쿼터 소진)는 제외 — 무료 티어에선 보통 영구적이라
// 재시도가 결정형 폴백만 지연시키므로 곧장 폴백한다.
const TRANSIENT_STATUS = new Set([502, 503, 504])

/**
 * withTimeout(fetch) 에 일시적(502/503/504) 상태에 한해 짧은 지수 백오프 재시도를 더한 래퍼.
 * non-ok 응답을 throw 하지 않고 그대로 반환한다(상태 해석은 호출측 책임).
 */
export async function fetchWithRetry(
  make: (signal: AbortSignal) => Promise<Response>,
  { retries = 1, baseMs = 700, timeoutMs }: { retries?: number; baseMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await withTimeout(make, timeoutMs)
    if (res.ok || !TRANSIENT_STATUS.has(res.status) || attempt >= retries) return res
    await sleep(baseMs * 2 ** attempt)
  }
}
