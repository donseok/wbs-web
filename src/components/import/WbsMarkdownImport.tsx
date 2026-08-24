'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText, Upload, XCircle } from 'lucide-react'
import { previewWbsUpload, applyWbsUpload, type WbsUploadPreview } from '@/app/actions/wbsMarkdown'

/**
 * wbs.md 웹 업로드 — "자동 부착 + 확인"(스펙 §업로드 경로 2개).
 * 파일을 고르면 서버가 부착점·levels 정합·신규/갱신을 판정해 미리보기 카드를 그리고,
 * 사람은 노드를 고르지 않고 [적용/취소]만 한다. 잘못된 파일이면 부착점 표시에서 드러난다.
 */
export function WbsMarkdownImport({ projectId }: { projectId: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<WbsUploadPreview | null>(null)
  const [result, setResult] = useState<{ upserted?: number; ordersCreated?: number; unmatched?: Array<{ id: string; assignee: string }>; taskCount?: number; agentStopped?: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  function reset() {
    setFileName(null); setText(null); setPreview(null); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const t = await f.text()
    setFileName(f.name); setText(t); setResult(null)
    startTransition(async () => setPreview(await previewWbsUpload(projectId, t)))
  }

  function apply() {
    if (!text) return
    startTransition(async () => {
      const r = await applyWbsUpload(projectId, text)
      if (!r.ok) {
        setPreview(p => p ? { ...p, errors: [...(p.errors ?? []), r.error ?? '업로드에 실패했습니다.'], canApply: false } : p)
        return
      }
      setResult(r)
      router.refresh()
    })
  }

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-ink-subtle" />
        <h3 className="text-sm font-semibold">WBS 마크다운 업로드 (wbs.md)</h3>
      </div>
      <p className="text-xs leading-5 text-ink-subtle">
        levels 계약(N단) wbs.md 를 업로드합니다. 부착점은 파일의 attach 로 자동 판정되며,
        아래 미리보기를 확인한 뒤 적용하세요. 골격 파일(attach 없음)은 단계 정본(levels)을 시드합니다.
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
          </div>

          {preview.counts && (
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
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button data-md-apply className="btn btn-primary" onClick={apply} disabled={pending || !preview.canApply}>
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
