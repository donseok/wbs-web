'use client'
// 에이전트 허브 클라이언트 루트 — 상태 줄 → 위임 표 → 승인 큐. 폴링 없음(조작 화면).
// 좌석 층은 /agents/office 가 그린다(2026-09-14 오피스 분리). 위임 체크는 묶음 저장 응답에 실린 허브로 교체하고(재조회 없음),
// 그 밖의 변경 뒤 refreshAgentHub 1회, 탭이 다시 보이면 1회. 실패는 마지막 데이터 유지 + 상단 표시. 페이지 전체 refresh 금지(허브 스펙 §7).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentHub } from '@/lib/domain/agentHub'
import { refreshAgentHub } from '@/app/actions/agentHub'
import { HubStatusBar } from './HubStatusBar'
import { DelegationTable, type HubFilter } from './DelegationTable'
import { ApprovalQueue } from './ApprovalQueue'

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

export function AgentHubView({ initial }: { initial: AgentHub }) {
  const [hub, setHub] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  // 관리자는 프로젝트 전체를 관리하니 all, 멤버는 자기 담당부터.
  const [filter, setFilter] = useState<HubFilter>(initial.viewer.isAdmin ? 'all' : 'mine')
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const inflight = useRef(false)

  const applyHub = useCallback((h: AgentHub) => { setHub(h); setNowMs(Date.parse(h.fetchedAt)); setError(null) }, [])
  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshAgentHub(hub.projectId)
      if (r.ok) applyHub(r.hub)
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [hub.projectId, applyHub])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])
  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => { const t = window.setInterval(() => setNowMs(n => n + 1000), 1000); return () => window.clearInterval(t) }, [])

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
        nowMs={nowMs} onHub={applyHub} onChanged={refresh} />
      <ApprovalQueue queue={hub.queue} projectId={hub.projectId} isAdmin={hub.viewer.isAdmin} onHub={applyHub} onChanged={refresh} />
    </div>
  )
}
