import type { ReactNode } from 'react'

/**
 * 프로젝트 화면의 고정 히어로 + 독립 콘텐츠 스크롤 구조.
 * 히어로는 뷰포트에 남고, 아래 콘텐츠 영역만 세로로 스크롤된다.
 */
export function ProjectPageShell({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="shrink-0">{hero}</div>
      <div
        className="-mr-1 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-6 pr-1"
        data-project-scroll-region
      >
        {children}
      </div>
    </div>
  )
}
