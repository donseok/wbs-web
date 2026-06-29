import Link from 'next/link'
import { getMembership } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const m = await getMembership()
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-5 px-6">
          <Link href="/projects" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">W</span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">WBS 관리</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/projects" className="rounded-md px-3 py-1.5 font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink">
              프로젝트
            </Link>
          </nav>
          {m && (
            <span className="ml-auto flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pl-1 pr-3 text-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-weak text-[11px] font-semibold text-brand">
                {m.teamCode.slice(0, 2)}
              </span>
              <span className="font-medium text-ink">{m.teamCode}</span>
              <span className="text-ink-subtle">·</span>
              <span className="text-ink-muted">{m.role}</span>
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-6 py-6">{children}</main>
    </div>
  )
}
