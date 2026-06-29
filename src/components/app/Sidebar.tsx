'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Project = { id: string; name: string }

export function Sidebar({ projects }: { projects: Project[] }) {
  const pathname = usePathname()
  const onProjects = pathname === '/projects'

  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col gap-4 bg-sidebar p-4 lg:flex">
      {/* 워크스페이스 카드 */}
      <div className="rounded-2xl border border-sidebar-line bg-sidebar-2 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-base font-bold text-brand-fg shadow-sm">
            W
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sidebar-ink">WBS</div>
            <div className="truncate text-[11px] text-sidebar-ink-muted">Planning cockpit</div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-sidebar-ink-subtle">
          작업분해구조로 프로젝트 진척을 계획하고 추적합니다.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-sidebar-3 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-sidebar-ink-subtle">Projects</div>
            <div className="text-base font-semibold tabular-nums text-sidebar-ink">{projects.length}</div>
          </div>
          <div className="rounded-lg bg-sidebar-3 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wide text-sidebar-ink-subtle">Active</div>
            <div className="text-base font-semibold tabular-nums text-emerald-400">{projects.length}</div>
          </div>
        </div>
      </div>

      {/* 프로젝트 리스트 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-ink-subtle">
          Projects
        </div>
        <ul className="space-y-0.5">
          {projects.map(p => {
            const active = pathname.startsWith(`/p/${p.id}`)
            return (
              <li key={p.id}>
                <Link href={`/p/${p.id}/wbs`} className={`side-link ${active ? 'side-link-active' : ''}`}>
                  <span className="text-[13px] leading-none opacity-80">🗂</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                </Link>
              </li>
            )
          })}
          {projects.length === 0 && (
            <li className="px-3 py-2 text-[12px] text-sidebar-ink-subtle">프로젝트 없음</li>
          )}
        </ul>
      </div>

      {/* 하단 메뉴 */}
      <div className="space-y-0.5 border-t border-sidebar-line pt-3">
        <Link href="/projects" className={`side-link ${onProjects ? 'side-link-active' : ''}`}>
          <span className="text-[13px] leading-none opacity-80">⌂</span>
          홈
        </Link>
        <Link href="/projects" className="side-link">
          <span className="text-[13px] leading-none opacity-80">▦</span>
          프로젝트
        </Link>
      </div>
    </aside>
  )
}
