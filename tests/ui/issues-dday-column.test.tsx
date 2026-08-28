// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/domain/issues'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/p/p1/issues',
}))
// D-day 템플릿 키만 실제 값으로 — 나머지 키는 그대로 돌려줘 열 존재를 키 이름으로 확인한다.
const DICT: Record<string, string> = { 'issue.dday.left': 'D-{n}일', 'issue.dday.over': 'D+{n}일' }
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => DICT[key] ?? key }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/issues/IssueModals', () => ({
  DeleteIssueModal: () => null, IssueDetailModal: () => null, IssueFormModal: () => null,
}))
vi.mock('@/components/issues/IssueAnalysisModal', () => ({ IssueAnalysisModal: () => null }))

import { IssuesView } from '@/components/issues/IssuesView'

const TODAY = '2026-08-28'
let seq = 0
function issue(over: Partial<Issue>): Issue {
  seq += 1
  return {
    id: `i${seq}`, issueNo: seq, piIssueCode: `PI-I-00-0${seq}`, projectId: 'p1', megaCode: '00', megaSeq: seq,
    title: `이슈 ${seq}`, body: '', status: 'open', severity: 'medium', assigneeMemberIds: [],
    startDate: '2026-07-01', dueDate: null, subProcess: '', ownerDepartment: '', relatedSystems: [],
    sourceType: null, sourceDetail: '', minuteSources: [], resolutionNote: '', resolvedAt: null,
    createdBy: 'u1', createdByName: '테스터', createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
    ...over,
  }
}

describe('IssuesView 시작일자·남은일수 열', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const issues = [
    issue({ title: '닷새 남음', dueDate: '2026-09-02' }),                                   // D-5 → 빨강
    issue({ title: '스무날 남음', dueDate: '2026-09-17' }),                                  // D-20
    issue({ title: '사흘 경과', dueDate: '2026-08-25' }),                                   // D+3 → 빨강
    issue({ title: '해결됨', dueDate: '2026-09-01', status: 'resolved', resolvedAt: '2026-08-20T00:00:00Z' }),
    issue({ title: '기한 없음', startDate: null }),
  ]
  const render = () => act(async () => root.render(
    <IssuesView issues={issues} members={[]} projectId="p1" currentUserId={null} role={null} isProjectAdmin={false} myMemberIds={[]} today={TODAY} />,
  ))
  const cellOf = (text: string) => [...container.querySelectorAll('td')].find(td => td.textContent === text)

  it('헤더에 시작일자·남은일수 열이 종료일자 양옆에 있다', async () => {
    await render()
    const heads = [...container.querySelectorAll('th')].map(th => th.textContent)
    const i = heads.indexOf('issue.col.startDate')
    expect(i).toBeGreaterThan(0)
    expect(heads[i + 1]).toBe('issue.col.endDate')
    expect(heads[i + 2]).toBe('issue.col.daysLeft')
  })

  it('시작일자를 행마다 표시하고 없으면 —', async () => {
    await render()
    expect([...container.querySelectorAll('td')].filter(td => td.textContent === '2026-07-01')).toHaveLength(4)
    const row = cellOf('기한 없음')!.closest('tr')!
    expect([...row.querySelectorAll('td')].filter(td => td.textContent === '—').length).toBeGreaterThanOrEqual(2)
  })

  it('남은일수는 D-N일 / D+N일, 7일 이내와 경과는 빨강, 해결·기한 없음은 —', async () => {
    await render()
    const d5 = cellOf('D-5일')!, d20 = cellOf('D-20일')!, over3 = cellOf('D+3일')!
    expect(d5.className).toContain('text-delayed')
    expect(over3.className).toContain('text-delayed')
    expect(d20.className).not.toContain('text-delayed')
    const resolvedRow = cellOf('해결됨')!.closest('tr')!
    expect(resolvedRow.textContent).not.toMatch(/D[-+]\d/)
  })
})
