import type { NarrativeGroup, NarrativeModel } from './narrative'
import { WEEKLY_SECTIONS, type WeeklySheetRow } from '@/lib/domain/weeklySheet'

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

/** 행 라벨 — 그룹 헤드라인과 이슈 접두가 공유한다.
 *  신규 시트는 구분명 단독('영업'), 레거시 행은 '구분 · 모듈'('ERP · SD/LE')로 병기,
 *  구분이 없으면 모듈로 폴백하고 둘 다 없으면 '기타'('[] '가 노출되지 않게). */
export const rowLabel = (r: WeeklySheetRow): string => {
  const sec = r.section.trim(), mod = r.module.trim()
  if (!sec) return mod || '기타'
  return mod && mod !== sec ? `${sec} · ${mod}` : sec
}

function groupsOf(rows: WeeklySheetRow[], field: 'thisContent' | 'nextContent'): NarrativeGroup[] {
  return rows
    .filter(r => r[field].trim() !== '')
    .map((r, i) => ({ phase: rowLabel(r), num: i + 1, items: cellLines(r[field]) }))
}

function issuesOf(rows: WeeklySheetRow[], field: 'thisIssue' | 'nextIssue'): string[] {
  const out = rows.flatMap(r =>
    cellLines(r[field]).filter(l => l.trim() !== '').map(l => `[${rowLabel(r)}] ${l.trim()}`),
  )
  // 빈 목록을 직접 채워 fillWeeklyTemplate 우측 슬롯의 '예정된 주요 이벤트 없음' 폴백이 노출되지 않게 한다.
  return out.length ? out : ['특이 이슈 없음']
}

/** 보고 순서상의 자리 — 시트 행 순서와 동일한 WEEKLY_SECTIONS가 단일 출처.
 *  행의 sort_order가 아니라 구분명으로 정렬하므로, 아직 정리되지 않은 레거시 시트를 내보내도
 *  PPT는 항상 정해진 순서로 나온다. 목록에 없는 구분(레거시·자유 입력)은 뒤로 밀되 서로는 sortOrder 순. */
const sectionRank = (r: WeeklySheetRow): number => {
  const i = (WEEKLY_SECTIONS as readonly string[]).indexOf(r.section.trim())
  return i < 0 ? WEEKLY_SECTIONS.length : i
}

/** 시트 행들 → NarrativeModel. 셀이 빈 모듈은 그 열에서 생략, 4셀 모두 빈 행은 어디에도 안 나감. */
export function buildSheetNarrative(rows: WeeklySheetRow[]): NarrativeModel {
  const sorted = [...rows].sort((a, b) => sectionRank(a) - sectionRank(b) || a.sortOrder - b.sortOrder)
  return {
    prev: groupsOf(sorted, 'thisContent'),
    curr: groupsOf(sorted, 'nextContent'),
    issues: issuesOf(sorted, 'thisIssue'),
    events: issuesOf(sorted, 'nextIssue'),
  }
}
