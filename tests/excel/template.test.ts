import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { detectWorkbook } from '@/lib/excel/detect'
import { buildWbsTemplateWorkbook, TEMPLATE_HEADER, TEMPLATE_ROWS } from '@/lib/excel/template'

/** 양식 ↔ 감지기 정합 — 양식을 그대로 올리면 마법사가 손대지 않고 100% 잡아야 한다. 감지기가 바뀌면 여기가 깨진다. */
describe('wbs.xlsx 양식', () => {
  const buf = buildWbsTemplateWorkbook()

  it('시트 WBS·Holiday·작성법, 헤더는 별칭 완전일치', () => {
    const wb = XLSX.read(buf, { type: 'array' })
    expect(wb.SheetNames).toEqual(['WBS', 'Holiday', '작성법'])
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.WBS, { header: 1 })
    expect(aoa[0]).toEqual([...TEMPLATE_HEADER])
    expect(aoa.length).toBe(TEMPLATE_ROWS.length + 1)
  })

  it('감지기가 아웃라인 계층·논리 열 전부·Holiday 를 잡고 confidence 가 전부 1.0', () => {
    const r = detectWorkbook(buf)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { profile, confidence, warnings } = r.result
    expect(profile.hierarchy.kind).toBe('outline')
    expect(confidence).toEqual({ header: 1, hierarchy: 1, logical: 1 })
    for (const key of ['code', 'extraAxis', 'deliverable', 'start', 'end', 'weight', 'actualPct'] as const) {
      expect(profile.logical[key], key).not.toBeNull()
    }
    expect(profile.holidaySheetName).toBe('Holiday')
    expect(warnings).toEqual([])
  })

  it('형제 가중치 합 1.0 — 예시 행이 규칙을 어기지 않는다', () => {
    const byParent = new Map<string, number>()
    for (const row of TEMPLATE_ROWS) {
      const code = String(row[0]); const parent = code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : ''
      byParent.set(parent, (byParent.get(parent) ?? 0) + Number(row[6]))
    }
    for (const [parent, sum] of byParent) expect(sum, parent || 'root').toBeCloseTo(parent === '' ? 2 : 1, 6)
  })
})
