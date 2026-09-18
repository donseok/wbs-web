// src/components/agents/SeatSpeech.tsx — 캐릭터 말풍선(에이전트 · 평면도 · 상태 레인 공용, 2026-09-18)
'use client'
import { createContext, useContext } from 'react'
import type { Seat } from '@/lib/domain/seatmap'
import { memberChatter, memberReportBubble } from '@/lib/domain/officeChatter'
import { PHASE_LOOK } from './PhaseBadge'
import css from './seatmap.module.css'

export const BUBBLE_LOOK = {
  nag: { bg: '#FFF4D6', edge: '#E9B949', ink: '#5A4210' },
  praise: { bg: '#E6F6EA', edge: '#6CC48A', ink: '#1F5A33' },
  empty: { bg: '#EEF1F4', edge: '#B7C0C9', ink: '#3E4A56' },
  report: { bg: '#FFFFFF', edge: '#D5DCE2', ink: '#243240' },
  done: { bg: '#FFFFFF', edge: '#D5DCE2', ink: '#243240' },
  chat: { bg: '#F7F9FB', edge: '#C9D2DA', ink: '#3E4A56' },
} as const

/**
 * 잡담 켬/끔(2026-09-18 사용자 요청) — 켜면 팀장 잔소리·칭찬·한탄·혼잣말과 팀원 한마디까지, 끄면 업무 말풍선만
 * (팀원 보고 · 단계). 오피스 상단 토글이 값을 정하고 평면도·상태 레인·에이전트 보기가 같은 값을 읽는다.
 * 기본은 켬 — 토글이 생기기 전의 동작이다.
 */
export const OfficeChatterContext = createContext(true)
export function useOfficeChatter(): boolean { return useContext(OfficeChatterContext) }

export interface Speech { kind: keyof typeof BUBBLE_LOOK; text: string; opener?: string; color?: string }

/**
 * 좌석(팀원) 말풍선 — 막 올린 보고가 먼저, 없으면 작업 중 한마디(세 칸에 한 칸), 둘 다 없으면 null(단계 말풍선 자리).
 * 대사 고르기는 officeChatter(순수)가 한다. 주문 id 로 고르므로 어느 보기에서든 같은 좌석은 같은 말을 한다.
 * chatter=false 면 한마디를 건너뛴다 — 보고는 업무라 잡담을 꺼도 남는다.
 */
export function seatSpeech(seat: Seat | null | undefined, nowMs: number, chatter = true): Speech | null {
  if (!seat) return null
  const r = memberReportBubble({ seat }, nowMs)
  if (r) {
    const done = r.kind === 'completion'
    return { kind: done ? 'done' : 'report', opener: r.opener, text: r.text, color: done ? '#4FC07E' : PHASE_LOOK[seat.phase]?.color ?? '#5DB1E5' }
  }
  if (!chatter) return null
  const talk = memberChatter({ seat }, nowMs)
  return talk ? { kind: 'chat', text: talk } : null
}

/**
 * 만화 말풍선 — 새 대사마다 톡 튀어나온다. 넘치면 말줄임, 전문은 title.
 * tail 'down' 은 아래 캐릭터를, 'left' 는 왼쪽 캐릭터(상태 레인 카드)를 가리킨다.
 */
export function ChatBubble({ kind, text, opener, color, tail = 'down', lines = 2, className = '' }: Speech & {
  tail?: 'down' | 'left'; lines?: 1 | 2; className?: string
}) {
  const look = BUBBLE_LOOK[kind]
  const clamp = lines === 1 ? 'line-clamp-1' : 'line-clamp-2'
  const tailCls = tail === 'down'
    ? '-bottom-[5px] left-1/2 -translate-x-1/2 border-b border-r'
    : 'top-1/2 -left-[5px] -translate-y-1/2 border-b border-l'
  return (
    <span data-chat-bubble={kind} title={opener ? `${opener} ${text}` : text}
      className={`${css.chatPop} relative rounded-2xl border px-2.5 py-1.5 text-[11px] font-semibold leading-snug break-keep shadow-[0_6px_14px_-10px_#0d1014] ${tail === 'down' ? 'mb-1.5 text-center' : 'ml-1.5 text-left'} ${className}`}
      style={{ background: look.bg, borderColor: look.edge, color: look.ink }}>
      {opener && <b className={lines === 1 ? 'mr-1 text-[10px] font-extrabold' : 'block text-[10px] font-extrabold'} style={{ color }}>{opener}</b>}
      <span className={lines === 1 ? `${opener ? 'font-medium' : ''}` : `${clamp} ${opener ? 'font-medium' : ''}`}>{text}</span>
      <i aria-hidden className={`absolute h-2.5 w-2.5 rotate-45 ${tailCls}`} style={{ background: look.bg, borderColor: look.edge }} />
    </span>
  )
}
