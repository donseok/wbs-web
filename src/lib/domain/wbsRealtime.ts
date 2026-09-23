// WBS 실시간 반영의 순수 계층 — 채널 토픽·페이로드 해석·부분 패치. React 도 Supabase 도 모른다.
// 구독 자체는 src/lib/hooks/useWbsRealtime.ts, DB 송신은 0098_wbs_realtime.sql.
// 설계 정본: docs/superpowers/specs/2026-09-16-wbs-realtime-push-design.md
import { computeNode } from './rollup'
import type { ComputedItem } from './types'

/** DB 트리거가 쓰는 토픽. 0098 의 realtime.messages 정책이 같은 문자열을 정규식으로 검사한다. */
export function wbsChannelTopic(projectId: string): string {
  return `project-${projectId}-wbs`
}

/** 트리거 broadcast 1건. 필드는 wbs_items 의 SELECT 정책이 전면 개방(0002)이라 프로젝트 멤버 전원이 이미 읽을 수 있는 값뿐이다. */
export type WbsChangePayload = {
  id: string
  projectId: string
  stage: string | null
  actualPct: number | null
  /** 순서 판정용. broadcast 는 전송 순서를 보장하지 않는다. */
  updatedAt: string
}

/** numeric 은 경로에 따라 문자열로 실려 온다 — 수로 읽히지 않으면 null(값 없음)로 본다. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * broadcast 페이로드를 도메인 형태로 읽는다. 형태가 어긋나면 null 이다.
 * 네트워크에서 온 값이므로 신뢰하지 않는다 — 판정 못 하면 버린다(fail-closed).
 */
export function parseWbsPayload(raw: unknown): WbsChangePayload | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = r.id
  const projectId = r.project_id
  const updatedAt = r.updated_at
  if (typeof id !== 'string' || id === '') return null
  if (typeof projectId !== 'string' || projectId === '') return null
  if (typeof updatedAt !== 'string' || updatedAt === '') return null
  return {
    id,
    projectId,
    stage: typeof r.stage === 'string' ? r.stage : null,
    actualPct: toNumber(r.actual_pct),
    updatedAt,
  }
}

function findNode(ns: readonly ComputedItem[], id: string): ComputedItem | null {
  for (const n of ns) {
    if (n.id === id) return n
    const hit = findNode(n.children, id) ?? findNode(n.subTasks ?? [], id)
    if (hit) return hit
  }
  return null
}

/** 대상 노드만 새 객체로 바꾼 트리를 돌려준다(경로 밖 노드는 참조 그대로). */
function replaceNode(ns: readonly ComputedItem[], p: WbsChangePayload): ComputedItem[] | null {
  let changed = false
  const next = ns.map(n => {
    if (n.id === p.id) {
      changed = true
      return { ...n, stage: p.stage, actualPct: p.actualPct, updatedAt: p.updatedAt }
    }
    const sub = replaceNode(n.children, p)
    const st = replaceNode(n.subTasks ?? [], p) // stub 하위(0103)도 실시간으로 바뀐다
    if (sub === null && st === null) return n
    changed = true
    return { ...n, ...(sub ? { children: sub } : {}), ...(st ? { subTasks: st } : {}) }
  })
  return changed ? next : null
}

/**
 * 페이로드 1건을 트리에 반영한다. **반영할 것이 없으면 null** 이고, 호출부는 상태를 그대로 둔다.
 *
 * null 을 돌려주는 경우는 셋이다.
 *   1) 트리에 없는 항목 — 다른 프로젝트이거나 아직 못 받은 행이다.
 *   2) 보유 행의 updatedAt 이 페이로드와 같거나 더 새롭다 — 순서 역전이라 버린다(§6-1).
 *   3) (1)(2)가 아닌데 교체 대상을 못 찾은 경우 — 방어적 분기다.
 *
 * 조상 롤업은 `computeNode` 를 다시 돌려 낸다. 리프만 갈아끼우면 공정율·달성률·상태가 낡은 채
 * 남는다 — 화면이 "조용히 틀린 숫자"를 보여주는 쪽이 안 바뀌는 쪽보다 나쁘다.
 */
export function applyWbsChange(
  tree: readonly ComputedItem[],
  payload: WbsChangePayload,
  opts: { today: string; holidays: Set<string> },
): ComputedItem[] | null {
  const target = findNode(tree, payload.id)
  if (target === null) return null

  const held = target.updatedAt != null ? Date.parse(target.updatedAt) : Number.NaN
  const incoming = Date.parse(payload.updatedAt)
  // 보유 값이 없거나 읽을 수 없으면 비교 기준이 없는 것이다 — 그때는 받아들인다(선택 필드 주석 참조).
  if (!Number.isNaN(held) && !Number.isNaN(incoming) && incoming <= held) return null

  const replaced = replaceNode(tree, payload)
  if (replaced === null) return null
  return replaced.map(n => computeNode(n, opts.today, opts.holidays))
}
