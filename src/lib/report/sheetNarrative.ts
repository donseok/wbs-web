import type { NarrativeGroup, NarrativeModel } from './narrative'
import type { WeeklySheetRow } from '@/lib/domain/weeklySheet'

/* ============================================================================
 * 주간업무 시트 → PPT 내러티브 변환(순수). 스펙 §6.
 * prev 슬롯 = 금주실적(왼쪽 열), curr 슬롯 = 차주계획(오른쪽 열).
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

/** 그룹 헤드라인 — 구분·모듈 없는 행(레퍼런스 시트 말미의 무라벨 행)이 '[] '로 나오지 않게 폴백. */
const headline = (r: WeeklySheetRow): string => {
  const sec = r.section.trim(), mod = r.module.trim()
  return sec && mod ? `[${sec}] ${mod}` : mod || sec || '기타'
}

const issueLabel = (r: WeeklySheetRow): string => r.module.trim() || r.section.trim() || '기타'

function groupsOf(rows: WeeklySheetRow[], field: 'thisContent' | 'nextContent'): NarrativeGroup[] {
  return rows
    .filter(r => r[field].trim() !== '')
    .map((r, i) => ({ phase: headline(r), num: i + 1, items: cellLines(r[field]) }))
}

function issuesOf(rows: WeeklySheetRow[], field: 'thisIssue' | 'nextIssue'): string[] {
  const out = rows.flatMap(r =>
    cellLines(r[field]).filter(l => l.trim() !== '').map(l => `[${issueLabel(r)}] ${l.trim()}`),
  )
  // 빈 목록을 직접 채워 fillWeeklyTemplate 우측 슬롯의 '예정된 주요 이벤트 없음' 폴백이 노출되지 않게 한다.
  return out.length ? out : ['특이 이슈 없음']
}

/** 시트 행들 → NarrativeModel. 셀이 빈 모듈은 그 열에서 생략, 4셀 모두 빈 행은 어디에도 안 나감. */
export function buildSheetNarrative(rows: WeeklySheetRow[]): NarrativeModel {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  return {
    prev: groupsOf(sorted, 'thisContent'),
    curr: groupsOf(sorted, 'nextContent'),
    issues: issuesOf(sorted, 'thisIssue'),
    events: issuesOf(sorted, 'nextIssue'),
  }
}
