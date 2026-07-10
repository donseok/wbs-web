import { parseUTC, fmtUTC, addDays, mondayOf, md } from './weekly'

/* ── 주간업무 시트 전용 주차 유틸(순수·UTC). WBS 보고서의 weekly.ts 유틸을 재사용한다. ── */

/** 임의 'YYYY-MM-DD' → 그 주 월요일 'YYYY-MM-DD'. */
export function mondayIso(dateIso: string): string {
  return fmtUTC(mondayOf(parseUTC(dateIso)))
}

/** 주 시작일을 n주 이동. */
export function shiftWeeks(weekStartIso: string, n: number): string {
  return fmtUTC(addDays(parseUTC(weekStartIso), n * 7))
}

export interface SheetWeekMeta {
  weekTag: string    // '7월1주차' (파일명용)
  label: string      // '7월 1주차' (화면 표시용)
  thisRange: string  // '7/6~7/10' (월~금)
  nextRange: string  // '7/13~7/17'
}

/** 주차 라벨: 그 주 월요일이 속한 달에서 몇 번째 월요일인지로 N주차(스펙 §3). 범위는 월~금. */
export function sheetWeekMeta(weekStartIso: string): SheetWeekMeta {
  const mon = parseUTC(mondayIso(weekStartIso))
  const month = mon.getUTCMonth() + 1
  const nth = Math.floor((mon.getUTCDate() - 1) / 7) + 1
  const fri = addDays(mon, 4)
  const nextMon = addDays(mon, 7)
  const nextFri = addDays(mon, 11)
  return {
    weekTag: `${month}월${nth}주차`,
    label: `${month}월 ${nth}주차`,
    thisRange: `${md(mon)}~${md(fri)}`,
    nextRange: `${md(nextMon)}~${md(nextFri)}`,
  }
}
