'use client'
// 에이전트 스튜디오 · 위임·승인 두 화면을 오가는 탭(에이전트 명부는 스튜디오 안의 보기다, 2026-09-18). 스튜디오가 기본 화면이라 앞에 둔다(2026-09-19). 데스크톱에선 공통 헤더(AgentFrame) 띠 안에 dark 로,
// 컴팩트 뷰포트에선 헤더가 걷히므로 그 아래 고정 줄에 light 로 얹는다. 활성 판정은 경로 완전 일치.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type AgentTabKey = 'hub' | 'office'

export function agentTabs(projectId: string): ReadonlyArray<{ key: AgentTabKey; href: string; label: string }> {
  const base = `/p/${projectId}/agents`
  return [
    { key: 'office', href: `${base}/office`, label: '에이전트 스튜디오' },
    { key: 'hub', href: base, label: '위임·승인' },
  ]
}

export const TAB_TONE = {
  light: { on: 'bg-brand-weak text-brand', off: 'text-ink-muted hover:text-ink' },
  dark: {
    on: 'border border-[#32b6ab66] bg-[#32b6ab22] text-[#66d6c6]',
    off: 'border border-hero-line text-hero-ink-muted hover:text-hero-ink',
  },
} as const

export type TabTone = keyof typeof TAB_TONE

export function AgentTabs({ projectId, tone = 'light' }: { projectId: string; tone?: TabTone }) {
  const pathname = usePathname()
  const t = TAB_TONE[tone]
  return (
    <nav aria-label="에이전트 화면" className="flex items-center gap-1.5">
      {agentTabs(projectId).map(tab => {
        const active = pathname === tab.href
        return (
          <Link key={tab.key} href={tab.href} data-agent-tab={tab.key} aria-current={active ? 'page' : undefined}
            className={`chip ${active ? t.on : t.off}`}>{tab.label}</Link>
        )
      })}
    </nav>
  )
}
