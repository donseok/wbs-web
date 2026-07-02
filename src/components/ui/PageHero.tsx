'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 접힘 상태 localStorage 키 — 사이드바(dflow-sidebar)와 동일 컨벤션, 전 페이지 공유. */
const STORAGE_KEY = 'dflow-hero'

// PageHero는 페이지 트리에 있어 소프트 내비게이션마다 리마운트된다.
// 모듈 캐시로 세션 내 상태를 유지해, 페이지 이동 시 접힌 히어로가 펼쳐졌다 다시 접히는 플래시를 막는다.
// (하드 로드 1회의 펼침→접힘 전환만 남음 — 사이드바와 동일한 트레이드오프)
let collapsedCache: boolean | null = null

/**
 * D'Flow 스타일 페이지 히어로 — 다크 그라데이션 카드 + 우측 KPI 레일.
 * 각 페이지가 자신의 히어로를 렌더한다.
 * 우상단 토글로 접을 수 있고, 접으면 제목 한 줄만 남는다(상태는 localStorage에 기억).
 */
export function PageHero({
  eyebrow, title, description, badge, actions, aside, heroKpis,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  aside?: ReactNode
  /** 다크 히어로 패널 '안'에 KPI 카드 행을 렌더(검정 배경 내장). variant='hero' KpiCard와 함께 사용. */
  heroKpis?: ReactNode
}) {
  const { t } = useLocale()
  // 하드 로드 시 캐시가 비어 있어 SSR과 동일한 펼침으로 시작(hydration mismatch 없음).
  const [collapsed, setCollapsed] = useState(() => collapsedCache ?? false)

  useEffect(() => {
    if (collapsedCache !== null) return
    try { collapsedCache = localStorage.getItem(STORAGE_KEY) === '1' } catch { collapsedCache = false }
    setCollapsed(collapsedCache)
  }, [])
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      collapsedCache = next
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  return (
    <section className={`grid gap-4 ${aside && !collapsed ? 'lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]' : ''}`}>
      <div className={`hero-glow hero-card flex flex-col px-6 transition-[padding] duration-200 sm:px-8 ${collapsed ? 'py-4' : 'py-6 sm:py-8'}`}>
        <div className={`flex ${collapsed ? 'items-center' : 'items-start'} justify-between gap-4`}>
          <div className="min-w-0">
            {!collapsed && badge && <div className="mb-4">{badge}</div>}
            {!collapsed && eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-hero-ink-muted">{eyebrow}</div>}
            <h1
              className={`font-bold leading-tight tracking-tight text-hero-ink transition-[font-size,margin] duration-200 ${collapsed
                ? 'mt-0 truncate text-lg'
                : 'mt-2 break-words text-[26px] sm:text-[34px]'}`}
            >
              {title}
            </h1>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="page-hero-body"
            aria-label={collapsed ? t('ui.heroExpand') : t('ui.heroCollapse')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-hero-ink-muted backdrop-blur transition hover:bg-white/20 hover:text-hero-ink"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
        <div
          id="page-hero-body"
          className={`grid transition-[grid-template-rows] duration-200 ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
        >
          {/* -mx-1 px-1: 전역 :focus-visible 아웃라인(2px+offset 2px)이 좌우 클립 경계에 잘리지 않게 여유 확보 */}
          <div className={`-mx-1 min-h-0 overflow-hidden px-1 transition-[visibility] duration-200 ${collapsed ? 'invisible' : 'visible'}`}>
            {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-hero-ink-muted">{description}</p>}
            {actions && <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
            {heroKpis && <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{heroKpis}</div>}
          </div>
        </div>
      </div>
      {aside && !collapsed && <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">{aside}</div>}
    </section>
  )
}

/** 히어로 상단의 작은 카테고리 pill (예: "Smart Utility") */
export function HeroBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-hero-ink">
      {children}
    </span>
  )
}
