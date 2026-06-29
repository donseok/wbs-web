'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { key: 'wbs', label: 'WBS' },
  { key: 'dashboard', label: '대시보드' },
  { key: 'settings', label: '설정' },
] as const

export function ProjectTabs({ base }: { base: string }) {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-1 border-b border-line">
      {TABS.map(t => {
        const href = `${base}/${t.key}`
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={t.key}
            href={href}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
