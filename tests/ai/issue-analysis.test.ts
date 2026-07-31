import { describe, expect, it } from 'vitest'
import type { IssueAnalysisReportIssue } from '@/lib/report/issues/model'
import {
  ISSUE_ANALYSIS_MAX_MEGA_PROMPT_CHARS,
  buildIssueAnalysisMegaPrompt,
  issueAnalysisInputHash,
  parseIssueAnalysisAreaResponse,
  validateIssueAnalysisOpportunities,
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
