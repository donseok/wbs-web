import { describe, expect, it } from 'vitest'
import {
  ISSUE_MAJOR_NAME_MAX,
  ISSUE_MEGA_AREAS,
  ISSUE_SOURCE_TYPES,
  formatIssueMajorCode,
  formatPiIssueCode,
  normalizeIssueAnalysisInput,
  type IssueAnalysisInput,
} from '@/lib/domain/issueAnalysis'

const VALID = {
  megaCode: '03' as const,
  majorName: '  주문관리  ',
  subProcess: '  설계 변경  ',
  ownerDepartment: '  품질팀  ',
  relatedSystems: [' PLM ', 'ERP', 'PLM'],
  sourceType: 'deliverable' as const,
  sourceDetail: '  As-Is 산출물  ',
}

describe('이슈 분석 메타 정본', () => {
  it('PPT Mega 8개 코드와 명칭을 순서대로 고정한다', () => {
    expect(ISSUE_MEGA_AREAS.map(({ code, nameKo }) => [code, nameKo])).toEqual([
      ['00', '기준관리'],
      ['01', '손익관리'],
      ['02', '영업'],
      ['03', '품질·설계'],
      ['04', '생산계획'],
      ['05', '조업'],
      ['06', '출하'],
      ['07', '원가'],
    ])
  })

  it('원천 화이트리스트를 고정한다', () => {
    expect(ISSUE_SOURCE_TYPES).toEqual([
      'minutes',
      'interview',
      'deliverable',
      'as_is_analysis',
      'data_analysis',
      'other',
    ])
  })

  it('문자열을 trim하고 관련 시스템을 입력 순서대로 중복 제거한다', () => {
    expect(normalizeIssueAnalysisInput(VALID)).toEqual({
      ok: true,
      value: {
        megaCode: '03',
        majorName: '주문관리',
        subProcess: '설계 변경',
        ownerDepartment: '품질팀',
        relatedSystems: ['PLM', 'ERP'],
        sourceType: 'deliverable',
        sourceDetail: 'As-Is 산출물',
      },
    })
  })

  it('majorName 누락·공백은 거부한다', () => {
    const withoutMajor = { ...VALID } as Partial<IssueAnalysisInput>
    delete withoutMajor.majorName
    expect(normalizeIssueAnalysisInput(withoutMajor as IssueAnalysisInput)).toEqual({
      ok: false,
      error: 'Major Process를 입력하세요.',
    })
    expect(normalizeIssueAnalysisInput({ ...VALID, majorName: '   ' })).toEqual({
      ok: false,
      error: 'Major Process를 입력하세요.',
    })
  })

  it('majorName 은 100자 경계까지 허용하고 초과는 거부한다', () => {
    const atMax = normalizeIssueAnalysisInput({ ...VALID, majorName: '가'.repeat(ISSUE_MAJOR_NAME_MAX) })
    expect(atMax.ok).toBe(true)
    expect(normalizeIssueAnalysisInput({ ...VALID, majorName: '가'.repeat(ISSUE_MAJOR_NAME_MAX + 1) })).toEqual({
      ok: false,
      error: 'Major Process는 100자 이하여야 합니다.',
    })
  })

  it('번호 접두 majorName 은 거부한다 — 번호 정본은 DB 체번', () => {
    for (const name of ['02.01 주문관리', '02.01주문관리', '[02.01] 주문관리', ' 02.01', '02.01.03 하위']) {
      expect(normalizeIssueAnalysisInput({ ...VALID, majorName: name })).toEqual({
        ok: false,
        error: 'Major Process는 번호 없이 이름만 입력하세요. 번호(02.01…)는 저장 시 자동 채번됩니다.',
      })
    }
    // 두 자리.두 자리 접두가 아닌 숫자 시작 이름은 정상 허용
    expect(normalizeIssueAnalysisInput({ ...VALID, majorName: '3.5세대 공정' }).ok).toBe(true)
  })

  it('일반 경로의 minutes 사칭은 막고 전용 경로에서만 허용한다', () => {
    const minutes = { ...VALID, sourceType: 'minutes' as const }
    expect(normalizeIssueAnalysisInput(minutes).ok).toBe(false)
    expect(normalizeIssueAnalysisInput(minutes, { allowMinutesSource: true }).ok).toBe(true)
  })

  it('PI 업무키는 일련번호를 최소 두 자리로 표시하고 100 이상을 보존한다', () => {
    expect(formatPiIssueCode('00', 1)).toBe('PI-I-00-01')
    expect(formatPiIssueCode('07', 100)).toBe('PI-I-07-100')
    expect(() => formatPiIssueCode('00', 0)).toThrow()
  })

  it('Major 코드는 두 자리 패딩·100 이상 자연 확장·0 이하와 비정수는 throw', () => {
    expect(formatIssueMajorCode('02', 1)).toBe('02.01')
    expect(formatIssueMajorCode('02', 100)).toBe('02.100')
    expect(() => formatIssueMajorCode('02', 0)).toThrow()
    expect(() => formatIssueMajorCode('02', -1)).toThrow()
    expect(() => formatIssueMajorCode('02', 1.5)).toThrow()
  })
})
