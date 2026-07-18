'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ensureRiskBriefAction, type RiskBriefPayload } from '@/app/actions/risk'

/**
 * 위험 신호 AI 해설 — 통합 카드(D1)의 신호 목록 하단부. 지문 게이트 self-heal(D2):
 * 서버가 내려준 캐시가 stale/부재일 때만 마운트 1회 재생성 액션을 부른다(지문 일치 열람 = 0콜).
 * 신호 0건이면 해설 대상이 없으므로 액션 자체를 부르지 않는다(쿼터 절약).
 *
 * 렌더는 순수 텍스트만(인젝션 차단). 실패는 정직한 강등 문구 — 결정형 신호 목록은
 * LLM 과 무관하게 항상 정확하다는 사실을 함께 안내한다(조용한 빈 섹션 금지).
 */

export interface RiskBriefItemView {
  signalId: string
  priority: number
  comment: string
  action: string
}

export interface RiskBriefInitial {
  headline: string
  items: RiskBriefItemView[]
  fresh: boolean
  status: 'ready' | 'none'
}

export function RiskBriefNotes({ projectId, signalCount, signalTitles, initial }: {
  projectId: string
  signalCount: number
  /** signalId → 카드 목록의 제목(해설 항목을 신호 행과 대조 가능하게). */
  signalTitles: Record<string, string>
  initial: RiskBriefInitial | null
}) {
  const freshReady = !!initial && initial.fresh && initial.status === 'ready'
  const [brief, setBrief] = useState<RiskBriefInitial | null>(freshReady ? initial : null)
  const [state, setState] = useState<'idle' | 'healing' | 'failed'>('idle')
  const healed = useRef(false)

  // 지문 게이트 self-heal — stale/부재 + 신호 존재 시에만 1회(D2 확정 트리거 정책)
  useEffect(() => {
    if (freshReady || signalCount === 0 || healed.current) return
    healed.current = true
    setState('healing')
    ensureRiskBriefAction(projectId)
      .then((r: RiskBriefPayload) => {
        if (r.status === 'unavailable' || !r.items) { setState('failed'); return }
        setBrief({ headline: r.headline ?? '', items: r.items, fresh: r.fresh ?? true, status: 'ready' })
        setState('idle')
      })
      .catch(e => {
        console.error('[risk-brief] self-heal 요청 실패:', e)
        setState('failed')
      })
  }, [freshReady, signalCount, projectId])

  if (signalCount === 0) return null // 해설 대상 없음 — 무신호 문구는 카드 본문이 담당

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2/40 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink">AI 해설</span>
        <span className="chip bg-surface-2 text-ink-subtle">신호가 바뀔 때만 재생성</span>
      </div>

      {state === 'healing' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> AI 해설 생성 중…
        </p>
      )}

      {state === 'failed' && (
        <p className="mt-2 text-xs leading-5 text-ink-muted">
          AI 해설을 지금 생성할 수 없습니다 — 위 신호 목록은 규칙 기반으로 항상 정확합니다. 잠시 후 다시 열람하면 재시도됩니다.
        </p>
      )}

      {state === 'idle' && brief && (
        <div className="mt-2 space-y-2">
          {brief.headline && <p className="text-xs font-semibold text-ink">{brief.headline}</p>}
          {brief.items.map(it => (
            <div key={it.signalId} className="text-xs leading-5">
              <p className="text-ink">
                <span className="font-semibold">{it.priority}. {signalTitles[it.signalId] ?? it.signalId}</span>
                {it.comment ? ` — ${it.comment}` : ''}
              </p>
              {it.action && <p className="pl-3 text-ink-muted">→ {it.action}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
