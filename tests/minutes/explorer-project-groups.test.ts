import { describe, expect, it } from 'vitest'
import { groupExplorerByProject } from '@/lib/domain/minutes'
import type { ExplorerLeaf, MinuteFolder } from '@/lib/domain/types'

const P1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const P2 = 'aaaaaaaa-0000-0000-0000-000000000002'
const folder = (id: string, projectId: string | null, parentId: string | null = null): MinuteFolder =>
  ({ id, name: id, parentId, sort: 100, createdBy: null, projectId })
const leaf = (id: string, projectId: string | null, folderId: string | null): ExplorerLeaf =>
  ({ id, minuteDate: '2026-08-12', teamCode: 'PMO', title: id, fileCount: 0, createdBy: null,
     createdByName: null, bodyPreview: '', meetingCategory: null, folderId, projectId })

describe('groupExplorerByProject', () => {
  it('projects 인자 순서대로 그룹을 만들고 미지정을 마지막에 둔다', () => {
    const groups = groupExplorerByProject(
      [folder('f1', P1), folder('f2', P2), folder('g1', null)],
      [leaf('m1', P1, 'f1'), leaf('m0', null, 'g1')],
      [{ id: P2, name: '둘' }, { id: P1, name: '하나' }],
    )
    expect(groups.map(g => g.projectId)).toEqual([P2, P1, null])
    expect(groups[2].leaves.map(l => l.id)).toEqual(['m0'])
  })

  it('폴더도 리프도 없는 프로젝트는 그룹을 만들지 않는다', () => {
    const groups = groupExplorerByProject([], [leaf('m1', P1, null)],
      [{ id: P1, name: '하나' }, { id: P2, name: '둘' }])
    expect(groups.map(g => g.projectId)).toEqual([P1])   // P2·미지정 없음
  })

  it('projects 목록에 없는 projectId 리프(숨김 아님·명단 밖)는 미지정이 아니라 자기 그룹으로 남긴다', () => {
    // listProjects 실패·부분 응답 시 남의 그룹에 섞이는 것 방지 — 이름 없이 id 그룹 유지
    const groups = groupExplorerByProject([], [leaf('m1', P1, null)], [])
    expect(groups[0].projectId).toBe(P1)
    expect(groups[0].projectName).toBeNull()
  })

  it('리프의 폴더가 다른 그룹 소속이면 그 그룹 folders 에 없다 — buildFolderTree 가 unfiled 로 수용', () => {
    const groups = groupExplorerByProject([folder('f1', P1)], [leaf('m1', P2, 'f1')],
      [{ id: P1, name: '하나' }, { id: P2, name: '둘' }])
    const g2 = groups.find(g => g.projectId === P2)!
    expect(g2.folders).toEqual([])
    expect(g2.leaves.map(l => l.id)).toEqual(['m1'])
  })
})
