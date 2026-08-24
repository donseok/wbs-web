'use client'

import { useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Upload, AlertTriangle, CheckCircle2, Trash2, Plus, ArrowRight, ShieldAlert, RotateCcw, Undo2, Download,
} from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import type { DictKey } from '@/lib/i18n/dict'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import type { ImportError } from '@/lib/excel/validate'
import {
  reducer, initialWizardState, switchHierarchyKind, setOutlineColumn, setLogicalColumn,
  recordToRows, rowsToRecord, deriveMappedPreview, type MarkRow, type ExecuteResult,
  type PreviewColumnRole,
} from '@/lib/domain/importWizard'

/** 논리 열(§B4 ExcelProfile.logical) 8종의 라벨 키 — 셀렉트 목록(name 제외)과 미리보기 배지(name 포함)
 *  양쪽에서 재사용한다. */
const LOGICAL_FIELD_LABEL_KEYS: Record<keyof ExcelProfile['logical'], DictKey> = {
  extraAxis: 'importWizard.fieldExtraAxis',
  code: 'importWizard.fieldCode',
  name: 'importWizard.fieldName',
  deliverable: 'importWizard.fieldDeliverable',
  start: 'importWizard.fieldStart',
  end: 'importWizard.fieldEnd',
  weight: 'importWizard.fieldWeight',
  actualPct: 'importWizard.fieldActualPct',
}

/** name 은 outline 전용이라 계층 섹션에서 따로 렌더한다 — 논리 열 셀렉트 목록에서는 제외. */
const LOGICAL_FIELDS: { key: Exclude<keyof ExcelProfile['logical'], 'name'>; labelKey: DictKey }[] =
  (Object.keys(LOGICAL_FIELD_LABEL_KEYS) as (keyof ExcelProfile['logical'])[])
    .filter((k): k is Exclude<keyof ExcelProfile['logical'], 'name'> => k !== 'name')
    .map(key => ({ key, labelKey: LOGICAL_FIELD_LABEL_KEYS[key] }))

/** 미리보기 표의 열 배지 문구(리뷰 Important #2) — role 은 로케일 무관 구조라 여기서 t() 로 붙인다. */
function previewRoleLabel(role: PreviewColumnRole, t: (k: DictKey) => string): string | null {
  if (!role) return null
  if (role.kind === 'hierarchy') return t('importWizard.previewRoleHierarchy')
  if (role.kind === 'logical') return t(LOGICAL_FIELD_LABEL_KEYS[role.field])
  const teamLabel = role.team === '*' ? t('importWizard.previewRoleTeamDirect') : role.team
  return `${t('importWizard.previewRoleTeam')}: ${teamLabel}`
}

/** replace 성공 응답의 backup 을 파일로 내려받는다(§6.6-2 — 서버는 트리만 담아 보낸다, change_logs 는 대상 아님). */
function downloadBackup(projectId: string, backup: { rows: unknown[]; generatedAt: string }) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wbs-backup-${projectId}-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 프로파일 익스포트(§6.5, 리뷰 Important #1) — `/api/export?expand=1` 를 fetch→blob 로 받아
 *  내려받는다. WeeklySheetView.downloadPpt 와 동일한 관례(fetch→Content-Disposition 파일명 파싱)를
 *  재사용한다 — export.ts 를 건드리지 않고 이미 있는 라우트를 그대로 소비만 한다.
 *  outline+펼침처럼 라우트가 400 으로 거부하는 조합은 그 에러 메시지를 그대로 토스트로 보여준다
 *  (무증상 실패 금지 — 3원칙). */
/** wbs.xlsx 양식 — 프로젝트 무관 정적 파일(/api/import/template). 빈손인 사용자가 마법사가 100% 잡는 형식으로 시작하게. */
async function downloadTemplate(toast: ReturnType<typeof useToast>['toast'], failedTitle: string) {
  const res = await fetch('/api/import/template')
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    toast({ title: failedTitle, description: err?.error, variant: 'error' })
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wbs-양식.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function downloadProfileExport(
  projectId: string,
  toast: ReturnType<typeof useToast>['toast'],
  failedTitle: string,
) {
  const res = await fetch(`/api/export?projectId=${encodeURIComponent(projectId)}&expand=1`)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    toast({ title: failedTitle, description: err?.error, variant: 'error' })
    return
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `wbs_export_${projectId}.xlsx`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-done text-white' : active ? 'bg-brand text-white' : 'bg-surface-2 text-ink-subtle'
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <span className={`text-sm font-semibold ${active || done ? 'text-ink' : 'text-ink-subtle'}`}>{label}</span>
    </div>
  )
}

function radioRowClass(active: boolean): string {
  return `flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
    active ? 'border-brand bg-brand-weak' : 'border-line bg-surface hover:border-line-strong'
  }`
}

/**
 * 임포트 마법사(§6.2) — 1단계 파일 선택+감지, 2단계 확인·편집 후 실행.
 * 파일은 클라이언트 메모리(fileRef)에만 있고 서버에 임시 저장되지 않는다(inspect/execute 매 요청 재업로드).
 */
export function ImportWizard({
  projectId, isSuperuser, currentItemCount,
}: {
  projectId: string
  isSuperuser: boolean
  /** replace 경고에 실제 삭제 건수를 싣기 위한 값(리뷰 Important #1) — 서버 조회 실패 시 null 로
   *  degrade 되어 온다(page.tsx 가 표시=로깅). null 이면 건수 없는 일반 경고 문구로 대체한다. */
  currentItemCount: number | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [state, dispatch] = useReducer(reducer, initialWizardState)
  const [markRows, setMarkRows] = useState<MarkRow[]>([])
  const [exportBusy, setExportBusy] = useState(false)
  const fileRef = useRef<File | null>(null)
  const markIdRef = useRef(0)

  const headers = state.detection?.preview.headers ?? []
  const profile = state.profile
  // 계층 방식·논리 열 편집이 표에 즉시 반영돼야 한다(리뷰 Important #2 — replace 비가역성의 유일한
  // 검증면). 원본 재파싱 없이 detection.preview 를 현재 profile 로 재라벨링만 하므로 가볍다.
  const mappedPreview = useMemo(
    () => (state.detection && profile ? deriveMappedPreview(state.detection.preview.headers, state.detection.preview.rows, profile) : null),
    [state.detection, profile],
  )

  function nextMarkId(): number {
    markIdRef.current += 1
    return markIdRef.current
  }

  function updateProfile(next: ExcelProfile) {
    dispatch({ type: 'profileChanged', profile: next })
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    fileRef.current = file
    dispatch({ type: 'fileSelected', fileName: file?.name ?? '' })
  }

  function startOver() {
    fileRef.current = null
    markIdRef.current = 0
    setMarkRows([])
    dispatch({ type: 'reset' })
  }

  /** 리뷰 Important #2 — savedProfile 로 시작했더라도 실제 업로드 파일이 감지한 프로파일로 되돌린다.
   *  reducer 는 profile 필드만 순수하게 되돌리고(테스트 대상), 마크 사전 행 상태(markRows)는 컴포넌트
   *  로컬이라 여기서 같이 재동기화한다(runInspect 의 초기 세팅과 동일 패턴). */
  function resetToDetected() {
    if (!state.detection) return
    dispatch({ type: 'resetToDetected' })
    const rows = recordToRows(state.detection.profile.ownerMarks)
    setMarkRows(rows)
    markIdRef.current = rows.length
  }

  async function runExportProfile() {
    setExportBusy(true)
    try {
      await downloadProfileExport(projectId, toast, t('importWizard.exportProfileFailedHttp'))
    } finally {
      setExportBusy(false)
    }
  }

  async function runInspect() {
    const file = fileRef.current
    if (!file) { toast({ title: t('importWizard.selectFileFirst'), variant: 'error' }); return }
    dispatch({ type: 'inspectStart' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      const res = await fetch('/api/import/inspect', { method: 'POST', body: fd })
      const data: Record<string, unknown> = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        const detection = data.detection as DetectionResult
        const savedProfile = (data.savedProfile ?? null) as ExcelProfile | null
        dispatch({ type: 'inspectSuccess', detection, savedProfile })
        setMarkRows(recordToRows((savedProfile ?? detection.profile).ownerMarks))
        markIdRef.current = recordToRows((savedProfile ?? detection.profile).ownerMarks).length
      } else {
        const msg = typeof data.error === 'string' ? data.error : t('importWizard.inspectFailedHttp')
        dispatch({ type: 'inspectFailure', error: msg })
        toast({ title: msg, variant: 'error' })
      }
    } catch {
      const msg = t('importWizard.networkError')
      dispatch({ type: 'inspectFailure', error: msg })
      toast({ title: msg, variant: 'error' })
    }
  }

  async function runExecute(registerTeams: boolean) {
    const file = fileRef.current
    if (!file || !profile) return
    dispatch({ type: 'executeStart' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      fd.append('profile', JSON.stringify({ ...profile, ownerMarks: rowsToRecord(markRows) }))
      fd.append('mode', state.mode)
      fd.append('saveProfile', String(state.saveProfile))
      fd.append('registerTeams', String(registerTeams))
      const res = await fetch('/api/import/execute', { method: 'POST', body: fd })
      const data: Record<string, unknown> = await res.json().catch(() => ({}))

      if (res.status === 409 && Array.isArray(data.needsTeams)) {
        const scope = data.scope === 'project' ? 'project' : 'global'
        dispatch({ type: 'executeNeedsTeams', teams: data.needsTeams as string[], scope })
        return
      }
      if (res.ok && data.ok) {
        const result = data as unknown as ExecuteResult
        if (result.backup) downloadBackup(projectId, result.backup)
        dispatch({ type: 'executeSuccess', result })
        toast({ title: t('importWizard.executeSuccessToast'), variant: 'success' })
        router.refresh()
      } else if (Array.isArray(data.errors)) {
        const errs = data.errors as ImportError[]
        dispatch({ type: 'executeValidationFailure', errors: errs })
        toast({ title: `${t('importWizard.linkErrorsPrefix')}${errs.length}${t('importWizard.linkErrorsSuffix')}`, variant: 'error' })
      } else {
        const msg = typeof data.error === 'string' ? data.error : t('importWizard.executeFailedHttp')
        dispatch({ type: 'executeFailure', error: msg })
        toast({ title: msg, variant: 'error' })
      }
    } catch {
      const msg = t('importWizard.networkError')
      dispatch({ type: 'executeFailure', error: msg })
      toast({ title: msg, variant: 'error' })
    }
  }

  return (
    <div className="space-y-5">
      <div className="card flex items-center gap-3 p-4">
        <StepBadge n={1} label={t('importWizard.step1Label')} active={state.step === 'select'} done={state.step !== 'select'} />
        <div className="h-px flex-1 bg-line" />
        <StepBadge n={2} label={t('importWizard.step2Label')} active={state.step === 'review'} done={state.step === 'done'} />
      </div>

      {state.step === 'select' && (
        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">{t('importWizard.templateDesc')}</p>
            <button type="button" className="btn btn-ghost shrink-0" disabled={state.busy}
              onClick={() => void downloadTemplate(toast, t('importWizard.templateFailed'))}>
              <Download className="h-4 w-4" />{t('importWizard.templateButton')}
            </button>
          </div>
          <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 px-6 text-center transition hover:border-brand hover:bg-brand-weak/40">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-sm transition group-hover:border-brand-ring">
              <Upload className="h-5 w-5" />
            </span>
            <span className="mt-4 text-sm font-semibold text-ink">{state.fileName || t('importWizard.chooseExcel')}</span>
            <span className="mt-1 text-xs leading-5 text-ink-muted">{t('importWizard.xlsxOnly')}</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={state.busy}
              onChange={onFileChange}
              aria-label={t('importWizard.chooseExcel')}
              className="mt-4 max-w-full text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-weak file:px-3 file:py-2 file:font-semibold file:text-brand"
            />
          </label>

          {state.error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-delayed">
              <AlertTriangle className="h-4 w-4 shrink-0" />{state.error}
            </p>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" disabled={!state.fileName || state.busy} onClick={runInspect}>
              {state.busy ? t('importWizard.inspecting') : t('importWizard.analyze')}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {state.step === 'review' && state.detection && profile && (
        <div className="space-y-5">
          {state.detection.warnings.length > 0 && (
            <div role="alert" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.detectionWarningsTitle')}
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted">
                {state.detection.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div className="card space-y-6 p-6">
            {/* 리뷰 Important #2 — savedProfile 을 기본값으로 시작한 경우에도(레거시 프로젝트 +
                새 양식 파일) 업로드 파일이 실제로 감지한 프로파일로 되돌릴 길을 열어 둔다. */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
              <p className="text-xs leading-5 text-ink-subtle">{t('importWizard.resetToDetectedDesc')}</p>
              <button
                type="button"
                className="btn btn-ghost shrink-0"
                disabled={state.busy}
                onClick={resetToDetected}
                aria-label={t('importWizard.resetToDetectedButton')}
              >
                <Undo2 className="h-4 w-4" />{t('importWizard.resetToDetectedButton')}
              </button>
            </div>

            {/* ── 계층 방식 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-ink-muted">{t('importWizard.hierarchyLegend')}</legend>
              {(['columns', 'outline'] as const).map(kind => {
                const active = profile.hierarchy.kind === kind
                const label = kind === 'columns' ? t('importWizard.hierarchyColumns') : t('importWizard.hierarchyOutline')
                const desc = kind === 'columns' ? t('importWizard.hierarchyColumnsDesc') : t('importWizard.hierarchyOutlineDesc')
                return (
                  <label key={kind} className={radioRowClass(active)}>
                    <input
                      type="radio"
                      name="hierarchy-kind"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                      checked={active}
                      disabled={state.busy}
                      onChange={() => updateProfile(switchHierarchyKind(profile, kind))}
                      aria-label={label}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-brand' : 'text-ink'}`}>{label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{desc}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {profile.hierarchy.kind === 'outline' ? (
              <div className="grid gap-3 pl-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('importWizard.outlineColumnLabel')}</span>
                  <select
                    className="app-input"
                    aria-label={t('importWizard.outlineColumnLabel')}
                    disabled={state.busy}
                    value={String(profile.hierarchy.column)}
                    onChange={e => updateProfile(setOutlineColumn(profile, Number(e.target.value)))}
                  >
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('importWizard.fieldName')}</span>
                  <select
                    className="app-input"
                    aria-label={t('importWizard.fieldName')}
                    disabled={state.busy}
                    value={profile.logical.name === null ? '' : String(profile.logical.name)}
                    onChange={e => updateProfile(setLogicalColumn(profile, 'name', e.target.value === '' ? null : Number(e.target.value)))}
                  >
                    <option value="">{t('importWizard.columnNone')}</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <p className="pl-4 text-xs leading-5 text-ink-subtle">
                {t('importWizard.columnsHint')}
                {profile.hierarchy.columns.map(c => headers[c] || `#${c}`).join(', ')}
              </p>
            )}

            {/* ── 논리 열 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-ink-muted">{t('importWizard.logicalLegend')}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {LOGICAL_FIELDS.map(f => (
                  <label key={f.key} className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t(f.labelKey)}</span>
                    <select
                      className="app-input"
                      aria-label={t(f.labelKey)}
                      disabled={state.busy}
                      value={profile.logical[f.key] === null ? '' : String(profile.logical[f.key])}
                      onChange={e => updateProfile(setLogicalColumn(profile, f.key, e.target.value === '' ? null : Number(e.target.value)))}
                    >
                      <option value="">{t('importWizard.columnNone')}</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ── 마크 사전 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-ink-muted">{t('importWizard.marksLegend')}</legend>
              <div className="space-y-2">
                {markRows.map(row => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      className="app-input w-24 shrink-0 text-center"
                      value={row.key}
                      maxLength={4}
                      disabled={state.busy}
                      onChange={e => setMarkRows(rows => rows.map(r => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                      aria-label={t('importWizard.markKeyLabel')}
                    />
                    <select
                      className="app-input"
                      value={row.kind}
                      disabled={state.busy}
                      onChange={e => setMarkRows(rows => rows.map(r => (r.id === row.id ? { ...r, kind: e.target.value as MarkRow['kind'] } : r)))}
                      aria-label={t('importWizard.markKindLabel')}
                    >
                      <option value="primary">{t('importWizard.markPrimary')}</option>
                      <option value="support">{t('importWizard.markSupport')}</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost h-9 w-9 shrink-0 !px-0"
                      disabled={state.busy}
                      onClick={() => setMarkRows(rows => rows.filter(r => r.id !== row.id))}
                      aria-label={t('importWizard.markDelete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={state.busy}
                onClick={() => setMarkRows(rows => [...rows, { id: nextMarkId(), key: '', kind: 'primary' }])}
              >
                <Plus className="h-4 w-4" />{t('importWizard.markAdd')}
              </button>
            </fieldset>

            {/* ── 모드 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-ink-muted">{t('importWizard.modeLegend')}</legend>
              {(['append', 'replace'] as const).map(mode => {
                const active = state.mode === mode
                const label = mode === 'append' ? t('importWizard.modeAppend') : t('importWizard.modeReplace')
                const desc = mode === 'append' ? t('importWizard.modeAppendDesc') : t('importWizard.modeReplaceDesc')
                return (
                  <label key={mode} className={radioRowClass(active)}>
                    <input
                      type="radio"
                      name="import-mode"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                      checked={active}
                      disabled={state.busy}
                      onChange={() => dispatch({ type: 'modeChanged', mode })}
                      aria-label={label}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-brand' : 'text-ink'}`}>{label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{desc}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {state.mode === 'replace' && (
              <div role="alert" className="rounded-xl border border-delayed/30 bg-delayed-weak/40 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-delayed">
                  <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.replaceWarnTitle')}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-ink-muted">
                  <li>
                    {currentItemCount !== null
                      ? <>{t('importWizard.replaceWarnDeleteCountPrefix')}{currentItemCount}{t('importWizard.replaceWarnDeleteCountSuffix')}</>
                      : t('importWizard.replaceWarnDelete')}
                  </li>
                  <li>{t('importWizard.replaceWarnChangeLogs')}</li>
                  <li>{t('importWizard.replaceWarnHolidays')}</li>
                  <li>{t('importWizard.replaceWarnBackup')}</li>
                </ul>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-[var(--color-brand)]"
                checked={state.saveProfile}
                disabled={state.busy}
                onChange={e => dispatch({ type: 'saveProfileChanged', saveProfile: e.target.checked })}
                aria-label={t('importWizard.saveProfileLabel')}
              />
              {t('importWizard.saveProfileLabel')}
            </label>
          </div>

          <div className="card space-y-3 p-6">
            <h3 className="text-sm font-semibold text-ink">{t('importWizard.previewTitle')}</h3>
            <p className="text-xs leading-5 text-ink-subtle">{t('importWizard.previewHint')}</p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="border-b border-line px-2 py-1.5 text-left font-semibold text-ink-muted">{t('importWizard.previewDepthCol')}</th>
                    {mappedPreview?.columns.map(col => {
                      const badge = previewRoleLabel(col.role, t)
                      return (
                        <th
                          key={col.index}
                          className={`border-b border-line px-2 py-1.5 text-left font-semibold ${col.role?.kind === 'hierarchy' ? 'bg-brand-weak text-brand' : 'text-ink-muted'}`}
                        >
                          <div>{col.label}</div>
                          {badge && <div className="mt-0.5 text-[10px] font-normal text-ink-subtle">{badge}</div>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreview?.rows.map((row, ri) => (
                    <tr key={ri} className="odd:bg-surface even:bg-surface-2/40">
                      <td className="border-b border-line px-2 py-1.5 text-center text-ink-subtle">{row.depth === null ? '?' : row.depth}</td>
                      {mappedPreview.columns.map(col => (
                        <td
                          key={col.index}
                          className={`border-b border-line px-2 py-1.5 text-ink ${col.role?.kind === 'hierarchy' ? 'bg-brand-weak/30' : ''}`}
                        >
                          {String(row.cells[col.index] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {state.errors && state.errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-delayed/30 bg-delayed-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-delayed">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.linkErrorsPrefix')}{state.errors.length}{t('importWizard.linkErrorsSuffix')}
              </p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs leading-5 text-ink-muted">
                {state.errors.map((er, i) => (
                  <li key={i}>{t('importWizard.excelRowPrefix')}{er.excelRow}{t('importWizard.excelRowSuffix')}{er.message}</li>
                ))}
              </ul>
            </div>
          )}
          {state.error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-delayed">
              <AlertTriangle className="h-4 w-4 shrink-0" />{state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" className="btn btn-ghost" disabled={state.busy} onClick={startOver}>
              <RotateCcw className="h-4 w-4" />{t('importWizard.startOver')}
            </button>
            <button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => runExecute(false)}>
              {state.busy ? t('importWizard.executing') : t('importWizard.execute')}
            </button>
          </div>
        </div>
      )}

      {state.step === 'done' && state.result && (
        <div className="card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-done-weak text-done">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">{t('importWizard.doneTitle')}</h2>
              <p className="text-sm text-ink-muted">{state.result.count}{t('importWizard.doneCountSuffix')}</p>
            </div>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneMode')}</dt>
              <dd className="mt-1 font-semibold text-ink">{state.result.mode === 'append' ? t('importWizard.modeAppend') : t('importWizard.modeReplace')}</dd>
            </div>
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneReindexed')}</dt>
              <dd className="mt-1 font-semibold text-ink">{state.result.reindexed}</dd>
            </div>
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneProfileSaved')}</dt>
              <dd className="mt-1 font-semibold text-ink">{state.result.profileSaved ? t('importWizard.savedYes') : t('importWizard.savedNo')}</dd>
            </div>
          </dl>

          {state.result.warnings && state.result.warnings.length > 0 && (
            <div role="status" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.doneWarningsTitle')}
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-muted">
                {state.result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* 리뷰 Important #1 — §6.5 프로파일 익스포트(펼침)가 UI 에서 도달 불가했다. 완료 화면이
              이 프로파일로 다시 내보낼 수 있는 유일하고 자연스러운 지점(방금 쓴 프로파일이 최신 상태). */}
          <div className="panel-soft flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-semibold text-ink">{t('importWizard.exportProfileTitle')}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-muted">{t('importWizard.exportProfileDesc')}</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost shrink-0"
              disabled={exportBusy}
              onClick={runExportProfile}
              aria-label={t('importWizard.exportProfileButton')}
            >
              <Download className="h-4 w-4" />
              {exportBusy ? t('importWizard.exportProfileBusy') : t('importWizard.exportProfileButton')}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href={`/p/${projectId}/wbs`} className="btn btn-primary">
              <ArrowRight className="h-4 w-4" />{t('importWizard.gotoWbs')}
            </Link>
            <button type="button" className="btn btn-ghost" onClick={startOver}>{t('importWizard.importAnother')}</button>
          </div>
        </div>
      )}

      <Modal
        open={state.needsTeams !== null}
        onClose={() => dispatch({ type: 'dismissNeedsTeams' })}
        title={t('importWizard.needsTeamsTitle')}
        eyebrow="TEAMS"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'dismissNeedsTeams' })}>{t('common.cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={state.needsTeamsScope === 'project' ? state.busy : (!isSuperuser || state.busy)}
              onClick={() => runExecute(true)}
            >
              {state.busy ? t('importWizard.registering') : t('importWizard.registerTeams')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink">{t('importWizard.needsTeamsDesc')}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(state.needsTeams ?? []).map(team => (
            <li key={team} className="badge bg-brand-weak px-2 py-1 text-brand">{team}</li>
          ))}
        </ul>
        {state.needsTeamsScope === 'project' ? (
          <p className="mt-3 text-xs leading-5 text-ink-subtle">{t('importWizard.needsTeamsProjectScope')}</p>
        ) : !isSuperuser && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-pending">
            <ShieldAlert className="h-3.5 w-3.5" />{t('importWizard.needsTeamsSuperuserOnly')}
          </p>
        )}
      </Modal>
    </div>
  )
}
