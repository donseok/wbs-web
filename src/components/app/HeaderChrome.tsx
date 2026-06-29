'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  Bell, CalendarDays, ChevronRight, Globe, Hand, LogOut, Menu, Moon, Sun, Sparkles, User, X,
} from 'lucide-react'
import type { Membership } from '@/lib/domain/types'
import { createBrowserClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { SidebarProject } from './Sidebar'

const SECTION_LABEL: Record<string, string> = {
  dashboard: '대시보드', wbs: 'WBS · 간트', gantt: '간트 차트', kanban: '칸반 보드',
  members: '멤버', attendance: '근태현황', settings: '설정',
}

function BrandMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-[var(--shadow-sm)]" style={{ backgroundImage: 'var(--gradient-primary)' }} aria-hidden>
      <Sparkles className="h-5 w-5" />
    </span>
  )
}

export function HeaderChrome({ membership, projects }: { membership: Membership | null; projects: SidebarProject[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const { locale, setLocale, t } = useLocale()
  const [today, setToday] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [baseDateAuto, setBaseDateAuto] = useState(true)
  const [open, setOpen] = useState<null | 'notif' | 'profile'>(null)

  useEffect(() => {
    setToday(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()))
  }, [])
  useEffect(() => { setMenuOpen(false); setOpen(null) }, [pathname])

  const context = useMemo(() => {
    const match = pathname.match(/^\/p\/([^/]+)\/?([^/]+)?/)
    if (!match) return { project: null as SidebarProject | null, section: '워크스페이스' }
    return {
      project: projects.find(p => p.id === match[1]) ?? null,
      section: SECTION_LABEL[match[2] ?? ''] ?? '프로젝트',
    }
  }, [pathname, projects])

  const signOut = async () => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE !== '1') await createBrowserClient().auth.signOut()
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
          <Link href="/projects" className="hidden items-center gap-2.5 sm:flex" aria-label="DK Flow 홈">
            <BrandMark />
            <span className="leading-tight">
              <span className="block text-[15px] font-bold tracking-tight text-ink">DK Flow</span>
              <span className="block text-[10px] text-ink-subtle">{t('brand.tagline')}</span>
            </span>
          </Link>

          {/* 브레드크럼 */}
          {context.project && (
            <nav className="ml-1 hidden min-w-0 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 md:flex" aria-label="현재 위치">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="truncate text-[13px] font-semibold text-ink">{context.project.name}</span>
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {today && (
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 text-[12px] font-medium text-ink-muted md:inline-flex">
                <CalendarDays className="h-3.5 w-3.5 text-brand" />{today}
              </span>
            )}
            <button onClick={() => setBaseDateAuto(v => !v)} className="chrome-btn hidden lg:inline-flex" title={baseDateAuto ? '기준일: 자동(오늘)' : '기준일: 수동 고정'}>
              <Hand className="h-3.5 w-3.5" />{baseDateAuto ? t('chrome.auto') : t('chrome.manual')}
            </button>
            <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')} className="chrome-btn" title="Language">
              <Globe className="h-3.5 w-3.5" />{locale.toUpperCase()}
            </button>
            <button onClick={toggle} className="chrome-icon" aria-label={theme === 'dark' ? t('chrome.lightMode') : t('chrome.darkMode')}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* 알림 */}
            <div className="relative">
              <button onClick={() => setOpen(open === 'notif' ? null : 'notif')} className="chrome-icon relative" aria-label={t('chrome.notifications')}>
                <Bell className="h-4 w-4" />
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-secondary ring-2 ring-surface" />
              </button>
              {open === 'notif' && (
                <Popover onClose={() => setOpen(null)}>
                  <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{t('chrome.notifications')}</div>
                  <div className="px-4 py-6 text-center text-xs text-ink-subtle">표시할 새 알림이 없습니다.</div>
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
  const activeId = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null
  const links = activeId
    ? [
        { href: `/p/${activeId}/dashboard`, label: '대시보드' },
        { href: `/p/${activeId}/wbs`, label: 'WBS · 간트' },
        { href: `/p/${activeId}/kanban`, label: '칸반 보드' },
        { href: `/p/${activeId}/members`, label: '멤버' },
        { href: `/p/${activeId}/attendance`, label: '근태현황' },
        { href: `/p/${activeId}/settings`, label: '설정' },
      ]
    : []
  return (
    <div className="fixed inset-0 z-[100] lg:hidden" role="dialog" aria-modal="true" aria-label="모바일 메뉴">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="메뉴 닫기" />
      <div className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-sidebar p-4 text-sidebar-ink shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">DK Flow</span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg border border-sidebar-line text-sidebar-ink-muted"><X className="h-4 w-4" /></button>
        </div>
        <nav className="mt-6 space-y-1">
          <Link href="/projects" onClick={onClose} className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''}`}>전체 프로젝트</Link>
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">프로젝트</div>
          {projects.map(p => (
            <Link key={p.id} onClick={onClose} href={`/p/${p.id}/dashboard`} className={`side-link ${pathname.startsWith(`/p/${p.id}`) ? 'side-link-active' : ''}`}>
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
          {links.length > 0 && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-ink-subtle">메뉴</div>}
          {links.map(l => (
            <Link key={l.label} onClick={onClose} href={l.href} className={`side-link ${pathname === l.href ? 'side-link-active' : ''}`}>{l.label}</Link>
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
