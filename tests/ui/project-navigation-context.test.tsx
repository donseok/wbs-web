// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  pathname: '/projects',
  queueUiPref: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))
vi.mock('@/lib/prefs/debouncedSave', () => ({
  queueUiPref: mocks.queueUiPref,
}))

import {
  ProjectNavigationProvider,
  useProjectNavigation,
} from '@/components/app/ProjectNavigationContext'

const projects = [
  { id: 'p1', name: '첫 프로젝트', status: 'active' as const },
  { id: 'p2', name: '두 번째 프로젝트', status: 'ready' as const },
]

type NavigationSnapshot = {
  routeProjectId: string | null
  routeProjectName: string | null
  menuProjectId: string | null
  menuProjectName: string | null
  isGlobalBridge: boolean
}

function Probe() {
  const navigation = useProjectNavigation()
  const snapshot: NavigationSnapshot = {
    routeProjectId: navigation.routeProjectId,
    routeProjectName: navigation.routeProject?.name ?? null,
    menuProjectId: navigation.menuProjectId,
    menuProjectName: navigation.menuProject?.name ?? null,
    isGlobalBridge: navigation.isGlobalBridge,
  }
  return <output data-navigation>{JSON.stringify(snapshot)}</output>
}

describe('ProjectNavigationContext', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.pathname = '/projects'
    mocks.queueUiPref.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function renderAt(
    pathname: string,
    initialLastProjectId: string | null = 'p1',
  ): Promise<NavigationSnapshot> {
    mocks.pathname = pathname
    await act(async () => {
      root.render(
        <ProjectNavigationProvider
          projects={projects}
          initialLastProjectId={initialLastProjectId}
        >
          <Probe />
        </ProjectNavigationProvider>,
      )
    })
    const output = container.querySelector('output[data-navigation]')
    expect(output).not.toBeNull()
    return JSON.parse(output!.textContent ?? '') as NavigationSnapshot
  }

  it('프로젝트 경로에서는 URL의 프로젝트를 메뉴 문맥으로 사용한다', async () => {
    const snapshot = await renderAt('/p/p2/weekly')

    expect(snapshot).toEqual({
      routeProjectId: 'p2',
      routeProjectName: '두 번째 프로젝트',
      menuProjectId: 'p2',
      menuProjectName: '두 번째 프로젝트',
      isGlobalBridge: false,
    })
  })

  it.each([
    '/minutes',
    '/minutes/11111111-2222-4333-8444-555555555555',
    '/meetings',
    '/account',
    '/usage',
    '/portfolio',
    '/admin/teams',
    '/admin/llm-config',
  ])('%s에서는 마지막 프로젝트 메뉴를 유지한다', async pathname => {
    const snapshot = await renderAt(pathname)

    expect(snapshot).toEqual({
      routeProjectId: null,
      routeProjectName: null,
      menuProjectId: 'p1',
      menuProjectName: '첫 프로젝트',
      isGlobalBridge: true,
    })
  })

  it('/projects에서는 저장된 프로젝트 문맥을 노출하지 않는다', async () => {
    const snapshot = await renderAt('/projects')

    expect(snapshot).toEqual({
      routeProjectId: null,
      routeProjectName: null,
      menuProjectId: null,
      menuProjectName: null,
      isGlobalBridge: false,
    })
  })

  it('저장된 프로젝트 ID가 현재 목록에 없으면 문맥을 폐기한다', async () => {
    const snapshot = await renderAt('/minutes', 'removed-project')

    expect(snapshot.menuProjectId).toBeNull()
    expect(snapshot.menuProjectName).toBeNull()
    expect(snapshot.isGlobalBridge).toBe(true)
  })

  it('새 프로젝트 경로를 방문하면 ID를 저장한다', async () => {
    await renderAt('/p/p2/issues', 'p1')

    expect(mocks.queueUiPref).toHaveBeenCalledWith({ lastProjectId: 'p2' })
  })
})
