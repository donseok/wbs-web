import { describe, it, expect } from 'vitest'
import type { MinuteFolder } from '@/lib/domain/types'
import { canDropFolder, canDropMinute } from '@/lib/domain/folder-drop'

/** 탐색기 드롭존과 서버 액션(moveMinuteFolder)이 같은 함수를 쓴다 — D&D 판정은 이 순수 함수
 *  테스트로만 커버한다(tests/domain/kanbanDrop.test.ts 와 같은 관례). */

const f = (
  id: string, name: string, parentId: string | null, createdBy: string | null = 'u1',
): MinuteFolder => ({ id, name, parentId, sort: 100, createdBy })

/* 시드 팀 루트(createdBy null) 2개 + MES 서브트리
     MES(1)
       ├ 품질(2) ─ 주간정례(3) ─ 2026-07(4)      … 서브트리 높이 3
       ├ 생산(2) ─ 정례(3)
       ├ A(2)
       └ B(2) ─ A(3)
     ERP(1) ─ 계정(2)
   그리고 시드 체인 밖(사용자 루트) X ─ Y — 팀 파생이 불가능한 §6.3 위반 데이터 */
const folders: MinuteFolder[] = [
  f('mes', 'MES', null, null),
  f('erp', 'ERP', null, null),
  f('q', '품질', 'mes'),
  f('w', '주간정례', 'q'),
  f('m7', '2026-07', 'w'),
  f('p', '생산', 'mes'),
  f('pr', '정례', 'p'),
  f('a1', 'A', 'mes'),
  f('b', 'B', 'mes'),
  f('a2', 'A', 'b'),
  f('erp-acc', '계정', 'erp'),
  f('x', 'X', null),          // 사용자 루트 — 시드 체인 밖
  f('y', 'Y', 'x'),
]

describe('canDropFolder', () => {
  it('같은 팀 안·깊이 여유가 있으면 허용 (품질 서브트리 3단을 2단 자리로)', () => {
    expect(canDropFolder(folders, 'q', 'p', true)).toEqual({ ok: true })
  })

  it('not-admin — 관리자가 아니면 다른 모든 조건과 무관하게 거절', () => {
    expect(canDropFolder(folders, 'q', 'p', false)).toEqual({ ok: false, reason: 'not-admin' })
  })

  it('seed-root — 시드 팀 루트(0043 편철 앵커)는 이동 불가', () => {
    expect(canDropFolder(folders, 'mes', 'q', true)).toEqual({ ok: false, reason: 'seed-root' })
  })

  it('to-root — 루트로는 옮길 수 없다(§6.3 불변식)', () => {
    expect(canDropFolder(folders, 'q', null, true)).toEqual({ ok: false, reason: 'to-root' })
  })

  it('cycle — 자기 자신 위로 드롭', () => {
    expect(canDropFolder(folders, 'q', 'q', true)).toEqual({ ok: false, reason: 'cycle' })
  })

  it('cycle — 자손 아래로 드롭(직계·손자 모두)', () => {
    expect(canDropFolder(folders, 'q', 'w', true)).toEqual({ ok: false, reason: 'cycle' })
    expect(canDropFolder(folders, 'q', 'm7', true)).toEqual({ ok: false, reason: 'cycle' })
  })

  it('depth — 서브트리 높이까지 더해 5단 초과면 거절 (3단 폴더를 3단 자리로)', () => {
    // folderDepthOf('pr') = 3, subtreeHeightOf('q') = 3 → 6 > 5.
    // folderDepthOf 만 봤다면 3 < 5 로 통과했을 케이스다(C6).
    expect(canDropFolder(folders, 'q', 'pr', true)).toEqual({ ok: false, reason: 'depth' })
    // 한 단 얕은 자리(생산, 2단)는 정확히 5단이라 허용 — 경계가 초과가 아니라 등호에 있다
    expect(canDropFolder(folders, 'q', 'p', true)).toEqual({ ok: true })
  })

  it('cross-team — 다른 팀 루트 서브트리로는 v1 에서 이동 불가', () => {
    expect(canDropFolder(folders, 'q', 'erp', true)).toEqual({ ok: false, reason: 'cross-team' })
    expect(canDropFolder(folders, 'q', 'erp-acc', true)).toEqual({ ok: false, reason: 'cross-team' })
  })

  it('dup-name — 같은 부모에 동명 폴더가 이미 있으면 거절(23505 원문 노출 방지)', () => {
    expect(canDropFolder(folders, 'a1', 'b', true)).toEqual({ ok: false, reason: 'dup-name' })
  })

  it('same-parent — 이미 그 부모 아래면 이동이 아니다', () => {
    expect(canDropFolder(folders, 'q', 'mes', true)).toEqual({ ok: false, reason: 'same-parent' })
  })

  it('unknown-folder — 목록에 없는 id, 그리고 팀 파생이 불가능한 시드 체인 밖 폴더', () => {
    expect(canDropFolder(folders, 'nope', 'q', true)).toEqual({ ok: false, reason: 'unknown-folder' })
    expect(canDropFolder(folders, 'q', 'nope', true)).toEqual({ ok: false, reason: 'unknown-folder' })
    // 사용자 루트(X) 아래의 Y 는 팀을 추측하지 않고 거절한다 — 추측하면 team_code 가 오염된다
    expect(canDropFolder(folders, 'y', 'q', true)).toEqual({ ok: false, reason: 'unknown-folder' })
    expect(canDropFolder(folders, 'q', 'y', true)).toEqual({ ok: false, reason: 'unknown-folder' })
  })
})

describe('canDropMinute', () => {
  it('같은 팀 안 이동은 crossTeam=false (team_code 불변 → 위키 잡 없음)', () => {
    expect(canDropMinute(folders, { folderId: 'a1', teamCode: 'MES' }, 'q', true))
      .toEqual({ ok: true, crossTeam: false })
  })

  it('다른 팀 루트 서브트리로 옮기면 crossTeam=true (team_code 동반 갱신 경로)', () => {
    expect(canDropMinute(folders, { folderId: 'erp-acc', teamCode: 'ERP' }, 'q', true))
      .toEqual({ ok: true, crossTeam: true })
    // 미분류(folderId null)에서 들어오는 경우도 팀이 다르면 crossTeam
    expect(canDropMinute(folders, { folderId: null, teamCode: 'ERP' }, 'mes', true))
      .toEqual({ ok: true, crossTeam: true })
  })

  it('no-permission — 작성자도 관리자도 아니면 거절', () => {
    expect(canDropMinute(folders, { folderId: 'a1', teamCode: 'MES' }, 'q', false))
      .toEqual({ ok: false, reason: 'no-permission' })
  })

  it('same-folder — 원래 있던 폴더로의 드롭은 이동이 아니다', () => {
    expect(canDropMinute(folders, { folderId: 'q', teamCode: 'MES' }, 'q', true))
      .toEqual({ ok: false, reason: 'same-folder' })
  })

  it('unknown-folder — 목록에 없는 대상', () => {
    expect(canDropMinute(folders, { folderId: 'q', teamCode: 'MES' }, 'nope', true))
      .toEqual({ ok: false, reason: 'unknown-folder' })
  })

  it('no-team — 시드 체인 밖 폴더로는 옮길 수 없다(팀 파생 불가)', () => {
    expect(canDropMinute(folders, { folderId: 'q', teamCode: 'MES' }, 'y', true))
      .toEqual({ ok: false, reason: 'no-team' })
  })
})
