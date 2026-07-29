/**
 * 회의록을 올리거나 고칠 때 **프로젝트를 사람이 고르지 않아도** 채우는 규칙 (순수).
 *
 * 근거: 프로젝트를 고르지 않고 올린 회의록은 위키·이슈·프로젝트 대시보드 어디에도 잡히지
 * 않는다(2026-07-29 실측 — 비보관 42건 중 27건이 그 상태였다). 사람은 자기가 속한 프로젝트의
 * 회의록을 올리므로, 그 소속을 근거로 기본값을 채우면 누락 자체가 생기지 않는다.
 *
 * 서버가 저장 시점에 몰래 채우지 않고 **UI 기본값**으로만 쓴다 — 화면에 보이는 값이라
 * 사용자가 즉시 확인하고 바꿀 수 있다. 보이지 않는 자동 귀속은 틀렸을 때 발견이 늦다.
 */

export type PickableProject = { id: string; name: string }

/**
 * 기본 선택할 프로젝트 id. null = 자동으로 정하지 않는다(사람이 고른다).
 *
 * - 내가 멤버인 프로젝트가 **정확히 하나** → 그것. 이 사람의 회의록은 거기 것이다.
 * - 내 프로젝트가 **여럿** → null. 틀린 프로젝트를 밀어 넣는 쪽이 미연결보다 나쁘다.
 *   (호출부는 sortMyProjectsFirst 로 고르기 쉽게 만든다.)
 * - 내 프로젝트가 **없음**(멤버 등록 안 됨·조회 실패) → 등록된 프로젝트가 하나뿐일 때만 그것.
 *   프로젝트가 하나면 다른 답이 존재하지 않는다.
 *
 * myProjectIds 가 null(조회 실패)이면 '멤버 아님'과 구분하지 않는다 — 어느 쪽이든
 * 근거가 없으므로 같은 폴백을 탄다. 실패 자체는 조회한 쪽에서 로깅한다.
 */
export function pickDefaultProjectId(
  projects: readonly PickableProject[],
  myProjectIds: readonly string[] | null,
): string | null {
  const ids = new Set(myProjectIds ?? [])
  const mine = projects.filter(p => ids.has(p.id))
  if (mine.length === 1) return mine[0].id
  if (mine.length === 0 && projects.length === 1) return projects[0].id
  return null
}

/**
 * 내가 속한 프로젝트를 앞으로 — 여럿일 때 고르는 비용을 줄인다.
 * 같은 그룹 안에서는 들어온 순서를 지킨다(호출부가 이미 정렬해 넘긴다).
 */
export function sortMyProjectsFirst<T extends PickableProject>(
  projects: readonly T[], myProjectIds: readonly string[] | null,
): T[] {
  const ids = new Set(myProjectIds ?? [])
  if (ids.size === 0) return [...projects]
  const mine: T[] = []
  const rest: T[] = []
  for (const p of projects) (ids.has(p.id) ? mine : rest).push(p)
  return [...mine, ...rest]
}

/** 내가 속한 프로젝트가 하나라도 있는지 — 셀렉트에 '내 프로젝트' 구분을 넣을지 판단용. */
export function hasMyProjects(
  projects: readonly PickableProject[], myProjectIds: readonly string[] | null,
): boolean {
  const ids = new Set(myProjectIds ?? [])
  return projects.some(p => ids.has(p.id))
}
