'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Shield, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'

type ImportError = { excelRow: number; message: string }

/**
 * WBS Excel 가져오기 폼. 네이티브 폼 전송(페이지가 /api/import 로 이동해 원시 JSON 노출)
 * 대신 fetch 로 업로드하고, 같은 화면에서 토스트·검증오류·진행상태를 보여준다.
 */
export function WbsImportForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<ImportError[] | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const fd = new FormData(form)
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) {
      toast({ title: t('settings.selectFile'), variant: 'error' })
      return
    }

    setBusy(true)
    setErrors(null)
    try {
      const res = await fetch('/api/import', { method: 'POST', body: fd })
      const data: Record<string, unknown> = await res.json().catch(() => ({}))

      if (res.ok && data.ok) {
        const count = typeof data.count === 'number' ? data.count : 0
        toast({ title: t('settings.importDone'), description: `${count}${t('settings.importDoneCountSuffix')}`, variant: 'success' })
        form.reset()
        setFileName(null)
        router.refresh()
      } else if (Array.isArray(data.errors)) {
        const errs = data.errors as ImportError[]
        setErrors(errs)
        toast({ title: t('settings.importValidationFailed'), description: `${errs.length}${t('settings.importCheckCountSuffix')}`, variant: 'error' })
      } else {
        const msg = typeof data.error === 'string' ? data.error : `${t('settings.importFailedHttp')} (HTTP ${res.status}).`
        toast({ title: msg, variant: 'error' })
      }
    } catch {
      toast({ title: t('settings.importNetworkError'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="projectId" value={projectId} />
      <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-2 px-6 text-center transition hover:border-brand hover:bg-brand-weak/40">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-sm transition group-hover:border-brand-ring">
          <Upload className="h-5 w-5" />
        </span>
        <span className="mt-4 text-sm font-semibold text-ink">{fileName ?? t('settings.chooseExcel')}</span>
        <span className="mt-1 text-xs leading-5 text-ink-muted">{t('settings.xlsxOnly')}</span>
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          disabled={busy}
          onChange={event => { setFileName(event.target.files?.[0]?.name ?? null); setErrors(null) }}
          className="mt-4 max-w-full text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-weak file:px-3 file:py-2 file:font-semibold file:text-brand"
        />
      </label>

      {errors && errors.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-delayed/30 bg-delayed-weak/40 p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-delayed">
            <AlertTriangle className="h-3.5 w-3.5" /> {t('settings.validationErrorsPrefix')}{errors.length}{t('settings.validationErrorsSuffix')}
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs leading-5 text-ink-muted">
            {errors.map((er, i) => (
              <li key={i}>{t('settings.excelRowPrefix')}{er.excelRow}{t('settings.excelRowSuffix')}{er.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Shield className="h-3.5 w-3.5 text-done" />
          {t('settings.uploadNote')}
        </p>
        <button className="btn btn-primary" disabled={busy}>
          <Upload className="h-4 w-4" />
          {busy ? t('settings.importing') : t('settings.validateAndImport')}
        </button>
      </div>
    </form>
  )
}
