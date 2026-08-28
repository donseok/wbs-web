'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ChevronDown, ChevronRight, FileText, Pencil } from 'lucide-react'
import {
  getWbsSpec, setAgentDelegation, updateAgentPrompt, updateWbsSpec, updateWbsSpecFields,
  type WbsPriority, type WbsSpecDetail,
} from '@/app/actions/wbsSpec'
import {
  approveAgentCompletion, getAgentOrderForItem, rejectAgentCompletion,
  requestAgentRework, unapproveAgentCompletion,
  type AgentOrderStatus,
} from '@/app/actions/agentWork'
import { isClaimStale } from '@/lib/domain/agentWork'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

// react-markdown·remark-gfm·unified·mermaid 체인(minutes 전용으로 만들어짐)을 정적 import 하면
// /p/[projectId]/wbs 초기 JS 에 +47KB 가 항상 실린다(실측: 정적 252KB → 299KB, 회의록을 한 번도
// 열지 않는 사용자도 그 비용을 진다). WikiShared.tsx 의 "블록 몇 줄 때문에 파서 100KB" 경고와
// 같은 함정이라 동적 import 로 명세 패널을 실제로 펼칠 때만 로드한다.
const MarkdownView = dynamic(
  () => import('@/components/minutes/MarkdownView').then(m => m.MarkdownView),
  { ssr: false },
)

const PRIORITIES: WbsPriority[] = ['critical', 'high', 'medium', 'low']
const PRIORITY_KEYS: Record<WbsPriority, DictKey> = {
  critical: 'wbs.specPriorityCritical', high: 'wbs.specPriorityHigh',
  medium: 'wbs.specPriorityMedium', low: 'wbs.specPriorityLow',
}

/**
 * WBS 명세 패널(Task 12A, 결정 B) — 스칼라 배지(category·domain·priority·model·tags),
 * 참조 필드 인라인 편집(prd_ref·entry_point·priority), acceptance 체크리스트(읽기 전용 —
 * 정본은 import), spec 마크다운
 * (보기 모드 = MarkdownView 렌더 / 편집 모드 = textarea + 저장).
 *
 * WbsAssigneeStagePanel 의 섹션으로 편입된다 — 별도 오버레이 금지(리뷰 라운드 1 결함 재발 방지:
 * 별도 fixed 패널은 RowDetailPanel(aria-modal) 뒤에 숨어 키보드·스크린리더로 도달 불가했다.
 * 하나의 항목에 dialog 하나만 뜨도록 RowDetailPanel 이 유일한 배치 주체다).
 * 편집 권한은 배정(§2.5)과 동일 — 프로젝트 관리자. editable=false 면 전 필드 읽기 전용.
 */
export function WbsSpecPanel({ itemId, editable }: { itemId: string; editable: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  const [loaded, setLoaded] = useState<WbsSpecDetail | 'error' | null>(null)
  const [prdRefDraft, setPrdRefDraft] = useState('')
  const [entryPointDraft, setEntryPointDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [refBusy, setRefBusy] = useState(false)
  const [refErr, setRefErr] = useState<string | null>(null)
  const [specEditing, setSpecEditing] = useState(false)
  const [specDraft, setSpecDraft] = useState('')
  // 명세 편집 위젯(참조·우선순위·위임·프롬프트)의 노출 토글(2026-08-28). 읽기 상태에서 늘
  // 펼쳐져 있던 입력들이 패널 높이의 대부분을 먹었다.
  const [fieldsEditing, setFieldsEditing] = useState(false)
  const [specBusy, setSpecBusy] = useState(false)
  const [specErr, setSpecErr] = useState<string | null>(null)
  // 위임 체크가 주문을 발행·취소하므로, 체크가 바뀔 때마다 아래 진행 상황 섹션도 다시 읽는다.
  const [orderRefreshKey, setOrderRefreshKey] = useState(0)
  // 명세 접기 — 본문(요구사항 마크다운·수용 기준·진행 이력)이 패널 높이의 대부분을 먹는다.
  // 기본은 펼침이다: 접힘을 기본으로 두면 에이전트 진행 상황과 승인·재작업 버튼까지 한 번 더
  // 눌러야 보여 회귀가 된다. 항목을 옮겨도 접힘 상태는 유지한다.
  // 기본 접힘 — 명세는 길고, 상세 패널을 열 때마다 화면 대부분을 먹었다.
  const [bodyOpen, setBodyOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setSpecEditing(false); setFieldsEditing(false); setSpecErr(null); setRefErr(null)
    getWbsSpec(itemId).then(r => {
      if (!alive) return
      setLoaded(r ?? 'error')
      if (r) { setPrdRefDraft(r.prdRef ?? ''); setEntryPointDraft(r.entryPoint ?? ''); setPromptDraft(r.agentPrompt ?? '') }
    })
    return () => { alive = false }
  }, [itemId])


  /** 반환값은 "저장이 끝났는가" — 편집 토글을 닫아도 되는지 판단하는 데 쓴다(실패면 열어 둔다). */
  async function commitRefField(field: 'prdRef' | 'entryPoint', raw: string): Promise<boolean> {
    if (!loaded || loaded === 'error') return true
    const value = raw.trim() || null
    const current = field === 'prdRef' ? loaded.prdRef : loaded.entryPoint
    if (value === current) return true // 변경 없음 — 쓰기 스킵(wbsAssign.ts 의 상태 비교 멱등 관례)
    setRefBusy(true); setRefErr(null)
    const apiField = field === 'prdRef' ? 'prd_ref' : 'entry_point'
    const res = await updateWbsSpecFields(itemId, { [apiField]: value })
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return false }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, [field]: value } : prev))
    router.refresh()
    return true
  }

  async function commitPriority(priority: WbsPriority | null) {
    setRefBusy(true); setRefErr(null)
    const res = await updateWbsSpecFields(itemId, { priority })
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, priority } : prev))
    router.refresh()
  }

  async function commitAgentDelegate(delegated: boolean) {
    setRefBusy(true); setRefErr(null)
    const res = await setAgentDelegation(itemId, delegated)
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return }
    // ok 인데 warning — 태그는 바뀌었지만 주문이 안 나갔거나(프로젝트 중지) 진행 중 주문을 회수하지 않은 경우.
    // 에러 칸에 그대로 보여준다(위장 금지). 다음 조작에서 지워진다.
    if (res.warning) setRefErr(res.warning)
    setLoaded(prev => (prev && prev !== 'error'
      ? { ...prev, tags: delegated ? [...prev.tags.filter(tg => tg !== 'agent'), 'agent'] : prev.tags.filter(tg => tg !== 'agent') }
      : prev))
    setOrderRefreshKey(k => k + 1)
    router.refresh()
  }

  async function commitAgentPrompt(): Promise<boolean> {
    if (!loaded || loaded === 'error') return true
    const value = promptDraft.trim() || null
    if (value === loaded.agentPrompt) return true // 변경 없음 — 쓰기 스킵(멱등 관례)
    setRefBusy(true); setRefErr(null)
    const res = await updateAgentPrompt(itemId, promptDraft)
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return false }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, agentPrompt: value } : prev))
    router.refresh()
    return true
  }

  /**
   * 편집 토글 닫기 — 참조·프롬프트는 blur 커밋이라 위젯을 언마운트하면 입력이 조용히 사라진다.
   * 닫기 전에 직접 커밋한다. 세 커밋 모두 값이 그대로면 쓰지 않는 멱등 함수다.
   */
  async function closeFieldsEditing() {
    // 하나라도 실패하면 열어 둔다 — 닫아 버리면 입력 중이던 값이 사라지고 재시도할 방법이 없다.
    // 단축 평가를 쓰지 않는다: 앞이 실패해도 뒤의 저장은 시도해야 한다.
    const saved = [
      await commitRefField('prdRef', prdRefDraft),
      await commitRefField('entryPoint', entryPointDraft),
      await commitAgentPrompt(),
    ]
    if (saved.every(Boolean)) setFieldsEditing(false)
  }

  function openSpecEdit() {
    if (loaded && loaded !== 'error') setSpecDraft(loaded.spec ?? '')
    setSpecErr(null)
    setSpecEditing(true)
  }

  async function saveSpec() {
    setSpecBusy(true); setSpecErr(null)
    const res = await updateWbsSpec(itemId, specDraft)
    setSpecBusy(false)
    if (!res.ok) { setSpecErr(res.error ?? t('wbs.specSaveFail')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, spec: specDraft } : prev))
    setSpecEditing(false)
    router.refresh()
  }

  const hasScalarBadge = loaded && loaded !== 'error' &&
    (loaded.category || loaded.domain || loaded.priority || loaded.model || loaded.tags.length > 0)

  return (
    <section className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button" data-spec-body-toggle
          onClick={() => setBodyOpen(open => !open)}
          aria-expanded={bodyOpen}
          className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle transition hover:text-ink"
        >
          {bodyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FileText className="h-3.5 w-3.5" /> {t('wbs.specPanelTitle')}
        </button>
        {bodyOpen && editable && loaded && loaded !== 'error' && (
          <button
            type="button" data-spec-edit-toggle aria-pressed={fieldsEditing} disabled={refBusy}
            onClick={() => { if (fieldsEditing) void closeFieldsEditing(); else setFieldsEditing(true) }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-subtle transition hover:bg-surface-2 hover:text-ink"
          >
            <Pencil className="h-3 w-3" />
            {fieldsEditing ? t('common.done') : t('common.edit')}
          </button>
        )}
      </div>

      {!bodyOpen ? null : loaded === null ? (
        <p className="mt-2 text-xs text-ink-subtle">{t('common.loading')}</p>
      ) : loaded === 'error' ? (
        <p className="mt-2 text-xs font-medium text-delayed">{t('wbs.specLoadFail')}</p>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {loaded.category && <span className="chip bg-surface-2 text-ink-muted">{loaded.category}</span>}
            {loaded.domain && <span className="chip bg-surface-2 text-ink-muted">{loaded.domain}</span>}
            {loaded.priority && !fieldsEditing && <span className="chip bg-brand-weak text-brand">{t(PRIORITY_KEYS[loaded.priority])}</span>}
            {loaded.model && <span className="chip bg-surface-2 text-ink-muted">{loaded.model}</span>}
            {loaded.tags.map(tag => (
              <span key={tag} className="chip border border-line text-ink-subtle">{tag}</span>
            ))}
            {!hasScalarBadge && <span className="text-xs text-ink-subtle">{t('wbs.specNone')}</span>}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <RefField
              label={t('wbs.specPrdRefLabel')} value={prdRefDraft} display={loaded.prdRef}
              editable={fieldsEditing} busy={refBusy} onChange={setPrdRefDraft} dataAttr="data-spec-prd-ref"
              onCommit={() => commitRefField('prdRef', prdRefDraft)}
            />
            <RefField
              label={t('wbs.specEntryPointLabel')} value={entryPointDraft} display={loaded.entryPoint}
              editable={fieldsEditing} busy={refBusy} onChange={setEntryPointDraft} dataAttr="data-spec-entry-point"
              onCommit={() => commitRefField('entryPoint', entryPointDraft)}
            />
          </div>

          {fieldsEditing && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.specPriorityLabel')}</span>
              <select
                data-spec-priority value={loaded.priority ?? ''}
                disabled={refBusy}
                onChange={e => commitPriority((e.target.value || null) as WbsPriority | null)}
                className="app-input h-9 text-xs"
              >
                <option value="">{t('wbs.specPriorityNoneOption')}</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p])}</option>)}
              </select>
            </label>
          )}

          {fieldsEditing && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox" data-spec-delegate
                checked={loaded.tags.includes('agent')}
                disabled={refBusy}
                onChange={e => commitAgentDelegate(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line"
              />
              <span className="text-xs font-semibold text-ink">{t('wbs.specAgentDelegateLabel')}</span>
              <span className="text-[10px] text-ink-subtle">{t('wbs.specAgentDelegateHint')}</span>
            </label>
          )}
          {/* 에이전트 프롬프트(0090) — 위임 신호에 덧붙이는 사용자 지시문. 비관리자에게는 값이 있을 때만 표시. */}
          {fieldsEditing ? (
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-[11px] font-semibold text-ink-muted">
                <span>{t('wbs.specAgentPromptLabel')}</span>
                <span className="font-normal text-[10px] text-ink-subtle">{t('wbs.specAgentPromptHint')}</span>
              </span>
              <textarea
                data-agent-prompt value={promptDraft} disabled={refBusy} rows={3}
                onChange={e => setPromptDraft(e.target.value)}
                onBlur={commitAgentPrompt}
                className="app-textarea text-xs" placeholder={t('wbs.specAgentPromptPlaceholder')}
              />
            </label>
          ) : loaded.agentPrompt ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.specAgentPromptLabel')}</div>
              <p className="whitespace-pre-wrap text-xs text-ink">{loaded.agentPrompt}</p>
            </div>
          ) : null}
          {refErr && <p className="text-xs font-medium text-delayed" role="alert">{refErr}</p>}

          <WbsAgentOrderStatus itemId={itemId} editable={editable} refreshKey={orderRefreshKey} />

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink-muted">{t('wbs.specAcceptanceLabel')}</span>
              {loaded.acceptance.length > 0 && (
                <span className="text-[10px] text-ink-subtle">{t('wbs.specAcceptanceHint')}</span>
              )}
            </div>
            {loaded.acceptance.length === 0 ? (
              <p className="text-xs text-ink-subtle">{t('wbs.specAcceptanceNone')}</p>
            ) : (
              <ul className="space-y-1">
                {loaded.acceptance.map((criterion, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink">
                    <input type="checkbox" disabled aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-line" />
                    <span>{criterion}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink-muted">{t('wbs.specBodyLabel')}</span>
              {editable && !specEditing && (
                <button type="button" onClick={openSpecEdit} className="btn btn-ghost h-6 px-2 text-[11px]">
                  <Pencil className="h-3 w-3" /> {t('wbs.specEditToggle')}
                </button>
              )}
            </div>
            {specEditing ? (
              <div className="space-y-2">
                <textarea
                  autoFocus value={specDraft} onChange={e => setSpecDraft(e.target.value)}
                  rows={10} className="app-textarea font-mono text-xs" placeholder={t('wbs.specBodyPlaceholder')}
                />
                {specErr && <p className="text-xs font-medium text-delayed" role="alert">{specErr}</p>}
                <div className="flex gap-2">
                  <button onClick={saveSpec} disabled={specBusy} className="btn btn-primary h-8 px-3 text-xs">
                    {specBusy ? t('wbs.saving') : t('common.save')}
                  </button>
                  <button onClick={() => { setSpecEditing(false); setSpecErr(null) }} className="btn btn-ghost h-8 px-3 text-xs">
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : loaded.spec ? (
              <div className="rounded-lg border border-line bg-surface p-2.5">
                <MarkdownView content={loaded.spec} />
              </div>
            ) : (
              <p className="text-xs text-ink-subtle">{t('wbs.specBodyEmpty')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

const ORDER_STATUS_LABEL: Record<string, DictKey> = {
  ready: 'wbs.agentOrderReady', reported: 'wbs.agentOrderReported',
  approved: 'wbs.agentOrderApproved', rejected: 'wbs.agentOrderRejected', cancelled: 'wbs.agentOrderCancelled',
}

/**
 * "진행 상황" — 이 항목의 최신 에이전트 주문(2026-08-24, agent-ops 화면 대체). 승인·반려는 여전히
 * 사람만 하는 행위라 여기 남는다 — 발행·취소는 위임 체크 하나로 되므로 이 섹션에 버튼을 두지 않는다.
 * 위임한 적 없거나(order:null) 조회 실패면 아무것도 렌더하지 않는다(빈 패널에 소음을 더하지 않는다) —
 * 실패는 refErr 처럼 별도 alert 를 세우지 않고 조용히 숨긴다. 실패가 잦으면 getAgentOrderForItem 의
 * console.error 로그가 남는다.
 */
function WbsAgentOrderStatus({ itemId, editable, refreshKey }: { itemId: string; editable: boolean; refreshKey: number }) {
  const { t } = useLocale()
  const [order, setOrder] = useState<AgentOrderStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reworkNote, setReworkNote] = useState('')
  const [reworking, setReworking] = useState(false)
  // 기본 접힘 — 보고가 쌓이면 이 한 섹션이 명세보다 길어진다. 상태 칩은 접힌 머리에 남겨
  // '승인 대기'를 펼치지 않고도 볼 수 있게 한다.
  const [open, setOpen] = useState(false)

  const reload = useCallback(() => {
    getAgentOrderForItem(itemId).then(r => {
      setOrder(r.ok ? r.order : null)
      if (!r.ok) console.error('[WbsAgentOrderStatus] 조회 실패:', r.error)
    })
  }, [itemId])
  useEffect(() => {
    setOrder(null); setErr(null); setWarn(null); setRejecting(false); setReworking(false); reload()
  }, [reload, refreshKey])

  if (!order || order.status === 'cancelled') return null

  const lastReport = order.reports.at(-1)

  // warning: 본 동작은 성공했지만 실적·단계 같은 후속이 남았다는 신호. 조용히 삼키면 사람이
  // 반쪽 상태를 못 보고, 에러 자리에 넣으면 성공한 동작이 실패로 읽힌다 — 자리를 나눈다.
  async function run(action: () => Promise<{ ok: boolean; error?: string; warning?: string }>) {
    setBusy(true); setErr(null); setWarn(null)
    try {
      const r = await action()
      if (!r.ok) { setErr(r.error ?? t('wbs.agentOrderActionFailed')); return }
      setWarn(r.warning ?? null)
      setRejecting(false); setRejectNote('')
      setReworking(false); setReworkNote('')
      reload()
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button" data-agent-order-toggle
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-ink-muted transition hover:text-ink"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t('wbs.agentOrderTitle')}
        </button>
        <span className={`chip ${order.status === 'reported' ? 'bg-brand-weak text-brand' : 'bg-surface-2 text-ink-muted'}`}>
          {order.status === 'claimed' ? t('wbs.agentOrderClaimed') : t(ORDER_STATUS_LABEL[order.status] ?? 'wbs.agentOrderReady')}
        </span>
      </div>
      {!open ? null : <>
      {order.status === 'claimed' && (
        <p className="text-xs text-ink-subtle">
          {order.claimed_by ?? '—'}
          {isClaimStale(order.claimed_at) && <span className="ml-1 text-delayed">{t('wbs.agentOrderStale')}</span>}
          {lastReport && ` · ${lastReport.percent}%`}
        </p>
      )}
      {order.reports.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {order.reports.map(r => (
            <li key={r.id} className="rounded-md border border-line/60 p-1.5 text-xs">
              <div className="text-[10px] text-ink-subtle">{r.created_at} · {r.agent} · {r.kind} · {r.percent}%</div>
              <p className="whitespace-pre-wrap text-ink">{r.summary}</p>
              {r.links.length > 0 && (
                <div className="mt-0.5 text-[10px]">
                  {t('wbs.agentOrderLinks')}: {r.links.map((l, i) => (
                    <a key={i} className="mr-1.5 underline" href={l.url} target="_blank" rel="noreferrer">{l.label ?? l.url}</a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && order.status === 'reported' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn btn-primary h-7 px-2.5 text-xs" disabled={busy}
            onClick={() => void run(() => approveAgentCompletion(order.id))}>{t('wbs.agentOrderApprove')}</button>
          {rejecting ? (
            <>
              <input className="app-input h-7 w-40 text-xs" aria-label={t('wbs.agentOrderRejectNote')}
                placeholder={t('wbs.agentOrderRejectNote')} value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
              <button type="button" className="btn h-7 px-2.5 text-xs" disabled={busy || !rejectNote.trim()}
                onClick={() => void run(() => rejectAgentCompletion(order.id, rejectNote))}>{t('wbs.agentOrderReject')}</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost h-7 px-2.5 text-xs" disabled={busy}
              onClick={() => setRejecting(true)}>{t('wbs.agentOrderReject')}</button>
          )}
        </div>
      )}
      {editable && order.status === 'approved' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" data-agent-unapprove className="btn btn-ghost h-7 px-2.5 text-xs" disabled={busy}
            onClick={() => void run(() => unapproveAgentCompletion(order.id))}>{t('wbs.agentOrderUnapprove')}</button>
          {reworking ? (
            <>
              <input className="app-input h-7 w-40 text-xs" data-agent-rework-note aria-label={t('wbs.agentOrderReworkNote')}
                placeholder={t('wbs.agentOrderReworkNote')} value={reworkNote} onChange={e => setReworkNote(e.target.value)} />
              <button type="button" data-agent-rework-confirm className="btn h-7 px-2.5 text-xs" disabled={busy || !reworkNote.trim()}
                onClick={() => void run(() => requestAgentRework(order.id, reworkNote))}>{t('wbs.agentOrderRework')}</button>
            </>
          ) : (
            <button type="button" data-agent-rework className="btn btn-ghost h-7 px-2.5 text-xs" disabled={busy}
              onClick={() => setReworking(true)}>{t('wbs.agentOrderRework')}</button>
          )}
        </div>
      )}
      {err && <p className="mt-1.5 text-xs font-medium text-delayed" role="alert">{err}</p>}
      {warn && <p className="mt-1.5 text-xs text-ink-muted" data-agent-warning role="status">{warn}</p>}
      </>}
    </div>
  )
}

function RefField({
  label, value, display, editable, busy, onChange, onCommit, dataAttr,
}: {
  label: string
  value: string
  display: string | null
  editable: boolean
  busy: boolean
  onChange: (v: string) => void
  onCommit: () => void
  /** 테스트·자동화가 이 입력을 집는 표식 — 값 없이 속성만 붙인다. */
  dataAttr?: string
}) {
  const { t } = useLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{label}</span>
      {editable ? (
        <input
          {...(dataAttr ? { [dataAttr]: '' } : {})}
          value={value} disabled={busy} onChange={e => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="app-input h-9 text-xs" placeholder={t('wbs.specRefPlaceholder')}
        />
      ) : (
        <p className="text-sm text-ink">{display ?? t('wbs.specRefPlaceholder')}</p>
      )}
    </label>
  )
}

