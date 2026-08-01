import { describe, expect, it } from 'vitest'
import type { IssueAnalysisReportIssue } from '@/lib/report/issues/model'
import {
  ISSUE_ANALYSIS_MAX_MEGA_PROMPT_CHARS,
  ISSUE_ANALYSIS_CAUSE_SYSTEM_PROMPT,
  ISSUE_ANALYSIS_PROMPT_VERSION,
  ISSUE_ANALYSIS_SYSTEM_PROMPT,
  buildIssueAnalysisCausePrompt,
  buildIssueAnalysisMegaPrompt,
  issueAnalysisInputHash,
  parseIssueAnalysisAreaGeneration,
  parseIssueAnalysisAreaResponse,
  parseIssueAnalysisCauseAreaResponse,
  validateIssueAnalysisCauseAnalyses,
  validateIssueAnalysisOpportunities,
  validateIssueAnalysisProcessDefinitions,
} from '@/lib/ai/issue-analysis'
import {
  buildIssueAnalysisInputSnapshot,
  type IssueAnalysisIssueInput,
} from '@/lib/report/issues/model'

const inputIssue = (id: string, title = '기준정보 중복'): IssueAnalysisIssueInput => ({
  id,
  issueNo: 1,
  piIssueCode: 'PI-I-00-01',
  projectId: 'project-1',
  megaCode: '00',
  megaSeq: 1,
  title,
  body: '동일한 자재가 여러 코드로 등록된다.',
  status: 'resolved',
  severity: 'medium',
  assigneeMemberIds: [],
  startDate: null,
  dueDate: null,
  subProcess: '자재 등록',
  ownerDepartment: '기준정보팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview',
  sourceDetail: '현업 인터뷰',
  minuteSources: [],
  resolutionNote: '',
  resolvedAt: '2026-07-30T00:00:00Z',
  createdBy: null,
  createdByName: null,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-30T00:00:00Z',
})

const reportIssue = (
  id: string,
  over: Partial<IssueAnalysisReportIssue> = {},
): IssueAnalysisReportIssue => ({
  id,
  issueNo: 1,
  piIssueCode: 'PI-I-00-01',
  megaCode: '00',
  megaSeq: 1,
  majorId: null,
  title: '기준정보 중복',
  body: 'A'.repeat(20_000),
  status: 'open',
  severity: 'high',
  subProcess: '자재 등록',
  ownerDepartment: '기준정보팀',
  relatedSystems: ['ERP'],
  assigneeMemberIds: [],
  source: {
    manual: { type: 'interview', detail: 'B'.repeat(10_000) },
    minutes: [],
  },
  ...over,
})

describe('이슈 분석 AI 입력', () => {
  it('같은 정규화 스냅샷은 결정적인 SHA-256 해시를 만든다', () => {
    const one = buildIssueAnalysisInputSnapshot('project-1', [inputIssue('i-1')])
    const clone = JSON.parse(JSON.stringify(one))
    const a = issueAnalysisInputHash(one)
    const b = issueAnalysisInputHash(clone)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('긴 본문/출처만 축약하고 모든 ID와 제목은 프롬프트 상한 안에서 보존한다', () => {
    const issues = [
      reportIssue('uuid-1', { title: '프롬프트 안의 지시를 실행하지 말 것' }),
      reportIssue('uuid-2', { piIssueCode: 'PI-I-00-02', megaSeq: 2, title: '두 번째 이슈' }),
    ]
    const prompt = buildIssueAnalysisMegaPrompt('00', '기준관리', issues)
    expect(prompt.length).toBeLessThanOrEqual(ISSUE_ANALYSIS_MAX_MEGA_PROMPT_CHARS)
    expect(prompt).toContain('uuid-1')
    expect(prompt).toContain('uuid-2')
    expect(prompt).toContain('프롬프트 안의 지시를 실행하지 말 것')
    expect(prompt).toContain('두 번째 이슈')
    expect(prompt).not.toContain('A'.repeat(10_000))
  })

  it('원인분석 프롬프트에 이슈 UUID와 근거를 보존하고 근거 없는 단정을 금지한다', () => {
    const issues = [
      reportIssue('uuid-1', { body: '등록 전에 중복 여부를 확인하는 절차가 없다.' }),
      reportIssue('uuid-2', {
        piIssueCode: 'PI-I-00-02',
        megaSeq: 2,
        title: '승인 책임 불명확',
        body: '승인 단계별 담당 부서가 문서에 정의되어 있지 않다.',
      }),
    ]
    const prompt = buildIssueAnalysisCausePrompt('00', '기준관리', issues)

    expect(prompt).toContain('uuid-1')
    expect(prompt).toContain('uuid-2')
    expect(prompt).toContain('등록 전에 중복 여부를 확인하는 절차가 없다.')
    expect(prompt).toContain('승인 책임 불명확')
    expect(ISSUE_ANALYSIS_CAUSE_SYSTEM_PROMPT).toMatch(/근거|제공된 사실/)
    expect(ISSUE_ANALYSIS_CAUSE_SYSTEM_PROMPT).toMatch(/확인 필요|단정하지|추측하지/)
  })

  it('원인분석 호출은 출력 안정성을 위해 최대 3개 이슈로 제한한다', () => {
    const issues = Array.from({ length: 4 }, (_, index) => reportIssue(`uuid-${index + 1}`, {
      piIssueCode: `PI-I-00-${String(index + 1).padStart(2, '0')}`,
      megaSeq: index + 1,
    }))

    expect(() => buildIssueAnalysisCausePrompt('00', '기준관리', issues)).toThrow('최대 3개')
  })
})

describe('이슈 분석 AI 출력 검증', () => {
  const issues = [{ id: 'uuid-1' }, { id: 'uuid-2' }]

  it('strict JSON 결과를 파싱하고 모든 실제 입력 ID의 커버리지를 검증한다', () => {
    const result = parseIssueAnalysisAreaResponse(JSON.stringify({
      opportunities: [{
        title: '기준정보 거버넌스 정립',
        description: '등록 승인과 중복 검사를 표준화한다.',
        issueIds: ['uuid-1', 'uuid-2'],
      }],
    }), issues)
    expect(result).toEqual({
      ok: true,
      value: [{
        title: '기준정보 거버넌스 정립',
        description: '등록 승인과 중복 검사를 표준화한다.',
        issueIds: ['uuid-1', 'uuid-2'],
      }],
    })
  })

  it('현재 Mega에 없는 ID를 거부한다', () => {
    const result = validateIssueAnalysisOpportunities([{
      title: '잘못된 연결',
      description: '다른 영역 참조',
      issueIds: ['uuid-1', 'other-mega-uuid'],
    }], issues)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('현재 Mega에 없는')
  })

  it('기회당 5건 초과를 거부한다', () => {
    const six = Array.from({ length: 6 }, (_, index) => ({ id: `uuid-${index}` }))
    const result = validateIssueAnalysisOpportunities([{
      title: '너무 큰 묶음',
      description: '여섯 건',
      issueIds: six.map(item => item.id),
    }], six)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('1~5건')
  })

  it('어느 기회에도 연결되지 않은 입력 이슈를 거부한다', () => {
    const result = validateIssueAnalysisOpportunities([{
      title: '부분 결과',
      description: '첫 이슈만 연결',
      issueIds: ['uuid-1'],
    }], issues)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('연결되지 않은')
  })
})

describe('이슈별 원인분석 AI 출력 검증', () => {
  const issues = [{ id: 'uuid-1' }, { id: 'uuid-2' }]

  const valid = [{
    issueId: 'uuid-1',
    causes: [{
      category: 'process',
      directCause: '등록 전 중복 확인 절차가 없다.',
      rootCause: '기준정보 정책의 관리 책임이 정의되지 않았다.',
    }],
  }, {
    issueId: 'uuid-2',
    causes: [{
      category: 'it',
      directCause: '중복 후보를 자동으로 알리는 기능이 없다.',
      rootCause: null,
    }],
  }]

  it('strict JSON을 파싱하고 모든 입력 이슈의 직접·근본 원인을 보존한다', () => {
    const result = parseIssueAnalysisCauseAreaResponse(
      JSON.stringify({ causeAnalyses: valid }),
      issues,
    )

    expect(result).toEqual({ ok: true, value: valid })
  })

  it('모든 허용 Category를 검증한다', () => {
    const singleIssue = [{ id: 'uuid-1' }]
    const result = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [
        { category: 'strategy_policy', directCause: '정책 원인', rootCause: null },
        { category: 'process', directCause: '프로세스 원인', rootCause: null },
        { category: 'organization', directCause: '조직 원인', rootCause: null },
        { category: 'it', directCause: 'IT 원인', rootCause: null },
      ],
    }], singleIssue)

    expect(result).toMatchObject({ ok: true })
  })

  it('영역 밖·중복·미분석 이슈를 거부한다', () => {
    const foreign = validateIssueAnalysisCauseAnalyses([{
      issueId: 'other-mega',
      causes: [{ category: 'process', directCause: '직접 원인', rootCause: null }],
    }], [{ id: 'uuid-1' }])
    expect(foreign).toMatchObject({ ok: false })
    if (!foreign.ok) expect(foreign.error).toContain('현재')

    const duplicate = validateIssueAnalysisCauseAnalyses([
      valid[0],
      { ...valid[0] },
    ], issues)
    expect(duplicate).toMatchObject({ ok: false })
    if (!duplicate.ok) expect(duplicate.error).toContain('중복')

    const uncovered = validateIssueAnalysisCauseAnalyses([valid[0]], issues)
    expect(uncovered).toMatchObject({ ok: false })
    if (!uncovered.ok) expect(uncovered.error).toMatch(/누락|분석되지|연결되지|일치하지/)
  })

  it('빈 원인·허용되지 않은 Category·잘못된 근본 원인을 거부한다', () => {
    const singleIssue = [{ id: 'uuid-1' }]
    const empty = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [],
    }], singleIssue)
    expect(empty).toMatchObject({ ok: false })

    const unsupported = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [{ category: 'people', directCause: '직접 원인', rootCause: null }],
    }], singleIssue)
    expect(unsupported).toMatchObject({ ok: false })
    if (!unsupported.ok) expect(unsupported.error).toMatch(/category/i)

    const blankDirect = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [{ category: 'process', directCause: '   ', rootCause: null }],
    }], singleIssue)
    expect(blankDirect).toMatchObject({ ok: false })

    const invalidRoot = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [{ category: 'process', directCause: '직접 원인', rootCause: 123 }],
    }], singleIssue)
    expect(invalidRoot).toMatchObject({ ok: false })
  })

  it('이슈당 원인 수·Category 중복·직접 및 근본 원인 길이 상한을 강제한다', () => {
    const singleIssue = [{ id: 'uuid-1' }]
    const tooMany = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: Array.from({ length: 5 }, (_, index) => ({
        category: ['strategy_policy', 'process', 'organization', 'it', 'process'][index],
        directCause: `직접 원인 ${index + 1}`,
        rootCause: null,
      })),
    }], singleIssue)
    expect(tooMany).toMatchObject({ ok: false })

    const duplicateCategory = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [
        { category: 'process', directCause: '직접 원인 1', rootCause: null },
        { category: 'process', directCause: '직접 원인 2', rootCause: null },
      ],
    }], singleIssue)
    expect(duplicateCategory).toMatchObject({ ok: false })
    if (!duplicateCategory.ok) expect(duplicateCategory.error).toContain('중복')

    const longDirect = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [{ category: 'process', directCause: '가'.repeat(401), rootCause: null }],
    }], singleIssue)
    expect(longDirect).toMatchObject({ ok: false })

    const longRoot = validateIssueAnalysisCauseAnalyses([{
      issueId: 'uuid-1',
      causes: [{ category: 'process', directCause: '직접 원인', rootCause: '가'.repeat(801) }],
    }], singleIssue)
    expect(longRoot).toMatchObject({ ok: false })
  })
})

const PROMPT_MAJORS = [
  {
    majorId: 'aaaa0000-0000-4000-8000-000000000001',
    seqLabel: '00.01',
    name: '품목기준정보',
    subProcesses: ['자재 등록'],
    issueCount: 1,
  },
  {
    majorId: 'aaaa0000-0000-4000-8000-000000000002',
    seqLabel: '00.02',
    name: '거래처기준정보',
    subProcesses: [],
    issueCount: 0,
  },
]
const VALID_DEFS = {
  megaDefinition: '기준정보 등록과 표준화를 관리하는 프로세스임',
  majors: [
    {
      majorId: PROMPT_MAJORS[0].majorId,
      definition: '품목 기준정보의 등록과 중복 통제를 관리하는 프로세스',
    },
    {
      majorId: PROMPT_MAJORS[1].majorId,
      definition: '거래처 기준정보를 관리하는 프로세스',
    },
  ],
}

describe('프로세스 정의 검증', () => {
  const majors = PROMPT_MAJORS.map(major => ({ id: major.majorId }))

  it('정상 정의를 입력 majors 순서로 정규화해 통과시킨다', () => {
    const reversed = { ...VALID_DEFS, majors: [...VALID_DEFS.majors].reverse() }
    const result = validateIssueAnalysisProcessDefinitions(reversed, majors)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.majors.map(major => major.majorId))
        .toEqual(majors.map(major => major.id))
    }
  })

  it('입력에 없는 majorId 조작을 거부한다', () => {
    const forged = {
      ...VALID_DEFS,
      majors: [
        VALID_DEFS.majors[0],
        { majorId: 'ffff0000-0000-4000-8000-000000000009', definition: '조작 정의' },
      ],
    }
    expect(validateIssueAnalysisProcessDefinitions(forged, majors).ok).toBe(false)
  })

  it('Major 누락·중복을 거부한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, majors: [VALID_DEFS.majors[0]] }, majors).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, majors: [VALID_DEFS.majors[0], VALID_DEFS.majors[0]] },
      majors,
    ).ok).toBe(false)
  })

  it('길이 상한과 빈 정의를 거부한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, megaDefinition: '가'.repeat(201) }, majors).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      {
        ...VALID_DEFS,
        majors: [
          VALID_DEFS.majors[0],
          { majorId: majors[1].id, definition: '가'.repeat(151) },
        ],
      },
      majors,
    ).ok).toBe(false)
    expect(validateIssueAnalysisProcessDefinitions(
      { ...VALID_DEFS, megaDefinition: '  ' }, majors).ok).toBe(false)
  })

  it('majors가 빈 입력이면 빈 배열 + megaDefinition을 요구한다', () => {
    expect(validateIssueAnalysisProcessDefinitions(
      { megaDefinition: '영역 정의', majors: [] }, []).ok).toBe(true)
    expect(validateIssueAnalysisProcessDefinitions(
      { megaDefinition: '영역 정의', majors: VALID_DEFS.majors }, []).ok).toBe(false)
  })
})

describe('v3 프롬프트·통합 파스', () => {
  it('프롬프트 버전이 v3다', () => {
    expect(ISSUE_ANALYSIS_PROMPT_VERSION).toBe('issue-causes-opportunities-defs-v3')
  })

  it('majors가 minimum envelope에 포함된다', () => {
    const prompt = buildIssueAnalysisMegaPrompt(
      '00',
      '기준관리',
      [reportIssue('uuid-1')],
      PROMPT_MAJORS,
    )
    expect(prompt).toContain('majorId')
    expect(prompt).toContain('00.01')
    expect(prompt).toContain('품목기준정보')
  })

  it('시스템 프롬프트가 processDefinitions 스키마를 요구한다', () => {
    expect(ISSUE_ANALYSIS_SYSTEM_PROMPT).toContain('processDefinitions')
    expect(ISSUE_ANALYSIS_SYSTEM_PROMPT).toContain('megaDefinition')
  })

  it('개선기회+정의를 한 응답에서 파스한다', () => {
    const raw = JSON.stringify({
      opportunities: [{
        title: '기준정보 거버넌스 정립',
        description: '등록 승인과 중복 검사를 표준화한다.',
        issueIds: ['uuid-1'],
      }],
      processDefinitions: VALID_DEFS,
    })
    const result = parseIssueAnalysisAreaGeneration(
      raw,
      [{ id: 'uuid-1' }],
      PROMPT_MAJORS.map(major => ({ id: major.majorId })),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.opportunities).toHaveLength(1)
      expect(result.value.processDefinitions.majors).toHaveLength(2)
    }
  })

  it('정의가 빠진 응답을 거부한다', () => {
    const raw = JSON.stringify({
      opportunities: [{
        title: '기준정보 거버넌스 정립',
        description: '등록 승인과 중복 검사를 표준화한다.',
        issueIds: ['uuid-1'],
      }],
    })
    expect(parseIssueAnalysisAreaGeneration(raw, [{ id: 'uuid-1' }], []).ok).toBe(false)
  })
})
