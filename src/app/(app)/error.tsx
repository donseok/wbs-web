'use client'

import { Icon } from '@/components/ui/Icon'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-delayed-weak text-delayed"><Icon name="alert" /></span>
      <h1 className="mt-4 text-lg font-bold text-ink">화면을 불러오지 못했습니다</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">잠시 후 다시 시도해 주세요. 문제가 계속되면 프로젝트 관리자에게 문의하세요.</p>
      <button onClick={reset} className="btn btn-primary mt-5">다시 시도</button>
    </div>
  )
}
