// src/components/agents/OwnerTag.tsx
// 내 에이전트·다른 계정 에이전트 명찰(2026-09-19 사용자 결정: 테두리와 명찰로 구분, 남의 것을 흐리게 하지 않는다).
// 평면도·상태 레인·에이전트 보기가 같은 규칙을 쓴다. 테두리는 각 보기가 data-owner 로 그린다.
import type { Seat, Watcher } from '@/lib/domain/seatmap'

export type OwnerKind = 'mine' | 'other'
export interface OwnerLabel { kind: OwnerKind; text: string }

function label(mine: boolean, name: string | null | undefined): OwnerLabel {
  if (mine) return { kind: 'mine', text: '내 에이전트' }
  const n = name?.trim()
  return { kind: 'other', text: n ? `${n}의 에이전트` : '다른 계정' }
}

/** 좌석의 명찰 — 빈자리(READY)와 에이전트가 없는 좌석은 null(아무 표시도 없다). */
export function ownerLabel(seat: Pick<Seat, 'state' | 'agent' | 'agentMine' | 'agentOwnerName'>): OwnerLabel | null {
  if (seat.state === 'READY' || !seat.agent) return null
  return label(seat.agentMine === true, seat.agentOwnerName)
}

/** 팀장(감시자)의 명찰 — 계정 재료를 싣지 않은 감시자(mine 없음)는 판정하지 않는다. */
export function watcherOwnerLabel(w: Watcher): OwnerLabel | null {
  if (w.mine === undefined) return null
  return label(w.mine, w.ownerName)
}

/** 작은 명찰 — 내 것은 브랜드 바탕, 남의 것은 표면색 바탕에 이름(대비는 라이트·다크 토큰이 맞춘다). */
export function OwnerTag({ owner, className = '' }: { owner: OwnerLabel; className?: string }) {
  const tone = owner.kind === 'mine'
    ? 'border-brand bg-brand text-brand-fg'
    : 'border-line-strong bg-surface text-ink'
  return (
    <span data-owner-tag={owner.kind} title={owner.text}
      className={`inline-block min-w-0 max-w-full truncate whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-bold leading-[14px] ${tone} ${className}`}>
      {owner.text}
    </span>
  )
}
