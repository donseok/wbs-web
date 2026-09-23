'use client'
// 워커가 스스로 고른 결정 목록(과제 C, 스펙 §7) — 승인 큐·Task 사이드바·오피스 상세가 같이 쓴다. 표시 전용.
// 본문은 에이전트 입력이다: React 텍스트 노드로만 그리고 마크다운·HTML 을 해석하지 않는다.
// 모름을 0건으로 보이지 않는다 — 미제출(null)·형식 오류는 각자 문구로, 0건([])만 아무것도 그리지 않는다.
import { Fragment, useEffect } from 'react'
import type { DecisionsParse } from '@/lib/domain/agentWork'

export const DECISIONS_NONE_TEXT = '결정 목록 미제출(구버전 보고) — 요약을 확인하세요'
export const DECISIONS_INVALID_TEXT = '결정 목록을 읽지 못했습니다 — 요약을 확인하세요'

export function DecisionList({ decisions, compact = false }: { decisions: DecisionsParse; compact?: boolean }) {
  useEffect(() => {
    if (decisions.state === 'invalid') console.error('[DecisionList] 결정 목록 형식 오류 — 저장 값이 앱 검증 규칙을 어긴다')
  }, [decisions.state])

  if (decisions.state === 'none') {
    return <p data-decisions="none" className="mt-1 text-[11px] text-ink-subtle">{DECISIONS_NONE_TEXT}</p>
  }
  if (decisions.state === 'invalid') {
    return <p data-decisions="invalid" className="mt-1 text-[11px] text-accent-warning">{DECISIONS_INVALID_TEXT}</p>
  }
  if (decisions.items.length === 0) return null
  return (
    <section data-decisions="ok" aria-label="에이전트가 적은 결정"
      className={`mt-2 rounded-md border border-line/70 p-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <p className="mb-1 text-[10px] font-semibold text-ink-subtle">에이전트가 적은 결정 {decisions.items.length}건</p>
      <ol className="space-y-2">
        {decisions.items.map(d => (
          <li key={d.key} data-decision={d.key}>
            <p className="text-ink">
              <span className="mr-1.5 font-mono font-semibold">{d.key}</span>
              <span className="whitespace-pre-wrap">{d.question}</span>
            </p>
            <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-6">
              <dt className="text-ink-subtle">택함</dt>
              <dd data-decision-chosen className="whitespace-pre-wrap font-semibold text-ink">{d.options[d.chosen]}</dd>
              {d.options.map((o, i) => i === d.chosen ? null : (
                <Fragment key={i}>
                  <dt className="text-ink-subtle">다른 선택지</dt>
                  <dd data-decision-other className="whitespace-pre-wrap text-ink-muted">{o}</dd>
                </Fragment>
              ))}
              <dt className="text-ink-subtle">근거</dt>
              <dd className="whitespace-pre-wrap text-ink">{d.rationale}</dd>
              <dt className="text-ink-subtle">반려 시</dt>
              <dd className="whitespace-pre-wrap text-ink">{d.on_reject}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  )
}
