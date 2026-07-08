/**
 * 가중치 단일 진실원본.
 *
 * 스케일: 0~100 (프로젝트 전체 leaf 합 = 100). 형제 그룹의 합은 1도 100도 아닌
 * "부모의 가중치"와 같다 — 가중치는 전역 절대 지분(global share)이기 때문이다.
 * 예) 부모 4.55 를 자식 6개가 나눠 가지면 각 0.7576, 합은 4.55.
 *
 * 롤업 계산(rollup.ts / weekly.ts / dashboard.ts)은 모두 형제 합으로 나눠
 * 정규화하므로 스케일 자체에는 불변이다. 단 아래 effectiveWeights 의 null 처리만은
 * 스케일에 민감하므로 여기 한 곳에서만 정의한다.
 */
export const WEIGHT_TOTAL = 100

/** 가중치를 가진 무엇이든 (ComputedItem / WbsRow / 테스트 픽스처) */
interface HasWeight {
  weight: number | null
}

/**
 * 형제 그룹의 유효 가중치. null 은 "지정 안 함"을 뜻한다.
 *
 * - 전부 null  → 전부 1 (형제 균등, 1/n)
 * - 전부 명시  → 그대로
 * - 섞임       → null 은 명시된 형제들의 평균을 받는다
 *
 * 섞임 처리가 중요한 이유: 예전에는 null 을 상수 1 로 치환했는데, 이는 스케일에
 * 민감하다. 0~1 스케일에서 [0.5, 0.5, null] 이면 null 이 1 을 받아 그룹을 지배하고,
 * 0~100 스케일에서 [50, 50, null] 이면 null 이 1 로 무시된다 — 같은 데이터인데
 * 롤업 결과가 달라진다. 평균을 쓰면 비율이 스케일에 불변이고, "지정 안 한 항목은
 * 평범한 형제만큼 친다"는 직관과도 맞는다.
 */
export function effectiveWeights(children: readonly HasWeight[]): number[] {
  const explicit = children.filter(c => c.weight != null).map(c => c.weight as number)
  if (explicit.length === 0) return children.map(() => 1)
  const avg = explicit.reduce((a, b) => a + b, 0) / explicit.length
  return children.map(c => c.weight ?? avg)
}

/** 유효한 가중치 입력인가. null(형제 균등)은 유효. */
export function isValidWeight(w: number | null): boolean {
  if (w == null) return true
  return Number.isFinite(w) && w >= 0 && w <= WEIGHT_TOTAL
}

/** 명시된 가중치의 단순 합 (null 제외). 전역 합 검증용. */
export function totalWeight(items: readonly HasWeight[]): number {
  return items.reduce((s, it) => s + (it.weight ?? 0), 0)
}
