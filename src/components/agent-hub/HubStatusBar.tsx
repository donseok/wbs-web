'use client'
// 허브 조작 줄 — 켜짐/중지(관리자 토글), 설계 검토 대기 수, 감시 중 에이전트, 내 토큰 링크. 공통 헤더(AgentFrame) 아래 고정 줄에 얹는다.
// 카운터는 헤더 타일로 올라갔다(2026-09-18). 전체 스튜디오 링크는 스튜디오 탭에 있다(2026-09-14).
import Link from 'next/link'
import { Bot, PauseCircle } from 'lucide-react'
import type { Watcher } from '@/lib/domain/seatmap'
import { watcherUntilSuffix } from '@/lib/domain/agentRoster'
import { AgentProjectToggle } from '@/components/settings/AgentProjectToggle'

type Props = {
  projectId: string
  registered: boolean
  enabled: boolean
  watchers: Watcher[]
  isAdmin: boolean
  /** 설계 검토 대기 주문 수(hub.counters.designReview) — 결재 대기(완료 승인)와 따로 센다(설계 상태 스펙 7절). 없으면 0. */
  designReview?: number
  onChanged: () => Promise<void> | void
}

/** FloorCard 의 감시자 표기와 같은 조합 — `agent busy/slots ~until`(until 이 「답 대기」면 `~` 없이). */
export function watchLabel(w: Watcher[]): string {
  if (w.length === 0) return '감시 없음'
  return w.map(x => `${x.agent}${x.slots != null ? ` ${x.busy ?? 0}/${x.slots}` : ''}${watcherUntilSuffix(x.untilLabel)}`).join(' · ')
}

export function HubStatusBar({ projectId, registered, enabled, watchers, isAdmin, designReview = 0, onChanged }: Props) {
  const badge = !registered
    ? { cls: 'bg-surface-2 text-ink-subtle', label: '아직 등록 안 됨 — 첫 위임 때 켜집니다', icon: PauseCircle }
    : enabled
      ? { cls: 'bg-brand-weak text-brand', label: '에이전트 켜짐', icon: Bot }
      : { cls: 'bg-pending-weak text-accent-warning', label: '에이전트 중지', icon: PauseCircle }
  const Icon = badge.icon
  return (
    <section aria-label="에이전트 상태" className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin
          ? <AgentProjectToggle projectId={projectId} registered={registered} enabled={enabled} onChanged={() => { void onChanged() }} />
          : <span className={`chip ${badge.cls}`}><Icon className="mr-1 h-3.5 w-3.5" aria-hidden />{badge.label}</span>}
        {isAdmin && !registered && <span className="text-[11px] text-ink-subtle">첫 위임 때 켜집니다</span>}
        {/* 설계 검토 대기 — 사람이 「설계 승인」을 눌러야 풀린다. 0건이어도 그린다(자리 고정). 사이드바 배지(src/components/app)는
            UI 위험 파일이라 건드리지 않고 이 줄에 둔다. 컴팩트 화면에서도 보이는 고정 줄이다. */}
        <span data-hub-design-review={designReview}
          title="에이전트가 설계를 마치고 사람의 「설계 승인」을 기다리는 작업 수입니다. 결재 대기(완료 승인)와 따로 셉니다."
          className={`chip ${designReview > 0 ? 'bg-delayed-weak text-delayed' : 'bg-surface-2 text-ink-subtle'}`}>
          설계 검토 대기 <b className="ml-1 tabular-nums">{designReview}</b>
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-ink-muted">
        <span title={watchLabel(watchers)}>{watchers.length ? `감시 중 · ${watchLabel(watchers)}` : '감시 없음'}</span>
        <Link href="/account" className="text-brand underline-offset-2 hover:underline">내 토큰</Link>
      </div>
    </section>
  )
}
