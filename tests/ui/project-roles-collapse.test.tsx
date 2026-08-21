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
  ensureRosterRow: vi.fn(async () => ({ ok: true, memberId: 'pm-new' })),
}))
vi.mock('@/app/actions/members', () => ({
  updateMember: vi.fn(async () => ({ ok: true })),
  removeMember: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/components/app/TeamsProvider', () => ({
  useTeamCodes: () => ['PMO'],
}))

import { ProjectRolesManager } from '@/components/settings/ProjectRolesManager'

const ROWS: ProjectRoleRow[] = [{
  userId: 'u1', email: 'user@example.com', name: '홍길동', teamCode: 'PMO', orgTeamCode: null,
  role: 'member', isSuperuser: false, memberId: null, rosterRole: null, title: null, roleLabel: null,
}]

describe('ProjectRolesManager 접기/펼치기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
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

  it('기본값은 펼침(카드 보드 은퇴 후 이 표가 본체)이고 버튼으로 접고 펼 수 있다', async () => {
    await act(async () => root.render(
      <ProjectRolesManager projectId="p1" rows={ROWS} canManageAdmins />,
    ))

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="project-roles-table"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('권한 목록 접기')
    expect(container.querySelector('#project-roles-table')).not.toBeNull()
    expect(container.textContent).toContain('홍길동')

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('권한 목록 펼치기')
    expect(container.querySelector('#project-roles-table')).toBeNull()

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })
})
