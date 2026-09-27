'use client'

import { useEffect, useState } from 'react'
import {
  designAccept, designConfirm, designReopen, getDesignPanel,
  type DesignOpResult, type DesignPanelResult,
} from '@/app/actions/designActions'
import type { DesignMode } from '@/lib/domain/designGate'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

/** 설계 방식 이름(사전 키) — 방식 select 와 설계 영역 머리가 같이 쓴다. */
export const DESIGN_MODE_KEYS: Record<DesignMode, DictKey> = {
  auto: 'wbs.designModeAuto', review: 'wbs.designModeReview', human: 'wbs.designModeHuman',
}

/**
 * 위임 표식과 설계 방식을 debounce 저장의 한 칸으로 묶은 값(설계 상태 스펙 7절 — 한 서버 액션이 둘을 함께 쓴다).
 * useDebouncedSave 가 값을 Object.is 로 비교하므로 객체가 아니라 문자열로 둔다.
 */
export type DelegationValue = `${'on' | 'off'}:${DesignMode}`
export const packDelegation = (on: boolean, mode: DesignMode): DelegationValue => `${on ? 'on' : 'off'}:${mode}`
export function unpackDelegation(v: DelegationValue): { on: boolean; mode: DesignMode } {
  const [flag, mode] = v.split(':') as ['on' | 'off', DesignMode]
  return { on: flag === 'on', mode }
}

/**
 * 설계 영역 조회(getDesignPanel). 방식 select 의 잠금과 위임 해제 확인도 같은 결과를 쓰므로 패널(WbsSpecPanel)이 부르고
 * 결과를 영역에 넘긴다. enabled 가 거짓이면(명세에 designMode 가 없음) 부르지 않는다. 같은 항목을 다시 읽는 동안에는 앞
 * 결과를 그대로 두어 깜박이지 않는다. 실패는 { ok: false } 그대로 돌려준다 — "설계 정보 없음"으로 바꾸지 않는다(에러 3원칙).
 */
export function useDesignPanel(itemId: string, enabled: boolean, refreshKey: number): DesignPanelResult | null {
  const [state, setState] = useState<{ itemId: string; res: DesignPanelResult } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    getDesignPanel(itemId)
      .catch((e: unknown): DesignPanelResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
      .then(res => {
        if (!alive) return
        if (!res.ok) console.error('[WbsDesignSection] 설계 영역 조회 실패:', res.error)
        setState({ itemId, res })
      })
    return () => { alive = false }
  }, [itemId, enabled, refreshKey])
  return enabled && state?.itemId === itemId ? state.res : null
}

/**
 * WBS 작업 패널의 설계 영역(설계 상태 스펙 3절 화면 판정·7절 화면과 권한). 화면 문구·되돌림 사유·안내는 서버 판정
 * (designScreen)의 문자열을 그대로 보인다 — 규칙 원본을 하나로 두려는 것이라 번역하지 않는다. 버튼은 위임 권한(canAct)이
 * 있을 때만 그린다. 버튼 뒤에는 성공·실패와 관계없이 onChanged 로 다시 읽는다 — 실패(화면이 낡음·그 사이 바뀜)도 지금
 * 상태를 보여야 사람이 다음 행동을 고른다. 보일 것이 없는 완전자동 작업에는 영역을 그리지 않는다(빈 패널에 소음을 더하지 않는다).
 */
export function WbsDesignSection({ itemId, res, onChanged }: {
  itemId: string
  res: DesignPanelResult | null
  onChanged: () => void
}) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // 「설계 되돌리기」는 두 단계다(반려·재작업과 같은 모양) — 눌러야 사유 칸과 제출 버튼이 열린다.
  const [reopening, setReopening] = useState(false)
  useEffect(() => { setErr(null); setWarn(null); setReason(''); setReopening(false) }, [itemId])

  if (res === null) return null // 조회 중 — 늘 있는 영역이 아니라 자리표를 세우지 않는다
  if (!res.ok) {
    return (
      <div data-spec-design className="mt-2 rounded-lg border border-line bg-surface p-2.5">
        <p className="text-xs font-medium text-delayed" role="alert">{t('wbs.designLoadFail')} — {res.error}</p>
      </div>
    )
  }
  const { panel, canAct } = res
  const quiet = panel.mode === 'auto' && panel.screen === null && panel.buttons.length === 0
    && panel.pushWarning === null && panel.designState === null
  if (quiet && err === null && warn === null) return null

  async function run(op: () => Promise<DesignOpResult>) {
    setBusy(true); setErr(null); setWarn(null)
    try {
      const r = await op()
      if (!r.ok) setErr(r.error ?? t('wbs.agentOrderActionFailed'))
      else { setReason(''); setReopening(false) }
      setWarn(r.warning ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('wbs.agentOrderActionFailed'))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <div data-spec-design className="mt-2 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-ink-muted">{t('wbs.designSectionTitle')}</span>
        <span className="chip bg-surface-2 text-ink-muted">{t(DESIGN_MODE_KEYS[panel.mode])}</span>
      </div>
      {panel.screen && (
        <div className="mt-1.5 space-y-1">
          <p data-design-label className="text-xs font-semibold text-ink">{panel.screen.label}</p>
          {panel.screen.note && (
            <p className="text-xs text-delayed">
              <span className="font-semibold">{t('wbs.designNoteLabel')}</span>{' '}
              <span data-design-note className="whitespace-pre-wrap">{panel.screen.note}</span>
            </p>
          )}
          {panel.screen.hint && <p data-design-hint className="text-[11px] text-ink-subtle">{panel.screen.hint}</p>}
        </div>
      )}
      {panel.pushWarning && (
        <p data-design-push-warning className="mt-1.5 text-xs font-medium text-accent-warning">{panel.pushWarning}</p>
      )}
      {canAct && panel.buttons.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {panel.buttons.includes('accept') && (
            <button type="button" data-design-btn="accept" className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy}
              onClick={() => void run(() => designAccept(itemId))}>{t('wbs.designAccept')}</button>
          )}
          {panel.buttons.includes('confirm') && (
            <button type="button" data-design-btn="confirm" className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy}
              onClick={() => void run(() => designConfirm(itemId))}>{t('wbs.designConfirm')}</button>
          )}
          {panel.buttons.includes('reopen') && (reopening ? (
            <>
              <input
                data-design-reopen-reason className="app-input h-7 w-48 text-xs" maxLength={500}
                aria-label={t('wbs.designReopenReason')} placeholder={t('wbs.designReopenReason')}
                value={reason} onChange={e => setReason(e.target.value)}
              />
              <button type="button" data-design-reopen-submit className="btn h-7 px-2.5 text-xs" disabled={busy}
                onClick={() => void run(() => designReopen(itemId, reason))}>{t('wbs.designReopen')}</button>
              <button type="button" className="btn btn-ghost h-7 px-2.5 text-xs" disabled={busy}
                onClick={() => { setReopening(false); setReason('') }}>{t('common.cancel')}</button>
            </>
          ) : (
            <button type="button" data-design-btn="reopen" className="btn btn-ghost h-7 px-2.5 text-xs" disabled={busy}
              onClick={() => setReopening(true)}>{t('wbs.designReopen')}</button>
          ))}
        </div>
      )}
      {!canAct && panel.buttons.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-subtle">{t('wbs.designNoRight')}</p>
      )}
      {panel.designState === 'accepted' && (
        <details data-design-exit-guide className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-ink-muted">{t('wbs.designExitTitle')}</summary>
          <p className="mt-1 text-[11px] text-ink-subtle">{t('wbs.designExitWhen')}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-ink">
            <li>{t('wbs.designExitStep1')}</li>
            <li>{t('wbs.designExitStep2')}</li>
            <li>{t('wbs.designExitStep3')}</li>
            <li>{t('wbs.designExitStep4')}</li>
          </ol>
        </details>
      )}
      {err && <p className="mt-1.5 text-xs font-medium text-delayed" role="alert">{err}</p>}
      {warn && <p className="mt-1.5 text-xs text-ink-muted" role="status">{warn}</p>}
    </div>
  )
}
