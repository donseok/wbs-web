'use client'
// 허브 상단 상태 줄 — 켜짐/중지(관리자 토글), 카운터 4개, 감시 중 에이전트, 내 토큰 링크.
import Link from 'next/link'
import { Bot, PauseCircle } from 'lucide-react'
import type { AgentHub } from '@/lib/domain/agentHub'
import type { Watcher } from '@/lib/domain/seatmap'
import { AgentProjectToggle } from '@/components/settings/AgentProjectToggle'

type Props = {
  projectId: string
  registered: boolean
  enabled: boolean
  counters: AgentHub['counters']
  watchers: Watcher[]
  isAdmin: boolean
  onChanged: () => Promise<void> | void
}

/** FloorCard 의 감시자 표기와 같은 조합 — `agent busy/slots ~until`. */
export function watchLabel(w: Watcher[]): string {
  if (w.length === 0) return '감시 없음'
  return w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${x.untilLabel ? ` ~${x.untilLabel}` : ''}`).join(' · ')
}

const COUNTERS: Array<{ key: keyof AgentHub['counters']; label: string }> = [
  { key: 'delegated', label: '위임' }, { key: 'ready', label: '대기' }, { key: 'working', label: '작업 중' }, { key: 'waiting', label: '승인 대기' },
]

export function HubStatusBar({ projectId, registered, enabled, counters, watchers, isAdmin, onChanged }: Props) {
  const badge = !registered
    ? { cls: 'bg-surface-2 text-ink-subtle', label: '아직 등록 안 됨 — 첫 위임 때 켜집니다', icon: PauseCircle }
    : enabled
      ? { cls: 'bg-brand-weak text-brand', label: '에이전트 켜짐', icon: Bot }
      : { cls: 'bg-pending-weak text-accent-warning', label: '에이전트 중지', icon: PauseCircle }
  const Icon = badge.icon
  return (
    <section aria-label="에이전트 상태" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin
          ? <AgentProjectToggle projectId={projectId} registered={registered} enabled={enabled} onChanged={() => { void onChanged() }} />
          : <span className={`chip ${badge.cls}`}><Icon className="mr-1 h-3.5 w-3.5" aria-hidden />{badge.label}</span>}
        {isAdmin && !registered && <span className="text-[11px] text-ink-subtle">첫 위임 때 켜집니다</span>}
      </div>
      <dl className="flex items-center gap-4 text-xs">
        {COUNTERS.map(c => (
          <div key={c.key} className="flex items-baseline gap-1">
            <dt className="text-ink-subtle">{c.label}</dt>
            <dd data-hub-counter={c.key} className="font-semibold tabular-nums text-ink">{counters[c.key]}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-3 text-[11px] text-ink-muted">
        <span title={watchLabel(watchers)}>{watchers.length ? `감시 중 · ${watchLabel(watchers)}` : '감시 없음'}</span>
        <Link href="/account" className="text-brand underline-offset-2 hover:underline">내 토큰</Link>
      </div>
    </section>
  )
}
