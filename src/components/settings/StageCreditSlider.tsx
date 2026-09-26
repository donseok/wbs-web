'use client'

// 개발 워크플로 크레딧(스펙 2026-09-15 §5.1, 목업 2f1a7669) — 트랙 하나에 AS·DS·IP·RW·IM 핸들과 100 에 잠긴 XX.
// DS(설계 중)는 0107 에서 들어왔다 — ds 가 없는 옛 표는 기본값(10)으로 채워 그린다(RPC 와 같은 값).
// 표는 프로젝트마다 하나다(2026-09-16). 카테고리별 if·doc 표를 없앴고 항목 credit_key 는 전이 계산에 쓰지 않는다.
// 값은 핸들 위에서 바로 고치고, XX 는 승인으로만 100 이 되므로 입력 없이 자물쇠로 굳힌다.
// 아래 미리보기는 지금 값으로 위임 Task 의 사건 흐름을 보여 준다(저장과 무관한 계산기).
// 순서·간격·5 단위 제약의 정본은 도메인(clampCredit·validateStageCredits)이고 서버 액션(updateStageCredits)이
// 다시 검사한다. 저장은 소급하지 않는다 — 이미 기록된 실적%는 그대로이고 다음 단계 전이부터 새 값이 쓰인다.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { updateStageCredits } from '@/app/actions/project'
import { statusOf } from '@/lib/domain/progress'
import type { DictKey } from '@/lib/i18n/dict'
import {
  CREDIT_GAP, CREDIT_KEYS, CREDIT_STEP, DEFAULT_STAGE_CREDITS, clampCredit, normalizeStageCredits, validateStageCredits,
  type CreditKey, type CreditTable, type StageCredits,
} from '@/lib/domain/stageCredits'

type Status = ReturnType<typeof statusOf>
/** 슬라이더 위 「현재 위치」 — 핸들 값이거나 사람이 직접 넣은 실적%. */
type Cursor = CreditKey | 'manual'

const KEY_LABEL: Record<CreditKey, DictKey> = {
  as: 'settings.creditKey_as', ds: 'settings.creditKey_ds', ip: 'settings.creditKey_ip', rw: 'settings.creditKey_rw',
  im: 'settings.creditKey_im', xx: 'settings.creditKey_xx',
}
/** 색 — WBS 단계 칩과 같은 계열. RW 는 단계가 아니라 반려·재작업 사건이라 범례에서 마름모다. */
const DOT_CLS: Record<CreditKey, string> = {
  as: 'bg-pending', ds: 'bg-accent-secondary', ip: 'bg-progress', rw: 'bg-delayed', im: 'bg-brand', xx: 'bg-done',
}
const RING_CLS: Record<CreditKey, string> = {
  as: 'border-pending', ds: 'border-accent-secondary', ip: 'border-progress', rw: 'border-delayed', im: 'border-brand', xx: 'border-done',
}
const STATUS_LABEL: Record<Status, DictKey> = {
  not_started: 'settings.creditPvNotStarted', in_progress: 'settings.creditPvInProgress',
  delayed: 'settings.creditPvDelayed', done: 'settings.creditPvDone',
}
const STATUS_CHIP: Record<Status, string> = {
  not_started: 'bg-surface-2 text-ink-subtle', in_progress: 'bg-progress-weak text-progress',
  delayed: 'bg-delayed-weak text-delayed', done: 'bg-done-weak text-done',
}
/** 눈금 — 입력 가능한 값(5)마다 긋고 10 마다 숫자를 붙인다. 이웃 최소 간격(10)을 눈으로 세도록. */
const SCALE_TICKS = Array.from({ length: 100 / CREDIT_STEP + 1 }, (_, i) => i * CREDIT_STEP)

/** 미리보기 흐름 — 위임 Task 하나가 거치는 사건 순서(스펙 §3.4 사건 표). 에이전트는 설계 선행으로 claim 해 ds 를 거친다(0107). */
const FLOW: { ev: DictKey; order: string; stage: Exclude<CreditKey, 'rw'>; cur: Cursor; same?: boolean }[] = [
  { ev: 'settings.creditPvEvAssign', order: 'ready', stage: 'as', cur: 'as' },
  { ev: 'settings.creditPvEvClaim', order: 'claimed', stage: 'ds', cur: 'ds' },
  { ev: 'settings.creditPvEvBuildStart', order: 'claimed', stage: 'ip', cur: 'ip' },
  { ev: 'settings.creditPvEvManual', order: 'claimed', stage: 'ip', cur: 'manual', same: true },
  { ev: 'settings.creditPvEvReport', order: 'reported', stage: 'im', cur: 'im' },
  { ev: 'settings.creditPvEvApprove', order: 'approved', stage: 'xx', cur: 'xx' },
  { ev: 'settings.creditPvEvUnapprove', order: 'reported', stage: 'im', cur: 'im' },
  { ev: 'settings.creditPvEvReject', order: 'claimed', stage: 'ip', cur: 'rw' },
]

function LockGlyph({ spin }: { spin: boolean }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden className={`block h-2 w-2 ${spin ? '-rotate-45' : ''}`}>
      <path d="M2.5 4.5V3.2a2.5 2.5 0 0 1 5 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.6" y="4.5" width="6.8" height="4.6" rx="1" fill="currentColor" />
    </svg>
  )
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
  const [table, setTable] = useState<CreditTable>(() => ({ ...(normalizeStageCredits(initial)?.default ?? DEFAULT_STAGE_CREDITS.default) }))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 현재 위치 — 트랙 채움과 ◆ 표시가 따라간다. 미리보기 행을 누르거나 핸들을 잡으면 바뀐다.
  const [cursor, setCursor] = useState<Cursor>('rw')
  const [manual, setManual] = useState(50)
  const [plan, setPlan] = useState(60)
  const trackRef = useRef<HTMLDivElement>(null)
  // 직접 입력은 초안으로 받고 포커스를 벗어날 때(또는 Enter) 클램프한다 — 타이핑 중간값(예: "4")이 곧바로
  // 이웃 간격에 걸려 튀지 않게.
  const [draft, setDraft] = useState<Partial<Record<CreditKey, string>>>({})

  const locked = !editable || pending
  const setValue = (key: CreditKey, raw: number) => {
    setTable(prev => ({ ...prev, [key]: clampCredit(raw, key, prev) }))
    setDirty(true); setSaved(false); setError(null)
  }
  const commitDraft = (key: CreditKey) => {
    const raw = draft[key]
    if (raw === undefined) return
    setDraft(d => { const next = { ...d }; delete next[key]; return next })
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) setValue(key, Number(raw))
  }
  const startDrag = (key: CreditKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    setCursor(key)
    if (locked || !trackRef.current) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture?.(e.pointerId)
    const rect = trackRef.current.getBoundingClientRect()
    const move = (ev: PointerEvent) => { if (rect.width > 0) setValue(key, ((ev.clientX - rect.left) / rect.width) * 100) }
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
    if (locked) return
    const cur = table[key]
    const next = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? cur - CREDIT_STEP
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? cur + CREDIT_STEP
        : e.key === 'Home' ? 0
          : e.key === 'End' ? 100
            : null
    if (next === null) return
    e.preventDefault()
    setValue(key, next)
  }
  function save() {
    const v = validateStageCredits({ default: table })
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

  const cursorPct = cursor === 'manual' ? manual : table[cursor]
  const actualOf = (cur: Cursor) => cur === 'manual' ? manual : table[cur]

  return (
    <div data-stage-credits className="space-y-3 pt-2">
      <div data-credit-table="default" className="rounded-[10px] border border-line bg-surface">
        {/* ── 슬라이더 ── */}
        <div className="relative touch-none select-none px-7 pb-[34px] pt-[50px]">
          {/* 값 — 핸들 바로 위. 핸들과 형제로 두어야 숫자를 눌러도 드래그가 걸리지 않는다. */}
          <div className="pointer-events-none absolute left-7 right-7 top-2.5 h-[38px]">
            {CREDIT_KEYS.map(key => (
              <div key={key} data-credit-label={key}
                className="pointer-events-auto absolute top-0 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${table[key]}%` }}>
                <span className={`text-[10px] font-semibold tracking-[0.1em] ${cursor === key ? 'text-critical' : 'text-ink-subtle'}`}>
                  {key.toUpperCase()}
                </span>
                {key === 'xx' ? (
                  <span data-credit-fixed="xx" title={t('settings.creditXxLocked')}
                    className="w-[3.4em] text-center font-mono text-[15px] font-semibold tabular-nums text-ink-subtle">
                    100
                  </span>
                ) : (
                  <input
                    type="text"
                    inputMode="numeric"
                    data-credit-input={key}
                    aria-label={`${key.toUpperCase()} ${t(KEY_LABEL[key])}`}
                    value={draft[key] ?? String(table[key])}
                    readOnly={locked}
                    onFocus={() => setCursor(key)}
                    onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                    onBlur={() => commitDraft(key)}
                    onKeyDown={e => { if (e.key === 'Enter') commitDraft(key) }}
                    className={`w-[3.4em] border-0 border-b-[1.5px] border-transparent bg-transparent p-0 text-center font-mono text-[15px] font-semibold tabular-nums outline-none hover:border-line-strong focus:border-brand ${cursor === key ? 'text-critical' : 'text-ink'}`}
                  />
                )}
              </div>
            ))}
          </div>

          <div ref={trackRef} data-credit-track className="relative h-[3px] rounded-sm bg-line-strong">
            <div data-credit-fill className="absolute left-0 top-0 h-full rounded-sm bg-critical/55"
              style={{ width: `${cursorPct}%` }} aria-hidden />

            {cursor === 'manual' && (
              <>
                <span data-credit-manual-mark aria-hidden
                  className="absolute top-1/2 -ml-1.5 -mt-1.5 h-3 w-3 rotate-45 rounded-[2px] border-2 border-critical bg-surface"
                  style={{ left: `${manual}%` }} />
                <span aria-hidden className="absolute top-3.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold tracking-[0.06em] text-critical"
                  style={{ left: `${manual}%` }}>
                  {t('settings.creditPvTagManual')}
                </span>
              </>
            )}

            {CREDIT_KEYS.map(key => {
              const isCursor = cursor === key
              if (key === 'xx') {
                return (
                  <span key={key} data-credit-handle="xx" data-credit-locked="" role="img"
                    aria-label={t('settings.creditXxLocked')} title={t('settings.creditXxLocked')}
                    className={`absolute top-1/2 grid cursor-not-allowed place-items-center border-2 text-white shadow-sm ${isCursor ? '-ml-[7px] -mt-[7px] h-3.5 w-3.5 rotate-45 rounded-[2px] border-critical bg-critical' : '-ml-2 -mt-2 h-4 w-4 rounded-full border-done bg-done'}`}
                    style={{ left: '100%' }}>
                    <LockGlyph spin={isCursor} />
                  </span>
                )
              }
              return (
                <div
                  key={key}
                  role="slider"
                  tabIndex={locked ? -1 : 0}
                  aria-label={`${key.toUpperCase()} ${t(KEY_LABEL[key])}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={table[key]}
                  aria-disabled={locked}
                  data-credit-handle={key}
                  onPointerDown={startDrag(key)}
                  onKeyDown={onHandleKey(key)}
                  onFocus={() => setCursor(key)}
                  className={`absolute top-1/2 touch-none border-2 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-brand ${isCursor ? '-ml-[7px] -mt-[7px] h-3.5 w-3.5 rotate-45 rounded-[2px] border-critical bg-critical' : `-ml-2 -mt-2 h-4 w-4 rounded-full bg-surface ${RING_CLS[key]}`} ${locked ? 'opacity-70' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ left: `${table[key]}%` }}
                />
              )
            })}
          </div>

          <div data-credit-scale className="absolute bottom-1 left-7 right-7 h-[30px]" aria-hidden>
            {SCALE_TICKS.map(v => (
              <span key={v} data-credit-tick={v} className="absolute top-0" style={{ left: `${v}%` }}>
                <span className={`absolute -translate-x-[0.5px] w-px bg-line-strong ${v % CREDIT_GAP === 0 ? 'h-2.5' : 'h-1.5'}`} />
                {v % CREDIT_GAP === 0 && (
                  <span data-credit-tick-label={v}
                    className="absolute top-3.5 -translate-x-1/2 text-[11px] leading-none tabular-nums text-ink-subtle">
                    {v}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* ── 범례 ── */}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 px-[18px] pb-3.5 text-xs text-ink-subtle">
          {CREDIT_KEYS.map(key => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`h-[9px] w-[9px] shrink-0 ${DOT_CLS[key]} ${key === 'rw' ? 'rotate-45 rounded-[2px]' : 'rounded-full'}`} aria-hidden />
              {key.toUpperCase()} {t(KEY_LABEL[key])}{key === 'rw' ? ` (${t('settings.creditRwNote')})` : ''}
            </span>
          ))}
        </div>

        {/* ── 미리보기 ── */}
        <div data-credit-preview className="flex flex-col gap-2.5 border-t border-line px-[18px] pb-3 pt-3.5">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <h3 className="text-sm font-bold text-ink">{t('settings.creditPvTitle')}</h3>
            <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-muted">
              {t('settings.creditPvPlan')}
              <input type="number" min={0} max={100} step={CREDIT_STEP} data-credit-pv-plan value={plan}
                onChange={e => setPlan(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="app-input h-7 w-16 text-right text-xs tabular-nums" />
              %
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  {(['settings.creditPvColEvent', 'settings.creditPvColOrder', 'settings.creditPvColStage'] as DictKey[]).map(k => (
                    <th key={k} className="whitespace-nowrap border-b border-line px-2.5 pb-2 pt-1 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-subtle">
                      {t(k)}
                    </th>
                  ))}
                  <th className="whitespace-nowrap border-b border-line px-2.5 pb-2 pt-1 text-right text-[11px] font-semibold tracking-[0.06em] text-ink-subtle">
                    {t('settings.creditPvColActual')}
                  </th>
                  <th className="whitespace-nowrap border-b border-line px-2.5 pb-2 pt-1 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-subtle">
                    {t('settings.creditPvColProgress')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {FLOW.map((f, i) => {
                  const actual = actualOf(f.cur)
                  const st = statusOf(actual, plan, null, '')
                  const on = cursor === f.cur
                  return (
                    <tr key={i} data-credit-pv-row={i} aria-selected={on} tabIndex={0}
                      onClick={() => setCursor(f.cur)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCursor(f.cur) } }}
                      className={`cursor-pointer ${on ? 'bg-critical-weak' : 'hover:bg-surface-2'}`}>
                      <td className="whitespace-nowrap border-b border-line px-2.5 py-[7px] text-[13px] font-medium text-ink">
                        <span className={`mr-2 inline-block h-2 w-2 rotate-45 bg-critical ${on ? '' : 'invisible'}`} aria-hidden />
                        {t(f.ev)}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-2.5 py-[7px] font-mono text-xs text-ink-muted">
                        {f.order}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-2.5 py-[7px] text-[13px]">
                        <span className={`inline-flex items-center gap-1.5 ${f.same ? 'text-ink-subtle' : 'text-ink'}`}>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLS[f.stage]}`} aria-hidden />
                          {f.stage.toUpperCase()} {t(KEY_LABEL[f.stage])}{f.same ? ` · ${t('settings.creditPvSame')}` : ''}
                        </span>
                      </td>
                      <td data-credit-pv-actual={i} className="whitespace-nowrap border-b border-line px-2.5 py-[7px] text-right font-mono text-[13px] tabular-nums text-ink">
                        {f.cur === 'manual' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <input type="number" min={0} max={99} step={CREDIT_STEP} data-credit-pv-manual value={manual}
                              aria-label={t('settings.creditPvEvManual')}
                              onChange={e => { setManual(Math.max(0, Math.min(99, Number(e.target.value) || 0))); setCursor('manual') }}
                              className="app-input h-7 w-16 text-right text-xs tabular-nums" />
                            <span className="rounded bg-critical-weak px-1.5 text-[10px] font-semibold text-critical">
                              {t('settings.creditPvTagManual')}
                            </span>
                          </span>
                        ) : (
                          <>
                            {actual}
                            {f.cur === 'rw' && (
                              <span className="ml-1.5 rounded bg-delayed-weak px-1.5 text-[10px] font-semibold text-delayed">RW</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-2.5 py-[7px]">
                        <span data-credit-pv-status={i} className={`inline-block rounded-full px-2 py-px text-[11px] font-semibold ${STATUS_CHIP[st]}`}>
                          {t(STATUS_LABEL[st])}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs leading-5 text-ink-subtle">{t('settings.creditPvHint')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
