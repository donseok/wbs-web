'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { queueUiPref } from '@/lib/prefs/debouncedSave'

/** 접힘 상태 localStorage 키 — 사이드바(dflow-sidebar)와 동일 컨벤션, 전 페이지 공유. */
export const HERO_STORAGE_KEY = 'dflow-hero'

/** 헤더 등 외부에서 히어로 접기/펼치기를 일괄 제어할 때 dispatch하는 CustomEvent 이름. */
export const HERO_TOGGLE_EVENT = 'dflow-hero-toggle'

// PageHero는 페이지 트리에 있어 소프트 내비게이션마다 리마운트된다.
// 모듈 캐시로 세션 내 상태를 유지해 페이지 이동 시 상태가 바뀌는 플래시를 막는다.
let collapsedCache: boolean | null = null

/** 현재 히어로 접힘 상태를 읽는다(localStorage → 캐시 → 기본값 true). */
export function readHeroCollapsed(): boolean {
  if (collapsedCache !== null) return collapsedCache
  try { return localStorage.getItem(HERO_STORAGE_KEY) !== '0' } catch { return true }
}

/**
 * 헤더 등 외부에서 호출. localStorage를 갱신하고 CustomEvent를 dispatch하여
 * 마운트된 모든 PageHero 인스턴스의 상태를 동기화한다.
 */
export function dispatchHeroToggle(collapsed: boolean): void {
  collapsedCache = collapsed
  try { localStorage.setItem(HERO_STORAGE_KEY, collapsed ? '1' : '0') } catch {}
  window.dispatchEvent(new CustomEvent(HERO_TOGGLE_EVENT, { detail: { collapsed } }))
  queueUiPref({ heroCollapsed: collapsed })
}

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
  // 저장된 선택이 없는 최초 방문은 접힘이 기본값이다. 서버와 클라이언트 모두 같은 값으로 시작한다.
  const [collapsed, setCollapsed] = useState(() => collapsedCache ?? true)

  useEffect(() => {
    if (collapsedCache !== null) return
    try { collapsedCache = localStorage.getItem(HERO_STORAGE_KEY) !== '0' } catch { collapsedCache = true }
    setCollapsed(collapsedCache)
  }, [])

  // 헤더(외부) 토글 이벤트 수신 — 마운트된 모든 PageHero가 동기화된다.
  const onExternalToggle = useCallback((e: Event) => {
    const collapsed = (e as CustomEvent<{ collapsed: boolean }>).detail.collapsed
    collapsedCache = collapsed
    setCollapsed(collapsed)
  }, [])
  useEffect(() => {
    window.addEventListener(HERO_TOGGLE_EVENT, onExternalToggle)
    return () => window.removeEventListener(HERO_TOGGLE_EVENT, onExternalToggle)
  }, [onExternalToggle])

  const toggle = () => {
    const next = !collapsed
    dispatchHeroToggle(next)
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
