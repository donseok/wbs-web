import { describe, it, expect } from 'vitest'
import {
  buildFolderTree, folderDepthOf, validateFolderName,
  MINUTE_FOLDER_DEPTH_MAX, MINUTE_FOLDER_NAME_MAX,
} from '@/lib/domain/minutes'
import type { ExplorerLeaf, MinuteFolder, TeamCode } from '@/lib/domain/types'

const folder = (id: string, name: string, parentId: string | null = null, sort = 100): MinuteFolder =>
  ({ id, name, parentId, sort, createdBy: null })

const leaf = (id: string, date: string, folderId: string | null): ExplorerLeaf => ({
  id, minuteDate: date, teamCode: 'MES' as TeamCode, title: `제목${id}`,
  fileCount: 0, createdBy: null, createdByName: null,
  bodyPreview: '', meetingCategory: null, folderId,
})

describe('validateFolderName', () => {
  it('정상 이름은 null', () => expect(validateFolderName('생산계획')).toBeNull())
  it('공백만이면 에러', () => expect(validateFolderName('   ')).toBeTruthy())
  it(`${MINUTE_FOLDER_NAME_MAX}자 초과면 에러`, () =>
    expect(validateFolderName('가'.repeat(MINUTE_FOLDER_NAME_MAX + 1))).toBeTruthy())
  it('trim 후 상한 이내면 null', () =>
    expect(validateFolderName(`  ${'가'.repeat(MINUTE_FOLDER_NAME_MAX)}  `)).toBeNull())
})

describe('folderDepthOf', () => {
  const fs = [folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b')]
  it('null(루트에 생성)은 0', () => expect(folderDepthOf(fs, null)).toBe(0))
  it('루트 폴더는 1, 체인은 조상 수+1', () => {
    expect(folderDepthOf(fs, 'a')).toBe(1)
    expect(folderDepthOf(fs, 'c')).toBe(3)
  })
  it('순환 참조는 상한 초과 취급(무한 루프 없이 DEPTH_MAX+1 이상 반환)', () => {
    const cyc = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    expect(folderDepthOf(cyc, 'x')).toBeGreaterThan(MINUTE_FOLDER_DEPTH_MAX)
  })
})

describe('buildFolderTree', () => {
  it('루트는 sort asc·name asc, 하위 동일 규칙, directLeaves 는 입력 순서 유지', () => {
    const fs = [
      folder('u1', '나사용자'), folder('u2', '가사용자'),        // sort 100 동률 → 이름순
      folder('s1', 'PMO', null, 0), folder('s2', '영업', null, 1), // 시드가 먼저
      folder('c1', '하위B', 's1', 100), folder('c2', '하위A', 's1', 100),
    ]
    const { roots } = buildFolderTree(fs, [leaf('m1', '2026-07-20', 's1'), leaf('m2', '2026-07-19', 's1')])
    expect(roots.map(r => r.folder.name)).toEqual(['PMO', '영업', '가사용자', '나사용자'])
    expect(roots[0].children.map(c => c.folder.name)).toEqual(['하위A', '하위B'])
    expect(roots[0].directLeaves.map(l => l.id)).toEqual(['m1', 'm2'])
  })

  it('totalCount 는 하위 포함 재귀 합계, directLeaves 는 직계만', () => {
    const fs = [folder('p', '부모', null, 0), folder('c', '자식', 'p')]
    const { roots } = buildFolderTree(fs, [
      leaf('m1', '2026-07-20', 'p'), leaf('m2', '2026-07-19', 'c'), leaf('m3', '2026-07-18', 'c'),
    ])
    expect(roots[0].totalCount).toBe(3)
    expect(roots[0].directLeaves.map(l => l.id)).toEqual(['m1'])
    expect(roots[0].children[0].totalCount).toBe(2)
  })

  it('unfiled = folder_id null + 존재하지 않는 폴더를 가리키는 리프(dangling)', () => {
    const { unfiled } = buildFolderTree([folder('a', 'A')], [
      leaf('m1', '2026-07-20', null), leaf('m2', '2026-07-19', 'ghost'), leaf('m3', '2026-07-18', 'a'),
    ])
    expect(unfiled.map(l => l.id)).toEqual(['m1', 'm2'])
  })

  it('고아 폴더(부모 미존재)는 루트로 승격, 순환은 절단해 루트로 — 조용히 버리지 않는다', () => {
    const fs = [
      folder('o', '고아', 'ghost'),
      folder('x', '순환X', 'y'), folder('y', '순환Y', 'x'),
    ]
    const { roots } = buildFolderTree(fs, [])
    expect(roots.map(r => r.folder.name).sort()).toEqual(['고아', '순환X', '순환Y'].sort())
  })
})
