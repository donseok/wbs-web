'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { reviewWikiItem } from '@/app/actions/wiki'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'

export function WikiProposalActions({
  projectId,
  topicId,
  itemId,
  locale,
}: {
  projectId: string
  topicId: string
  itemId: string
  locale: Locale
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'accepted' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function review(reviewState: 'accepted' | 'rejected') {
    if (busy) return
    setBusy(reviewState)
    setError(null)
    const result = await reviewWikiItem({ projectId, topicId, itemId, reviewState })
    setBusy(null)
    if (!result.ok) {
      setError(result.error ?? t(locale, 'wiki.proposal.failed'))
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-3 border-t border-line/80 pt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void review('accepted')} disabled={busy !== null} className="btn btn-primary h-8 px-3 text-xs">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {busy === 'accepted' ? t(locale, 'wiki.proposal.reviewing') : t(locale, 'wiki.proposal.accept')}
        </button>
        <button type="button" onClick={() => void review('rejected')} disabled={busy !== null} className="btn btn-ghost h-8 px-3 text-xs">
          <X className="h-3.5 w-3.5" aria-hidden />
          {busy === 'rejected' ? t(locale, 'wiki.proposal.reviewing') : t(locale, 'wiki.proposal.reject')}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-delayed" role="alert">{error}</p>}
    </div>
  )
}
