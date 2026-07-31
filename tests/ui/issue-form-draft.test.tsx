// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const router = { refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (key: string) => key }),
}))
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true, id: 'default-issue' })),
  updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({ ok: true })),
}))

import { DeleteIssueModal, IssueDetailModal, IssueFormModal } from '@/components/issues/IssueModals'
import type { Issue } from '@/lib/domain/issues'

describe('IssueFormModal 회의록 초안', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    router.refresh.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove())
  })

  function labelInput(labelKey: string): HTMLInputElement {
    const label = [...document.querySelectorAll('label')]
      .find(node => node.textContent?.includes(labelKey))
    const input = label?.querySelector('input')
    if (!(input instanceof HTMLInputElement)) throw new Error(`${labelKey} input not found`)
    return input
  }

  function labelSelect(labelKey: string): HTMLSelectElement {
    const label = [...document.querySelectorAll('label')]
      .find(node => node.textContent?.includes(labelKey))
    const select = label?.querySelector('select')
    if (!(select instanceof HTMLSelectElement)) throw new Error(`${labelKey} select not found`)
    return select
  }

  const analysisDraft = {
    megaCode: '02' as const,
    subProcess: ' 02.02 주문관리 ',
    ownerDepartment: ' 영업관리팀 ',
    relatedSystems: [' SAP ', 'MES', 'SAP'],
  }

  const issue = (over: Partial<Issue> = {}): Issue => ({
    id: 'issue-1',
    issueNo: 17,
    projectId: 'project-1',
    title: '주문 처리 지연',
    body: '주문 승인 대기 시간이 길다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: [],
    startDate: null,
    dueDate: null,
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '홍길동',
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-27T00:00:00Z',
    megaCode: '02',
    megaSeq: 3,
    piIssueCode: 'PI-I-02-03',
    subProcess: '02.02 주문관리',
    ownerDepartment: '영업관리팀',
    relatedSystems: ['SAP', 'MES'],
    sourceType: 'interview',
    sourceDetail: '영업관리팀 인터뷰',
    ...over,
  })

  it('선택 블록·기간 초안을 표시하고 커스텀 생성 액션으로 전달한다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'linked-issue' }))
    const onCreated = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={onClose}
          projectId="project-1"
          initial={null}
          members={[]}
          draft={{
            ...analysisDraft,
            title: '전환 지연 위험',
            body: '인터페이스 전환 지연 위험을 확인한다.',
            severity: 'high',
            startDate: '2026-07-27',
            dueDate: '2026-08-03',
            sourceType: 'other',
          }}
          sourcePreview={{
            title: '주간회의',
            date: '2026-07-27',
            excerpt: '인터페이스 전환 지연 위험을 확인한다.',
          }}
          onCreate={onCreate}
          onCreated={onCreated}
        />,
      )
    })

    expect(document.body.textContent).toContain('주간회의')
    expect(document.body.textContent).toContain('인터페이스 전환 지연 위험을 확인한다.')
    expect(labelInput('issue.form.title').value).toBe('전환 지연 위험')
    expect(labelInput('issue.form.start').value).toBe('2026-07-27')
    expect(labelInput('issue.form.due').value).toBe('2026-08-03')
    expect(labelSelect('issue.analysis.mega').value).toBe('02')
    expect(labelSelect('issue.analysis.sourceType').value).toBe('minutes')
    expect(labelSelect('issue.analysis.sourceType').disabled).toBe(true)
    expect(labelInput('issue.analysis.sourceDetail').value).toBe('주간회의 · 2026-07-27')
    expect(document.body.textContent).toContain('issue.analysis.minuteAutoLinked')

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    await act(async () => {
      save.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith('project-1', expect.objectContaining({
      title: '전환 지연 위험',
      body: '인터페이스 전환 지연 위험을 확인한다.',
      severity: 'high',
      startDate: '2026-07-27',
      dueDate: '2026-08-03',
      megaCode: '02',
      subProcess: '02.02 주문관리',
      ownerDepartment: '영업관리팀',
      relatedSystems: ['SAP', 'MES'],
      sourceType: 'minutes',
      sourceDetail: '주간회의 · 2026-07-27',
    }))
    expect(onCreated).toHaveBeenCalledWith('linked-issue')
    expect(onClose).toHaveBeenCalled()
  })

  it('역전된 기간은 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={() => undefined}
          projectId="project-1"
          initial={null}
          members={[]}
          draft={{
            title: '기간 확인',
            startDate: '2026-08-04',
            dueDate: '2026-08-03',
          }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.dateRange')
  })

  it('저장 요청 중에는 취소로 닫거나 같은 요청을 중복 전송하지 않는다', async () => {
    let finish!: (value: { ok: true; id: string }) => void
    const onCreate = vi.fn(() => new Promise<{ ok: true; id: string }>(resolve => {
      finish = resolve
    }))
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={onClose}
          projectId="project-1"
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: '중복 생성 방지' }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    const cancel = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.cancel') as HTMLButtonElement
    await act(async () => {
      save.click()
      save.click()
      cancel.click()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      finish({ ok: true, id: 'linked-issue' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('일반 신규는 기타 원천으로 시작하고 필수 분석 정보와 관련 시스템을 정규화한다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'manual-issue' }))
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={() => undefined}
          projectId="project-1"
          initial={null}
          members={[]}
          draft={{ ...analysisDraft, title: '수기 등록 이슈' }}
          onCreate={onCreate}
        />,
      )
    })

    expect(labelSelect('issue.analysis.sourceType').value).toBe('other')
    expect(labelSelect('issue.analysis.sourceType').disabled).toBe(false)

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    await act(async () => {
      save.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith('project-1', expect.objectContaining({
      megaCode: '02',
      subProcess: '02.02 주문관리',
      ownerDepartment: '영업관리팀',
      relatedSystems: ['SAP', 'MES'],
      sourceType: 'other',
      sourceDetail: '',
    }))
  })

  it('Mega·Sub Process·주관 부서·원천 누락은 서버 호출 전에 막는다', async () => {
    const onCreate = vi.fn(async () => ({ ok: true, id: 'should-not-create' }))
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={() => undefined}
          projectId="project-1"
          initial={null}
          members={[]}
          draft={{ title: '분석 정보 누락' }}
          onCreate={onCreate}
        />,
      )
    })

    const save = [...document.querySelectorAll('button')]
      .find(button => button.textContent === 'issue.form.save') as HTMLButtonElement
    act(() => save.click())

    expect(onCreate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('issue.err.megaRequired')
  })

  it('발급된 PI ID가 있으면 Mega를 잠그고 상세에서 분석 메타와 기존 번호를 함께 표시한다', async () => {
    const current = issue()
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={() => undefined}
          projectId="project-1"
          initial={current}
          members={[]}
        />,
      )
    })

    expect(labelSelect('issue.analysis.mega').disabled).toBe(true)

    await act(async () => {
      root.render(
        <IssueDetailModal
          issue={current}
          members={[]}
          memberName={() => null}
          canEdit={false}
          today="2026-07-31"
          onClose={() => undefined}
          onEdit={() => undefined}
          onDelete={() => undefined}
        />,
      )
    })

    expect(document.body.textContent).toContain('PI-I-02-03 · #17')
    expect(document.body.textContent).toContain('02 · 영업')
    expect(document.body.textContent).toContain('02.02 주문관리')
    expect(document.body.textContent).toContain('영업관리팀')
    expect(document.body.textContent).toContain('SAP')
    expect(document.body.textContent).toContain('issue.source.type.interview')
    expect(document.body.textContent).toContain('영업관리팀 인터뷰')

    await act(async () => {
      root.render(<DeleteIssueModal issue={current} onClose={() => undefined} />)
    })
    expect(document.body.textContent).toContain('PI-I-02-03 · #17')
  })

  it('기존 미분류 이슈는 편집에서 최초 Mega 분류가 가능하다', async () => {
    await act(async () => {
      root.render(
        <IssueFormModal
          open
          onClose={() => undefined}
          projectId="project-1"
          initial={issue({
            megaCode: null,
            megaSeq: null,
            piIssueCode: null,
            subProcess: '',
            ownerDepartment: '',
            relatedSystems: [],
            sourceType: null,
            sourceDetail: '',
          })}
          members={[]}
        />,
      )
    })

    expect(labelSelect('issue.analysis.mega').value).toBe('')
    expect(labelSelect('issue.analysis.mega').disabled).toBe(false)
    expect(labelSelect('issue.analysis.sourceType').value).toBe('')
  })
})
