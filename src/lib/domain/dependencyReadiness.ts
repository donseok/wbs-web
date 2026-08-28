import type { DependencyType } from './types'

/** 선행 충족 판정에 필요한 최소 정보 — ComputedItem 전체를 요구하지 않는다(순수·테스트 용이). */
export interface ReadinessTask {
  id: string
  /** leaf=actualPct, 상위=가중 롤업(ComputedItem.rolledActualPct). */
  rolledActualPct: number
}

export interface ReadinessLink {
  id: string
  predecessorId: string
  type: DependencyType
  lagDays: number
}

/** satisfied=선행 제약 충족, waiting=선행이 아직 조건 미달, unknown=선행 행을 찾을 수 없음. */
export type PredecessorState = 'satisfied' | 'waiting' | 'unknown'

export interface StartReadiness {
  byDependencyId: Map<string, PredecessorState>
  waitingCount: number
  /** 선행 행이 사라진(삭제·미조회) 건수. 0 이 아니면 판정을 신뢰할 수 없으므로 화면에 그대로 드러낸다. */
  unknownCount: number
  /** 선행 제약을 모두 만족해 지금 시작할 수 있다. unknown 이 하나라도 있으면 false(fail-closed). */
  ready: boolean
  /** 대상 작업 자신이 이미 시작됐다(실적 > 0). */
  started: boolean
}

/**
 * 선행 의존성만으로 "지금 시작할 수 있는가"를 판정한다.
 *
 * - FS(완료 후 시작): 선행 실적이 100% 여야 충족. `statusOf` 의 done 판정과 같은 원시값 비교라
 *   99.5% 가 완료로 뒤집히지 않는다.
 * - SS(동시 시작): 선행이 시작만 했으면(실적 > 0) 충족. 상태 문자열(delayed 등)은 쓰지 않는다 —
 *   지연은 "계획 시작일이 지났다"는 뜻이지 착수했다는 뜻이 아니다.
 * - lagDays 는 실제 착수일 기록이 없어 충족 여부 판정에 쓰지 않는다(예상 일정은 computeDependencySchedule 의 몫).
 * - 선행 행을 찾지 못하면 unknown — 모르면 시작 가능으로 위장하지 않는다.
 */
export function evaluateStartReadiness(
  task: ReadinessTask,
  links: readonly ReadinessLink[],
  predecessorById: ReadonlyMap<string, ReadinessTask>,
): StartReadiness {
  const byDependencyId = new Map<string, PredecessorState>()
  let waitingCount = 0
  let unknownCount = 0

  for (const dep of links) {
    const predecessor = predecessorById.get(dep.predecessorId)
    if (!predecessor) {
      byDependencyId.set(dep.id, 'unknown')
      unknownCount++
      continue
    }
    const satisfied = dep.type === 'SS'
      ? predecessor.rolledActualPct > 0
      : predecessor.rolledActualPct >= 100
    byDependencyId.set(dep.id, satisfied ? 'satisfied' : 'waiting')
    if (!satisfied) waitingCount++
  }

  return {
    byDependencyId,
    waitingCount,
    unknownCount,
    ready: waitingCount === 0 && unknownCount === 0,
    started: task.rolledActualPct > 0,
  }
}
