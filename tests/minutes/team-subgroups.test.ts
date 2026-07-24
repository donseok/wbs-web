import { describe, it, expect } from 'vitest'
import type { MinuteFolder } from '@/lib/domain/types'
import {
  TEAM_SUBGROUPS, isTeamSeedFolder, normalizeTeamSub, subgroupFolderId, teamSubOfFolder,
} from '@/lib/domain/minutes'

const F = (
  id: string, name: string, parentId: string | null = null,
  createdBy: string | null = null, sort = 0,
): MinuteFolder => ({ id, name, parentId, sort, createdBy })

// 0043 시드 트리 + 사용자 폴더 몇 개
const tree: MinuteFolder[] = [
  F('r-pmo', 'PMO'),
  F('r-erp', 'ERP'), F('c-sales', '영업', 'r-erp'), F('c-buy', '구매', 'r-erp'), F('c-acc', '관리회계', 'r-erp'),
  F('r-mes', 'MES'), F('c-q', '품질', 'r-mes'), F('c-plan', '생산계획', 'r-mes'),
  F('c-ops', '조업및표준화', 'r-mes'), F('c-log', '물류', 'r-mes'), F('c-fac', '설비및L2', 'r-mes'),
  F('r-gk', '가공'), F('r-mdm', 'MDM'),
  F('u-aps', 'APS 회의', 'c-plan', 'u1'),   // 사용자 폴더(생산계획 하위)
]

describe('TEAM_SUBGROUPS — 시드 트리(0043)와 동일', () => {
  it('ERP/MES 는 세부, 단독 팀은 자기 자신', () => {
    expect(TEAM_SUBGROUPS.ERP).toEqual(['영업', '구매', '관리회계'])
    expect(TEAM_SUBGROUPS.MES).toEqual(['품질', '생산계획', '조업및표준화', '물류', '설비및L2'])
    expect(TEAM_SUBGROUPS.PMO).toEqual(['PMO'])
    expect(TEAM_SUBGROUPS['가공']).toEqual(['가공'])
    expect(TEAM_SUBGROUPS.MDM).toEqual(['MDM'])
  })
})

describe('normalizeTeamSub', () => {
  it('APS 는 MES 흡수 예정 — 생산계획으로 정규화(사용자 결정 2026-07-24)', () => {
    expect(normalizeTeamSub('MES', 'APS')).toBe('생산계획')
  })
  it('목록에 없는 값은 첫 항목(대표)으로 수렴', () => {
    expect(normalizeTeamSub('MES', '없는구분')).toBe('품질')
    expect(normalizeTeamSub('PMO', '아무거나')).toBe('PMO')
  })
})

describe('subgroupFolderId', () => {
  it('세부 하위는 시드 자식, 자기 자신 하위는 팀 루트', () => {
    expect(subgroupFolderId(tree, 'ERP', '구매')).toBe('c-buy')
    expect(subgroupFolderId(tree, 'MES', '설비및L2')).toBe('c-fac')
    expect(subgroupFolderId(tree, 'PMO', 'PMO')).toBe('r-pmo')
    expect(subgroupFolderId(tree, 'MDM', 'MDM')).toBe('r-mdm')
  })
  it('APS 별칭은 생산계획 폴더로', () => {
    expect(subgroupFolderId(tree, 'MES', 'APS')).toBe('c-plan')
  })
  it('시드 자식 미존재(비정상)는 팀 루트로 강등, 루트 부재는 null', () => {
    expect(subgroupFolderId(tree.filter(f => f.id !== 'c-q'), 'MES', '품질')).toBe('r-mes')
    expect(subgroupFolderId([], 'ERP', '영업')).toBeNull()
  })
  it('동명 사용자 루트(스쿼팅)는 배제 — 시드 없으면 null', () => {
    expect(subgroupFolderId([F('u-erp', 'ERP', null, 'u1')], 'ERP', '영업')).toBeNull()
  })
})

describe('teamSubOfFolder — 업로드 초기값 역해석', () => {
  it('시드 자식 → (팀, 하위), 시드 루트 → (팀, 대표)', () => {
    expect(teamSubOfFolder(tree, 'c-q')).toEqual({ team: 'MES', sub: '품질' })
    expect(teamSubOfFolder(tree, 'r-erp')).toEqual({ team: 'ERP', sub: '영업' })
    expect(teamSubOfFolder(tree, 'r-pmo')).toEqual({ team: 'PMO', sub: 'PMO' })
  })
  it('사용자 폴더는 시드 조상 체인으로 판정', () => {
    expect(teamSubOfFolder(tree, 'u-aps')).toEqual({ team: 'MES', sub: '생산계획' })
  })
  it('null·미존재·시드 체인 밖·순환은 null', () => {
    expect(teamSubOfFolder(tree, null)).toBeNull()
    expect(teamSubOfFolder(tree, 'ghost')).toBeNull()
    expect(teamSubOfFolder([F('u-solo', '내폴더', null, 'u1')], 'u-solo')).toBeNull()
    const cyc = [F('x', 'A', 'y', 'u1'), F('y', 'B', 'x', 'u1')]
    expect(teamSubOfFolder(cyc, 'x')).toBeNull()
  })
  it('개명 드리프트(시드 자식이 목록 밖 이름)는 추측 없이 null — 형제 오편철 방지(리뷰 반영)', () => {
    const drifted = [...tree.filter(f => f.id !== 'c-buy'), F('c-buy', '구매관리', 'r-erp')]
    expect(teamSubOfFolder(drifted, 'c-buy')).toBeNull()
  })
})

describe('isTeamSeedFolder — 개명·삭제 금지 대상', () => {
  it('팀 루트와 그 시드 하위 구분은 보호, 사용자 폴더·팀 외 시드 루트는 비보호', () => {
    expect(isTeamSeedFolder(tree, tree.find(f => f.id === 'r-mes')!)).toBe(true)
    expect(isTeamSeedFolder(tree, tree.find(f => f.id === 'c-q')!)).toBe(true)
    expect(isTeamSeedFolder(tree, tree.find(f => f.id === 'u-aps')!)).toBe(false)
    const preHierarchy = F('r-old', '생산계획')   // 0043 이전 형태의 독립 시드 루트
    expect(isTeamSeedFolder([preHierarchy], preHierarchy)).toBe(false)
  })
})
