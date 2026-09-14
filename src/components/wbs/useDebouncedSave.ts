'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * 상세 패널의 토글·select 저장 지연 시간. 마지막 변경 뒤 이 시간이 지나면 모아 둔 변경을 한 번에 저장한다.
 * 5초는 사용자가 제안한 값이다(인계자 체감은 3초). 닫기·이동 시 flush 와 대기 표시가 있으므로
 * 값을 바꿔도 잃어버리는 변경은 없다 — 여기 한 곳만 고치면 된다.
 */
export const SAVE_DEBOUNCE_MS = 5000

export type SaveResult = { ok: boolean; error?: string }

/**
 * 즉시 저장하던 토글·select 를 debounce 로 묶는 공용 훅(2026-09-14).
 *
 * 왜: 체크박스 하나가 바뀔 때마다 서버 액션 + router.refresh() 가 나가 WBS 페이지 전체(로더 8개,
 * 220행 롤업)가 다시 렌더됐다(스테이징 실측 refresh 1회 ≈ 0.5초·RSC 132KB). 변경을 모았다가
 * 한 번에 저장하고 refresh 는 flush 당 1회만 부른다.
 *
 * 계약:
 * - `set(key, value)` 는 낙관 표시만 바꾸고 타이머를 재시작한다. baseline 과 같은 값이면 대기에서 뺀다
 *   (위임 on 뒤 off 는 저장하지 않는다). 같은 필드를 여러 번 바꾸면 마지막 값만 남는다.
 * - flush 는 대기 필드를 삽입 순서대로 **직렬** 호출한다. Next 앱 라우터가 서버 액션을 직렬 큐로
 *   실행하므로 Promise.all 로 묶어도 병렬이 되지 않는다 — 순서를 우리가 정하는 편이 낫다.
 * - 실행 thunk 는 `set` 시점의 `commit[key]` 를 잡아 둔다. itemId 가 바뀌어도 변경은 원래 항목에 저장된다.
 * - 언마운트·scope 변경·pagehide·beforeunload 에서는 **분리(detached) flush** — 서버에는 쓰되 이미
 *   사라진 패널의 상태 콜백(onSaved/onFailed)은 부르지 않고, 실패는 console.error 로 남긴다
 *   (표시 = 로깅 원칙 — 표시할 곳이 없으면 최소한 로그로). onFlushed 는 detached 플래그와 함께 부른다.
 * - 저장 중 같은 필드가 다시 바뀌면 그 값은 남겨 두었다가 다음 사이클에 저장한다.
 */
export function useDebouncedSave<T extends Record<string, unknown>, R extends SaveResult = SaveResult>(opts: {
  /** 변경이 속한 항목(itemId). 바뀌면 이전 항목의 대기분을 분리 flush 한다. */
  scope: string
  /** 서버 확정 값. 아직 로드 전이면 null — 그동안은 모든 set 이 대기로 들어간다. */
  baseline: T | null
  /** 필드별 저장 실행. 서버 액션 시그니처는 그대로 두고 여기서 감싼다. */
  commit: { [K in keyof T]: (value: T[K]) => Promise<R> }
  /** 필드 하나가 저장됐다(패널이 baseline/loaded 를 갱신하는 자리). 분리 flush 에서는 부르지 않는다. */
  onSaved?: (key: keyof T, value: T[keyof T], res: R) => void
  /** 필드 하나가 실패했다. 대기에서 이미 빠져 view 는 baseline 으로 돌아가 있다. 분리 flush 에서는 부르지 않는다. */
  onFailed?: (key: keyof T, value: T[keyof T], error: string) => void
  /** flush 하나가 끝났고 성공한 필드가 하나 이상 있다 — router.refresh() 를 여기서 1회. */
  onFlushed?: (info: { saved: (keyof T)[]; detached: boolean }) => void
  delayMs?: number
}) {
  const { scope, baseline, delayMs = SAVE_DEBOUNCE_MS } = opts
  type Key = keyof T
  type Entry = { value: T[Key]; run: () => Promise<R> }

  // 최신 콜백·baseline — set/flush 는 이벤트·타이머에서 불리므로 렌더 클로저 대신 ref 로 읽는다.
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  const pendingRef = useRef<Map<Key, Entry>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  // 세대 — scope 변경·언마운트마다 올린다. 진행 중이던 flush 는 세대가 다르면 상태 콜백을 건너뛴다.
  const genRef = useRef(0)
  const scopeRef = useRef(scope)

  const [pending, setPending] = useState<Partial<T>>({})
  const [saving, setSaving] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(0)

  const syncPending = useCallback(() => {
    const next: Partial<T> = {}
    for (const [k, e] of pendingRef.current) next[k] = e.value
    setPending(next)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    setDeadline(null)
  }, [])

  /**
   * 스냅샷 하나를 순서대로 저장한다. attachedGen 이 현재 세대와 같을 때만 패널 콜백을 부른다.
   * 반환은 성공한 키 목록.
   */
  const runSnapshot = useCallback(async (snapshot: [Key, Entry][], attachedGen: number): Promise<Key[]> => {
    const saved: Key[] = []
    for (const [key, entry] of snapshot) {
      const attached = genRef.current === attachedGen
      // 그 사이 baseline 이 같은 값으로 바뀌었으면(재조회 등) 쓸 이유가 없다.
      const base = optsRef.current.baseline
      if (attached && base && Object.is(base[key], entry.value)) {
        if (pendingRef.current.get(key) === entry) pendingRef.current.delete(key)
        continue
      }
      let res: R
      try {
        res = await entry.run()
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) } as R
      }
      // 저장 중 같은 필드가 다시 바뀌었으면 새 값은 남긴다.
      if (pendingRef.current.get(key) === entry) pendingRef.current.delete(key)
      const stillAttached = genRef.current === attachedGen
      if (res.ok) {
        saved.push(key)
        if (stillAttached) optsRef.current.onSaved?.(key, entry.value, res)
      } else {
        // 메시지가 비면 빈 문자열 — 기본 문구는 패널이 고른다(액션마다 실패 문구 키가 다르다).
        const message = res.error ?? ''
        if (stillAttached) optsRef.current.onFailed?.(key, entry.value, message)
        else console.error(`[useDebouncedSave] 분리 flush 실패 (${String(key)}):`, message || '(메시지 없음)')
      }
    }
    return saved
  }, [])

  const scheduleRef = useRef<() => void>(() => {})

  /** 현재 대기분을 flush 한다. 이미 진행 중이면 끝난 뒤 남은 대기분을 다시 flush 한다. */
  const flush = useCallback(async (): Promise<void> => {
    // 진행 중인 flush 가 있으면 기다린다 — 두 flush 가 같은 필드를 겹쳐 쓰지 않도록.
    while (inFlightRef.current) await inFlightRef.current
    if (pendingRef.current.size === 0) return
    clearTimer()
    const snapshot = [...pendingRef.current.entries()]
    const gen = genRef.current
    setSaving(true)
    const run = (async () => {
      try {
        const saved = await runSnapshot(snapshot, gen)
        if (saved.length > 0) optsRef.current.onFlushed?.({ saved, detached: false })
      } finally {
        inFlightRef.current = null
        if (genRef.current === gen) {
          setSaving(false)
          syncPending()
          // 저장 중 들어온 변경이 남아 있으면 다음 사이클을 건다.
          if (pendingRef.current.size > 0) scheduleRef.current()
        }
      }
    })()
    inFlightRef.current = run
    await run
  }, [clearTimer, runSnapshot, syncPending])

  const schedule = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    const at = Date.now()
    setNow(at)
    setDeadline(at + delayMs)
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush() }, delayMs)
  }, [delayMs, flush])
  useEffect(() => { scheduleRef.current = schedule }, [schedule])

  const set = useCallback(<K extends Key>(key: K, value: T[K]) => {
    const base = optsRef.current.baseline
    if (base && Object.is(base[key], value)) {
      pendingRef.current.delete(key)
      syncPending()
      if (pendingRef.current.size === 0) clearTimer()
      return
    }
    // commit 은 set 시점의 것을 잡아 둔다 — scope 가 바뀌어도 이 변경은 원래 항목에 저장된다.
    const fn = optsRef.current.commit[key]
    pendingRef.current.set(key, { value, run: () => fn(value) })
    syncPending()
    schedule()
  }, [clearTimer, schedule, syncPending])

  /**
   * 대기분을 패널에서 떼어 내 저장한다 — 패널이 닫히거나 항목이 바뀌거나 페이지를 떠날 때.
   * 상태 콜백은 부르지 않고(패널은 이미 없다) onFlushed 만 detached 로 알린다.
   */
  const flushDetached = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    if (pendingRef.current.size === 0) return
    const snapshot = [...pendingRef.current.entries()]
    pendingRef.current.clear()
    genRef.current += 1
    const prev = inFlightRef.current
    void (async () => {
      if (prev) await prev
      const saved = await runSnapshot(snapshot, -1)
      if (saved.length > 0) optsRef.current.onFlushed?.({ saved, detached: true })
    })()
  }, [runSnapshot])

  // scope(itemId) 변경 — 이전 항목의 대기분을 분리 flush 하고 표시 상태를 비운다.
  useEffect(() => {
    if (scopeRef.current === scope) return
    scopeRef.current = scope
    flushDetached()
    genRef.current += 1
    setPending({}); setSaving(false); setDeadline(null)
  }, [scope, flushDetached])

  // 언마운트(패널 닫힘·다른 페이지로 이동) — 대기분을 분리 flush.
  useEffect(() => () => { flushDetached(); genRef.current += 1 }, [flushDetached])

  // 페이지를 떠날 때 — 대기 중일 때만 리스너를 건다.
  const isPending = Object.keys(pending).length > 0
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

  // 카운트다운 — 대기 중에만 1초 간격으로 now 를 갱신한다.
  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])

  const remainingMs = deadline === null ? null : Math.max(0, deadline - now)

  const view = useMemo<T | null>(
    () => (baseline ? { ...baseline, ...pending } : null),
    [baseline, pending],
  )

  return { view, pending, isPending, saving, remainingMs, set, flush }
}
