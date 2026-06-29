'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import type { Membership } from '@/lib/domain/types'

export function HeaderChrome({ membership }: { membership: Membership | null }) {
  const router = useRouter()
  // 날짜는 마운트 후에만 세팅 → SSR/CSR hydration mismatch 방지(초기엔 빈 문자열)
  const [today, setToday] = useState('')
  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }).format(new Date()),
    )
  }, [])

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-5">
        {/* 브랜드 + 브레드크럼 */}
        <Link href="/projects" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg lg:hidden">
            W
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">WBS 관리</span>
        </Link>
        <span className="hidden text-ink-subtle sm:inline">/</span>
        <span className="hidden text-sm text-ink-muted sm:inline">프로젝트 진척 관리</span>

        <div className="ml-auto flex items-center gap-2">
          {/* 날짜 pill */}
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-muted md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            {today}
          </span>
          {/* 언어 */}
          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink-muted">
            KO
          </span>
          {/* 알림 벨 */}
          <button
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-muted transition hover:text-ink"
            aria-label="알림"
          >
            <span className="text-sm">🔔</span>
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-delayed" />
          </button>
          {/* 사용자/팀 뱃지 */}
          {membership && (
            <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pl-1 pr-3 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-weak text-[11px] font-bold text-brand">
                {membership.teamCode.slice(0, 2)}
              </span>
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="text-[12px] font-semibold text-ink">{membership.teamCode}</span>
                <span className="text-[10px] text-ink-subtle">{membership.role}</span>
              </span>
            </span>
          )}
          {/* 로그아웃 */}
          <button
            onClick={() => router.push('/login')}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  )
}
