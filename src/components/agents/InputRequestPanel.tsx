'use client'
// 입력 요청 발췌 + 웹에서 답하기(키 입력) — 레인 행의 배지 패널과 콘솔 패널이 같이 쓴다(계약 lane-summary-contract (B)(C)).
// 발췌는 터미널 화면의 일부라 서버가 열람 권한이 있는 사람에게만 준다. 답하기 버튼은 세션을 띄운 본인이고, 발췌가 보이며,
// 아직 처리되지 않은 permission·question·choice 요청일 때만 눌린다. 여기의 판정은 어포던스이고 최종 판정은 서버가 한다.
import { useState } from 'react'
import { sendConsoleKeys, type ConsoleViewResult } from '@/app/actions/agentHub'
import {
  CONSOLE_ANSWERABLE_KINDS, CONSOLE_KEYS, CONSOLE_KEYS_MAX, type ConsoleInputRequestView, type ConsoleKey,
} from '@/lib/domain/agentConsole'
import { inputKindLabel, inputWaitView } from '@/lib/domain/laneSummary'
import { showableTerminalLine } from '@/lib/domain/safeDisplay'
import css from './seatmap.module.css'

type KeysCode = Extract<Awaited<ReturnType<typeof sendConsoleKeys>>, { ok: false }>['code']

/** 키 순서 규칙 안내 — 확정 키를 쌓았을 때와 서버가 bad_keys 로 거절했을 때 같은 문장을 보인다. */
export const KEYS_RULE_TEXT = '확정 키(숫자·Enter·Esc)와 Tab 은 마지막에 하나만 보낼 수 있습니다. 더 답하려면 화면이 바뀐 뒤 다시 보내세요.'

/** 결과 코드마다 보이는 안내 — 서버 문장을 그대로 믿지 않고 화면이 고정된 말로 안내한다. */
export const KEYS_RESULT_TEXT: Record<KeysCode, string> = {
  unauthorized: '로그인이 필요합니다.',
  bad_target: '키를 보낼 수 있는 세션이 아닙니다.',
  bad_keys: KEYS_RULE_TEXT,
  target_unknown: '이 세션이 지금 오피스에 없습니다. 세션이 다시 신호를 보내면 답할 수 있습니다.',
  not_owner: '답하기는 세션을 띄운 본인만 할 수 있습니다.',
  no_request: '답할 입력 요청이 없습니다. 이미 처리되었을 수 있습니다.',
  not_answerable: '이 종류의 입력 요청에는 웹에서 답할 수 없습니다.',
  prompt_changed: '창이 바뀌어 보내지 않았습니다. 최신 화면을 확인하세요.',
  already_sent: '같은 화면에는 이미 답했습니다.',
  rate_limited: '짧은 시간에 너무 많이 보냈습니다. 잠시 뒤에 다시 보내세요.',
  queue_full: '아직 전달되지 않은 요청이 쌓여 있습니다. 전달된 뒤에 다시 보내세요.',
  error: '키를 보내지 못했습니다.',
}

const KEY_LABEL: Record<ConsoleKey, string> = { Up: '↑', Down: '↓', Esc: 'Esc', Enter: 'Enter', Tab: 'Tab', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9' }
const KEY_ARIA: Partial<Record<ConsoleKey, string>> = { Up: '위쪽 화살표', Down: '아래쪽 화살표' }

// ── 키 순서 규칙(서버가 강제하는 것과 같은 규칙을 화면이 미리 안내한다 — 최종 판정은 서버다) ──
/** 앞자리에 올 수 있는 키 — 이동 키 Up·Down 뿐이다. 그 밖의 키(숫자·Enter·Esc·Tab)는 마지막 자리에 하나만 온다. */
const LEADING_KEYS: readonly ConsoleKey[] = ['Up', 'Down']
/** 마지막 자리 전용 키 — 숫자·Enter·Esc(확정 키)와 Tab. 쌓이면 이후 모든 키가 막힌다. */
export function isFinalKey(k: ConsoleKey): boolean {
  return CONSOLE_KEYS.includes(k) && !LEADING_KEYS.includes(k)
}
/** 쌓은 목록이 규칙에 맞는가 — 1~최대 개수, 앞자리는 Up·Down 뿐, 마지막 자리는 허용 키 아무거나(Up·Down 만 있는 배열도 된다). */
export function isValidKeySequence(keys: readonly ConsoleKey[]): boolean {
  if (keys.length < 1 || keys.length > CONSOLE_KEYS_MAX) return false
  return keys.every((k, i) => CONSOLE_KEYS.includes(k) && (i === keys.length - 1 || LEADING_KEYS.includes(k)))
}
/** 이 키를 더 쌓을 수 있는가 — 마지막 자리 전용 키가 이미 쌓였으면 모두 막고, 개수 상한에서도 막는다. */
export function canAddKey(keys: readonly ConsoleKey[], k: ConsoleKey): boolean {
  if (!CONSOLE_KEYS.includes(k) || keys.length >= CONSOLE_KEYS_MAX) return false
  return !keys.some(isFinalKey)
}

export function isAnswerableKind(kind: string): boolean {
  return (CONSOLE_ANSWERABLE_KINDS as readonly string[]).includes(kind)
}

/** 콘솔 보기 응답에서 입력 요청 칸을 읽는다 — 패널로 그릴지, 안내 문장만 보일지, 보일 것이 없는지(none). */
export type InputRequestOutcome =
  | { kind: 'panel'; request: ConsoleInputRequestView; canSend: boolean }
  | { kind: 'message'; text: string; tone: 'error' | 'muted' }
export function inputRequestOutcome(r: ConsoleViewResult): InputRequestOutcome {
  if (!r.ok) return { kind: 'message', text: r.error, tone: 'error' }
  if (r.inputRequestError) return { kind: 'message', text: r.inputRequestError, tone: 'error' }
  if (r.inputRequest === undefined) return { kind: 'message', text: '발췌를 볼 권한이 없습니다.', tone: 'muted' }
  if (r.inputRequest === null) return { kind: 'message', text: '입력 요청이 이미 사라졌습니다.', tone: 'muted' }
  return { kind: 'panel', request: r.inputRequest, canSend: r.canSend }
}

/**
 * 발췌와 답하기 키. 입력 요청이 바뀌면(since·발췌 해시) 쌓아 둔 키와 보낸 표시를 버리도록 그 값으로 key 를 준다 —
 * 지난 창에 쌓은 키가 새 창에 섞여 나가지 않는다.
 */
export function InputRequestPanel(props: { seatKey: string; request: ConsoleInputRequestView; canSend: boolean; onSent?: () => void }) {
  const r = props.request
  return <PanelInner key={`${r.since}:${r.sha}`} {...props} />
}

function PanelInner({ seatKey, request, canSend, onSent }: { seatKey: string; request: ConsoleInputRequestView; canSend: boolean; onSent?: () => void }) {
  const [keys, setKeys] = useState<ConsoleKey[]>([])
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const handled = request.handled
  const answerable = handled === null && isAnswerableKind(request.kind)
  const locked = !answerable || sending || done
  const handledView = handled ? inputWaitView({ kind: request.kind, since: request.since, handled }, 0) : null

  const send = async () => {
    if (!isValidKeySequence(keys) || locked) return
    setSending(true); setResult(null)
    let ok = false
    let text: string
    let refresh = false
    try {
      const res = await sendConsoleKeys(seatKey, { kind: request.kind, since: request.since, sha: request.sha }, keys)
      if (res.ok) { ok = true; text = '키를 보냈습니다. 같은 화면에는 다시 답할 수 없습니다.'; refresh = true }
      else {
        text = KEYS_RESULT_TEXT[res.code] ?? KEYS_RESULT_TEXT.error
        // 이미 답했거나 창이 바뀐 경우에는 최신 화면을 다시 읽어 오래된 발췌를 두지 않는다.
        refresh = res.code === 'prompt_changed' || res.code === 'no_request' || res.code === 'already_sent'
        if (res.code === 'already_sent') setDone(true)
      }
    } catch (e) {
      text = e instanceof Error ? e.message : String(e)
    }
    setSending(false)
    if (ok) { setDone(true); setKeys([]) }
    setResult({ ok, text })
    if (refresh) onSent?.()
  }

  return (
    <section data-input-request="" data-input-kind={request.kind} className={css.inReq}>
      <h4 className={css.inReqHead}>입력 요청 · {inputKindLabel(request.kind)}</h4>
      {request.excerpt.length > 0
        ? <pre data-input-excerpt="" tabIndex={0} aria-label="입력 요청 발췌" className={`${css.inExcerpt} ${css.termPre}`}>{request.excerpt.map(showableTerminalLine).join('\n')}</pre>
        : <p data-input-excerpt-empty="" className={css.inMuted}>발췌가 비어 있습니다.</p>}
      {handledView && handledView.state === 'handled' && <p data-input-handled="" className={css.inMuted}>이미 처리된 요청입니다. {handledView.text}</p>}
      {!canSend ? (
        <p data-input-owner-only="" className={css.inMuted}>답하기는 세션을 띄운 본인만 할 수 있습니다.</p>
      ) : (
        <div data-input-answer="" className={css.inAnswer}>
          {!answerable && !handled && <p data-input-not-answerable="" className={css.inMuted}>{KEYS_RESULT_TEXT.not_answerable}</p>}
          <div role="group" aria-label="답하기 키" className={css.inKeys}>
            {CONSOLE_KEYS.map(k => (
              <button key={k} type="button" data-console-key={k} aria-label={KEY_ARIA[k]} className={css.inKey}
                disabled={locked || !canAddKey(keys, k)} onClick={() => setKeys(prev => (canAddKey(prev, k) ? [...prev, k] : prev))}>
                {KEY_LABEL[k]}
              </button>
            ))}
          </div>
          <p data-input-queue="" className={css.inQueue}>
            {keys.length > 0 ? `쌓인 키(${keys.length}/${CONSOLE_KEYS_MAX}): ${keys.map(k => KEY_LABEL[k]).join(' → ')}` : `쌓인 키가 없습니다. 최대 ${CONSOLE_KEYS_MAX}개까지 순서대로 쌓아 한 번에 보냅니다.`}
          </p>
          {keys.some(isFinalKey) && <p data-input-keys-rule="" className={css.inMuted}>{KEYS_RULE_TEXT}</p>}
          <div className={css.inActions}>
            <button type="button" data-input-clear="" className={css.inKey} disabled={locked || keys.length === 0} onClick={() => setKeys([])}>지우기</button>
            <button type="button" data-input-send="" className={css.inSend} disabled={locked || !isValidKeySequence(keys)} onClick={() => { void send() }}>
              {sending ? '보내는 중…' : '보내기'}
            </button>
          </div>
          {result && <p data-input-result={result.ok ? 'ok' : 'error'} role={result.ok ? 'status' : 'alert'} className={result.ok ? css.inMuted : css.inErr}>{result.text}</p>}
        </div>
      )}
    </section>
  )
}
