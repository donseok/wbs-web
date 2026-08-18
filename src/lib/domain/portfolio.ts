import type { ComputedItem } from './types'
import {
  buildExecSummary, milestoneTimeline,
  type ExecSummary, type Signal, type MilestonePoint,
} from './dashboard'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from './project-status'
import { collectLeaves } from './tree'

/** 포트폴리오 집계 입력 — 데이터 계층이 프로젝트별로 채워 넘긴다(순수 함수 유지). */
export interface PortfolioProjectInput {
  projectId: string
  name: string
  isPrivate: boolean
  startDate: string | null
  endDate: string | null
  baseDate: string | null
  /** getComputedWbs 가 반환한 기준일(base_date 우선) — 프로젝트마다 다를 수 있다. */
  today: string
  /** null = WBS/설정 조회 실패. '데이터 없음'(빈 배열)과 반드시 구분한다(3원칙). */
  items: ComputedItem[] | null
  milestoneKeywords: readonly string[]
  leaders: string[]
}

export interface PortfolioRow {
  projectId: string
  name: string
  isPrivate: boolean
  startDate: string | null
  endDate: string | null
  baseDate: string | null
  today: string
  lifecycle: ProjectLifecycleStatus
  degraded: boolean
  exec: ExecSummary | null
  /** SPI(actual/planned, 소수 2자리) — scheduleModel 과 동일 정의. 조기·미산정 구간은 null. */
  spi: number | null
  leaders: string[]
}

export type PortfolioMilestone = MilestonePoint & { projectId: string; projectName: string }

export interface PortfolioModel {
  rows: PortfolioRow[]
  totals: {
    count: number
    red: number; amber: number; green: number; neutral: number   // 정상 행의 overall 신호 분포
    overdue: number                                              // lifecycle === 'overdue'
    degraded: number                                             // 조회 실패 행
  }
  milestones: PortfolioMilestone[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** 신호 심각도. degraded 는 -1(최상단) — 실패를 목록 아래 묻으면 아무도 못 본다. */
const SIGNAL_RANK: Record<Signal, number> = { red: 0, amber: 1, green: 2, neutral: 3 }
const rankOf = (r: PortfolioRow) => (r.degraded ? -1 : SIGNAL_RANK[r.exec!.overall.signal])

/** 생애 그룹 — 진행 중(+지연 종료·확인 불가)이 위, 준비는 다음, 완료는 마지막. */
const GROUP_RANK: Record<ProjectLifecycleStatus, number> = {
  active: 0, overdue: 0, unknown: 0, ready: 1, done: 2,
}

export function buildPortfolio(inputs: PortfolioProjectInput[]): PortfolioModel {
  const rows: PortfolioRow[] = inputs.map(input => {
    const base = {
      projectId: input.projectId, name: input.name, isPrivate: input.isPrivate,
      startDate: input.startDate, endDate: input.endDate,
      baseDate: input.baseDate, today: input.today, leaders: input.leaders,
    }
    if (input.items === null) {
      return { ...base, lifecycle: 'unknown' as const, degraded: true, exec: null, spi: null }
    }
    const leaves = collectLeaves(input.items)
    // done 판정은 리프 status(원시값 >=100 규약) — computeCompletionMap 과 동일 결론
    const completion = {
      hasWbs: leaves.length > 0,
      allDone: leaves.length > 0 && leaves.every(l => l.status === 'done'),
    }
    const lifecycle = projectLifecycleStatus(input.startDate, input.endDate, input.today, completion)
    const exec = buildExecSummary(
      input.items,
      { startDate: input.startDate, endDate: input.endDate, today: input.today },
      input.milestoneKeywords,
    )
    const spi = exec.schedule.label === 'onTrack' ? round2(exec.progress.actual / exec.progress.planned) : null
    return { ...base, lifecycle, degraded: false, exec, spi }
  })

  rows.sort((a, b) =>
    GROUP_RANK[a.lifecycle] - GROUP_RANK[b.lifecycle]
    || rankOf(a) - rankOf(b)
    || (a.exec?.progress.variance ?? 0) - (b.exec?.progress.variance ?? 0)
    || a.name.localeCompare(b.name, 'ko'),
  )

  const ok = rows.filter(r => !r.degraded)
  const countSignal = (s: Signal) => ok.filter(r => r.exec!.overall.signal === s).length
  const totals = {
    count: rows.length,
    red: countSignal('red'), amber: countSignal('amber'),
    green: countSignal('green'), neutral: countSignal('neutral'),
    overdue: rows.filter(r => r.lifecycle === 'overdue').length,
    degraded: rows.filter(r => r.degraded).length,
  }

  const milestones: PortfolioMilestone[] = inputs
    .filter(i => i.items !== null)
    .flatMap(i =>
      milestoneTimeline(i.items!, i.today, i.milestoneKeywords)
        .map(p => ({ ...p, projectId: i.projectId, projectName: i.name })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return { rows, totals, milestones }
}
