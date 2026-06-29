// DEV PREVIEW ONLY — loads the real WBS.xlsx and assigns sample actuals so the
// UI can be rendered without Supabase. Safe to delete with the /preview routes.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import { computeTree } from '@/lib/domain/rollup'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'

export const DEMO_TODAY = '2026-09-15' // mid-project so planned vs actual is illustrative
const SAMPLE_ACTUALS = [100, 90, 70, 45, 20, 0]

export async function loadSampleItems(): Promise<{ items: ComputedItem[]; holidays: string[] }> {
  const buf = await readFile(path.join(process.cwd(), 'docs/WBS-original.xlsx'))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const parsed = parseWbsWorkbook(ab)
  const res = validateAndLink(parsed)
  if (!res.ok) throw new Error('샘플 데이터 검증 실패: ' + JSON.stringify(res.errors))

  const parentIds = new Set(res.items.map(i => i.parentTempId).filter(Boolean) as string[])
  let leafIdx = 0
  const rows: WbsRow[] = res.items.map(it => {
    const isLeaf = !parentIds.has(it.tempId)
    return {
      id: it.tempId,
      parentId: it.parentTempId,
      level: it.level,
      code: it.code,
      sortOrder: it.sortOrder,
      name: it.name,
      biz: it.biz,
      deliverable: it.deliverable,
      plannedStart: it.plannedStart,
      plannedEnd: it.plannedEnd,
      weight: null,
      actualPct: isLeaf ? SAMPLE_ACTUALS[leafIdx++ % SAMPLE_ACTUALS.length] : null,
      owners: it.owners,
    }
  })
  const holidays = new Set(parsed.holidays.map(h => h.date))
  return { items: computeTree(rows, DEMO_TODAY, holidays), holidays: [...holidays] }
}
