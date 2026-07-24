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

type RememberedProject = {
  id: string
  href: string
}

type ProjectNavigationValue = {
  /** 실제 URL이 가리키는 프로젝트. 전역 화면에서는 항상 null이다. */
  routeProjectId: string | null
  routeProject: NavigationProject | null
  /** 사이드바 탐색에 사용할 프로젝트. 회의록·내 회의에서는 최근 프로젝트를 유지한다. */
  menuProjectId: string | null
  menuProject: NavigationProject | null
  /** 최근 프로젝트 문맥을 이어 주는 전역 화면인지 여부. */
  isGlobalBridge: boolean
  /** 마지막 프로젝트 화면으로 돌아갈 안전한 내부 경로. */
  returnHref: string | null
}

const ProjectNavigationContext = createContext<ProjectNavigationValue | null>(null)

/** 프로젝트 문맥을 유지해도 되는 전역 작업 화면만 명시적으로 허용한다. */
export function isGlobalProjectBridge(pathname: string): boolean {
  return pathname === '/meetings'
    || pathname === '/minutes'
    || pathname.startsWith('/minutes/')
}

function safeProjectHref(projectId: string, href: string | null | undefined): string {
  const fallback = `/p/${projectId}/dashboard`
  if (!href) return fallback

  try {
    const base = new URL('https://dflow.local')
    const parsed = new URL(href, base)
    const projectRoot = `/p/${projectId}`
    const belongsToProject = parsed.pathname === projectRoot
      || parsed.pathname.startsWith(`${projectRoot}/`)
    if (parsed.origin !== base.origin || !belongsToProject) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function ProjectNavigationProvider({
  projects,
  initialLastProjectId = null,
  initialLastProjectHref = null,
  children,
}: {
  projects: NavigationProject[]
  initialLastProjectId?: string | null
  initialLastProjectHref?: string | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const projectsById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects],
  )

  const initialRemembered = useMemo<RememberedProject | null>(() => {
    if (!initialLastProjectId || !projectsById.has(initialLastProjectId)) return null
    return {
      id: initialLastProjectId,
      href: safeProjectHref(initialLastProjectId, initialLastProjectHref),
    }
  }, [initialLastProjectHref, initialLastProjectId, projectsById])

  const [remembered, setRemembered] = useState<RememberedProject | null>(initialRemembered)
  const persistedRef = useRef(
    initialRemembered ? `${initialRemembered.id}\n${initialRemembered.href}` : null,
  )

  const routeProjectId = useMemo(() => {
    const candidate = pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1] ?? null
    return candidate && projectsById.has(candidate) ? candidate : null
  }, [pathname, projectsById])

  const routeProject = routeProjectId ? (projectsById.get(routeProjectId) ?? null) : null
  const isGlobalBridge = isGlobalProjectBridge(pathname)
  const menuProjectId = routeProjectId ?? (isGlobalBridge ? remembered?.id ?? null : null)
  const menuProject = menuProjectId ? (projectsById.get(menuProjectId) ?? null) : null
  const returnHref = routeProjectId
    ? safeProjectHref(routeProjectId, pathname)
    : isGlobalBridge && remembered
      ? remembered.href
      : null

  // 프로젝트가 삭제되거나 권한 목록에서 빠지면 오래된 탐색 문맥을 즉시 폐기한다.
  useEffect(() => {
    setRemembered(previous => {
      if (!previous || projectsById.has(previous.id)) return previous
      persistedRef.current = null
      return null
    })
  }, [projectsById])

  // 프로젝트 화면에 들어갈 때 탐색 문맥을 갱신한다. URL의 query/hash도 가능한 경우 함께 기억한다.
  useEffect(() => {
    if (!routeProjectId) return
    const suffix = typeof window === 'undefined'
      ? ''
      : `${window.location.search}${window.location.hash}`
    const href = safeProjectHref(routeProjectId, `${pathname}${suffix}`)
    const next = { id: routeProjectId, href }
    setRemembered(previous => (
      previous?.id === next.id && previous.href === next.href ? previous : next
    ))

    const persistedKey = `${next.id}\n${next.href}`
    if (persistedRef.current === persistedKey) return
    persistedRef.current = persistedKey
    queueUiPref({ lastProjectId: next.id, lastProjectHref: next.href })
  }, [pathname, routeProjectId])

  const value = useMemo<ProjectNavigationValue>(() => ({
    routeProjectId,
    routeProject,
    menuProjectId,
    menuProject,
    isGlobalBridge,
    returnHref,
  }), [
    isGlobalBridge,
    menuProject,
    menuProjectId,
    returnHref,
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
