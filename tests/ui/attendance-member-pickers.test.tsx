// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMember } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => {
  const labels: Record<string, string> = {
    'ui.memberPicker.viewLabel': '보기 방식',
    'ui.memberPicker.nameOrder': '이름순',
    'ui.memberPicker.categoryOrder': '담당 카테고리별',
    'ui.memberPicker.unassigned': '담당 미지정',
    'att.memberFilter': '멤버 필터',
    'att.allMembers': '전체 멤버',
    'att.addRecord': '근태 등록',
    'att.form.member': '멤버',
  }
  return {
    useLocale: () => ({ locale: 'ko', t: (key: string) => labels[key] ?? key }),
  }
})
vi.mock('@/app/actions/attendance', () => ({
  upsertAttendance: vi.fn(async () => ({ ok: true })),
  removeAttendance: vi.fn(async () => ({ ok: true })),
}))

import { AttendanceView } from '@/components/attendance/AttendanceView'

const MEMBERS: ProjectMember[] = [
  member('member-mes', '나메스', 'MES'),
  member('member-erp', '가이알피', 'ERP'),
  member('member-none', '다미지정', null),
  member('member-pmo', '라피엠오', 'PMO'),
]

function member(id: string, name: string, teamCode: string | null): ProjectMember {
  return {
    id,
    projectId: 'project-1',
    name,
    email: null,
    teamCode,
    role: 'contributor',
    title: null,
    hasAccount: true,
    createdAt: '2026-08-01T00:00:00Z',
  }
}

function viewButtons(scope: ParentNode): HTMLButtonElement[] {
  const group = scope.querySelector<HTMLElement>('[role="group"][aria-label="보기 방식"]')
  expect(group).not.toBeNull()
  const buttons = [...group!.querySelectorAll<HTMLButtonElement>('button')]
  expect(buttons.map(button => button.textContent)).toEqual(['이름순', '담당 카테고리별'])
  return buttons
}

function categoryLabels(select: HTMLSelectElement): string[] {
  return [...select.children]
    .filter((child): child is HTMLOptGroupElement => child instanceof HTMLOptGroupElement)
    .map(group => group.label)
}

async function selectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('AttendanceView 멤버 선택 보기 방식', () => {
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

  async function renderAttendance() {
    await act(async () => {
      root.render(
        <AttendanceView
          projectId="project-1"
          records={[]}
          members={MEMBERS}
          initialDate="2026-08-02"
          canEdit
        />,
      )
    })
  }

  it('상단 멤버 필터를 이름순과 담당 카테고리별로 전환해도 선택값을 유지한다', async () => {
    await renderAttendance()

    const filter = container.querySelector<HTMLSelectElement>('select[aria-label="멤버 필터"]')!
    const [nameOrder, categoryOrder] = viewButtons(container)
    expect(nameOrder.getAttribute('aria-pressed')).toBe('true')
    expect([...filter.options].map(option => option.value)).toEqual([
      'all', 'member-erp', 'member-mes', 'member-none', 'member-pmo',
    ])

    await selectValue(filter, 'member-mes')
    await act(async () => categoryOrder.click())

    expect(filter.value).toBe('member-mes')
    expect(categoryOrder.getAttribute('aria-pressed')).toBe('true')
    expect(categoryLabels(filter)).toEqual([
      'PMO (1)', 'ERP (1)', 'MES (1)', '담당 미지정 (1)',
    ])

    await act(async () => nameOrder.click())
    expect(filter.value).toBe('member-mes')
    expect(categoryLabels(filter)).toEqual([])
  })

  it('근태 등록 모달에도 동일한 보기 옵션과 미지정 그룹을 제공하고 선택값을 유지한다', async () => {
    await renderAttendance()
    const addButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '근태 등록')!
    await act(async () => addButton.click())

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const topFilter = container.querySelector<HTMLSelectElement>('select[aria-label="멤버 필터"]')!
    const memberSelect = dialog.querySelector<HTMLSelectElement>('#attendance-member')!
    const [, categoryOrder] = viewButtons(dialog)
    expect(document.querySelectorAll('[role="group"][aria-label="보기 방식"]')).toHaveLength(2)

    await selectValue(topFilter, 'member-erp')
    await selectValue(memberSelect, 'member-none')
    await act(async () => categoryOrder.click())

    const expectedGroups = ['PMO (1)', 'ERP (1)', 'MES (1)', '담당 미지정 (1)']
    expect(categoryLabels(topFilter)).toEqual(expectedGroups)
    expect(categoryLabels(memberSelect)).toEqual(expectedGroups)
    expect(topFilter.value).toBe('member-erp')
    expect(memberSelect.value).toBe('member-none')

    const [nameOrder] = viewButtons(dialog)
    await act(async () => nameOrder.click())
    expect(topFilter.value).toBe('member-erp')
    expect(memberSelect.value).toBe('member-none')
  })
})
