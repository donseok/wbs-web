import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE, validateProfile } from '@/lib/excel/profile'

describe('ExcelProfile', () => {
  it('레거시 D-CUBE 프로파일이 현행 파서 좌표와 일치한다', () => {
    const p = LEGACY_DCUBE_PROFILE
    expect(p.sheetName).toBe('WBS')
    expect(p.holidaySheetName).toBe('Holiday')
    expect(p.headerRow).toBe(2)
    expect(p.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3] })
    expect(p.logical).toEqual({ extraAxis: 0, code: null, name: null, deliverable: 11, start: 12, end: 13, weight: 14, actualPct: 16 })
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

  // 리뷰 픽스(2026-08-01): logical.name — outline 계층 전용 이름 열. null|정수>=0 규칙은 다른 필드와
  // 동일하지만, 이 필드가 생기기 전에 저장된 구 프로파일은 키 자체가 없으므로 그 경우만 null 로 수용한다.
  it('logical.name — null|정수≥0 은 다른 필드와 동일 규칙, 음수는 거부', () => {
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, logical: { ...LEGACY_DCUBE_PROFILE.logical, name: 5 } }).ok).toBe(true)
    expect(validateProfile({ ...LEGACY_DCUBE_PROFILE, logical: { ...LEGACY_DCUBE_PROFILE.logical, name: -1 } }).ok).toBe(false)
  })
  it('logical.name 키 부재(이 필드 도입 이전 저장분) → null 로 정규화해 통과시킨다(전방호환)', () => {
    const legacyLogical = { ...LEGACY_DCUBE_PROFILE.logical } as Record<string, unknown>
    delete legacyLogical.name
    const res = validateProfile({ ...LEGACY_DCUBE_PROFILE, logical: legacyLogical })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.profile.logical.name).toBeNull()
  })
})
