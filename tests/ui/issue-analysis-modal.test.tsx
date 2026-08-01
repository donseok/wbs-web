// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisReport,
} from '@/lib/report/issues/model'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { ensureIssueAnalysisAction } = vi.hoisted(() => ({
  ensureIssueAnalysisAction: vi.fn(),
}))
vi.mock('@/app/actions/issueAnalysis', () => ({ ensureIssueAnalysisAction }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))

import { IssueAnalysisModal } from '@/components/issues/IssueAnalysisModal'

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    issueNo: 1,
    piIssueCode: 'PI-I-02-01',
    projectId: 'project-1',
    megaCode: '02',
    megaSeq: 1,
    title: '수기 주문 처리',
    body: '주문 승인과 입력이 수기로 이원화되어 처리 시간이 길다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: [],
    startDate: null,
    dueDate: null,
    subProcess: '02.02 주문관리',
    ownerDepartment: '영업관리팀',
    relatedSystems: ['ERP'],
    sourceType: 'interview',
    sourceDetail: '영업관리팀 인터뷰',
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '홍길동',
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
    ...overrides,
  }
}

describe('IssueAnalysisModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ensureIssueAnalysisAction.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove())
  })

  it('Major 미지정 이슈가 있으면 (미지정) 표시 예고를 보여준다', async () => {
    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project-1"
          issues={[issue({ majorId: null })]}
        />,
      )
    })

    expect(document.body.textContent).toContain('issue.analysis.majorUnsetNotice')
  })

  it('모든 이슈에 Major가 지정되면 미지정 안내가 없다', async () => {
    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project-1"
          issues={[issue({ majorId: 'major-1', majorSeq: 1, majorName: '주문관리' })]}
        />,
      )
    })

    expect(document.body.textContent).not.toContain('issue.analysis.majorUnsetNotice')
  })

  it('필수 메타가 빠진 이슈가 있으면 생성 호출 전에 차단하고 사유를 보여준다', async () => {
    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project-1"
          issues={[issue({
            megaCode: null,
            megaSeq: null,
            piIssueCode: null,
            subProcess: '',
          })]}
        />,
      )
    })

    const generate = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.generate')) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    expect(document.body.textContent).toContain('Mega 영역이 지정되지 않았습니다.')
    expect(document.body.textContent).toContain('Sub Process가 없습니다.')
    expect(ensureIssueAnalysisAction).not.toHaveBeenCalled()
  })

  it('서버 검증·AI 결과와 템플릿 차단 상태를 한 화면에 표시한다', async () => {
    const current = issue()
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [current])
    const analysis = buildIssueAnalysisReport(snapshot, {
      '02': [{
        title: '주문 승인·입력 통합',
        description: '중복 수기 단계를 하나의 승인 흐름으로 통합한다.',
        issueIds: [current.id],
      }],
    }, '2026-07-31T10:00:00Z')
    ensureIssueAnalysisAction.mockResolvedValue({
      ok: true,
      state: 'generated',
      runId: 'run-1',
      analysis,
      preflight: null,
      template: {
        status: 'missing',
        message: '보호 해제된 표준 PPTX가 필요합니다.',
        path: 'src/lib/report/assets/issue-analysis-template.pptx',
      },
      pptExport: {
        status: 'unavailable',
        code: 'PPT_RENDERER_UNAVAILABLE',
        message: '배포용 PPT 생성 엔진 선택이 필요합니다.',
      },
    })

    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project-1"
          issues={[current]}
        />,
      )
    })

    const generate = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.generate')) as HTMLButtonElement
    await act(async () => {
      generate.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ensureIssueAnalysisAction).toHaveBeenCalledWith('project-1', 'all')
    expect(document.body.textContent).toContain('주문 승인·입력 통합')
    expect(document.body.textContent).toContain('PI-I-02-01')
    expect(document.body.textContent).toContain('보호 해제된 표준 PPTX가 필요합니다.')
    const download = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.download')) as HTMLButtonElement
    expect(download.disabled).toBe(true)
  })

  it('선택 Mega만 사전 점검하고 같은 범위를 서버 액션에 전달한다', async () => {
    const current = issue()
    const blockedOtherArea = issue({
      id: 'issue-00',
      megaCode: '00',
      megaSeq: 1,
      piIssueCode: 'PI-I-00-01',
      subProcess: '',
    })
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [current])
    const analysis = buildIssueAnalysisReport(snapshot, {
      '02': [{
        title: '주문 통합',
        description: '표준 승인 흐름으로 통합한다.',
        issueIds: [current.id],
      }],
    }, '2026-07-31T10:00:00Z')
    ensureIssueAnalysisAction.mockResolvedValue({
      ok: true,
      state: 'ready',
      runId: 'run-sales',
      analysis,
      preflight: null,
      template: { status: 'ready', message: '사용 가능', path: 'template.pptx' },
      pptExport: { status: 'ready', code: 'PPT_EXPORT_READY', message: '다운로드 가능' },
    })

    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project-1"
          issues={[current, blockedOtherArea]}
          megaFilter="02"
        />,
      )
    })

    expect(document.body.textContent).toContain('02 · 영업')
    expect(document.body.textContent).toContain('issue.analysis.readyCount')
    expect(document.body.textContent).not.toContain('Sub Process가 없습니다.')
    const generate = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.generate')) as HTMLButtonElement
    expect(generate.disabled).toBe(false)

    await act(async () => {
      generate.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ensureIssueAnalysisAction).toHaveBeenCalledWith('project-1', '02')
  })

  it('템플릿과 렌더러가 모두 준비되면 저장 runId 다운로드 링크를 연다', async () => {
    const current = issue()
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [current])
    const analysis = buildIssueAnalysisReport(snapshot, {
      '02': [{
        title: '주문 통합',
        description: '표준 승인 흐름으로 통합한다.',
        issueIds: [current.id],
      }],
    }, '2026-07-31T10:00:00Z')
    ensureIssueAnalysisAction.mockResolvedValue({
      ok: true,
      state: 'ready',
      runId: 'run/with space',
      analysis,
      preflight: null,
      template: {
        status: 'ready',
        message: '사용 가능',
        path: 'src/lib/report/assets/issue-analysis-template.pptx',
      },
      pptExport: {
        status: 'ready',
        code: 'PPT_EXPORT_READY',
        message: '다운로드 가능',
      },
    })

    await act(async () => {
      root.render(
        <IssueAnalysisModal
          open
          onClose={() => undefined}
          projectId="project/with space"
          issues={[current]}
        />,
      )
    })
    const generate = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.generate')) as HTMLButtonElement
    await act(async () => {
      generate.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const download = [...document.querySelectorAll('a')]
      .find(link => link.textContent?.includes('issue.analysis.download')) as HTMLAnchorElement
    expect(download.href).toContain(
      '/api/issue-analysis?projectId=project%2Fwith%20space&runId=run%2Fwith%20space',
    )
  })
})
