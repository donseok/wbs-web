'use client'
// 에이전트 스튜디오의 세 번째 보기 '에이전트' — 작업 PC 한 줄에 자리(팀장·팀원 N)를 책상으로 늘어놓고,
// 고른 자리의 프로필을 오른쪽에 보인다(2026-09-18 시안 v2, 사용자 결정으로 스튜디오 탭 안의 보기가 됐다).
// 데이터는 스튜디오가 30초마다 읽는 좌석표 그대로를 agentRoster 로 다시 묶는다 — 폴링·범위(내 작업/전체)는 스튜디오 몫.
// 좌석 단위 보고 이력·처리량·토큰 연결은 아직 데이터가 없어 그리지 않는다(시안 notes 의 NEW 항목).
import { useMemo, useState, type ReactNode } from 'react'
import type React from 'react'
import Link from 'next/link'
import type { Seat, Seatmap } from '@/lib/domain/seatmap'
import { ageLabel } from '@/lib/domain/seatmap'
import { pickCharacter, STALE_MS, OFFLINE_MS, type AnimName, type CharacterName } from '@/lib/domain/seatState'
import { assembleRoster, modelBadge, TIER_NAME, type ModelTier, type Roster, type RosterDesk, type RosterHost } from '@/lib/domain/agentRoster'
import type { HeroTile } from '@/components/agent-hub/AgentFrame'
import { Sprite } from './Sprite'
import { PhaseBadge } from './PhaseBadge'
import { awayBubble, awayReason, leadChatter } from '@/lib/domain/officeChatter'
import { ChatBubble, seatSpeech, useOfficeChatter } from './SeatSpeech'
import { OwnerTag, ownerLabel, teamOwnerLabel, watcherOwnerLabel, type OwnerLabel } from './OwnerTag'
import { LeadChip } from './LeadChip'

/** 「팀장 해제」 핸들러 — 없으면 책상에 lease 정보만 보이고 해제 버튼은 그리지 않는다(FloorCard 와 같은 규칙). */
type ReleaseLeadHandler = (projectId: string, userId: string) => Promise<void>

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
function deskLine(d: RosterDesk, host: RosterHost, nowMs: number, chatter: boolean): string {
  if (d.kind === 'lead') {
    const w = d.watcher
    const seats = w?.slots != null ? `팀원 ${w.slots}명 배정` : '감시'
    return w?.untilLabel ? `${seats} · ${w.untilLabel} 까지` : seats
  }
  // 잡담이 켜져 있으면 부재 사유(농담)를 붙인다 — 끄면 사실만 남는다.
  if (d.kind === 'empty') return chatter ? `자리 비움 · ${awayReason(d.key, nowMs)}` : host.watcher ? '빈자리 — 다음 위임을 기다립니다' : '빈자리'
  return d.seat ? `${d.seat.code} ${d.seat.name}` : ''
}
/** 책상의 계정 명찰 — 팀장은 감시자 계정, 팀원은 주문을 잡은 계정. 빈자리는 null. */
function deskOwner(d: RosterDesk): OwnerLabel | null {
  if (d.kind === 'lead') return d.watcher ? watcherOwnerLabel(d.watcher) : null
  return d.seat ? ownerLabel(d.seat) : null
}
function signalAt(d: RosterDesk): string | null {
  return d.kind === 'lead' ? d.watcher?.lastSeenAt ?? null : d.seat?.lastSignalAt ?? null
}

/** 에이전트 보기일 때 공통 헤더에 얹는 타일·요약. */
export function rosterHero(roster: Roster): { tiles: HeroTile[]; lede: ReactNode } {
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
    ? <>지금 일하거나 감시 중인 에이전트가 없습니다.</>
    : (
      <>
        {pcs > 0 ? <>작업 PC <b>{pcs}대</b>에서 </> : null}<b>{roster.agentCount}명</b>이 일하고 있습니다.
        {t.blocked > 0 && <> <em>{t.blocked}명이 당신의 답을 기다립니다.</em></>}
      </>
    )
  return { tiles, lede }
}

export function useRoster(map: Pick<Seatmap, 'floors'>): Roster {
  return useMemo(() => assembleRoster(map), [map])
}

export function RosterBoard({ roster, nowMs, onReleaseLead }: { roster: Roster; nowMs: number; onReleaseLead?: ReleaseLeadHandler }) {
  const [selected, setSelected] = useState<string | null>(null)
  const allDesks = roster.hosts.flatMap(h => h.desks.map(d => ({ d, h })))
  // 고른 자리가 폴링으로 사라지면 결정 대기 → 첫 에이전트 순으로 다시 고른다.
  const current = allDesks.find(x => x.d.key === selected)
    ?? allDesks.find(x => x.d.seat?.state === 'BLOCKED')
    ?? allDesks.find(x => x.d.kind === 'member' || x.d.kind === 'external')
    ?? allDesks[0] ?? null
  return (
    <div data-roster-board className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-4">
        {roster.hosts.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-8 text-center text-sm text-ink-muted">
            감시 중인 작업 PC 도, 주문을 잡은 에이전트도 없습니다. 에이전트가 dflow 로 감시를 시작하거나 위임된 주문을 잡으면 여기에 자리가 생깁니다.
          </p>
        )}
        {/* identity(agent 문자열)가 같은 감시자가 없어 어느 책상에도 못 붙은 lease(0101) — 다른 계정
            감시자는 scope=mine 이 지워도 그 lease 는 남는다(관리자가 남의 것도 풀 수 있어야 하므로).
            없는 "감시 중" 책상을 지어내는 대신 여기 따로 보인다. */}
        {roster.unmatchedLeads.length > 0 && (
          <div data-roster-unmatched-leads className="flex flex-wrap gap-1 rounded-2xl border border-dashed border-line bg-surface px-3 py-2">
            {roster.unmatchedLeads.map(l => (
              <LeadChip key={`${l.projectId}:${l.userId}`} lead={l} projectLabel={l.floorName}
                onRelease={onReleaseLead ? () => onReleaseLead(l.projectId, l.userId) : undefined} />
            ))}
          </div>
        )}
        {roster.hosts.map(h => (
          <HostCard key={h.key} host={h} nowMs={nowMs} selectedKey={current?.d.key ?? null} onSelect={setSelected} onReleaseLead={onReleaseLead} />
        ))}
      </div>
      {current && <Profile desk={current.d} host={current.h} nowMs={nowMs} />}
    </div>
  )
}

function HostCard({ host, nowMs, selectedKey, onSelect, onReleaseLead }: {
  host: RosterHost; nowMs: number; selectedKey: string | null; onSelect: (k: string) => void; onReleaseLead?: ReleaseLeadHandler
}) {
  const busy = host.desks.filter(d => d.kind === 'member').length
  const leads = host.desks.flatMap(d => d.leads)
  const w = host.watcher
  const sub = !host.conforming
    ? '신원이 <신원>/<PC> 규칙을 따르지 않아 작업 PC 를 알 수 없습니다'
    : w
      ? `감시 중 · 신호 ${ageLabel(w.lastSeenAt, nowMs)}${w.untilLabel ? ` · ${w.untilLabel} 까지` : ''}`
      : '감시자 없음 — 이 PC 는 새 작업을 집지 않습니다'
  // 팀(작업 PC 행) 명찰 — 팀장 계정이 먼저고, 팀장이 없는 행은 앉아 있는 에이전트의 계정을 쓴다.
  const teamOwner = teamOwnerLabel(host.mine, w?.ownerName ?? host.desks.find(d => d.seat?.agentOwnerName)?.seat?.agentOwnerName ?? null)
  // 내 팀은 행 전체를 브랜드 바탕과 링으로 들어 올린다(2026-09-20 사용자 요청: 책상만이 아니라 팀에도 표시).
  // 남의 팀은 종전 표면색 그대로다 — 흐리게 하지 않는다.
  const skin = host.mine
    ? 'border-brand bg-brand-weak shadow-[0_0_0_2px_var(--color-brand)]'
    : 'border-line bg-surface shadow-sm'
  return (
    <section data-roster-host={host.key} data-owner={teamOwner.kind} className={`rounded-3xl border p-4 ${skin}`}>
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={`font-mono text-base font-bold ${host.mine ? 'text-brand' : 'text-ink'}`}>{host.label}</h2>
        <OwnerTag owner={teamOwner} />
        <span className="text-xs text-ink-subtle">{sub}</span>
        {/* 팀장 lease(0101, 스펙 §7) — 팀장 책상 밑에 두면 행 높이가 들쭉날쭉해져 팀 머리 오른쪽, 자리 수 왼쪽에 둔다
            (2026-09-23 사용자 요청). 한 PC 가 여러 프로젝트의 팀장이면 칩마다 층 이름을 붙여 구분한다. */}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {leads.map(l => (
            <LeadChip key={`${l.projectId}:${l.userId}`} lead={l} projectLabel={leads.length > 1 ? l.floorName : undefined} hideHost
              onRelease={onReleaseLead ? () => onReleaseLead(l.projectId, l.userId) : undefined} />
          ))}
          {host.slots !== null && <span className="text-xs font-semibold tabular-nums text-ink-muted">자리 {busy}/{host.slots}</span>}
        </span>
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
  const chatter = useOfficeChatter()
  const owner = deskOwner(desk)
  // 테두리 색은 선택이 쓰고(평면도·레인과 같은 분담), 내 책상은 바깥 2px 브랜드 링으로 그린다 — 테두리 폭을 바꾸면
  // 책상 줄이 어긋난다. 내 책상을 고르면 선택 링을 브랜드 링 바깥(ring-offset)에 둔다. 남의 것은 흐리게 하지 않는다.
  const mine = owner?.kind === 'mine'
  const edge = `${selected ? 'border-brand ring-2 ring-brand-ring' : 'border-line hover:border-line-strong'} ${mine ? (selected ? 'ring-offset-2 ring-offset-brand' : 'shadow-[0_0_0_2px_var(--color-brand)]') : ''}`
  return (
    <li className="relative flex flex-col gap-1">
      <button type="button" data-roster-desk={desk.slot} data-owner={owner?.kind} aria-pressed={selected} onClick={() => onSelect(desk.key)}
        className={`flex w-full flex-col overflow-hidden rounded-2xl border text-left transition ${edge} ${desk.kind === 'empty' ? 'border-dashed' : ''}`}>
        {/* 위에서부터 단계 말풍선 · 캐릭터 · 모델 명찰(2026-09-18 사용자 선택) — 말풍선 자리는 비어도 높이를 지켜 책상 줄이 맞는다. */}
        <span className="relative flex flex-col items-center pb-2.5 pt-2"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${tone.color} 16%, var(--color-surface)), var(--color-surface))`, '--sm-cell-w': '102px', '--sm-cell-h': '93px' } as React.CSSProperties}>
          <span className="flex h-[58px] w-full items-end justify-center px-2">{topBubble(desk, host, nowMs, chatter)}</span>
          <span className={desk.kind === 'empty' ? 'opacity-60' : ''}><Sprite character={look.character} anim={look.anim} /></span>
          <span className="flex h-[26px] items-end justify-center"><Nameplate desk={desk} /></span>
        </span>
        <span className={`flex flex-col gap-1 px-3 pb-3 pt-2 ${mine ? 'bg-brand-weak' : ''}`}>
          <span className="flex items-center gap-2">
            <b className="text-sm text-ink">{desk.kind === 'lead' ? (desk.slot === 'poll' ? '단독 감시' : '팀장') : desk.label}</b>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: tone.color === '#b7bfba' ? 'var(--color-ink-subtle)' : tone.color }}>
              <i className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: tone.color }} />{tone.label}
            </span>
          </span>
          {/* 계정 명찰 줄 — 빈자리도 높이를 지켜 책상 줄이 맞는다. 모델 명찰(캐릭터 발밑)과는 다른 칸이다. */}
          <span className="flex h-4 min-w-0 items-center">{owner && <OwnerTag owner={owner} />}</span>
          <span className="line-clamp-2 min-h-[2.5em] text-xs text-ink-muted">{deskLine(desk, host, nowMs, chatter)}</span>
          {desk.seat && <Progress pct={desk.seat.progress} color={tone.color} />}
          <span className="text-[11px] tabular-nums text-ink-subtle">{sig ? `신호 ${ageLabel(sig, nowMs)}` : ' '}</span>
        </span>
      </button>
      {/* 책상 카드에서도 바로 WBS 로 간다(2026-09-24 사용자 요청) — 카드가 <button> 이라 안에 링크를 넣지 못해
          신호 줄 오른쪽에 겹쳐 둔다. 프로필 카드의 「WBS 에서 보기」와 같은 focus·open 딥링크다. */}
      {desk.seat?.itemId && (
        <Link href={`/p/${desk.seat.projectId}/wbs?focus=${desk.seat.itemId}&open=1`} data-roster-desk-wbs={desk.seat.itemId}
          className="absolute bottom-2.5 right-3 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-brand hover:border-brand">WBS 에서 열기</Link>
      )}
    </li>
  )
}

/**
 * 캐릭터 머리 위 — 팀장은 잔소리·칭찬 말풍선, 팀원은 막 올린 보고 말풍선, 그 밖엔 단계 말풍선(2026-09-18).
 * 작업 중인 팀원은 단계 말풍선 사이사이 한마디씩 한다(세 칸에 한 칸).
 * 대사 고르기는 officeChatter(순수)가 한다. 보고가 식으면(10분) 단계 말풍선으로 돌아간다.
 */
function topBubble(desk: RosterDesk, host: RosterHost, nowMs: number, chatter: boolean): React.ReactNode {
  if (desk.kind === 'lead') {
    // 팀장 대사(잔소리·칭찬·한탄·혼잣말)는 전부 잡담이다 — 끄면 팀장 머리 위는 비운다.
    if (!chatter) return null
    const c = leadChatter(host, nowMs, desk)
    return c && <ChatBubble key={c.text} kind={c.tone} text={c.text} className="max-w-full" />
  }
  if (desk.kind === 'empty') {
    // 빈자리 부재 사유 — 세 칸에 한 칸만 띄운다. 잡담이라 끄면 비운다.
    const away = chatter ? awayBubble(desk.key, nowMs) : null
    return away && <ChatBubble key={away} kind="empty" text={away} className="max-w-full" />
  }
  if (!desk.seat) return null
  const say = seatSpeech(desk.seat, nowMs, chatter)
  if (say) return <ChatBubble key={say.text} {...say} className="max-w-full" />
  return <span className="self-center"><PhaseBadge seat={desk.seat} /></span>
}

/**
 * 캐릭터 발밑 명찰(위는 단계 말풍선 자리) — 어떤 모델이 앉아 있는지 한눈에. 제조사 표식(색 + 기호)과 짧은 모델 이름.
 * 팀장·단독 감시는 같은 자리에 ★ 명찰을 단다. 모델은 heartbeat 의 실행 모델(0100, Phase 서브에이전트)이 우선이고,
 * 아직 보고가 없으면 WBS 항목 지정 모델을 점선 명찰로 보인다. 같은 팀원도 Phase 마다 등급이 바뀐다.
 */
function Nameplate({ desk, size = 'sm' }: { desk: RosterDesk; size?: 'sm' | 'lg' }) {
  const pos = size === 'sm' ? 'relative' : ''
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs'
  if (desk.kind === 'lead') {
    return (
      <span data-nameplate="lead" className={`${pos} z-[1] inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#2f6e44] px-2.5 py-1 font-bold text-white shadow-[0_6px_14px_-8px_#1b3a26] ${text}`}>
        <span aria-hidden className="text-[#ffd76a]">★</span>{desk.slot === 'poll' ? '단독 감시' : '팀장'}
      </span>
    )
  }
  if (desk.kind === 'empty') return null
  const b = modelBadge(desk.seat?.model)
  if (!b) {
    return (
      <span data-nameplate="unknown" title="실행 모델 보고도, WBS 지정 모델도 없습니다"
        className={`${pos} z-[1] inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-line-strong bg-surface/80 px-2.5 py-1 font-semibold text-ink-subtle ${text}`}>
        모델 미상
      </span>
    )
  }
  const ring = b.tier ? TIER_RING[b.tier] : null
  // 실행 모델(heartbeat)은 꽉 찬 명찰, 지정 모델(WBS)은 점선 테두리의 흐린 명찰 — 지금 도는 모델인지 계획인지 한눈에.
  const plan = desk.seat?.modelSource !== 'run'
  const edge = plan ? '#8A8F99' : ring?.edge
  const shadow = plan
    ? '0 8px 16px -10px #0d1014'
    : `${edge ? `0 0 0 1.5px ${edge}, ` : ''}${ring?.glow ? `0 0 ${ring.glow}px ${ring.edge}66, ` : ''}0 8px 16px -10px #0d1014`
  const phase = desk.seat?.heartbeatPhase ? PHASE_KO[desk.seat.heartbeatPhase] : undefined
  return (
    <span data-nameplate={b.vendor} data-tier={b.tier ?? undefined} data-model-source={plan ? 'plan' : 'run'}
      title={`${plan ? 'WBS 지정 모델(실행 보고 전)' : `실행 모델${phase ? ` · ${phase} 단계` : ''}`} · ${desk.seat?.model ?? ''}${b.tier ? ` · 등급 ${b.tier}/4 ${TIER_NAME[b.tier]}` : ''}`}
      className={`${pos} z-[1] inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1 pr-2 font-bold ${text} ${plan ? 'border border-dashed border-[#8A8F99] bg-[#15191fb3] text-[#d9d3cb]' : 'bg-[#15191f] text-[#f4efe7]'}`}
      style={{ boxShadow: shadow }}>
      <span aria-hidden className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[11px] leading-none text-white ${plan ? 'opacity-70' : ''}`} style={{ background: b.color }}>{b.mark}</span>
      <span className="font-mono tracking-tight">{b.label}</span>
      {b.tier && <TierPips tier={b.tier} color={plan ? '#b7bfba' : ring!.edge} />}
      {plan && <span className="rounded-full bg-white/10 px-1.5 py-px text-[9px] font-semibold tracking-wide text-[#b7bfba]">지정</span>}
      {size === 'sm' && <i aria-hidden className={`absolute -top-[5px] left-1/2 -z-[1] h-2.5 w-2.5 -translate-x-1/2 rotate-45 ${plan ? 'bg-[#15191fb3]' : 'bg-[#15191f]'}`} />}
    </span>
  )
}

export const PHASE_KO: Record<string, string> = { prepare: '준비', design: '설계', build: '구현', verify: '검증', refactor: '리팩터', blocked: '결정 대기', rejected: '재작업', reported: '보고', merge_conflict: '머지 충돌' }

/**
 * 프로필 카드 「단계 …」 — 보고된 단계를 한국어로 읽는다. 단계 보고가 없는 착수 좌석(seat.phase=prepare)은 비우지 않고
 * 「준비」다(2026-09-24: 착수 직후가 구현으로 보이던 문제). 추정 단계만 있는 승인 대기·완료 좌석은 종전대로 비운다.
 */
export function profilePhaseLabel(seat: Pick<Seat, 'heartbeatPhase' | 'phase'>): string | null {
  const key = seat.heartbeatPhase ?? (seat.phase === 'prepare' ? 'prepare' : null)
  return key ? PHASE_KO[key] ?? key : null
}

/** 등급 테두리 — 1 금 · 2 은 · 3 동 · 4 무광. 1등급만 은은하게 빛난다. */
const TIER_RING: Record<ModelTier, { edge: string; glow: number }> = {
  1: { edge: '#F5C451', glow: 12 },
  2: { edge: '#C9D3DD', glow: 0 },
  3: { edge: '#C98A55', glow: 0 },
  4: { edge: '#5B636E', glow: 0 },
}

/** 4칸 등급 막대 — 채운 칸 수 = 5 − 등급(1등급이면 네 칸). 칸 높이가 계단처럼 올라간다. */
function TierPips({ tier, color }: { tier: ModelTier; color: string }) {
  const filled = 5 - tier
  return (
    <span aria-label={`등급 ${tier}/4 ${TIER_NAME[tier]}`} className="ml-0.5 inline-flex items-end gap-[2px]">
      {[0, 1, 2, 3].map(i => (
        <i key={i} className="block w-[3px] rounded-[1px]" style={{ height: 5 + i * 2, background: i < filled ? color : '#ffffff26' }} />
      ))}
    </span>
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
  const chatter = useOfficeChatter()
  const tone = deskTone(desk)
  const look = deskLook(desk)
  const title = desk.kind === 'lead' ? (desk.slot === 'poll' ? '단독 감시' : '팀장') : desk.label
  const seat = desk.seat
  const stepLabel = seat ? profilePhaseLabel(seat) : null
  const owner = deskOwner(desk)
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
          {owner && <span className="mt-1 flex min-w-0"><OwnerTag owner={owner} /></span>}
          {desk.kind !== 'lead' && desk.kind !== 'empty' && (
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <Nameplate desk={desk} size="lg" />
              {(() => {
                const t = modelBadge(desk.seat?.model)?.tier
                const src = desk.seat?.modelSource === 'run' ? '실행 모델' : desk.seat?.modelSource === 'plan' ? 'WBS 지정 모델' : null
                return src ? <span className="text-[11px] font-semibold text-ink-muted">{src}{t ? ` · 등급 ${t}/4 ${TIER_NAME[t]}` : ''}</span> : null
              })()}
            </span>
          )}
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
          <p className="text-[11px] text-ink-subtle">진척 {seat.progress}%{stepLabel ? ` · 단계 ${stepLabel}` : ''}</p>
          {/* 에이전트 상세(DetailPanel)와 같은 WBS 딥링크 — 명세·진행 표가 바로 열린다(2026-09-24 사용자 요청).
              제목 옆 글자 링크로는 버튼인 줄 몰라 지나쳤다 — 폭을 채운 버튼으로 둔다. */}
          {seat.itemId && (
            <Link href={`/p/${seat.projectId}/wbs?focus=${seat.itemId}&open=1`} data-roster-wbs-link={seat.itemId}
              className="mt-1 inline-flex items-center justify-center rounded-xl border border-brand bg-brand-weak px-3 py-2 text-xs font-bold text-brand transition hover:bg-brand hover:text-brand-fg">WBS 에서 열기 →</Link>
          )}
        </section>
      )}
      {seat?.state === 'BLOCKED' && (
        <section className="rounded-2xl border border-[#F0B068] bg-[color-mix(in_srgb,#F0B068_12%,var(--color-surface))] p-3">
          <h3 className="text-xs font-bold text-ink">결정이 필요합니다</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{seat.note ?? '에이전트가 사유를 남기지 않았습니다.'}</p>
          <p className="mt-2 text-[11px] text-ink-subtle">답은 위임·승인 탭이나 에이전트 스튜디오의 이 좌석에서 합니다.</p>
        </section>
      )}
      {desk.kind === 'lead' && desk.watcher && (
        <section className="flex flex-col gap-1 text-sm text-ink-muted">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">감시</h3>
          <p>자리 {desk.watcher.busy ?? 0}/{desk.watcher.slots ?? '—'}{desk.watcher.untilLabel ? ` · ${desk.watcher.untilLabel} 까지` : ''}</p>
        </section>
      )}
      {desk.kind === 'empty' && (
        <p className="text-sm text-ink-muted">
          {chatter && <b data-away className="mb-1 block text-ink">지금은 {awayReason(desk.key, nowMs)}</b>}
          아무도 앉지 않은 자리입니다. 팀장이 다음 위임을 이 자리에 배정합니다.
        </p>
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
