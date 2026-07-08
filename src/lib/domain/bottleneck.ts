import { diffDaysCal } from './dashboard'
import { TEAMS, collectLeaves, primaryTeamOf } from './tree'
import type { ComputedItem, TeamCode } from './types'

/** 셀 상태 — 색·질감·글리프 3채널로 인코딩된다. 우선순위: delayed > upcoming > inProgress > done > empty. */
export type CellState = 'done' | 'delayed' | 'upcoming' | 'inProgress' | 'empty'

export interface BottleneckCell {
  phaseId: string
  team: TeamCode
  state: CellState
  /** 이 셀(단계×팀)에 배정된 리프 수. */
  count: number
  /** 셀 리프들의 단순 평균 실적(%). 가중 아님 — 게이지와 비교하지 말 것. */
  avgProgress: number
  /** 가장 급한 미완료 리프의 D-day. 없으면 null. */
  dday: number | null
}

export interface BottleneckPhase {
  id: string
  name: string
  /** 이 단계에서 담당팀이 없는 리프 수. 어느 팀 열에도 속하지 않는다 — 팀 신호가 아예 없기 때문. */
  unassigned: number
}

export interface BottleneckModel {
  phases: BottleneckPhase[]
  teams: TeamCode[]
  cells: BottleneckCell[]
  /** 담당팀이 없는 리프의 총수. 항상 Σ phases[].unassigned 와 같다. */
  unassignedCount: number
  worst: BottleneckCell | null
}

const STATE_RANK: Record<CellState, number> = {
  delayed: 0, upcoming: 1, inProgress: 2, done: 3, empty: 4,
}

/** 조치할 대상이 없는 상태. worst 후보에서 제외한다 — 완료 셀도 빈 셀도 사람을 부르지 않는다. */
const INERT: ReadonlySet<CellState> = new Set<CellState>(['done', 'empty'])

function cellState(leaves: ComputedItem[]): CellState {
  if (leaves.length === 0) return 'empty'
  if (leaves.every(l => l.status === 'done')) return 'done'
  if (leaves.some(l => l.status === 'delayed')) return 'delayed'
  if (leaves.every(l => l.status === 'not_started')) return 'upcoming'
  return 'inProgress'
}

/**
 * 단계×팀 격자. 셀은 상태(state)를 말하지 크기를 말하지 않는다.
 *
 * 미배정 리프는 어떤 셀에도 들어가지 않는다. owners가 비어 있으면 팀 신호가 아예 없으므로
 * 어느 열에 놓든 그건 우리가 지어낸 값이다. 대신 단계에 귀속시킨다(phases[].unassigned).
 * 덕분에 어떤 셀의 state도 미배정 때문에 오염되지 않는다.
 *
 * 불변식: Σ cells[].count + Σ phases[].unassigned === collectLeaves(roots).length
 * 리프의 팀은 분할(partition)이다 — primaryTeamOf로 리프당 정확히 한 팀만 고른다.
 * (DB는 리프당 여러 담당팀을 허용하므로, 담당자별로 세면 중복 계상돼 불변식이 깨진다.)
 */
export function buildBottleneck(roots: ComputedItem[], today: string): BottleneckModel {
  const phases: BottleneckPhase[] = []
  const cells: BottleneckCell[] = []

  for (const phase of roots) {
    // 자식 없는 Phase면 collectLeaves가 자기 자신을 돌려준다. collectLeaves(roots)의 셈법과 같으므로 불변식은 유지된다.
    const leaves = collectLeaves([phase])
    const byTeam = new Map<TeamCode, ComputedItem[]>(TEAMS.map(t => [t, []]))
    let unassigned = 0
    for (const l of leaves) {
      const team = primaryTeamOf(l)
      if (team === null) unassigned++
      else byTeam.get(team)!.push(l)
    }
    phases.push({ id: phase.id, name: phase.name, unassigned })

    for (const team of TEAMS) {
      const mine = byTeam.get(team)!
      const open = mine.filter(l => l.status !== 'done' && l.plannedEnd != null)
      // 스프레드 인자 수 = 한 셀의 미완료 리프 수. 프로젝트 전체가 100여 개라 엔진 한계(~65k)와 무관.
      const dday = open.length === 0 ? null
        : Math.min(...open.map(l => diffDaysCal(today, l.plannedEnd!)))
      cells.push({
        phaseId: phase.id, team,
        state: cellState(mine),
        count: mine.length,
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
  return {
    phases,
    teams: [...TEAMS],   // 도메인 단일 출처를 참조로 넘기지 않는다
    cells,
    unassignedCount: phases.reduce((s, p) => s + p.unassigned, 0),
    worst,
  }
}
