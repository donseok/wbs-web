// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRoleRow } from '@/app/actions/projectRoles'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/app/actions/projectRoles', () => ({
  setProjectRole: vi.fn(async () => ({ ok: true })),
}))

import { ProjectRolesManager } from '@/components/settings/ProjectRolesManager'

const ROWS: ProjectRoleRow[] = [{
  userId: 'u1', email: 'user@example.com', name: '홍길동', teamCode: 'PMO',
  role: 'member', isSuperuser: false,
}]

describe('ProjectRolesManager 접기/펼치기', () => {
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

  it('기본값은 접힘이고 버튼으로 권한 표를 열고 닫을 수 있다', async () => {
    await act(async () => root.render(
      <ProjectRolesManager projectId="p1" rows={ROWS} canManageAdmins />,
    ))

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="project-roles-table"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('권한 목록 펼치기')
    expect(container.querySelector('#project-roles-table')).toBeNull()

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('권한 목록 접기')
    expect(container.querySelector('#project-roles-table')).not.toBeNull()
    expect(container.textContent).toContain('홍길동')

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#project-roles-table')).toBeNull()
  })
})
