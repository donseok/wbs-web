'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck, CalendarDays, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

export type SidebarProject = { id: string; name: string; status: 'ready' | 'active' | 'done'; baseDate?: string | null }

const STATUS_META: Record<SidebarProject['status'], { dot: string; label: string }> = {
  ready: { dot: 'bg-amber-400', label: '준비' },
  active: { dot: 'bg-emerald-400', label: '진행중' },
  done: { dot: 'bg-sky-400', label: '완료' },
}

function projectMenu(base: string): { href: string; label: string; icon: LucideIcon; match: string }[] {
  return [
    { href: `${base}/dashboard`, label: '대시보드', icon: LayoutDashboard, match: `${base}/dashboard` },
    { href: `${base}/wbs`, label: 'WBS', icon: ListTree, match: `${base}/wbs` },
    { href: `${base}/gantt`, label: '간트 차트', icon: CalendarDays, match: `${base}/gantt` },
    { href: `${base}/kanban`, label: '칸반 보드', icon: Columns3, match: `${base}/kanban` },
    { href: `${base}/members`, label: '멤버', icon: Users, match: `${base}/members` },
    { href: `${base}/attendance`, label: '근태현황', icon: CalendarCheck, match: `${base}/attendance` },
    { href: `${base}/settings`, label: '설정', icon: Settings, match: `${base}/settings` },
  ]
}

export function Sidebar({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('dflow-sidebar') === '1') } catch {}
  }, [])
  const toggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('dflow-sidebar', next ? '1' : '0') } catch {}
      return next
    })
  }

  const activeId = useMemo(() => pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null, [pathname])
  const activeCount = projects.filter(p => p.status === 'active').length

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar px-3 py-4 text-sidebar-ink lg:flex ${collapsed ? 'w-[78px]' : 'w-[248px]'} transition-[width] duration-200`}
    >
      <div className="flex items-center justify-end">
        <button onClick={toggleCollapse} className="flex h-8 w-8 items-center justify-center rounded-lg border border-sidebar-line text-sidebar-ink-muted transition hover:bg-sidebar-3 hover:text-sidebar-ink" aria-label="사이드바 접기">
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* WORKSPACE 카드 */}
      {!collapsed && (
        <div className="mt-2 rounded-2xl border border-sidebar-line bg-sidebar-2 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-ink-subtle">Workspace</div>
          <div className="mt-1 text-[15px] font-bold tracking-tight text-sidebar-ink">{t('workspace.title')}</div>
          <p className="mt-1.5 text-[11px] leading-4 text-sidebar-ink-subtle">{t('workspace.desc')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-sidebar-line bg-sidebar-3/60 px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">{t('workspace.projects')}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-sidebar-ink">{projects.length}</div>
            </div>
            <div className="rounded-xl border border-sidebar-line bg-sidebar-3/60 px-3 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">{t('workspace.active')}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-sidebar-ink">{activeCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* 프로젝트 리스트 */}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between px-2">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</span>}
          <Link href="/projects" className="text-[10px] font-medium text-sidebar-ink-muted transition hover:text-sidebar-ink">{collapsed ? '' : t('common.viewAll')}</Link>
        </div>
        <ul className="space-y-1 overflow-y-auto">
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
        <nav className="mt-5 border-t border-sidebar-line pt-4" aria-label="주요 메뉴">
          <div className="mb-2 flex items-center justify-between px-2">
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
                return (
                  <Link key={item.label} href={item.href} aria-current={active ? 'page' : undefined} title={item.label} className={`side-link ${active ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <ItemIcon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="flex-1">{item.label}</span>}
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
