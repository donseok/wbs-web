'use client'
// 에이전트 허브 클라이언트 루트 — 상태 줄 → 위임 표 → 승인 큐 → 이 프로젝트 층. 폴링 없음(조작 화면).
// 변경 뒤 refreshAgentHub 1회, 탭이 다시 보이면 1회. 실패는 마지막 데이터 유지 + 상단 표시. 페이지 전체 refresh 금지(스펙 §7).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentHub } from '@/lib/domain/agentHub'
import { refreshAgentHub } from '@/app/actions/agentHub'
import { FloorCard } from '@/components/agents/FloorCard'
import { DetailPanel } from '@/components/agents/DetailPanel'
import seatCss from '@/components/agents/seatmap.module.css'
import { HubStatusBar } from './HubStatusBar'
import { DelegationTable, type HubFilter } from './DelegationTable'
import { ApprovalQueue } from './ApprovalQueue'

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

export function AgentHubView({ initial }: { initial: AgentHub }) {
  const [hub, setHub] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  // 관리자는 프로젝트 전체를 관리하니 all, 멤버는 자기 담당부터.
  const [filter, setFilter] = useState<HubFilter>(initial.viewer.isAdmin ? 'all' : 'mine')
  const [selected, setSelected] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshAgentHub(hub.projectId)
      if (r.ok) { setHub(r.hub); setNowMs(Date.parse(r.hub.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [hub.projectId])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])
  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => { const t = window.setInterval(() => setNowMs(n => n + 1000), 1000); return () => window.clearInterval(t) }, [])

  const sel = useMemo(() => {
    if (!hub.floor || !selected) return null
    for (const z of hub.floor.zones) for (const s of z.seats) if (s.orderId === selected) return { seat: s, zoneLabel: `${z.code} ${z.name}` }
    return null
  }, [hub.floor, selected])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span data-hub-stamp className={error ? 'text-accent-warning' : ''}>
          {error ? `갱신 실패 ${hhmmss(error.at)} · ${error.message}` : `갱신 ${hhmmss(hub.fetchedAt)}`}
        </span>
        <button type="button" data-hub-refresh className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { void refresh() }}>새로고침</button>
      </div>
      <HubStatusBar projectId={hub.projectId} registered={hub.registered} enabled={hub.enabled} counters={hub.counters}
        watchers={hub.watchers} isAdmin={hub.viewer.isAdmin} onChanged={refresh} />
      <DelegationTable rows={hub.rows} projectId={hub.projectId} isAdmin={hub.viewer.isAdmin} filter={filter} onFilter={setFilter}
        nowMs={nowMs} onChanged={refresh} />
      <ApprovalQueue queue={hub.queue} isAdmin={hub.viewer.isAdmin} onChanged={refresh} />
      <section aria-label="좌석" className={seatCss.root}>
        {hub.floor
          ? (
            <div className={seatCss.grid}>
              <div className={seatCss.floors}><FloorCard floor={hub.floor} selectedId={selected} nowMs={nowMs} onSelect={setSelected} /></div>
              <DetailPanel seat={sel?.seat ?? null} floorName={hub.floor.name} zoneLabel={sel?.zoneLabel ?? ''} nowMs={nowMs} />
            </div>
          )
          : <p className="text-xs text-ink-muted">위임된 주문이 아직 없습니다. 위 표에서 리프 항목에 위임을 켜면 여기 좌석이 생깁니다.</p>}
      </section>
    </div>
  )
}
