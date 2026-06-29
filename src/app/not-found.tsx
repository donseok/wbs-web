import Link from 'next/link'
import { Compass, Home } from 'lucide-react'

export default function NotFound() {
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

        <h1 className="mt-4 text-lg font-bold tracking-tight text-ink">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>

        <Link href="/projects" className="btn btn-primary mt-7 w-full">
          <Home className="h-4 w-4" />
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  )
}
