'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from '@/components/ui/Icon'

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: 'wbs', label: 'WBS · 간트', icon: 'grid' },
  { key: 'dashboard', label: '대시보드', icon: 'chart' },
  { key: 'settings', label: '설정', icon: 'settings' },
]

export function ProjectTabs({ base }: { base: string }) {
  const pathname = usePathname()
  return (
    <nav className="-mx-3 overflow-x-auto border-b border-line px-3 sm:mx-0 sm:px-0" aria-label="프로젝트 메뉴">
      <div className="flex min-w-max items-center gap-1">
        {TABS.map(tab => {
          const href = `${base}/${tab.key}`
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={tab.key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`relative inline-flex h-12 items-center gap-2 px-3 text-[13px] font-semibold transition ${active ? 'text-brand' : 'text-ink-muted hover:text-ink'}`}
            >
              <Icon name={tab.icon} className="h-4 w-4" />
              {tab.label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
