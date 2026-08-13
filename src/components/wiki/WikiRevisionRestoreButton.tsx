'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { restoreWikiDocumentRevision } from '@/app/actions/wiki'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'

export function WikiRevisionRestoreButton({
  projectId,
  topicId,
  revisionId,
  versionNo,
  expectedUpdatedAt,
  locale,
}: {
  projectId: string
  topicId: string
  revisionId: string
  versionNo: number
  expectedUpdatedAt: string | null
  locale: Locale
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restore() {
    if (busy || !window.confirm(t(locale, 'wiki.history.restoreConfirm').replace('{version}', String(versionNo)))) return
    setBusy(true)
    setError(null)
    const result = await restoreWikiDocumentRevision({
      projectId,
      topicId,
      revisionId,
      expectedUpdatedAt,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? t(locale, 'wiki.history.restoreFailed'))
      return
    }
    router.refresh()
  }

  return (
    <div className="ml-auto">
      <button type="button" onClick={() => void restore()} disabled={busy} className="btn btn-ghost h-8 px-2.5 text-[11px]">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        {busy ? t(locale, 'wiki.history.restoring') : t(locale, 'wiki.history.restore')}
      </button>
      {error && <p className="mt-1 max-w-xs text-right text-[11px] font-medium text-delayed" role="alert">{error}</p>}
    </div>
  )
}
