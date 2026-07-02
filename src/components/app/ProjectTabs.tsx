'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const TABS: { key: string; labelKey: DictKey; icon: IconName }[] = [
  { key: 'wbs', labelKey: 'nav.wbsGantt', icon: 'grid' },
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: 'chart' },
  { key: 'settings', labelKey: 'nav.settings', icon: 'settings' },
]

export function ProjectTabs({ base }: { base: string }) {
  const { t } = useLocale()
  const pathname = usePathname()
  return (
    <nav className="-mx-3 overflow-x-auto border-b border-line px-3 sm:mx-0 sm:px-0" aria-label={t('home.projectMenu')}>
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
              {t(tab.labelKey)}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
