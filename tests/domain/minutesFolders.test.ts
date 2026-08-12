import { describe, it, expect } from 'vitest'
import {
  buildFolderTree, folderDepthOf, folderSubtreeIds, isDescendantFolder, subtreeHeightOf,
  teamChildFoldersOf, validateFolderName,
  MINUTE_FOLDER_DEPTH_MAX, MINUTE_FOLDER_NAME_MAX,
} from '@/lib/domain/minutes'
import type { ExplorerLeaf, MinuteFolder, TeamCode } from '@/lib/domain/types'

const folder = (id: string, name: string, parentId: string | null = null, sort = 100): MinuteFolder =>
  ({ id, name, parentId, sort, createdBy: null, projectId: null })

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

  // 계약 §4.9 — "60자 검증도 NFC 이후 길이 기준". 저장은 normalizeFolderName(NFC)인데
  // 검증만 원문 길이를 재면 경계가 어긋난다: macOS 에서 만든 한글 이름은 NFD 라 자모가
  // 분해돼 길이가 2~3배로 잡히고, 20자 폴더명이 UI 에서 "60자 초과"로 거절되는데
  // 같은 이름을 외부 API 로 보내면(그쪽은 NFC 후 검증) 통과한다.
  it('NFD 로 들어온 한글도 NFC 길이 기준으로 판정한다 — UI 와 외부 API 경계 일치', () => {
    const nfc = '가'.repeat(MINUTE_FOLDER_NAME_MAX)
    const nfd = nfc.normalize('NFD')
    expect(nfd.length).toBeGreaterThan(MINUTE_FOLDER_NAME_MAX)   // 전제: 실제로 길어진다
    expect(validateFolderName(nfd)).toBeNull()                    // NFC 로 재면 정확히 상한
  })

  it('NFD 로 들어와도 NFC 기준 초과면 거절한다', () =>
    expect(validateFolderName('가'.repeat(MINUTE_FOLDER_NAME_MAX + 1).normalize('NFD'))).toBeTruthy())
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

/* ── 폴더 이동 가드용 순수 함수 (W21 · §6.5 M3·M4) ────────────────────────── */

describe('subtreeHeightOf', () => {
  //  a ─ b ─ c
  //    └ d
  const tree = [
    folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b'), folder('d', 'D', 'a'),
  ]

  it('잎은 1', () => {
    expect(subtreeHeightOf(tree, 'c')).toBe(1)
    expect(subtreeHeightOf(tree, 'd')).toBe(1)
  })

  it('자손이 있으면 가장 깊은 갈래를 센다', () => {
    expect(subtreeHeightOf(tree, 'b')).toBe(2)
    expect(subtreeHeightOf(tree, 'a')).toBe(3)      // a→b→c 가 a→d 보다 깊다
  })

  it('목록에 없는 id 는 1(잎 취급)', () => {
    expect(subtreeHeightOf(tree, 'ghost')).toBe(1)
  })

  it('순환에서도 유한하게 끝난다(무한 루프 없음) — seen 가드가 각 노드를 한 번만 센다', () => {
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    expect(subtreeHeightOf(cyclic, 'x')).toBeLessThanOrEqual(MINUTE_FOLDER_DEPTH_MAX + 1)
  })

  it('순환 폴더는 M4 짝(folderDepthOf)이 막는다 — 높이만으로 판단하지 않는 이유', () => {
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    // folderDepthOf 가 상한 초과로 수렴하므로 합산 판정이 반드시 거부된다
    expect(folderDepthOf(cyclic, 'x')).toBeGreaterThan(MINUTE_FOLDER_DEPTH_MAX)
    expect(folderDepthOf(cyclic, 'x') + subtreeHeightOf(cyclic, 'y'))
      .toBeGreaterThan(MINUTE_FOLDER_DEPTH_MAX)
  })

  it('M4 판정 — folderDepthOf 만으로는 부족하다는 것을 보인다', () => {
    // 3단 자리(depth 3)에 높이 3짜리 서브트리를 넣으면 6단이 된다
    expect(folderDepthOf(tree, 'c')).toBe(3)
    expect(folderDepthOf(tree, 'c') + subtreeHeightOf(tree, 'a')).toBeGreaterThan(MINUTE_FOLDER_DEPTH_MAX)
    // 잎 하나만 옮기는 것은 통과
    expect(folderDepthOf(tree, 'c') + subtreeHeightOf(tree, 'd')).toBeLessThanOrEqual(MINUTE_FOLDER_DEPTH_MAX)
  })
})

describe('isDescendantFolder', () => {
  const tree = [
    folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b'), folder('z', 'Z'),
  ]

  it('직계·간접 자손을 모두 잡는다', () => {
    expect(isDescendantFolder(tree, 'a', 'b')).toBe(true)
    expect(isDescendantFolder(tree, 'a', 'c')).toBe(true)
  })

  it('자기 자신은 자손이 아니다(호출부가 따로 막는다)', () => {
    expect(isDescendantFolder(tree, 'a', 'a')).toBe(false)
  })

  it('조상 방향·무관 폴더는 false', () => {
    expect(isDescendantFolder(tree, 'c', 'a')).toBe(false)
    expect(isDescendantFolder(tree, 'a', 'z')).toBe(false)
  })

  it('순환 체인에서도 끝난다', () => {
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    expect(isDescendantFolder(cyclic, 'ghost', 'x')).toBe(false)
  })
})

describe('folderSubtreeIds', () => {
  // A ─ B ─ C, A ─ D, 별개 루트 Z
  const tree = [
    folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b'),
    folder('d', 'D', 'a'), folder('z', 'Z'),
  ]

  it('자기 자신 + 자손 전부(형제 루트 배제)', () => {
    expect(new Set(folderSubtreeIds(tree, 'a'))).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('리프는 자기 자신만', () => {
    expect(folderSubtreeIds(tree, 'c')).toEqual(['c'])
  })

  it('중간 노드는 그 아래만', () => {
    expect(new Set(folderSubtreeIds(tree, 'b'))).toEqual(new Set(['b', 'c']))
  })

  it('부재 id 도 자기 자신 1개 — 필터가 소리 없이 전체로 넓어지지 않는다', () => {
    expect(folderSubtreeIds(tree, 'ghost')).toEqual(['ghost'])
  })

  it('순환 참조에서도 끝난다', () => {
    const cyclic = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]
    expect(new Set(folderSubtreeIds(cyclic, 'x'))).toEqual(new Set(['x', 'y']))
  })
})

describe('teamChildFoldersOf', () => {
  const seedRoot = (id: string, name: string, sort = 100): MinuteFolder =>
    ({ id, name, parentId: null, sort, createdBy: null, projectId: null })
  const userFolder = (id: string, name: string, parentId: string | null, sort = 100): MinuteFolder =>
    ({ id, name, parentId, sort, createdBy: 'user-1', projectId: null })

  it('시드 팀 루트의 직계 하위만, 트리와 같은 정렬(sort asc → name ko asc)', () => {
    const fs = [
      seedRoot('r', 'MES'),
      userFolder('c2', '나중', 'r', 200), userFolder('c1', '가나', 'r', 100),
      userFolder('g', '손자', 'c1'),
    ]
    expect(teamChildFoldersOf(fs, 'MES' as TeamCode).map(f => f.id)).toEqual(['c1', 'c2'])
  })

  it('동명 사용자 루트(스쿼팅)는 팀 루트가 아니다', () => {
    const fs = [userFolder('fake', 'MES', null), userFolder('c', '하위', 'fake')]
    expect(teamChildFoldersOf(fs, 'MES' as TeamCode)).toEqual([])
  })

  it('팀 루트 부재·하위 없음은 빈 배열', () => {
    expect(teamChildFoldersOf([], 'MES' as TeamCode)).toEqual([])
    expect(teamChildFoldersOf([seedRoot('r', 'MES')], 'MES' as TeamCode)).toEqual([])
  })
})
