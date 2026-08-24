'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { FileText, Pencil } from 'lucide-react'
import { getWbsSpec, setAgentDelegation, updateAgentPrompt, updateWbsSpec, updateWbsSpecFields, type WbsPriority, type WbsSpecDetail } from '@/app/actions/wbsSpec'
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

/** depends 항목은 external_ref 형식(<module>/<id>) — 마지막 세그먼트만 표시, 전체는 title 로. */
function lastSegment(ref: string): string {
  const idx = ref.lastIndexOf('/')
  return idx === -1 ? ref : ref.slice(idx + 1)
}

/**
 * WBS 명세 패널(Task 12A, 결정 B) — 스칼라 배지(category·domain·priority·model·tags),
 * 참조 필드 인라인 편집(prd_ref·entry_point·priority), depends 목록(external_ref 마지막
 * 세그먼트 표시), acceptance 체크리스트(읽기 전용 — 정본은 import), spec 마크다운
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
  const [specBusy, setSpecBusy] = useState(false)
  const [specErr, setSpecErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setSpecEditing(false); setSpecErr(null); setRefErr(null)
    getWbsSpec(itemId).then(r => {
      if (!alive) return
      setLoaded(r ?? 'error')
      if (r) { setPrdRefDraft(r.prdRef ?? ''); setEntryPointDraft(r.entryPoint ?? ''); setPromptDraft(r.agentPrompt ?? '') }
    })
    return () => { alive = false }
  }, [itemId])

  async function commitRefField(field: 'prdRef' | 'entryPoint', raw: string) {
    if (!loaded || loaded === 'error') return
    const value = raw.trim() || null
    const current = field === 'prdRef' ? loaded.prdRef : loaded.entryPoint
    if (value === current) return // 변경 없음 — 쓰기 스킵(wbsAssign.ts 의 상태 비교 멱등 관례)
    setRefBusy(true); setRefErr(null)
    const apiField = field === 'prdRef' ? 'prd_ref' : 'entry_point'
    const res = await updateWbsSpecFields(itemId, { [apiField]: value })
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, [field]: value } : prev))
    router.refresh()
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
    setLoaded(prev => (prev && prev !== 'error'
      ? { ...prev, tags: delegated ? [...prev.tags.filter(tg => tg !== 'agent'), 'agent'] : prev.tags.filter(tg => tg !== 'agent') }
      : prev))
    router.refresh()
  }

  async function commitAgentPrompt() {
    if (!loaded || loaded === 'error') return
    const value = promptDraft.trim() || null
    if (value === loaded.agentPrompt) return // 변경 없음 — 쓰기 스킵(멱등 관례)
    setRefBusy(true); setRefErr(null)
    const res = await updateAgentPrompt(itemId, promptDraft)
    setRefBusy(false)
    if (!res.ok) { setRefErr(res.error ?? t('wbs.specRefSaveFail')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, agentPrompt: value } : prev))
    router.refresh()
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
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        <FileText className="h-3.5 w-3.5" /> {t('wbs.specPanelTitle')}
      </div>

      {loaded === null ? (
        <p className="mt-2 text-xs text-ink-subtle">{t('common.loading')}</p>
      ) : loaded === 'error' ? (
        <p className="mt-2 text-xs font-medium text-delayed">{t('wbs.specLoadFail')}</p>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {loaded.category && <span className="chip bg-surface-2 text-ink-muted">{loaded.category}</span>}
            {loaded.domain && <span className="chip bg-surface-2 text-ink-muted">{loaded.domain}</span>}
            {loaded.priority && <span className="chip bg-brand-weak text-brand">{t(PRIORITY_KEYS[loaded.priority])}</span>}
            {loaded.model && <span className="chip bg-surface-2 text-ink-muted">{loaded.model}</span>}
            {loaded.tags.map(tag => (
              <span key={tag} className="chip border border-line text-ink-subtle">{tag}</span>
            ))}
            {!hasScalarBadge && <span className="text-xs text-ink-subtle">{t('wbs.specNone')}</span>}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <RefField
              label={t('wbs.specPrdRefLabel')} value={prdRefDraft} display={loaded.prdRef}
              editable={editable} busy={refBusy} onChange={setPrdRefDraft}
              onCommit={() => commitRefField('prdRef', prdRefDraft)}
            />
            <RefField
              label={t('wbs.specEntryPointLabel')} value={entryPointDraft} display={loaded.entryPoint}
              editable={editable} busy={refBusy} onChange={setEntryPointDraft}
              onCommit={() => commitRefField('entryPoint', entryPointDraft)}
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t('wbs.specPriorityLabel')}</span>
            {editable ? (
              <select
                value={loaded.priority ?? ''}
                disabled={refBusy}
                onChange={e => commitPriority((e.target.value || null) as WbsPriority | null)}
                className="app-input h-9 text-xs"
              >
                <option value="">{t('wbs.specPriorityNoneOption')}</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{t(PRIORITY_KEYS[p])}</option>)}
              </select>
            ) : (
              <p className="text-sm text-ink">
                {loaded.priority ? t(PRIORITY_KEYS[loaded.priority]) : t('wbs.specPriorityNoneOption')}
              </p>
            )}
          </label>

          {editable && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
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
          {editable ? (
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

          <div>
            <div className="mb-1 text-[11px] font-semibold text-ink-muted">{t('wbs.specDependsLabel')}</div>
            {loaded.depends.length === 0 ? (
              <p className="text-xs text-ink-subtle">{t('wbs.specDependsNone')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {loaded.depends.map(dep => (
                  <li key={dep} title={dep} className="chip border border-line text-ink-subtle">{lastSegment(dep)}</li>
                ))}
              </ul>
            )}
          </div>

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

function RefField({
  label, value, display, editable, busy, onChange, onCommit,
}: {
  label: string
  value: string
  display: string | null
  editable: boolean
  busy: boolean
  onChange: (v: string) => void
  onCommit: () => void
}) {
  const { t } = useLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{label}</span>
      {editable ? (
        <input
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
