'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Loader2,
  Presentation,
  Sparkles,
} from 'lucide-react'
import { ensureIssueAnalysisAction } from '@/app/actions/issueAnalysis'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import type { Issue } from '@/lib/domain/issues'
import {
  buildIssueAnalysisPreflight,
  type IssueAnalysisReport,
} from '@/lib/report/issues/model'
import type { IssueAnalysisTemplateDiagnostic } from '@/lib/report/issues/template'
import type { IssueAnalysisPptExportDiagnostic } from '@/lib/report/issues/export'

interface AnalysisResult {
  runId: string
  analysis: IssueAnalysisReport
  template: IssueAnalysisTemplateDiagnostic
  pptExport: IssueAnalysisPptExportDiagnostic
}

export function IssueAnalysisModal({
  open,
  onClose,
  projectId,
  issues,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  issues: Issue[]
}) {
  const { t } = useLocale()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preflight = useMemo(() => buildIssueAnalysisPreflight(issues), [issues])
  const populatedAreas = preflight.areas.filter(area => area.count > 0)
  const canGenerate = preflight.totalCount > 0 && preflight.blockedCount === 0

  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
  }, [open, issues])

  function generate() {
    if (!canGenerate || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const response = await ensureIssueAnalysisAction(projectId)
        if (
          response.ok
          && response.runId
          && response.analysis
          && (response.state === 'ready' || response.state === 'generated')
        ) {
          setResult({
            runId: response.runId,
            analysis: response.analysis,
            template: response.template,
            pptExport: response.pptExport,
          })
          return
        }
        setResult(null)
        setError(response.error ?? t('issue.analysis.unavailable'))
      } catch (cause) {
        setResult(null)
        setError(cause instanceof Error && cause.message
          ? cause.message
          : t('issue.analysis.unavailable'))
      }
    })
  }

  const canDownload = result?.template.status === 'ready'
    && result.pptExport.status === 'ready'
  const downloadTitle = result?.template.status !== 'ready'
    ? result?.template.message
    : result?.pptExport.message

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <button type="button" onClick={onClose} disabled={pending} className="btn btn-ghost text-xs">
        {t('issue.analysis.close')}
      </button>
      {result && (
        canDownload ? (
          <a
            href={`/api/issue-analysis?projectId=${encodeURIComponent(projectId)}&runId=${encodeURIComponent(result.runId)}`}
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            <Presentation className="h-3.5 w-3.5" />
            {t('issue.analysis.download')}
          </a>
        ) : (
          <button
            type="button"
            disabled
            title={downloadTitle}
            className="btn btn-ghost inline-flex items-center gap-1.5 text-xs"
          >
            <Presentation className="h-3.5 w-3.5" />
            {t('issue.analysis.download')}
          </button>
        )
      )}
      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate || pending}
        className="btn btn-primary inline-flex items-center gap-1.5 text-xs"
      >
        {pending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="h-3.5 w-3.5" />}
        {pending ? t('issue.analysis.generating') : t('issue.analysis.generate')}
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose() }}
      eyebrow="Issue analysis"
      title={t('issue.analysis.title')}
      size="lg"
      footer={footer}
    >
      <div className="space-y-5">
        <p className="text-sm leading-6 text-ink-muted">{t('issue.analysis.desc')}</p>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-done/30 bg-done-weak p-4">
            <div className="text-xs font-semibold text-done">
              {t('issue.analysis.readyCount').replace('{n}', String(preflight.readyCount))}
            </div>
          </div>
          <div className={`rounded-2xl border p-4 ${
            preflight.blockedCount > 0
              ? 'border-delayed/30 bg-delayed-weak'
              : 'border-line bg-surface-2'
          }`}>
            <div className={`text-xs font-semibold ${
              preflight.blockedCount > 0 ? 'text-delayed' : 'text-ink-muted'
            }`}>
              {t('issue.analysis.blockedCount').replace('{n}', String(preflight.blockedCount))}
            </div>
          </div>
        </section>

        {populatedAreas.length > 0 && (
          <section>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Mega
            </div>
            <div className="flex flex-wrap gap-1.5">
              {populatedAreas.map(area => (
                <span key={area.megaCode} className="chip bg-surface-2 text-ink">
                  {area.megaCode} · {area.megaName} {area.count}
                </span>
              ))}
            </div>
          </section>
        )}

        {preflight.totalCount === 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink-muted">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
            {t('issue.empty.title')}
          </div>
        ) : preflight.blockedCount === 0 ? (
          <div className="flex items-start gap-2 rounded-2xl border border-done/30 bg-done-weak p-4 text-sm text-done">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {t('issue.analysis.preflightOk')}
          </div>
        ) : (
          <section className="rounded-2xl border border-delayed/30 bg-delayed-weak p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-delayed">
              <AlertTriangle className="h-4 w-4" />
              {t('issue.analysis.blockedTitle')}
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {preflight.blockedIssues.map(issue => (
                <Link
                  key={issue.id}
                  href={`/p/${encodeURIComponent(projectId)}/issues?focus=${encodeURIComponent(issue.id)}`}
                  className="block rounded-xl border border-delayed/20 bg-surface px-3 py-2 transition hover:border-delayed/50"
                  onClick={onClose}
                >
                  <div className="text-xs font-semibold text-ink">{issue.label}</div>
                  <div className="mt-1 text-[11px] leading-5 text-ink-muted">
                    {issue.reasons.join(' · ')}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-delayed/40 bg-delayed-weak p-4 text-sm text-delayed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold text-ink">{t('issue.analysis.opportunities')}</h3>
            </div>
            {result.analysis.areas.filter(area => area.opportunities.length > 0).map(area => (
              <div key={area.megaCode} className="rounded-2xl border border-line bg-surface-2 p-4">
                <div className="text-xs font-semibold text-ink">
                  {area.megaCode} · {area.megaName}
                </div>
                <div className="mt-3 space-y-3">
                  {area.opportunities.map((opportunity, index) => {
                    const issueCodes = opportunity.issueIds
                      .map(id => area.issues.find(issue => issue.id === id)?.piIssueCode)
                      .filter((code): code is string => Boolean(code))
                    return (
                      <article key={`${area.megaCode}-${index}`} className="rounded-xl border border-line bg-surface p-3">
                        <div className="text-sm font-semibold text-ink">{opportunity.title}</div>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-ink-muted">
                          {opportunity.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {issueCodes.map(code => (
                            <span key={code} className="chip bg-brand-weak text-brand">{code}</span>
                          ))}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            ))}
            {result.template.status !== 'ready' && (
              <div className="flex items-start gap-2 rounded-2xl border border-pending/35 bg-pending-weak p-4 text-xs leading-5 text-pending">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">{t('issue.analysis.templateMissing')}</div>
                  <div className="mt-0.5">{result.template.message}</div>
                </div>
              </div>
            )}
            {result.template.status === 'ready' && result.pptExport.status !== 'ready' && (
              <div className="flex items-start gap-2 rounded-2xl border border-pending/35 bg-pending-weak p-4 text-xs leading-5 text-pending">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold">{t('issue.analysis.exportUnavailable')}</div>
                  <div className="mt-0.5">{result.pptExport.message}</div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
