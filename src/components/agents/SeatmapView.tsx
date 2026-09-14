'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Seat, Seatmap, SeatmapScope } from '@/lib/domain/seatmap'
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { Counters } from './Counters'
import { AttentionBand } from './AttentionBand'
import { FloorCard } from './FloorCard'
import { DetailPanel } from './DetailPanel'
import css from './seatmap.module.css'

function findSeat(map: Seatmap, orderId: string | null): { seat: Seat; floorName: string; zoneLabel: string } | null {
  if (!orderId) return null
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.orderId === orderId) return { seat: s, floorName: f.name, zoneLabel: `${z.code} ${z.name}` }
  }
  return null
}

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

/** 좌석표 클라이언트 루트. 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회. 실패는 마지막 데이터 유지 + 표시. */
export function SeatmapView({ initial, pollMs = 30_000 }: { initial: Seatmap; pollMs?: number }) {
  const [map, setMap] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(initial.attention[0]?.orderId ?? null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const [scope, setScope] = useState<SeatmapScope>(initial.scope)
  const scopeRef = useRef(scope)
  const inflight = useRef(false)

  const refresh = useCallback(async (want?: SeatmapScope) => {
    if (want) { scopeRef.current = want; setScope(want) }
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshSeatmap(scopeRef.current)
      if (r.ok) { setMap(r.seatmap); setNowMs(Date.parse(r.seatmap.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [])

  useEffect(() => {
    let timer: number | null = null
    const start = () => { if (timer === null) timer = window.setInterval(() => { void refresh() }, pollMs) }
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null } }
    const onVis = () => { if (document.visibilityState === 'hidden') stop(); else { void refresh(); start() } }
    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState !== 'hidden') start()
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh, pollMs])

  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(n => n + 1000), 1000)
    return () => window.clearInterval(t)
  }, [])

  const sel = useMemo(() => findSeat(map, selected), [map, selected])

  return (
    <div className={css.root}>
      <header className={css.top}>
        <Counters counters={map.counters} />
        <div className={css.topRight}>
          <div className={css.scope} role="group" aria-label="표시 범위">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => { void refresh('mine') }}>내 작업</button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => { void refresh('all') }}>전체</button>
          </div>
          <div className={`${css.stamp} ${error ? css.stampBad : ''}`}>
            {error ? <span data-error="">갱신 실패 {hhmmss(error.at)} · {error.message}</span> : <span>갱신 {hhmmss(map.fetchedAt)}</span>}
          </div>
        </div>
      </header>
      <AttentionBand items={map.attention} onSelect={setSelected} />
      <main className={css.grid}>
        <section className={css.floors} aria-label="프로젝트별 좌석">
          {map.floors.length === 0 && (map.scope === 'mine'
            ? <p className={css.doneNote}>배정된 에이전트 작업이 없습니다. 담당자가 나이거나 내 에이전트가 잡은 주문만 보입니다 — 다른 사람 것까지 보려면 ‘전체’를 누르세요.</p>
            : <p className={css.doneNote}>표시할 주문이 없습니다. 에이전트 위임(agent 태그) 항목의 주문만 보이며, 관리자인 프로젝트에 그런 주문이 생기면 여기 층이 생깁니다.</p>)}
          {map.floors.map(f => <FloorCard key={f.id} floor={f} selectedId={selected} nowMs={nowMs} onSelect={setSelected} />)}
        </section>
        <DetailPanel seat={sel?.seat ?? null} floorName={sel?.floorName ?? ''} zoneLabel={sel?.zoneLabel ?? ''} nowMs={nowMs} />
      </main>
      <footer className={css.legend}>
        <ul>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />업무 중(신호 5분 이내)</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)', borderColor: 'var(--sm-warn)' }} />무응답 5분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-empty)', borderColor: 'var(--sm-warn)' }} />끊김 30분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />? 결정 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-wait)' }} />승인 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-reject)' }} />반려 · 재작업</li>
          <li><i className={css.sw} style={{ borderStyle: 'dashed' }} />빈자리</li>
        </ul>
        <p>프로젝트가 층, 주문 항목의 부모 항목이 구역, 작업 주문 하나가 책상입니다. 의자의 인물은 그 주문을 잡은 에이전트(슬롯)이며 같은 에이전트는 늘 같은 인물입니다. 신호는 PostToolUse 훅의 heartbeat(60초 절제)와 progress 보고입니다.</p>
      </footer>
    </div>
  )
}
