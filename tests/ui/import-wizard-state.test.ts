import { describe, expect, it } from 'vitest'
import { LEGACY_DCUBE_PROFILE, type ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import {
  initialWizardState, reducer, switchHierarchyKind, setOutlineColumn, setLogicalColumn,
  recordToRows, rowsToRecord, deriveMappedPreview, type MarkRow,
} from '@/lib/domain/importWizard'

const DETECTION: DetectionResult = {
  sheetNames: ['WBS'],
  profile: LEGACY_DCUBE_PROFILE,
  confidence: { header: 1, hierarchy: 1, logical: 1 },
  preview: { headers: ['Biz', '대', '중', '소'], rows: [] },
  warnings: [],
}

describe('importWizard reducer — 상태 전이(§6.2)', () => {
  it('fileSelected — 파일을 바꾸면 이전 감지·편집 상태를 전부 무효화한다', () => {
    const dirty = reducer(initialWizardState, { type: 'inspectStart' })
    const next = reducer(dirty, { type: 'fileSelected', fileName: 'a.xlsx' })
    expect(next).toEqual({ ...initialWizardState, fileName: 'a.xlsx' })
  })

  it('inspectSuccess — 기본 프로파일은 savedProfile ?? detection.profile(§6.2 계약)', () => {
    const withSaved = reducer(initialWizardState, {
      type: 'inspectSuccess', detection: DETECTION, savedProfile: { ...LEGACY_DCUBE_PROFILE, sheetName: 'SAVED' },
    })
    expect(withSaved.step).toBe('review')
    expect(withSaved.profile?.sheetName).toBe('SAVED')

    const withoutSaved = reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: null })
    expect(withoutSaved.profile).toBe(DETECTION.profile)
  })

  it('inspectFailure — 1단계에 머물며 에러만 싣는다', () => {
    const next = reducer(initialWizardState, { type: 'inspectFailure', error: '시트가 없습니다' })
    expect(next.step).toBe('select')
    expect(next.error).toBe('시트가 없습니다')
    expect(next.busy).toBe(false)
  })

  it('executeStart — 이전 실패 상태(error/errors/needsTeams/needsTeamsScope)를 전부 지운다', () => {
    const dirty: typeof initialWizardState = {
      ...initialWizardState, error: 'x', errors: [{ excelRow: 1, message: 'y' }], needsTeams: ['A팀'], needsTeamsScope: 'global',
    }
    const next = reducer(dirty, { type: 'executeStart' })
    expect(next).toMatchObject({ busy: true, error: null, errors: null, needsTeams: null, needsTeamsScope: null })
  })

  it('executeNeedsTeams — busy 를 풀고 팀 목록+스코프를 싣는다(409 다이얼로그 트리거, 0071 scope)', () => {
    const project = reducer({ ...initialWizardState, busy: true }, { type: 'executeNeedsTeams', teams: ['신팀'], scope: 'project' })
    expect(project).toMatchObject({ busy: false, needsTeams: ['신팀'], needsTeamsScope: 'project' })

    const global = reducer({ ...initialWizardState, busy: true }, { type: 'executeNeedsTeams', teams: ['신팀'], scope: 'global' })
    expect(global).toMatchObject({ busy: false, needsTeams: ['신팀'], needsTeamsScope: 'global' })
  })

  it('dismissNeedsTeams — needsTeams 와 함께 scope 도 지운다', () => {
    const dirty = { ...initialWizardState, needsTeams: ['T'], needsTeamsScope: 'project' as const }
    const next = reducer(dirty, { type: 'dismissNeedsTeams' })
    expect(next).toMatchObject({ needsTeams: null, needsTeamsScope: null })
  })

  it('executeSuccess — done 단계로 전이하고 에러류(scope 포함)를 전부 비운다', () => {
    const dirty = { ...initialWizardState, errors: [{ excelRow: 1, message: 'z' }], needsTeams: ['T'], needsTeamsScope: 'global' as const }
    const result = { count: 3, mode: 'append' as const, reindexed: 3, profileSaved: true }
    const next = reducer(dirty, { type: 'executeSuccess', result })
    expect(next).toMatchObject({ step: 'done', result, error: null, errors: null, needsTeams: null, needsTeamsScope: null })
  })

  it('reset — 완전 초기 상태로 되돌린다', () => {
    const dirty = { ...initialWizardState, step: 'done' as const, fileName: 'a.xlsx' }
    expect(reducer(dirty, { type: 'reset' })).toEqual(initialWizardState)
  })

  it('resetToDetected — savedProfile 로 시작했어도 detection.profile 로 되돌린다(리뷰 Important #2, 레거시 프로젝트+새 양식 파일 차단 해소)', () => {
    const withSaved = reducer(initialWizardState, {
      type: 'inspectSuccess', detection: DETECTION, savedProfile: { ...LEGACY_DCUBE_PROFILE, sheetName: 'SAVED' },
    })
    expect(withSaved.profile?.sheetName).toBe('SAVED')
    // 편집도 반영한 뒤 되돌려도 detection.profile 로 정확히 복원돼야 한다(savedProfile 이 아니라).
    const edited = reducer(withSaved, { type: 'profileChanged', profile: { ...withSaved.profile!, sheetName: 'EDITED' } })
    const reverted = reducer(edited, { type: 'resetToDetected' })
    expect(reverted.profile).toBe(DETECTION.profile)
    expect(reverted.profile?.sheetName).not.toBe('SAVED')
  })

  it('resetToDetected — detection 이 없으면(1단계) 무변화', () => {
    expect(reducer(initialWizardState, { type: 'resetToDetected' })).toBe(initialWizardState)
  })
})

describe('switchHierarchyKind — columns↔outline 전환(§6.2 계층 방식 라디오)', () => {
  it('columns → outline: 첫 계층 열을 아웃라인 코드 열 기본값으로 승계한다', () => {
    const next = switchHierarchyKind(LEGACY_DCUBE_PROFILE, 'outline')
    expect(next.hierarchy).toEqual({ kind: 'outline', column: 1 })
  })

  it('outline → columns: name 을 다시 null 로 되돌린다(계층 열 자체가 이름의 출처 — profile.ts 규약)', () => {
    const outlineProfile = { ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'outline' as const, column: 0 }, logical: { ...LEGACY_DCUBE_PROFILE.logical, name: 1 } }
    const next = switchHierarchyKind(outlineProfile, 'columns')
    expect(next.hierarchy).toEqual({ kind: 'columns', columns: [0] })
    expect(next.logical.name).toBeNull()
  })

  it('같은 kind 로 전환하면 원본을 그대로 반환한다(무변화)', () => {
    expect(switchHierarchyKind(LEGACY_DCUBE_PROFILE, 'columns')).toBe(LEGACY_DCUBE_PROFILE)
  })
})

describe('setOutlineColumn / setLogicalColumn — 논리 열 셀렉트 편집', () => {
  it('setOutlineColumn — outline 모드에서만 반영, columns 모드에서는 무시', () => {
    const outline = { ...LEGACY_DCUBE_PROFILE, hierarchy: { kind: 'outline' as const, column: 0 } }
    expect(setOutlineColumn(outline, 3).hierarchy).toEqual({ kind: 'outline', column: 3 })
    expect(setOutlineColumn(LEGACY_DCUBE_PROFILE, 3)).toBe(LEGACY_DCUBE_PROFILE)
  })

  it('setLogicalColumn — 지정 필드만 갱신, 나머지는 불변', () => {
    const next = setLogicalColumn(LEGACY_DCUBE_PROFILE, 'weight', 9)
    expect(next.logical.weight).toBe(9)
    expect(next.logical.actualPct).toBe(LEGACY_DCUBE_PROFILE.logical.actualPct)
    expect(setLogicalColumn(LEGACY_DCUBE_PROFILE, 'code', null).logical.code).toBeNull()
  })
})

describe('마크 사전 행 변환 — recordToRows/rowsToRecord(키 편집 중 identity 보존)', () => {
  it('recordToRows — Record 를 안정적인 id 부여 행 배열로 바꾼다', () => {
    const rows = recordToRows({ '●': 'primary', '△': 'support' })
    expect(rows).toEqual([{ id: 0, key: '●', kind: 'primary' }, { id: 1, key: '△', kind: 'support' }])
  })

  it('rowsToRecord — 빈 키는 버리고, 앞뒤 공백은 trim 한다', () => {
    const rows: MarkRow[] = [{ id: 0, key: ' ● ', kind: 'primary' }, { id: 1, key: '', kind: 'support' }]
    expect(rowsToRecord(rows)).toEqual({ '●': 'primary' })
  })

  it('rowsToRecord — 같은 키가 중복되면 나중 행이 이긴다', () => {
    const rows: MarkRow[] = [{ id: 0, key: 'X', kind: 'primary' }, { id: 1, key: 'X', kind: 'support' }]
    expect(rowsToRecord(rows)).toEqual({ X: 'support' })
  })

  it('recordToRows → rowsToRecord 왕복이 원본과 동등하다(빈 키 없을 때)', () => {
    const original = LEGACY_DCUBE_PROFILE.ownerMarks
    expect(rowsToRecord(recordToRows(original))).toEqual(original)
  })
})

describe('deriveMappedPreview — 리뷰 Important #2: 미리보기가 편집된 profile 을 즉시 반영한다', () => {
  const headers = ['Biz', '대', '중', '소', 'x', 'x', 'PMO', 'ERP', 'x', 'x', 'x', '산출물', '시작', '종료', '가중치', 'x', '실적%']

  it('columns 계층 — 계층/논리/팀 열이 각각 올바른 role 로 표시된다', () => {
    const rows: unknown[][] = [['B1', '', '', '', ...Array(12).fill('')]]
    const preview = deriveMappedPreview(headers, rows, LEGACY_DCUBE_PROFILE)
    expect(preview.columns[1].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[2].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[3].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[0].role).toEqual({ kind: 'logical', field: 'extraAxis' })
    expect(preview.columns[11].role).toEqual({ kind: 'logical', field: 'deliverable' })
    expect(preview.columns[6].role).toEqual({ kind: 'team', team: 'PMO' })
    expect(preview.columns[4].role).toBeNull() // 매핑 안 된 여백 열
  })

  it('columns 계층 — 정확히 1열만 채워진 행만 깊이를 판정하고, 나머지는 null(?)로 표시한다', () => {
    const filledAtPhase: unknown[] = ['', 'A', '', '', ...Array(12).fill('')]
    const filledAtActivity: unknown[] = ['', '', '', 'C', ...Array(12).fill('')]
    const noneFilled: unknown[] = ['', '', '', '', ...Array(12).fill('')]
    const twoFilled: unknown[] = ['', 'A', 'B', '', ...Array(12).fill('')]
    const preview = deriveMappedPreview(headers, [filledAtPhase, filledAtActivity, noneFilled, twoFilled], LEGACY_DCUBE_PROFILE)
    expect(preview.rows.map(r => r.depth)).toEqual([0, 2, null, null])
  })

  it('outline 계층 — 코드 열 깊이는 구분자 수, 이름 열은 logical.name 으로 매핑된다', () => {
    const outlineProfile: ExcelProfile = {
      ...LEGACY_DCUBE_PROFILE,
      hierarchy: { kind: 'outline', column: 0 },
      logical: { ...LEGACY_DCUBE_PROFILE.logical, name: 1 },
    }
    const rows: unknown[][] = [['1', 'Name A'], ['1.1', 'Name B'], ['bad-code', 'Name C'], ['1.1.2.3', 'Name D']]
    const preview = deriveMappedPreview(['코드', '이름'], rows, outlineProfile)
    expect(preview.columns[0].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[1].role).toEqual({ kind: 'logical', field: 'name' })
    expect(preview.rows.map(r => r.depth)).toEqual([0, 1, null, 3])
  })

  it('원본 셀 값을 그대로 보존한다(재파싱·재포맷 없음)', () => {
    const rows: unknown[][] = [['B1', '', '', '', ...Array(12).fill('')]]
    const preview = deriveMappedPreview(headers, rows, LEGACY_DCUBE_PROFILE)
    expect(preview.rows[0].cells).toBe(rows[0])
  })
})
