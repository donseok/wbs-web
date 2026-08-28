// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/p1/issues',
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/components/issues/IssueModals', () => ({
  DeleteIssueModal: () => null,
  IssueDetailModal: () => null,
  IssueFormModal: () => null,
}))
vi.mock('@/components/issues/IssueAnalysisModal', () => ({
  IssueAnalysisModal: ({ open, megaFilter }: { open: boolean; megaFilter: string }) => (
    open ? <div data-analysis-mega={megaFilter} /> : null
  ),
}))

import { IssuesView } from '@/components/issues/IssuesView'

function issue(id: string, megaCode: '00' | '02', title: string): Issue {
  return {
    id,
    issueNo: megaCode === '00' ? 1 : 2,
    piIssueCode: `PI-I-${megaCode}-01`,
    projectId: 'project-1',
    megaCode,
    megaSeq: 1,
    title,
    body: '본문',
    status: 'open',
    severity: 'medium',
    assigneeMemberIds: [],
    startDate: '2026-07-01',
    dueDate: '2026-08-31',
    subProcess: '업무 처리',
    ownerDepartment: 'PI팀',
    relatedSystems: ['ERP'],
    sourceType: 'interview',
    sourceDetail: '현업 인터뷰',
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '테스터',
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
  }
}

describe('IssuesView Mega 필터', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.toast.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('Mega 전체에서는 분석서 모달을 열지 않고 한 가지 선택 경고를 표시한다', async () => {
    await act(async () => {
      root.render(
        <IssuesView
          projectId="project-1"
          currentUserId="user-1"
          role="team_editor"
          isProjectAdmin={false}
          myMemberIds={[]}
          today="2026-07-31"
          members={[]}
          issues={[issue('issue-00', '00', '기준정보 중복')]}
        />,
      )
    })

    const analysisButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.open'))
    await act(async () => analysisButton?.click())

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'issue.analysis.selectOneMega',
      variant: 'error',
    })
    expect(container.querySelector('[data-analysis-mega]')).toBeNull()
  })

  it('선택 Mega로 목록을 좁히고 같은 범위를 분석서 모달에 전달한다', async () => {
    await act(async () => {
      root.render(
        <IssuesView
          projectId="project-1"
          currentUserId="user-1"
          role="team_editor"
          isProjectAdmin={false}
          myMemberIds={[]}
          today="2026-07-31"
          members={[]}
          issues={[
            issue('issue-00', '00', '기준정보 중복'),
            issue('issue-02', '02', '주문 승인 지연'),
          ]}
        />,
      )
    })

    const mega = container.querySelector<HTMLSelectElement>(
      'select[aria-label="issue.filter.mega"]',
    )
    expect(mega).not.toBeNull()
    expect(mega?.textContent).toContain('00 · 기준관리')
    expect(mega?.textContent).toContain('02 · 영업')
    expect(container.textContent).toContain('issue.col.mega')
    expect(container.textContent).toContain('00 · 기준관리')
    expect(container.textContent).toContain('02 · 영업')

    const titleCell = [...container.querySelectorAll('td')]
      .find(cell => cell.textContent === '기준정보 중복')
    expect(titleCell?.className).toContain('whitespace-normal')
    expect(titleCell?.className).toContain('break-words')
    expect(titleCell?.className).not.toContain('whitespace-nowrap')
    expect(container.querySelector('table')?.className).toContain('table-fixed')
    expect(container.querySelectorAll('colgroup col')).toHaveLength(10)
    expect(container.querySelector('table')?.className).not.toContain('min-w-[')
    expect(container.querySelector('table')?.parentElement?.className).not.toContain('overflow-x-auto')
    expect(container.textContent).toContain('issue.col.endDate')
    expect(container.textContent).toContain('2026-08-31')
    expect(container.textContent).toContain('2026-07-01') // 시작일자 열 — 2026-08-28 사용자 요청으로 표시
    expect(container.textContent).not.toContain('2026-07-31')
    expect(container.textContent).toContain('테스터')
    const reporterCell = [...container.querySelectorAll('td')]
      .find(cell => cell.textContent === '테스터')
    expect(reporterCell?.className).toContain('break-words')
    expect(reporterCell?.className).not.toContain('overflow-hidden')

    await act(async () => {
      if (!mega) return
      mega.value = '02'
      mega.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('주문 승인 지연')
    expect(container.textContent).not.toContain('기준정보 중복')

    const analysisButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('issue.analysis.open'))
    await act(async () => analysisButton?.click())

    expect(container.querySelector('[data-analysis-mega="02"]')).not.toBeNull()
  })
})
