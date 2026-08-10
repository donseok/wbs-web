// @vitest-environment jsdom
// 프로젝트 팀 관리 UI 계약. 핵심은 상속 종료 경고가 **첫 정의(inherited=true)에서만** 뜨고,
// 이미 프로젝트 팀이 있으면 곧장 실행된다는 것 — 회의록 시드 폴더 미생성은 액션 단위
// 테스트(project-teams-actions.test.ts)가 이미 검증하므로 여기서는 렌더·플로우만 본다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  addProjectTeam: vi.fn(),
  updateProjectTeam: vi.fn(),
  copyGlobalTeams: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/app/actions/projectTeams', () => ({
  addProjectTeam: mocks.addProjectTeam,
  updateProjectTeam: mocks.updateProjectTeam,
  copyGlobalTeams: mocks.copyGlobalTeams,
}))

import { ProjectTeamsManager, type AdminTeamRow } from '@/components/settings/ProjectTeamsManager'

const ONE_TEAM: AdminTeamRow[] = [
  { id: 't1', code: 'PMO', sortOrder: 0, active: true, progressVisible: true },
]

describe('ProjectTeamsManager', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(props: { teams: AdminTeamRow[]; inherited: boolean }) {
    await act(async () => root.render(
      <ProjectTeamsManager projectId="p1" teams={props.teams} inherited={props.inherited} />,
    ))
  }

  it('inherited=true 이면 팀 표 대신 상속 안내 패널을 보여준다', async () => {
    await render({ teams: [], inherited: true })

    expect(container.textContent).toContain('현재 전역 팀을 상속 중입니다')
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('전역 팀 복사로 시작')
    expect(container.textContent).toContain('빈 목록에서 시작')
  })

  it('상속 중 첫 추가는 경고 모달을 먼저 띄우고, 액션은 아직 부르지 않는다', async () => {
    await render({ teams: [], inherited: true })

    const startEmptyBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('빈 목록에서 시작'))!
    await act(async () => startEmptyBtn.click())

    const input = container.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '신팀')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '팀 추가')!
    await act(async () => addBtn.click())

    // 확인 없이는 아직 서버 액션이 불리지 않는다 — 경고가 실행을 가로막는다.
    expect(mocks.addProjectTeam).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('전역 팀 상속 종료')
    expect(document.body.textContent).toContain('목록 밖 팀')

    const continueBtn = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === '계속')!
    mocks.addProjectTeam.mockResolvedValue({ ok: true })
    await act(async () => continueBtn.click())

    expect(mocks.addProjectTeam).toHaveBeenCalledWith('p1', '신팀')
  })

  it('이미 프로젝트 팀이 정의돼 있으면(inherited=false) 경고 없이 곧장 추가한다', async () => {
    mocks.updateProjectTeam.mockResolvedValue({ ok: true })
    mocks.addProjectTeam.mockResolvedValue({ ok: true })
    await render({ teams: ONE_TEAM, inherited: false })

    expect(container.querySelector('table')).not.toBeNull()
    expect(container.textContent).not.toContain('현재 전역 팀을 상속 중입니다')

    const input = container.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '추가팀')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addBtn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent?.includes('팀 추가'))!
    await act(async () => addBtn.click())

    // 경고 모달 없이 즉시 호출된다.
    expect(document.body.textContent).not.toContain('전역 팀 상속 종료')
    expect(mocks.addProjectTeam).toHaveBeenCalledWith('p1', '추가팀')
  })
})
