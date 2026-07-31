import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE, validateProfile } from '@/lib/excel/profile'

describe('ExcelProfile', () => {
  it('레거시 D-CUBE 프로파일이 현행 파서 좌표와 일치한다', () => {
    const p = LEGACY_DCUBE_PROFILE
    expect(p.sheetName).toBe('WBS')
    expect(p.holidaySheetName).toBe('Holiday')
    expect(p.headerRow).toBe(2)
    expect(p.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3] })
    expect(p.logical).toEqual({ extraAxis: 0, code: null, deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16 })
    expect(p.teamColumns).toEqual([[6, 'PMO'], [7, 'ERP'], [8, 'MES'], [9, '가공'], [10, 'MDM']])
    expect(p.ownerMarks).toEqual({ '●': 'primary', '△': 'support' })
  })

  it('validateProfile — 필수 누락·계층 열 중복·마크 값 오류를 거부한다', () => {
    expect(validateProfile(null).ok).toBe(false)
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'columns', columns: [1, 1] } }).ok).toBe(false)
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, ownerMarks: { '●': 'boss' } }).ok).toBe(false)
    const ok = validateProfile(JSON.parse(JSON.stringify(LEGACY_DCUBE_PROFILE)))
    expect(ok.ok).toBe(true)
  })
})
