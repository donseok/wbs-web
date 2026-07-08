import { diffDaysCal } from './dashboard'
import { TEAMS, collectLeaves, primaryTeamOf } from './tree'
import type { ComputedItem, TeamCode } from './types'

/** 셀 상태 — 색·질감·글리프 3채널로 인코딩된다. 우선순위: unassigned > done > delayed > upcoming > inProgress. */
export type CellState = 'unassigned' | 'done' | 'delayed' | 'upcoming' | 'inProgress' | 'empty'

export interface BottleneckCell {
  phaseId: string
  team: TeamCode
  state: CellState
  /** 이 셀(단계×팀)에 배정된 리프 수. 미배정 리프는 여기 세지 않는다. */
  count: number
  /** 이 단계에서 담당팀이 없는 리프 수. state === 'unassigned'인 셀에만 0이 아니다. */
  unassigned: number
  /** 셀 리프들의 단순 평균 실적(%). 가중 아님 — 게이지와 비교하지 말 것. */
  avgProgress: number
  /** 가장 급한 미완료 리프의 D-day. 없으면 null. */
  dday: number | null
}

export interface BottleneckPhase { id: string; name: string }

export interface BottleneckModel {
  phases: BottleneckPhase[]
  teams: TeamCode[]
  cells: BottleneckCell[]
  /** 담당팀이 없는 리프의 총수 (모든 단계 합) */
  unassignedCount: number
  worst: BottleneckCell | null
}

const STATE_RANK: Record<CellState, number> = {
  unassigned: 0, delayed: 1, upcoming: 2, inProgress: 3, done: 4, empty: 5,
}

/** 조치할 대상이 없는 상태. worst 후보에서 제외한다 — 완료 셀도 빈 셀도 사람을 부르지 않는다. */
const INERT: ReadonlySet<CellState> = new Set<CellState>(['done', 'empty'])

function cellState(leaves: ComputedItem[], unassigned: number): CellState {
  if (unassigned > 0) return 'unassigned'
  if (leaves.length === 0) return 'empty'
  if (leaves.every(l => l.status === 'done')) return 'done'
  if (leaves.some(l => l.status === 'delayed')) return 'delayed'
  if (leaves.every(l => l.status === 'not_started')) return 'upcoming'
  return 'inProgress'
}

/**
 * 미배정 리프를 실을 열을 고른다.
 *
 * 미배정 리프에는 팀 신호가 없다 — owners가 비었으니 어느 열인지 말해 주는 데이터가 아예 없다.
 * 그러니 이건 도메인 판정이 아니라 순수한 표시 규칙이고, 그렇게 취급해야 한다:
 * 그 단계에서 배정 리프가 가장 적은 열(동률이면 TEAMS 순서상 첫 열)에 싣는다.
 * 빈 열이 하나라도 있으면 언제나 그 열이 뽑히므로, 실제 팀 상태를 'unassigned'로 덮어쓰는 일이 최소화된다.
 *
 * 이 선택은 불변식과 무관하다: 미배정은 count에 절대 더하지 않고 unassignedCount로만 센다.
 * 따라서 어느 열을 고르든 Σcount + unassignedCount === 전체 리프 수는 유지된다.
 */
function unassignedColumnFor(sizeOf: (t: TeamCode) => number): TeamCode {
  return TEAMS.reduce((best, t) => (sizeOf(t) < sizeOf(best) ? t : best), TEAMS[0])
}

export function buildBottleneck(roots: ComputedItem[], today: string): BottleneckModel {
  const phases: BottleneckPhase[] = roots.map(p => ({ id: p.id, name: p.name }))
  const cells: BottleneckCell[] = []
  let unassignedCount = 0

  for (const phase of roots) {
    // 자식 없는 Phase면 collectLeaves가 자기 자신을 돌려준다. collectLeaves(roots)의 셈법과 같으므로 불변식은 유지된다.
    const leaves = collectLeaves([phase])
    const byTeam = new Map<TeamCode, ComputedItem[]>(TEAMS.map(t => [t, []]))
    let unassignedHere = 0
    for (const l of leaves) {
      const team = primaryTeamOf(l)   // 팀은 분할(partition) — 리프 하나는 정확히 한 셀에만 들어간다
      if (team === null) unassignedHere++
      else byTeam.get(team)!.push(l)
    }
    unassignedCount += unassignedHere

    // 미배정은 단계마다 한 셀에만 싣는다 — 그래야 Σcount + unassignedCount 가 리프 수와 같다.
    const column = unassignedColumnFor(t => byTeam.get(t)!.length)

    for (const team of TEAMS) {
      const mine = byTeam.get(team)!
      const unassigned = team === column ? unassignedHere : 0
      const open = mine.filter(l => l.status !== 'done' && l.plannedEnd != null)
      // 스프레드 인자 수 = 한 셀의 미완료 리프 수. 프로젝트 전체가 100여 개라 엔진 한계(~65k)와 무관.
      const dday = open.length === 0 ? null
        : Math.min(...open.map(l => diffDaysCal(today, l.plannedEnd!)))
      cells.push({
        phaseId: phase.id, team,
        state: cellState(mine, unassigned),
        count: mine.length,
        unassigned,
        avgProgress: mine.length === 0 ? 0
          : Math.round(mine.reduce((s, l) => s + l.rolledActualPct, 0) / mine.length),
        dday,
      })
    }
  }

  // 가장 나쁜 = 가장 먼저 손대야 할 셀. 동률이면 앞선 셀(위쪽 단계, 왼쪽 팀)이 이긴다.
  const worst = cells.reduce<BottleneckCell | null>(
    (best, c) =>
      INERT.has(c.state) ? best
      : best === null || STATE_RANK[c.state] < STATE_RANK[best.state] ? c
      : best,
    null,
  )
  return { phases, teams: TEAMS, cells, unassignedCount, worst }
}
