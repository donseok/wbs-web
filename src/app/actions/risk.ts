'use server'
// 위험 신호 AI 해설 서버 액션 — 지문 게이트 self-heal(D2)의 서버 종단.
// 클라이언트가 보낸 신호/지문은 절대 믿지 않는다: 서버에서 loadProjectFacts →
// detectRiskSignals 로 리포트를 재계산한 뒤 ensureRiskBrief 에 넘긴다.
// 세션+멤버십 fail-closed(무료 쿼터 보호).
import { getMembership, getSession } from '@/lib/auth'
import { loadProjectFacts } from '@/lib/ai/projectFacts'
import { detectRiskSignals } from '@/lib/domain/riskSignals'
import { ensureRiskBrief, sanitizeRiskItems, type RiskBriefItem } from '@/lib/ai/risk-brief'
import { getAiBrief } from '@/lib/data/aiBriefs'

export interface RiskBriefPayload {
  status: 'ready' | 'generated' | 'unavailable'
  headline?: string
  items?: RiskBriefItem[]
  updatedAt?: string
  /** 반환 시점 기준 서버 재계산 지문과 캐시가 일치하는가. */
  fresh?: boolean
}

export async function ensureRiskBriefAction(projectId: string): Promise<RiskBriefPayload> {
  const m = await getMembership()
  if (!m) return { status: 'unavailable' }
  const user = await getSession()
  if (!user) return { status: 'unavailable' }
  try {
    const src = await loadProjectFacts(projectId)
    if (!src) return { status: 'unavailable' }
    const report = detectRiskSignals({
      items: src.items,
      today: src.todayWbs,
      realToday: src.realToday,
      snapshots: src.snapshots,
      startDate: src.startDate,
      endDate: src.endDate,
      minuteSignals: src.minuteSignals,
    })
    const status = await ensureRiskBrief(projectId, report)
    const row = await getAiBrief(projectId, 'risk', '')
    if (!row) return { status: status === 'ready' ? 'unavailable' : status }
    return {
      status,
      headline: row.headline,
      items: sanitizeRiskItems(row.items),
      updatedAt: row.updatedAt,
      fresh: row.inputHash === report.fingerprint,
    }
  } catch (e) {
    console.error('[risk-brief] ensureRiskBriefAction 실패:', e instanceof Error ? e.message : e)
    return { status: 'unavailable' }
  }
}
