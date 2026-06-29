import * as XLSX from 'xlsx'
import type { Level, TeamCode, OwnerKind } from '@/lib/domain/types'

export interface ParsedRow {
  level: Level; code: string; name: string; biz: string | null; deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  owners: { team: TeamCode; kind: OwnerKind }[]
  excelRow: number
}
export interface ParsedWbs { rows: ParsedRow[]; holidays: { date: string; name: string }[] }

const TEAM_COL: [number, TeamCode][] = [[6, 'PMO'], [7, 'DT'], [8, 'ERP'], [9, 'MES']] // G,H,I,J (0-base)

function toIso(v: unknown): string | null {
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10)
  }
  return null
}
function owners(row: unknown[]): ParsedRow['owners'] {
  const out: ParsedRow['owners'] = []
  for (const [col, team] of TEAM_COL) {
    const mark = String(row[col] ?? '').trim()
    if (mark === '●') out.push({ team, kind: 'primary' })
    else if (mark === '△') out.push({ team, kind: 'support' })
  }
  return out
}

export function parseWbsWorkbook(buf: ArrayBuffer): ParsedWbs {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets['WBS']
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })

  const rows: ParsedRow[] = []
  // 데이터는 헤더 3행(타이틀 포함) 이후. 행 인덱스 3부터.
  for (let i = 3; i < aoa.length; i++) {
    const r = aoa[i]
    const phase = String(r[1] ?? '').trim()   // B
    const task = String(r[2] ?? '').trim()    // C
    const act = String(r[3] ?? '').trim()     // D
    let level: Level | null = null
    let name = ''
    if (phase) { level = 'phase'; name = phase }
    else if (task) { level = 'task'; name = task }
    else if (act) { level = 'activity'; name = act }
    if (!level) continue
    const code = name.split(/[.\s]/)[0]  // '1', '1-1', 또는 activity면 첫 토큰
    rows.push({
      level, code, name,
      biz: String(r[0] ?? '').trim() || null,  // A
      deliverable: String(r[11] ?? '').trim() || null,  // L
      plannedStart: toIso(r[12]),  // M
      plannedEnd: toIso(r[13]),    // N
      owners: owners(r),
      excelRow: i + 1,
    })
  }

  const holidays: { date: string; name: string }[] = []
  const hs = wb.Sheets['Holiday']
  if (hs) {
    const haoa = XLSX.utils.sheet_to_json<unknown[]>(hs, { header: 1, blankrows: false })
    for (const r of haoa) {
      const iso = toIso(r[0])
      if (iso) holidays.push({ date: iso, name: String(r[1] ?? '').trim() })
    }
  }
  return { rows, holidays }
}
