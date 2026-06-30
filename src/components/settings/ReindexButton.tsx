'use client'

import { useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { reindexProjectAction } from '@/app/actions/chat'

/** DK Bot 의미검색 색인을 수동 재생성하는 버튼(PMO 관리자). */
export function ReindexButton({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  const run = async () => {
    if (loading) return
    setLoading(true)
    try {
      const r = await reindexProjectAction(projectId)
      if (!r.ok) {
        toast({ title: '색인 실패', description: r.error ?? '오류가 발생했습니다.', variant: 'error' })
      } else if (r.skipped) {
        toast({
          title: 'AI 키 미설정',
          description: 'GEMINI_API_KEY 설정 후 의미검색 색인이 생성됩니다. (봇은 키 없이도 동작)',
          variant: 'info',
        })
      } else {
        toast({ title: 'AI 색인 완료', description: `${r.count}개 문서를 색인했어요.`, variant: 'success' })
      }
    } catch (e) {
      toast({ title: '색인 실패', description: e instanceof Error ? e.message : '오류가 발생했습니다.', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn btn-ghost shrink-0" aria-label="DK Bot 의미검색 색인 재생성">
      {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? '색인 중…' : 'AI 색인 재생성'}
    </button>
  )
}
