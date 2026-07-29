// 회의록 탐색기 드래그앤드롭 규칙 — 순수(I/O 없음). 리프(회의록)는 소속 폴더만 바꾸므로
// noop/move 뿐이지만, 폴더 이동은 트리 불변식(팀 편철 앵커·순환·깊이 상한·루트 예약어)을 깨뜨릴
// 수 있어 거부 사유를 값으로 돌려준다 — 호출부가 사유별 안내를 고르게 하고, 서버 액션
// moveMinuteFolder 가 같은 함수로 재검증한다(클라이언트 판정 신뢰 금지).
// 편집 권한(canManageFolder/canMoveLeaf)은 호출부가 선판정 — 여기서는 다루지 않는다.
import type { ExplorerLeaf, MinuteFolder } from './types'
import { folderDepthOf, isTeamRootFolder, isTeamRootName, MINUTE_FOLDER_DEPTH_MAX } from './minutes'

export type MinuteDropReject =
  | 'team-root'     // 팀 시드 루트는 이동 금지 — 옮기면 자동 편철 앵커가 소리 없이 끊긴다
  | 'not-found'     // 대상 폴더가 목록에 없음(방금 삭제 등)
  | 'cycle'         // 자기 자신/자손으로 이동 — 서브트리가 트리에서 떨어져 나간다
  | 'depth'         // 이동 후 서브트리 최심 깊이가 상한 초과
  | 'anchor-squat'  // 루트로 이동 시 팀코드 동명 — 앵커 사칭(createMinuteFolder 가드와 동일 규칙)

export type MinuteDropResult =
  | { kind: 'noop' }
  | { kind: 'move' }
  | { kind: 'reject'; reason: MinuteDropReject }

/** 회의록을 targetFolderId 에 드롭했을 때의 결과. null = 미분류. */
export function resolveLeafDrop(
  leaf: Pick<ExplorerLeaf, 'folderId'>, targetFolderId: string | null,
): MinuteDropResult {
  return leaf.folderId === targetFolderId ? { kind: 'noop' } : { kind: 'move' }
}

/** folder 를 targetParentId 아래로 옮길 때의 결과. targetParentId null = 루트 레벨.
 *  teamCodes 는 루트 예약어 판정용(비활성 포함 전체 등록 팀) — 비면 앵커 사칭 검사를 건너뛴다.
 *  클라이언트가 활성 팀만 알아 과소 거부해도 서버가 전체 목록으로 최종 판정한다(fail-closed). */
export function resolveFolderDrop(
  folder: MinuteFolder,
  targetParentId: string | null,
  folders: MinuteFolder[],
  teamCodes: readonly string[] = [],
): MinuteDropResult {
  // 제자리 드롭은 사고가 아니라 취소 — 에러 토스트를 띄우지 않는다(팀 루트를 루트에 놓는 경우 포함).
  // 그래서 team-root 거부보다 앞선다.
  if (targetParentId === folder.id || targetParentId === folder.parentId) return { kind: 'noop' }
  if (isTeamRootFolder(folder)) return { kind: 'reject', reason: 'team-root' }
  if (targetParentId !== null && !folders.some(f => f.id === targetParentId))
    return { kind: 'reject', reason: 'not-found' }
  // 순환 검사는 반드시 깊이 검사보다 먼저다 — 아래 folderDepthOf 는 **이동 전** 배열로 대상의
  // 조상 체인을 세는데, 대상이 folder 의 자손이면 그 체인이 이동으로 바뀌어 계산이 무의미해진다.
  // 순환을 먼저 걸러야 "대상의 조상은 이동과 무관"이라는 전제가 성립한다. 순서 바꾸지 말 것.
  if (isDescendantOrSelf(folders, targetParentId, folder.id))
    return { kind: 'reject', reason: 'cycle' }
  if (folderDepthOf(folders, targetParentId) + subtreeHeight(folders, folder.id) > MINUTE_FOLDER_DEPTH_MAX)
    return { kind: 'reject', reason: 'depth' }
  if (targetParentId === null && isTeamRootName(folder.name, teamCodes))
    return { kind: 'reject', reason: 'anchor-squat' }
  return { kind: 'move' }
}

/** candidateId 가 ancestorId 자신이거나 그 자손인지 — 조상 체인을 걸어 올라간다.
 *  seen 가드 필수: buildFolderTree·folderDepthOf 와 마찬가지로 순환·끊긴 체인을 견뎌야 한다
 *  (그 데이터가 서버 액션에 들어오면 가드 없는 순회는 무한 루프가 된다). */
function isDescendantOrSelf(
  folders: MinuteFolder[], candidateId: string | null, ancestorId: string,
): boolean {
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = candidateId
  while (cur) {
    if (cur === ancestorId) return true
    if (seen.has(cur)) return false   // 순환 절단 — ancestorId 에 닿지 못했으므로 자손 아님
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/** rootId 서브트리의 단 수(자기 자신만 있으면 1). 순환 자식 참조도 seen 으로 절단한다. */
function subtreeHeight(folders: MinuteFolder[], rootId: string): number {
  const childrenOf = new Map<string, MinuteFolder[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    const list = childrenOf.get(f.parentId)
    if (list) list.push(f); else childrenOf.set(f.parentId, [f])
  }
  const seen = new Set<string>()
  const walk = (id: string): number => {
    if (seen.has(id)) return 0        // 순환 절단
    seen.add(id)
    let deepest = 0
    for (const c of childrenOf.get(id) ?? []) deepest = Math.max(deepest, walk(c.id))
    return deepest + 1
  }
  return walk(rootId)
}
