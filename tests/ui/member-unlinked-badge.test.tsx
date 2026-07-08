// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProjectMember } from '@/lib/domain/types'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/members', () => ({ addMember: vi.fn(), updateMember: vi.fn(), removeMember: vi.fn() }))

import { MembersBoard } from '@/components/members/MembersBoard'

const base: ProjectMember = {
  id: 'm1', projectId: 'p1', name: '홍춘식', email: 'chunsik.hong@dongkuk.com',
  teamCode: 'PMO', role: 'admin', title: null, hasAccount: true, createdAt: '2026-01-01',
}

// 실 DB 에서는 37행이 모두 연결되어 배지가 0건이라 눈으로 확인할 수 없다.
// 드리프트가 실제로 화면에 드러나는지는 여기서만 검증 가능하다.
describe("MembersBoard '계정 미연결' 배지", () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  async function mount(members: ProjectMember[]) {
    await act(async () => root.render(<MembersBoard projectId="p1" members={members} canEdit={false} />))
  }

  it('이메일이 있는데 계정과 연결되지 않으면 배지가 뜬다', async () => {
    await mount([{ ...base, hasAccount: false }])
    expect(container.textContent).toContain('members.unlinked')
  })

  it('계정과 연결되어 있으면 배지가 없다', async () => {
    await mount([base])
    expect(container.textContent).not.toContain('members.unlinked')
  })

  it('이메일 자체가 없는 외부 인력 행에는 배지를 띄우지 않는다 (이메일 미등록으로 이미 드러남)', async () => {
    await mount([{ ...base, email: null, hasAccount: false }])
    expect(container.textContent).not.toContain('members.unlinked')
    expect(container.textContent).toContain('members.noEmail')
  })
})
