import Link from 'next/link'
import { getMembership } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const m = await getMembership()
  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <Link href="/projects" className="font-bold">WBS</Link>
        <nav className="flex gap-3 text-sm text-gray-600">
          <Link href="/projects">프로젝트</Link>
        </nav>
        <span className="ml-auto text-sm">{m ? `${m.teamCode} · ${m.role}` : ''}</span>
      </header>
      <main className="p-4">{children}</main>
    </div>
  )
}
