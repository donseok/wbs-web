import { describe, expect, it } from 'vitest'
import { resolveTeamsForProject, type Team } from '@/lib/domain/teams'

const team = (code: string, projectId: string | null, active = true): Team =>
  ({ id: `id-${code}-${projectId ?? 'g'}`, code, sortOrder: 0, active, progressVisible: true, projectId })

describe('resolveTeamsForProject — 프로젝트 행 있으면 그것만, 없으면 전역 폴백', () => {
  const globals = [team('PMO', null), team('ERP', null)]
  it('프로젝트 팀이 없으면 전역 팀을 반환한다(D-CUBE 현행 유지)', () => {
    expect(resolveTeamsForProject(globals, 'p1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('프로젝트 팀이 있으면 그것만 반환한다(전역 혼입 없음)', () => {
    const all = [...globals, team('개발', 'p1'), team('QA', 'p1')]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['개발', 'QA'])
  })
  it('다른 프로젝트의 팀은 보이지 않는다', () => {
    const all = [...globals, team('개발', 'p2')]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['PMO', 'ERP'])
  })
  it('비활성 프로젝트 팀만 있어도 전역으로 복귀하지 않는다(폴백 판정은 비활성 포함)', () => {
    const all = [...globals, team('개발', 'p1', false)]
    expect(resolveTeamsForProject(all, 'p1').map(t => t.code)).toEqual(['개발'])
  })
  it('전역과 동명인 프로젝트 팀이 공존할 수 있다', () => {
    const all = [...globals, team('PMO', 'p1')]
    const r = resolveTeamsForProject(all, 'p1')
    expect(r).toHaveLength(1)
    expect(r[0].projectId).toBe('p1')
  })
})
