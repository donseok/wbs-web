'use client'
// 에이전트 명부 — 작업 PC 한 줄에 자리(팀장·팀원 N)를 책상으로 늘어놓고, 고른 자리의 프로필을 오른쪽에 보인다.
// 데이터는 가상 오피스와 같은 좌석표(refreshSeatmap, 범위 all)를 30초마다 다시 읽어 agentRoster 로 묶는다.
// 좌석 단위 보고 이력·처리량·토큰 연결은 아직 데이터가 없어 그리지 않는다(시안 notes 의 NEW 항목).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { Seatmap } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { pickCharacter, STALE_MS, OFFLINE_MS, type AnimName, type CharacterName } from '@/lib/domain/seatState'
import { assembleRoster, type RosterDesk, type RosterHost } from '@/lib/domain/agentRoster'
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { AgentFrame, type HeroTile } from '@/components/agent-hub/AgentFrame'
import { Sprite } from '@/components/agents/Sprite'

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' })

type Tone = { label: string; color: string }
const TONE: Record<string, Tone> = {
  ACTIVE: { label: '업무 중', color: '#5DB1E5' },
  REJECTED: { label: '재작업', color: '#D8563E' },
  BLOCKED: { label: '결정 대기', color: '#F0B068' },
  STALE: { label: '무응답', color: '#D8563E' },
  OFFLINE: { label: '끊김', color: '#6b7580' },
  LEAD: { label: '감시 중', color: '#3F8F58' },
  EMPTY: { label: '빈자리', color: '#b7bfba' },
}

function deskTone(d: RosterDesk): Tone {
  if (d.kind === 'lead') return TONE.LEAD
  if (d.kind === 'empty' || !d.seat) return TONE.EMPTY
  return TONE[d.seat.state] ?? TONE.EMPTY
}
function deskLook(d: RosterDesk): { character: CharacterName; anim: AnimName } {
  if (d.kind === 'lead') return { character: pickCharacter(d.raw ?? d.key), anim: 'idle_look' }
  if (d.seat) return { character: d.seat.character, anim: d.seat.anim }
  return { character: 'cat', anim: 'empty' }
}
/** 책상 한 줄 설명 — 무엇을 하고 있는지. */
function deskLine(d: RosterDesk, host: RosterHost): string {
  if (d.kind === 'lead') {
    const w = d.watcher
    const seats = w?.slots != null ? `팀원 ${w.slots}명 배정` : '감시'
    return w?.untilLabel ? `${seats} · ${w.untilLabel} 까지` : seats
  }
  if (d.kind === 'empty') return host.watcher ? '빈자리 — 다음 위임을 기다립니다' : '빈자리'
  return d.seat ? `${d.seat.code} ${d.seat.name}` : ''
}
function signalAt(d: RosterDesk): string | null {
  return d.kind === 'lead' ? d.watcher?.lastSeenAt ?? null : d.seat?.lastSignalAt ?? null
}

export function RosterView({ initial, projectId, projectName, pollMs = 30_000 }: {
  initial: Seatmap; projectId: string; projectName: string; pollMs?: number
}) {
  const [map, setMap] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const [selected, setSelected] = useState<string | null>(null)
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshSeatmap('all', projectId)
      if (r.ok) { setMap(r.seatmap); setNowMs(Date.parse(r.seatmap.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [projectId])

  // 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회(오피스와 같은 규칙).
  useEffect(() => {
    let t: number | undefined
    const start = () => { if (t === undefined) t = window.setInterval(() => { void refresh() }, pollMs) }
    const stop = () => { if (t !== undefined) { window.clearInterval(t); t = undefined } }
    const onVis = () => { if (document.visibilityState === 'visible') { void refresh(); start() } else stop() }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh, pollMs])
  useEffect(() => { const t = window.setInterval(() => setNowMs(n => n + 1000), 1000); return () => window.clearInterval(t) }, [])

  const roster = useMemo(() => assembleRoster(map), [map])
  const allDesks = useMemo(() => roster.hosts.flatMap(h => h.desks.map(d => ({ d, h }))), [roster])
  // 고른 자리가 폴링으로 사라지면 결정 대기 → 첫 에이전트 순으로 다시 고른다.
  const current = allDesks.find(x => x.d.key === selected)
    ?? allDesks.find(x => x.d.seat?.state === 'BLOCKED')
    ?? allDesks.find(x => x.d.kind === 'member' || x.d.kind === 'external')
    ?? allDesks[0] ?? null

  const t = roster.tiles
  const tiles: HeroTile[] = [
    { key: 'working', label: '업무 중', value: t.working, color: '#5DB1E5' },
    { key: 'blocked', label: '결정 대기', value: t.blocked, color: '#F0B068' },
    { key: 'stale', label: '무응답', value: t.stale, color: '#D8563E', valueColor: '#ff8a78' },
    { key: 'offline', label: '끊김', value: t.offline, color: '#6b7580', valueColor: '#b7bfba' },
    { key: 'empty', label: '빈자리', value: t.empty, color: '#ffffff40', valueColor: 'var(--color-hero-ink)' },
  ]
  const pcs = roster.hosts.filter(h => h.conforming).length
  const lede = roster.hosts.length === 0
    ? <>지금 이 프로젝트에서 일하거나 감시 중인 에이전트가 없습니다.</>
    : (
      <>
        {pcs > 0 ? <>작업 PC <b>{pcs}대</b>에서 </> : null}<b>{roster.agentCount}명</b>이 일하고 있습니다.
        {t.blocked > 0 && <> <em>{t.blocked}명이 당신의 답을 기다립니다.</em></>}
      </>
    )
  const tools = (
    <div className="ml-auto flex items-center gap-2 text-xs text-ink-subtle">
      <span data-roster-stamp className={error ? 'text-delayed' : ''}>
        {error ? `갱신 실패 ${hhmmss(error.at)} · ${error.message}` : `30초마다 갱신 · ${hhmmss(map.fetchedAt)}`}
      </span>
      <button type="button" className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { void refresh() }}>새로고침</button>
    </div>
  )

  return (
    <AgentFrame projectId={projectId} projectName={projectName} title="에이전트" lede={lede} tiles={tiles} tools={tools}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
          {roster.hosts.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-ink-muted">
              감시 중인 작업 PC 도, 주문을 잡은 에이전트도 없습니다. 에이전트가 dflow 로 감시를 시작하거나 위임된 주문을 잡으면 여기에 자리가 생깁니다.
            </p>
          )}
          {roster.hosts.map(h => (
            <HostCard key={h.key} host={h} nowMs={nowMs} selectedKey={current?.d.key ?? null} onSelect={setSelected} />
          ))}
        </div>
        {current && <Profile desk={current.d} host={current.h} nowMs={nowMs} />}
      </div>
    </AgentFrame>
  )
}

function HostCard({ host, nowMs, selectedKey, onSelect }: {
  host: RosterHost; nowMs: number; selectedKey: string | null; onSelect: (k: string) => void
}) {
  const busy = host.desks.filter(d => d.kind === 'member').length
  const w = host.watcher
  const sub = !host.conforming
    ? '신원이 <신원>/<PC> 규칙을 따르지 않아 작업 PC 를 알 수 없습니다'
    : w
      ? `감시 중 · 신호 ${ageLabel(w.lastSeenAt, nowMs)}${w.untilLabel ? ` · ${w.untilLabel} 까지` : ''}`
      : '감시자 없음 — 이 PC 는 새 작업을 집지 않습니다'
  return (
    <section data-roster-host={host.key} className="rounded-3xl border border-line bg-surface p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-base font-bold text-ink">{host.label}</h2>
        <span className="text-xs text-ink-subtle">{sub}</span>
        {host.slots !== null && <span className="ml-auto text-xs font-semibold tabular-nums text-ink-muted">자리 {busy}/{host.slots}</span>}
      </header>
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(172px,1fr))]">
        {host.desks.map(d => <Desk key={d.key} desk={d} host={host} nowMs={nowMs} selected={d.key === selectedKey} onSelect={onSelect} />)}
      </ul>
    </section>
  )
}

function Desk({ desk, host, nowMs, selected, onSelect }: {
  desk: RosterDesk; host: RosterHost; nowMs: number; selected: boolean; onSelect: (k: string) => void
}) {
  const tone = deskTone(desk)
  const look = deskLook(desk)
  const sig = signalAt(desk)
  return (
    <li>
      <button type="button" data-roster-desk={desk.slot} aria-pressed={selected} onClick={() => onSelect(desk.key)}
        className={`flex w-full flex-col overflow-hidden rounded-2xl border text-left transition ${selected ? 'border-brand ring-2 ring-brand-ring' : 'border-line hover:border-line-strong'} ${desk.kind === 'empty' ? 'border-dashed' : ''}`}>
        <span className="relative grid place-items-center pt-2"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${tone.color} 16%, var(--color-surface)), var(--color-surface))`, '--sm-cell-w': '102px', '--sm-cell-h': '93px' } as React.CSSProperties}>
          {desk.kind === 'lead' && <span className="absolute left-2 top-2 rounded-full bg-[#3F8F58] px-2 py-0.5 text-[10px] font-bold text-white">★ {desk.label}</span>}
          <span className={desk.kind === 'empty' ? 'opacity-40' : ''}><Sprite character={look.character} anim={look.anim} /></span>
        </span>
        <span className="flex flex-col gap-1 px-3 pb-3 pt-2">
          <span className="flex items-center gap-2">
            <b className="text-sm text-ink">{desk.kind === 'lead' ? (desk.slot === 'poll' ? '단독 감시' : '팀장') : desk.label}</b>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: tone.color === '#b7bfba' ? 'var(--color-ink-subtle)' : tone.color }}>
              <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.color }} />{tone.label}
            </span>
          </span>
          <span className="line-clamp-2 min-h-[2.5em] text-xs text-ink-muted">{deskLine(desk, host)}</span>
          {desk.seat && <Progress pct={desk.seat.progress} color={tone.color} />}
          <span className="text-[11px] tabular-nums text-ink-subtle">{sig ? `신호 ${ageLabel(sig, nowMs)}` : ' '}</span>
        </span>
      </button>
    </li>
  )
}

function Progress({ pct, color }: { pct: number; color: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-surface-2" aria-label={`진척 ${pct}%`}>
      <i className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  )
}

/** 신호 계기 — 0 · 5분(무응답) · 30분(끊김) 눈금 위에 마지막 신호 경과를 찍는다. 감시자는 70분 기준이라 따로 적는다. */
function SignalGauge({ at, nowMs, lead }: { at: string | null; nowMs: number; lead: boolean }) {
  if (!at) return <p className="text-xs text-ink-subtle">신호 없음</p>
  const min = Math.max(0, (nowMs - Date.parse(at)) / 60_000)
  const max = lead ? 70 : OFFLINE_MS / 60_000
  const pos = Math.min(100, (min / max) * 100)
  const staleAt = (STALE_MS / 60_000 / max) * 100
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: lead
        ? 'linear-gradient(90deg,#3F8F58,#3F8F58 85%,#6b7580)'
        : `linear-gradient(90deg,#5DB1E5 0 ${staleAt}%,#F0B068 ${staleAt}% 100%)` }}>
        <i className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-ink" style={{ left: `calc(${pos}% - 2px)` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-subtle">
        <span>0</span>{!lead && <span>5분 · 무응답</span>}<span>{lead ? '70분 · 감시 끊김' : '30분 · 끊김'}</span>
      </div>
    </div>
  )
}

function Profile({ desk, host, nowMs }: { desk: RosterDesk; host: RosterHost; nowMs: number }) {
  const tone = deskTone(desk)
  const look = deskLook(desk)
  const title = desk.kind === 'lead' ? (desk.slot === 'poll' ? '단독 감시' : '팀장') : desk.label
  const seat = desk.seat
  return (
    <aside data-roster-profile className="sticky top-0 flex min-w-0 flex-[0_1_340px] flex-col gap-4 rounded-3xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <span className="grid shrink-0 place-items-center rounded-2xl"
          style={{ background: `color-mix(in srgb, ${tone.color} 16%, var(--color-surface))`, '--sm-cell-w': '102px', '--sm-cell-h': '93px' } as React.CSSProperties}>
          <Sprite character={look.character} anim={look.anim} />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-ink-subtle">{host.label}</p>
          <h2 className="text-xl font-extrabold text-ink">{title}</h2>
          {desk.raw && <p className="truncate font-mono text-xs text-ink-subtle" title={desk.raw}>{desk.raw}</p>}
          <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `color-mix(in srgb, ${tone.color} 18%, transparent)`, color: 'var(--color-ink)' }}>
            <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.color }} />{tone.label}
          </span>
        </div>
      </div>

      {seat && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">지금 하는 일</h3>
          <p className="text-sm font-semibold text-ink"><span className="font-mono text-ink-muted">{seat.code}</span> {seat.name}</p>
          <Progress pct={seat.progress} color={tone.color} />
          <p className="text-[11px] text-ink-subtle">진척 {seat.progress}%{seat.heartbeatPhase ? ` · 단계 ${seat.heartbeatPhase}` : ''}</p>
        </section>
      )}
      {seat?.state === 'BLOCKED' && (
        <section className="rounded-2xl border border-[#F0B068] bg-[color-mix(in_srgb,#F0B068_12%,var(--color-surface))] p-3">
          <h3 className="text-xs font-bold text-ink">결정이 필요합니다</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{seat.note ?? '에이전트가 사유를 남기지 않았습니다.'}</p>
          <p className="mt-2 text-[11px] text-ink-subtle">답은 위임·승인 탭이나 가상 오피스의 이 좌석에서 합니다.</p>
        </section>
      )}
      {desk.kind === 'lead' && desk.watcher && (
        <section className="flex flex-col gap-1 text-sm text-ink-muted">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">감시</h3>
          <p>자리 {desk.watcher.busy ?? 0}/{desk.watcher.slots ?? '—'}{desk.watcher.untilLabel ? ` · ${desk.watcher.untilLabel} 까지` : ''}</p>
        </section>
      )}
      {desk.kind === 'empty' && (
        <p className="text-sm text-ink-muted">아무도 앉지 않은 자리입니다. 팀장이 다음 위임을 이 자리에 배정합니다.</p>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">마지막 신호 · {signalAt(desk) ? ageLabel(signalAt(desk), nowMs) : '—'}</h3>
        <SignalGauge at={signalAt(desk)} nowMs={nowMs} lead={desk.kind === 'lead'} />
      </section>

      <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-ink-subtle">
        보고 이력은 작업 PC 단위까지만 남고 자리별로는 나뉘지 않습니다. heartbeat 는 이력 없이 마지막 값만 남아 처리량·가동률은 아직 보이지 않습니다.
      </p>
    </aside>
  )
}
