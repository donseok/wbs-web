'use client'

import { type ReactNode } from 'react'
import { useCompactViewport } from '@/lib/hooks/useCompactViewport'

/**
 * 프로젝트 화면의 고정 히어로 + 독립 콘텐츠 스크롤 구조.
 * 히어로는 뷰포트에 남고, 아래 콘텐츠 영역만 세로로 스크롤된다.
 *
 * 컴팩트 뷰포트(세로 폰 + 가로 폰)에선 히어로 래퍼를 아예 렌더하지 않는다 —
 * CSS(md:) 폭 기준만으로는 가로 폰(폭 640px+)이 데스크톱으로 판정되고,
 * 숨긴 래퍼가 flex gap 을 이중으로 먹는 문제도 있다. 프로젝트명은 헤더가 보여준다.
 * SSR 은 데스크톱으로 그리므로 md 미만 첫 페인트는 PageHero 의 CSS(hidden md:grid)가 가린다.
 */
export function ProjectPageShell({ hero, children, flush = false }: {
  hero: ReactNode
  children: ReactNode
  /**
   * 콘텐츠가 h-full 로 영역을 꽉 채워 스크롤이 일어나지 않는 화면(WBS 간트)용.
   * 기본 pb-6 은 스크롤 페이지의 마지막 카드가 바닥에 붙지 않게 하는 여백인데,
   * 꽉 찬 화면에선 죽은 공간이 되어 표 높이만 깎는다.
   */
  flush?: boolean
}) {
  const compact = useCompactViewport()
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {!compact && <div className="shrink-0">{hero}</div>}
      <div
        className={`-mr-1 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 ${flush ? 'pb-0' : 'pb-6'}`}
        data-project-scroll-region
      >
        {children}
      </div>
    </div>
  )
}
