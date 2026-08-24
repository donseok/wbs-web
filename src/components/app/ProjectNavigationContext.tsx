'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

type NavigationProject = {
  id: string
  name: string
}

type ProjectNavigationValue = {
  /** 실제 URL이 가리키는 프로젝트. 전역 화면에서는 항상 null이다. */
  routeProjectId: string | null
  routeProject: NavigationProject | null
  /** 사이드바 탐색에 사용할 프로젝트. 전역 브리지 화면에서는 최근 프로젝트를 유지한다. */
  menuProjectId: string | null
  menuProject: NavigationProject | null
  /** 최근 프로젝트 문맥을 이어 주는 전역 화면인지 여부. */
  isGlobalBridge: boolean
}

const ProjectNavigationContext = createContext<ProjectNavigationValue | null>(null)

/**
 * 프로젝트 문맥을 유지해도 되는 전역 화면만 명시적으로 허용한다.
 * /projects 는 제외 — 프로젝트를 "떠나서 고르는" 홈이므로 문맥을 접는 게 의도다.
 */
export function isGlobalProjectBridge(pathname: string): boolean {
  return pathname === '/meetings'
    || pathname === '/minutes'
    || pathname.startsWith('/minutes/')
    || pathname === '/account'
    || pathname === '/usage'
    || pathname === '/portfolio'
    || pathname === '/agent-ops'
    || pathname === '/admin'
    || pathname.startsWith('/admin/')
}

export function ProjectNavigationProvider({
  projects,
  initialLastProjectId = null,
  children,
}: {
  projects: NavigationProject[]
  initialLastProjectId?: string | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const projectsById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects],
  )

  const initialRemembered =
    initialLastProjectId && projectsById.has(initialLastProjectId) ? initialLastProjectId : null

  const [remembered, setRemembered] = useState<string | null>(initialRemembered)
  const persistedRef = useRef(initialRemembered)

  const routeProjectId = useMemo(() => {
    const candidate = pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1] ?? null
    return candidate && projectsById.has(candidate) ? candidate : null
  }, [pathname, projectsById])

  const routeProject = routeProjectId ? (projectsById.get(routeProjectId) ?? null) : null
  const isGlobalBridge = isGlobalProjectBridge(pathname)
  const menuProjectId = routeProjectId ?? (isGlobalBridge ? remembered : null)
  const menuProject = menuProjectId ? (projectsById.get(menuProjectId) ?? null) : null

  // 프로젝트가 삭제되거나 권한 목록에서 빠지면 오래된 탐색 문맥을 즉시 폐기한다.
  useEffect(() => {
    setRemembered(previous => {
      if (!previous || projectsById.has(previous)) return previous
      persistedRef.current = null
      return null
    })
  }, [projectsById])

  // 프로젝트 화면에 들어갈 때 탐색 문맥을 갱신한다.
  useEffect(() => {
    if (!routeProjectId) return
    setRemembered(previous => (previous === routeProjectId ? previous : routeProjectId))

    if (persistedRef.current === routeProjectId) return
    persistedRef.current = routeProjectId
    queueUiPref({ lastProjectId: routeProjectId })
  }, [routeProjectId])

  const value = useMemo<ProjectNavigationValue>(() => ({
    routeProjectId,
    routeProject,
    menuProjectId,
    menuProject,
    isGlobalBridge,
  }), [
    isGlobalBridge,
    menuProject,
    menuProjectId,
    routeProject,
    routeProjectId,
  ])

  return (
    <ProjectNavigationContext.Provider value={value}>
      {children}
    </ProjectNavigationContext.Provider>
  )
}

export function useProjectNavigation(): ProjectNavigationValue {
  const value = useContext(ProjectNavigationContext)
  if (!value) {
    throw new Error('useProjectNavigation must be used within ProjectNavigationProvider')
  }
  return value
}
