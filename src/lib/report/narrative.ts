import type { WeeklyReportModel, WeeklyTaskRow, PhasePlanActual } from './weekly'
import { statusKr } from './weekly'

/* ============================================================================
 * 주간보고 서술형 변환 — WeeklyReportModel(공유 모델) → PPT 전용 문구.
 * 순수 함수: 입력이 같으면 출력도 같다(부수효과·I/O 없음).
 * ========================================================================== */

export interface NarrativeGroup {
  phase: string
  items: string[]
}
export interface NarrativeModel {
  prev: NarrativeGroup[]   // 전주 주요활동 (Phase별)
  curr: NarrativeGroup[]   // 금주 주요활동 (Phase별)
  issues: string[]         // 이슈사항
  events: string[]         // 주요 이벤트(금주·차주 회의)
}

/** 작업 1건 → '작업명 · 담당 · 상태 NN%'. */
function taskLine(r: WeeklyTaskRow): string {
  return `${r.name} · ${r.ownerText} · ${statusKr(r.status)} ${r.actualPct}%`
}

/** planActual에서 지정 컬럼(prevWeek|thisWeek)을 Phase 그룹으로. 빈 Phase 제외. */
function groupsOf(planActual: PhasePlanActual[], key: 'prevWeek' | 'thisWeek'): NarrativeGroup[] {
  return planActual
    .map(p => ({ phase: p.phaseName, items: p[key].map(taskLine) }))
    .filter(g => g.items.length > 0)
}

/** 주간 모델 → PPT 서술형 변환(순수·결정적). */
export function buildWeeklyNarrative(model: WeeklyReportModel): NarrativeModel {
  const prev = groupsOf(model.planActual, 'prevWeek')
  const curr = groupsOf(model.planActual, 'thisWeek')
  const issues = model.issues.map(i => i.content)
  const events = [...model.meetings.thisWeek, ...model.meetings.nextWeek].map(mtg =>
    `${mtg.date} ${mtg.title}${mtg.location && mtg.location !== '-' ? ` (${mtg.location})` : ''}`,
  )
  return { prev, curr, issues, events }
}
