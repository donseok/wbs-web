/** WBS 행 상세 패널의 구조 편집 어포던스(§4.4) — 순수 판정. CHILD_LEVEL/isAct(level 문자열 비교)를 대체한다. */

/** 자식 추가 가능 여부 — maxDepth 무제한(null)이면 항상 가능, 그 외엔 자식 depth(=depth+1)가 maxDepth 미만이어야 한다.
 *  D-CUBE(maxDepth=3): depth 0(자식 1<3 ✓)·1(자식 2<3 ✓)·2(자식 3<3 ✗, 현행 activity 하위 금지와 동치). */
export function canAddChild(depth: number, maxDepth: number | null): boolean {
  return maxDepth == null || depth + 1 < maxDepth
}

/** SUB-ACT(담당자별 분리) 추가 가능 여부 — 대상이 리프(자식 없음)이고 스스로가 이미 SUB-ACT 가 아니어야 한다.
 *  Plan A 의 addSubAct 서버 가드(리프 한정 + SUB-ACT 형제 제한)와 동치인 클라이언트 표시 판정. */
export function canSplit(isOwnerSplit: boolean, hasChildren: boolean): boolean {
  return !isOwnerSplit && !hasChildren
}
