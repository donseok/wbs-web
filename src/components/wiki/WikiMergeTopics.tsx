'use client'
// 주제 병합 — LLM이 회의마다 제목을 새로 지어 갈라진 주제를 정본 하나로 합친다.
// 항목과 knowledge_key까지 정본 주제 것으로 옮기므로, 다음 회의의 같은 지식이 비로소
// 같은 키로 들어와 재확인·구체화·대체 판정이 작동한다. 권한은 RPC에서 pmo_admin만.
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Merge } from 'lucide-react'
import type { Locale } from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import { useToast } from '@/components/ui/Toast'
import { mergeWikiTopics } from '@/app/actions/wiki'
import { wikiTopicSimilarity } from '@/lib/domain/wiki'
import type { WikiTopicSummary } from '@/lib/data/wiki'

/** 병합 후보를 먼저 보여준다. 150장 목록에서 닮은 쌍을 눈으로 찾게 두면 아무도 쓰지 않는다. */
function suggestedPairs(topics: WikiTopicSummary[]): Array<[WikiTopicSummary, WikiTopicSummary]> {
  const pairs: Array<{ pair: [WikiTopicSummary, WikiTopicSummary]; score: number }> = []
  for (let i = 0; i < topics.length; i += 1) {
    for (let j = i + 1; j < topics.length; j += 1) {
      const score = wikiTopicSimilarity(topics[i].normalizedTitle, topics[j].normalizedTitle)
      if (score >= 0.4) pairs.push({ pair: [topics[i], topics[j]], score })
    }
  }
  return pairs.sort((a, b) => b.score - a.score).slice(0, 8).map((entry) => entry.pair)
}

export function WikiMergeTopics({
  projectId,
  topics,
  locale,
}: {
  projectId: string
  topics: WikiTopicSummary[]
  locale: Locale
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')

  const suggestions = useMemo(() => suggestedPairs(topics), [topics])
  const sorted = useMemo(
    () => [...topics].sort((a, b) => a.title.localeCompare(b.title, locale === 'ko' ? 'ko' : 'en')),
    [topics, locale],
  )

  function submit(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return
    const sourceTopic = topics.find((topic) => topic.id === sourceId)
    const targetTopic = topics.find((topic) => topic.id === targetId)
    if (!window.confirm(
      t(locale, 'wiki.merge.confirm')
        .replace('{source}', sourceTopic?.title ?? '')
        .replace('{target}', targetTopic?.title ?? ''),
    )) return

    startTransition(async () => {
      const result = await mergeWikiTopics({
        projectId,
        sourceTopicId: sourceId,
        targetTopicId: targetId,
      })
      if (!result.ok) {
        toast({ title: result.error ?? t(locale, 'wiki.curate.failed'), variant: 'error' })
        return
      }
      toast({ title: t(locale, 'wiki.merge.done'), variant: 'success' })
      setSource('')
      setTarget('')
      router.refresh()
    })
  }

  if (topics.length < 2) return null

  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-2/40 p-4">
      <div className="flex items-center gap-2">
        <Merge className="h-4 w-4 text-ink-muted" aria-hidden />
        <h3 className="text-sm font-semibold text-ink">{t(locale, 'wiki.merge.title')}</h3>
      </div>
      <p className="mt-1 text-xs text-ink-muted">{t(locale, 'wiki.merge.desc')}</p>

      {suggestions.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1.5">{t(locale, 'wiki.merge.suggested')}</p>
          <ul className="space-y-1.5">
            {suggestions.map(([left, right]) => (
              <li key={`${left.id}:${right.id}`} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink">{left.title}</span>
                <span className="text-ink-subtle">↔</span>
                <span className="text-ink">{right.title}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(right.id, left.id)}
                  className="ml-auto rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {t(locale, 'wiki.merge.intoLeft')}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submit(left.id, right.id)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {t(locale, 'wiki.merge.intoRight')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] text-ink-subtle">{t(locale, 'wiki.merge.source')}</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="app-input"
          >
            <option value="">{t(locale, 'wiki.merge.pick')}</option>
            {sorted.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.title}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] text-ink-subtle">{t(locale, 'wiki.merge.target')}</span>
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="app-input"
          >
            <option value="">{t(locale, 'wiki.merge.pick')}</option>
            {sorted.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.title}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !source || !target || source === target}
          onClick={() => submit(source, target)}
          className="btn btn-ghost"
        >
          {pending ? t(locale, 'wiki.curate.running') : t(locale, 'wiki.merge.run')}
        </button>
      </div>
    </div>
  )
}
