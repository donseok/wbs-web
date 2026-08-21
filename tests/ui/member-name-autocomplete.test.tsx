// @vitest-environment jsdom
// 멤버 추가 다이얼로그 이름 자동완성 — 이메일이 사람의 전역 키라서 기존 인물은
// 기존 이름 그대로 입력해야만 저장된다. 후보 선택 → 폼 자동 채움 + 이름·이메일
// 잠금으로 "같은 사람, 다른 표기" 서버 거부 함정을 없애는 흐름을 검증한다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMember } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { searchMemberCandidates } = vi.hoisted(() => ({
  searchMemberCandidates: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k, locale: 'ko' }),
}))
vi.mock('@/app/actions/members', () => ({ addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn() }))
// 서버 액션은 병렬 구현 중 — 계약 시그니처만 mock 한다.
vi.mock('@/app/actions/memberSearch', () => ({ searchMemberCandidates }))

import { MembersBoard } from '@/components/members/MembersBoard'

const EXISTING: ProjectMember = {
  id: 'm1', projectId: 'p1', name: '홍춘식', email: 'chunsik@example.com',
  teamCode: 'PMO', role: 'admin', title: null, roleLabel: null, hasAccount: true, createdAt: '2026-01-01',
}

const CANDIDATES = [
  { name: '홍길동', email: 'gil@example.com', teamCode: 'PMO', title: '수석', roleLabel: 'PM' },
  { name: '홍판서', email: null, teamCode: null, title: null, roleLabel: null },
]

describe('멤버 추가 다이얼로그 이름 자동완성', () => {
  let container: HTMLDivElement, root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    searchMemberCandidates.mockReset()
    searchMemberCandidates.mockResolvedValue({ ok: true, candidates: CANDIDATES })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function mount(members: ProjectMember[] = [EXISTING]) {
    await act(async () => root.render(<MembersBoard projectId="p1" members={members} canEdit={true} />))
  }

  function buttonByText(text: string): HTMLButtonElement {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(b => b.textContent?.includes(text))
    if (!found) throw new Error(`버튼을 찾을 수 없음: ${text}`)
    return found
  }

  async function openAdd() {
    await act(async () => buttonByText('members.addMember').click())
  }

  function input(placeholderKey: string): HTMLInputElement {
    const el = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholderKey}"]`)
    if (!el) throw new Error(`입력을 찾을 수 없음: ${placeholderKey}`)
    return el
  }
  const nameInput = () => input('members.phName')
  const emailInput = () => input('members.phEmail')
  const titleInput = () => input('members.phTitle')

  async function type(el: HTMLInputElement, value: string) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
    // 검색 promise 해소분 플러시
    await act(async () => {})
  }

  async function key(el: HTMLElement, keyName: string) {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }))
    })
  }

  const listbox = () => document.querySelector<HTMLUListElement>('[role="listbox"]')
  const options = () => [...document.querySelectorAll<HTMLLIElement>('[role="option"]')]

  it('2자 미만이면 검색을 호출하지 않는다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍')
    await advance(400)
    expect(searchMemberCandidates).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
  })

  it('250ms 디바운스 후 검색하고 후보를 렌더한다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍길')
    await advance(200)
    expect(searchMemberCandidates).not.toHaveBeenCalled()
    await advance(100)
    expect(searchMemberCandidates).toHaveBeenCalledTimes(1)
    expect(searchMemberCandidates).toHaveBeenCalledWith('p1', '홍길')

    const list = listbox()
    expect(list).not.toBeNull()
    expect(nameInput().getAttribute('role')).toBe('combobox')
    expect(nameInput().getAttribute('aria-expanded')).toBe('true')
    const rows = options()
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('홍길동')
    expect(rows[0].textContent).toContain('gil@example.com')
    expect(rows[0].textContent).toContain('수석')
    // 이메일 없는 후보는 noEmail 문구 재사용
    expect(rows[1].textContent).toContain('홍판서')
    expect(rows[1].textContent).toContain('members.noEmail')
  })

  it('후보 클릭 시 폼을 채우고 이름·이메일을 잠근다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍길')
    await advance(300)
    await act(async () => options()[0].click())

    expect(nameInput().value).toBe('홍길동')
    expect(emailInput().value).toBe('gil@example.com')
    expect(titleInput().value).toBe('수석')
    expect(nameInput().readOnly).toBe(true)
    expect(emailInput().readOnly).toBe(true)
    expect(listbox()).toBeNull()
    expect(document.body.textContent).toContain('members.acLockedNotice')
    // 잠긴 뒤에는 name 변경으로 재검색하지 않는다
    expect(searchMemberCandidates).toHaveBeenCalledTimes(1)
  })

  it('직접 입력으로 전환하면 이름·이메일을 비우고 잠금을 해제한다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍길')
    await advance(300)
    await act(async () => options()[0].click())

    await act(async () => buttonByText('members.acManualSwitch').click())
    expect(nameInput().value).toBe('')
    expect(emailInput().value).toBe('')
    expect(nameInput().readOnly).toBe(false)
    expect(emailInput().readOnly).toBe(false)
    expect(document.body.textContent).not.toContain('members.acLockedNotice')
  })

  it('↑↓ + Enter 로 후보를 선택할 수 있고 null 이메일은 비워진다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍판')
    await advance(300)

    await key(nameInput(), 'ArrowDown')
    expect(nameInput().getAttribute('aria-activedescendant')).toBe(options()[0].id)
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    await key(nameInput(), 'ArrowDown')
    expect(options()[1].getAttribute('aria-selected')).toBe('true')
    await key(nameInput(), 'Enter')

    expect(nameInput().value).toBe('홍판서')
    expect(emailInput().value).toBe('')
    expect(nameInput().readOnly).toBe(true)
    expect(listbox()).toBeNull()
  })

  it('Esc 는 드롭다운만 닫고 다이얼로그는 유지한다', async () => {
    await mount()
    await openAdd()
    await type(nameInput(), '홍길')
    await advance(300)
    expect(listbox()).not.toBeNull()

    await key(nameInput(), 'Escape')
    expect(listbox()).toBeNull()
    // 모달은 열려 있다
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('수정 모드에서는 자동완성이 동작하지 않는다', async () => {
    await mount()
    await act(async () => {
      const edit = document.querySelector<HTMLButtonElement>('button[aria-label="홍춘식members.ariaEditSuffix"]')
      if (!edit) throw new Error('수정 버튼을 찾을 수 없음')
      edit.click()
    })
    const name = nameInput()
    expect(name.value).toBe('홍춘식')
    expect(name.getAttribute('role')).not.toBe('combobox')
    await type(name, '홍길동')
    await advance(400)
    expect(searchMemberCandidates).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
  })

  it('검색 실패(ok:false)는 후보 없음으로 위장하지 않고 에러 한 줄을 보여준다', async () => {
    searchMemberCandidates.mockResolvedValue({ ok: false, error: '권한이 없습니다' })
    await mount()
    await openAdd()
    await type(nameInput(), '홍길')
    await advance(300)

    expect(listbox()).toBeNull()
    expect(document.body.textContent).toContain('members.acSearchError')
  })

  it('결과가 비어 있으면 드롭다운을 표시하지 않는다', async () => {
    searchMemberCandidates.mockResolvedValue({ ok: true, candidates: [] })
    await mount()
    await openAdd()
    await type(nameInput(), '없는사람')
    await advance(300)

    expect(listbox()).toBeNull()
    expect(document.body.textContent).not.toContain('members.acSearchError')
  })
})
