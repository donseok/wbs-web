import type { ComputedItem, OwnerKind, Status, TeamCode } from '@/lib/domain/types'
import { teamProgress } from '@/lib/domain/dashboard'
import { overallProgress } from '@/lib/domain/rollup'
import { round1 } from '@/lib/domain/format'

/** 현황 보고서의 모든 파생값을 담은 직렬화 가능한 모델.
 *  화면(ReportModal)·Excel·PPT가 이 단일 모델을 공유한다 → 수치·집계·정렬·필터는 항상 동일.
 *  (날짜 표기 등 표현 형식은 각 출력 매체에 맞게 다를 수 있다: 화면은 2자리 연도, 내보내기는 4자리.) */
export interface ReportModel {
  meta: {
    projectName: string
    description: string | null
    today: string
    startDate: string | null
    endDate: string | null
    totalLeaves: number
  }
  kpi: {
    actual: number
    planned: number
    variance: number
    delayedCount: number
  }
  phases: ReportPhase[]
  delayed: ReportDelayed[]
  teams: ReportTeam[]
}

export interface ReportPhase {
  name: string
  plannedPct: number
  actualPct: number
  variance: number
  status: Status
}
export interface ReportDelayed {
  name: string
  owners: { team: TeamCode; kind: OwnerKind }[]
  plannedEnd: string | null
  actualPct: number
}
export interface ReportTeam {
  team: TeamCode
  count: number
  pct: number | null
}

/** 리프(자식 없는 항목) 수집 — components/wbs/shared의 collectLeaves와 동일 동작.
 *  lib 계층 자급을 위해 인라인(컴포넌트 계층 의존 회피). */
function leavesOf(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      if (!n.children.length) out.push(n)
      walk(n.children)
    })
  walk(items)
  return out
}

export interface ReportProject {
  name: string
  description?: string | null
  start_date?: string | null
  end_date?: string | null
}

export function buildReportModel(
  items: ComputedItem[],
  project: ReportProject,
  today: string,
  /** '팀별 진척' 대상(progress_visible 활성 팀) — 미주입 시 기본(PROGRESS_TEAMS). */
  progressTeams?: readonly TeamCode[],
): ReportModel {
  const roots = items
  // 대시보드/모달과 동일한 가중 롤업(단일 출처). 전체 실적/계획은 대시보드와 같은 소수 1자리 표기,
  // Phase·지연 목록 등 나머지 표는 기존 정수 표기 유지.
  const overall = overallProgress(roots)
  const actual = overall.actual
  const planned = overall.planned

  const leaves = leavesOf(items)
  const delayedLeaves = leaves
    .filter(l => l.status === 'delayed')
    .sort((a, b) => (a.plannedEnd ?? '').localeCompare(b.plannedEnd ?? ''))

  const phases: ReportPhase[] = roots.map(p => ({
    name: p.name,
    plannedPct: Math.round(p.plannedPct),
    actualPct: Math.round(p.rolledActualPct),
    variance: Math.round(p.rolledActualPct) - Math.round(p.plannedPct),
    status: p.status,
  }))

  const delayed: ReportDelayed[] = delayedLeaves.map(l => ({
    name: l.name,
    owners: l.owners,
    plannedEnd: l.plannedEnd,
    actualPct: Math.round(l.rolledActualPct),
  }))

  // 팀별 진척 — 대시보드 '팀별 진척' 카드와 동일 정의(teamProgress 단일 출처)
  const teams: ReportTeam[] = progressTeams ? teamProgress(leaves, progressTeams) : teamProgress(leaves)

  return {
    meta: {
      projectName: project.name,
      description: project.description ?? null,
      today,
      startDate: project.start_date ?? null,
      endDate: project.end_date ?? null,
      totalLeaves: leaves.length,
    },
    kpi: {
      actual,
      planned,
      variance: round1(actual - planned), // 부동소수 잔차(7.3-8.1=-0.799…) 방지
      delayedCount: delayedLeaves.length,
    },
    phases,
    delayed,
    teams,
  }
}
