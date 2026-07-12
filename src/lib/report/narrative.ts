import type { AnnouncementRow, WeeklyReportModel, WeeklyTaskRow, PhasePlanActual } from './weekly'

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

/** 작업명 끝의 '(X 주관)'·'(X주관)' 꼬리표 제거 — 담당이 그룹 헤더로 표기되는 PPT에서는 중복.
 *  이름 중간의 괄호("검토(인터뷰, 공청회, 진단)")는 건드리지 않는다. 꼬리표뿐인 이름은 원문 유지. */
function stripOwnerSuffix(name: string): string {
  return name.replace(/(?:\s*\([^()]*주관\))+\s*$/, '') || name
}

/** Phase 내 작업들을 담당별 하위 그룹으로 — '- 담당' 헤더 아래 '. 작업명' 줄(subLineText의 4칸/8칸 규칙).
 *  같은 담당이 여러 작업을 맡아도 담당은 헤더 한 줄로만 표기(줄마다 '· 담당' 반복 방지).
 *  담당 순서는 Phase 내 첫 등장 순. 상태(완료/진행중/지연)·진행률(%)은 표시하지 않음.
 *  담당 미지정('-') 작업은 헤더 없이 '- 작업명' 그대로 둔다. */
function ownerGroupedItems(rows: WeeklyTaskRow[]): string[] {
  const byOwner = new Map<string, WeeklyTaskRow[]>()
  for (const r of rows) {
    if (!byOwner.has(r.ownerText)) byOwner.set(r.ownerText, [])
    byOwner.get(r.ownerText)!.push(r)
  }
  const items: string[] = []
  for (const [owner, tasks] of byOwner) {
    if (owner === '-') {
      items.push(...tasks.map(t => stripOwnerSuffix(t.name)))
    } else {
      items.push(`- ${owner}`, ...tasks.map(t => `. ${stripOwnerSuffix(t.name)}`))
    }
  }
  return items
}

/** Phase 이름의 선행 번호 표기("1. ", "1-1.", "2)") 제거 — PPT 헤드라인은 불릿만 쓴다.
 *  구분자(./)) 없는 숫자 시작("2026년 계획")은 번호가 아니므로 보존. */
export function stripPhaseNumber(name: string): string {
  return name.replace(/^\d+(?:[.-]\d+)*\s*[.)]\s*/, '') || name
}

/** planActual에서 지정 컬럼(prevWeek|thisWeek)을 Phase 그룹으로. 빈 Phase 제외.
 *  num은 planActual(=WBS 최상위) 순서 기반 → 전주·금주에서 같은 Phase면 같은 번호. */
function groupsOf(planActual: PhasePlanActual[], key: 'prevWeek' | 'thisWeek'): NarrativeGroup[] {
  return planActual
    .map((p, i) => ({ phase: stripPhaseNumber(p.phaseName), num: i + 1, items: ownerGroupedItems(p[key]) }))
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
