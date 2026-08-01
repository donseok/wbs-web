// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
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
    startDate: null,
    dueDate: null,
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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('선택 Mega로 목록을 좁히고 같은 범위를 분석서 모달에 전달한다', async () => {
    await act(async () => {
      root.render(
        <IssuesView
          projectId="project-1"
          currentUserId="user-1"
          role="team_editor"
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
    expect(titleCell?.className).toContain('whitespace-nowrap')
    expect(container.querySelector('table')?.className).toContain('min-w-[1260px]')

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
