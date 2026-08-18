'use client'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { t, type Locale } from '@/lib/i18n/dict'

type ReindexAction = 'status' | 'enqueue' | 'step' | 'repair'

interface StatusResult { pending: number; deadLetter: number; docs: number; chunks: number; embedded: number }
interface StepResult { claimed: number; upserted: number; deleted: number; failed: number; requeued: number; claimFailed?: boolean }
interface RepairResult { scanned: number; repaired: number; stillNull: number }

type RunState =
  | { kind: 'idle' }
  | { kind: 'stepping'; processed: number }
  | { kind: 'repairing'; embedded: number; total: number }
  | { kind: 'done' }
  | { kind: 'quotaExhausted'; remaining: number }
  | { kind: 'failed' }

// 브라우저 주도 루프 상한 — 서버 함수 시간 제한을 피해 클라이언트가 반복 호출한다.
// 값 자체에 특별한 의미는 없고, "언젠가는 끝난다"를 보장하는 안전판이다.
const MAX_STEP_ITERATIONS = 200
const MAX_REPAIR_ITERATIONS = 60
const STEP_INTERVAL_MS = 300
const REPAIR_INTERVAL_MS = 300
const STATUS_REFRESH_EVERY = 5

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callReindex<T>(action: ReindexAction): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await fetch('/api/wiki/reindex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json().catch(() => null) as T | null
    if (data === null) return { ok: false }
    return { ok: true, data }
  } catch {
    return { ok: false }
  }
}

/**
 * 프로젝트 Wiki 색인 수동 갱신 스트립(슈퍼유저 전용). 자동 배치(크론) 를 없앤 뒤
 * "필요할 때 버튼으로" 로 바꾸면서 생겼다 — 서버 함수 시간 제한을 피하려고 enqueue →
 * step 반복 → repair 반복을 브라우저가 직접 도는 루프로 구현한다. 페이지를 떠나면
 * 이 루프는 그냥 끊긴다(별도 취소 처리 없음) — claim/step/repair 는 전부 멱등이라
 * 중간에 끊겨도 다음에 다시 누르면 이어서 처리되므로 무해하다.
 */
export function WikiReindexButton({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const stopRef = useRef(false)

  async function refreshStatus(): Promise<StatusResult | null> {
    const res = await callReindex<StatusResult>('status')
    if (!res.ok) return null
    setStatus(res.data)
    return res.data
  }

  useEffect(() => { void refreshStatus() }, [])

  async function runReindex() {
    if (run.kind === 'stepping' || run.kind === 'repairing') return
    stopRef.current = false
    let chunksTotal = status?.chunks ?? 0

    setRun({ kind: 'stepping', processed: 0 })
    const enqueueRes = await callReindex<{ enqueued: number }>('enqueue')
    if (!enqueueRes.ok) { setRun({ kind: 'failed' }); return }

    let processedTotal = 0
    for (let i = 0; i < MAX_STEP_ITERATIONS; i++) {
      if (stopRef.current) { await refreshStatus(); setRun({ kind: 'idle' }); return }

      const stepRes = await callReindex<StepResult>('step')
      if (!stepRes.ok) { setRun({ kind: 'failed' }); return }
      // claimFailed 는 이번 배치를 아예 잡지 못했다는 뜻 — 처리된 것처럼 위장하지 않고
      // 즉시 중단한다(에러 처리 3원칙: 실패를 숨기지 않는다).
      if (stepRes.data.claimFailed) { setRun({ kind: 'failed' }); return }

      processedTotal += stepRes.data.upserted + stepRes.data.deleted
      setRun({ kind: 'stepping', processed: processedTotal })

      if ((i + 1) % STATUS_REFRESH_EVERY === 0) {
        const fresh = await refreshStatus()
        if (fresh) chunksTotal = fresh.chunks
      }

      if (stepRes.data.claimed === 0) break
      await sleep(STEP_INTERVAL_MS)
    }

    setRun({ kind: 'repairing', embedded: 0, total: chunksTotal })
    let quotaExhausted = false
    let remaining = 0
    for (let i = 0; i < MAX_REPAIR_ITERATIONS; i++) {
      if (stopRef.current) { await refreshStatus(); setRun({ kind: 'idle' }); return }

      const repairRes = await callReindex<RepairResult>('repair')
      if (!repairRes.ok) { setRun({ kind: 'failed' }); return }
      const { repaired, stillNull } = repairRes.data
      setRun({ kind: 'repairing', embedded: Math.max(0, chunksTotal - stillNull), total: chunksTotal })

      if (stillNull === 0) break
      // repaired === 0 인데 stillNull > 0 이면 더 돌아도 안 줄어든다는 뜻 — 무료 한도
      // 소진 신호. 계속 돌면서 "진행 중"으로 위장하지 않고 정직하게 멈춘다.
      if (repaired === 0) { quotaExhausted = true; remaining = stillNull; break }
      await sleep(REPAIR_INTERVAL_MS)
    }

    await refreshStatus()
    setRun(quotaExhausted ? { kind: 'quotaExhausted', remaining } : { kind: 'done' })
  }

  const running = run.kind === 'stepping' || run.kind === 'repairing'
  const statusText = status
    ? t(locale, 'wiki.reindex.status')
        .replace('{docs}', String(status.docs))
        .replace('{pending}', String(status.pending))
        .replace('{embedded}', String(status.embedded))
        .replace('{chunks}', String(status.chunks))
    : null

  // 히어로 카드(항상 다크) 위에 앉으므로 시맨틱 done/delayed 토큰을 쓰지 않는다 —
  // 라이트 테마 값(#138a67·#cb4b5f)이 다크 배경에서 안 보인다. 다크 테마 값을 직접 쓴다.
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-hero-ink-muted">
      {statusText && <span>{statusText}</span>}

      {run.kind === 'stepping' && (
        <span>{t(locale, 'wiki.reindex.running').replace('{n}', String(run.processed))}</span>
      )}
      {run.kind === 'repairing' && (
        <span>
          {t(locale, 'wiki.reindex.repairing')
            .replace('{a}', String(run.embedded))
            .replace('{b}', String(run.total))}
        </span>
      )}
      {run.kind === 'done' && <span className="text-[#34c997]">{t(locale, 'wiki.reindex.done')}</span>}
      {run.kind === 'quotaExhausted' && (
        <span>{t(locale, 'wiki.reindex.quotaExhausted').replace('{n}', String(run.remaining))}</span>
      )}
      {run.kind === 'failed' && <span className="text-[#ff738a]">{t(locale, 'wiki.reindex.failed')}</span>}

      <button
        type="button"
        onClick={() => void runReindex()}
        disabled={running}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-2.5 text-xs text-hero-ink-muted transition hover:bg-white/[0.11] hover:text-hero-ink disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden />
        {t(locale, 'wiki.reindex.button')}
      </button>
      {running && (
        <button
          type="button"
          onClick={() => { stopRef.current = true }}
          className="inline-flex h-7 shrink-0 items-center rounded-full border border-white/15 bg-white/[0.06] px-2.5 text-xs text-hero-ink-muted transition hover:bg-white/[0.11] hover:text-hero-ink"
        >
          {t(locale, 'wiki.reindex.stop')}
        </button>
      )}
    </div>
  )
}
