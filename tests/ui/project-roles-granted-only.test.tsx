// @vitest-environment jsdom
// 권한 표는 역할 보유자·슈퍼유저만 나열한다 — 전 계정을 '조회'로 깔면
// "모두가 프로젝트에 들어와 있다"로 읽힌다(2026-08-20 오독 사례).
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
}))

import { ProjectRolesManager } from '@/components/settings/ProjectRolesManager'

const ROWS: ProjectRoleRow[] = [
  { userId: 'admin1', email: 'admin@example.com', name: '관리자김', teamCode: 'PMO', role: 'admin', isSuperuser: false },
  { userId: 'member1', email: 'member@example.com', name: '멤버이', teamCode: 'MES', role: 'member', isSuperuser: false },
  { userId: 'su1', email: 'su@example.com', name: '슈퍼박', teamCode: 'PMO', role: 'viewer', isSuperuser: true },
  { userId: 'viewer1', email: 'viewer@example.com', name: '조회최', teamCode: 'ERP', role: 'viewer', isSuperuser: false },
]

describe('ProjectRolesManager 역할 보유자만 표시', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setProjectRole.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderExpanded() {
    await act(async () => root.render(
      <ProjectRolesManager projectId="p1" rows={ROWS} canManageAdmins />,
    ))
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="project-roles-table"]')!
    await act(async () => toggle.click())
    return toggle
  }

  it('역할 없는 계정은 표에서 빠지고, 슈퍼유저는 역할 없이도 항상 노출된다', async () => {
    const toggle = await renderExpanded()

    // 접힘 버튼에 보유자 수(관리자1·멤버1·슈퍼유저1 = 3명)가 보인다.
    await act(async () => toggle.click())
    expect(toggle.textContent).toContain('(3명)')
    await act(async () => toggle.click())

    const table = container.querySelector('#project-roles-table table')!
    expect(table.textContent).toContain('관리자김')
    expect(table.textContent).toContain('멤버이')
    expect(table.textContent).toContain('슈퍼박')
    expect(table.textContent).not.toContain('조회최')

    // 역할 행 없는 슈퍼유저는 셀렉트 대신 전권 표시 — '조회' 셀렉트는 오독을 되살린다.
    expect(table.textContent).toContain('전권 (슈퍼유저)')
  })

  it('역할 없는 계정은 추가 콤보에만 나타나고, 추가하면 setProjectRole 이 호출된다', async () => {
    await renderExpanded()

    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="권한을 줄 계정"]')!
    const options = [...picker.options].map(o => o.textContent ?? '')
    expect(options.some(t => t.includes('조회최'))).toBe(true)
    expect(options.some(t => t.includes('관리자김'))).toBe(false)
    expect(options.some(t => t.includes('슈퍼박'))).toBe(false)

    await act(async () => {
      picker.value = 'viewer1'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const addBtn = [...container.querySelectorAll('button')].find(b => b.textContent === '추가')!
    expect(addBtn.disabled).toBe(false)
    await act(async () => addBtn.click())
    expect(setProjectRole).toHaveBeenCalledWith('p1', 'viewer1', 'member')
  })
})
