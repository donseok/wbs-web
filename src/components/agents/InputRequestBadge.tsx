'use client'
// 입력 요청 배지 — 「입력 대기 · 종류」 와 대기 시간(5분을 넘으면 빨강), 처리된 건은 흐린 「처리됨」 글자(계약 (B)).
// 좌석표 응답에는 발췌가 없다. 배지를 눌러 패널을 열 때만 콘솔 보기(getConsoleView)를 한 번 읽어 권한이 있는 사람에게 발췌를 보인다 —
// 새 폴링은 만들지 않는다(재조회는 키를 보낸 뒤 서버가 화면이 바뀌었다고 알려 줄 때뿐이다).
import { useCallback, useRef, useState } from 'react'
import { getConsoleView } from '@/app/actions/agentHub'
import { inputWaitView } from '@/lib/domain/laneSummary'
import type { InputRequestMeta } from '@/lib/domain/watcherExtras'
import { InputRequestPanel, inputRequestOutcome, type InputRequestOutcome } from './InputRequestPanel'
import css from './seatmap.module.css'

type Meta = Pick<InputRequestMeta, 'kind' | 'since' | 'handled'>

function ChipBody({ view }: { view: Extract<ReturnType<typeof inputWaitView>, { state: 'waiting' }> }) {
  return (
    <>
      <i aria-hidden className={css.inDot} />입력 대기 · {view.kindLabel}
      <span data-input-wait="" className={css.inWait}>{view.waitText}</span>
      {view.overdue && <span data-input-overdue-text="" className={css.inWait}> · 5분 넘음</span>}
    </>
  )
}

/** 눌리지 않는 배지 — 책상 카드(그 자체가 버튼이라 안에 버튼을 못 둔다)와 보기 전용 자리에 쓴다. */
export function InputWaitChip({ meta, nowMs }: { meta: Meta; nowMs: number }) {
  const v = inputWaitView(meta, nowMs)
  if (v.state === 'handled') return <span data-input-handled-chip="" className={css.inHandled}>{v.text}</span>
  return (
    <span data-input-badge="" data-input-state="waiting" data-input-overdue={v.overdue ? 'true' : undefined}
      title={v.overdue ? '5분 넘게 답이 없습니다.' : undefined} className={css.inBadge}>
      <ChipBody view={v} />
    </span>
  )
}

/** 눌러서 발췌 패널을 여는 배지. 처리된 건은 흐린 글자만 있고 열지 않는다. */
export function InputRequestBadge({ seatKey, meta, nowMs }: { seatKey: string; meta: Meta; nowMs: number }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState<InputRequestOutcome | null>(null)
  const seqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    let next: InputRequestOutcome
    try { next = inputRequestOutcome(await getConsoleView(seatKey)) } catch (e) {
      next = { kind: 'message', text: e instanceof Error ? e.message : String(e), tone: 'error' }
    }
    if (seqRef.current !== seq) return
    setOutcome(next); setLoading(false)
  }, [seatKey])

  const v = inputWaitView(meta, nowMs)
  if (v.state === 'handled') return <span data-input-handled-chip="" className={css.inHandled}>{v.text}</span>
  return (
    <div data-input-request-slot="" className={css.inSlot}>
      <button type="button" data-input-badge="" data-input-state="waiting" data-input-overdue={v.overdue ? 'true' : undefined}
        aria-expanded={open} title={v.overdue ? '5분 넘게 답이 없습니다. 눌러서 발췌를 봅니다.' : '눌러서 발췌를 봅니다.'}
        className={`${css.inBadge} ${css.inBadgeBtn}`}
        onClick={() => { if (open) { seqRef.current++; setOpen(false); setLoading(false) } else { setOpen(true); void load() } }}>
        <ChipBody view={v} />
      </button>
      {open && (
        <div data-input-panel="" className={css.inPanel}>
          {loading && outcome === null && <p data-input-loading="" className={css.inMuted}>발췌를 읽는 중입니다.</p>}
          {outcome?.kind === 'message' && <p data-input-message={outcome.tone} role={outcome.tone === 'error' ? 'alert' : 'status'} className={outcome.tone === 'error' ? css.inErr : css.inMuted}>{outcome.text}</p>}
          {outcome?.kind === 'panel' && <InputRequestPanel seatKey={seatKey} request={outcome.request} canSend={outcome.canSend} onSent={() => { void load() }} />}
        </div>
      )}
    </div>
  )
}
