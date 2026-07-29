import { describe, it, expect } from 'vitest'
import {
  hasMyProjects, pickDefaultProjectId, sortMyProjectsFirst,
} from '@/lib/domain/projectPick'

const P = (id: string) => ({ id, name: id.toUpperCase() })
const dcube = P('p-dcube')
const alpha = P('p-alpha')
const beta = P('p-beta')

describe('pickDefaultProjectId', () => {
  it('내가 멤버인 프로젝트가 하나면 그것으로 정한다', () => {
    expect(pickDefaultProjectId([dcube, alpha], ['p-dcube'])).toBe('p-dcube')
  })

  it('내 프로젝트가 여럿이면 정하지 않는다 — 틀린 기본값이 미연결보다 나쁘다', () => {
    expect(pickDefaultProjectId([dcube, alpha, beta], ['p-dcube', 'p-alpha'])).toBeNull()
  })

  it('멤버가 아니어도 등록된 프로젝트가 하나뿐이면 그것 — 다른 답이 없다', () => {
    expect(pickDefaultProjectId([dcube], [])).toBe('p-dcube')
    expect(pickDefaultProjectId([dcube], ['p-other'])).toBe('p-dcube')
  })

  it('멤버가 아니고 프로젝트가 여럿이면 정하지 않는다', () => {
    expect(pickDefaultProjectId([dcube, alpha], [])).toBeNull()
  })

  it('소속 조회 실패(null)는 멤버 아님과 같은 폴백 — 근거가 없기는 마찬가지', () => {
    expect(pickDefaultProjectId([dcube], null)).toBe('p-dcube')
    expect(pickDefaultProjectId([dcube, alpha], null)).toBeNull()
  })

  it('프로젝트가 하나도 없으면 null', () => {
    expect(pickDefaultProjectId([], ['p-dcube'])).toBeNull()
  })

  it('내 소속 id 가 등록 목록에 없으면 무시한다 — 없는 프로젝트를 고를 수는 없다', () => {
    expect(pickDefaultProjectId([alpha, beta], ['p-dcube'])).toBeNull()
  })
})

describe('sortMyProjectsFirst', () => {
  it('내 프로젝트를 앞으로 보내되 그룹 안 순서는 지킨다', () => {
    expect(sortMyProjectsFirst([alpha, dcube, beta], ['p-dcube', 'p-beta']).map(p => p.id))
      .toEqual(['p-dcube', 'p-beta', 'p-alpha'])
  })

  it('소속이 없거나 조회 실패면 원래 순서 그대로', () => {
    expect(sortMyProjectsFirst([alpha, dcube], []).map(p => p.id)).toEqual(['p-alpha', 'p-dcube'])
    expect(sortMyProjectsFirst([alpha, dcube], null).map(p => p.id)).toEqual(['p-alpha', 'p-dcube'])
  })

  it('원본 배열을 바꾸지 않는다', () => {
    const src = [alpha, dcube]
    sortMyProjectsFirst(src, ['p-dcube'])
    expect(src.map(p => p.id)).toEqual(['p-alpha', 'p-dcube'])
  })
})

describe('hasMyProjects', () => {
  it('등록 목록과 교집합이 있을 때만 true', () => {
    expect(hasMyProjects([dcube, alpha], ['p-dcube'])).toBe(true)
    expect(hasMyProjects([dcube, alpha], ['p-other'])).toBe(false)
    expect(hasMyProjects([dcube], null)).toBe(false)
  })
})
