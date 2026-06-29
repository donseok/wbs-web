// TEMPORARY DEMO MODE — lets you log in and browse the real app pages WITHOUT
// a live Supabase project. Enabled only when NEXT_PUBLIC_DEMO_MODE=1 (off by
// default). Reads the real WBS.xlsx and assigns sample actuals. Auth is bypassed
// and writes are no-ops. DO NOT enable this in production. Remove once Supabase
// is wired up.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWbsWorkbook } from '@/lib/excel/parse'
import { validateAndLink } from '@/lib/excel/validate'
import { computeTree } from '@/lib/domain/rollup'
import type { ComputedItem, TeamCode, WbsRow } from '@/lib/domain/types'

export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'
export const DEMO_PROJECT_ID = 'demo'
export const DEMO_TODAY = '2026-09-15'
export const DEMO_MEMBERSHIP: { role: string; teamCode: TeamCode; teamId: string } = {
  role: 'pmo_admin',
  teamCode: 'PMO',
  teamId: 'demo',
}
export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  name: 'D-CUBE PI Master Plan 수립 (데모)',
  start_date: '2026-06-29',
  end_date: '2027-01-04',
  created_at: '2026-06-29T00:00:00.000Z',
}

const SAMPLE_ACTUALS = [100, 90, 70, 45, 20, 0]

export async function loadDemoWbs(): Promise<{ items: ComputedItem[]; holidays: string[]; today: string }> {
  const buf = await readFile(path.join(process.cwd(), 'docs/WBS-original.xlsx'))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const parsed = parseWbsWorkbook(ab)
  const res = validateAndLink(parsed)
  if (!res.ok) throw new Error('데모 데이터 검증 실패: ' + JSON.stringify(res.errors))

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
      // 파싱값 우선, 없으면 기존 폴백(null=균등)
      weight: it.weight ?? null,
      // leaf: 파싱값 있으면 사용, 없으면 샘플 실적(데모가 0%로 죽지 않게). non-leaf는 null.
      actualPct: isLeaf
        ? (it.actualPct ?? SAMPLE_ACTUALS[leafIdx++ % SAMPLE_ACTUALS.length])
        : null,
      owners: it.owners,
    }
  })
  const holidays = new Set(parsed.holidays.map(h => h.date))
  return { items: computeTree(rows, DEMO_TODAY, holidays), holidays: [...holidays], today: DEMO_TODAY }
}
