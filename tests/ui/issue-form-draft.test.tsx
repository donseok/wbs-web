// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const router = { refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/actions/issues', () => ({
  createIssue: vi.fn(async () => ({ ok: true, id: 'default-issue' })),
  updateIssue: vi.fn(async () => ({ ok: true })),
  updateIssueProgress: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({ ok: true })),
}))

import { IssueFormModal } from '@/components/issues/IssueModals'

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
            title: '전환 지연 위험',
            body: '인터페이스 전환 지연 위험을 확인한다.',
            severity: 'high',
            startDate: '2026-07-27',
            dueDate: '2026-08-03',
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
          draft={{ title: '중복 생성 방지' }}
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
})
