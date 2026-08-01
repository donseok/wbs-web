import { describe, expect, it } from 'vitest'
import { buildMemberPickerSections } from '@/lib/domain/memberPicker'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'

function member(id: string, name: string, teamCode: TeamCode | null): ProjectMember {
  return {
    id,
    projectId: 'p1',
    name,
    email: null,
    teamCode,
    role: 'contributor',
    title: null,
    hasAccount: true,
    createdAt: '2026-08-02T00:00:00.000Z',
  }
}

function categories(sections: ReturnType<typeof buildMemberPickerSections>) {
  return sections.map(section => section.kind === 'category' ? section.category : 'all')
}

describe('buildMemberPickerSections', () => {
  it('이름 보기에서는 가나다순으로 정렬하고 입력 배열은 변경하지 않는다', () => {
    const members = [
      member('3', '홍길동', 'MES'),
      member('1', '김가영', 'ERP'),
      member('2', '박도연', null),
    ]
    const originalIds = members.map(item => item.id)

    const sections = buildMemberPickerSections(members, { view: 'name' })

    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ kind: 'all' })
    expect(sections[0].members.map(item => item.name))
      .toEqual(['김가영', '박도연', '홍길동'])
    expect(sections[0].members).not.toBe(members)
    expect(members.map(item => item.id)).toEqual(originalIds)
  })

  it('호출할 때 전달한 categoryOrder를 동적으로 반영한다', () => {
    const members = [
      member('1', '김메스', 'MES'),
      member('2', '박이알피', 'ERP'),
      member('3', '이피엠오', 'PMO'),
    ]

    expect(categories(buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['PMO', 'MES', 'ERP'],
    }))).toEqual(['PMO', 'MES', 'ERP'])

    expect(categories(buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['ERP', 'PMO', 'MES'],
    }))).toEqual(['ERP', 'PMO', 'MES'])
  })

  it('팀 마스터에 없는 과거 팀도 현재 팀 뒤에 보존한다', () => {
    const members = [
      member('1', '김현재', 'MES'),
      member('2', '박과거비', 'OLD-B'),
      member('3', '이과거에이', 'OLD-A'),
    ]

    const sections = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['MES', 'ERP'],
    })

    expect(categories(sections)).toEqual(['MES', 'OLD-A', 'OLD-B'])
    expect(sections.flatMap(section => section.members.map(item => item.id)))
      .toEqual(['1', '3', '2'])
  })

  it('카테고리 안의 구성원은 항상 가나다순으로 정렬한다', () => {
    const members = [
      member('3', '최지훈', 'ERP'),
      member('1', '강정한', 'ERP'),
      member('2', '김기림', 'ERP'),
    ]

    const [erp] = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['ERP'],
    })

    expect(erp).toMatchObject({ kind: 'category', category: 'ERP' })
    expect(erp.members.map(item => item.name)).toEqual(['강정한', '김기림', '최지훈'])
  })

  it('담당 미지정과 공백 카테고리를 하나로 묶어 항상 마지막에 둔다', () => {
    const members = [
      member('1', '김미지정', null),
      member('2', '박현재', 'MES'),
      member('3', '이미지정', '   '),
      member('4', '최과거', 'OLD'),
    ]

    const sections = buildMemberPickerSections(members, {
      view: 'category',
      categoryOrder: ['MES'],
    })

    expect(categories(sections)).toEqual(['MES', 'OLD', null])
    expect(sections.at(-1)).toMatchObject({ kind: 'category', category: null })
    expect(sections.at(-1)?.members.map(item => item.name)).toEqual(['김미지정', '이미지정'])
  })

  it('이름과 팀을 검색하며 영문 대소문자와 검색어 앞뒤 공백을 무시한다', () => {
    const members = [
      member('1', 'Alice Kim', 'MES'),
      member('2', 'Bob Lee', 'ERP'),
      member('3', '강정한', 'PMO'),
    ]

    const byName = buildMemberPickerSections(members, {
      view: 'name',
      query: '  ALICE  ',
    })
    expect(byName[0].members.map(item => item.id)).toEqual(['1'])

    const byTeam = buildMemberPickerSections(members, {
      view: 'category',
      query: ' eRp ',
      categoryOrder: ['MES', 'ERP', 'PMO'],
    })
    expect(categories(byTeam)).toEqual(['ERP'])
    expect(byTeam[0].members.map(item => item.id)).toEqual(['2'])
  })
})
