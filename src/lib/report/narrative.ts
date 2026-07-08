import type { AnnouncementRow, WeeklyReportModel, WeeklyTaskRow, PhasePlanActual } from './weekly'
import { statusKr } from './weekly'

/* ============================================================================
 * 주간보고 서술형 변환 — WeeklyReportModel(공유 모델) → PPT 전용 문구.
 * 순수 함수: 입력이 같으면 출력도 같다(부수효과·I/O 없음).
 * ========================================================================== */

export interface NarrativeGroup {
  phase: string
  num: number              // Phase 번호(WBS 최상위 순서) — 전주·금주 동일 Phase는 같은 값
  items: string[]
}
export interface NarrativeModel {
  prev: NarrativeGroup[]   // 전주 주요활동 (Phase별)
  curr: NarrativeGroup[]   // 금주 주요활동 (Phase별)
  issues: string[]         // 이슈사항
  events: string[]         // 주요 이벤트(금주·차주 회의)
}

/** 비분리 공백(U+00A0) — 메타가 줄바꿈으로 쪼개지지 않게 묶는 데 사용. */
const NB = String.fromCharCode(0xa0)

/** 담당·상태 메타 → '· 담당 · 상태'. 진행률(%)은 표시하지 않음. 내부는 전부 NB로 묶어 한 덩어리로만 줄바꿈. */
function taskMeta(r: WeeklyTaskRow): string {
  const owner = r.ownerText.replace(/ /g, NB) // '(가공 주관)' 같은 담당 표기도 통째로 유지
  return `·${NB}${owner}${NB}·${NB}${statusKr(r.status)}`
}

/** 작업 1건 → '작업명 · 담당 · 상태'. 작업명과 메타 사이만 일반 공백(줄바꿈 지점). */
function taskLine(r: WeeklyTaskRow): string {
  return `${r.name} ${taskMeta(r)}`
}

/** planActual에서 지정 컬럼(prevWeek|thisWeek)을 Phase 그룹으로. 빈 Phase 제외.
 *  num은 planActual(=WBS 최상위) 순서 기반 → 전주·금주에서 같은 Phase면 같은 번호. */
function groupsOf(planActual: PhasePlanActual[], key: 'prevWeek' | 'thisWeek'): NarrativeGroup[] {
  return planActual
    .map((p, i) => ({ phase: p.phaseName, num: i + 1, items: p[key].map(taskLine) }))
    .filter(g => g.items.length > 0)
}

/** 해당 주차 공지 → '주요 공지' 그룹 1개. 없으면 빈 배열(그룹 자체를 생략).
 *  num은 WBS Phase 다음 번호 — 전주·금주 모두 같은 값. */
function announceGroup(rows: AnnouncementRow[], num: number): NarrativeGroup[] {
  return rows.length ? [{ phase: '주요 공지', num, items: rows.map(r => r.title) }] : []
}

/** 주간 모델 → PPT 서술형 변환(순수·결정적). */
export function buildWeeklyNarrative(model: WeeklyReportModel): NarrativeModel {
  const annNum = model.planActual.length + 1
  const prev = [...groupsOf(model.planActual, 'prevWeek'), ...announceGroup(model.announcements.prevWeek, annNum)]
  const curr = [...groupsOf(model.planActual, 'thisWeek'), ...announceGroup(model.announcements.thisWeek, annNum)]
  const issues = model.issues.map(i => i.content)
  const events = [...model.meetings.thisWeek, ...model.meetings.nextWeek].map(mtg =>
    `${mtg.date} ${mtg.title}${mtg.location && mtg.location !== '-' ? ` (${mtg.location})` : ''}`,
  )
  return { prev, curr, issues, events }
}
