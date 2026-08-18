'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ArrowLeft, BarChart3, BookOpenText, CalendarCheck, CalendarClock, CalendarRange, CircleAlert, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, Megaphone, NotebookPen, NotebookText, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Tooltip } from '@/components/ui/Tooltip'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useShellState } from './ShellStateProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { useProjectNavigation } from './ProjectNavigationContext'

export type SidebarProject = { id: string; name: string; status: 'ready' | 'active' | 'overdue' | 'done' | 'unknown'; baseDate?: string | null }

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
  // '지연 종료' = 기간 경과+미완(생애 축) — 대시보드의 '지연'(계획 대비 미달)과 다른 개념이라 라벨을 홈과 통일
  overdue: { dot: 'bg-rose-400', label: '지연 종료' },
  done: { dot: 'bg-sky-400', label: '완료' },
  // WBS 조회 실패 — 완료 여부를 모른다. 모름을 '완료'로 표시하지 않기 위한 상태(추측 금지)
  unknown: { dot: 'bg-slate-400', label: '확인 불가' },
}

function projectMenu(base: string, showUsage: boolean): { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] {
  const items: { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] = [
    { href: `${base}/dashboard`, labelKey: 'nav.dashboard', icon: LayoutDashboard, match: `${base}/dashboard` },
    { href: `${base}/wbs`, labelKey: 'nav.wbsGantt', icon: ListTree, match: `${base}/wbs` },
    { href: `${base}/kanban`, labelKey: 'nav.kanban', icon: Columns3, match: `${base}/kanban` },
    { href: `${base}/meetings`, labelKey: 'nav.meetings', icon: CalendarClock, match: `${base}/meetings` },
    { href: `${base}/weekly`, labelKey: 'nav.weekly', icon: NotebookPen, match: `${base}/weekly` },
    { href: `${base}/issues`, labelKey: 'nav.issues', icon: CircleAlert, match: `${base}/issues` },
    { href: `${base}/wiki`, labelKey: 'nav.wiki', icon: BookOpenText, match: `${base}/wiki` },
    { href: `${base}/announcements`, labelKey: 'nav.announcements', icon: Megaphone, match: `${base}/announcements` },
    { href: `${base}/members`, labelKey: 'nav.members', icon: Users, match: `${base}/members` },
    { href: `${base}/attendance`, labelKey: 'nav.attendance', icon: CalendarCheck, match: `${base}/attendance` },
    { href: `${base}/settings`, labelKey: 'nav.settings', icon: Settings, match: `${base}/settings` },
  ]
  // 사용 현황은 전사 지표(접속·메뉴 사용량)라 프로젝트 스코프가 아니다 —
  // 설정 바로 아래에 두되 링크는 전역 /usage 로 보낸다. 슈퍼유저 전용이라 그 외에는 항목 자체를 숨긴다.
  if (showUsage) items.push({ href: '/usage', labelKey: 'nav.usage', icon: BarChart3, match: '/usage' })
  return items
}

export function Sidebar({ projects, showUsage = false }: { projects: SidebarProject[]; showUsage?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useLocale()
  const {
    routeProjectId,
    menuProjectId,
    menuProject,
    isGlobalBridge,
    returnHref,
  } = useProjectNavigation()
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

  // 전역 화면에서는 최근 메뉴 문맥과 실제 선택을 구분한다. 빈 값이어야 사용자가
  // 최근 프로젝트 자체를 다시 골라도 change가 발생해 대시보드로 진입할 수 있다.
  const selectedProjectId = routeProjectId ?? ''
  const selectedProject = selectedProjectId
    ? projects.find(project => project.id === selectedProjectId) ?? null
    : null

  const selectProject = (projectId: string) => {
    if (!projects.some(project => project.id === projectId)) return
    router.push(`/p/${encodeURIComponent(projectId)}/dashboard`)
  }

  // 안읽음 공지 배지 — ShellStateProvider 가 내비게이션당 통합 1왕복으로 조회한 값을 쓴다.
  // (종전엔 헤더와 이 컴포넌트가 같은 인자로 같은 액션을 각자 쐈다 — 2026-08-18 성능 감사.)
  // 회의록·내 회의에서는 보존한 프로젝트 메뉴(menuProjectId)의 배지를 유지한다.
  const { menuUnreadAnnouncements } = useShellState()
  const unread = menuProjectId ? menuUnreadAnnouncements : 0

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto bg-sidebar px-3 py-3 text-sidebar-ink lg:flex ${collapsed ? 'w-[78px]' : 'w-[248px]'} transition-[width] duration-200`}
    >
      <div className="flex items-center justify-end">
        <Tooltip label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} side="right">
          <button onClick={toggleCollapse} className="flex h-6 w-6 items-center justify-center rounded-md border border-sidebar-line text-sidebar-ink-muted transition hover:bg-sidebar-3 hover:text-sidebar-ink" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* 프로젝트 선택 — 핵심 작업 문맥이므로 사이드바 최상단에 둔다. */}
      <div className="mt-2 flex shrink-0 flex-col">
        <div className="mb-1.5 flex shrink-0 items-center justify-between px-2">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</span>}
          {!collapsed && <Link href="/projects" className="text-[10px] font-medium text-sidebar-ink-muted transition hover:text-sidebar-ink">{t('common.viewAll')}</Link>}
        </div>
        {collapsed ? (
          <Tooltip
            label={projects.length === 0
              ? t('common.noProjects')
              : selectedProject
                ? `${selectedProject.name} · ${STATUS_META[selectedProject.status].label}`
                : t('common.selectProject')}
            side="right"
          >
            <div className="relative mx-auto flex h-9 w-10 items-center justify-center rounded-xl border border-sidebar-line bg-sidebar-2 text-sidebar-ink-muted transition focus-within:border-sidebar-ink-subtle focus-within:ring-2 focus-within:ring-sidebar-line hover:bg-sidebar-3 hover:text-sidebar-ink">
              <FolderOpen className="h-[18px] w-[18px]" aria-hidden />
              <select
                aria-label={t('common.selectProject')}
                value={selectedProjectId}
                disabled={projects.length === 0}
                onChange={event => selectProject(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              >
                <option value="" disabled={projects.length > 0}>
                  {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
                </option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {STATUS_META[project.status].label}
                  </option>
                ))}
              </select>
            </div>
          </Tooltip>
        ) : (
          <div className="relative">
            <FolderOpen className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-sidebar-ink-muted" aria-hidden />
            <select
              aria-label={t('common.selectProject')}
              value={selectedProjectId}
              disabled={projects.length === 0}
              onChange={event => selectProject(event.target.value)}
              className="h-11 w-full cursor-pointer rounded-xl border border-sidebar-line bg-sidebar-2 py-2 pl-9 pr-2 text-[13px] font-medium text-sidebar-ink outline-none transition hover:border-sidebar-ink-subtle focus:border-sidebar-ink-subtle focus:ring-2 focus:ring-sidebar-line disabled:cursor-not-allowed disabled:text-sidebar-ink-subtle"
            >
              <option value="" disabled={projects.length > 0}>
                {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
              </option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name} · {STATUS_META[project.status].label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 전역: 내 회의 */}
      <Tooltip label={t('nav.myMeetings')} side="right" disabled={!collapsed}>
        <Link href="/meetings" aria-current={pathname === '/meetings' ? 'page' : undefined}
          className={`side-link mt-2 ${pathname === '/meetings' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
          <CalendarRange className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1">{t('nav.myMeetings')}</span>}
        </Link>
      </Tooltip>

      {/* 전역: 회의록 */}
      <Tooltip label={t('nav.minutes')} side="right" disabled={!collapsed}>
        <Link href="/minutes" onClick={() => {
          // 회의록은 본문 작업 영역을 넓게 쓰는 화면이므로 진입과 동시에 사이드바를 접는다.
          // 사용자 선택으로 발생한 변경이므로 다음 세션에도 유지되도록 서버 설정도 갱신한다.
          dispatchSidebarToggle(true)
          queueUiPref({ sidebarCollapsed: true })
        }} aria-current={pathname.startsWith('/minutes') ? 'page' : undefined}
          className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
          <NotebookText className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1">{t('nav.minutes')}</span>}
        </Link>
      </Tooltip>

      {/* 메뉴 섹션 */}
      <div className="mt-4 flex shrink-0 flex-col">
        <nav className="shrink-0 border-t border-sidebar-line pt-3" aria-label="주요 메뉴">
          <div className="mb-1.5 flex items-center justify-between px-2">
            {!collapsed && (
              <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">
                {isGlobalBridge && menuProject ? `${menuProject.name} 메뉴` : '메뉴'}
              </span>
            )}
            <Tooltip label={t('common.newProject')} side="right">
              <Link href="/projects" className={`flex h-6 w-6 items-center justify-center rounded-lg border border-sidebar-line text-sidebar-ink-muted transition hover:bg-sidebar-3 hover:text-sidebar-ink ${collapsed ? 'mx-auto' : ''}`} aria-label={t('common.newProject')}>
                <Plus className="h-3.5 w-3.5" />
              </Link>
            </Tooltip>
          </div>
          <div className="space-y-1">
            {menuProjectId ? (
              <>
                {isGlobalBridge && menuProject && returnHref && (
                  <Tooltip label={`${menuProject.name}로 돌아가기`} side="right" disabled={!collapsed}>
                    <Link
                      href={returnHref}
                      className={`side-link mb-2 border border-sidebar-line bg-sidebar-2/70 ${collapsed ? 'justify-center px-0' : ''}`}
                    >
                      <ArrowLeft className="h-[18px] w-[18px] shrink-0" />
                      {!collapsed && (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">{menuProject.name}로 돌아가기</span>
                        </span>
                      )}
                    </Link>
                  </Tooltip>
                )}
                {projectMenu(`/p/${menuProjectId}`, showUsage).map(item => {
                  const active = pathname === item.match || pathname.startsWith(item.match + '/')
                  const ItemIcon = item.icon
                  const label = t(item.labelKey)
                  const projectPrefix = isGlobalBridge && menuProject ? `${menuProject.name} · ` : ''
                  // 접힘 상태에서 공지 항목은 안읽음 수까지 툴팁에 노출(배지가 점으로 축약되므로)
                  const tip = collapsed && item.labelKey === 'nav.announcements' && unread > 0
                    ? `${projectPrefix}${label} · ${unread > 99 ? '99+' : unread}`
                    : `${projectPrefix}${label}`
                  return (
                    <Tooltip key={item.href} label={tip} side="right" disabled={!collapsed}>
                      <Link href={item.href} aria-current={active ? 'page' : undefined} className={`side-link relative ${active ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
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
                    </Tooltip>
                  )
                })}
              </>
            ) : (
              <>
                <Tooltip label={t('nav.home')} side="right" disabled={!collapsed}>
                  <Link href="/projects" className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <LayoutGrid className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.home')}</span>}
                  </Link>
                </Tooltip>
                <Tooltip label={t('nav.allProjects')} side="right" disabled={!collapsed}>
                  <Link href="/projects" className={`side-link ${collapsed ? 'justify-center px-0' : ''}`}>
                    <FolderOpen className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.allProjects')}</span>}
                  </Link>
                </Tooltip>
                {/* 프로젝트를 고르지 않은 상태에서도 사용 현황에 닿을 수 있어야 한다 — 슈퍼유저 전용 */}
                {showUsage && (
                  <Tooltip label={t('nav.usage')} side="right" disabled={!collapsed}>
                    <Link href="/usage" aria-current={pathname === '/usage' ? 'page' : undefined}
                      className={`side-link ${pathname === '/usage' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                      <BarChart3 className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.usage')}</span>}
                    </Link>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </nav>
      </div>
    </aside>
  )
}
