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
