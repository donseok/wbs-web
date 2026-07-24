import { describe, it, expect } from 'vitest'
import type { MinuteFolder } from '@/lib/domain/types'
import {
  isTeamRootFolder, resolveTeamSub, subgroupFolderId, subgroupsOf,
  teamRootFolderIdOf, teamSubOfFolder,
} from '@/lib/domain/minutes'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 100,
): MinuteFolder => ({ id, name, parentId, sort, createdBy })

// 0043 시드 트리(sort 는 프로덕션 시드값) + 사용자 폴더 — 하위 구분은 이 실폴더에서 동적 유도된다
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO', null, null, 0),
  F('r-erp', 'ERP', null, null, 1),
  F('c-sales', '영업', 'r-erp', null, 0), F('c-buy', '구매', 'r-erp', null, 1), F('c-acc', '관리회계', 'r-erp', null, 2),
  F('r-mes', 'MES', null, null, 2),
  F('c-q', '품질', 'r-mes', null, 0), F('c-plan', '생산계획', 'r-mes', null, 1),
  F('c-ops', '조업및표준화', 'r-mes', null, 2), F('c-log', '물류', 'r-mes', null, 3), F('c-fac', '설비및L2', 'r-mes', null, 4),
  F('r-gk', '가공', null, null, 3), F('r-mdm', 'MDM', null, null, 4),
  F('u-aps', 'APS 회의', 'c-plan', 'u1'),   // 사용자 폴더(생산계획 하위) — 하위 구분 아님(2단)
]

describe('subgroupsOf — 팀 루트의 실제 하위 폴더에서 동적 유도', () => {
  it('시드 트리 그대로면 기존 하위 구분과 동일(패리티)', () => {
    expect(subgroupsOf(tree, 'ERP')).toEqual(['영업', '구매', '관리회계'])
    expect(subgroupsOf(tree, 'MES')).toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2'])
  })
  it('하위 폴더가 없는 팀은 자기 자신 1개(상위=하위)', () => {
    expect(subgroupsOf(tree, 'PMO')).toEqual(['PMO'])
    expect(subgroupsOf(tree, '가공')).toEqual(['가공'])
    expect(subgroupsOf(tree, 'MDM')).toEqual(['MDM'])
  })
  it('폴더 생성이 즉시 반영 — 사용자 폴더도 하위 구분(시드 뒤, sort→이름순)', () => {
    const withUser = [...tree, F('u-new', '신규구분', 'r-mes', 'u1', 100)]
    expect(subgroupsOf(withUser, 'MES'))
      .toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2', '신규구분'])
  })
  it('폴더 개명·삭제가 즉시 반영', () => {
    const renamed = tree.map(f => (f.id === 'c-buy' ? { ...f, name: '구매관리' } : f))
    expect(subgroupsOf(renamed, 'ERP')).toEqual(['영업', '구매관리', '관리회계'])
    const removed = tree.filter(f => f.id !== 'c-buy')
    expect(subgroupsOf(removed, 'ERP')).toEqual(['영업', '관리회계'])
  })
  it('하위 폴더를 전부 삭제하면 자기 자신으로 수렴, 팀 루트 부재(신규 팀)도 자기 자신', () => {
    const noKids = tree.filter(f => f.parentId !== 'r-erp')
    expect(subgroupsOf(noKids, 'ERP')).toEqual(['ERP'])
    expect(subgroupsOf(tree, '신팀')).toEqual(['신팀'])
    expect(subgroupsOf([], 'MES')).toEqual(['MES'])
  })
})

describe('resolveTeamSub', () => {
  it('APS 는 MES 흡수 예정 — 생산계획으로 정규화(사용자 결정 2026-07-24)', () => {
    expect(resolveTeamSub(tree, 'MES', 'APS')).toBe('생산계획')
  })
  it('실폴더명이 별칭보다 우선 — APS 폴더가 실제로 있으면 APS 그대로', () => {
    const withAps = [...tree, F('c-aps', 'APS', 'r-mes', 'u1')]
    expect(resolveTeamSub(withAps, 'MES', 'APS')).toBe('APS')
  })
  it('목록에 없는 값은 null(추측 금지) — 대표 수렴 없음', () => {
    expect(resolveTeamSub(tree, 'MES', '없는구분')).toBeNull()
    expect(resolveTeamSub(tree, 'PMO', 'PMO')).toBe('PMO')
  })
})

describe('subgroupFolderId', () => {
  it('세부 하위는 그 폴더, 자기 자신 하위는 팀 루트', () => {
    expect(subgroupFolderId(tree, 'ERP', '구매')).toBe('c-buy')
    expect(subgroupFolderId(tree, 'MES', '설비및L2')).toBe('c-fac')
    expect(subgroupFolderId(tree, 'PMO', 'PMO')).toBe('r-pmo')
    expect(subgroupFolderId(tree, 'MDM', 'MDM')).toBe('r-mdm')
  })
  it('사용자가 만든 하위 폴더도 편철 대상', () => {
    const withUser = [...tree, F('u-new', '신규구분', 'r-mes', 'u1')]
    expect(subgroupFolderId(withUser, 'MES', '신규구분')).toBe('u-new')
  })
  it('APS 별칭은 생산계획 폴더로 — 단 실제 APS 폴더가 있으면 그 폴더로', () => {
    expect(subgroupFolderId(tree, 'MES', 'APS')).toBe('c-plan')
    const withAps = [...tree, F('c-aps', 'APS', 'r-mes', 'u1')]
    expect(subgroupFolderId(withAps, 'MES', 'APS')).toBe('c-aps')
  })
  it('하위 소실(경합 삭제)·목록 밖 값은 팀 루트로 강등(형제 오편철 금지), 루트 부재는 null', () => {
    expect(subgroupFolderId(tree.filter(f => f.id !== 'c-q'), 'MES', '품질')).toBe('r-mes')
    expect(subgroupFolderId(tree, 'MES', '없는구분')).toBe('r-mes')
    expect(subgroupFolderId([], 'ERP', '영업')).toBeNull()
  })
  it('동명 사용자 루트(스쿼팅)는 배제 — 시드 없으면 null', () => {
    expect(subgroupFolderId([F('u-erp', 'ERP', null, 'u1')], 'ERP', '영업')).toBeNull()
  })
})

describe('teamSubOfFolder — 모달 초기값 역해석', () => {
  it('루트 직계 하위 → (팀, 하위), 단독 팀 루트 → 자기 자신, 하위 있는 팀 루트 → 미지정(null)', () => {
    expect(teamSubOfFolder(tree, 'c-q')).toEqual({ team: 'MES', sub: '품질' })
    expect(teamSubOfFolder(tree, 'r-erp')).toEqual({ team: 'ERP', sub: null })   // 루트 편철=미지정(허위 선택 방지)
    expect(teamSubOfFolder(tree, 'r-pmo')).toEqual({ team: 'PMO', sub: 'PMO' })
  })
  it('개명된 하위 폴더는 새 이름이 곧 하위 구분(동적 유도 — 드리프트 개념 소멸)', () => {
    const renamed = tree.map(f => (f.id === 'c-buy' ? { ...f, name: '구매관리' } : f))
    expect(teamSubOfFolder(renamed, 'c-buy')).toEqual({ team: 'ERP', sub: '구매관리' })
    expect(subgroupsOf(renamed, 'ERP')).toContain('구매관리')                     // 모달 탭과 정합
  })
  it('더 깊은 사용자 폴더는 루트 직계 하위로 걸어 올라가 판정', () => {
    expect(teamSubOfFolder(tree, 'u-aps')).toEqual({ team: 'MES', sub: '생산계획' })
  })
  it('null·미존재·시드 체인 밖·순환은 null', () => {
    expect(teamSubOfFolder(tree, null)).toBeNull()
    expect(teamSubOfFolder(tree, 'ghost')).toBeNull()
    expect(teamSubOfFolder([F('u-solo', '내폴더', null, 'u1')], 'u-solo')).toBeNull()
    const cyc = [F('x', 'A', 'y', 'u1'), F('y', 'B', 'x', 'u1')]
    expect(teamSubOfFolder(cyc, 'x')).toBeNull()
  })
})

describe('teamRootFolderIdOf', () => {
  it('시드 루트만 매칭 — 동명 사용자 루트 배제', () => {
    expect(teamRootFolderIdOf(tree, 'MES')).toBe('r-mes')
    expect(teamRootFolderIdOf([F('u-erp', 'ERP', null, 'u1')], 'ERP')).toBeNull()
  })
})

describe('isTeamRootFolder — 개명·삭제 금지 대상(루트 앵커만)', () => {
  it('팀 루트만 보호 — 하위 구분 폴더·사용자 폴더는 비보호(CRUD 가 옵션에 반영)', () => {
    expect(isTeamRootFolder(tree.find(f => f.id === 'r-mes')!)).toBe(true)
    expect(isTeamRootFolder(tree.find(f => f.id === 'c-q')!)).toBe(false)   // 시드 하위도 개명·삭제 허용
    expect(isTeamRootFolder(tree.find(f => f.id === 'u-aps')!)).toBe(false)
  })
  it('루트 시드는 이름과 무관하게 보호 — 팀 마스터 신규 팀 시드 자동 보호(2026-07-24 계약 변경)', () => {
    // 0043 이후 루트의 created_by null 은 팀 시드뿐이다(신규 팀 추가 액션 포함).
    expect(isTeamRootFolder(F('r-new', '신팀', null, null))).toBe(true)
  })
})
