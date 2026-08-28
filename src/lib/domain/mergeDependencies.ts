import type { TaskDependency } from './types'

/**
 * 병합 재료 — wbs_items 에서 읽어온 선행 정보.
 * `depends` 는 external_ref 배열이라 uuid 로 해석해야 TaskDependency 가 된다.
 */
export interface SpecDependSource {
  id: string
  projectId: string
  externalRef: string | null
  depends: string[] | null
}

export interface MergedDependencies {
  dependencies: TaskDependency[]
  /**
   * 프로젝트 안에서 해석되지 않은 선행 ref — 후행 항목 id → ref 목록(depends 등장 순서).
   *
   * **버리면 안 된다.** claim 게이트는 이 상태를 미충족으로 보고 409 를 낸다:
   * `loadDependsInfo` 가 없는 ref 를 `{ stage: null, order_approved: false }` 로 돌려주고
   * (`src/lib/agent/depends.ts`), claim 라우트가 그것을 unmet 으로 센다.
   * 화면에서 지우면 "선행 없음 → 시작 가능"이 되어, 실제로는 막힌 작업을 안 막힌 것처럼 위장한다.
   */
  unresolvedBySuccessorId: Map<string, string[]>
}

/** 합성 의존성의 id. uuid 와 형태가 겹치지 않아 실수로 DB 에 넘어가도 조용히 통과하지 않는다. */
export function specDependencyId(predecessorId: string, successorId: string): string {
  return `spec:${predecessorId}>${successorId}`
}

/** id 가 합성 행의 것인가 — 삭제 경로가 실수로 이 id 를 넘기지 않는지 검사할 때 쓴다. */
export function isSpecDependencyId(id: string): boolean {
  return id.startsWith('spec:')
}

/**
 * wbs_items.depends(external_ref) 를 uuid 쌍의 FS 의존성으로 합성해 task_dependencies 실제 행과 합친다.
 *
 * 두 축은 뜻이 같다 — "A 가 끝나야 B 를 한다". 갈린 건 출신뿐이라(0029 화면 편집 / 0077 wbs.md import)
 * 읽는 순간 하나로 합치면 간트 연결선·크리티컬 패스·예상 일정·AI 봇이 동시에 켜진다.
 * 저장하지 않으므로 0029 트리거(계획일·영업일 강제)와 싸울 일이 없다 —
 * 도메인 계산기는 날짜 없는 작업을 이미 unscheduledTaskIds 로 흘려보낸다.
 *
 * 규칙:
 * - 같은 (선행, 후행) 쌍이 양쪽에 있으면 **실제 행이 이긴다**. 합성 행을 겹쳐 넣으면 연결선이 두 겹으로 그려진다.
 * - 자기참조는 버린다(0029 의 not_self 제약과 같은 판정).
 * - 순환은 버리지 않는다 — computeDependencySchedule 이 cycleTaskIds 로 처리하고 화면도 전용 색으로 그린다.
 * - 해석 못 한 ref 는 unresolvedBySuccessorId 로 넘긴다(위 주석 참고).
 */
export function mergeSpecDepends(
  rows: TaskDependency[],
  items: SpecDependSource[],
): MergedDependencies {
  const idByExternalRef = new Map<string, string>()
  for (const item of items) {
    if (item.externalRef) idByExternalRef.set(item.externalRef, item.id)
  }

  const takenPairs = new Set(rows.map(r => `${r.predecessorId}>${r.successorId}`))
  const dependencies: TaskDependency[] = [...rows]
  const unresolvedBySuccessorId = new Map<string, string[]>()

  for (const item of items) {
    const seenRefs = new Set<string>()
    for (const ref of item.depends ?? []) {
      if (seenRefs.has(ref)) continue // 같은 ref 가 두 번 적혀도 한 번만 센다
      seenRefs.add(ref)

      const predecessorId = idByExternalRef.get(ref)
      if (!predecessorId) {
        const list = unresolvedBySuccessorId.get(item.id) ?? []
        list.push(ref)
        unresolvedBySuccessorId.set(item.id, list)
        continue
      }
      if (predecessorId === item.id) continue // 자기참조 — 미해석으로도 세지 않는다

      const pair = `${predecessorId}>${item.id}`
      if (takenPairs.has(pair)) continue // 실제 행이 이긴다
      takenPairs.add(pair)

      dependencies.push({
        id: specDependencyId(predecessorId, item.id),
        projectId: item.projectId, // 후행 항목의 프로젝트 — AI 봇 스코프 검사가 이 값을 본다
        predecessorId,
        successorId: item.id,
        type: 'FS', // depends 는 유형이 없다. 앞이 끝나야 뒤를 한다 = FS
        lagDays: 0,
        origin: 'spec',
      })
    }
  }

  return { dependencies, unresolvedBySuccessorId }
}
