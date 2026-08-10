import type { ComputedItem } from './types'

/**
 * WBS 완료 숨기기 판정 (스펙: docs/superpowers/specs/2026-08-10-wbs-hide-completed-design.md).
 * 부모 status('done')가 아니라 리프 원시값으로 판정한다 — round1 반올림·가중치 0 소거
 * 두 엣지에서 미완 리프가 남아 있어도 부모 status 는 done 이 될 수 있기 때문.
 */
export interface HideDoneResult {
  /** 화면에서 제거할 행 — 전부 완료된 구간(자식을 가진 노드)과 그 하위 전체 */
  hiddenIds: Set<string>
  /** 흐림 대상 — 서브트리 전체가 완료인 모든 노드(화면에 남은 것만 흐려진다) */
  dimIds: Set<string>
  /** 토글 버튼에 병기할 N = hiddenIds.size — 접힘 상태와 무관한 "감춘 작업 수" */
  hiddenCount: number
}

export function computeHideDone(items: ComputedItem[]): HideDoneResult {
  const dimIds = new Set<string>()
  const allDone = new Map<string, boolean>()
  const walk = (n: ComputedItem): boolean => {
    let v: boolean
    if (n.children.length === 0) {
      v = (n.actualPct ?? 0) >= 100 // 원시값 비교 — statusOf 의 done 계약과 동일(반올림 금지)
    } else {
      let all = true
      for (const c of n.children) if (!walk(c)) all = false // 단락 금지 — 하위 전 노드 판정 필요
      v = all
    }
    allDone.set(n.id, v)
    if (v) dimIds.add(n.id)
    return v
  }
  items.forEach(walk)

  const hiddenIds = new Set<string>()
  const collect = (n: ComputedItem) => {
    hiddenIds.add(n.id)
    n.children.forEach(collect)
  }
  // 자식을 가진(=구간) 전부 완료 노드만 숨긴다. 리프는 구간이 아니라 부모를 통해서만 숨�다
  // — 최상위 완료 리프가 흐림으로 남는 규칙의 근거.
  const mark = (ns: ComputedItem[]) => {
    for (const n of ns) {
      if (n.children.length > 0 && allDone.get(n.id)) collect(n)
      else mark(n.children)
    }
  }
  mark(items)
  return { hiddenIds, dimIds, hiddenCount: hiddenIds.size }
}
