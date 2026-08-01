import { compareKoreanName, sortByKoreanName } from './nameSort'
import type { ProjectMember, TeamCode } from './types'

export type MemberPickerView = 'name' | 'category'

export type MemberPickerSection =
  | { kind: 'all'; members: ProjectMember[] }
  | { kind: 'category'; category: TeamCode | null; members: ProjectMember[] }

interface BuildMemberPickerSectionsOptions {
  query?: string
  view: MemberPickerView
  /** 프로젝트 팀 마스터의 표시 순서. 목록에만 남은 과거 팀은 그 뒤에 보존한다. */
  categoryOrder?: readonly TeamCode[]
}
function normalizedCategory(member: ProjectMember): TeamCode | null {
  const category = member.teamCode?.trim()
  return category || null
}

/**
 * 사람 선택기에 쓰는 표시 전용 모델.
 *
 * 서버의 전역 가나다순 계약은 건드리지 않고, 선택기 안에서만 이름순 또는 담당 카테고리별로
 * 재배치한다. 카테고리별 보기에서는 프로젝트 팀 마스터 순서 → 목록에만 존재하는 과거 팀 →
 * 담당 미지정 순이며, 각 그룹 안은 항상 가나다순이다.
 */
export function buildMemberPickerSections(
  members: readonly ProjectMember[],
  { query = '', view, categoryOrder = [] }: BuildMemberPickerSectionsOptions,
): MemberPickerSection[] {
  const keyword = query.trim().toLocaleLowerCase('ko-KR')
  const filtered = keyword
    ? members.filter(member => (
      member.name.toLocaleLowerCase('ko-KR').includes(keyword)
      || (normalizedCategory(member) ?? '').toLocaleLowerCase('ko-KR').includes(keyword)
    ))
    : [...members]
  const byName = sortByKoreanName(filtered, member => member.name)

  if (view === 'name') return [{ kind: 'all', members: byName }]

  const grouped = new Map<TeamCode | null, ProjectMember[]>()
  for (const member of byName) {
    const category = normalizedCategory(member)
    const group = grouped.get(category)
    if (group) group.push(member)
    else grouped.set(category, [member])
  }

  const order = new Map<string, number>()
  for (const category of categoryOrder) {
    const normalized = category.trim()
    if (normalized && !order.has(normalized)) order.set(normalized, order.size)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => {
      if (a === null) return b === null ? 0 : 1
      if (b === null) return -1
      const aOrder = order.get(a)
      const bOrder = order.get(b)
      if (aOrder !== undefined || bOrder !== undefined) {
        if (aOrder === undefined) return 1
        if (bOrder === undefined) return -1
        return aOrder - bOrder
      }
      return compareKoreanName(a, b)
    })
    .map(([category, categoryMembers]) => ({
      kind: 'category' as const,
      category,
      members: categoryMembers,
    }))
}
