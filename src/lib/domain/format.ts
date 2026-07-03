/**
 * 가중치 표시용 반올림(소수 4자리). 엑셀 수식에서 유래한 무한소수(0.045454…)가
 * 화면 셀·보고서를 넘쳐 이웃 컬럼(계획시작/종료)을 가리는 문제 방지.
 * 저장값과 임포트/내보내기 라운드트립은 원본 정밀도를 유지하고, 표시만 이 값을 쓴다.
 */
export function roundWeight(w: number): number {
  return Number(w.toFixed(4))
}
