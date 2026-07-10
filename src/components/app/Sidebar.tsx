'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck, CalendarClock, CalendarRange, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, Megaphone, NotebookPen, NotebookText, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import type { DictKey } from '@/lib/i18n/dict'

export type SidebarProject = { id: string; name: string; status: 'ready' | 'active' | 'done'; baseDate?: string | null }

export const SIDEBAR_STORAGE_KEY = 'dflow-sidebar'

/** 헤더 등 외부에서 사이드바 접기/펼치기를 일괄 제어할 때 dispatch하는 CustomEvent 이름. */
export const SIDEBAR_TOGGLE_EVENT = 'dflow-sidebar-toggle'

/** localStorage 갱신 + 이벤트 dispatch. 서버 쓰기는 사용자 토글 시에만(여기서 하지 않음 — reconcile 재사용 안전). */
export function dispatchSidebarToggle(collapsed: boolean): void {
  try { localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0') } catch {}
  window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { collapsed } }))
}

const STATUS_META: Record<SidebarProject['status'], { dot: string; label: string }> = {
  ready: { dot: 'bg-amber-400', label: '준비' },
  active: { dot: 'bg-emerald-400', label: '진행중' },
  done: { dot: 'bg-sky-400', label: '완료' },
}

function projectMenu(base: string): { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] {
  return [
    { href: `${base}/dashboard`, labelKey: 'nav.dashboard', icon: LayoutDashboard, match: `${base}/dashboard` },
    { href: `${base}/wbs`, labelKey: 'nav.wbsGantt', icon: ListTree, match: `${base}/wbs` },
    { href: `${base}/kanban`, labelKey: 'nav.kanban', icon: Columns3, match: `${base}/kanban` },
    { href: `${base}/members`, labelKey: 'nav.members', icon: Users, match: `${base}/members` },
    { href: `${base}/attendance`, labelKey: 'nav.attendance', icon: CalendarCheck, match: `${base}/attendance` },
    { href: `${base}/announcements`, labelKey: 'nav.announcements', icon: Megaphone, match: `${base}/announcements` },
    { href: `${base}/meetings`, labelKey: 'nav.meetings', icon: CalendarClock, match: `${base}/meetings` },
    { href: `${base}/weekly`, labelKey: 'nav.weekly', icon: NotebookPen, match: `${base}/weekly` },
    { href: `${base}/settings`, labelKey: 'nav.settings', icon: Settings, match: `${base}/settings` },
  ]
}

export function Sidebar({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1') } catch {}
  }, [])

  // 외부(PrefsSync reconcile / 헤더 등) 토글 이벤트 수신 — 마운트된 Sidebar 동기화.
  useEffect(() => {
    const onToggle = (e: Event) => setCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    dispatchSidebarToggle(next)          // localStorage + 이벤트(→ setCollapsed)
    queueUiPref({ sidebarCollapsed: next }) // 사용자 액션만 서버 저장
  }

  const activeId = useMemo(() => pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null, [pathname])
  const activeCount = projects.filter(p => p.status === 'active').length

  // 안읽음 공지 배지 — 헤더 벨과 같은 "네비게이션당 1회 조회" 패턴.
  // pathname 키잉이라 공지 페이지를 다녀오면(워터마크 갱신 후) 재조회되어 배지가 사라진다.
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!activeId) { setUnread(0); return }
    let alive = true
    getUnreadAnnouncementCount(activeId)
      .then(n => { if (alive) setUnread(n) })
      .catch(() => {})
    return () => { alive = false }
  }, [activeId, pathname])

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto bg-sidebar px-3 py-3 text-sidebar-ink lg:flex ${collapsed ? 'w-[78px]' : 'w-[248px]'} transition-[width] duration-200`}
    >
      <div className="flex items-center justify-end">
        <button onClick={toggleCollapse} className="flex h-6 w-6 items-center justify-center rounded-md border border-sidebar-line text-sidebar-ink-muted transition hover:bg-sidebar-3 hover:text-sidebar-ink" aria-label="사이드바 접기">
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* WORKSPACE 카드 */}
      {!collapsed && (
        <div className="mt-1 rounded-2xl border border-sidebar-line bg-sidebar-2 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-ink-subtle">Workspace</span>
          </div>
          <div className="mt-0.5 text-[14px] font-bold tracking-tight text-sidebar-ink">{t('workspace.title')}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-sidebar-line bg-sidebar-3/60 px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">{t('workspace.projects')}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-sidebar-ink">{projects.length}</div>
            </div>
            <div className="rounded-xl border border-sidebar-line bg-sidebar-3/60 px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">{t('workspace.active')}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-sidebar-ink">{activeCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* 전역: 내 회의 */}
      <Link href="/meetings" title={t('nav.myMeetings')}
        className={`side-link mt-2 ${pathname === '/meetings' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
        <CalendarRange className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="flex-1">{t('nav.myMeetings')}</span>}
      </Link>

      {/* 전역: 회의록 */}
      <Link href="/minutes" title={t('nav.minutes')}
        className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
        <NotebookText className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="flex-1">{t('nav.minutes')}</span>}
      </Link>

      {/* 프로젝트 리스트 */}
      <div className="mt-4 flex shrink-0 flex-col">
        <div className="mb-1.5 flex shrink-0 items-center justify-between px-2">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</span>}
          <Link href="/projects" className="text-[10px] font-medium text-sidebar-ink-muted transition hover:text-sidebar-ink">{collapsed ? '' : t('common.viewAll')}</Link>
        </div>
        <ul className="max-h-[42vh] shrink-0 space-y-1 overflow-y-auto">
          {projects.map(project => {
            const active = activeId === project.id
            const meta = STATUS_META[project.status]
            return (
              <li key={project.id}>
                <Link
                  href={`/p/${project.id}/dashboard`}
                  aria-current={active ? 'page' : undefined}
                  title={project.name}
                  className={`side-link group ${active ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <FolderOpen className={`h-4 w-4 shrink-0 ${active ? 'text-sidebar-ink' : 'text-sidebar-ink-muted group-hover:text-sidebar-ink'}`} />
                  {!collapsed && (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] leading-tight">{project.name}</span>
                      <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-sidebar-ink-subtle">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
          {projects.length === 0 && !collapsed && (
            <li className="px-3 py-4 text-center text-xs leading-5 text-sidebar-ink-subtle">첫 프로젝트를 만들어 시작하세요.</li>
          )}
        </ul>

        {/* 메뉴 섹션 */}
        <nav className="mt-4 shrink-0 border-t border-sidebar-line pt-3" aria-label="주요 메뉴">
          <div className="mb-1.5 flex items-center justify-between px-2">
            {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">메뉴</span>}
            <Link href="/projects" className="flex h-6 w-6 items-center justify-center rounded-lg border border-sidebar-line text-sidebar-ink-muted transition hover:bg-sidebar-3 hover:text-sidebar-ink" aria-label={t('common.newProject')}>
              <Plus className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="space-y-1">
            {activeId ? (
              projectMenu(`/p/${activeId}`).map(item => {
                const active = pathname === item.match || pathname.startsWith(item.match + '/')
                const ItemIcon = item.icon
                const label = t(item.labelKey)
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} title={label} className={`side-link relative ${active ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <ItemIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="flex-1">{label}</span>}
                    {!collapsed && item.labelKey === 'nav.announcements' && unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-secondary px-1.5 text-[10px] font-bold tabular-nums text-white">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                    {collapsed && item.labelKey === 'nav.announcements' && unread > 0 && (
                      <span aria-hidden className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-secondary ring-2 ring-sidebar" />
                    )}
                  </Link>
                )
              })
            ) : (
              <>
                <Link href="/projects" className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`} title={t('nav.home')}>
                  <LayoutGrid className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.home')}</span>}
                </Link>
                <Link href="/projects" className={`side-link ${collapsed ? 'justify-center px-0' : ''}`} title={t('nav.allProjects')}>
                  <FolderOpen className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.allProjects')}</span>}
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </aside>
  )
}
