import { mdDow, NO_ISSUE_TEXT, type WeeklyReportModel, type WeeklyTaskRow, type PhasePlanActual } from './weekly'

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
  events: string[]         // 주요 이벤트(금주·차주 회의 + 전주·금주 공지 '[공지]' 표기)
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

const DAY_MS = 86_400_000
const diffDaysIso = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)

/** 정렬된 ISO 날짜들 → 'M/D(요일)' 나열. 연속 구간은 '~'로 접고, 떨어진 날짜는 '·'로 잇는다.
 *  예: [7/13, 7/14, 7/17] → '7/13(월)~7/14(화)·7/17(금)'. */
function dateRangeText(sortedIsos: string[]): string {
  const runs: string[][] = []
  for (const iso of sortedIsos) {
    const last = runs.at(-1)
    if (last && diffDaysIso(last.at(-1)!, iso) === 1) last.push(iso)
    else runs.push([iso])
  }
  return runs.map(r => (r.length > 1 ? `${mdDow(r[0])}~${mdDow(r.at(-1)!)}` : mdDow(r[0]))).join('·')
}

/** 금주·차주 회의를 (제목, 장소) 단위로 병합해 한 줄씩 — 같은 회의의 반복 회차가 날짜만 바꿔
 *  줄줄이 나열되던 것('외 16건'의 주범)을 날짜 구간 한 줄로 접는다. 줄 순서는 첫 등장 순. */
function mergedMeetingLines(rows: { title: string; location: string; dateIso: string }[]): string[] {
  const byKey = new Map<string, { title: string; location: string; dates: string[] }>()
  for (const m of rows) {
    const key = `${m.title}|${m.location}`
    const e = byKey.get(key)
    if (e) { if (!e.dates.includes(m.dateIso)) e.dates.push(m.dateIso) }
    else byKey.set(key, { title: m.title, location: m.location, dates: [m.dateIso] })
  }
  return [...byKey.values()].map(m => {
    // 제목에 장소가 이미 들어 있으면 중복 표기하지 않는다 — "MES 품질회의 (부산공장) (부산공장)" 방지.
    const loc = m.location && m.location !== '-' && !m.title.includes(m.location) ? ` (${m.location})` : ''
    return `${dateRangeText([...m.dates].sort())} ${m.title}${loc}`
  })
}

/** 주간 모델 → PPT 서술형 변환(순수·결정적).
 *  주요 공지는 주요활동이 아니라 이슈사항·주요이벤트 영역(이벤트 목록)에 '[공지]'로 싣는다(사용자 결정). */
export function buildWeeklyNarrative(model: WeeklyReportModel): NarrativeModel {
  const prev = groupsOf(model.planActual, 'prevWeek')
  const curr = groupsOf(model.planActual, 'thisWeek')
  // 이슈 0건 대체 문구는 PPT에 싣지 않는다 — 이슈 셀은 빈칸으로(사용자 요청: 따로 작성 금지).
  const issues = model.issues.filter(i => i.content !== NO_ISSUE_TEXT).map(i => i.content)
  const events = [
    ...mergedMeetingLines([...model.meetings.thisWeek, ...model.meetings.nextWeek]),
    // 공지는 게시일 기준 전주→금주 순으로 회의 뒤에 — 회의와 같은 'M/D(요일)' 날짜 표기.
    ...[...model.announcements.prevWeek, ...model.announcements.thisWeek].map(a =>
      `${mdDow(a.date)} [공지] ${a.title}`,
    ),
  ]
  return { prev, curr, issues, events }
}
