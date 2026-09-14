'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 허브 위임 체크의 저장 지연. 마지막 체크 뒤 이 시간이 지나면 모아 둔 변경을 한 번에 보낸다.
 * 허브는 여러 행을 연달아 체크하는 조작 화면이라 WBS 상세(5초)보다 짧다. 체크 표시는 즉시 바뀌고
 * 잠기지 않으므로 이 값은 "서버 확정이 얼마나 늦어지는가"만 정한다.
 */
export const HUB_SAVE_DEBOUNCE_MS = 1500

export type PendingChange = { itemId: string; delegated: boolean }

/**
 * 허브 표의 위임 체크를 모았다가 묶음 1건으로 저장하는 훅(2026-09-14 체크 지연 개선).
 *
 * 왜: 체크 하나마다 액션 2건이 직렬로 나가고 그동안 체크박스가 잠겼다(스테이징 실측 0.8~1.0초).
 * 체크는 낙관 표시만 바꾸고, 마지막 체크 뒤 HUB_SAVE_DEBOUNCE_MS 가 지나면 대기분 전부를 commit 1회로 보낸다.
 *
 * 계약:
 * - `set(id, v)` 는 기준값과 같으면 대기에서 빼고(켰다 끄면 저장 안 함), 다르면 대기에 넣고 타이머를 재시작한다.
 *   기준값은 "지금 서버로 보내는 중인 값"이 있으면 그것, 없으면 serverValues 다 — 저장 중에 되돌린 체크가
 *   저장 완료 뒤 사라지지 않게 하기 위해서다(보낸 값 ≠ 새 값이면 다음 묶음에 실린다).
 * - `value(id)` = 대기값 ?? 서버값. 저장 중인 값도 대기에 남아 있어 화면이 흔들리지 않는다.
 * - serverValues 가 바뀌면(응답·새로고침) 같은 값이 된 대기분은 버린다.
 * - 저장 결과는 onResult 로 넘기고 대기 정리만 여기서 한다. commit 이 throw 하면 보낸 항목을 대기에서 빼서
 *   서버값으로 되돌리고 onError 로 알린다(표시 = 로깅).
 * - 언마운트·pagehide·beforeunload 에서는 분리(detached) 저장 — 서버에는 쓰되 콜백은 부르지 않고 실패는 console.error.
 */
export function usePendingDelegations<R>(opts: {
  /** 서버 확정 값(리프 itemId → delegated). rows 에서 useMemo 로 만들어 넘긴다. */
  serverValues: ReadonlyMap<string, boolean>
  commit: (changes: PendingChange[]) => Promise<R>
  onResult: (res: R, sent: PendingChange[]) => void
  onError?: (message: string, sent: PendingChange[]) => void
  delayMs?: number
}) {
  const { serverValues, delayMs = HUB_SAVE_DEBOUNCE_MS } = opts
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  const pendingRef = useRef<Map<string, boolean>>(new Map())
  const sendingRef = useRef<Map<string, boolean>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const genRef = useRef(0)

  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [saving, setSaving] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(0)

  const syncPending = useCallback(() => setPending(new Map(pendingRef.current)), [])
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    setDeadline(null)
  }, [])

  const scheduleRef = useRef<() => void>(() => {})

  const flush = useCallback(async (): Promise<void> => {
    while (inFlightRef.current) await inFlightRef.current
    if (pendingRef.current.size === 0) return
    clearTimer()
    const sent: PendingChange[] = [...pendingRef.current].map(([itemId, delegated]) => ({ itemId, delegated }))
    sendingRef.current = new Map(pendingRef.current)
    const gen = genRef.current
    setSaving(true)
    const run = (async () => {
      let res: R | undefined
      let err: string | null = null
      try { res = await optsRef.current.commit(sent) } catch (e) { err = e instanceof Error ? e.message : String(e) }
      // 보낸 값이 그대로면 대기에서 뺀다. 저장 중 다시 바뀐 항목은 남겨 다음 묶음에 싣는다.
      for (const c of sent) if (pendingRef.current.get(c.itemId) === c.delegated) pendingRef.current.delete(c.itemId)
      sendingRef.current = new Map()
      const attached = genRef.current === gen
      if (err !== null) {
        if (attached) optsRef.current.onError?.(err, sent)
        else console.error('[usePendingDelegations] 분리 저장 실패:', err)
      } else if (attached) {
        optsRef.current.onResult(res as R, sent)
      }
    })().finally(() => {
      inFlightRef.current = null
      if (genRef.current === gen) {
        setSaving(false)
        syncPending()
        if (pendingRef.current.size > 0) scheduleRef.current()
      }
    })
    inFlightRef.current = run
    await run
  }, [clearTimer, syncPending])

  const schedule = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    const at = Date.now()
    setNow(at)
    setDeadline(at + delayMs)
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, delayMs)
  }, [delayMs, flush])
  useEffect(() => { scheduleRef.current = schedule }, [schedule])

  const setMany = useCallback((entries: Iterable<readonly [string, boolean]>) => {
    for (const [id, v] of entries) {
      const base = sendingRef.current.has(id) ? sendingRef.current.get(id) : optsRef.current.serverValues.get(id)
      if (base === v) pendingRef.current.delete(id)
      else pendingRef.current.set(id, v)
    }
    syncPending()
    if (pendingRef.current.size === 0) clearTimer()
    else schedule()
  }, [clearTimer, schedule, syncPending])
  const set = useCallback((id: string, v: boolean) => setMany([[id, v]]), [setMany])

  // 서버값이 바뀌면(응답·새로고침) 같은 값이 된 대기분은 쓸 이유가 없다.
  useEffect(() => {
    let changed = false
    for (const [id, v] of pendingRef.current) {
      if (sendingRef.current.has(id)) continue
      if (serverValues.get(id) === v) { pendingRef.current.delete(id); changed = true }
    }
    if (!changed) return
    syncPending()
    if (pendingRef.current.size === 0) clearTimer()
  }, [serverValues, syncPending, clearTimer])

  /** 대기분을 화면에서 떼어 내 저장한다 — 언마운트·페이지 이탈. 콜백은 부르지 않는다. */
  const flushDetached = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    if (pendingRef.current.size === 0) return
    const sent: PendingChange[] = [...pendingRef.current].map(([itemId, delegated]) => ({ itemId, delegated }))
    pendingRef.current.clear()
    genRef.current += 1
    const prev = inFlightRef.current
    void (async () => {
      if (prev) await prev
      try { await optsRef.current.commit(sent) } catch (e) {
        console.error('[usePendingDelegations] 분리 저장 실패:', e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  useEffect(() => () => { flushDetached(); genRef.current += 1 }, [flushDetached])

  const isPending = pending.size > 0
  useEffect(() => {
    if (!isPending) return
    const onLeave = () => flushDetached()
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('beforeunload', onLeave)
    }
  }, [isPending, flushDetached])

  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])

  const remainingMs = deadline === null ? null : Math.max(0, deadline - now)
  const value = useCallback((id: string): boolean => pending.get(id) ?? serverValues.get(id) ?? false, [pending, serverValues])
  const count = useMemo(() => pending.size, [pending])

  return { value, set, setMany, flush, pending, isPending, count, saving, remainingMs }
}
