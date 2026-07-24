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

export interface WbsColumnMap {
  teams: [number, TeamCode][]
  deliverable: number; start: number; end: number; weight: number; actualPct: number
}

/** 헤더 탐색 실패 시 폴백 — 2026-07 이전 5팀 고정 양식(G..K + L,M,N,O,Q). */
const LEGACY_COLUMN_MAP: WbsColumnMap = {
  teams: [[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']],
  deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16,
}

/** 3행 헤더(인덱스 2)에서 열 맵 구성 — 팀 열은 'Activity' 뒤 ~ '산출물' 앞의 비어있지 않은 헤더.
 *  팀 수가 바뀌면 뒤 열이 전부 밀리므로 후속 열도 이름으로 찾는다(실패 시 산출물 기준 상대 위치).
 *  팀 마스터 등록 여부 검증은 서버(임포트 라우트)가 담당 — 이 함수는 순수 헤더 해석만 한다. */
export function buildWbsColumnMap(header3: unknown[]): WbsColumnMap {
  const labels = header3.map(v => String(v ?? '').trim())
  const act = labels.indexOf('Activity')
  const del = labels.indexOf('산출물')
  if (act < 0 || del < 0 || del <= act) return LEGACY_COLUMN_MAP
  const teams: [number, TeamCode][] = []
  for (let c = act + 1; c < del; c++) if (labels[c]) teams.push([c, labels[c]])
  if (teams.length === 0) return LEGACY_COLUMN_MAP
  const at = (name: string, fallback: number) => {
    const i = labels.indexOf(name, del + 1)
    return i > del ? i : fallback
  }
  return {
    teams,
    deliverable: del,
    start: at('시작', del + 1),
    end: at('종료', del + 2),
    weight: at('가중치', del + 3),
    actualPct: at('실적%', del + 5),
  }
}

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
function owners(row: unknown[], teamCols: readonly [number, TeamCode][]): ParsedRow['owners'] {
  const out: ParsedRow['owners'] = []
  for (const [col, team] of teamCols) {
    const mark = String(row[col] ?? '').trim()
    if (mark === '●') out.push({ team, kind: 'primary' })
    else if (mark === '△') out.push({ team, kind: 'support' })
  }
  return out
}

export function parseWbsWorkbook(buf: ArrayBuffer): ParsedWbs {
  // cellDates:false — 날짜를 시리얼(정수)로 유지해 toIso 에서 타임존 무관 변환(위 참조).
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const ws = wb.Sheets['WBS']
  // WBS 시트가 없으면 빈 행으로(예외 방지). Holiday 시트는 아래에서 별도 처리.
  const aoa = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false }) : []

  const rows: ParsedRow[] = []
  // 3행 헤더에서 열 맵 도출 — 팀 열 가변(팀 마스터) 대응. 규약 밖 파일은 5팀 고정 폴백.
  const map = buildWbsColumnMap((aoa[2] ?? []) as unknown[])
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
      deliverable: String(r[map.deliverable] ?? '').trim() || null,
      plannedStart: toIso(r[map.start]),
      plannedEnd: toIso(r[map.end]),
      weight: toNum(r[map.weight]),
      actualPct: toNum(r[map.actualPct]),
      owners: owners(r, map.teams),
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
