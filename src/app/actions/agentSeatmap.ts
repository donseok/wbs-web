'use server'

import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { getSeatmap } from '@/lib/data/agentSeatmap'
import { SEATMAP_SCOPES, type Seatmap, type SeatmapScope } from '@/lib/domain/seatmap'

/** 좌석표 재조회(30초 폴링). 페이지와 같은 게이트를 다시 검사한다 — 액션은 URL 로도 불릴 수 있다. */
export async function refreshSeatmap(scope: SeatmapScope = 'mine'): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }> {
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) return { ok: false, error: '권한이 없습니다.' }
  if (!SEATMAP_SCOPES.includes(scope)) return { ok: false, error: '범위 값이 잘못됐습니다.' } // 액션 인자는 클라이언트 입력이다
  try {
    return { ok: true, seatmap: await getSeatmap(actor, Date.now(), scope) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[seatmap] 재조회 실패:', msg)
    return { ok: false, error: '좌석표 재조회에 실패했습니다.' }
  }
}
