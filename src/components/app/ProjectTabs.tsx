'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { key: 'wbs', label: 'WBS · 간트', icon: '▦' },
  { key: 'dashboard', label: '대시보드', icon: '◧' },
  { key: 'settings', label: '설정', icon: '⚙' },
] as const

export function ProjectTabs({ base }: { base: string }) {
  const pathname = usePathname()
  return (
    <nav className="seg">
      {TABS.map(t => {
        const href = `${base}/${t.key}`
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={t.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`seg-item ${active ? 'seg-item-active' : ''}`}
          >
            <span className="text-[13px] leading-none opacity-80">{t.icon}</span>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
