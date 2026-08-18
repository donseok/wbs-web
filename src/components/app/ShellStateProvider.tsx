'use client'
// 앱 셸 상태(알림함·파생 알림·공지 배지·헤더 티커) 공급자 — 2026-08-18 성능 감사 P0.
//
// 종전에는 HeaderChrome(3곳)·Sidebar·HeaderAnnouncementTicker 가 마운트·내비게이션마다
// 서버 액션을 각자 POST 했고(내비당 3~6건, 액션은 클라이언트당 직렬 큐), 여기서
// /api/shell GET 1왕복으로 합쳐 컨텍스트로 나눠준다. 조회 시맨틱은 종전과 동일하다:
//  - 내비게이션(pathname 변경)마다 재조회 — 공지 페이지를 다녀오면 배지가 꺼지는 기존 동작 유지
//  - 파생 알림·티커는 URL 프로젝트(route) 기준, 공지 배지는 메뉴 문맥(menu) 기준
//  - 실패 시 알림함만 failed 로 표시하고 나머지는 직전 값을 유지(기존 catch 시맨틱)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { NotificationItem } from '@/app/actions/notifications'
import type { InboxItem } from '@/app/actions/inbox'
import type { AnnouncementSummary } from '@/lib/domain/types'
import { useProjectNavigation } from '@/components/app/ProjectNavigationContext'
import { useInboxRealtime } from '@/lib/hooks/useInboxRealtime'

type ShellPayload = {
  inbox: { items: InboxItem[]; unseen: number; failed?: true }
  notifications: { items: NotificationItem[]; count: number } | null
  unreadAnnouncements: number
  headerAnnouncements: AnnouncementSummary[]
}

type ShellState = {
  inbox: InboxItem[]
  setInbox: React.Dispatch<React.SetStateAction<InboxItem[]>>
  inboxLoading: boolean
  inboxFailed: boolean
  notifs: NotificationItem[]
  setNotifs: React.Dispatch<React.SetStateAction<NotificationItem[]>>
  notifLoading: boolean
  /** 메뉴 문맥 프로젝트의 안읽음 공지 수 — 전역 화면에서도 사이드바 배지를 유지한다. */
  menuUnreadAnnouncements: number
  headerAnnouncements: AnnouncementSummary[]
  refresh: () => void
}

const Ctx = createContext<ShellState | null>(null)

export function ShellStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { routeProjectId, menuProjectId } = useProjectNavigation()
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxFailed, setInboxFailed] = useState(false)
  const [notifs, setNotifs] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [menuUnreadAnnouncements, setMenuUnreadAnnouncements] = useState(0)
  const [headerAnnouncements, setHeaderAnnouncements] = useState<AnnouncementSummary[]>([])
  // 내비게이션 연타 시 늦게 도착한 이전 응답이 최신 상태를 덮지 않도록 시퀀스로 가드.
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setInboxLoading(true)
    if (routeProjectId) {
      setNotifLoading(true)
    } else {
      // 프로젝트를 벗어나면 파생 알림·티커를 비우고 로딩 플래그도 리셋 — 안 하면 공유 게이트
      // (loading = inboxLoading || notifLoading)가 무기한 스피너에 갇힌다(기존 시맨틱).
      setNotifs([])
      setNotifLoading(false)
      setHeaderAnnouncements([])
    }
    if (!menuProjectId) setMenuUnreadAnnouncements(0)
    try {
      const qs = new URLSearchParams()
      if (routeProjectId) qs.set('route', routeProjectId)
      if (menuProjectId) qs.set('menu', menuProjectId)
      const res = await fetch(`/api/shell?${qs.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`shell ${res.status}`)
      const data: ShellPayload = await res.json()
      if (id !== seq.current) return
      setInbox(data.inbox.items)
      setInboxFailed(data.inbox.failed === true)
      if (routeProjectId) {
        // notifications null = 서버측 파생 알림 실패 — 직전 값 유지(기존 catch(() => {}) 시맨틱)
        if (data.notifications) setNotifs(data.notifications.items)
        setHeaderAnnouncements(data.headerAnnouncements)
      }
      if (menuProjectId) setMenuUnreadAnnouncements(data.unreadAnnouncements)
    } catch {
      if (id === seq.current) setInboxFailed(true)
    } finally {
      if (id === seq.current) {
        setInboxLoading(false)
        setNotifLoading(false)
      }
    }
  }, [routeProjectId, menuProjectId])

  // 내비게이션당 1회 재조회 — pathname 이 deps 에 있어 같은 프로젝트 내 메뉴 이동에도 갱신된다.
  useEffect(() => { void load() }, [pathname, load])

  const refresh = useCallback(() => { void load() }, [load])
  // 실시간 배지 갱신 — 향상 계층(구독 실패해도 내비게이션당 재조회가 대신 채운다).
  useInboxRealtime(refresh)

  return (
    <Ctx.Provider
      value={{
        inbox, setInbox, inboxLoading, inboxFailed,
        notifs, setNotifs, notifLoading,
        menuUnreadAnnouncements, headerAnnouncements, refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useShellState(): ShellState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useShellState 는 ShellStateProvider 안에서만 호출할 수 있습니다')
  return v
}
