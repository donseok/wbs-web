'use server'

import { getActorForView } from '@/lib/authz'
import { canViewAgents } from '@/lib/authz/agentsAccess'
import { isProjectMember } from '@/lib/domain/authz'
import { getSeatmap, type SeatmapOptions } from '@/lib/data/agentSeatmap'
import { SEATMAP_SCOPES, type Seatmap, type SeatmapScope } from '@/lib/domain/seatmap'
import { UUID_RE } from '@/lib/domain/validate'

/**
 * 좌석표 재조회(30초 폴링). 페이지와 같은 게이트를 다시 검사한다 — 액션은 URL 로도 불릴 수 있다.
 * projectId 가 있으면 프로젝트 스튜디오(/p/[id]/agents/office): 형식 검증 → 멤버 검증 → 그 층 하나만.
 */
export async function refreshSeatmap(scope: SeatmapScope = 'mine', projectId?: string): Promise<{ ok: true; seatmap: Seatmap } | { ok: false; error: string }> {
  const actor = await getActorForView()
  if (!actor || !canViewAgents(actor)) return { ok: false, error: '권한이 없습니다.' }
  if (!SEATMAP_SCOPES.includes(scope)) return { ok: false, error: '범위 값이 잘못됐습니다.' } // 액션 인자는 클라이언트 입력이다
  const opts: SeatmapOptions = {}
  if (projectId !== undefined) {
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return { ok: false, error: '프로젝트 값이 잘못됐습니다.' }
    if (!isProjectMember(actor, projectId)) return { ok: false, error: '권한이 없습니다.' }
    opts.projectId = projectId
  }
  try {
    return { ok: true, seatmap: await getSeatmap(actor, Date.now(), scope, opts) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[seatmap] 재조회 실패:', msg)
    return { ok: false, error: '좌석표 재조회에 실패했습니다.' }
  }
}
