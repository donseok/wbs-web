import { describe, it, expect } from 'vitest'
import { resolveFolderDrop, resolveLeafDrop } from '@/lib/domain/minutes-drop'
import type { MinuteFolder } from '@/lib/domain/types'

const f = (
  id: string, name: string, parentId: string | null = null, createdBy: string | null = 'u1',
  projectId: string | null = null,
): MinuteFolder => ({ id, name, parentId, sort: 100, createdBy, projectId })

const TEAMS = ['PMO', 'MES', 'ERP', 'APS'] as const

describe('resolveLeafDrop', () => {
  it('현재 폴더에 그대로 드롭하면 noop', () => {
    expect(resolveLeafDrop({ folderId: 'f1' }, 'f1')).toEqual({ kind: 'noop' })
  })
  it('미분류 리프를 미분류에 드롭해도 noop (null === null)', () => {
    expect(resolveLeafDrop({ folderId: null }, null)).toEqual({ kind: 'noop' })
  })
  it('다른 폴더로는 move', () => {
    expect(resolveLeafDrop({ folderId: 'f1' }, 'f2')).toEqual({ kind: 'move' })
  })
  it('폴더 소속 → 미분류도 move', () => {
    expect(resolveLeafDrop({ folderId: 'f1' }, null)).toEqual({ kind: 'move' })
  })
  it('미분류 → 폴더도 move', () => {
    expect(resolveLeafDrop({ folderId: null }, 'f1')).toEqual({ kind: 'move' })
  })
})

describe('resolveFolderDrop — noop', () => {
  const folders = [f('a', '가', null), f('b', '나', 'a')]
  it('자기 자신에게 드롭하면 noop', () => {
    expect(resolveFolderDrop(folders[1], 'b', folders, TEAMS)).toEqual({ kind: 'noop' })
  })
  it('현재 부모에게 드롭하면 noop', () => {
    expect(resolveFolderDrop(folders[1], 'a', folders, TEAMS)).toEqual({ kind: 'noop' })
  })
  it('루트 폴더를 루트 레벨에 드롭하면 noop (null === null)', () => {
    expect(resolveFolderDrop(folders[0], null, folders, TEAMS)).toEqual({ kind: 'noop' })
  })
  it('팀 시드 루트를 루트 레벨에 드롭해도 거부가 아니라 noop — 제자리는 사고가 아니다', () => {
    const seed = f('t', 'PMO', null, null)
    expect(resolveFolderDrop(seed, null, [seed], TEAMS)).toEqual({ kind: 'noop' })
  })
})

describe('resolveFolderDrop — 거부', () => {
  it('팀 시드 루트(루트 + createdBy null)는 어디로도 이동 금지', () => {
    const seed = f('t', 'PMO', null, null)
    const other = f('o', '내폴더', null)
    const folders = [seed, other]
    expect(resolveFolderDrop(seed, 'o', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'team-root' })
  })
  it('시드 하위 폴더는 이동 가능 — 앵커는 루트 시드뿐', () => {
    const seed = f('t', 'PMO', null, null)
    const child = f('c', '품질', 't', null)
    const other = f('o', '내폴더', null)
    expect(resolveFolderDrop(child, 'o', [seed, child, other], TEAMS)).toEqual({ kind: 'move' })
  })
  it('목록에 없는 대상은 not-found', () => {
    const folders = [f('a', '가', null)]
    expect(resolveFolderDrop(folders[0], 'ghost', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'not-found' })
  })
  it('직계 자식으로 드롭하면 cycle', () => {
    const folders = [f('a', '가', null), f('b', '나', 'a')]
    expect(resolveFolderDrop(folders[0], 'b', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'cycle' })
  })
  it('손자로 드롭해도 cycle', () => {
    const folders = [f('a', '가', null), f('b', '나', 'a'), f('c', '다', 'b')]
    expect(resolveFolderDrop(folders[0], 'c', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'cycle' })
  })
  it('이동 후 서브트리 최심 깊이가 5단을 넘으면 depth — 2단 서브트리를 4단 아래로', () => {
    // d1..d4 = 깊이 1~4 체인, s(자식 s2 보유) = 높이 2 서브트리 → 4+2 = 6 > 5
    const folders = [
      f('d1', '1', null), f('d2', '2', 'd1'), f('d3', '3', 'd2'), f('d4', '4', 'd3'),
      f('s', '이동', null), f('s2', '이동자식', 's'),
    ]
    expect(resolveFolderDrop(folders[4], 'd4', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'depth' })
  })
  it('같은 서브트리를 3단 아래로는 허용 — 3+2 = 5 는 상한과 같다(경계)', () => {
    const folders = [
      f('d1', '1', null), f('d2', '2', 'd1'), f('d3', '3', 'd2'),
      f('s', '이동', null), f('s2', '이동자식', 's'),
    ]
    expect(resolveFolderDrop(folders[3], 'd3', folders, TEAMS)).toEqual({ kind: 'move' })
  })
  it('단일 폴더는 4단 아래로 허용, 5단 아래는 depth 거부', () => {
    const chain = [
      f('d1', '1', null), f('d2', '2', 'd1'), f('d3', '3', 'd2'),
      f('d4', '4', 'd3'), f('d5', '5', 'd4'),
    ]
    const solo = f('s', '이동', null)
    const folders = [...chain, solo]
    expect(resolveFolderDrop(solo, 'd4', folders, TEAMS)).toEqual({ kind: 'move' })
    expect(resolveFolderDrop(solo, 'd5', folders, TEAMS))
      .toEqual({ kind: 'reject', reason: 'depth' })
  })
  it('루트로 이동 시 팀코드 동명은 anchor-squat', () => {
    const parent = f('p', '상위', null)
    const mine = f('m', 'MES', 'p')
    expect(resolveFolderDrop(mine, null, [parent, mine], TEAMS))
      .toEqual({ kind: 'reject', reason: 'anchor-squat' })
  })
  it('팀코드 동명이라도 하위 레벨로의 이동은 허용 — 루트만 예약', () => {
    const parent = f('p', '상위', null)
    const other = f('o', '다른상위', null)
    const mine = f('m', 'MES', 'p')
    expect(resolveFolderDrop(mine, 'o', [parent, other, mine], TEAMS)).toEqual({ kind: 'move' })
  })
  it('teamCodes 를 주지 않으면 앵커 사칭 검사를 건너뛴다(클라이언트 과소 거부 허용)', () => {
    const parent = f('p', '상위', null)
    const mine = f('m', 'MES', 'p')
    expect(resolveFolderDrop(mine, null, [parent, mine])).toEqual({ kind: 'move' })
  })
})

describe('resolveFolderDrop — 방어(순환·고아 입력)', () => {
  it('순환 부모 체인이 섞여도 무한 루프 없이 반환한다', () => {
    // x ↔ y 순환. buildFolderTree·folderDepthOf 가 견디는 입력이므로 여기서도 견뎌야 한다.
    const folders = [f('x', 'X', 'y'), f('y', 'Y', 'x'), f('s', '이동', null)]
    const r = resolveFolderDrop(folders[2], 'x', folders, TEAMS)
    expect(r.kind).toBe('reject')
    if (r.kind === 'reject') expect(r.reason).toBe('depth')   // folderDepthOf 가 상한 초과로 수렴
  })
  it('순환 자식 서브트리를 옮겨도 무한 루프 없이 반환한다', () => {
    const folders = [
      f('root', '루트', null),
      f('s', '이동', null), f('c1', 'C1', 's'), f('c2', 'C2', 'c1'), f('c3', 'C3', 'c2'),
    ]
    // c1 의 부모를 c3 로 돌려 자식 방향 순환을 만든다
    folders[2] = { ...folders[2], parentId: 'c3' }
    const r = resolveFolderDrop(folders[1], 'root', folders, TEAMS)
    expect(['move', 'reject']).toContain(r.kind)   // 값은 무관 — 반환한다는 것 자체가 계약
  })
  it('부모가 목록에 없는 고아를 옮겨도 정상 판정', () => {
    const orphan = f('o', '고아', 'gone')
    const target = f('t', '대상', null)
    expect(resolveFolderDrop(orphan, 't', [orphan, target], TEAMS)).toEqual({ kind: 'move' })
  })
})

describe('resolveFolderDrop — 교차 프로젝트', () => {
  it('교차 프로젝트 드롭은 cross-project 로 거부한다', () => {
    const target = f('f1', 'a', 'p1-root', 'u1', 'P1')
    const newParent = f('g-root', 'PMO', null, null, null)
    const verdict = resolveFolderDrop(target, 'g-root', [target, newParent], ['PMO'])
    expect(verdict).toEqual({ kind: 'reject', reason: 'cross-project' })
  })
  it('같은 프로젝트 하위로의 이동은 허용', () => {
    const root = f('p1-root', 'P1', null, 'u1', 'P1')
    const target = f('f1', 'a', 'p1-root', 'u1', 'P1')
    const dest = f('p1-b', 'B', 'p1-root', 'u1', 'P1')
    expect(resolveFolderDrop(target, 'p1-b', [root, target, dest], [])).toEqual({ kind: 'move' })
  })
  it('프로젝트 폴더를 루트로 옮기는 것은 cross-project 대상이 아니다(자기 스코프 루트 취급)', () => {
    const target = f('f1', 'a', 'p1-root', 'u1', 'P1')
    expect(resolveFolderDrop(target, null, [target], [])).toEqual({ kind: 'move' })
  })
})
