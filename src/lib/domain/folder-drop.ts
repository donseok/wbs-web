import type { MinuteFolder, TeamCode } from './types'
import {
  folderDepthOf, isDescendantFolder, isTeamRootFolder, subtreeHeightOf, teamSubOfFolder,
  MINUTE_FOLDER_DEPTH_MAX,
} from './minutes'

/**
 * 탐색기 드래그앤드롭 판정 (§6.4·§6.5) — I/O 없는 순수 함수.
 *
 * 탐색기(드롭존 비활성)와 서버 액션(최종 가드)이 **같은 함수**를 쓴다. 갈라지면
 * "놓을 수 있어 보였는데 에러가 나거나", 반대로 "막아야 할 것이 서버까지 도달"한다.
 * kanban-drop.ts 와 같은 관례 — 권한은 호출부가 선판정해 인자로 넘긴다.
 */

export type FolderDropReason =
  /** pmo_admin 이 아님 — 폴더 D&D는 관리자 전용(§6.5) */
  | 'not-admin'
  /** 시드 팀 루트는 0043 편철 앵커라 이동 금지(M1) */
  | 'seed-root'
  /** 루트로는 옮길 수 없다 — §6.3 불변식(M2) */
  | 'to-root'
  /** 자기 자신·자손 아래로 이동 금지(M3) */
  | 'cycle'
  /** 서브트리 높이까지 더하면 5단 초과(M4) */
  | 'depth'
  /** 다른 담당 팀으로의 이동은 v1 제외 */
  | 'cross-team'
  /** 같은 부모에 동명 폴더(M5) */
  | 'dup-name'
  /** 대상·부모 폴더를 목록에서 찾을 수 없음 */
  | 'unknown-folder'
  /** 이미 그 부모 아래에 있음 — 이동이 아님 */
  | 'same-parent'

export type FolderDropVerdict = { ok: true } | { ok: false; reason: FolderDropReason }

/** 폴더를 targetParentId 아래로 옮길 수 있는가. 서버 `moveMinuteFolder` 와 같은 판정. */
export function canDropFolder(
  folders: MinuteFolder[],
  dragId: string,
  targetParentId: string | null,
  isAdmin: boolean,
): FolderDropVerdict {
  if (!isAdmin) return { ok: false, reason: 'not-admin' }
  if (targetParentId === null) return { ok: false, reason: 'to-root' }
  if (dragId === targetParentId) return { ok: false, reason: 'cycle' }

  const target = folders.find(f => f.id === dragId)
  const parent = folders.find(f => f.id === targetParentId)
  if (!target || !parent) return { ok: false, reason: 'unknown-folder' }

  if (isTeamRootFolder(target)) return { ok: false, reason: 'seed-root' }
  if (target.parentId === targetParentId) return { ok: false, reason: 'same-parent' }
  if (isDescendantFolder(folders, dragId, targetParentId)) return { ok: false, reason: 'cycle' }
  if (folderDepthOf(folders, targetParentId) + subtreeHeightOf(folders, dragId) > MINUTE_FOLDER_DEPTH_MAX) {
    return { ok: false, reason: 'depth' }
  }

  const fromTeam = teamSubOfFolder(folders, dragId)?.team ?? null
  const toTeam = teamSubOfFolder(folders, targetParentId)?.team ?? null
  // 팀 파생이 안 되는 폴더(시드 체인 밖)는 추측하지 않고 거절한다 — §6.3 불변식 위반 데이터.
  if (fromTeam === null || toTeam === null) return { ok: false, reason: 'unknown-folder' }
  if (fromTeam !== toTeam) return { ok: false, reason: 'cross-team' }

  if (folders.some(f => f.parentId === targetParentId && f.name === target.name && f.id !== dragId)) {
    return { ok: false, reason: 'dup-name' }
  }
  return { ok: true }
}

export type MinuteDropReason = 'no-permission' | 'unknown-folder' | 'same-folder' | 'no-team'

export type MinuteDropVerdict =
  /** crossTeam 이면 서버가 team_code 동반 갱신 + 메타 RPC 경로를 탄다(§6.4). */
  | { ok: true; crossTeam: boolean }
  | { ok: false; reason: MinuteDropReason }

/** 회의록을 targetFolderId 로 옮길 수 있는가. 권한은 호출부가 판정해 canMove 로 넘긴다. */
export function canDropMinute(
  folders: MinuteFolder[],
  leaf: { folderId: string | null; teamCode: TeamCode },
  targetFolderId: string,
  canMove: boolean,
): MinuteDropVerdict {
  if (!canMove) return { ok: false, reason: 'no-permission' }
  if (leaf.folderId === targetFolderId) return { ok: false, reason: 'same-folder' }
  if (!folders.some(f => f.id === targetFolderId)) return { ok: false, reason: 'unknown-folder' }
  const toTeam = teamSubOfFolder(folders, targetFolderId)?.team ?? null
  if (toTeam === null) return { ok: false, reason: 'no-team' }
  return { ok: true, crossTeam: toTeam !== leaf.teamCode }
}
