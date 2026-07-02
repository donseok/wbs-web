'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Megaphone, Pin } from 'lucide-react'
import { getHeaderAnnouncements } from '@/app/actions/announcements'
import type { AnnouncementSummary } from '@/lib/domain/types'
import { ANNOUNCEMENT_META } from '@/lib/domain/announcements'
import { useLocale } from '@/components/providers/LocaleProvider'

const ROTATE_MS = 5000
const MD_QUERY = '(min-width: 768px)'          // 래퍼의 md:flex와 같은 경계
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function useMediaQuery(query: string): boolean {
  // 초기값 false — 서버 렌더(null)와 첫 클라이언트 렌더를 일치시켜 hydration mismatch 방지
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const sync = () => setMatches(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [query])
  return matches
}

/**
 * 헤더 빈 공간의 공지 티커 — 활성 프로젝트의 상위 공지(고정 우선 → 최신순)를 상시 노출.
 * 2건 이상이면 ROTATE_MS 간격으로 순환하되 호버·포커스 중이거나 reduced-motion이면
 * 멈춘다(WCAG 2.2.2). 클릭하면 공지사항 페이지로 이동. md 미만은 표시 공간이 없으므로
 * 조회 자체를 건너뛴다.
 */
export function HeaderAnnouncementTicker({ projectId }: { projectId: string | null }) {
  const { t } = useLocale()
  const wide = useMediaQuery(MD_QUERY)
  const reduceMotion = useMediaQuery(REDUCE_QUERY)
  const [items, setItems] = useState<AnnouncementSummary[]>([])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  // 활성 프로젝트가 바뀌면 상위 공지 로드 (헤더 알림과 같은 조회 패턴)
  useEffect(() => {
    setItems([])
    setIndex(0)
    if (!projectId || !wide) return
    let alive = true
    getHeaderAnnouncements(projectId)
      .then(r => { if (alive) setItems(r) })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId, wide])

  useEffect(() => {
    if (items.length < 2 || paused || reduceMotion) return
    const id = window.setInterval(() => setIndex(i => (i + 1) % items.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [items.length, paused, reduceMotion])

  if (!projectId || items.length === 0) return null
  const current = items[index % items.length]

  return (
    <Link
      href={`/p/${projectId}/announcements`}
      title={current.title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // 컨테이너(빈 공간)가 15rem보다 좁으면 통째로 숨겨 우측 컨트롤 침범을 차단
      className="hidden min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 transition hover:border-line-strong @[15rem]:flex"
    >
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-brand" />
      {/* key 교체로 항목 전환마다 진입 애니메이션 재생 */}
      <span key={current.id} className="flex min-w-0 items-center gap-2 motion-safe:animate-[tickerin_.35s_ease-out]">
        <span className={`chip shrink-0 ${ANNOUNCEMENT_META[current.category].chip}`}>
          {t(ANNOUNCEMENT_META[current.category].labelKey)}
        </span>
        {current.isPinned && <Pin className="h-3 w-3 shrink-0 text-accent-warning" />}
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{current.title}</span>
      </span>
    </Link>
  )
}
