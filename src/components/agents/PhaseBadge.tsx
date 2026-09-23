// 캐릭터 머리 위 단계 말풍선 — 지금 설계·구현·검증·리팩터 중 어디인지 눌러 보지 않고 바로 읽힌다(2026-09-18 사용자 선택).
// 말풍선은 단계색 + 아이콘 + 이름, 그 아래 네 점이 dflow-dev Phase 순서(설계 → 구현 → 검증 → 리팩터)에서 지금 위치다.
// 결정 대기·재작업은 순서 밖의 상태라 점 없이 말풍선만 단다. 에이전트가 붙어 있지 않은 좌석(빈자리·승인 대기·완료)엔 달지 않는다.
// 예외: 머지 충돌(2026-09-23)은 승인 대기·완료 좌석에도 점 없이 단다 — 팀장이 대리로 쏜 표시다.
import type React from 'react'
import type { Seat } from '@/lib/domain/seatmap'

export const PHASE_STEPS = ['design', 'build', 'verify', 'refactor'] as const

const I = (d: React.ReactNode) => (
  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
/** 단계 모양 — 색은 좌석 상태색(업무 중 파랑 · 승인 대기 주황 · 반려 빨강)과 겹치지 않게 골랐다. 구현만 업무 중 파랑과 같은 계열이다. */
export const PHASE_LOOK: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  design: { label: '설계', color: '#A58BF0', icon: I(<><path d="M3 13l2.5-.6L13 4.9 11.1 3 3.6 10.5z" /><path d="M9.8 4.3l1.9 1.9" /></>) },
  build: { label: '구현', color: '#5DB1E5', icon: I(<><path d="M5.5 4.5L2 8l3.5 3.5" /><path d="M10.5 4.5L14 8l-3.5 3.5" /></>) },
  verify: { label: '검증', color: '#4FC07E', icon: I(<><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /><path d="M5.3 7l1.2 1.2L8.8 6" /></>) },
  refactor: { label: '리팩터', color: '#2FB8AC', icon: I(<><path d="M8 2.5l1.3 3.2L12.5 7 9.3 8.3 8 11.5 6.7 8.3 3.5 7l3.2-1.3z" /><path d="M12.5 11.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z" /></>) },
  blocked: { label: '결정 대기', color: '#F2AA4C', icon: I(<><path d="M6 6.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5" /><path d="M8 12h0" /></>) },
  rejected: { label: '재작업', color: '#EE7B6A', icon: I(<><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5v2.5h2.5" /></>) },
  // 머지 충돌(팀장 대리 표시, 2026-09-23) — 승인 대기·완료 좌석에도 단다. 순서 밖 상태라 점이 없다.
  merge_conflict: { label: '머지 충돌', color: '#D35FB7', icon: I(<><path d="M8 14V9" /><path d="M8 9L4 5" /><path d="M8 9l4-4" /><path d="M2.5 5.5L4 5l.5-1.5" /><path d="M13.5 5.5L12 5l-.5-1.5" /></>) },
}

/** 이 좌석에 말풍선을 다는가 — 에이전트가 붙어 일하는(또는 일하다 멈춘) 좌석만. */
const WORKING: ReadonlySet<Seat['state']> = new Set<Seat['state']>(['ACTIVE', 'STALE', 'OFFLINE', 'BLOCKED', 'REJECTED'])

export function seatPhaseKey(seat: Pick<Seat, 'state' | 'phase'>): string | null {
  // 머지 충돌은 WAIT·DONE 좌석에서 난다 — WORKING 검사보다 먼저 본다. 반려(REJECTED) 등 점유 좌석에 남은
  // merge_conflict 는 지난 표시의 잔재라 달지 않는다(REJECTED 는 아래에서 「재작업」 으로 간다).
  if (seat.phase === 'merge_conflict' && (seat.state === 'WAIT' || seat.state === 'DONE')) return 'merge_conflict'
  if (seat.phase === 'merge_conflict' && seat.state !== 'REJECTED') return null
  if (!WORKING.has(seat.state)) return null
  if (seat.state === 'BLOCKED') return 'blocked'
  if (seat.state === 'REJECTED' && !PHASE_STEPS.includes(seat.phase as typeof PHASE_STEPS[number])) return 'rejected'
  return PHASE_LOOK[seat.phase] ? seat.phase : null
}

/**
 * size: bubble = 머리 위 말풍선(꼬리 + 네 점), chip = 한 줄 안에 얹는 작은 칩(상태 레인 카드).
 * 신호가 끊긴(무응답·끊김) 좌석은 흐리게 — 마지막으로 보고한 단계라는 뜻이다.
 */
export function PhaseBadge({ seat, size = 'bubble' }: { seat: Pick<Seat, 'state' | 'phase'>; size?: 'bubble' | 'chip' }) {
  const key = seatPhaseKey(seat)
  if (!key) return null
  const look = PHASE_LOOK[key]
  const step = PHASE_STEPS.indexOf(key as typeof PHASE_STEPS[number])
  const faded = seat.state === 'STALE' || seat.state === 'OFFLINE'
  const title = `${look.label}${step >= 0 ? ` 단계 (${step + 1}/4)` : ''}${faded ? ' · 마지막 보고' : ''}`
  const pill = (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold leading-none ${size === 'chip' ? 'px-1.5 py-[3px] text-[10px]' : 'px-2 py-[5px] text-[11px]'}`}
      style={{ color: '#fff', background: look.color, boxShadow: size === 'bubble' ? `0 6px 14px -8px ${look.color}` : undefined }}>
      {look.icon}{look.label}
    </span>
  )
  if (size === 'chip') {
    return <span data-phase-badge={key} title={title} className={`inline-flex shrink-0 ${faded ? 'opacity-55' : ''}`}>{pill}</span>
  }
  return (
    <span data-phase-badge={key} title={title} className={`relative inline-flex flex-col items-center gap-[3px] ${faded ? 'opacity-55 grayscale-[.35]' : ''}`}>
      {pill}
      <i aria-hidden className="absolute left-1/2 top-[15px] h-2 w-2 -translate-x-1/2 rotate-45" style={{ background: look.color }} />
      <span aria-hidden className="relative flex items-center gap-[3px] pt-[3px]">
        {step >= 0 && PHASE_STEPS.map((s, i) => (
          <i key={s} data-phase-dot={i <= step ? 'on' : 'off'}
            className={`block rounded-full ${i === step ? 'h-[6px] w-[6px]' : 'h-[5px] w-[5px]'}`}
            style={{ background: i <= step ? look.color : 'color-mix(in srgb, var(--color-ink-subtle) 35%, transparent)', boxShadow: i === step ? `0 0 0 2px color-mix(in srgb, ${look.color} 30%, transparent)` : undefined }} />
        ))}
      </span>
    </span>
  )
}
