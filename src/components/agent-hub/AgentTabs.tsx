'use client'
// 허브(위임·승인)와 가상 오피스를 오가는 탭 — 두 페이지의 ProjectPageShell pinned 슬롯에 얹는다(컴팩트 뷰포트에서도 남는다).
// 사이드바 항목은 '에이전트' 하나(2026-09-14 오피스 분리 스펙 §6-1). 활성 판정은 경로 완전 일치.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AgentTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/p/${projectId}/agents`
  const tabs = [
    { key: 'hub', href: base, label: '위임·승인' },
    { key: 'office', href: `${base}/office`, label: '가상 오피스' },
  ] as const
  return (
    <nav aria-label="에이전트 화면" className="flex items-center gap-2">
      {tabs.map(t => {
        const active = pathname === t.href
        return (
          <Link key={t.key} href={t.href} data-agent-tab={t.key} aria-current={active ? 'page' : undefined}
            className={`chip ${active ? 'bg-brand-weak text-brand' : 'text-ink-muted hover:text-ink'}`}>{t.label}</Link>
        )
      })}
    </nav>
  )
}
