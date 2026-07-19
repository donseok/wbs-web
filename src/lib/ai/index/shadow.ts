export const SHADOW_TOP_K = 10

export interface ShadowSearchComparison {
  /** 상위 10개 기준 교집합 비율(0..1). 양쪽 모두 빈 결과면 1(완전 일치)로 본다. */
  overlap10: number
  legacyOnly: string[]
  nextOnly: string[]
}

function topKeys(results: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of results) {
    const key = raw.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= SHADOW_TOP_K) break
  }
  return out
}

/**
 * 레거시(wbs_embeddings 계열) vs 신규(ai_documents) 검색 결과의 순수 비교.
 * 키는 호출측이 정한 안정 식별자(예: entityType:entityId) 문자열이다.
 */
export function compareShadowSearch(input: {
  legacyResults: readonly string[]
  nextResults: readonly string[]
}): ShadowSearchComparison {
  const legacy = topKeys(input.legacyResults)
  const next = topKeys(input.nextResults)
  const legacySet = new Set(legacy)
  const nextSet = new Set(next)
  const intersection = legacy.filter(key => nextSet.has(key))
  const denominator = Math.max(legacy.length, next.length)
  return {
    overlap10: denominator === 0 ? 1 : intersection.length / denominator,
    legacyOnly: legacy.filter(key => !nextSet.has(key)),
    nextOnly: next.filter(key => !legacySet.has(key)),
  }
}

export interface ShadowSearchLog {
  label: string
  overlap10: number
  legacyCount: number
  nextCount: number
  latencyMs: number
}

/**
 * shadow 검색 실행 어댑터 — 두 검색을 나란히 돌려 로그만 남긴다.
 * 답변 경로에 영향 0: 어떤 실패도 삼키고 null을 반환하며 절대 throw하지 않는다.
 */
export async function runShadowSearch(input: {
  label: string
  runLegacy: () => Promise<readonly string[]>
  runNext: () => Promise<readonly string[]>
  log?: (entry: ShadowSearchLog) => void
  now?: () => number
}): Promise<ShadowSearchComparison | null> {
  const now = input.now ?? (() => Date.now())
  const startedAt = now()
  try {
    const [legacyResults, nextResults] = await Promise.all([input.runLegacy(), input.runNext()])
    const comparison = compareShadowSearch({ legacyResults, nextResults })
    const entry: ShadowSearchLog = {
      label: input.label,
      overlap10: comparison.overlap10,
      legacyCount: legacyResults.length,
      nextCount: nextResults.length,
      latencyMs: Math.max(0, now() - startedAt),
    }
    if (input.log) input.log(entry)
    else console.info(`[dkbot] shadow 검색 '${entry.label}': overlap@10=${entry.overlap10.toFixed(2)} legacy=${entry.legacyCount} next=${entry.nextCount} ${entry.latencyMs}ms`)
    return comparison
  } catch (e) {
    console.error('[dkbot] shadow 검색 비교 실패(답변 경로 영향 없음):', e instanceof Error ? e.message : e)
    return null
  }
}
