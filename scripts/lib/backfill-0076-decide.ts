// 0076 백필 러너(scripts/backfill-0076.runner.ts)의 판정 로직만 떼어낸 순수 모듈.
// wiki-rebuild-loop.mjs 와 같은 이유로 분리했다 — 러너 파일 자체를 import 하면 즉시 실행되므로
// (describe/it 이 톱레벨에서 실 DB 를 부른다) 정책만 별도 모듈로 떼어야 fixture 로 테스트할 수 있다.
import { folderPathOfSnapshot, type FolderSnapshot } from '@/lib/minutes/folders'

export interface BackfillMinuteRow {
  id: string
  projectId: string
  folderId: string | null
}

export type BackfillDecision =
  // 미분류(폴더 없음) 이거나 이미 목표 프로젝트 트리로 이식된 상태(재실행 멱등) — 손대지 않는다.
  | { action: 'kept' }
  // 기존 폴더의 경로를 스냅샷에서 복원할 수 없다(끊긴 체인) — 추측하지 않고 미분류로 강등.
  | { action: 'unfiled' }
  // 프로젝트 트리에 같은 경로를 확보해야 한다 — 실제 I/O(resolveFolderPath)는 호출부 책임.
  | { action: 'resolve'; path: string[] }

/** 회의록 1건의 편철 판정 — DB I/O 없는 순수 함수. resolveFolderPath 호출 여부만 가른다. */
export function decideBackfillAction(
  snap: FolderSnapshot, minute: BackfillMinuteRow,
): BackfillDecision {
  if (!minute.folderId) return { action: 'kept' }
  const oldRow = snap.byId.get(minute.folderId)
  if (oldRow && oldRow.projectId === minute.projectId) return { action: 'kept' }
  const path = folderPathOfSnapshot(snap, minute.folderId)
  if (!path) return { action: 'unfiled' }
  return { action: 'resolve', path }
}

/** 사후 로그(outputs/*.json 의 log[])의 세부 사유 — decideBackfillAction 의 3-way action 보다
 *  세분화돼 있다: 'resolve' 액션의 I/O 결과가 성공(moved)/실패(no-target) 로 더 갈리기 때문.
 *  Task 10 운영자가 "왜 미분류로 남았는가"(끊긴 체인 vs 대상 해석 실패)를 구분하는 용도. */
export type BackfillLogReason = 'kept' | 'broken-chain' | 'no-target' | 'moved'

export interface BackfillPreSnapshotEntry {
  minuteId: string
  oldFolderId: string | null
}

/** apply 이전 사전 스냅샷 — 대상 회의록 전량의 (id, 기존 folder_id) 를 그대로 옮긴다.
 *  DB I/O 없는 순수 함수. 롤백 복원용이라 이후의 kept/unfiled/resolve 판정과 무관하게
 *  조회된 행 전체를 포함해야 한다 — 어떤 것이 실제로 update 될지는 이 시점엔 아직 모른다. */
export function buildPreSnapshot(
  minutes: readonly { id: string; folder_id: string | null }[],
): BackfillPreSnapshotEntry[] {
  return minutes.map(m => ({ minuteId: m.id, oldFolderId: m.folder_id ?? null }))
}
