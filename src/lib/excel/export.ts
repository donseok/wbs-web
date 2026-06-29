import * as XLSX from 'xlsx'
import type { ComputedItem, TeamCode } from '@/lib/domain/types'

/**
 * WBS 익스포트 (순수). parse.ts와 동일한 열 배치로 써서 다시 임포트하면 라운드트립된다.
 * 열(0-base): A0 Biz · B1 Phase · C2 Task · D3 Activity · G6~J9 담당(●주관/△지원)
 *           · L11 산출물 · M12 계획시작 · N13 계획종료 · O14 가중치 · Q16 실적%
 * R17~ 는 사람이 읽기 위한 계산 컬럼(파서는 무시).
 */
const TEAM_COL: Record<TeamCode, number> = { PMO: 6, DT: 7, ERP: 8, MES: 9 }
const STATUS_LABEL: Record<ComputedItem['status'], string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

function flatten(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => { out.push(n); walk(n.children) })
  walk(items)
  return out
}

// 'YYYY-MM-DD' → 재임포트 시 cellDates로 동일 날짜가 복원되도록 UTC 자정 Date.
function isoToDate(iso: string | null): Date | '' {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00Z')
}

/** WBS 시트의 AOA(행 배열) 생성 — 테스트·검증용으로 분리 노출. */
export function buildWbsAoa(items: ComputedItem[], projectName = 'WBS'): unknown[][] {
  const header1 = [projectName]
  const header2 = ['', 'Phase', 'Task', 'Activity', '', '', '담당', '', '', '', '', '산출물', '계획', '']
  const header3 = ['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'DT', 'ERP', 'MES', '', '산출물', '시작', '종료', '가중치', '', '실적%', '계획%', '달성율', '상태']

  const rows: unknown[][] = [header1, header2, header3]
  for (const it of flatten(items)) {
    const row: unknown[] = new Array(20).fill('')
    row[0] = it.biz ?? ''
    if (it.level === 'phase') row[1] = it.name
    else if (it.level === 'task') row[2] = it.name
    else row[3] = it.name
    for (const o of it.owners) row[TEAM_COL[o.team]] = o.kind === 'primary' ? '●' : '△'
    row[11] = it.deliverable ?? ''
    row[12] = isoToDate(it.plannedStart)
    row[13] = isoToDate(it.plannedEnd)
    row[14] = it.weight ?? ''
    // 실적%은 leaf(저장값)만 라운드트립. 상위는 계산값이므로 Q를 비워 임포트 시 무시되게 함.
    row[16] = it.children.length === 0 ? (it.actualPct ?? '') : ''
    // 읽기용 계산 컬럼
    row[17] = it.plannedPct
    row[18] = it.rolledActualPct
    row[19] = it.achievement == null ? '' : it.achievement
    row.push(STATUS_LABEL[it.status])
    rows.push(row)
  }
  return rows
}

/** WBS + Holiday 시트를 가진 xlsx ArrayBuffer 생성. */
export function buildWbsWorkbook(
  items: ComputedItem[],
  holidays: { date: string; name: string }[] = [],
  projectName = 'WBS',
): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  const wbsSheet = XLSX.utils.aoa_to_sheet(buildWbsAoa(items, projectName), { cellDates: true })
  XLSX.utils.book_append_sheet(wb, wbsSheet, 'WBS')

  const holAoa: unknown[][] = [['날짜', '명칭'], ...holidays.map(h => [isoToDate(h.date), h.name])]
  const holSheet = XLSX.utils.aoa_to_sheet(holAoa, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, holSheet, 'Holiday')

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
