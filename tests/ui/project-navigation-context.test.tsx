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
  returnHref: string | null
}

function Probe() {
  const navigation = useProjectNavigation()
  const snapshot: NavigationSnapshot = {
    routeProjectId: navigation.routeProjectId,
    routeProjectName: navigation.routeProject?.name ?? null,
    menuProjectId: navigation.menuProjectId,
    menuProjectName: navigation.menuProject?.name ?? null,
    isGlobalBridge: navigation.isGlobalBridge,
    returnHref: navigation.returnHref,
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
    initialLastProjectHref: string | null = '/p/p1/wbs',
  ): Promise<NavigationSnapshot> {
    mocks.pathname = pathname
    await act(async () => {
      root.render(
        <ProjectNavigationProvider
          projects={projects}
          initialLastProjectId={initialLastProjectId}
          initialLastProjectHref={initialLastProjectHref}
        >
          <Probe />
        </ProjectNavigationProvider>,
      )
    })
    const output = container.querySelector('output[data-navigation]')
    expect(output).not.toBeNull()
    return JSON.parse(output!.textContent ?? '') as NavigationSnapshot
  }

  it('프로젝트 경로에서는 URL의 프로젝트를 메뉴 문맥과 복귀 경로로 사용한다', async () => {
    const snapshot = await renderAt('/p/p2/weekly')

    expect(snapshot).toEqual({
      routeProjectId: 'p2',
      routeProjectName: '두 번째 프로젝트',
      menuProjectId: 'p2',
      menuProjectName: '두 번째 프로젝트',
      isGlobalBridge: false,
      returnHref: '/p/p2/weekly',
    })
  })

  it.each([
    '/minutes',
    '/minutes/11111111-2222-4333-8444-555555555555',
    '/meetings',
  ])('%s에서는 마지막 프로젝트 메뉴와 복귀 경로를 유지한다', async pathname => {
    const snapshot = await renderAt(pathname)

    expect(snapshot).toEqual({
      routeProjectId: null,
      routeProjectName: null,
      menuProjectId: 'p1',
      menuProjectName: '첫 프로젝트',
      isGlobalBridge: true,
      returnHref: '/p/p1/wbs',
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
      returnHref: null,
    })
  })

  it('저장된 프로젝트 ID가 현재 목록에 없으면 문맥을 폐기한다', async () => {
    const snapshot = await renderAt('/minutes', 'removed-project', '/p/removed-project/wbs')

    expect(snapshot.menuProjectId).toBeNull()
    expect(snapshot.menuProjectName).toBeNull()
    expect(snapshot.returnHref).toBeNull()
    expect(snapshot.isGlobalBridge).toBe(true)
  })

  it.each([
    '/p/p2/kanban',
    '/projects',
  ])('저장 경로 %s가 유효하지 않으면 저장된 프로젝트 대시보드로 보정한다', async initialHref => {
    const snapshot = await renderAt('/minutes', 'p1', initialHref)

    expect(snapshot.menuProjectId).toBe('p1')
    expect(snapshot.returnHref).toBe('/p/p1/dashboard')
  })

  it('새 프로젝트 경로를 방문하면 ID와 현재 경로를 함께 저장한다', async () => {
    await renderAt('/p/p2/issues', 'p1', '/p/p1/wbs')

    expect(mocks.queueUiPref).toHaveBeenCalledWith({
      lastProjectId: 'p2',
      lastProjectHref: '/p/p2/issues',
    })
  })
})
