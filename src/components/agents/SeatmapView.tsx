'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Seat, Seatmap, SeatmapScope } from '@/lib/domain/seatmap'
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { runHubProcessOp, type HubProcessOp } from '@/app/actions/agentHub'
import { Counters } from './Counters'
import { AttentionBand } from './AttentionBand'
import { FloorCard } from './FloorCard'
import { LaneBoard } from './LaneBoard'
import { Modal } from '@/components/ui/Modal'
import { DetailPanel, seatEyebrow, type NoteDraft } from './DetailPanel'
import { opSpec, type SeatOpKind } from './seatOps'
import { IconFloorView, IconLaneView } from './icons'
import css from './seatmap.module.css'

function findSeat(map: Seatmap, orderId: string | null): { seat: Seat; floorName: string; zoneLabel: string } | null {
  if (!orderId) return null
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.orderId === orderId) return { seat: s, floorName: f.name, zoneLabel: `${z.code} ${z.name}` }
  }
  return null
}

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

type OfficeView = 'floor' | 'lane'
const VIEW_KEY = 'dflow.office.view'

/** 좌석표 클라이언트 루트. 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회. 실패는 마지막 데이터 유지 + 표시.
 *  projectId 가 있으면 프로젝트 오피스(/p/[id]/agents/office): 재조회를 그 층으로 좁히고 전체 오피스 링크를 보인다.
 *  보기는 둘이다 — 평면도(지켜보는 화면, 기본)와 상태 레인(처리하는 화면). 결재는 두 보기에서 모두 좌석에 붙는다. */
export function SeatmapView({ initial, pollMs = 30_000, projectId }: { initial: Seatmap; pollMs?: number; projectId?: string }) {
  const [map, setMap] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const [scope, setScope] = useState<SeatmapScope>(initial.scope)
  // 기본은 평면도다. 서버 렌더와 어긋나지 않도록 localStorage 는 마운트 뒤에 읽는다.
  const [view, setView] = useState<OfficeView>('floor')
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteDraft | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const scopeRef = useRef(scope)
  const inflight = useRef(false)
  // 사유를 쓰는 동안 폴링이 그 좌석을 목록에서 지우면 쓰던 글이 조용히 사라진다 — 초안이 열려 있으면 자동 갱신을 쉰다.
  const noteRef = useRef<NoteDraft | null>(null)
  useEffect(() => { noteRef.current = note }, [note])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === 'lane' || saved === 'floor') setView(saved)
    } catch { /* 값이 없거나 접근이 막혀도 평면도로 그린다 */ }
  }, [])
  const pickView = useCallback((next: OfficeView) => {
    setView(next)
    try { window.localStorage.setItem(VIEW_KEY, next) } catch { /* 기억하지 못해도 화면은 돈다 */ }
  }, [])

  /** force = 사람이 부른 갱신(범위 전환·결재 직후). 자동 폴링만 양보한다 — 결재 뒤 갱신이 폴링과
   *  겹쳤다고 건너뛰면 처리는 됐는데 화면이 최대 30초 옛 상태로 남아 사용자가 다시 누르게 된다. */
  const refresh = useCallback(async (want?: SeatmapScope, force = false) => {
    if (want) { scopeRef.current = want; setScope(want) }
    if (!force && noteRef.current !== null) return
    if (inflight.current) {
      if (!force) return
      // 사람이 부른 갱신은 앞선 폴링이 끝나기를 기다렸다가 다시 읽는다.
      for (let i = 0; i < 40 && inflight.current; i++) await new Promise(r => setTimeout(r, 100))
      if (inflight.current) return
    }
    inflight.current = true
    try {
      const r = projectId === undefined ? await refreshSeatmap(scopeRef.current) : await refreshSeatmap(scopeRef.current, projectId)
      if (r.ok) { setMap(r.seatmap); setNowMs(Date.parse(r.seatmap.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [projectId])

  /** 결재 실행 — 실패는 삼키지 않고 상세 패널에 그대로 띄운다(에러 3원칙). 성공하면 좌석표를 다시 읽는다. */
  const runOp = useCallback(async (seat: Seat, kind: SeatOpKind, text: string) => {
    setBusyOrderId(seat.orderId)
    setOpError(null)
    const op: HubProcessOp = (kind === 'reject' || kind === 'rework')
      ? { kind, orderId: seat.orderId, note: text }
      : { kind, orderId: seat.orderId }
    try {
      const r = await runHubProcessOp(seat.projectId, op)
      if (!r.ok) { setOpError(r.error); return }
      setNote(null)
      // 처리는 허브를 돌려주지만 오피스가 쥔 것은 좌석표다 — 한 번 더 읽어야 화면이 맞는다.
      if (r.hubError) setOpError(r.hubError)
      await refresh(undefined, true)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally { setBusyOrderId(null) }
  }, [refresh])

  /** 좌석·패널에서 op 버튼을 누른 순간 — 사유가 필요한 op 는 곧바로 보내지 않고 입력을 연다. */
  const onOp = useCallback((seat: Seat, kind: SeatOpKind) => {
    setSelected(seat.orderId)
    setOpError(null)
    if (opSpec(kind).needsNote) {
      setNote(prev => (prev && prev.orderId === seat.orderId && prev.kind === kind)
        ? prev // 같은 op 를 다시 눌러도 쓰던 글을 지우지 않는다
        : { orderId: seat.orderId, kind, text: '' })
      return
    }
    setNote(null)
    void runOp(seat, kind, '')
  }, [runOp])

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
  const doneTotal = map.floors.reduce((n, f) => n + f.doneCount, 0)

  return (
    <div className={css.root}>
      <header className={css.top}>
        <Counters counters={map.counters} />
        <div className={css.topRight}>
          {projectId !== undefined && <Link href="/agents" data-office-all-link className={css.allLink}>전체 오피스</Link>}
          <div className={css.viewSeg} role="group" aria-label="보기">
            <button type="button" data-view="floor" aria-pressed={view === 'floor'} onClick={() => pickView('floor')}><IconFloorView />평면도</button>
            <button type="button" data-view="lane" aria-pressed={view === 'lane'} onClick={() => pickView('lane')}><IconLaneView />상태 레인</button>
          </div>
          <div className={css.scope} role="group" aria-label="표시 범위">
            <button type="button" aria-pressed={scope === 'mine'} onClick={() => { void refresh('mine', true) }}>내 작업</button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => { void refresh('all', true) }}>전체</button>
          </div>
          <div className={`${css.stamp} ${error ? css.stampBad : ''}`}>
            {error ? <span data-error="">갱신 실패 {hhmmss(error.at)} · {error.message}</span> : <span>갱신 {hhmmss(map.fetchedAt)}</span>}
          </div>
        </div>
      </header>
      <AttentionBand items={map.attention} onSelect={setSelected} />
      <main className={css.stage}>
        <section className={css.floors} data-view={view} aria-label={view === 'floor' ? '프로젝트별 좌석' : '상태별 좌석'}>
          {map.floors.length === 0 && (projectId !== undefined
            ? (map.scope === 'mine'
              ? <p className={css.doneNote}>이 프로젝트에서 내게 배정된 에이전트 작업이 없습니다. 다른 사람 것까지 보려면 ‘전체’를 누르세요.</p>
              : <p className={css.doneNote}>이 프로젝트에 위임된 주문이 없습니다. 위임·승인 탭에서 리프 항목에 위임을 켜면 좌석이 생깁니다.</p>)
            : map.scope === 'mine'
              ? <p className={css.doneNote}>배정된 에이전트 작업이 없습니다. 담당자가 나이거나 내 에이전트가 잡은 주문만 보입니다 — 다른 사람 것까지 보려면 ‘전체’를 누르세요.</p>
              : <p className={css.doneNote}>표시할 주문이 없습니다. 에이전트 위임(agent 태그) 항목의 주문만 보이며, 내가 속한 프로젝트에 그런 주문이 생기면 여기 층이 생깁니다.</p>)}
          {view === 'floor'
            ? map.floors.map(f => (
              <FloorCard key={f.id} floor={f} selectedId={selected} nowMs={nowMs} busyOrderId={busyOrderId} onSelect={setSelected} onOp={onOp} />
            ))
            : map.floors.length > 0 && (
              <LaneBoard map={map} selectedId={selected} nowMs={nowMs} busyOrderId={busyOrderId}
                showFloorName={projectId === undefined} onSelect={setSelected} onOp={onOp} />
            )}
          {view === 'floor' && doneTotal > 0 && (
            <p className={css.doneNote}>
              머지 완료 {doneTotal}건(최근 7일)은 평면도에 그리지 않습니다 —{' '}
              <button type="button" className={css.zoneFold} data-goto-lane onClick={() => pickView('lane')}>상태 레인에서 보기</button>
              . 승인 취소·재작업 요청은 거기서 합니다.
            </p>
          )}
        </section>
      </main>
      {/* 상세와 결재는 팝업으로 — 좌석 무대가 화면 폭을 다 쓰고, 고른 좌석에 시선이 모인다.
          닫으면 선택과 쓰던 사유를 함께 비운다(초안만 남으면 폴링이 계속 쉰다). */}
      <Modal
        open={sel !== null}
        onClose={() => { setSelected(null); setNote(null); setOpError(null) }}
        eyebrow={sel ? seatEyebrow(sel.floorName, sel.zoneLabel, sel.seat) : undefined}
        title={sel?.seat.code}
        size="lg">
        <DetailPanel
          seat={sel?.seat ?? null} nowMs={nowMs}
          busy={sel?.seat != null && busyOrderId === sel.seat.orderId}
          note={note} opError={opError} onOp={onOp}
          onNoteChange={text => setNote(prev => (prev ? { ...prev, text } : prev))}
          onNoteConfirm={() => { if (note && sel?.seat) void runOp(sel.seat, note.kind, note.text) }}
          onNoteCancel={() => { setNote(null); setOpError(null) }}
        />
      </Modal>
      <footer className={css.legend}>
        <ul>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />업무 중(신호 5분 이내)</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)', borderColor: 'var(--sm-warn)' }} />무응답 5분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-empty)', borderColor: 'var(--sm-warn)' }} />끊김 30분 초과</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />결정 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-wait)' }} />승인 대기</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-reject)' }} />반려 · 재작업</li>
          <li><i className={css.sw} style={{ borderStyle: 'dashed' }} />빈자리</li>
        </ul>
        <p>프로젝트가 층, 주문 항목의 부모 항목이 구역, 작업 주문 하나가 책상입니다. 의자의 인물은 그 주문을 잡은 에이전트(슬롯)이며 같은 에이전트는 늘 같은 인물입니다. 신호는 PostToolUse 훅의 heartbeat(60초 절제)와 progress 보고입니다. 승인·반려·승인 취소·재작업 요청·회수는 좌석에서 바로 하며, 반려와 재작업 요청은 사유를 적어야 확정됩니다.</p>
      </footer>
    </div>
  )
}
