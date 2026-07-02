'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { reindexProjectAction } from '@/app/actions/chat'
import { useLocale } from '@/components/providers/LocaleProvider'

/** DK Bot 의미검색 색인을 수동 재생성하는 버튼(PMO 관리자). */
export function ReindexButton({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (loading) return
    setLoading(true)
    try {
      const r = await reindexProjectAction(projectId)
      if (!r.ok) {
        toast({ title: t('settings.reindexFailed'), description: r.error ?? t('settings.genericError'), variant: 'error' })
      } else if (r.reason === 'no_embedding_key') {
        toast({
          title: t('settings.aiKeyMissing'),
          description: t('settings.aiKeyMissingDesc'),
          variant: 'info',
        })
      } else if (r.reason === 'embed_failed') {
        toast({
          title: t('settings.reindexFailed'),
          description: t('settings.embedFailedDesc'),
          variant: 'error',
        })
      } else if (r.skippedItems) {
        toast({
          title: t('settings.reindexPartial'),
          description: `${r.count}${t('settings.reindexPartialSeg1')}${r.skippedItems}${t('settings.reindexPartialSeg2')}`,
          variant: 'info',
        })
      } else {
        toast({ title: t('settings.reindexDone'), description: `${r.count}${t('settings.reindexDoneSuffix')}`, variant: 'success' })
      }
    } catch (e) {
      toast({ title: t('settings.reindexFailed'), description: e instanceof Error ? e.message : t('settings.genericError'), variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn btn-ghost shrink-0" aria-label={t('settings.reindexAria')}>
      {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? t('settings.reindexing') : t('settings.reindexButton')}
    </button>
  )
}
