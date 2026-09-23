'use client'
// 스텁 잔존 배지(스펙 2026-09-23 F13). 판정은 호출부가 pendingStubs 로 끝낸 목록을 넘긴다 — 여기서 다시 거르지 않는다.
import { stubBadgeText, stubLabel, type StubTaskLike } from '@/lib/domain/forceProgress'

export function StubBadge({ stubs, onOpen }: { stubs: readonly StubTaskLike[]; onOpen?: (subTaskId: string) => void }) {
  if (stubs.length === 0) return null
  const title = stubs.map(s => stubLabel(s.stubFor)).join('\n')
  return (
    <button type="button" data-stub-badge title={title} aria-label={`${stubBadgeText(stubs.length)} — ${title.replace(/\n/g, ', ')}`}
      onClick={e => { e.stopPropagation(); onOpen?.(stubs[0].id) }}
      className="shrink-0 rounded-full border border-delayed/40 bg-delayed-weak px-1.5 py-0.5 text-[10px] font-bold text-delayed">
      {stubBadgeText(stubs.length)}
    </button>
  )
}
