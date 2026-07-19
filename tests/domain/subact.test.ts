import { describe, it, expect } from 'vitest'
import {
  SUB_ACT_TEAMS, subActName, subActTeamsInUse, availableSubActTeams, willDiscardActual,
} from '@/lib/domain/subact'
import type { TeamCode } from '@/lib/domain/types'

const sub = (team: TeamCode) => ({ owners: [{ team }] })

describe('subActName — 저장 이름 규칙', () => {
  it('주관/지원을 "{ACT명} ({팀} 주관|지원)" 로 만든다 (임포트 분리와 동일)', () => {
    expect(subActName('데이터 플랫폼 요건 정의', '가공', 'primary')).toBe('데이터 플랫폼 요건 정의 (가공 주관)')
    expect(subActName('데이터 플랫폼 요건 정의', 'MES', 'support')).toBe('데이터 플랫폼 요건 정의 (MES 지원)')
  })
})

describe('subActTeamsInUse / availableSubActTeams', () => {
  it('이미 SUB-ACT 로 쓰인 팀을 제외하고 표준 순서(PMO→ERP→MES→가공→MDM)로 남긴다', () => {
    const children = [sub('가공'), sub('ERP')]
    expect([...subActTeamsInUse(children)].sort()).toEqual(['ERP', '가공'].sort())
    expect(availableSubActTeams(children)).toEqual(['PMO', 'MES', 'MDM'])
  })

  it('자식이 없으면 5개 팀 모두 배정 가능', () => {
    expect(availableSubActTeams([])).toEqual([...SUB_ACT_TEAMS])
  })

  it('모든 팀이 점유되면 빈 배열', () => {
    const children = SUB_ACT_TEAMS.map(t => sub(t))
    expect(availableSubActTeams(children)).toEqual([])
  })
})

describe('willDiscardActual — 리프 ACT 전환 경고', () => {
  it('자식 없는 ACT 에 직접 입력된 실적%가 있으면 true(첫 SUB-ACT 로 롤업 전환 시 버려짐)', () => {
    expect(willDiscardActual(0, 50)).toBe(true)
  })
  it('실적이 0 또는 null 이면 버릴 게 없어 false', () => {
    expect(willDiscardActual(0, 0)).toBe(false)
    expect(willDiscardActual(0, null)).toBe(false)
  })
  it('이미 자식(SUB-ACT)이 있으면 이미 롤업 부모라 경고 불필요 false', () => {
    expect(willDiscardActual(2, 40)).toBe(false)
  })
})
