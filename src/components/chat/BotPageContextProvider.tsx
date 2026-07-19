'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { BotDomain, BotEntityRef, PageContextV1 } from '@/lib/ai/chat/protocol'

const PROJECT_RE = /\/p\/([0-9a-fA-F-]{8,})/
const MINUTE_RE = /^\/minutes\/([^/?#]+)/
const RESERVED_QUERY_KEYS = new Set(['date', 'from', 'q', 'query', 'search', 'to', 'view', 'week'])

/**
 * A page can register only the context that is not already encoded in its URL.
 * The URL-derived pathname, project and query values remain the default.
 *
 * `filters`에는 서버 라우터가 소비하는 키만 등록한다:
 * status · team · category · memberId · section.
 * 그 외 장식성 키는 서버에서 무시되므로 보내지 않는다(리뷰 L-10).
 * 전역 화면의 프로젝트 선택은 filters가 아니라 typed `selectedProjectId`로 보낸다(리뷰 M-4).
 */
export type BotPageContextRegistration = Partial<
  Omit<PageContextV1, 'contextVersion' | 'pathname' | 'timezone'>
>

interface RegistrationEntry {
  order: number
  value: BotPageContextRegistration
}

interface BotPageRegistrationApi {
  register: (key: symbol, value: BotPageContextRegistration) => void
  unregister: (key: symbol) => void
}

// 등록 API와 병합된 값을 별도 context로 분리(리뷰 M-10) — 등록 뷰가 자기 등록이
// 일으킨 pageContext 갱신에 다시 렌더되는 이중 렌더를 막는다. 등록 훅은 불변
// API context만, DkBot 같은 소비자는 값 context만 구독한다.
const BotPageRegistrationContext = createContext<BotPageRegistrationApi | null>(null)
const BotPageValueContext = createContext<PageContextV1 | null>(null)

function inferDomain(pathname: string): BotDomain {
  const projectMenu = pathname.match(/^\/p\/[^/]+\/([^/?#]+)/)?.[1]
  switch (projectMenu) {
    case 'dashboard':
    case 'wbs':
    case 'kanban':
    case 'members':
    case 'attendance':
    case 'announcements':
    case 'meetings':
    case 'weekly':
    case 'settings':
      return projectMenu
  }
  if (pathname === '/' || pathname.startsWith('/projects')) return 'projects'
  if (pathname.startsWith('/minutes')) return 'minutes'
  if (pathname.startsWith('/meetings')) return 'meetings'
  return 'unknown'
}

function queryFilters(searchParams: URLSearchParams): PageContextV1['filters'] {
  const filters: NonNullable<PageContextV1['filters']> = {}
  const keys = [...new Set(searchParams.keys())]
  for (const key of keys) {
    if (RESERVED_QUERY_KEYS.has(key) || key === 'focus') continue
    const values = searchParams.getAll(key)
    filters[key] = values.length > 1 ? values : (values[0] ?? null)
  }
  return Object.keys(filters).length ? filters : undefined
}

function inferSelectedEntity(pathname: string, domain: BotDomain, searchParams: URLSearchParams): BotEntityRef | null {
  const focus = searchParams.get('focus')
  if (focus && (domain === 'wbs' || domain === 'kanban')) return { type: 'wbs_item', id: focus }

  const minuteId = pathname.match(MINUTE_RE)?.[1]
  if (minuteId) return { type: 'minute', id: decodeURIComponent(minuteId) }
  return null
}

function buildUrlContext(pathname: string, searchParams: URLSearchParams): PageContextV1 {
  const domain = inferDomain(pathname)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  return {
    contextVersion: 1,
    pathname,
    domain,
    projectId: pathname.match(PROJECT_RE)?.[1] ?? null,
    selectedEntity: inferSelectedEntity(pathname, domain, searchParams),
    view: searchParams.get('view'),
    date: searchParams.get('date'),
    weekStart: searchParams.get('week'),
    range: from || to ? { from, to } : null,
    filters: queryFilters(searchParams),
    search: searchParams.get('search') ?? searchParams.get('q') ?? searchParams.get('query'),
    timezone: 'Asia/Seoul',
  }
}

function mergeContext(base: PageContextV1, entries: RegistrationEntry[]): PageContextV1 {
  const override = entries
    .sort((a, b) => a.order - b.order)
    .reduce<BotPageContextRegistration>((acc, entry) => ({
      ...acc,
      ...entry.value,
      filters: entry.value.filters === undefined
        ? acc.filters
        : { ...(acc.filters ?? {}), ...entry.value.filters },
    }), {})

  const filters = override.filters === undefined ? base.filters : override.filters
  return {
    ...base,
    ...override,
    // Once a mounted page registers filters, its live UI state is authoritative.
    // In particular `{}` must clear stale query-string filters after an "전체" selection.
    filters: filters && Object.keys(filters).length ? filters : undefined,
    contextVersion: 1,
    pathname: base.pathname,
    timezone: 'Asia/Seoul',
  }
}

export function BotPageContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const searchKey = searchParams.toString()
  const registrations = useRef(new Map<symbol, RegistrationEntry>())
  const orderRef = useRef(0)
  const [revision, setRevision] = useState(0)

  const register = useCallback((key: symbol, value: BotPageContextRegistration) => {
    const previous = registrations.current.get(key)
    registrations.current.set(key, {
      order: previous?.order ?? (orderRef.current += 1),
      value,
    })
    setRevision(current => current + 1)
  }, [])

  const unregister = useCallback((key: symbol) => {
    if (!registrations.current.delete(key)) return
    setRevision(current => current + 1)
  }, [])

  const pageContext = useMemo(() => {
    const params = new URLSearchParams(searchKey)
    return mergeContext(buildUrlContext(pathname, params), [...registrations.current.values()])
    // revision invalidates memo when a registration changes; the value itself lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchKey, revision])

  // register/unregister는 deps 없는 useCallback이라 API 객체는 마운트 동안 불변이다.
  const registrationApi = useMemo(() => ({ register, unregister }), [register, unregister])
  return (
    <BotPageRegistrationContext.Provider value={registrationApi}>
      <BotPageValueContext.Provider value={pageContext}>{children}</BotPageValueContext.Provider>
    </BotPageRegistrationContext.Provider>
  )
}

/**
 * Register page-local context while the calling component is mounted. Passing a
 * structurally equal object on each render is safe; it is keyed by serialized value.
 */
export function useBotPageContext(value: BotPageContextRegistration | null | undefined): void {
  // 값 context는 구독하지 않는다 — 자기 등록이 만든 pageContext 변경으로 재렌더되지 않기 위함(M-10).
  const api = useContext(BotPageRegistrationContext)
  const register = api?.register
  const unregister = api?.unregister
  const keyRef = useRef(Symbol('bot-page-context'))
  const serialized = value == null ? null : JSON.stringify(value)

  useEffect(() => {
    // Menu components are also rendered independently in tests and stories.
    // Context registration is an optional enhancement there, so being outside
    // the app-level provider must not make the underlying menu unusable.
    if (!register || !unregister || serialized === null || value == null) return
    const key = keyRef.current
    register(key, value)
    return () => unregister(key)
    // The serialized value makes inline object literals stable between equivalent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, unregister, serialized])
}

/** DkBot consumes the merged URL and page-registered context through this hook. */
export function useCurrentBotPageContext(): PageContextV1 {
  const pageContext = useContext(BotPageValueContext)
  if (!pageContext) throw new Error('DkBot must be rendered inside BotPageContextProvider.')
  return pageContext
}
