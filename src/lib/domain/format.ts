/**
 * 가중치 표시 변환 — 저장은 1기준(엑셀 원본 분수, 0.045454…)을 유지하고
 * 화면·보고서 표시만 100% 기준으로 환산한다(엑셀의 % 셀 서식과 같은 원리).
 * 롤업 계산은 비율 기반이라 스케일 무관. 임포트/내보내기 라운드트립도 원본 정밀도 유지.
 * 소수 2자리 반올림은 무한소수(4.545454…%)가 셀·보고서를 넘치는 문제 방지.
 */
export function weightToPct(w: number): number {
  return Number((w * 100).toFixed(2))
}

export function formatWeightPct(w: number): string {
  return `${weightToPct(w)}%`
}

/**
 * 공정율 정밀도의 단일 기준 — 소수 1자리 반올림.
 * 롤업·계획율이 정수로 뭉개지면 대시보드가 0.1%p 단위 변화를 표현할 수 없어
 * 도메인 값은 1자리를 유지하고, 정수 표기가 필요한 화면(WBS 표·보고서 등)은
 * 표시 시점에 Math.round 한다.
 */
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** % 값 표시 문자열 — 소수 1자리 고정("66.7"). 단위(%)는 호출부가 붙인다. */
export function formatPct1(n: number): string {
  return round1(n).toFixed(1)
}

/** 편차(%p) 표시 문자열 — 부호 포함 소수 1자리("+1.5"). +0 더해 -0.0 방지. */
export function formatPp1(n: number): string {
  const v = round1(n) + 0
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}
