'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { trackWikiEvent } from './wikiAnalytics'

export function safeWikiTrackingPath(pathname: string | null | undefined): string {
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//') || /[\\\u0000-\u001F\u007F]/.test(pathname)) {
    return '/wiki'
  }
  return pathname
}

export function WikiTrackedLink({
  href,
  domain,
  className,
  title,
  ariaLabel,
  children,
}: {
  href: string
  domain: string
  className?: string
  title?: string
  ariaLabel?: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const trackingPath = safeWikiTrackingPath(pathname)

  return (
    <Link
      href={href}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onClick={() => trackWikiEvent('wiki_source_opened', trackingPath, { domain })}
    >
      {children}
    </Link>
  )
}
