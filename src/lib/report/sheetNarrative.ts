import { WEEKLY_SECTIONS, type WeeklySheetRow } from '@/lib/domain/weeklySheet'

/* ============================================================================
 * 주간업무 시트 → PPT 변환(순수). 스펙 §6.
 * 시트는 구분(업무영역)당 한 페이지로 나가며, 각 페이지에 그 구분의
 * 금주실적·차주계획·이슈사항·주요이벤트 4셀을 함께 싣는다.
 * ========================================================================== */

/** 시트 셀 줄 → PPT 들여쓰기. 작성자가 쓴 마커를 그대로 두고 깊이만 부여(subLineText와 별개). */
export function sheetLineText(line: string): string {
  const t = line.trimStart()
  if (t.startsWith('.')) return `            ${t}` // 12칸 — 3단계
  if (t.startsWith('-')) return `        ${t}`     // 8칸 — 2단계
  return `    ${t}`                                 // 4칸 — 1단계(숫자·일반)
}

/** 셀 텍스트 → 줄 배열. 문단 구분(빈 줄)은 존중하되 연속 빈 줄은 1개로, 앞뒤 빈 줄은 제거. */
export function cellLines(text: string): string[] {
  const lines = text.split('\n').map(l => l.replace(/\s+$/, ''))
  const out: string[] = []
  for (const l of lines) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(l.trim() === '' ? '' : l)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

const REPORT_CELL_LINE_BUDGET = 10
const REPORT_FULLWIDTH_PER_LINE = 26

/** PPT 셀에서 차지할 대략적인 시각 줄수(12pt, 반쪽 셀 폭 기준). */
function reportLineCost(text: string): number {
  let width = 0
  for (const ch of text) width += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.5
  return Math.max(1, Math.ceil(width / REPORT_FULLWIDTH_PER_LINE))
}

const cleanReportLine = (line: string): string => line
  .trim()
  .replace(/^[•·●◦▪■–—-]+\s*/, '')
  .replace(/\s+/g, ' ')

/** 같은 날짜의 주요 이벤트를 한 항목으로 묶는다.
 *  예: "7/13(월) A", "7/13(월) B" -> "7/13(월) A · B" */
export function groupEventsByDate(lines: string[]): string[] {
  const groups: { date: string; details: string[] }[] = []
  const datePrefix = /^(\d{1,2}\/\d{1,2}(?:\([월화수목금토일]\))?(?:\s*[~～-]\s*\d{1,2}\/\d{1,2}(?:\([월화수목금토일]\))?)?)\s*(.*)$/
  for (const raw of lines) {
    const line = cleanReportLine(raw)
    if (!line) continue
    const match = line.match(datePrefix)
    const date = match?.[1] ?? ''
    const detail = (match?.[2] || line).trim()
    const group = groups.find(g => g.date === date)
    if (group) {
      if (!group.details.includes(detail)) group.details.push(detail)
    } else {
      groups.push({ date, details: [detail] })
    }
  }
  return groups.map(({ date, details }) => {
    const visible = details.slice(0, 3).join(' · ')
    const rest = details.length > 3 ? ` · 외 ${details.length - 3}건` : ''
    return `${date ? `${date} ` : ''}${visible}${rest}`
  })
}

/** 이슈/이벤트 셀을 고정 높이 안에 맞춘다. 중복을 제거하고 긴 항목은 의미 단위로 축약하며,
 *  예산을 넘는 나머지는 마지막 줄의 '외 N건'으로 표시한다. */
export function compactReportLines(lines: string[], groupByDate = false): string[] {
  const cleaned = [...new Set(lines.map(cleanReportLine).filter(Boolean))]
  const source = groupByDate ? groupEventsByDate(cleaned) : cleaned
  const shortened = source.map(line => line.length > 72 ? `${line.slice(0, 69).trimEnd()}…` : line)
  const out: string[] = []
  let used = 0
  for (let i = 0; i < shortened.length; i += 1) {
    const cost = reportLineCost(shortened[i])
    const remaining = shortened.length - i - 1
    const summaryCost = remaining > 0 ? reportLineCost(`외 ${remaining + 1}건`) : 0
    if (used + cost + summaryCost > REPORT_CELL_LINE_BUDGET) {
      out.push(`외 ${shortened.length - i}건`)
      break
    }
    out.push(shortened[i])
    used += cost
  }
  return out
}

/** 행 라벨 — 구분 헤더로 쓴다.
 *  신규 시트는 구분명 단독('영업'), 레거시 행은 '구분 · 모듈'('ERP · SD/LE')로 병기,
 *  구분이 없으면 모듈로 폴백하고 둘 다 없으면 '기타'('[] '가 노출되지 않게). */
export const rowLabel = (r: WeeklySheetRow): string => {
  const sec = r.section.trim(), mod = r.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

/** 보고 순서상의 자리 — 시트 행 순서와 동일한 WEEKLY_SECTIONS가 단일 출처.
 *  행의 sort_order가 아니라 구분명으로 정렬하므로, 아직 정리되지 않은 레거시 시트를 내보내도
 *  PPT는 항상 정해진 순서로 나온다. 목록에 없는 구분(레거시·자유 입력)은 뒤로 밀되 서로는 sortOrder 순. */
const sectionRank = (r: WeeklySheetRow): number => {
  const i = (WEEKLY_SECTIONS as readonly string[]).indexOf(r.section.trim())
  return i < 0 ? WEEKLY_SECTIONS.length : i
}

const isStandard = (s: string): boolean => (WEEKLY_SECTIONS as readonly string[]).includes(s)

/** 한 구분(페이지)의 4셀 줄 묶음. items가 비면 그 셀은 헤더만/대체 문구로 렌더된다. */
export interface SheetSectionCells {
  section: string       // 구분명(콘텐츠 셀 헤더로 표기)
  thisContent: string[] // 금주실적
  nextContent: string[] // 차주계획
  thisIssue: string[]   // 이슈사항
  nextIssue: string[]   // 주요이벤트
}

/** 여러 행의 줄 묶음을 한 셀로 — 행 사이에 빈 줄 1개를 끼워 시각적으로 구분(빈 묶음은 건너뜀). */
function joinCells(parts: string[][]): string[] {
  const filled = parts.filter(p => p.length > 0)
  const out: string[] = []
  filled.forEach((p, i) => { if (i > 0) out.push(''); out.push(...p) })
  return out
}

/** 시트 rows → 구분별 4셀 묶음. 표준 10구분 전부(내용 없는 구분도)를 순서대로 포함하고,
 *  그 뒤에 비표준(레거시·자유 입력) 구분을 붙인다. 같은 구분에 여러 행이 있으면 sortOrder 순으로 이어붙인다. */
export function buildSheetSections(rows: WeeklySheetRow[]): SheetSectionCells[] {
  const sorted = [...rows].sort((a, b) => sectionRank(a) - sectionRank(b) || a.sortOrder - b.sortOrder)
  // 구분 키: 표준이면 구분명, 비표준이면 rowLabel(모듈 병기). 표준 10구분은 항상 전부 포함.
  const keyOf = (r: WeeklySheetRow): string => (isStandard(r.section.trim()) ? r.section.trim() : rowLabel(r))
  const keys: string[] = [...WEEKLY_SECTIONS]
  for (const r of sorted) {
    const k = keyOf(r)
    if (!keys.includes(k)) keys.push(k)
  }
  return keys.map(section => {
    const own = sorted.filter(r => keyOf(r) === section)
    const cell = (field: 'thisContent' | 'nextContent') => joinCells(own.map(r => cellLines(r[field])))
    // 이슈/이벤트 셀은 작아서 문단 빈 줄을 걷어내고 실질 줄만 이어붙인다.
    const issue = (field: 'thisIssue' | 'nextIssue') => compactReportLines(
      own.flatMap(r => cellLines(r[field]).filter(l => l.trim() !== '')),
      field === 'nextIssue',
    )
    return {
      section,
      thisContent: cell('thisContent'),
      nextContent: cell('nextContent'),
      thisIssue: issue('thisIssue'),
      nextIssue: issue('nextIssue'),
    }
  })
}
