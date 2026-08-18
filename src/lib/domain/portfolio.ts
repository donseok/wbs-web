import type { ComputedItem, TeamCode } from './types'
import {
  addDaysCal, buildExecSummary, milestoneTimeline,
  type ExecSummary, type HygieneModel, type Signal, type MilestonePoint,
} from './dashboard'
import { projectLifecycleStatus, type ProjectLifecycleStatus } from './project-status'
import { collectLeaves } from './tree'
import { round1 } from './format'
import { detectRiskSignals, type RiskSeverity } from './riskSignals'
import type { SnapshotPoint } from './trend'

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
  /** 최근 진척 스냅샷(추세 화살표·지연 추세 신호용). 실패 시 빈 배열 — 화살표가 비표기될 뿐 합성되지 않는다. */
  snapshots: SnapshotPoint[]
  /** 활성 팀 코드(팀 마스터 주입) — 담당 과부하 신호용. */
  teams: readonly TeamCode[]
  /** 실제 오늘(seoulToday) — 위험 신호 엔진의 realToday 계약(base_date 왜곡 차단). */
  realToday: string
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
  /** WBS 항목이 0건인 정상 조회 행 — degraded(조회 실패)와 구분한다. exec/spi 는 null. */
  noWbs: boolean
  exec: ExecSummary | null
  /** SPI(actual/planned, 소수 2자리) — scheduleModel 과 동일 정의. 조기·미산정 구간은 null. */
  spi: number | null
  leaders: string[]
  /** 지난주(≥7일 전 최신 스냅샷) 대비 편차 변화(%p, round1). 표본 없으면 null — 합성 금지. */
  trendDelta: number | null
  /** WBS 기반 위험 신호(riskSignals 4종 — 회의 액션 신호는 포트폴리오에서 의도적 제외). */
  riskCount: number
  riskWorst: RiskSeverity | null
  riskTitles: string[]
  hygiene: HygieneModel | null
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

/** 신호 심각도. degraded 는 -1(최상단) — 실패를 목록 아래 묻으면 아무도 못 본다.
 *  noWbs(WBS 0건)는 정상 조회이므로 neutral 과 동급(3) — 실패 취급하지 않는다. */
const SIGNAL_RANK: Record<Signal, number> = { red: 0, amber: 1, green: 2, neutral: 3 }
const rankOf = (r: PortfolioRow) => (r.degraded ? -1 : r.noWbs ? SIGNAL_RANK.neutral : SIGNAL_RANK[r.exec!.overall.signal])

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
    // 지표가 없는 행(degraded·noWbs)의 확장 필드 공통값 — 지표 위장 금지.
    const noMetrics = { trendDelta: null, riskCount: 0, riskWorst: null, riskTitles: [], hygiene: null }
    if (input.items === null) {
      return { ...base, lifecycle: 'unknown' as const, degraded: true, noWbs: false, exec: null, spi: null, ...noMetrics }
    }
    const leaves = collectLeaves(input.items)
    if (leaves.length === 0) {
      // 조회는 성공했으나 WBS 가 비었다 — degraded(실패) 가 아니라 neutral '—' 로 표시한다(I-1).
      const lifecycle = projectLifecycleStatus(input.startDate, input.endDate, input.today, { hasWbs: false, allDone: false })
      return { ...base, lifecycle, degraded: false, noWbs: true, exec: null, spi: null, ...noMetrics }
    }
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

    // 위험 신호 — WBS 기반 탐지기만. 회의 액션 신호(minute_insights)는 프로젝트별 추가 조회가
    // 필요해 포트폴리오에서는 의도적으로 제외한다(빈 배열 = 그 탐지기만 미발화, 위장 아님).
    const risk = detectRiskSignals({
      items: input.items, today: input.today, realToday: input.realToday,
      snapshots: input.snapshots, startDate: input.startDate, endDate: input.endDate,
      minuteSignals: [], teams: input.teams,
    })
    const riskWorst: RiskSeverity | null =
      risk.signals.some(s => s.severity === 'red') ? 'red' : risk.signals.length ? 'amber' : null

    // 추세 화살표 — 7일 이상 전 표본 중 최신 스냅샷의 편차와 현재 편차의 차(round1 규약).
    const past = [...input.snapshots]
      .filter(s => s.date <= addDaysCal(input.today, -7))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .pop()
    const trendDelta = past == null ? null : round1(exec.progress.variance - round1(past.actual - past.planned))

    return {
      ...base, lifecycle, degraded: false, noWbs: false, exec, spi,
      trendDelta, riskCount: risk.signals.length, riskWorst,
      riskTitles: risk.signals.map(s => s.title), hygiene: risk.hygiene,
    }
  })

  rows.sort((a, b) =>
    GROUP_RANK[a.lifecycle] - GROUP_RANK[b.lifecycle]
    || rankOf(a) - rankOf(b)
    || (a.exec?.progress.variance ?? 0) - (b.exec?.progress.variance ?? 0)
    || a.name.localeCompare(b.name, 'ko'),
  )

  const ok = rows.filter(r => !r.degraded && !r.noWbs)
  const countSignal = (s: Signal) => ok.filter(r => r.exec!.overall.signal === s).length
  const noWbsCount = rows.filter(r => r.noWbs).length
  const totals = {
    count: rows.length,
    red: countSignal('red'), amber: countSignal('amber'),
    green: countSignal('green'), neutral: countSignal('neutral') + noWbsCount,
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
