// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { TeamsProvider } from '@/components/app/TeamsProvider'
import { IssueAssigneePicker } from '@/components/issues/IssueAssigneePicker'
import { MeetingAttendeePicker } from '@/components/meetings/MeetingAttendeePicker'
import { LocaleProvider } from '@/components/providers/LocaleProvider'
import type { Team } from '@/lib/domain/teams'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'

const TEAMS: Team[] = [
  { id: 'team-erp', code: 'ERP', sortOrder: 20, active: true, progressVisible: true },
  { id: 'team-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
  { id: 'team-mes', code: 'MES', sortOrder: 10, active: true, progressVisible: true },
]

function member(
  id: string,
  name: string,
  teamCode: TeamCode | null,
  email: string | null = `${id}@example.com`,
): ProjectMember {
  return {
    id,
    projectId: 'project-1',
    name,
    email,
    teamCode,
    role: 'contributor',
    title: null,
    hasAccount: true,
    createdAt: '2026-08-02T00:00:00.000Z',
  }
}

// 입력 배열은 의도적으로 이름순·팀순 모두 섞어 둔다.
const MEMBERS: ProjectMember[] = [
  member('legacy-1', '마루', '과거팀'),
  member('erp-2', '사랑', 'ERP'),
  member('pmo-2', '라온', 'PMO', null),
  member('mes-1', '가람', 'MES'),
  member('none-1', '바다', null, null),
  member('erp-1', '나래', 'ERP'),
  member('pmo-1', '다온', 'PMO'),
]

type PickerKind = 'issue' | 'meeting'

describe('이슈·회의 담당자 선택기 공통 보기', () => {
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

  async function renderPicker(
    kind: PickerKind,
    { selected = [], onChange = vi.fn() }: { selected?: string[]; onChange?: (ids: string[]) => void } = {},
  ) {
    const Picker = kind === 'issue' ? IssueAssigneePicker : MeetingAttendeePicker
    await act(async () => {
      root.render(
        <LocaleProvider>
          <TeamsProvider teams={TEAMS}>
            <Picker members={MEMBERS} selected={selected} onChange={onChange} />
          </TeamsProvider>
        </LocaleProvider>,
      )
    })
  }

  function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(candidate => candidate.textContent === label)
    if (!found) throw new Error(`버튼을 찾을 수 없음: ${label}`)
    return found
  }

  function memberRows(): HTMLLabelElement[] {
    return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .map(input => input.closest('label'))
      .filter((label): label is HTMLLabelElement => label !== null)
  }

  function visibleNames(): string[] {
    return memberRows().map(row => {
      const name = MEMBERS.find(candidate => row.textContent?.startsWith(candidate.name))?.name
      if (!name) throw new Error(`멤버 행에서 이름을 찾을 수 없음: ${row.textContent}`)
      return name
    })
  }

  function categoryHeadings(): string[] {
    return [...container.querySelectorAll<HTMLDivElement>('div.sticky')]
      .map(heading => heading.firstElementChild?.textContent ?? '')
  }

  function checkboxFor(name: string): HTMLInputElement {
    const row = memberRows().find(candidate => candidate.textContent?.startsWith(name))
    const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!input) throw new Error(`체크박스를 찾을 수 없음: ${name}`)
    return input
  }

  async function click(element: HTMLElement) {
    await act(async () => element.click())
  }

  async function typeSearch(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="이름·팀 검색"]')
    if (!input) throw new Error('검색 입력을 찾을 수 없음')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return input
  }

  it.each<PickerKind>(['issue', 'meeting'])('%s 선택기는 기본 가나다순이고 담당 카테고리별 보기로 전환된다', async kind => {
    await renderPicker(kind)

    expect(button('이름순').getAttribute('aria-pressed')).toBe('true')
    expect(button('담당 카테고리별').getAttribute('aria-pressed')).toBe('false')
    expect(visibleNames()).toEqual(['가람', '나래', '다온', '라온', '마루', '바다', '사랑'])
    expect(categoryHeadings()).toEqual([])

    await click(button('담당 카테고리별'))

    expect(button('이름순').getAttribute('aria-pressed')).toBe('false')
    expect(button('담당 카테고리별').getAttribute('aria-pressed')).toBe('true')
    // 프로젝트 팀 마스터 순서(PMO → MES → ERP), 목록에만 있는 과거팀, 미지정 순이다.
    expect(categoryHeadings()).toEqual(['PMO', 'MES', 'ERP', '과거팀', '담당 미지정'])
    expect(visibleNames()).toEqual(['다온', '라온', '가람', '나래', '사랑', '마루', '바다'])
  })

  it.each<PickerKind>(['issue', 'meeting'])('%s 선택기는 보기 전환 뒤에도 검색어·선택 상태를 유지한다', async kind => {
    const onChange = vi.fn<(ids: string[]) => void>()
    await renderPicker(kind, { selected: ['erp-1'], onChange })

    const search = await typeSearch('PMO')
    expect(search.value).toBe('PMO')
    expect(visibleNames()).toEqual(['다온', '라온'])
    expect(container.textContent).toContain('1명 선택')

    await click(button('담당 카테고리별'))

    expect(search.value).toBe('PMO')
    expect(categoryHeadings()).toEqual(['PMO'])
    expect(onChange).not.toHaveBeenCalled()

    await typeSearch('')
    expect(checkboxFor('나래').checked).toBe(true)
    await click(checkboxFor('다온'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['erp-1', 'pmo-1'])
  })

  it('이메일 누락 경고는 회의 참석자 선택기에만 표시된다', async () => {
    const warning = '이메일 없음 — 내 회의에 표시되지 않을 수 있습니다.'

    await renderPicker('meeting')
    expect(container.querySelectorAll(`[title="${warning}"]`)).toHaveLength(2)

    await renderPicker('issue')
    expect(container.querySelectorAll(`[title="${warning}"]`)).toHaveLength(0)
  })
})
