'use client'

// 개발 워크플로 크레딧 슬라이더(스펙 2026-09-15 §5.1, 목업 2f1a7669) — 트랙 하나에 AS·IP·RW·IM 핸들과 100 에 잠긴 XX.
// 순서·간격·5 단위 제약의 정본은 도메인(clampCredit·validateStageCredits)이고 서버 액션(updateStageCredits)이 다시
// 검사한다. 저장은 소급하지 않는다 — 이미 기록된 실적%는 그대로이고 다음 단계 전이부터 새 값이 쓰인다.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { updateStageCredits } from '@/app/actions/project'
import type { DictKey } from '@/lib/i18n/dict'
import {
  CREDIT_GAP, CREDIT_KEYS, CREDIT_STEP, CREDIT_TABLE_KEYS, DEFAULT_STAGE_CREDITS, clampCredit, validateStageCredits,
  type CreditKey, type CreditTable, type CreditTableKey, type StageCredits,
} from '@/lib/domain/stageCredits'

const TABLE_LABEL: Record<CreditTableKey, DictKey> = {
  default: 'settings.creditTable_default', if: 'settings.creditTable_if', doc: 'settings.creditTable_doc',
}
const KEY_LABEL: Record<CreditKey, DictKey> = {
  as: 'settings.creditKey_as', ip: 'settings.creditKey_ip', rw: 'settings.creditKey_rw',
  im: 'settings.creditKey_im', xx: 'settings.creditKey_xx',
}
/** 핸들 색 — WBS 단계 칩(STAGE_META)과 같은 계열. RW 는 단계가 아니라 반려·재작업 사건이라 지연색. */
const HANDLE_CLS: Record<CreditKey, string> = {
  as: 'bg-pending', ip: 'bg-progress', rw: 'bg-delayed', im: 'bg-brand', xx: 'bg-done',
}
/**
 * 트랙 눈금 — 입력 가능한 값(CREDIT_STEP=5)마다 긋고 CREDIT_GAP=10 마다 숫자를 붙인다.
 * 두 간격을 눈으로 셀 수 있어야 핸들을 어디까지 밀 수 있는지 드래그 전에 안다.
 */
const SCALE_TICKS = Array.from({ length: 100 / CREDIT_STEP + 1 }, (_, i) => i * CREDIT_STEP)

function cloneCredits(c: StageCredits): StageCredits {
  const out: StageCredits = { default: { ...c.default } }
  if (c.if) out.if = { ...c.if }
  if (c.doc) out.doc = { ...c.doc }
  return out
}

export function StageCreditSlider({ projectId, initial, editable }: {
  projectId: string
  /** project_settings.stage_credits — null 이면 코드 기본값으로 시작한다. */
  initial: StageCredits | null
  editable: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [pending, startTransition] = useTransition()
  const [credits, setCredits] = useState<StageCredits>(() => cloneCredits(initial ?? DEFAULT_STAGE_CREDITS))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const touch = () => { setDirty(true); setSaved(false); setError(null) }
  const setValue = (tableKey: CreditTableKey, key: CreditKey, raw: number) => {
    setCredits(prev => {
      const table = prev[tableKey]
      if (!table) return prev
      return { ...prev, [tableKey]: { ...table, [key]: clampCredit(raw, key, table) } }
    })
    touch()
  }
  const addTable = (k: CreditTableKey) => {
    setCredits(prev => ({ ...prev, [k]: { ...(DEFAULT_STAGE_CREDITS[k] ?? DEFAULT_STAGE_CREDITS.default) } }))
    touch()
  }
  const removeTable = (k: CreditTableKey) => {
    if (k === 'default') return
    setCredits(prev => { const next = { ...prev }; delete next[k]; return next })
    touch()
  }
  function save() {
    const v = validateStageCredits(credits)
    if (!v.ok) { setError(v.error); return }
    setError(null)
    startTransition(async () => {
      const r = await updateStageCredits(projectId, v.credits)
      if (!r.ok) { setError(r.error ?? t('settings.actionFailed')); return }
      setDirty(false)
      setSaved(true)
      router.refresh()
    })
  }

  const tables = CREDIT_TABLE_KEYS.filter(k => credits[k] !== undefined)
  const addable = CREDIT_TABLE_KEYS.filter(k => credits[k] === undefined)

  return (
    <div data-stage-credits className="space-y-3 pt-2">
      {tables.map(k => (
        <CreditRow
          key={k}
          tableKey={k}
          table={credits[k] as CreditTable}
          editable={editable && !pending}
          onChange={(key, raw) => setValue(k, key, raw)}
          onRemove={editable && k !== 'default' ? () => removeTable(k) : undefined}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        {editable && addable.map(k => (
          <button key={k} type="button" data-credit-add={k} onClick={() => addTable(k)} disabled={pending}
            className="btn btn-ghost h-8 px-2 text-xs">
            + {t(TABLE_LABEL[k])}
          </button>
        ))}
        <span className="text-[11px] text-ink-subtle">{t('settings.creditsNoRetro')}</span>
        {editable && (
          <button type="button" data-credit-save onClick={save} disabled={pending || !dirty}
            className="btn btn-primary ml-auto h-8 px-3 text-xs">
            {t('settings.creditsSave')}
          </button>
        )}
      </div>
      {saved && <p data-credit-saved role="status" className="text-xs text-done">{t('settings.creditsSaved')}</p>}
      {error && <p data-credit-error role="alert" className="text-xs text-delayed">{error}</p>}
    </div>
  )
}

function CreditRow({ tableKey, table, editable, onChange, onRemove }: {
  tableKey: CreditTableKey
  table: CreditTable
  editable: boolean
  onChange: (key: CreditKey, raw: number) => void
  onRemove?: () => void
}) {
  const { t } = useLocale()
  const trackRef = useRef<HTMLDivElement>(null)
  // 직접 입력은 초안으로 받고 포커스를 벗어날 때(또는 Enter) 클램프한다 — 타이핑 중간값(예: "4")이 곧바로
  // 이웃 간격에 걸려 튀지 않게.
  const [draft, setDraft] = useState<Partial<Record<CreditKey, string>>>({})
  const commitDraft = (key: CreditKey) => {
    const raw = draft[key]
    if (raw === undefined) return
    setDraft(d => { const next = { ...d }; delete next[key]; return next })
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) onChange(key, Number(raw))
  }

  const startDrag = (key: CreditKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || key === 'xx' || !trackRef.current) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const rect = trackRef.current.getBoundingClientRect()
    const move = (ev: PointerEvent) => { if (rect.width > 0) onChange(key, ((ev.clientX - rect.left) / rect.width) * 100) }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const onHandleKey = (key: CreditKey) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable || key === 'xx') return
    const cur = table[key]
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? cur - CREDIT_STEP
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? cur + CREDIT_STEP
        : e.key === 'Home' ? 0
          : e.key === 'End' ? 100
            : null
    if (next === null) return
    e.preventDefault()
    onChange(key, next)
  }

  return (
    <div data-credit-table={tableKey} className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{t(TABLE_LABEL[tableKey])}</span>
        {onRemove && (
          <button type="button" data-credit-remove onClick={onRemove} className="btn btn-ghost h-7 px-2 text-[11px]">
            {t('settings.creditTableRemove')}
          </button>
        )}
      </div>

      <div className="px-2">
        <div ref={trackRef} data-credit-track className="relative mt-7 h-1.5 rounded-full bg-line">
          {CREDIT_KEYS.map(key => {
            const locked = key === 'xx'
            return (
              <div
                key={key}
                role="slider"
                tabIndex={editable && !locked ? 0 : -1}
                aria-label={`${t(TABLE_LABEL[tableKey])} ${key.toUpperCase()} ${t(KEY_LABEL[key])}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={table[key]}
                aria-disabled={!editable || locked}
                data-credit-handle={key}
                onPointerDown={startDrag(key)}
                onKeyDown={onHandleKey(key)}
                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-surface shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${HANDLE_CLS[key]} ${editable && !locked ? 'cursor-grab active:cursor-grabbing' : 'opacity-70'}`}
                style={{ left: `${table[key]}%` }}
              >
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-ink-muted">
                  {key.toUpperCase()}
                </span>
              </div>
            )
          })}
        </div>
        <div data-credit-scale className="relative mt-1.5 h-6" aria-hidden>
          {SCALE_TICKS.map(v => {
            const major = v % CREDIT_GAP === 0
            return (
              <span key={v} data-credit-tick={v} className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${v}%` }}>
                <span className={`w-px ${major ? 'h-2 bg-ink-subtle' : 'h-1 bg-line-strong'}`} />
                {major && (
                  <span data-credit-tick-label={v} className="mt-0.5 text-[10px] leading-none tabular-nums text-ink-subtle">
                    {v}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CREDIT_KEYS.map(key => (
          <label key={key} className="min-w-0 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1 truncate">
              <span className={`h-2 w-2 shrink-0 rounded-full ${HANDLE_CLS[key]}`} aria-hidden />
              {key.toUpperCase()} · {t(KEY_LABEL[key])}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={CREDIT_STEP}
              data-credit-input={key}
              value={draft[key] ?? String(table[key])}
              readOnly={!editable || key === 'xx'}
              onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
              onBlur={() => commitDraft(key)}
              onKeyDown={e => { if (e.key === 'Enter') commitDraft(key) }}
              className="app-input mt-1 h-8 w-full text-xs tabular-nums"
            />
          </label>
        ))}
      </div>
    </div>
  )
}
