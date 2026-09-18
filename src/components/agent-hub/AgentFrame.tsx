'use client'
// 에이전트 두 화면(위임·승인 · 가상 오피스)의 공통 틀 — 같은 다크 헤더 띠에 탭·제목·한 문장 요약·
// 상태 누적 막대·타일을 얹고, 화면마다 다른 조작부(tools)는 띠 아래 고정 줄로 뺀다(2026-09-18 사용자 결정).
//
// 헤더는 ProjectPageShell 의 hero(장식) 슬롯이라 컴팩트 뷰포트에선 걷힌다. 탭과 조작부는 화면의 유일한
// 조작 수단이므로 pinned 슬롯에 둔다 — 컴팩트에선 탭이 헤더와 함께 사라지지 않도록 pinned 줄로 내려온다.
// 분기는 useCompactViewport 로만 한다(반응형 display 유틸 금지 — globals.css 안전망).
import type { ReactNode } from 'react'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { useCompactViewport } from '@/lib/hooks/useCompactViewport'
import { AgentTabs, type TabTone } from './AgentTabs'

/** 헤더 띠 위(dark)·컴팩트 고정 줄(light)에 얹는 내비게이션. 기본은 프로젝트의 위임·승인|가상 오피스 탭이다. */
export type HeroNav = (tone: TabTone) => ReactNode

/** 헤더 타일 하나. bar=false 면 누적 막대에서 뺀다(합계가 다른 축의 숫자). */
export interface HeroTile { key: string; label: string; value: number; color: string; valueColor?: string; bar?: boolean }

export function AgentHero({ nav, projectName, title, lede, tiles, aside }: {
  nav: ReactNode; projectName: string; title: string; lede: ReactNode; tiles: HeroTile[]; aside?: ReactNode
}) {
  const barTiles = tiles.filter(t => t.bar !== false && t.value > 0)
  const total = barTiles.reduce((n, t) => n + t.value, 0)
  return (
    <header data-agent-hero className="hero-card hero-glow grid items-center gap-7 px-7 py-5 [grid-template-columns:minmax(0,1fr)_minmax(0,560px)]">
      <div className="relative z-[1] min-w-0">
        {nav}
        <p className="mt-3.5 text-[11px] font-semibold tracking-[0.12em] text-hero-ink-muted">{projectName}</p>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-hero-ink">{title}</h1>
        <div data-agent-lede className="mt-1.5 text-[15px] text-hero-ink-muted [&_b]:text-hero-ink [&_em]:not-italic [&_em]:text-[#f2aa4c]">{lede}</div>
      </div>
      <div className="relative z-[1] flex min-w-0 flex-col gap-3">
        {aside}
        <div className="flex h-3.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
          {total > 0 && barTiles.map(t => <i key={t.key} className="block h-full" style={{ width: `${(t.value / total) * 100}%`, background: t.color }} />)}
        </div>
        <ul aria-label="현황" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <li key={t.key} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
              <b data-hero-tile={t.key} className="block text-2xl font-extrabold leading-none tabular-nums" style={{ color: t.valueColor ?? t.color }}>{t.value}</b>
              <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-hero-ink-muted">
                <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: t.color }} />{t.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}

export function AgentFrame({ projectId, nav, projectName, title, lede, tiles, tools, children }: {
  /** 프로젝트 화면이면 그 프로젝트의 탭을 단다. 전체 오피스처럼 프로젝트가 없는 화면은 nav 를 직접 준다. */
  projectId?: string; nav?: HeroNav
  /** 제목 위 eyebrow — 프로젝트 화면은 프로젝트명. */
  projectName: string; title: string; lede: ReactNode; tiles: HeroTile[]
  /** 이 화면에만 있는 조작부 — 헤더 아래 고정 줄. */
  tools?: ReactNode
  children: ReactNode
}) {
  const compact = useCompactViewport()
  const navFor: HeroNav = nav ?? (tone => projectId === undefined ? null : <AgentTabs projectId={projectId} tone={tone} />)
  const pinned = compact || tools
    ? (
      <div data-agent-tools className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {compact && navFor('light')}
        {tools}
      </div>
    )
    : undefined
  return (
    <ProjectPageShell
      hero={<AgentHero nav={navFor('dark')} projectName={projectName} title={title} lede={lede} tiles={tiles} />}
      pinned={pinned}>
      {children}
    </ProjectPageShell>
  )
}
