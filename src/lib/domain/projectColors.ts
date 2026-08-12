/** 프로젝트 id → 결정적 색 클래스. 정렬된 프로젝트 id 목록 기준 인덱스 순환 —
 *  같은 데이터면 세션·리렌더와 무관하게 같은 색. */
export const PROJECT_DOT_CLASSES = [
  'bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
] as const

export function projectColorClass(projectIds: readonly string[], projectId: string): string {
  const sorted = [...projectIds].sort()
  const idx = sorted.indexOf(projectId)
  return PROJECT_DOT_CLASSES[(idx < 0 ? 0 : idx) % PROJECT_DOT_CLASSES.length]
}
