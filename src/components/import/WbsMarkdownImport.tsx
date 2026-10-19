'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText, Upload, XCircle } from 'lucide-react'
import { previewWbsUpload, applyWbsUpload, type WbsUploadPreview } from '@/app/actions/wbsMarkdown'

/** module 입력 후 미리보기를 다시 계산하기까지 기다리는 시간 — 글자마다 서버를 부르지 않게. */
const MODULE_DEBOUNCE_MS = 400

const FORMAT_LABEL: Record<NonNullable<WbsUploadPreview['format']>, string> = {
  nlevel: 'N단 levels 계약',
  classic: '기존 3~4단 (dflow-wbs)',
  unknown: '판정 불가',
}

/**
 * wbs.md 웹 업로드 — "자동 부착 + 확인"(스펙 §업로드 경로 2개).
 * 파일을 고르면 서버가 형식(N단 levels 계약 | 기존 3~4단)을 판정하고 부착점·levels 정합·신규/갱신을 계산해
 * 미리보기 카드를 그리며, 사람은 노드를 고르지 않고 [적용/취소]만 한다. 잘못된 파일이면 부착점 표시에서 드러난다.
 * 기존 3~4단 파일에는 module 이 없어 사람이 정한다 — 서버 제안으로 미리 채우고, 바꾸면 미리보기를 다시 계산한다.
 */
export function WbsMarkdownImport({ projectId }: { projectId: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<WbsUploadPreview | null>(null)
  const [moduleInput, setModuleInput] = useState('')
  const [result, setResult] = useState<{
    upserted?: number; ordersCreated?: number; unmatched?: Array<{ id: string; assignee: string }>
    taskCount?: number; agentStopped?: boolean
    delegationCancelled?: number; delegationCancelFailed?: string[]
  } | null>(null)
  const [pending, startTransition] = useTransition()
  // 늦게 도착한 옛 미리보기 응답이 새 것을 덮지 않게 요청마다 번호를 매긴다.
  const seqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function cancelPendingPreview() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    seqRef.current += 1
  }

  function reset() {
    cancelPendingPreview()
    setFileName(null); setText(null); setPreview(null); setResult(null); setModuleInput('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const t = await f.text()
    cancelPendingPreview()
    const seq = seqRef.current
    setFileName(f.name); setText(t); setResult(null); setModuleInput('')
    startTransition(async () => {
      const p = await previewWbsUpload(projectId, t)
      if (seq !== seqRef.current) return
      setPreview(p)
      if (p.ok && p.format === 'classic') setModuleInput(p.module ?? '')
    })
  }

  function onModuleChange(value: string) {
    setModuleInput(value)
    if (!text) return
    cancelPendingPreview()
    const seq = seqRef.current
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      startTransition(async () => {
        const p = await previewWbsUpload(projectId, text, { module: value })
        if (seq !== seqRef.current) return
        setPreview(p)
      })
    }, MODULE_DEBOUNCE_MS)
  }

  function apply() {
    if (!text || !preview) return
    const classicModule = preview.format === 'classic' ? (preview.module ?? '') : null
    startTransition(async () => {
      const r = classicModule === null
        ? await applyWbsUpload(projectId, text)
        : await applyWbsUpload(projectId, text, { module: classicModule })
      if (!r.ok) {
        setPreview(p => p ? { ...p, errors: [...(p.errors ?? []), r.error ?? '업로드에 실패했습니다.'], canApply: false } : p)
        return
      }
      setResult(r)
      router.refresh()
    })
  }

  const isClassic = preview?.format === 'classic'
  // 입력한 module 과 미리보기의 module 이 다르면 미리보기가 낡았다 — 다시 계산될 때까지 적용을 막는다.
  const previewStale = isClassic && moduleInput.trim() !== (preview?.module ?? '')

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-ink-subtle" />
        <h3 className="text-sm font-semibold">WBS 마크다운 업로드 (wbs.md)</h3>
      </div>
      <p className="text-xs leading-5 text-ink-subtle">
        두 형식을 모두 받습니다 — 형식은 파일 내용으로 자동 판정합니다.
        N단 levels 계약 wbs.md 는 파일의 attach 로 부착점을 자동 판정하고, 골격 파일(attach 없음)은 단계 정본(levels)을 시드합니다.
        dflow-wbs 기존 3~4단 wbs.md(## WP- 아래 ### TSK- 헤딩)는 module 을 정해 프로젝트 루트에 올립니다.
        아래 미리보기를 확인한 뒤 적용하세요.
      </p>

      <div className="flex items-center gap-3">
        <label className="btn btn-ghost cursor-pointer">
          <Upload className="h-3.5 w-3.5" />
          파일 선택
          <input ref={fileRef} data-md-file type="file" accept=".md,text/markdown" className="hidden" onChange={onFile} disabled={pending} />
        </label>
        <span className="text-xs text-ink-subtle">{fileName ?? '선택된 파일 없음 (.md)'}</span>
      </div>

      {preview && !preview.ok && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-weak/40 p-3 text-xs text-danger">
          {preview.error}
        </p>
      )}

      {preview?.ok && (
        <div data-md-preview className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
            {preview.format && <Info label="형식" value={FORMAT_LABEL[preview.format]} tone={preview.format === 'unknown' ? 'danger' : undefined} />}
            {isClassic ? (
              <>
                <Info label="부착점" value="루트 (기존 형식은 attach 없음)" />
                <Info label="신규 / 갱신" value={preview.newCount === undefined ? '— (module 필요)' : `${preview.newCount} / ${preview.updateCount ?? 0}`} />
              </>
            ) : preview.format !== 'unknown' && (
              <>
                <Info label="종류" value={preview.mode === 'skeleton' ? '골격(PMO)' : 'PL 모듈'} />
                <Info label="module" value={preview.module ?? '—'} />
                <Info
                  label="부착점"
                  value={preview.mode === 'skeleton' ? '루트(Phase 층)' : `${preview.attach ?? '—'} → ${preview.attachRef ?? '해석 실패'}`}
                  tone={preview.mode === 'skeleton' || preview.attachFound ? undefined : 'danger'}
                />
                <Info
                  label="levels"
                  value={preview.levelsStatus === 'seed' ? `시드 예정 (${preview.fileLevels?.length}층)` : preview.levelsStatus === 'match' ? '정본 일치' : '정본 불일치'}
                  tone={preview.levelsStatus === 'mismatch' ? 'danger' : undefined}
                />
                <Info label="신규 / 갱신" value={`${preview.newCount ?? 0} / ${preview.updateCount ?? 0}`} />
                <Info label="acceptance 로 접힘(fold)" value={String(preview.foldCount ?? 0)} />
              </>
            )}
          </div>

          {isClassic && !result && (
            <div data-md-module className="space-y-2 rounded-lg border border-brand-ring/60 bg-brand-weak/50 p-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold">
                  module <span className="text-danger">(필수)</span> — 이 파일 항목의 키 앞부분(module/ID)
                </span>
                <input
                  data-md-module-input
                  className="app-input"
                  value={moduleInput}
                  onChange={e => onModuleChange(e.target.value)}
                  placeholder="예: oranda"
                  maxLength={32}
                  required
                  aria-required="true"
                  aria-invalid={!moduleInput.trim()}
                />
              </label>
              <p className="text-xs leading-5 text-ink-subtle">
                {preview.moduleSuggested
                  ? `제안값 ${preview.moduleSuggested} — 이 프로젝트에 이미 올라간 기존 형식 항목 중 가장 많은 module 입니다.`
                  : '제안할 module 이 없습니다 — 처음 올리는 파일이면 새 이름을 정하세요(영문·숫자·_·- 1~32자).'}
              </p>
              <p className="flex items-start gap-1.5 text-xs leading-5 text-accent-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  재업로드 때는 처음 올린 module 을 그대로 쓰세요. module 을 바꾸면 기존 항목이 갱신되지 않고 같은 트리가 하나 더 생깁니다.
                </span>
              </p>
              {previewStale && <p className="text-xs text-ink-subtle">module 이 바뀌어 미리보기를 다시 계산하는 중입니다…</p>}
            </div>
          )}

          {preview.counts && Object.keys(preview.counts).length > 0 && (
            <p className="text-xs text-ink-subtle">
              {Object.entries(preview.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}
            </p>
          )}

          {(preview.errors?.length ?? 0) > 0 && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-weak/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <XCircle className="h-3.5 w-3.5" />검증 에러 {preview.errors!.length}건 — 적용 불가
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-ink-muted">
                {preview.errors!.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {(preview.warnings?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-pending/30 bg-pending-weak/30 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />경고 {preview.warnings!.length}건 (적용은 가능)
              </p>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-ink-muted">
                {preview.warnings!.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {result ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                적용 완료 — {result.upserted}건 반영, 주문 {result.ordersCreated ?? 0}건 발행
                {result.taskCount !== undefined && ` (task ${result.taskCount}건)`}
                {(result.unmatched?.length ?? 0) > 0 && ` · 담당자 미매칭 ${result.unmatched!.length}건: ${result.unmatched!.map(u => u.assignee).join(', ')}`}
              </p>
              {/* 침묵 실패 방지(2026-08-24 리허설 실측) — task 가 있는데 주문 0 이면 원인을 바로 말한다. */}
              {(result.taskCount ?? 0) > 0 && (result.ordersCreated ?? 0) === 0 && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-pending/30 bg-pending-weak/30 p-3 text-xs text-pending">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    task {result.taskCount}건이 있는데 주문이 0건입니다.{' '}
                    {result.agentStopped
                      ? '프로젝트가 "에이전트 중지" 상태입니다 — 설정 › 에이전트에서 재개하면 백필로 주문이 발행됩니다.'
                      : '이미 활성 주문이 있는 항목(재업로드)이거나 task 가 리프가 아닙니다. WBS 화면에서 확인하세요.'}
                  </span>
                </p>
              )}
              {/* L7(리뷰 수정 1회차) — 위임 표식이 빠진 항목의 ready·claimed 주문을 취소했음을 알린다. */}
              {(result.delegationCancelled ?? 0) > 0 && (
                <p className="text-xs text-ink-subtle">
                  위임 표식이 빠진 작업 {result.delegationCancelled}건의 에이전트 주문을 취소했습니다.
                </p>
              )}
              {(result.delegationCancelFailed?.length ?? 0) > 0 && (
                <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger-weak/30 p-3 text-xs text-danger">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    주문 취소에 실패한 작업이 있습니다: {result.delegationCancelFailed!.join(', ')}.{' '}
                    그 작업에서 「중단」을 누르거나 위임을 켰다가 끄세요.
                  </span>
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button data-md-apply className="btn btn-primary" onClick={apply} disabled={pending || previewStale || !preview.canApply}>
                적용
              </button>
              <button data-md-cancel className="btn btn-ghost" onClick={reset} disabled={pending}>
                취소
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div>
      <span className="text-ink-subtle">{label}</span>{' '}
      <span className={tone === 'danger' ? 'font-semibold text-danger' : 'font-medium'}>{value}</span>
    </div>
  )
}
