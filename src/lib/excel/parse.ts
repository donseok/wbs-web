import * as XLSX from 'xlsx'
import type { Level, TeamCode, OwnerKind } from '@/lib/domain/types'

export interface ParsedRow {
  level: Level; code: string; name: string; biz: string | null; deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  weight: number | null; actualPct: number | null
  owners: { team: TeamCode; kind: OwnerKind }[]
  excelRow: number
}
export interface ParsedWbs { rows: ParsedRow[]; holidays: { date: string; name: string }[] }

const TEAM_COL: [number, TeamCode][] = [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공']] // G,H,I,J (0-base)

function toIso(v: unknown): string | null {
  // 엑셀 날짜는 시리얼(정수)로 저장됨. SSF.parse_date_code 로 타임존 무관하게 {y,m,d} 도출.
  // (cellDates 로컬 변환에 의존하면 Asia/Seoul 1899 LMT 오프셋 때문에 -1일 밀린다.)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${p(d.m)}-${p(d.d)}`
  }
  // 방어적: 혹시 Date 로 들어오면 UTC 성분을 취해 로컬 오프셋 밀림을 피한다.
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString().slice(0, 10)
  }
  return null
}
function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) ? n : null
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

/**
 * O열(가중치) 스케일 정규화 → 항상 0~100 으로 맞춘다.
 *
 * 두 종류의 파일이 들어온다:
 *   - 고객사 원본 xlsx : 0~1 스케일 (leaf 합 ≈ 1). 엑셀 수식(1/22 등)에서 나온 값.
 *   - 우리 export 파일 : 0~100 스케일 (leaf 합 ≈ 100).
 *
 * 두 스케일의 leaf 합은 1 vs 100 으로 간극이 100배라 오판 여지가 사실상 없다.
 * 임계값 1.5 는 반올림·잔차(합이 0.9999 나 1.02 로 어긋나는 경우)를 넉넉히 흡수하면서도
 * 100 스케일(합 100)과는 멀리 떨어뜨린 값이다.
 *
 * leaf(자식 없는 행) 기준으로 합산한다 — 가중치는 전역 절대 지분이므로 상위 행까지
 * 더하면 트리 깊이만큼 중복 계산된다.
 */
function rescaleWeights(rows: ParsedRow[]): void {
  const hasChild = new Set<number>()
  const RANK: Record<Level, number> = { phase: 0, task: 1, activity: 2 }
  // 바로 뒤에 더 깊은 레벨이 이어지면 그 행은 부모(=leaf 아님).
  for (let i = 0; i < rows.length - 1; i++) {
    if (RANK[rows[i + 1].level] > RANK[rows[i].level]) hasChild.add(i)
  }
  const leafWeights = rows
    .map((r, i) => (hasChild.has(i) ? null : r.weight))
    .filter((w): w is number => w != null)

  if (leafWeights.length === 0) return
  const sum = leafWeights.reduce((a, b) => a + b, 0)
  if (sum > 1.5) return // 이미 0~100 스케일

  for (const r of rows) if (r.weight != null) r.weight *= 100
}

export function parseWbsWorkbook(buf: ArrayBuffer): ParsedWbs {
  // cellDates:false — 날짜를 시리얼(정수)로 유지해 toIso 에서 타임존 무관 변환(위 참조).
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const ws = wb.Sheets['WBS']
  // WBS 시트가 없으면 빈 행으로(예외 방지). Holiday 시트는 아래에서 별도 처리.
  const aoa = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false }) : []

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
      weight: toNum(r[14]),        // O (가중치)
      actualPct: toNum(r[16]),     // Q (실적%)
      owners: owners(r),
      excelRow: i + 1,
    })
  }

  rescaleWeights(rows)

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
