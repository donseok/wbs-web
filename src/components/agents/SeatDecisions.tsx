'use client'
// 오피스 상세 패널의 결정 목록(과제 C, 스펙 §7.3) — 결재 대기 좌석이 열릴 때 좁은 조회를 한 번 한다.
// 실패는 빈 목록으로 그리지 않는다(3원칙) — 문구와 재시도를 보인다.
import { useEffect, useState } from 'react'
import { getReportDecisions } from '@/app/actions/agentWork'
import { parseDecisions, type DecisionsParse } from '@/lib/domain/agentWork'
import { DecisionList } from '@/components/agent-hub/DecisionList'

type Load = { kind: 'loading' } | { kind: 'ok'; parsed: DecisionsParse } | { kind: 'error' }

export function SeatDecisions({ orderId }: { orderId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setLoad({ kind: 'loading' })
    getReportDecisions(orderId)
      .then(r => {
        if (!alive) return
        if (r.ok) { setLoad({ kind: 'ok', parsed: parseDecisions(r.decisions) }); return }
        console.error('[SeatDecisions] 결정 목록 조회 실패:', r.error)
        setLoad({ kind: 'error' })
      })
      .catch((e: unknown) => {
        if (!alive) return
        console.error('[SeatDecisions] 결정 목록 조회 실패:', e instanceof Error ? e.message : e)
        setLoad({ kind: 'error' })
      })
    return () => { alive = false }
  }, [orderId, attempt])

  if (load.kind === 'loading') return <p data-seat-decisions-loading="" className="mt-2 text-[11px] text-ink-subtle">결정 목록을 불러오는 중…</p>
  if (load.kind === 'error') {
    return (
      <p data-seat-decisions-error="" className="mt-2 text-[11px] text-accent-warning">
        결정 목록을 불러오지 못했습니다{' '}
        <button type="button" data-seat-decisions-retry="" className="underline underline-offset-2" onClick={() => setAttempt(a => a + 1)}>다시 시도</button>
      </p>
    )
  }
  return <DecisionList decisions={load.parsed} compact />
}
