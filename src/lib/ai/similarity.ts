// ============================================================================
// 의미검색 유사도 컷오프 단일 출처.
// WBS 검색(retrieve.ts)과 회의록 보관함 검색(minutes-answer.ts)이 같은 임계값
// 해석 규칙을 각자 복제하고 있었다 — 한쪽만 튜닝되는 드리프트를 막기 위해 공용화.
// 임계값 미만이면 무관한 질문에도 가장 가까운 행들이 끌려와 근거를 흐리므로 컷한다.
// ============================================================================

// 0.35 기본값: gemini-embedding-001(코사인)로 짧은 한국어 질의는 관련 항목이라도
// 0.4~0.6 대에 분포해 0.55 는 과하게 걸러 '관련 작업 없음'이 잦았다.
export const DEFAULT_MIN_SIMILARITY = 0.35

/**
 * DKBOT_MIN_SIMILARITY 환경변수 해석 — 0~1 유한값만 인정, 그 외엔 기본값.
 * 순수 함수로 분리해 env 조작 없이 테스트한다.
 */
export function resolveMinSimilarity(raw: string | undefined): number {
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_MIN_SIMILARITY
}

// 코사인 유사도 하한. 이보다 낮은(=의미적으로 먼) 결과는 근거로 제시하지 않는다.
// 실데이터로 튜닝하려면 DKBOT_MIN_SIMILARITY(0~1) 로 덮어쓸 수 있다.
// 소비처들의 기존 관례와 동일하게 모듈 로드 시 1회 해석한다(런타임 env 변경 미반영).
export const MIN_SIMILARITY = resolveMinSimilarity(process.env.DKBOT_MIN_SIMILARITY)

/** 유사도가 컷오프를 통과하는가 — 검색 결과 filter 에 그대로 쓰는 술어. */
export function passesSimilarity(similarity: number): boolean {
  return similarity >= MIN_SIMILARITY
}
