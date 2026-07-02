import Link from 'next/link'
import { Compass, Home } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'

export default async function NotFound() {
  const locale = await getServerLocale()
  return (
    <div className="app-backdrop flex min-h-screen items-center justify-center px-4 py-16">
      <div className="card relative w-full max-w-md overflow-hidden p-8 text-center sm:p-10">
        <span
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-[0.12] blur-xl"
          style={{ backgroundImage: 'var(--gradient-primary)' }}
          aria-hidden
        />

        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-weak text-brand">
          <Compass className="h-6 w-6" />
        </span>

        <div
          className="mt-6 bg-clip-text text-[64px] font-black leading-none tracking-tight text-transparent sm:text-[80px]"
          style={{ backgroundImage: 'var(--gradient-primary)' }}
        >
          404
        </div>

        <h1 className="mt-4 text-lg font-bold tracking-tight text-ink">{t(locale, 'home.nfTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          {t(locale, 'home.nfDesc')}
        </p>

        <Link href="/projects" className="btn btn-primary mt-7 w-full">
          <Home className="h-4 w-4" />
          {t(locale, 'home.nfHome')}
        </Link>
      </div>
    </div>
  )
}
