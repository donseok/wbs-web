'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareReply, Send, X } from 'lucide-react'
import { answerWikiQuestion } from '@/app/actions/wiki'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'

export function WikiQuestionAnswerForm({
  projectId,
  topicId,
  questionId,
  locale,
}: {
  projectId: string
  topicId?: string | null
  questionId: string
  locale: Locale
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const answerMd = answer.trim()
    if (!answerMd || busy) return
    setBusy(true)
    setError(null)
    const result = await answerWikiQuestion({ projectId, questionId, answerMd, topicId: topicId ?? null })
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? t(locale, 'wiki.question.answerFailed'))
      return
    }
    setAnswer('')
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost mt-3 h-8 px-3 text-xs">
        <MessageSquareReply className="h-3.5 w-3.5" aria-hidden />
        {t(locale, 'wiki.question.answer')}
      </button>
    )
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-ink-muted">{t(locale, 'wiki.question.answerLabel')}</span>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          maxLength={20_000}
          rows={4}
          autoFocus
          className="app-textarea resize-y text-sm leading-6"
          placeholder={t(locale, 'wiki.question.answerPlaceholder')}
        />
      </label>
      {error && <p className="mt-2 text-xs font-medium text-delayed" role="alert">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || !answer.trim()} className="btn btn-primary h-8 px-3 text-xs">
          <Send className="h-3.5 w-3.5" aria-hidden />
          {busy ? t(locale, 'wiki.question.answering') : t(locale, 'wiki.question.submitAnswer')}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy} className="btn btn-ghost h-8 px-3 text-xs">
          <X className="h-3.5 w-3.5" aria-hidden />
          {t(locale, 'wiki.document.cancel')}
        </button>
      </div>
    </div>
  )
}
