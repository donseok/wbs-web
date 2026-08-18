'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell, ChevronRight, Cpu, Globe, KeyRound, LogOut, Menu, Moon, Sun, User, Users, X,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { getNotifications, markAllNotificationsRead, type NotificationItem } from '@/app/actions/notifications'
import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
import { getInboxFeed, markInboxSeen, markAllInboxRead, markInboxItemRead, type InboxItem } from '@/app/actions/inbox'
import { useInboxRealtime } from '@/lib/hooks/useInboxRealtime'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BrandMark } from '@/components/ui/BrandMark'
import { Tooltip } from '@/components/ui/Tooltip'
import { HeaderAnnouncementTicker } from './HeaderAnnouncementTicker'
import { InboxPanel } from './InboxPanel'
import { useProjectNavigation } from './ProjectNavigationContext'
import type { SidebarProject } from './Sidebar'
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'

const SECTION_LABEL: Record<string, string> = {
  dashboard: '대시보드', wbs: 'WBS · 간트', gantt: '간트 차트', kanban: '칸반 보드', issues: '이슈관리',
  members: '멤버', attendance: '근태현황', announcements: '공지사항', meetings: '회의', weekly: '주간업무', wiki: '프로젝트 Wiki', settings: '설정',
}

/** 서버 레이아웃이 Actor 에서 평탄화해 내리는 신원 표시용 스냅샷 — Actor(Map)는 직렬화되지 않는다. */
export interface HeaderIdentity {
  roleLabel: string
  teamCode: string | null
  /** 팀 관리·LLM 설정·사용 현황 등 전역 메뉴 노출 */
  isSuperuser: boolean
  showUsage: boolean
  showPortfolio: boolean
}

export function HeaderChrome({ identity, projects, userName }: { identity: HeaderIdentity | null; projects: SidebarProject[]; userName?: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const { locale, setLocale, t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState<null | 'notif' | 'profile'>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [notifs, setNotifs] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxFailed, setInboxFailed] = useState(false)
  const [unreadAnn, setUnreadAnn] = useState(0)

  const { routeProjectId } = useProjectNavigation()

  useEffect(() => { setMenuOpen(false); setOpen(null) }, [pathname])
  // 활성 프로젝트의 지연·마감 알림 로드
  useEffect(() => {
    // 프로젝트를 벗어나면 로딩 플래그도 함께 리셋 — 안 하면 true로 고정돼 공유 게이트
    // (loading={inboxLoading || notifLoading})가 무기한 스피너에 갇힌다.
    if (!routeProjectId) { setNotifs([]); setNotifLoading(false); return }
    let alive = true
    setNotifLoading(true)
    getNotifications(routeProjectId)
      .then(r => { if (alive) setNotifs(r.items) })
      .catch(() => {})
      .finally(() => { if (alive) setNotifLoading(false) })
    return () => { alive = false }
  }, [routeProjectId])

  // 개인 알림함 로드 — 파생(프로젝트 의존)과 달리 프로젝트 무관, 경로 변경마다 재조회.
  // 공지 안읽음 합산도 여기서 같이 갱신(routeProjectId 의존). notifLoading(파생 전용)과
  // 별도 로딩 플래그를 둔다 — 프로젝트 미선택 시 notifLoading이 false로 고정돼 있어
  // 이 피드에 얹으면 로딩 중에도 "새 알림 없음"으로 보이는 거짓 빈 상태가 생긴다.
  useEffect(() => {
    let alive = true
    setInboxLoading(true)
    getInboxFeed()
      .then(r => { if (!alive) return; setInbox(r.items); setInboxFailed(r.failed === true) })
      .catch(() => { if (alive) setInboxFailed(true) })
      .finally(() => { if (alive) setInboxLoading(false) })
    if (routeProjectId) {
      getUnreadAnnouncementCount(routeProjectId).then(n => { if (alive) setUnreadAnn(n) }).catch(() => {})
    } else setUnreadAnn(0)
    return () => { alive = false }
  }, [pathname, routeProjectId])

  // 실시간 배지 갱신 — 향상 계층(구독 실패해도 위 폴링이 대신 채운다).
  const refreshInbox = useCallback(() => {
    getInboxFeed().then(r => { setInbox(r.items); setInboxFailed(r.failed === true) }).catch(() => {})
  }, [])
  useInboxRealtime(refreshInbox)

  const context = useMemo(() => {
    const globalSection = pathname === '/meetings'
      ? t('nav.myMeetings')
      : pathname === '/minutes' || pathname.startsWith('/minutes/')
        ? t('nav.minutes')
        : null
    if (globalSection) {
      return { rootLabel: t('nav.workspace'), sectionLabel: globalSection }
    }

    const match = pathname.match(/^\/p\/[^/]+\/?([^/]+)?/)
    if (!routeProjectId || !match) return { rootLabel: null as string | null, sectionLabel: null as string | null }
    const project = projects.find(p => p.id === routeProjectId) ?? null
    const section = SECTION_LABEL[match[1] ?? ''] ?? '프로젝트'
    return {
      rootLabel: project?.name ?? null,
      sectionLabel: section === '프로젝트' ? null : section,
    }
  }, [pathname, projects, routeProjectId, t])

  const signOut = async () => {
    await createBrowserClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  // 패널·배지는 안읽음만 표시(읽은 항목은 목록에서 제거 — 사용자 결정). notifs는 읽음 포함
  // 전체를 유지한다 — '모두 읽음' 저장이 전체 id를 보내야 기존 읽음이 유실되지 않는다(replace 시맨틱).
  const visibleNotifs = useMemo(() => notifs.filter(n => !n.read), [notifs])
  const unreadNotifs = visibleNotifs.length
  const markAllRead = () => {
    if (!routeProjectId || unreadNotifs === 0) return
    const snapshot = notifs
    setNotifs(ns => ns.map(n => ({ ...n, read: true }))) // 낙관 반영 — 배지 즉시 0
    markAllNotificationsRead(routeProjectId, snapshot.map(n => n.id))
      .then(r => { if (!r.ok) setNotifs(snapshot) }) // 실패 시 복원(다음 로드가 서버 상태로 재정렬)
      .catch(() => setNotifs(snapshot))
  }

  // 배지 합산 — 개인 unseen + 파생 안읽음 + 공지 안읽음(결정 N3: 한 벨, 합산 배지)
  const unseenInbox = useMemo(() => inbox.filter(n => !n.seen).length, [inbox])
  const badge = unseenInbox + unreadNotifs + unreadAnn

  // 벨 열람 = seen 소등(read 는 항목 클릭에서 처리)
  // 세 액션(markInbox*) 모두 throw 하지 않고 {ok:false}를 반환하므로, 낙관 반영 후
  // r.ok 를 봐야 실패를 감지할 수 있다 — markAllRead(파생 구획, 위)와 동일한 스냅샷/롤백 패턴.
  const openNotif = () => {
    const next = open === 'notif' ? null : 'notif'
    setOpen(next)
    if (next === 'notif' && unseenInbox > 0) {
      const snapshot = inbox
      setInbox(ns => ns.map(n => ({ ...n, seen: true }))) // 낙관 반영
      markInboxSeen()
        .then(r => { if (!r.ok) setInbox(snapshot) })
        .catch(() => setInbox(snapshot))
    }
  }

  const onInboxItemClick = (item: InboxItem) => {
    const snapshot = inbox
    setInbox(ns => ns.map(n => (n.recipientId === item.recipientId ? { ...n, read: true } : n)))
    markInboxItemRead(item.recipientId)
      .then(r => { if (!r.ok) setInbox(snapshot) })
      .catch(() => setInbox(snapshot))
    if (item.href) { setOpen(null); router.push(item.href) }
  }

  const onMarkAllRead = () => {
    const snapshot = inbox
    setInbox(ns => ns.map(n => ({ ...n, read: true, seen: true })))
    markAllInboxRead()
      .then(r => { if (!r.ok) setInbox(snapshot) })
      .catch(() => setInbox(snapshot))
    markAllRead() // 기존 파생 구획 읽음 처리 재사용
  }

  const roleLabel = identity?.roleLabel ?? '게스트'
  const displayName = userName?.trim() || null
  // 프로필 부제: 이름이 있으면 역할·팀을, 없으면 팀만.
  const roleTeam = identity?.teamCode ? `${roleLabel} · ${identity.teamCode}` : roleLabel

  return (
    <>
      <header className="sticky top-0 z-[70] px-3 pt-2 sm:px-5 lg:px-7">
        <div className="flex h-12 items-center gap-3 rounded-2xl border border-line bg-surface/85 px-3 shadow-[var(--shadow-sm)] backdrop-blur-xl sm:px-4">
          {/* 로고 */}
          <button onClick={() => setMenuOpen(true)} className="chrome-icon lg:hidden" aria-label="메뉴 열기"><Menu className="h-4 w-4" /></button>
          <Link href="/projects" className="hidden items-center sm:flex" aria-label="D'Flow 홈">
            <BrandMark withWordmark tagline />
          </Link>

          {/* 브레드크럼 */}
          {context.rootLabel && (
            <nav className="ml-1 hidden min-w-0 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 md:flex" aria-label="현재 위치">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="truncate text-[13px] font-semibold text-ink">{context.rootLabel}</span>
              {context.sectionLabel && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="truncate text-[13px] font-medium text-ink-muted">{context.sectionLabel}</span>
                </>
              )}
            </nav>
          )}

          {/* 공지 티커 — 브레드크럼과 우측 컨트롤 사이 빈 공간에 공지 제목 상시 노출.
              @container: 남은 공간이 좁으면 티커가 스스로 숨도록 컨테이너 쿼리 기준점 제공 */}
          <div className="@container hidden min-w-0 flex-1 md:flex">
            <HeaderAnnouncementTicker projectId={routeProjectId} />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* 공정율 기준일 자동/수동 바로가기 버튼 — 사용자 요청으로 화면에서 제거(기능은 설정 페이지에 유지) */}
            {/* 언어 전환·다크모드 토글 — 사용자 요청으로 화면에서 숨김(기능 코드는 유지) */}
            <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')} className="chrome-btn hidden" title="Language">
              <Globe className="h-3.5 w-3.5" />{locale.toUpperCase()}
            </button>
            <button onClick={toggle} className="chrome-icon hidden" aria-label={theme === 'dark' ? t('chrome.lightMode') : t('chrome.darkMode')}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* 알림 */}
            <div className="relative">
              <Tooltip label={t('chrome.notifications')} side="bottom" disabled={open === 'notif'}>
                <button onClick={openNotif} className="chrome-icon relative" aria-label={t('chrome.notifications')}>
                  <Bell className="h-4 w-4" />
                  {badge > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-secondary px-1 text-[9px] font-bold text-white ring-2 ring-surface">{badge}</span>
                  )}
                </button>
              </Tooltip>
              {open === 'notif' && (
                <Popover onClose={() => setOpen(null)}>
                  <InboxPanel
                    items={inbox} derived={visibleNotifs} unreadAnnouncements={unreadAnn}
                    projectId={routeProjectId} loading={inboxLoading || notifLoading} failed={inboxFailed}
                    onItemClick={onInboxItemClick} onMarkAllRead={onMarkAllRead}
                  />
                </Popover>
              )}
            </div>

            {/* 프로필 */}
            <div className="relative">
              <button onClick={() => setOpen(open === 'profile' ? null : 'profile')} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 transition hover:border-line-strong sm:pr-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ backgroundImage: 'var(--gradient-primary)' }}><User className="h-4 w-4" /></span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-[11px] font-semibold text-ink">{displayName ?? roleLabel}</span>
                  <span className="block text-[9px] text-ink-subtle">{displayName ? roleLabel : (identity?.teamCode ?? '—')}</span>
                </span>
              </button>
              {open === 'profile' && (
                <Popover onClose={() => setOpen(null)}>
                  <div className="border-b border-line px-4 py-3">
                    <div className="text-sm font-semibold text-ink">{displayName ?? roleLabel}</div>
                    <div className="mt-0.5 text-xs text-ink-subtle">{displayName ? roleTeam : (identity?.teamCode ? `${identity.teamCode} 팀` : '소속 미지정')}</div>
                  </div>
                  <Link href="/account" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                    <KeyRound className="h-4 w-4" />내 계정
                  </Link>
                  {identity?.isSuperuser && (
                    <>
                      <Link href="/admin/teams" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                        <Users className="h-4 w-4" />팀 관리
                      </Link>
                      {/* 서버 전역 LLM 설정 — 프로젝트 설정 페이지에도 진입 카드가 있지만,
                          프로젝트가 하나도 없는 슈퍼유저는 그 경로로 도달할 수 없어 여기에도 둔다. */}
                      <Link href="/admin/llm-config" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                        <Cpu className="h-4 w-4" />LLM 설정
                      </Link>
                    </>
                  )}
                  <button onClick={signOut} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-delayed">
                    <LogOut className="h-4 w-4" />{t('chrome.logout')}
                  </button>
                </Popover>
              )}
            </div>
          </div>
        </div>
      </header>

      {menuOpen && <MobileMenu projects={projects} pathname={pathname} onClose={() => setMenuOpen(false)} roleLabel={roleLabel} identity={identity} displayName={displayName} />}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  )
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label="닫기" onClick={onClose} />
      <div className="absolute right-0 top-12 z-[95] w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]">{children}</div>
    </>
  )
}

function MobileMenu({
  projects, pathname, onClose, roleLabel, identity, displayName,
}: { projects: SidebarProject[]; pathname: string; onClose: () => void; roleLabel: string; identity: HeaderIdentity | null; displayName: string | null }) {
  const router = useRouter()
  const { t } = useLocale()
  const { routeProjectId, menuProjectId, menuProject, isGlobalBridge, returnHref } = useProjectNavigation()
  // 최근 메뉴 문맥은 아래 복귀 링크/하위 메뉴로 유지하되, 콤보는 실제 URL 프로젝트만
  // 선택한다. 그래야 전역 화면에서 최근 프로젝트 자체를 골라도 change가 발생한다.
  const selectedProjectId = routeProjectId ?? ''

  // 안읽음 공지 배지 — 데스크탑 사이드바와 동일한 지표를 모바일 메뉴에서도 노출.
  // 메뉴가 열릴 때(마운트)만 조회하므로 추가 비용은 열람 시 1회.
  const [unreadAnn, setUnreadAnn] = useState(0)
  useEffect(() => {
    if (!menuProjectId) {
      setUnreadAnn(0)
      return
    }
    let alive = true
    getUnreadAnnouncementCount(menuProjectId)
      .then(n => { if (alive) setUnreadAnn(n) })
      .catch(() => {})
    return () => { alive = false }
  }, [menuProjectId])

  const links = menuProjectId
    ? [
        { href: `/p/${menuProjectId}/dashboard`, label: t('nav.dashboard') },
        { href: `/p/${menuProjectId}/wbs`, label: t('nav.wbsGantt') },
        { href: `/p/${menuProjectId}/kanban`, label: t('nav.kanban') },
        { href: `/p/${menuProjectId}/issues`, label: t('nav.issues') },
        { href: `/p/${menuProjectId}/wiki`, label: t('nav.wiki') },
        { href: `/p/${menuProjectId}/members`, label: t('nav.members') },
        { href: `/p/${menuProjectId}/attendance`, label: t('nav.attendance') },
        { href: `/p/${menuProjectId}/announcements`, label: t('nav.announcements'), badge: unreadAnn },
        { href: `/p/${menuProjectId}/meetings`, label: t('nav.meetings') },
        { href: `/p/${menuProjectId}/weekly`, label: t('nav.weekly') },
        { href: `/p/${menuProjectId}/settings`, label: t('nav.settings') },
      ]
    : []
  return (
    <div className="fixed inset-0 z-[100] lg:hidden" role="dialog" aria-modal="true" aria-label="모바일 메뉴">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="메뉴 닫기" />
      <div className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-sidebar p-4 text-sidebar-ink shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">D&apos;Flow</span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg border border-sidebar-line text-sidebar-ink-muted"><X className="h-4 w-4" /></button>
        </div>
        <nav className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto">
          <Link href="/projects" onClick={onClose} aria-current={pathname === '/projects' ? 'page' : undefined} className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''}`}>{t('nav.allProjects')}</Link>
          <Link href="/meetings" onClick={onClose} aria-current={pathname === '/meetings' ? 'page' : undefined} className={`side-link ${pathname === '/meetings' ? 'side-link-active' : ''}`}>{t('nav.myMeetings')}</Link>
          <Link href="/minutes" onClick={onClose} aria-current={pathname.startsWith('/minutes') ? 'page' : undefined} className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''}`}>{t('nav.minutes')}</Link>
          {/* 사이드바는 hidden lg:flex 라 lg 미만에서는 여기가 /portfolio 의 유일한 진입점이다 — 슈퍼유저 전용 */}
          {identity?.showPortfolio && (
            <Link href="/portfolio" onClick={onClose} aria-current={pathname === '/portfolio' ? 'page' : undefined} className={`side-link ${pathname === '/portfolio' ? 'side-link-active' : ''}`}>{t('nav.portfolio')}</Link>
          )}
          {/* 사이드바는 hidden lg:flex 라 lg 미만에서는 여기가 /usage 의 유일한 진입점이다 — 슈퍼유저 전용 */}
          {identity?.showUsage && (
            <Link href="/usage" onClick={onClose} aria-current={pathname === '/usage' ? 'page' : undefined} className={`side-link ${pathname === '/usage' ? 'side-link-active' : ''}`}>{t('nav.usage')}</Link>
          )}
          {isGlobalBridge && menuProject && returnHref && (
            <Link
              href={returnHref}
              onClick={onClose}
              className="mx-1 mt-3 flex items-center gap-2 rounded-xl border border-sidebar-line bg-sidebar-2 px-3 py-2.5 text-sidebar-ink transition hover:border-sidebar-ink-subtle"
            >
              <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-sidebar-ink-muted" />
              <span className="min-w-0">
                <span className="block text-[10px] font-medium text-sidebar-ink-muted">프로젝트로 돌아가기</span>
                <span className="block truncate text-[13px] font-semibold">{menuProject.name}</span>
              </span>
            </Link>
          )}
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</div>
          <div className="mx-1">
            <select
              aria-label={t('common.selectProject')}
              value={selectedProjectId}
              disabled={projects.length === 0}
              onChange={event => {
                const projectId = event.target.value
                if (!projects.some(project => project.id === projectId)) return
                router.push(`/p/${encodeURIComponent(projectId)}/dashboard`)
                onClose()
              }}
              className="h-10 w-full rounded-xl border border-sidebar-line bg-sidebar-2 px-3 text-[13px] font-medium text-sidebar-ink outline-none transition focus:border-sidebar-ink-subtle disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled={projects.length > 0}>
                {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
              </option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          {links.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">
                프로젝트 메뉴{menuProject ? ` · ${menuProject.name}` : ''}
              </div>
              {links.map(l => {
                const active = routeProjectId === menuProjectId
                  && (pathname === l.href || pathname.startsWith(`${l.href}/`))
                return (
                  <Link key={l.label} onClick={onClose} href={l.href} aria-current={active ? 'page' : undefined} className={`side-link ${active ? 'side-link-active' : ''}`}>
                    <span className="flex-1">{l.label}</span>
                    {(l.badge ?? 0) > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-secondary px-1.5 text-[10px] font-bold tabular-nums text-white">
                        {l.badge! > 99 ? '99+' : l.badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </>
          )}
        </nav>
        {identity && (
          <div className="mt-auto rounded-xl border border-sidebar-line bg-sidebar-2 p-3 text-xs text-sidebar-ink-muted">
            <div className="font-semibold text-sidebar-ink">{displayName ?? roleLabel}</div>
            <div className="mt-0.5">{identity.teamCode ? (displayName ? `${roleLabel} · ${identity.teamCode} 팀` : `${identity.teamCode} 팀`) : roleLabel}</div>
          </div>
        )}
      </div>
    </div>
  )
}
