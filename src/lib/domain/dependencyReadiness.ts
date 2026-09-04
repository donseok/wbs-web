import { stageAtLeast } from './agentWork'
import type { DependencyOrigin, DependencyType } from './types'

/** 선행 충족 판정에 필요한 최소 정보 — ComputedItem 전체를 요구하지 않는다(순수·테스트 용이). */
export interface ReadinessTask {
  id: string
  /** leaf=actualPct, 상위=가중 롤업(ComputedItem.rolledActualPct). manual 링크 판정에 쓴다. */
  rolledActualPct: number
  /** WBS Task 단계('as'|'fp'|'ip'|'im'|'xx'). spec 링크 판정에 쓴다. 없으면 미달로 본다. */
  stage?: string | null
}

export interface ReadinessLink {
  id: string
  predecessorId: string
  type: DependencyType
  lagDays: number
  /** 어느 축에서 온 링크인가 — 축마다 충족 규칙이 다르다. @see evaluateStartReadiness */
  origin: DependencyOrigin
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
 * **축마다 규칙이 다르다. 뭉개지 않는다.**
 *
 * - origin 'spec'(wbs.md depends): `stageAtLeast(stage, 'im')`. 이 축은 에이전트 claim 게이트가
 *   실제로 막는 축이므로 게이트와 **같은 식**이어야 한다. 실적으로 판정하면 화면은 "시작 가능"인데
 *   claim 이 409 를 내는 어긋남이 생긴다. 유형은 항상 FS 라 SS 분기가 없다.
 * - origin 'manual'(화면에서 그은 선): 이 축은 아무것도 막지 않아 실적이 유일한 완료 신호다.
 *   - FS: 선행 실적 100%. `statusOf` 의 done 판정과 같은 원시값 비교라 99.5% 가 완료로 뒤집히지 않는다.
 *   - SS: 선행이 시작만 했으면(실적 > 0) 충족. 상태 문자열(delayed 등)은 쓰지 않는다 —
 *     지연은 "계획 시작일이 지났다"는 뜻이지 착수했다는 뜻이 아니다.
 * - lagDays 는 실제 착수일 기록이 없어 충족 여부 판정에 쓰지 않는다(예상 일정은 computeDependencySchedule 의 몫).
 * - 선행 행을 찾지 못하면 unknown — 모르면 시작 가능으로 위장하지 않는다.
 * - unresolvedRefs(프로젝트에서 해석 안 되는 external_ref)도 unknown 으로 센다. claim 게이트가
 *   그것을 미충족으로 보고 409 를 내므로, 여기서 빼면 막힌 작업이 "시작 가능"으로 보인다.
 */
export function evaluateStartReadiness(
  task: ReadinessTask,
  links: readonly ReadinessLink[],
  predecessorById: ReadonlyMap<string, ReadinessTask>,
  unresolvedRefs: readonly string[] = [],
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
    const satisfied = dep.origin === 'spec'
      ? stageAtLeast(predecessor.stage ?? null, 'im')
      : dep.type === 'SS'
        ? predecessor.rolledActualPct > 0
        : predecessor.rolledActualPct >= 100
    byDependencyId.set(dep.id, satisfied ? 'satisfied' : 'waiting')
    if (!satisfied) waitingCount++
  }

  unknownCount += unresolvedRefs.length

  return {
    byDependencyId,
    waitingCount,
    unknownCount,
    ready: waitingCount === 0 && unknownCount === 0,
    started: task.rolledActualPct > 0,
  }
}
