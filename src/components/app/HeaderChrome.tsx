'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bell, ChevronRight, Clock4, Globe, LogOut, Menu, Moon, PanelTopClose, PanelTopOpen, Sun, User, X,
} from 'lucide-react'
import type { Membership } from '@/lib/domain/types'
import { createBrowserClient } from '@/lib/supabase/client'
import { getNotifications, type NotificationItem } from '@/app/actions/notifications'
import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BrandMark } from '@/components/ui/BrandMark'
import { readHeroCollapsed, dispatchHeroToggle, HERO_TOGGLE_EVENT } from '@/components/ui/PageHero'
import { HeaderAnnouncementTicker } from './HeaderAnnouncementTicker'
import type { SidebarProject } from './Sidebar'

const SECTION_LABEL: Record<string, string> = {
  dashboard: '대시보드', wbs: 'WBS · 간트', gantt: '간트 차트', kanban: '칸반 보드',
  members: '멤버', attendance: '근태현황', announcements: '공지사항', meetings: '회의', settings: '설정',
}

export function HeaderChrome({ membership, projects }: { membership: Membership | null; projects: SidebarProject[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const { locale, setLocale, t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState<null | 'notif' | 'profile'>(null)
  const [notifs, setNotifs] = useState<NotificationItem[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  // 히어로 중앙 토글 상태
  const [heroCollapsed, setHeroCollapsed] = useState(() => readHeroCollapsed())

  const activeId = useMemo(() => pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null, [pathname])

  useEffect(() => { setMenuOpen(false); setOpen(null) }, [pathname])
  // 히어로 외부 토글 이벤트 수신 — 헤더 버튼 상태를 동기화
  useEffect(() => {
    const sync = (e: Event) => setHeroCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    window.addEventListener(HERO_TOGGLE_EVENT, sync)
    return () => window.removeEventListener(HERO_TOGGLE_EVENT, sync)
  }, [])
  // 활성 프로젝트의 지연·마감 알림 로드
  useEffect(() => {
    if (!activeId) { setNotifs([]); return }
    let alive = true
    setNotifLoading(true)
    getNotifications(activeId)
      .then(r => { if (alive) setNotifs(r.items) })
      .catch(() => {})
      .finally(() => { if (alive) setNotifLoading(false) })
    return () => { alive = false }
  }, [activeId])

  const context = useMemo(() => {
    const match = pathname.match(/^\/p\/([^/]+)\/?([^/]+)?/)
    if (!match) return { project: null as SidebarProject | null, section: '워크스페이스' }
    return {
      project: projects.find(p => p.id === match[1]) ?? null,
      section: SECTION_LABEL[match[2] ?? ''] ?? '프로젝트',
    }
  }, [pathname, projects])

  const signOut = async () => {
    await createBrowserClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const roleLabel = membership?.role === 'pmo_admin' ? 'PMO 관리자' : membership ? '팀 편집자' : '게스트'

  return (
    <>
      <header className="sticky top-0 z-[70] px-3 pt-3 sm:px-5 lg:px-7">
        <div className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface/85 px-3 shadow-[var(--shadow-sm)] backdrop-blur-xl sm:px-4">
          {/* 로고 */}
          <button onClick={() => setMenuOpen(true)} className="chrome-icon lg:hidden" aria-label="메뉴 열기"><Menu className="h-4 w-4" /></button>
          <Link href="/projects" className="hidden items-center sm:flex" aria-label="D'Flow 홈">
            <BrandMark withWordmark tagline />
          </Link>

          {/* 브레드크럼 */}
          {context.project && (
            <nav className="ml-1 hidden min-w-0 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 md:flex" aria-label="현재 위치">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="truncate text-[13px] font-semibold text-ink">{context.project.name}</span>
              {context.section && context.section !== '프로젝트' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="truncate text-[13px] font-medium text-ink-muted">{context.section}</span>
                </>
              )}
            </nav>
          )}

          {/* 공지 티커 — 브레드크럼과 우측 컨트롤 사이 빈 공간에 공지 제목 상시 노출.
              @container: 남은 공간이 좁으면 티커가 스스로 숨도록 컨테이너 쿼리 기준점 제공 */}
          <div className="@container hidden min-w-0 flex-1 md:flex">
            <HeaderAnnouncementTicker projectId={activeId} />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* 히어로 접기/펼치기 중앙 토글 */}
            <button
              onClick={() => { const next = !heroCollapsed; setHeroCollapsed(next); dispatchHeroToggle(next) }}
              className="chrome-btn"
              title={heroCollapsed ? t('chrome.heroShow') : t('chrome.heroHide')}
              aria-label={heroCollapsed ? t('chrome.heroShow') : t('chrome.heroHide')}
            >
              {heroCollapsed ? <PanelTopOpen className="h-3.5 w-3.5" /> : <PanelTopClose className="h-3.5 w-3.5" />}
              {heroCollapsed ? t('chrome.heroShow') : t('chrome.heroHide')}
            </button>
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
              <button onClick={() => setOpen(open === 'notif' ? null : 'notif')} className="chrome-icon relative" aria-label={t('chrome.notifications')}>
                <Bell className="h-4 w-4" />
                {notifs.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-secondary px-1 text-[9px] font-bold text-white ring-2 ring-surface">{notifs.length}</span>
                )}
              </button>
              {open === 'notif' && (
                <Popover onClose={() => setOpen(null)}>
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <span className="text-sm font-semibold text-ink">{t('chrome.notifications')}</span>
                    {notifs.length > 0 && <span className="chip bg-delayed-weak text-delayed">{notifs.length}</span>}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {!activeId ? (
                      <div className="px-4 py-6 text-center text-xs text-ink-subtle">프로젝트를 선택하면 지연·마감 알림이 표시됩니다.</div>
                    ) : notifLoading ? (
                      <div className="px-4 py-6 text-center text-xs text-ink-subtle">불러오는 중…</div>
                    ) : notifs.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-ink-subtle">지연·마감 임박 작업이 없습니다. 👍</div>
                    ) : (
                      <ul className="divide-y divide-line">
                        {notifs.map(n => (
                          <li key={n.id}>
                            <Link href={`/p/${activeId}/kanban`} className="flex gap-3 px-4 py-3 transition hover:bg-surface-2">
                              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${n.severity === 'danger' ? 'bg-delayed-weak text-delayed' : 'bg-pending-weak text-accent-warning'}`}>
                                {n.type === 'delayed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock4 className="h-3.5 w-3.5" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                                <span className="block text-[11px] text-ink-muted">{n.detail}</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Popover>
              )}
            </div>

            {/* 프로필 */}
            <div className="relative">
              <button onClick={() => setOpen(open === 'profile' ? null : 'profile')} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 transition hover:border-line-strong sm:pr-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ backgroundImage: 'var(--gradient-primary)' }}><User className="h-4 w-4" /></span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-[11px] font-semibold text-ink">{roleLabel}</span>
                  <span className="block text-[9px] text-ink-subtle">{membership?.teamCode ?? '—'}</span>
                </span>
              </button>
              {open === 'profile' && (
                <Popover onClose={() => setOpen(null)}>
                  <div className="border-b border-line px-4 py-3">
                    <div className="text-sm font-semibold text-ink">{roleLabel}</div>
                    <div className="mt-0.5 text-xs text-ink-subtle">{membership?.teamCode ? `${membership.teamCode} 팀` : '소속 미지정'}</div>
                  </div>
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-delayed">
                    <LogOut className="h-4 w-4" />{t('chrome.logout')}
                  </button>
                </Popover>
              )}
            </div>
          </div>
        </div>
      </header>

      {menuOpen && <MobileMenu projects={projects} pathname={pathname} onClose={() => setMenuOpen(false)} roleLabel={roleLabel} membership={membership} />}
    </>
  )
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <button className="fixed inset-0 z-[90] cursor-default" aria-label="닫기" onClick={onClose} />
      <div className="absolute right-0 top-12 z-[95] w-64 overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)]">{children}</div>
    </>
  )
}

function MobileMenu({
  projects, pathname, onClose, roleLabel, membership,
}: { projects: SidebarProject[]; pathname: string; onClose: () => void; roleLabel: string; membership: Membership | null }) {
  const { t } = useLocale()
  const activeId = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null

  // 안읽음 공지 배지 — 데스크탑 사이드바와 동일한 지표를 모바일 메뉴에서도 노출.
  // 메뉴가 열릴 때(마운트)만 조회하므로 추가 비용은 열람 시 1회.
  const [unreadAnn, setUnreadAnn] = useState(0)
  useEffect(() => {
    if (!activeId) return
    let alive = true
    getUnreadAnnouncementCount(activeId)
      .then(n => { if (alive) setUnreadAnn(n) })
      .catch(() => {})
    return () => { alive = false }
  }, [activeId])

  const links = activeId
    ? [
        { href: `/p/${activeId}/dashboard`, label: t('nav.dashboard') },
        { href: `/p/${activeId}/wbs`, label: t('nav.wbsGantt') },
        { href: `/p/${activeId}/kanban`, label: t('nav.kanban') },
        { href: `/p/${activeId}/members`, label: t('nav.members') },
        { href: `/p/${activeId}/attendance`, label: t('nav.attendance') },
        { href: `/p/${activeId}/announcements`, label: t('nav.announcements'), badge: unreadAnn },
        { href: `/p/${activeId}/meetings`, label: t('nav.meetings') },
        { href: `/p/${activeId}/settings`, label: t('nav.settings') },
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
          <Link href="/projects" onClick={onClose} className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''}`}>{t('nav.allProjects')}</Link>
          <Link href="/meetings" onClick={onClose} className={`side-link ${pathname === '/meetings' ? 'side-link-active' : ''}`}>{t('nav.myMeetings')}</Link>
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</div>
          {projects.map(p => (
            <Link key={p.id} onClick={onClose} href={`/p/${p.id}/dashboard`} className={`side-link ${pathname.startsWith(`/p/${p.id}`) ? 'side-link-active' : ''}`}>
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
          {links.length > 0 && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">메뉴</div>}
          {links.map(l => (
            <Link key={l.label} onClick={onClose} href={l.href} className={`side-link ${pathname === l.href ? 'side-link-active' : ''}`}>
              <span className="flex-1">{l.label}</span>
              {(l.badge ?? 0) > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-secondary px-1.5 text-[10px] font-bold tabular-nums text-white">
                  {l.badge! > 99 ? '99+' : l.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {membership && (
          <div className="mt-auto rounded-xl border border-sidebar-line bg-sidebar-2 p-3 text-xs text-sidebar-ink-muted">
            <div className="font-semibold text-sidebar-ink">{roleLabel}</div>
            <div className="mt-0.5">{membership.teamCode} 팀</div>
          </div>
        )}
      </div>
    </div>
  )
}
