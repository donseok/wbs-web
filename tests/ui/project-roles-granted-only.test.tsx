// @vitest-environment jsdom
// 권한 표는 역할 보유자·명단 등재자·슈퍼유저를 나열한다 — 전 계정을 '조회'로 깔면
// "모두가 프로젝트에 들어와 있다"로 읽힌다(2026-08-20 오독 사례). 카드 보드 은퇴 후
// 계정 없는 legacy 명단 행도 이 표가 유일한 노출처다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRoleRow } from '@/app/actions/projectRoles'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const setProjectRole = vi.fn(async () => ({ ok: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/app/actions/projectRoles', () => ({
  setProjectRole: (...args: unknown[]) => setProjectRole(...args as []),
  ensureRosterRow: vi.fn(async () => ({ ok: true, memberId: 'pm-new' })),
}))
vi.mock('@/app/actions/members', () => ({
  updateMember: vi.fn(async () => ({ ok: true })),
  removeMember: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/components/app/TeamsProvider', () => ({
  useTeamCodes: () => ['PMO', 'MES'],
}))

import { ProjectRolesManager } from '@/components/settings/ProjectRolesManager'

const base = { orgTeamCode: null, memberId: null, rosterRole: null, title: null, roleLabel: null }
const ROWS: ProjectRoleRow[] = [
  { ...base, userId: 'admin1', email: 'admin@example.com', name: '관리자김', teamCode: 'PMO', role: 'admin', isSuperuser: false, memberId: 'pm-1', rosterRole: 'admin', title: 'PM' },
  { ...base, userId: 'member1', email: 'member@example.com', name: '멤버이', teamCode: 'MES', role: 'member', isSuperuser: false, memberId: 'pm-2', rosterRole: 'contributor' },
  { ...base, userId: 'su1', email: 'su@example.com', name: '슈퍼박', teamCode: 'PMO', role: 'viewer', isSuperuser: true },
  { ...base, userId: 'viewer1', email: 'viewer@example.com', name: '조회최', teamCode: 'ERP', role: 'viewer', isSuperuser: false },
  { ...base, userId: null, email: null, name: '외부홍', teamCode: 'MES', role: 'viewer', isSuperuser: false, memberId: 'pm-9', rosterRole: 'contributor', title: '협력사' },
]

describe('ProjectRolesManager 참여자·권한 통합 표', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setProjectRole.mockClear()
    // jsdom 에는 scrollIntoView 가 없다 — 콤보 하이라이트 스크롤 이펙트가 죽지 않게 스텁.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true, writable: true, value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render() {
    await act(async () => root.render(
      <ProjectRolesManager projectId="p1" rows={ROWS} canManageAdmins />,
    ))
  }

  it('기본 펼침 — 역할 보유자·명단 등재자·슈퍼유저가 보이고 무관 계정은 빠진다', async () => {
    await render()

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="project-roles-table"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const table = container.querySelector('#project-roles-table table')!
    expect(table.textContent).toContain('관리자김')
    expect(table.textContent).toContain('멤버이')
    expect(table.textContent).toContain('슈퍼박')
    expect(table.textContent).toContain('외부홍')       // 계정 없는 legacy 명단 행
    expect(table.textContent).not.toContain('조회최')   // 역할·명단 둘 다 없음 → 콤보 후보로만

    // 역할 행 없는 슈퍼유저는 셀렉트 대신 전권 표시, 계정 없는 행은 '계정 없음'.
    expect(table.textContent).toContain('전권 (슈퍼유저)')
    expect(table.textContent).toContain('계정 없음')
    // 명단 필드가 표에 노출된다.
    expect(table.textContent).toContain('리더')
    expect(table.textContent).toContain('PM')

    // 접으면 보유자 수가 라벨에 보인다(관리자1·멤버1·슈퍼1·legacy1 = 4명).
    await act(async () => toggle.click())
    expect(toggle.textContent).toContain('(4명)')
  })

  it('역할·명단 없는 계정만 검색 콤보 후보이고, 선택 후 추가하면 setProjectRole 이 호출된다', async () => {
    await render()

    const picker = container.querySelector<HTMLInputElement>('input[aria-label="권한을 줄 계정"]')!
    await act(async () => {
      picker.focus()
      picker.dispatchEvent(new Event('focus', { bubbles: true }))
    })
    const listbox = container.querySelector('[role="listbox"]')!
    const labels = [...listbox.querySelectorAll('[role="option"]')].map(o => o.textContent ?? '')
    expect(labels.some(t => t.includes('조회최'))).toBe(true)
    expect(labels.some(t => t.includes('관리자김'))).toBe(false)
    expect(labels.some(t => t.includes('외부홍'))).toBe(false)

    const target = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(o => (o.textContent ?? '').includes('조회최'))!
    await act(async () => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const addBtn = [...container.querySelectorAll('button')].find(b => b.textContent === '추가')!
    expect(addBtn.disabled).toBe(false)
    await act(async () => addBtn.click())
    expect(setProjectRole).toHaveBeenCalledWith('p1', 'viewer1', 'member')
  })

  it('검색어는 이름·이메일·팀 어느 것으로든 옵션을 거른다', async () => {
    await render()

    const picker = container.querySelector<HTMLInputElement>('input[aria-label="권한을 줄 계정"]')!
    await act(async () => {
      picker.focus()
      picker.dispatchEvent(new Event('focus', { bubbles: true }))
    })
    // React 의 onChange 는 input 이벤트에 매핑된다 — native setter 로 값을 넣고 input 을 쏜다.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(picker, '없는사람')
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('[role="listbox"]')!.textContent).toContain('검색 결과가 없습니다')

    await act(async () => {
      setValue.call(picker, 'viewer@')
      picker.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const labels = [...container.querySelectorAll('[role="option"]')].map(o => o.textContent ?? '')
    expect(labels).toHaveLength(1)
    expect(labels[0]).toContain('조회최')
  })

  it('리스트 뷰는 셀 인라인 편집 — 연필 없음, 팀·구분 셀렉트와 직함·역할 입력이 있다', async () => {
    await render()

    expect(container.querySelector('button[aria-label="관리자김 명단 정보 수정"]')).toBeNull()
    expect(container.querySelector('select[aria-label="관리자김 프로젝트 팀"]')).not.toBeNull()
    expect(container.querySelector('select[aria-label="관리자김 명단 구분"]')).not.toBeNull()
    expect(container.querySelector('input[aria-label="관리자김 직함"]')).not.toBeNull()
    expect(container.querySelector('input[aria-label="관리자김 역할"]')).not.toBeNull()
  })

  it('카드 뷰에서는 연필 버튼으로 명단 편집 모달을 연다', async () => {
    await render()

    const cardToggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '카드')!
    await act(async () => cardToggle.click())

    const editBtn = container.querySelector<HTMLButtonElement>('button[aria-label="관리자김 명단 정보 수정"]')!
    await act(async () => editBtn.click())
    expect(document.body.textContent).toContain('관리자김 — 명단 정보')
    expect(document.body.textContent).toContain('프로젝트 팀')
    expect(document.body.textContent).toContain('명단 구분')
  })
})
